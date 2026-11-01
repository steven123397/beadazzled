//! The persisted workspace registry (`config.json`).
//!
//! Writes are atomic (temp file + rename) so a crash mid-write never leaves a
//! half-written config. A file that cannot be parsed is renamed aside and the
//! app starts from defaults — the user's data is never silently discarded.

use std::ffi::OsStr;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use crate::bridge::WorkspaceContext;

/// Bumped only when the on-disk shape changes incompatibly.
pub const SCHEMA_VERSION: u32 = 1;

const DEFAULT_LANGUAGE: Language = Language::En;
const DEFAULT_THEME: Theme = Theme::System;

/// The complete `config.json` document.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    /// `None` means "resolve bd from PATH".
    #[serde(default)]
    pub bd_path: Option<String>,
    #[serde(default = "default_language")]
    pub language: Language,
    #[serde(default = "default_theme")]
    pub theme: Theme,
    #[serde(default)]
    pub last_workspace_path: Option<String>,
    #[serde(default)]
    pub workspaces: Vec<WorkspaceEntry>,
}

/// A registered beads workspace.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntry {
    /// `repo_root` as reported by `bd context`, the canonical absolute path.
    pub path: String,
    /// Display name; defaults to the directory name.
    pub name: String,
    pub project_id: String,
    pub is_worktree: bool,
    pub last_opened_at: String,
    /// Journal position; only valid while `project_id` is unchanged.
    pub checkpoint: Option<Checkpoint>,
}

/// The journal position persisted for a workspace.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    #[ts(type = "number")]
    pub seq: i64,
    pub saved_at: String,
}

/// UI language preference.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum Language {
    #[serde(rename = "en")]
    En,
    #[serde(rename = "zh-CN")]
    ZhCn,
}

/// UI theme preference.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Light,
    Dark,
    System,
}

/// The result of registering a workspace.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddOutcome {
    Added(usize),
    Existing(usize),
}

/// A loaded config plus, when the file was unusable, where it was moved.
#[derive(Debug, Clone, PartialEq)]
pub struct LoadedConfig {
    pub config: AppConfig,
    pub corrupt_backup: Option<PathBuf>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            bd_path: None,
            language: DEFAULT_LANGUAGE,
            theme: DEFAULT_THEME,
            last_workspace_path: None,
            workspaces: Vec::new(),
        }
    }
}

impl AppConfig {
    /// Index of the workspace whose normalised path matches, if registered.
    pub fn workspace_index(&self, path: &str) -> Option<usize> {
        let key = path_key(path);
        self.workspaces
            .iter()
            .position(|entry| path_key(&entry.path) == key)
    }

    /// Registers a workspace unless its path is already known.
    pub fn add_workspace(&mut self, entry: WorkspaceEntry) -> AddOutcome {
        if let Some(index) = self.workspace_index(&entry.path) {
            return AddOutcome::Existing(index);
        }
        self.workspaces.push(entry);
        AddOutcome::Added(self.workspaces.len() - 1)
    }

    /// Points an existing entry at a new location, keeping its display name.
    ///
    /// A checkpoint is only kept when the project identity is unchanged; a
    /// different `project_id` means a different seq space.
    pub fn relocate_workspace(
        &mut self,
        old_path: &str,
        mut moved: WorkspaceEntry,
    ) -> Option<usize> {
        let index = self.workspace_index(old_path)?;
        moved.name = self.workspaces[index].name.clone();
        if self.workspaces[index].project_id != moved.project_id {
            moved.checkpoint = None;
        }
        self.workspaces[index] = moved;
        self.retarget_last_workspace(old_path, index);
        Some(index)
    }

    /// Removes a workspace from the registry; its `.beads` directory is untouched.
    pub fn remove_workspace(&mut self, path: &str) -> Option<WorkspaceEntry> {
        let index = self.workspace_index(path)?;
        let removed = self.workspaces.remove(index);
        let clearing_last = self
            .last_workspace_path
            .as_deref()
            .is_some_and(|last| path_key(last) == path_key(&removed.path));
        if clearing_last {
            self.last_workspace_path = None;
        }
        Some(removed)
    }

