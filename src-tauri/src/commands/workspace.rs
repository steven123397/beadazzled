//! The workspace command surface: registry snapshots, bd discovery and
//! persistence for the Tauri layer.
//!
//! Every method is synchronous and takes `&self`; Tauri runs commands on its
//! own threads and the service guards state with a mutex. Persistence goes
//! through [`ConfigWriter`], which debounces checkpoint traffic and is flushed
//! on exit.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use ts_rs::TS;

use super::config_writer::ConfigWriter;
use crate::bridge::{BdBridge, BridgeError, BridgeErrorCode, WriteCommand, WriteOutcome};
use crate::workspace::discovery::{BdDiscovery, BdStatus, MIN_BD_VERSION};
use crate::workspace::registry::{load, AddOutcome, AppConfig, Checkpoint, WorkspaceEntry};
use crate::workspace::validate::validate_workspace;

/// What the workspace UI needs in one call.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    pub config: AppConfig,
    /// Registered workspaces whose directory no longer exists.
    pub missing: Vec<String>,
    /// The workspace to reopen on startup, if registered.
    pub active: Option<String>,
    /// Where a corrupt `config.json` was moved, if that happened on startup.
    pub corrupt_backup: Option<String>,
}

/// Persistence invariant: every mutation queues its snapshot while the
/// state lock is still held. The writer numbers snapshots in queue order, so
/// queueing after dropping the lock would let a concurrent command store an
/// older snapshot last.
pub struct WorkspaceService {
    writer: std::sync::Arc<ConfigWriter>,
    state: Mutex<State>,
}

struct State {
    config: AppConfig,
    discovery: std::sync::Arc<BdDiscovery>,
    corrupt_backup: Option<String>,
}

impl WorkspaceService {
    pub fn open(config_path: impl Into<PathBuf>) -> std::io::Result<Self> {
        let config_path = config_path.into();
        let writer = ConfigWriter::new(config_path.clone());
        Self::open_with_writer(config_path, writer)
    }

    /// Test seam: supply the writer so a test can pause its queue.
    #[doc(hidden)]
    pub fn open_with_writer(
        config_path: impl Into<PathBuf>,
        writer: std::sync::Arc<ConfigWriter>,
    ) -> std::io::Result<Self> {
        let config_path = config_path.into();
        let loaded = load(&config_path)?;
        let discovery =
            std::sync::Arc::new(BdDiscovery::from_env(loaded.config.bd_path.as_deref()));
        Ok(Self {
            writer,
            state: Mutex::new(State {
                config: loaded.config,
                discovery,
                corrupt_backup: loaded.corrupt_backup.map(|path| path.display().to_string()),
            }),
        })
    }

    pub fn snapshot(&self) -> WorkspaceSnapshot {
        let state = lock(&self.state);
        let config = state.config.clone();
        WorkspaceSnapshot {
            missing: config
                .missing_workspaces()
                .iter()
                .map(|entry| entry.path.clone())
                .collect(),
            active: config.last_workspace_path.clone(),
            corrupt_backup: state.corrupt_backup.clone(),
            config,
        }
    }

    pub fn bd_status(&self, refresh: bool) -> BdStatus {
        let discovery = lock(&self.state).discovery.clone();
        let probe = |path: &Path| BdBridge::new(path, PathBuf::from(".")).version();
        if refresh {
            discovery.refresh(probe)
        } else {
            discovery.status(probe)
        }
    }

    /// Stores the explicit bd path (or clears it) and probes immediately.
    pub fn set_bd_path(&self, path: Option<String>) -> BdStatus {
        let discovery = {
            let mut state = lock(&self.state);
            state.config.bd_path = path.filter(|value| !value.trim().is_empty());
            let discovery =
                std::sync::Arc::new(BdDiscovery::from_env(state.config.bd_path.as_deref()));
            state.discovery = std::sync::Arc::clone(&discovery);
            self.writer.queue(state.config.clone());
            discovery
        };
        let probe = |path: &Path| BdBridge::new(path, PathBuf::from(".")).version();
        discovery.refresh(probe)
    }

