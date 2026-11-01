//! Workspace validation against `examples/fake_bd`.
//!
//! A real `bd` is never spawned; the fake prints the recorded `context.json`
//! with the requested workspace substituted for `<workspace>`.

mod common;

use std::fs;
use std::path::{Path, PathBuf};

use beadazzled_lib::bridge::BridgeErrorCode;
use beadazzled_lib::workspace::validate::validate_workspace;

fn workspace_named(dir: &Path, name: &str) -> PathBuf {
    let workspace = dir.join(name);
    fs::create_dir_all(&workspace).expect("create workspace");
    workspace
}

#[test]
fn validates_a_workspace_through_bd_context() {
    let dir = common::temp_dir("ws-validate");
    let workspace = common::workspace(&dir);

    let validated =
        validate_workspace(&common::fake_bd_path(), &workspace).expect("workspace validates");

    assert_eq!(validated.project_id, "00000000-0000-4000-8000-000000000000");
    assert_eq!(validated.repo_root, workspace.display().to_string());
    assert!(!validated.is_worktree);
}

#[test]
fn a_plain_directory_is_rejected_as_not_beads() {
    let dir = common::temp_dir("ws-not-beads");
    let workspace = workspace_named(&dir, "not-beads here");

    let error = validate_workspace(&common::fake_bd_path(), &workspace)
        .expect_err("a plain directory must be rejected");

    assert_eq!(error.code, BridgeErrorCode::WsNotBeads);
}

#[test]
fn paths_with_spaces_and_unicode_round_trip() {
    let dir = common::temp_dir("ws-unicode");
    let workspace = workspace_named(&dir, "工作 区");

    let validated =
        validate_workspace(&common::fake_bd_path(), &workspace).expect("workspace validates");

    assert_eq!(validated.repo_root, workspace.display().to_string());
}
