//! Workspace service tests through `examples/fake_bd`.
//!
//! These cover the command layer end to end minus Tauri: discovery, add,
//! switch, relocate, checkpoints, restart recovery and corrupt configs.

mod common;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex as StdMutex};
use std::time::Duration;

use beadazzled_lib::bridge::{BridgeErrorCode, UpdateSpec, WriteCommand};
use beadazzled_lib::commands::config_writer::ConfigWriter;
use beadazzled_lib::commands::WorkspaceService;
use beadazzled_lib::workspace::discovery::BdStatus;
use beadazzled_lib::workspace::registry::{self, AppConfig};

const PROJECT_ID: &str = "00000000-0000-4000-8000-000000000000";

fn service(config_path: &Path) -> WorkspaceService {
    let service = WorkspaceService::open(config_path).expect("open workspace service");
    service.set_bd_path(Some(common::fake_bd_path().display().to_string()));
    service
}

fn workspace_named(dir: &Path, name: &str) -> PathBuf {
    let workspace = dir.join(name);
    fs::create_dir_all(&workspace).expect("create workspace");
    workspace
}

fn path_string(path: &Path) -> String {
    path.display().to_string()
}

#[test]
fn a_paused_queue_cannot_put_an_older_snapshot_last() {
    let dir = common::temp_dir("cmd-queue-order");
    let workspace = common::workspace(&dir);
    let config_path = dir.join("config.json");
    let saved = Arc::new(StdMutex::new(Vec::<AppConfig>::new()));

    let (entered_tx, entered_rx) = mpsc::channel::<()>();
    let (release_tx, release_rx) = mpsc::channel::<()>();
    let entered_tx = Arc::new(StdMutex::new(Some(entered_tx)));
    let release_rx = Arc::new(StdMutex::new(release_rx));

    let capture = Arc::clone(&saved);
    let writer = ConfigWriter::with_saver(
        config_path.clone(),
        Duration::from_secs(60),
        Arc::new(move |_path, config| {
            capture.lock().unwrap().push(config.clone());
            Ok(())
        }),
    );
    let service =
        WorkspaceService::open_with_writer(config_path, Arc::clone(&writer)).expect("open service");
    service.set_bd_path(Some(common::fake_bd_path().display().to_string()));
    let path = path_string(&workspace);
    service.add_workspace(&path).expect("add workspace");

    // Hold the next queue call (the first checkpoint) until released.
    writer.set_queue_hook(Some(Arc::new(move || {
        let taken = entered_tx.lock().unwrap().take();
        if let Some(tx) = taken {
            tx.send(()).expect("signal the queue was entered");
            release_rx.lock().unwrap().recv().expect("wait for release");
        }
    })));

    let service = Arc::new(service);
    let first = {
        let service = Arc::clone(&service);
        let path = path.clone();
        std::thread::spawn(move || service.set_checkpoint(&path, 1))
    };
    entered_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("the first queue call started");

    let second = {
        let service = Arc::clone(&service);
        let path = path.clone();
        std::thread::spawn(move || service.set_checkpoint(&path, 2))
    };
    // The second mutation must wait behind the first one's state lock.
    std::thread::sleep(Duration::from_millis(150));
    release_tx.send(()).expect("release the first queue call");

    assert!(first.join().expect("first checkpoint thread"));
    assert!(second.join().expect("second checkpoint thread"));
    service.flush().expect("flush");

    let saved = saved.lock().unwrap().clone();
    let last_seq = saved
        .last()
        .and_then(|config| config.workspaces[0].checkpoint.as_ref())
        .map(|checkpoint| checkpoint.seq);
    assert_eq!(
        last_seq,
        Some(2),
        "the later mutation must be the one that lands: {saved:?}"
    );
}

#[test]
fn the_configured_fake_bd_is_reported_ready() {
    let dir = common::temp_dir("cmd-status");
    let service = service(&dir.join("config.json"));

    let status = service.bd_status(false);

    assert!(matches!(status, BdStatus::Ready { .. }), "{status:?}");
}

#[test]
fn adding_a_workspace_persists_it_and_opens_it() {
    let dir = common::temp_dir("cmd-add");
    let config_path = dir.join("config.json");
    let workspace = common::workspace(&dir);
    let service = service(&config_path);

    let entry = service
        .add_workspace(&path_string(&workspace))
        .expect("workspace is added");

    assert_eq!(entry.path, path_string(&workspace));
    assert_eq!(entry.project_id, PROJECT_ID);
    assert_eq!(
        service.snapshot().active.as_deref(),
        Some(entry.path.as_str())
    );

    service.flush().expect("flush");
    let reloaded = registry::load(&config_path).expect("reload").config;
    assert_eq!(reloaded.workspaces.len(), 1);
    assert_eq!(reloaded.workspaces[0].path, path_string(&workspace));
    assert_eq!(
        reloaded.last_workspace_path.as_deref(),
        Some(path_string(&workspace).as_str())
    );
}