    /// Makes `path` the active workspace and records the open time.
    pub fn switch_workspace(&mut self, path: &str, now: impl Into<String>) -> bool {
        let Some(index) = self.workspace_index(path) else {
            return false;
        };
        self.workspaces[index].last_opened_at = now.into();
        self.last_workspace_path = Some(self.workspaces[index].path.clone());
        true
    }

    /// The workspace to reopen on startup, if it is still registered.
    pub fn open_last_workspace(&self) -> Option<&WorkspaceEntry> {
        let last = self.last_workspace_path.as_deref()?;
        self.workspaces.get(self.workspace_index(last)?)
    }

    /// The checkpoint for `path`, but only for the current `project_id`.
    pub fn checkpoint_for(&self, path: &str, project_id: &str) -> Option<Checkpoint> {
        let entry = self.workspaces.get(self.workspace_index(path)?)?;
        if entry.project_id != project_id {
            return None;
        }
        entry.checkpoint.clone()
    }

    /// Stores a checkpoint; returns `false` when the workspace is unknown.
    pub fn set_checkpoint(&mut self, path: &str, checkpoint: Checkpoint) -> bool {
        let Some(index) = self.workspace_index(path) else {
            return false;
        };
        self.workspaces[index].checkpoint = Some(checkpoint);
        true
    }

    /// Entries whose directory no longer exists.
    pub fn missing_workspaces(&self) -> Vec<&WorkspaceEntry> {
        self.workspaces
            .iter()
            .filter(|entry| !Path::new(&entry.path).is_dir())
            .collect()
    }

    fn retarget_last_workspace(&mut self, old_path: &str, index: usize) {
        let pointing_at_old = self
            .last_workspace_path
            .as_deref()
            .is_some_and(|last| path_key(last) == path_key(old_path));
        if pointing_at_old {
            self.last_workspace_path = Some(self.workspaces[index].path.clone());
        }
    }
}

impl WorkspaceEntry {
    /// Builds an entry from a validated `bd context` response.
    pub fn from_context(
        repo_root: &str,
        context: &WorkspaceContext,
        now: impl Into<String>,
    ) -> Self {
        Self {
            path: repo_root.to_owned(),
            name: workspace_name(repo_root),
            project_id: context.project_id.clone(),
            is_worktree: context_flag(context, "is_worktree"),
            last_opened_at: now.into(),
            checkpoint: None,
        }
    }

    /// Re-binds the entry to the identity of the workspace just opened.
    ///
    /// Returns `true` when a checkpoint was discarded because `project_id`
    /// changed — the caller must then run a full baseline.
    pub fn apply_identity(&mut self, project_id: &str, is_worktree: bool) -> bool {
        let discarded = self.project_id != project_id && self.checkpoint.is_some();
        if self.project_id != project_id {
            self.project_id = project_id.to_owned();
            self.checkpoint = None;
        }
        self.is_worktree = is_worktree;
        discarded
    }
}

/// Reads the registry at `config_path`, recovering from a corrupt file.
pub fn load(config_path: &Path) -> io::Result<LoadedConfig> {
    let text = match fs::read_to_string(config_path) {
        Ok(text) => text,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(LoadedConfig {
                config: AppConfig::default(),
                corrupt_backup: None,
            })
        }
        Err(error) => return Err(error),
    };

    match serde_json::from_str(&text) {
        Ok(config) => Ok(LoadedConfig {
            config,
            corrupt_backup: None,
        }),
        Err(_) => {
            let backup = corrupt_backup_path(config_path);
            fs::rename(config_path, &backup)?;
            Ok(LoadedConfig {
                config: AppConfig::default(),
                corrupt_backup: Some(backup),
            })
        }
    }
}

