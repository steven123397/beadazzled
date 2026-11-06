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
use beadazzled_lib::workspace::registry::{self, AppConfig, Language, Theme};

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
    let other = workspace_named(&dir, "other");
    let service = service(&dir.join("config.json"));
    let with_separator = format!("{}\\", path_string(&workspace));

    service
        .add_workspace(&path_string(&workspace))
        .expect("first add");
    service
        .add_workspace(&path_string(&other))
        .expect("add another");
    service
        .switch_workspace(&path_string(&other))
        .expect("switch away");
    assert_eq!(
        service.snapshot().active.as_deref(),
        Some(path_string(&other).as_str())
    );

    // Adding a path that is already registered only switches to it.
    service.add_workspace(&with_separator).expect("second add");

    assert_eq!(service.snapshot().config.workspaces.len(), 2);
    assert_eq!(
        service.snapshot().active.as_deref(),
        Some(path_string(&workspace).as_str())
    );
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
    // Removing is a registry operation only; the repository is untouched.
    assert!(first.is_dir());
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
fn a_missing_workspace_still_wins_over_an_unavailable_bd() {
    let dir = common::temp_dir("cmd-switch-missing-no-bd");
    let first = common::workspace(&dir);
    let second = workspace_named(&dir, "second");
    let config_path = dir.join("config.json");

    let service = service(&config_path);
    service
        .add_workspace(&path_string(&first))
        .expect("add first");
    service
        .add_workspace(&path_string(&second))
        .expect("add second");
    service.flush().expect("flush config");

    // Point bd at a plain text file. Discovery probes the configured path
    // first and reports Broken instead of falling back to PATH, so bd is
    // unavailable without touching process-global environment state.
    let decoy = dir.join("not-bd.txt");
    fs::write(&decoy, b"not an executable").expect("write decoy");
    let mut config = registry::load(&config_path).expect("load config").config;
    config.bd_path = Some(decoy.display().to_string());
    registry::save_atomic(&config_path, &config).expect("save config");

    let reopened = WorkspaceService::open(&config_path).expect("reopen service");
    assert!(
        !matches!(reopened.bd_status(false), BdStatus::Ready { .. }),
        "bd must be unavailable for this test"
    );
    fs::remove_dir_all(&first).expect("remove first");

    // The directory check must come first: a missing workspace is reported as
    // WS_INACCESSIBLE even when bd itself would fail to resolve.
    let error = reopened
        .switch_workspace(&path_string(&first))
        .expect_err("missing workspace is refused");

    assert_eq!(error.code, BridgeErrorCode::WsInaccessible);
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
fn re_adding_a_recreated_workspace_refreshes_its_identity() {
    let dir = common::temp_dir("cmd-readd-identity");
    let workspace = common::workspace(&dir);
    fs::write(workspace.join("project-id"), "project-one").expect("write identity");
    let service = service(&dir.join("config.json"));
    let path = path_string(&workspace);
    service.add_workspace(&path).expect("add");
    service.set_checkpoint(&path, 42);
    assert_eq!(
        service.checkpoint(&path, "project-one").map(|c| c.seq),
        Some(42)
    );

    fs::write(workspace.join("project-id"), "project-two").expect("replace identity");
    let entry = service.add_workspace(&path).expect("re-add");

    assert_eq!(entry.project_id, "project-two");
    assert_eq!(
        service.checkpoint(&path, "project-two"),
        None,
        "a new project must not inherit the old journal position"
    );
    assert_eq!(service.checkpoint(&path, "project-one"), None);
    assert_eq!(
        service.snapshot().config.workspaces[0].project_id,
        "project-two"
    );
}

#[test]
fn switching_to_a_recreated_workspace_refreshes_its_identity() {
    let dir = common::temp_dir("cmd-switch-identity");
    let first = common::workspace(&dir);
    let second = workspace_named(&dir, "second");
    fs::write(first.join("project-id"), "project-one").expect("write identity");
    fs::write(second.join("project-id"), "project-other").expect("write identity");
    let service = service(&dir.join("config.json"));
    service
        .add_workspace(&path_string(&first))
        .expect("add first");
    service
        .add_workspace(&path_string(&second))
        .expect("add second");
    service.set_checkpoint(&path_string(&first), 42);

    fs::write(first.join("project-id"), "project-two").expect("replace identity");
    let entry = service
        .switch_workspace(&path_string(&first))
        .expect("switch");

    assert_eq!(entry.project_id, "project-two");
    assert_eq!(
        service.checkpoint(&path_string(&first), "project-two"),
        None
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

#[test]
fn preferences_are_written_without_touching_the_rest_of_the_config() {
    let dir = common::temp_dir("cmd-preferences");
    let workspace = common::workspace(&dir);
    let config_path = dir.join("config.json");
    let service = service(&config_path);
    service
        .add_workspace(&path_string(&workspace))
        .expect("add workspace");
    let before = service.snapshot().config;

    let written = service
        .set_preferences(Language::ZhCn, Theme::Dark)
        .expect("save preferences");

    assert_eq!(written.language, Language::ZhCn);
    assert_eq!(written.theme, Theme::Dark);
    assert_eq!(written.bd_path, before.bd_path);
    assert_eq!(written.workspaces, before.workspaces);

    service.flush().expect("flush config");
    let reloaded = registry::load(&config_path).expect("load config").config;
    assert_eq!(reloaded.language, Language::ZhCn);
    assert_eq!(reloaded.theme, Theme::Dark);
    assert_eq!(reloaded.bd_path, before.bd_path);
    assert_eq!(reloaded.workspaces, before.workspaces);
}

#[test]
fn a_failed_preference_save_is_not_acknowledged() {
    let dir = common::temp_dir("cmd-preferences-save-fails");
    let config_path = dir.join("config.json");
    let writer = ConfigWriter::with_saver(
        config_path.clone(),
        Duration::from_millis(60_000),
        Arc::new(|_path, _config| Err(std::io::Error::other("disk is read-only"))),
    );
    let service =
        WorkspaceService::open_with_writer(config_path, Arc::clone(&writer)).expect("open service");

    let error = service
        .set_preferences(Language::ZhCn, Theme::Dark)
        .expect_err("a failed save must not resolve as success");

    assert!(
        error.message.contains("disk is read-only"),
        "unexpected message: {}",
        error.message
    );
}

#[test]
fn an_unusable_bd_path_is_rejected_and_the_previous_one_stays() {
    let dir = common::temp_dir("cmd-bd-path-reject");
    let config_path = dir.join("config.json");
    let service = service(&config_path);
    let before = service.snapshot().config.bd_path;
    assert!(before.is_some());

    let missing = dir.join("missing-bd.exe").display().to_string();
    let status = service.set_bd_path(Some(missing));

    assert!(
        !matches!(status, BdStatus::Ready { .. }),
        "an unusable path must not be reported ready: {status:?}"
    );
    assert_eq!(service.snapshot().config.bd_path, before);

    service.flush().expect("flush config");
    let reloaded = registry::load(&config_path).expect("load config").config;
    assert_eq!(reloaded.bd_path, before);
}

#[test]
fn a_whitespace_bd_path_is_treated_as_a_clear() {
    let dir = common::temp_dir("cmd-bd-path-blank");
    let config_path = dir.join("config.json");
    let service = service(&config_path);
    assert!(service.snapshot().config.bd_path.is_some());

    service.set_bd_path(Some("   ".to_owned()));

    assert_eq!(service.snapshot().config.bd_path, None);
}

#[test]
fn a_new_valid_bd_path_is_persisted() {
    let dir = common::temp_dir("cmd-bd-path-accept");
    let config_path = dir.join("config.json");
    let service = WorkspaceService::open(&config_path).expect("open service");
    assert_eq!(service.snapshot().config.bd_path, None);

    let bd = common::fake_bd_path().display().to_string();
    let status = service.set_bd_path(Some(bd.clone()));

    assert!(matches!(status, BdStatus::Ready { .. }));
    assert_eq!(service.snapshot().config.bd_path, Some(bd.clone()));

    service.flush().expect("flush config");
    let reloaded = registry::load(&config_path).expect("load config").config;
    assert_eq!(reloaded.bd_path, Some(bd));
}

#[test]
fn clearing_the_bd_path_falls_back_to_path_lookup() {
    let dir = common::temp_dir("cmd-bd-path-clear");
    let config_path = dir.join("config.json");
    let service = service(&config_path);
    assert!(service.snapshot().config.bd_path.is_some());

    service.set_bd_path(None);

    assert_eq!(service.snapshot().config.bd_path, None);
    service.flush().expect("flush config");
    let reloaded = registry::load(&config_path).expect("load config").config;
    assert_eq!(reloaded.bd_path, None);
}

/// PATH is process-global, so the test that swaps it serialises with itself.
static PATH_GUARD: StdMutex<()> = StdMutex::new(());

#[test]
fn clearing_the_bd_path_resolves_bd_from_path() {
    let _guard = PATH_GUARD
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    let dir = common::temp_dir("cmd-bd-path-clear-resolves");
    let config_path = dir.join("config.json");
    let service = service(&config_path);
    assert!(service.snapshot().config.bd_path.is_some());

    let bin_dir = dir.join("path-bin");
    fs::create_dir_all(&bin_dir).expect("create path dir");
    let on_path = bin_dir.join(if cfg!(windows) { "bd.exe" } else { "bd" });
    fs::copy(common::fake_bd_path(), &on_path).expect("copy the fake bd onto PATH");

    let previous = std::env::var_os("PATH");
    std::env::set_var("PATH", std::env::join_paths([&bin_dir]).expect("join PATH"));
    let status = service.set_bd_path(None);
    match &previous {
        Some(value) => std::env::set_var("PATH", value),
        None => std::env::remove_var("PATH"),
    }

    match status {
        BdStatus::Ready { path, .. } => {
            assert!(
                Path::new(&path).starts_with(&bin_dir),
                "the PATH copy is what must resolve, got {path}"
            );
        }
        other => panic!("expected a ready status from PATH, got {other:?}"),
    }
    assert_eq!(service.snapshot().config.bd_path, None);
    assert!(
        matches!(service.bd_status(false), BdStatus::Ready { .. }),
        "the stored discovery must agree with the status just returned"
    );
}
