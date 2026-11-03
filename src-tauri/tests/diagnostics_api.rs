//! Diagnostics report tests through `examples/fake_bd`.
//!
//! The report is the only settings surface allowed to spawn bd, and it has to
//! reflect the workspace that is actually open.

mod common;

use beadazzled_lib::commands::diagnostics;
use beadazzled_lib::commands::WorkspaceService;
use beadazzled_lib::workspace::discovery::BdStatus;
use beadazzled_lib::workspace::registry::{AppConfig, WorkspaceEntry};

const PROJECT_ID: &str = "00000000-0000-4000-8000-000000000000";

fn service_with_workspace(dir: &std::path::Path) -> (WorkspaceService, std::path::PathBuf) {
    let workspace = common::workspace(dir);
    let service = WorkspaceService::open(dir.join("config.json")).expect("open workspace service");
    service.set_bd_path(Some(common::fake_bd_path().display().to_string()));
    service
        .add_workspace(&workspace.display().to_string())
        .expect("add workspace");
    (service, workspace)
}

#[test]
fn the_report_follows_the_active_workspace() {
    let dir = common::temp_dir("diagnostics-context");
    let (service, workspace) = service_with_workspace(&dir);

    let report = diagnostics::collect(&service);

    assert!(matches!(report.bd, BdStatus::Ready { .. }));
    assert_eq!(
        report.workspace.as_deref(),
        Some(workspace.display().to_string().as_str())
    );
    let context = report
        .context
        .expect("bd context answers for the workspace");
    assert_eq!(context.project_id, PROJECT_ID);
    assert_eq!(context.dolt_mode, "embedded");
    assert!(report.context_error.is_none());
    // The context call ran through a bridge, so the shared history the report
    // reads must contain it. Ordering is not asserted here: other tests in this
    // binary record into the same process-wide buffer.
    assert!(
        report
            .calls
            .iter()
            .any(|call| call.command == "context" && call.exit_code == Some(0)),
        "the context call is missing from the shared history"
    );
}

#[test]
fn a_missing_workspace_skips_the_context_call() {
    let dir = common::temp_dir("diagnostics-missing");
    let (service, workspace) = service_with_workspace(&dir);
    std::fs::remove_dir_all(&workspace).expect("remove workspace directory");

    let report = diagnostics::collect(&service);

    assert!(matches!(report.bd, BdStatus::Ready { .. }));
    // A spawn would have failed and set context_error, so both being empty is
    // what proves the report did not ask bd about a directory that is gone.
    assert!(report.context.is_none());
    assert!(report.context_error.is_none());
}

#[test]
fn a_workspace_refused_by_bd_reports_the_error() {
    let dir = common::temp_dir("diagnostics-refused");
    let not_beads = dir.join("not-beads");
    std::fs::create_dir_all(&not_beads).expect("create not-beads directory");
    let path = not_beads.display().to_string();

    // Registering through the service validates with bd first, so the entry is
    // written directly to exercise the report against a workspace bd refuses.
    let mut config = AppConfig {
        last_workspace_path: Some(path.clone()),
        ..AppConfig::default()
    };
    config.workspaces.push(WorkspaceEntry {
        name: "not-beads".to_owned(),
        project_id: PROJECT_ID.to_owned(),
        is_worktree: false,
        last_opened_at: "2026-11-01T00:00:00Z".to_owned(),
        checkpoint: None,
        path,
    });
    let config_path = dir.join("config.json");
    std::fs::write(
        &config_path,
        serde_json::to_string(&config).expect("config json"),
    )
    .expect("write config");

    let service = WorkspaceService::open(&config_path).expect("open workspace service");
    service.set_bd_path(Some(common::fake_bd_path().display().to_string()));

    let report = diagnostics::collect(&service);

    assert!(report.context.is_none());
    let error = report
        .context_error
        .expect("the failed context call is reported");
    assert!(
        error.message.to_lowercase().contains("beads"),
        "unexpected message: {}",
        error.message
    );
}