/// Writes the registry atomically: temp file in the same directory, then rename.
pub fn save_atomic(config_path: &Path, config: &AppConfig) -> io::Result<()> {
    let directory = parent_dir(config_path);
    fs::create_dir_all(directory)?;

    let temporary = temporary_path(config_path);
    let json = serde_json::to_vec_pretty(config).map_err(io::Error::other)?;
    let write_result = (|| {
        let mut file = fs::File::create(&temporary)?;
        file.write_all(&json)?;
        file.sync_all()
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }

    if let Err(error) = fs::rename(&temporary, config_path) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    Ok(())
}

/// The registry location inside `app_config_dir()`.
pub fn default_config_path(config_dir: &Path) -> PathBuf {
    config_dir.join("config.json")
}

/// Comparison key for a workspace path: separators unified, case folded on Windows.
pub fn path_key(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let trimmed = normalized.trim_end_matches('/');
    let trimmed = if trimmed.is_empty() && !normalized.is_empty() {
        "/"
    } else {
        trimmed
    };
    if cfg!(windows) {
        trimmed.to_lowercase()
    } else {
        trimmed.to_owned()
    }
}

/// The default display name for a workspace path.
pub fn workspace_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(OsStr::to_str)
        .filter(|name| !name.is_empty())
        .unwrap_or(path)
        .to_owned()
}

fn default_schema_version() -> u32 {
    SCHEMA_VERSION
}

fn default_language() -> Language {
    DEFAULT_LANGUAGE
}

fn default_theme() -> Theme {
    DEFAULT_THEME
}

fn context_flag(context: &WorkspaceContext, key: &str) -> bool {
    context
        .extra
        .0
        .get(key)
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn parent_dir(path: &Path) -> &Path {
    path.parent().unwrap_or_else(|| Path::new("."))
}

fn file_stem(path: &Path) -> &str {
    path.file_stem().and_then(OsStr::to_str).unwrap_or("config")
}

fn corrupt_backup_path(config_path: &Path) -> PathBuf {
    let directory = parent_dir(config_path);
    let stem = file_stem(config_path);
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);

    let mut candidate = directory.join(format!("{stem}.corrupt-{seconds}.json"));
    let mut suffix = 1;
    while candidate.exists() {
        candidate = directory.join(format!("{stem}.corrupt-{seconds}-{suffix}.json"));
        suffix += 1;
    }
    candidate
}