#[test]
fn a_plain_directory_is_rejected_and_not_registered() {
    let dir = common::temp_dir("cmd-not-beads");
    let config_path = dir.join("config.json");
    let plain = workspace_named(&dir, "not-beads here");
    let service = service(&config_path);

    let error = service
        .add_workspace(&path_string(&plain))
        .expect_err("a plain directory is rejected");

    assert_eq!(error.code, BridgeErrorCode::WsNotBeads);
    assert!(service.snapshot().config.workspaces.is_empty());
    service.flush().expect("flush");
    assert!(registry::load(&config_path)
        .expect("reload")
        .config
        .workspaces
        .is_empty());
}

#[test]
fn adding_the_same_workspace_twice_does_not_duplicate_it() {
    let dir = common::temp_dir("cmd-dedupe");
    let workspace = common::workspace(&dir);
    let service = service(&dir.join("config.json"));
    let with_separator = format!("{}\\", path_string(&workspace));

    service
        .add_workspace(&path_string(&workspace))
        .expect("first add");
    service.add_workspace(&with_separator).expect("second add");

    assert_eq!(service.snapshot().config.workspaces.len(), 1);
}

#[test]
fn switching_and_removing_update_the_active_workspace() {
    let dir = common::temp_dir("cmd-switch");
    let first = common::workspace(&dir);
    let second = workspace_named(&dir, "second");
    let service = service(&dir.join("config.json"));
    service
        .add_workspace(&path_string(&first))
        .expect("add first");
    service
        .add_workspace(&path_string(&second))
        .expect("add second");

    service
        .switch_workspace(&path_string(&first))
        .expect("switch");
    assert_eq!(
        service.snapshot().active.as_deref(),
        Some(path_string(&first).as_str())
    );

    assert!(service.remove_workspace(&path_string(&first)));
    assert!(service.snapshot().active.is_none());
    assert_eq!(service.snapshot().config.workspaces.len(), 1);
    assert!(!service.remove_workspace(&path_string(&first)));
}

#[test]
fn relocating_keeps_the_name_and_the_checkpoint_for_the_same_project() {
    let dir = common::temp_dir("cmd-relocate");
    let old = common::workspace(&dir);
    let new = workspace_named(&dir, "moved");
    let service = service(&dir.join("config.json"));
    service.add_workspace(&path_string(&old)).expect("add");
    service.set_checkpoint(&path_string(&old), 42);

    let moved = service
        .relocate_workspace(&path_string(&old), &path_string(&new))
        .expect("relocate");

    assert_eq!(moved.path, path_string(&new));
    assert_eq!(moved.name, "workspace");
    assert_eq!(moved.checkpoint.map(|checkpoint| checkpoint.seq), Some(42));
    assert_eq!(
        service
            .checkpoint(&path_string(&new), PROJECT_ID)
            .map(|checkpoint| checkpoint.seq),
        Some(42)
    );
}

#[test]
fn relocating_onto_a_registered_workspace_collapses_the_entries() {
    let dir = common::temp_dir("cmd-relocate-duplicate");
    let first = common::workspace(&dir);
    let second = workspace_named(&dir, "second");
    let service = service(&dir.join("config.json"));
    service
        .add_workspace(&path_string(&first))
        .expect("add first");
    service
        .add_workspace(&path_string(&second))
        .expect("add second");

    let moved = service
        .relocate_workspace(&path_string(&first), &path_string(&second))
        .expect("relocate onto a registered path");

    assert_eq!(moved.path, path_string(&second));
    let snapshot = service.snapshot();
    assert_eq!(
        snapshot.config.workspaces.len(),
        1,
        "one entry per directory, even after a relocate"
    );
    assert_eq!(
        snapshot.active.as_deref(),
        Some(path_string(&second).as_str())
    );
}

#[test]
fn checkpoints_only_apply_to_the_matching_project_id() {
    let dir = common::temp_dir("cmd-checkpoint");
    let workspace = common::workspace(&dir);
    let service = service(&dir.join("config.json"));
    service
        .add_workspace(&path_string(&workspace))
        .expect("add");

    assert!(service.set_checkpoint(&path_string(&workspace), 7));

    assert_eq!(
        service
            .checkpoint(&path_string(&workspace), PROJECT_ID)
            .map(|checkpoint| checkpoint.seq),
        Some(7)
    );
    assert!(service
        .checkpoint(&path_string(&workspace), "another-project")
        .is_none());
    assert!(!service.set_checkpoint("D:/not/registered", 1));
}

#[test]
fn a_restart_reopens_the_last_workspace() {
    let dir = common::temp_dir("cmd-restart");
    let config_path = dir.join("config.json");
    let workspace = common::workspace(&dir);
    let service = service(&config_path);
    service
        .add_workspace(&path_string(&workspace))
        .expect("add");
    service.flush().expect("flush");
    drop(service);

    let reopened = WorkspaceService::open(&config_path).expect("reopen");

    let snapshot = reopened.snapshot();
    assert_eq!(snapshot.config.workspaces.len(), 1);
    assert_eq!(
        snapshot.active.as_deref(),
        Some(path_string(&workspace).as_str())
    );
    assert!(matches!(reopened.bd_status(false), BdStatus::Ready { .. }));
}

