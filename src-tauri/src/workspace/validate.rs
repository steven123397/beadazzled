//! Workspace validation through `bd context --json`.
//!
//! A directory is only added after bd confirms it is a beads workspace and
//! reports its `repo_root`; the caller then registers the entry. Nothing here
//! touches the registry, so a rejected directory can never mutate it.

use std::path::Path;

use super::registry::{workspace_name, WorkspaceEntry};
use crate::bridge::{BdBridge, BridgeError, WorkspaceContext};

/// A directory bd confirmed as a beads workspace.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedWorkspace {
    /// `repo_root` reported by bd; the canonical path stored in the registry.
    pub repo_root: String,
    pub project_id: String,
    pub is_worktree: bool,
}

impl ValidatedWorkspace {
    /// Converts the validated identity into a fresh registry entry.
    pub fn into_entry(self, now: impl Into<String>) -> WorkspaceEntry {
        WorkspaceEntry {
            name: workspace_name(&self.repo_root),
            path: self.repo_root,
            project_id: self.project_id,
            is_worktree: self.is_worktree,
            last_opened_at: now.into(),
            checkpoint: None,
        }
    }
}

/// Runs `bd -C <directory> context --json` and extracts the workspace identity.
///
/// `WS_NOT_BEADS` and `WS_INACCESSIBLE` come back as bridge errors; the caller
/// shows the reason and leaves the registry untouched.
pub fn validate_workspace(
    bd_path: &Path,
    directory: &Path,
) -> Result<ValidatedWorkspace, BridgeError> {
    let bridge = BdBridge::new(bd_path.to_path_buf(), directory.to_path_buf());
    let context = bridge.context()?;
    Ok(from_context(&context, directory))
}

fn from_context(context: &WorkspaceContext, directory: &Path) -> ValidatedWorkspace {
    let repo_root = context
        .extra
        .get_str("repo_root")
        .map(str::trim)
        .filter(|root| !root.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| directory.to_string_lossy().into_owned());
    let is_worktree = context.extra.get_bool("is_worktree").unwrap_or(false);

    ValidatedWorkspace {
        repo_root,
        project_id: context.project_id.clone(),
        is_worktree,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bridge::WorkspaceContext;
    use serde_json::{Map, Value};
    use std::path::Path;

    fn context(extra: &[(&str, Value)]) -> WorkspaceContext {
        let mut fields = Map::new();
        for (key, value) in extra {
            fields.insert((*key).to_owned(), value.clone());
        }
        WorkspaceContext {
            project_id: "p1".to_owned(),
            bd_version: "1.3.2".to_owned(),
            dolt_mode: "embedded".to_owned(),
            schema_version: 1,
            extra: crate::bridge::types::ExtraFields(fields),
        }
    }

    #[test]
    fn repo_root_wins_over_the_selected_subdirectory() {
        let validated = from_context(
            &context(&[("repo_root", Value::String("D:/repo".to_owned()))]),
            Path::new("D:/repo/packages/app"),
        );

        assert_eq!(validated.repo_root, "D:/repo");
        assert_eq!(validated.project_id, "p1");
    }

    #[test]
    fn a_missing_repo_root_falls_back_to_the_selected_directory() {
        let validated = from_context(&context(&[]), Path::new("D:/plain/dir"));

        assert_eq!(validated.repo_root, "D:/plain/dir");
    }

    #[test]
    fn a_blank_repo_root_falls_back_to_the_selected_directory() {
        let validated = from_context(
            &context(&[("repo_root", Value::String("   ".to_owned()))]),
            Path::new("D:/plain/dir"),
        );

        assert_eq!(validated.repo_root, "D:/plain/dir");
    }

    #[test]
    fn the_worktree_flag_is_read_from_the_context() {
        let validated = from_context(
            &context(&[
                ("repo_root", Value::String("D:/wt".to_owned())),
                ("is_worktree", Value::Bool(true)),
            ]),
            Path::new("D:/wt"),
        );

        assert!(validated.is_worktree);
    }

    #[test]
    fn the_entry_uses_the_repo_root_name_and_timestamp() {
        let validated = from_context(
            &context(&[("repo_root", Value::String("D:/work/my repo".to_owned()))]),
            Path::new("D:/work/my repo"),
        );

        let entry = validated.into_entry("2026-11-01T00:00:00Z");

        assert_eq!(entry.path, "D:/work/my repo");
        assert_eq!(entry.name, "my repo");
        assert_eq!(entry.project_id, "p1");
        assert!(entry.checkpoint.is_none());
        assert_eq!(entry.last_opened_at, "2026-11-01T00:00:00Z");
    }
}