    pub fn add_workspace(&self, directory: &str) -> Result<WorkspaceEntry, BridgeError> {
        let bd_path = self.ready_bd_path()?;
        if !Path::new(directory).is_dir() {
            return Err(ws_inaccessible(directory));
        }
        let validated = validate_workspace(Path::new(&bd_path), Path::new(directory))?;
        let now = now_iso();
        let entry = validated.into_entry(now.clone());

        let mut state = lock(&self.state);
        let identity = (entry.project_id.clone(), entry.is_worktree);
        let index = match state.config.add_workspace(entry) {
            AddOutcome::Added(index) => index,
            AddOutcome::Existing(index) => {
                // The directory may have been recreated since it was first
                // registered: refresh its identity so a stale project id and
                // checkpoint cannot be reused.
                state.config.workspaces[index].apply_identity(&identity.0, identity.1);
                index
            }
        };
        let canonical = state.config.workspaces[index].path.clone();
        state.config.switch_workspace(&canonical, now);
        let saved = state.config.clone();
        let result = state.config.workspaces[index].clone();
        self.writer.queue(saved);
        Ok(result)
    }

    pub fn switch_workspace(&self, path: &str) -> Result<WorkspaceEntry, BridgeError> {
        let canonical = {
            let state = lock(&self.state);
            let index = state
                .config
                .workspace_index(path)
                .ok_or_else(|| not_registered(path))?;
            state.config.workspaces[index].path.clone()
        };
        if !Path::new(&canonical).is_dir() {
            return Err(ws_inaccessible(&canonical));
        }
        let bd_path = self.ready_bd_path()?;
        let validated = validate_workspace(Path::new(&bd_path), Path::new(&canonical))?;

        let mut state = lock(&self.state);
        let index = state
            .config
            .workspace_index(&canonical)
            .ok_or_else(|| not_registered(&canonical))?;
        state.config.workspaces[index].apply_identity(&validated.project_id, validated.is_worktree);
        state.config.switch_workspace(&canonical, now_iso());
        let saved = state.config.clone();
        let result = state.config.workspaces[index].clone();
        self.writer.queue(saved);
        Ok(result)
    }

    pub fn remove_workspace(&self, path: &str) -> bool {
        let mut state = lock(&self.state);
        if state.config.remove_workspace(path).is_none() {
            return false;
        }
        let saved = state.config.clone();
        self.writer.queue(saved);
        true
    }

    pub fn relocate_workspace(
        &self,
        old_path: &str,
        new_path: &str,
    ) -> Result<WorkspaceEntry, BridgeError> {
        let bd_path = self.ready_bd_path()?;
        if !Path::new(new_path).is_dir() {
            return Err(ws_inaccessible(new_path));
        }
        let validated = validate_workspace(Path::new(&bd_path), Path::new(new_path))?;
        let entry = validated.into_entry(now_iso());

        let mut state = lock(&self.state);
        let index = state
            .config
            .relocate_workspace(old_path, entry)
            .ok_or_else(|| not_registered(old_path))?;
        let result = state.config.workspaces[index].clone();
        let saved = state.config.clone();
        self.writer.queue(saved);
        Ok(result)
    }

    /// Persists the journal cursor; frequent calls are coalesced by the writer.
    pub fn set_checkpoint(&self, path: &str, seq: i64) -> bool {
        let mut state = lock(&self.state);
        let checkpoint = Checkpoint {
            seq,
            saved_at: now_iso(),
        };
        if !state.config.set_checkpoint(path, checkpoint) {
            return false;
        }
        let saved = state.config.clone();
        self.writer.queue(saved);
        true
    }

    /// The checkpoint for `path`, only when `project_id` still matches.
    pub fn checkpoint(&self, path: &str, project_id: &str) -> Option<Checkpoint> {
        lock(&self.state).config.checkpoint_for(path, project_id)
    }

    /// Runs one write against the workspace the submission belongs to.
    ///
    /// The caller carries the workspace it was editing. Resolving the active
    /// workspace here instead would let a queued write land in a workspace the
    /// user switched to in the meantime.
    pub fn write(
        &self,
        workspace: &str,
        command: &WriteCommand,
    ) -> Result<WriteOutcome, BridgeError> {
        let bd_path = self.ready_bd_path()?;
        let registered = lock(&self.state)
            .config
            .workspace_index(workspace)
            .is_some();
        if !registered {
            return Err(not_registered(workspace));
        }
        if !Path::new(workspace).is_dir() {
            return Err(ws_inaccessible(workspace));
        }
        BdBridge::new(bd_path, workspace).write(command)
    }

    pub fn flush(&self) -> std::io::Result<()> {
        self.writer.flush()
    }