fn temporary_path(config_path: &Path) -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let counter = COUNTER.fetch_add(1, Ordering::Relaxed);
    parent_dir(config_path).join(format!(
        ".{}.tmp-{}-{counter}",
        file_stem(config_path),
        std::process::id()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bridge::WorkspaceContext;
    use std::fs;
    use std::path::PathBuf;

    const NOW: &str = "2026-11-01T00:00:00Z";
    const LATER: &str = "2026-11-01T01:00:00Z";

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "beadazzled-workspace-{}-{name}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn context(project_id: &str) -> WorkspaceContext {
        WorkspaceContext {
            project_id: project_id.to_owned(),
            bd_version: "1.3.2".to_owned(),
            dolt_mode: "embedded".to_owned(),
            schema_version: 1,
            extra: Default::default(),
        }
    }

    fn entry(path: &str, project_id: &str, now: &str) -> WorkspaceEntry {
        WorkspaceEntry::from_context(path, &context(project_id), now)
    }

    fn with_checkpoint(mut entry: WorkspaceEntry, seq: i64) -> WorkspaceEntry {
        entry.checkpoint = Some(Checkpoint {
            seq,
            saved_at: NOW.to_owned(),
        });
        entry
    }

    #[test]
    fn missing_config_loads_defaults() {
        let dir = temp_dir("missing");
        let loaded = load(&dir.join("config.json")).expect("load missing config");

        assert_eq!(loaded.config.schema_version, 1);
        assert_eq!(loaded.config.language, Language::En);
        assert_eq!(loaded.config.theme, Theme::System);
        assert!(loaded.config.bd_path.is_none());
        assert!(loaded.config.last_workspace_path.is_none());
        assert!(loaded.config.workspaces.is_empty());
        assert!(loaded.corrupt_backup.is_none());
    }

    #[test]
    fn save_round_trips_through_camel_case_json() {
        let dir = temp_dir("roundtrip");
        let path = dir.join("config.json");
        let mut config = AppConfig {
            bd_path: Some("C:/tools/bd.exe".to_owned()),
            ..AppConfig::default()
        };
        config.add_workspace(entry("D:/repo one", "p1", NOW));

        save_atomic(&path, &config).expect("save config");
        let text = fs::read_to_string(&path).expect("read config");

        assert!(text.contains("\"schemaVersion\""), "{text}");
        assert!(text.contains("\"projectId\""), "{text}");
        assert!(text.contains("\"lastOpenedAt\""), "{text}");
        assert!(text.contains("\"bdPath\""), "{text}");
        assert!(text.contains("\"isWorktree\""), "{text}");
        assert!(text.contains("\"language\": \"en\""), "{text}");

        let loaded = load(&path).expect("reload config");
        assert_eq!(loaded.config.workspaces, config.workspaces);
        assert_eq!(loaded.config.bd_path, config.bd_path);
    }

    #[test]
    fn corrupt_config_is_renamed_aside_and_defaults_are_returned() {
        let dir = temp_dir("corrupt");
        let path = dir.join("config.json");
        fs::write(&path, "{not json").expect("write corrupt config");

        let loaded = load(&path).expect("load corrupt config");
        let backup = loaded.corrupt_backup.expect("backup path");

        assert!(loaded.config.workspaces.is_empty());
        assert!(!path.exists());
        assert!(backup.exists());
        assert_eq!(
            fs::read_to_string(&backup).expect("read backup"),
            "{not json"
        );
        let name = backup
            .file_name()
            .expect("backup name")
            .to_string_lossy()
            .into_owned();
        assert!(name.starts_with("config.corrupt-"), "{name}");
        assert!(name.ends_with(".json"), "{name}");
    }

    #[test]
    fn save_is_atomic_and_leaves_no_temporary_file() {
        let dir = temp_dir("atomic");
        let path = dir.join("config.json");
        let config = AppConfig::default();

        save_atomic(&path, &config).expect("save config");
        save_atomic(&path, &config).expect("overwrite config");

        let names: Vec<String> = fs::read_dir(&dir)
            .expect("read dir")
            .map(|item| {
                item.expect("dir entry")
                    .file_name()
                    .to_string_lossy()
                    .into()
            })
            .collect();
        assert_eq!(names, vec!["config.json".to_owned()]);
    }

    #[test]
    fn duplicate_workspaces_are_detected_across_path_spellings() {
        let mut config = AppConfig::default();
        assert_eq!(
            config.add_workspace(entry("D:/Repo/One", "p1", NOW)),
            AddOutcome::Added(0)
        );

        let duplicate = entry("d:\\repo\\one\\", "p1", LATER);
        assert_eq!(config.add_workspace(duplicate), AddOutcome::Existing(0));
        assert_eq!(config.workspaces.len(), 1);
    }

    #[test]
    fn checkpoint_survives_only_for_the_same_project_id() {
        let mut config = AppConfig::default();
        config.add_workspace(with_checkpoint(entry("D:/repo", "p1", NOW), 42));

        assert_eq!(
            config
                .checkpoint_for("D:/repo", "p1")
                .map(|checkpoint| checkpoint.seq),
            Some(42)
        );
        assert!(config.checkpoint_for("D:/repo", "p2").is_none());
    }

    #[test]
    fn project_id_change_discards_the_checkpoint() {
        let mut config = AppConfig::default();
        config.add_workspace(with_checkpoint(entry("D:/repo", "p1", NOW), 42));

        let discarded = config.workspaces[0].apply_identity("p2", true);

        assert!(discarded);
        assert_eq!(config.workspaces[0].project_id, "p2");
        assert!(config.workspaces[0].is_worktree);
        assert!(config.workspaces[0].checkpoint.is_none());
        assert!(!config.workspaces[0].apply_identity("p2", true));
    }

    #[test]
    fn checkpoint_is_written_back_for_the_current_workspace() {
        let mut config = AppConfig::default();
        config.add_workspace(entry("D:/repo", "p1", NOW));

        assert!(config.set_checkpoint(
            "d:\\repo\\",
            Checkpoint {
                seq: 7,
                saved_at: LATER.to_owned(),
            }
        ));
        assert!(!config.set_checkpoint(
            "D:/other",
            Checkpoint {
                seq: 8,
                saved_at: LATER.to_owned(),
            }
        ));
        assert_eq!(
            config
                .checkpoint_for("D:/repo", "p1")
                .map(|checkpoint| checkpoint.seq),
            Some(7)
        );
    }

    #[test]
    fn missing_workspace_directories_are_flagged() {
        let existing = temp_dir("exists");
        let mut config = AppConfig::default();
        config.add_workspace(entry(existing.to_str().expect("utf-8 path"), "p1", NOW));
        config.add_workspace(entry("D:/definitely/not/here", "p2", NOW));

        let missing = config.missing_workspaces();
        assert_eq!(missing.len(), 1);
        assert_eq!(missing[0].path, "D:/definitely/not/here");
    }

    #[test]
    fn switching_updates_last_opened_and_last_workspace() {
        let mut config = AppConfig::default();
        config.add_workspace(entry("D:/one", "p1", NOW));
        config.add_workspace(entry("D:/two", "p2", NOW));

        assert!(config.switch_workspace("d:\\two\\", LATER));

        assert_eq!(config.last_workspace_path.as_deref(), Some("D:/two"));
        assert_eq!(config.workspaces[1].last_opened_at, LATER);
        assert_eq!(
            config
                .open_last_workspace()
                .map(|entry| entry.path.as_str()),
            Some("D:/two")
        );
    }

    #[test]
    fn switching_to_an_unknown_workspace_is_rejected() {
        let mut config = AppConfig::default();
        config.add_workspace(entry("D:/one", "p1", NOW));

        assert!(!config.switch_workspace("D:/missing", LATER));
        assert!(config.last_workspace_path.is_none());
        assert_eq!(config.workspaces[0].last_opened_at, NOW);
    }

    #[test]
    fn removing_the_last_workspace_clears_last_workspace_path() {
        let mut config = AppConfig::default();
        config.add_workspace(entry("D:/one", "p1", NOW));
        config.switch_workspace("D:/one", LATER);

        let removed = config.remove_workspace("D:/one");

        assert!(removed.is_some());
        assert!(config.workspaces.is_empty());
        assert!(config.last_workspace_path.is_none());
        assert!(config.remove_workspace("D:/one").is_none());
    }

    #[test]
    fn relocating_a_workspace_keeps_its_name_and_clears_the_checkpoint() {
        let mut config = AppConfig::default();
        let mut original = with_checkpoint(entry("D:/old", "p1", NOW), 12);
        original.name = "my project".to_owned();
        config.add_workspace(original);

        let moved = with_checkpoint(entry("D:/new", "p9", LATER), 12);
        assert_eq!(config.relocate_workspace("d:\\old", moved), Some(0));

        assert_eq!(config.workspaces[0].path, "D:/new");
        assert_eq!(config.workspaces[0].name, "my project");
        assert_eq!(config.workspaces[0].project_id, "p9");
        assert!(config.workspaces[0].checkpoint.is_none());
    }

    #[test]
    fn the_registry_never_stores_secret_fields() {
        let mut config = AppConfig {
            bd_path: Some("C:/tools/bd.exe".to_owned()),
            ..AppConfig::default()
        };
        config.add_workspace(with_checkpoint(entry("D:/repo", "p1", NOW), 3));

        let document = serde_json::to_value(&config).expect("serialize config");
        let allowed = [
            "schemaVersion",
            "bdPath",
            "language",
            "theme",
            "lastWorkspacePath",
            "workspaces",
            "path",
            "name",
            "projectId",
            "isWorktree",
            "lastOpenedAt",
            "checkpoint",
            "seq",
            "savedAt",
        ];
        let mut keys = Vec::new();
        collect_keys(&document, &mut keys);

        for key in keys {
            assert!(
                allowed.contains(&key.as_str()),
                "unexpected config key {key}"
            );
            let lower = key.to_lowercase();
            assert!(
                !["token", "password", "secret", "credential", "api_key"]
                    .iter()
                    .any(|needle| lower.contains(needle)),
                "secret-looking config key {key}"
            );
        }
    }

    fn collect_keys(value: &serde_json::Value, keys: &mut Vec<String>) {
        match value {
            serde_json::Value::Object(fields) => {
                for (key, child) in fields {
                    keys.push(key.clone());
                    collect_keys(child, keys);
                }
            }
            serde_json::Value::Array(items) => {
                for item in items {
                    collect_keys(item, keys);
                }
            }
            _ => {}
        }
    }
}
