//! The workspace command surface: registry snapshots, bd discovery and
//! persistence for the Tauri layer.
//!
//! Every method is synchronous and takes `&self`; Tauri runs commands on its
//! own threads and the service guards state with a mutex. Persistence goes
//! through [`ConfigWriter`], which debounces checkpoint traffic and is flushed
//! on exit.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::config_writer::ConfigWriter;
use super::{bd_status_error, not_registered, ws_inaccessible};
use crate::bridge::{BdBridge, BridgeError, BridgeErrorCode, WriteCommand, WriteOutcome};
use crate::util::{lock, now_iso};
use crate::workspace::discovery::{BdDiscovery, BdStatus};
use crate::workspace::registry::{
    load, AddOutcome, AppConfig, Checkpoint, Language, Theme, WorkspaceEntry,
};
use crate::workspace::validate::{validate_workspace, ValidatedWorkspace};

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
    /// Orders concurrent bd-path changes: a probe that started before another
    /// request must not commit after the newer one.
    bd_path_generation: AtomicU64,
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
            bd_path_generation: AtomicU64::new(0),
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
    ///
    /// A path that does not answer `bd --version` as a supported bd is
    /// rejected: the previous entry stays configured and the returned status
    /// describes the attempt so Settings can show why. Probing the candidate
    /// on its own matters — discovery would fall back to PATH and report
    /// `ready` for a path the user just picked that does not work.
    pub fn set_bd_path(&self, path: Option<String>) -> BdStatus {
        // Probes run before the state lock, so concurrent picks can finish out
        // of order. The generation makes the newest request's outcome win.
        let generation = self.bd_path_generation.fetch_add(1, Ordering::SeqCst) + 1;
        let probe = |path: &Path| BdBridge::new(path, PathBuf::from(".")).version();
        let Some(path) = path.filter(|value| !value.trim().is_empty()) else {
            let mut state = lock(&self.state);
            state.config.bd_path = None;
            let discovery = std::sync::Arc::new(BdDiscovery::from_env(None));
            state.discovery = std::sync::Arc::clone(&discovery);
            self.commit(&state);
            drop(state);
            return discovery.refresh(probe);
        };

        let candidate = BdDiscovery::new(Some(&path), None);
        let status = candidate.refresh(probe);
        if !matches!(status, BdStatus::Ready { .. }) {
            return status;
        }

        let mut state = lock(&self.state);
        if self.bd_path_generation.load(Ordering::SeqCst) != generation {
            // A newer path change started while this probe ran. Report this
            // attempt's result but leave the registry to the newer request.
            return status;
        }
        state.config.bd_path = Some(path);
        let discovery = std::sync::Arc::new(BdDiscovery::from_env(state.config.bd_path.as_deref()));
        // The candidate was just probed; reuse that answer instead of spawning
        // bd again for the cached read that follows this command.
        discovery.prime(status.clone());
        state.discovery = std::sync::Arc::clone(&discovery);
        self.commit(&state);
        status
    }

    /// Applies the language/theme pair and waits for it to reach disk.
    ///
    /// Settings owns only these two fields; the rest of the config (bd path,
    /// workspaces, checkpoints) stays exactly as loaded. Unlike checkpoint
    /// traffic this is one explicit user action, so the command reports the
    /// save itself instead of acknowledging a debounced write that may fail.
    pub fn set_preferences(
        &self,
        language: Language,
        theme: Theme,
    ) -> Result<AppConfig, BridgeError> {
        let config = {
            let mut state = lock(&self.state);
            state.config.language = language;
            state.config.theme = theme;
            self.commit(&state)
        };
        self.writer.flush().map_err(|error| {
            BridgeError::new(
                BridgeErrorCode::Internal,
                format!("could not save preferences: {error}"),
            )
        })?;
        Ok(config)
    }

    pub fn add_workspace(&self, directory: &str) -> Result<WorkspaceEntry, BridgeError> {
        let (_, validated) = self.validate(directory)?;
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
        let result = state.config.workspaces[index].clone();
        self.commit(&state);
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
        // This caller checked the directory before resolving bd; the other
        // mutation callers do it the other way round. Keep that order so a
        // missing directory still surfaces WS_INACCESSIBLE when bd is also
        // unavailable, instead of masking it behind a bd error.
        ensure_dir(&canonical)?;
        let (_, validated) = self.validate(&canonical)?;

        let mut state = lock(&self.state);
        let index = state
            .config
            .workspace_index(&canonical)
            .ok_or_else(|| not_registered(&canonical))?;
        state.config.workspaces[index].apply_identity(&validated.project_id, validated.is_worktree);
        state.config.switch_workspace(&canonical, now_iso());
        let result = state.config.workspaces[index].clone();
        self.commit(&state);
        Ok(result)
    }

    pub fn remove_workspace(&self, path: &str) -> bool {
        let mut state = lock(&self.state);
        if state.config.remove_workspace(path).is_none() {
            return false;
        }
        self.commit(&state);
        true
    }

    pub fn relocate_workspace(
        &self,
        old_path: &str,
        new_path: &str,
    ) -> Result<WorkspaceEntry, BridgeError> {
        let (_, validated) = self.validate(new_path)?;
        let entry = validated.into_entry(now_iso());

        let mut state = lock(&self.state);
        let index = state
            .config
            .relocate_workspace(old_path, entry)
            .ok_or_else(|| not_registered(old_path))?;
        let result = state.config.workspaces[index].clone();
        self.commit(&state);
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
        self.commit(&state);
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
        ensure_dir(workspace)?;
        BdBridge::new(bd_path, workspace).write(command)
    }

    pub fn flush(&self) -> std::io::Result<()> {
        self.writer.flush()
    }

    /// Queues the current config snapshot for persistence and returns it.
    ///
    /// Convention: call while the state lock is still held. The writer numbers
    /// snapshots in queue order, so queueing after dropping the lock would let
    /// a concurrent command store an older snapshot last. Returning the
    /// snapshot lets `set_preferences` serve both the queue and its result from
    /// the same clone.
    fn commit(&self, state: &State) -> AppConfig {
        let saved = state.config.clone();
        self.writer.queue(saved.clone());
        saved
    }

    /// Shared bd-first preflight for `add_workspace` / `relocate_workspace`:
    /// resolve bd, check the directory, then validate it. `switch_workspace`
    /// used the opposite order, so it runs `ensure_dir` before calling this;
    /// that keeps every caller's surfaced error code unchanged. The bd path is
    /// returned for callers that build a bridge from it.
    fn validate(&self, path: &str) -> Result<(String, ValidatedWorkspace), BridgeError> {
        let bd_path = self.ready_bd_path()?;
        ensure_dir(path)?;
        let validated = validate_workspace(Path::new(&bd_path), Path::new(path))?;
        Ok((bd_path, validated))
    }

    pub(crate) fn ready_bd_path(&self) -> Result<String, BridgeError> {
        match self.bd_status(false) {
            BdStatus::Ready { path, .. } => Ok(path),
            status => Err(bd_status_error(&status)),
        }
    }
}

fn ensure_dir(path: &str) -> Result<(), BridgeError> {
    if !Path::new(path).is_dir() {
        return Err(ws_inaccessible(path));
    }
    Ok(())
}

// ---- Tauri commands -------------------------------------------------------

// Plain sync commands run inline on the main thread, so a slow bd call would
// freeze the window for its whole timeout. Every command that can spawn bd
// (or block on a debounced flush) is marked async and runs on the thread pool.

#[tauri::command(async)]
pub fn app_set_preferences(
    service: tauri::State<'_, WorkspaceService>,
    language: Language,
    theme: Theme,
) -> Result<AppConfig, BridgeError> {
    service.set_preferences(language, theme)
}

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

#[tauri::command(async)]
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