    fn ready_bd_path(&self) -> Result<String, BridgeError> {
        match self.bd_status(false) {
            BdStatus::Ready { path, .. } => Ok(path),
            BdStatus::Unsupported { found, min, .. } => {
                let mut detail = Map::new();
                detail.insert("found".to_owned(), Value::String(found.clone()));
                detail.insert("min".to_owned(), Value::String(min.clone()));
                Err(BridgeError::new(
                    BridgeErrorCode::BdVersionUnsupported,
                    format!("bd {found} is older than the required {min}"),
                )
                .with_detail(detail))
            }
            BdStatus::Broken { error, .. } => Err(error),
            BdStatus::NotFound { searched } => {
                let mut detail = Map::new();
                detail.insert(
                    "searched".to_owned(),
                    Value::Array(searched.into_iter().map(Value::String).collect()),
                );
                Err(BridgeError::new(
                    BridgeErrorCode::BdNotFound,
                    format!("bd was not found; install it or set its path in Settings (requires {MIN_BD_VERSION})"),
                )
                .with_detail(detail))
            }
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn ws_inaccessible(path: &str) -> BridgeError {
    let mut detail = Map::new();
    detail.insert("path".to_owned(), Value::String(path.to_owned()));
    BridgeError::new(
        BridgeErrorCode::WsInaccessible,
        format!("the workspace directory is missing: {path}"),
    )
    .with_detail(detail)
}

fn not_registered(path: &str) -> BridgeError {
    BridgeError::new(
        BridgeErrorCode::Internal,
        format!("workspace is not registered: {path}"),
    )
}

fn now_iso() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    format_utc(seconds)
}

fn format_utc(seconds: u64) -> String {
    let days = (seconds / 86_400) as i64;
    let remainder = seconds % 86_400;
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        remainder / 3_600,
        (remainder % 3_600) / 60,
        remainder % 60
    )
}

/// Howard Hinnant's `civil_from_days`.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_prime + 2) / 5 + 1) as u32;
    let month = if month_prime < 10 {
        month_prime + 3
    } else {
        month_prime - 9
    } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

#[cfg(test)]
mod tests {
    use super::format_utc;

    #[test]
    fn formats_unix_timestamps_as_utc_iso() {
        assert_eq!(format_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(format_utc(1_700_000_000), "2023-11-14T22:13:20Z");
    }
}

// ---- Tauri commands -------------------------------------------------------

// Plain sync commands run inline on the main thread, so a slow bd call would
// freeze the window for its whole timeout. Every command that can spawn bd
// (or block on a debounced flush) is marked async and runs on the thread pool.

#[tauri::command]
pub fn workspace_snapshot(service: tauri::State<'_, WorkspaceService>) -> WorkspaceSnapshot {
    service.snapshot()
}

#[tauri::command(async)]
pub fn bd_status(service: tauri::State<'_, WorkspaceService>, refresh: bool) -> BdStatus {
    service.bd_status(refresh)
}

#[tauri::command(async)]
pub fn bd_set_path(service: tauri::State<'_, WorkspaceService>, path: Option<String>) -> BdStatus {
    service.set_bd_path(path)
}

#[tauri::command(async)]
pub fn workspace_add(
    service: tauri::State<'_, WorkspaceService>,
    path: String,
) -> Result<WorkspaceEntry, BridgeError> {
    service.add_workspace(&path)
}

#[tauri::command]
pub fn workspace_switch(
    service: tauri::State<'_, WorkspaceService>,
    path: String,
) -> Result<WorkspaceEntry, BridgeError> {
    service.switch_workspace(&path)
}

#[tauri::command]
pub fn workspace_remove(service: tauri::State<'_, WorkspaceService>, path: String) -> bool {
    service.remove_workspace(&path)
}

#[tauri::command(async)]
pub fn workspace_relocate(
    service: tauri::State<'_, WorkspaceService>,
    old_path: String,
    new_path: String,
) -> Result<WorkspaceEntry, BridgeError> {
    service.relocate_workspace(&old_path, &new_path)
}

#[tauri::command]
pub fn workspace_set_checkpoint(
    service: tauri::State<'_, WorkspaceService>,
    path: String,
    seq: i64,
) -> bool {
    service.set_checkpoint(&path, seq)
}

#[tauri::command]
pub fn workspace_checkpoint(
    service: tauri::State<'_, WorkspaceService>,
    path: String,
    project_id: String,
) -> Option<Checkpoint> {
    service.checkpoint(&path, &project_id)
}

#[tauri::command(async)]
pub fn execute_write(
    service: tauri::State<'_, WorkspaceService>,
    workspace: String,
    command: WriteCommand,
) -> Result<WriteOutcome, BridgeError> {
    service.write(&workspace, &command)
}

#[tauri::command(async)]
pub fn workspace_flush(service: tauri::State<'_, WorkspaceService>) -> Result<(), BridgeError> {
    service
        .flush()
        .map_err(|error| BridgeError::new(BridgeErrorCode::Internal, error.to_string()))
}
