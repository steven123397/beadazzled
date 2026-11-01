//! BdBridge façade tests against `examples/fake_bd` in its default `bd-like`
//! mode. The process layer never spawns a real `bd`.

mod common;

use std::path::Path;

use beadazzled_lib::bridge::{BdBridge, BridgeErrorCode, CreateSpec, UpdateSpec, WriteCommand};
use common::{fake_bd_path, temp_dir, workspace};

fn bridge(workspace: &Path) -> BdBridge {
    BdBridge::new(fake_bd_path(), workspace.to_path_buf())
}

#[test]
fn version_uses_a_workspace_less_call() {
    let dir = temp_dir("api-version");
    let workspace = workspace(&dir);
    let version = bridge(&workspace).version().expect("version parses");

    assert_eq!((version.major, version.minor, version.patch), (1, 3, 2));
}

#[test]
fn context_parses_the_recorded_fixture() {
    let dir = temp_dir("api-context");
    let workspace = workspace(&dir);
    let context = bridge(&workspace).context().expect("context parses");

    assert_eq!(context.bd_version, "1.3.2");
    assert_eq!(context.dolt_mode, "embedded");
    assert_eq!(context.schema_version, 1);
}

#[test]
fn export_parses_the_recorded_fixture() {
    let dir = temp_dir("api-export");
    let workspace = workspace(&dir);
    let issues = bridge(&workspace).export().expect("export parses");

    assert_eq!(issues.len(), 7);
}

#[test]
fn one_shot_journal_returns_the_recorded_records() {
    let dir = temp_dir("api-journal-once");
    let workspace = workspace(&dir);
    let mut reader = bridge(&workspace)
        .journal(0, false)
        .expect("journal starts");

    let records = reader.next_batch().expect("records parse");
    assert_eq!(records.len(), 13);
    assert!(reader.next_batch().expect("drained").is_empty());
}

#[test]
fn follow_journal_reads_records_until_eof() {
    let dir = temp_dir("api-journal-follow");
    let workspace = workspace(&dir);
    let mut reader = bridge(&workspace).journal(0, true).expect("follow starts");

    let mut records = Vec::new();
    loop {
        let batch = reader.next_batch().expect("batch parses");
        if batch.is_empty() {
            break;
        }
        records.extend(batch);
    }

    assert_eq!(records.len(), 13);
}

#[test]
fn journal_disabled_is_classified() {
    let dir = temp_dir("api-journal-disabled");
    let workspace = workspace(&dir);

    let error = bridge(&workspace)
        .journal(0, false)
        .expect_err("disabled journal is an error");

    assert_eq!(error.code, BridgeErrorCode::JournalDisabled);
}

#[test]
fn journal_truncated_is_classified() {
    let dir = temp_dir("api-journal-truncated");
    let workspace = workspace(&dir);

    let error = bridge(&workspace)
        .journal(0, false)
        .expect_err("truncated journal is an error");

    assert_eq!(error.code, BridgeErrorCode::JournalTruncated);
}

#[test]
fn create_returns_the_created_id() {
    let dir = temp_dir("api-create");
    let workspace = workspace(&dir);
    let command = WriteCommand::Create(CreateSpec {
        title: "API create".to_owned(),
        description: "body".to_owned(),
        issue_type: "task".to_owned(),
        priority: 2,
        labels: Vec::new(),
        acceptance: None,
        assignee: None,
    });

    let outcome = bridge(&workspace).write(&command).expect("create succeeds");

    assert_eq!(outcome.exit_code, 0);
    assert_eq!(outcome.created_id.as_deref(), Some("bza-new"));
}

#[test]
fn a_stale_update_maps_to_write_conflict() {
    let dir = temp_dir("api-conflict");
    let workspace = workspace(&dir);
    let mut spec = UpdateSpec::new("bza-1");
    spec.status = Some("closed".to_owned());
    spec.if_status = Some("stale".to_owned());

    let error = bridge(&workspace)
        .write(&WriteCommand::Update(spec))
        .expect_err("exit 13 is a conflict");

    assert_eq!(error.code, BridgeErrorCode::WriteConflict);
}

#[test]
fn config_get_returns_stdout() {
    let dir = temp_dir("api-config");
    let workspace = workspace(&dir);

    let value = bridge(&workspace)
        .config_get("events-journal")
        .expect("config get succeeds");

    assert_eq!(value, "true");
}