#[test]
fn a_corrupt_config_is_backed_up_and_reported() {
    let dir = common::temp_dir("cmd-corrupt");
    let config_path = dir.join("config.json");
    fs::write(&config_path, "{this is not json").expect("write corrupt config");

    let service = WorkspaceService::open(&config_path).expect("open");

    let snapshot = service.snapshot();
    let backup = snapshot.corrupt_backup.expect("backup path");
    assert!(Path::new(&backup).exists());
    assert!(!config_path.exists());
    assert!(snapshot.config.workspaces.is_empty());
}

#[test]
fn a_deleted_workspace_directory_is_reported_as_missing() {
    let dir = common::temp_dir("cmd-missing");
    let workspace = common::workspace(&dir);
    let service = service(&dir.join("config.json"));
    service
        .add_workspace(&path_string(&workspace))
        .expect("add");

    fs::remove_dir_all(&workspace).expect("remove workspace");

    assert_eq!(service.snapshot().missing, vec![path_string(&workspace)]);
}

#[test]
fn switching_to_a_missing_workspace_fails_without_mutating_the_registry() {
    let dir = common::temp_dir("cmd-switch-missing");
    let first = common::workspace(&dir);
    let second = workspace_named(&dir, "second");
    let service = service(&dir.join("config.json"));
    service
        .add_workspace(&path_string(&first))
        .expect("add first");
    service
        .add_workspace(&path_string(&second))
        .expect("add second");
    fs::remove_dir_all(&first).expect("remove first");

    let error = service
        .switch_workspace(&path_string(&first))
        .expect_err("missing workspace is refused");

    assert_eq!(error.code, BridgeErrorCode::WsInaccessible);
    assert_eq!(
        service.snapshot().active.as_deref(),
        Some(path_string(&second).as_str())
    );
}

#[test]
fn the_bd_path_is_persisted_for_the_next_run() {
    let dir = common::temp_dir("cmd-bd-path");
    let config_path = dir.join("config.json");
    let service = service(&config_path);

    service.flush().expect("flush");

    let reloaded = registry::load(&config_path).expect("reload").config;
    assert_eq!(
        reloaded.bd_path.as_deref(),
        Some(common::fake_bd_path().display().to_string().as_str())
    );
}

#[test]
fn writes_run_against_the_submitted_workspace() {
    let dir = common::temp_dir("cmd-write");
    let first = common::workspace(&dir);
    let second = workspace_named(&dir, "second");
    // This workspace refuses writes; the active one does not.
    fs::write(first.join("reject-write"), b"").expect("mark the first workspace");
    let service = service(&dir.join("config.json"));
    service
        .add_workspace(&path_string(&first))
        .expect("add first");
    service
        .add_workspace(&path_string(&second))
        .expect("add second");

    let error = service
        .write(
            &path_string(&first),
            &WriteCommand::Update(UpdateSpec::new("fx-1")),
        )
        .expect_err("the write ran in the submitted workspace, not the active one");
    assert_eq!(error.code, BridgeErrorCode::WriteConflict);

    let outcome = service
        .write(
            &path_string(&second),
            &WriteCommand::Update(UpdateSpec::new("fx-1")),
        )
        .expect("write succeeds");
    assert_eq!(outcome.exit_code, 0);
    assert!(outcome.created_id.is_none());
}

#[test]
fn exit_13_maps_to_a_write_conflict() {
    let dir = common::temp_dir("cmd-write-conflict");
    let workspace = common::workspace(&dir);
    let service = service(&dir.join("config.json"));
    service
        .add_workspace(&path_string(&workspace))
        .expect("add");

    let error = service
        .write(
            &path_string(&workspace),
            &WriteCommand::Update(UpdateSpec::new("stale")),
        )
        .expect_err("exit 13 is a conflict");

    assert_eq!(error.code, BridgeErrorCode::WriteConflict);
}

#[test]
fn writing_to_an_unregistered_workspace_is_refused() {
    let dir = common::temp_dir("cmd-write-unregistered");
    let workspace = common::workspace(&dir);
    let service = service(&dir.join("config.json"));

    let error = service
        .write(
            &path_string(&workspace),
            &WriteCommand::Update(UpdateSpec::new("fx-1")),
        )
        .expect_err("an unregistered workspace is not writable");

    assert_eq!(error.code, BridgeErrorCode::Internal);
    assert!(error.message.contains("not registered"));
}

#[test]
fn writing_to_a_vanished_workspace_is_refused() {
    let dir = common::temp_dir("cmd-write-missing");
    let workspace = common::workspace(&dir);
    let service = service(&dir.join("config.json"));
    service
        .add_workspace(&path_string(&workspace))
        .expect("add");
    fs::remove_dir_all(&workspace).expect("remove workspace");

    let error = service
        .write(
            &path_string(&workspace),
            &WriteCommand::Update(UpdateSpec::new("fx-1")),
        )
        .expect_err("a missing workspace is refused");

    assert_eq!(error.code, BridgeErrorCode::WsInaccessible);
}
