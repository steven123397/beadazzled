//! Checkpoint 2: bridge + workspace + sync + writes run together without a UI.
//!
//! The flow mirrors the acceptance criteria: add a temporary workspace, run a
//! baseline, write, receive the journal echo, restart from the persisted
//! checkpoint, and keep degraded states visible. `journal.jsonl` in the
//! workspace stands in for bd's journal: appending a line after the write is
//! the record bd would emit.

mod common;

use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex};

use beadazzled_lib::bridge::{BdBridge, Issue, JournalRecord, UpdateSpec, WriteCommand};
use beadazzled_lib::commands::WorkspaceService;
use beadazzled_lib::sync::{BaselineOutcome, SyncConfig, SyncEngine, SyncSink, SyncState};

const PROJECT_ID: &str = "00000000-0000-4000-8000-000000000000";

/// The call log is process-wide (`shared_call_log`), so one test asserting
/// that a read path makes no bd call must not overlap the other test in this
/// binary, whose baseline spawns bd.
static INTERACTION_GUARD: StdMutex<()> = StdMutex::new(());

#[derive(Default)]
struct CollectingSink {
    snapshots: Vec<Vec<Issue>>,
    /// The cursor each snapshot was emitted with, in order.
    snapshot_since: Vec<i64>,
    records: Vec<JournalRecord>,
    states: Vec<SyncState>,
}

impl SyncSink for CollectingSink {
    fn snapshot(&mut self, issues: &[Issue], since: i64) {
        self.snapshots.push(issues.to_vec());
        self.snapshot_since.push(since);
    }

    fn records(&mut self, records: &[JournalRecord]) {
        self.records.extend_from_slice(records);
    }

    fn state(&mut self, state: &SyncState) {
        self.states.push(state.clone());
    }
}

fn journal_line(seq: i64, status: &str) -> String {
    serde_json::json!({
        "seq": seq,
        "ts": format!("2026-11-01T00:00:{seq:02}Z"),
        "op": "update",
        "issue_id": "fx-96d",
        "issue": {
            "id": "fx-96d",
            "title": "Checkpoint issue",
            "description": "",
            "status": status,
            "priority": 2,
            "issue_type": "task",
            "created_at": "2026-11-01T00:00:00Z",
            "updated_at": format!("2026-11-01T00:00:{seq:02}Z")
        }
    })
    .to_string()
}

fn write_journal(workspace: &Path, records: &[String]) {
    let contents = records
        .iter()
        .map(|line| format!("{line}\n"))
        .collect::<String>();
    fs::write(workspace.join("journal.jsonl"), contents).expect("write journal");
}

fn append_journal(workspace: &Path, line: &str) {
    let mut file = fs::OpenOptions::new()
        .append(true)
        .open(workspace.join("journal.jsonl"))
        .expect("open journal");
    writeln!(file, "{line}").expect("append journal");
}

fn service_at(config_path: &Path) -> WorkspaceService {
    let service = WorkspaceService::open(config_path).expect("open workspace service");
    service.set_bd_path(Some(common::fake_bd_path().display().to_string()));
    service
}

fn engine_for(workspace: &Path) -> (SyncEngine<Arc<BdBridge>>, Arc<BdBridge>) {
    let bridge = Arc::new(BdBridge::new(common::fake_bd_path(), workspace));
    (
        SyncEngine::new(Arc::clone(&bridge), SyncConfig::default()),
        bridge,
    )
}

fn workspace_named(dir: &Path, name: &str) -> PathBuf {
    let workspace = dir.join(name);
    fs::create_dir_all(&workspace).expect("create workspace");
    workspace
}

#[test]
fn add_baseline_write_echo_and_restart() {
    let _guard = INTERACTION_GUARD
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = common::temp_dir("checkpoint-data-plane");
    let workspace = common::workspace(&dir);
    write_journal(
        &workspace,
        &[
            journal_line(1, "open"),
            journal_line(2, "open"),
            journal_line(3, "in_progress"),
        ],
    );

    let config_path = dir.join("config.json");
    let service = service_at(&config_path);
    let path = workspace.display().to_string();
    service.add_workspace(&path).expect("add workspace");
    assert_eq!(
        service.snapshot().active.as_deref(),
        Some(path.as_str()),
        "adding opens the workspace"
    );

    let (mut engine, bridge) = engine_for(&workspace);
    let mut sink = CollectingSink::default();
    let since = service
        .checkpoint(&path, PROJECT_ID)
        .map(|checkpoint| checkpoint.seq)
        .unwrap_or(0);
    assert_eq!(since, 0);

    assert_eq!(
        engine.baseline(&mut sink, since),
        BaselineOutcome::Healthy { applied: 3 }
    );
    assert_eq!(sink.snapshots.len(), 1);
    assert_eq!(
        sink.snapshots[0].len(),
        7,
        "the export snapshot replaced the store"
    );
    assert_eq!(
        sink.states.last(),
        Some(&SyncState::Healthy {
            last_seq: 3,
            last_event_at: Some("2026-11-01T00:00:03Z".to_owned()),
        })
    );
    service.set_checkpoint(&path, engine.last_seq());
    service.flush().expect("flush");

    // Interaction-path assertion: reading the registry/store never calls bd.
    let calls = bridge.recent_calls().len();
    let _ = service.snapshot();
    let _ = sink.records.len();
    let _ = service.checkpoint(&path, PROJECT_ID);
    assert_eq!(
        bridge.recent_calls().len(),
        calls,
        "registry and store reads must not invoke bd"
    );

    // A write succeeds, then bd appends the echo record to its journal.
    let outcome = service
        .write(&path, &WriteCommand::Update(UpdateSpec::new("fx-96d")))
        .expect("write succeeds");
    assert_eq!(outcome.exit_code, 0);
    append_journal(&workspace, &journal_line(4, "closed"));

    let checkpoint = service
        .checkpoint(&path, PROJECT_ID)
        .expect("checkpoint is stored")
        .seq;
    assert_eq!(
        engine.baseline(&mut sink, checkpoint),
        BaselineOutcome::Healthy { applied: 1 }
    );
    let echo = sink.records.last().expect("the echo record arrived");
    assert_eq!(echo.seq, 4);
    assert_eq!(
        echo.issue.as_ref().expect("echo carries the issue").status,
        "closed"
    );
    service.set_checkpoint(&path, engine.last_seq());
    service.flush().expect("flush");

    // Restart: a fresh service reopens the workspace and resumes at seq 4.
    drop(engine);
    drop(service);
    let reopened = WorkspaceService::open(&config_path).expect("reopen service");
    assert_eq!(reopened.snapshot().active.as_deref(), Some(path.as_str()));
    let checkpoint = reopened
        .checkpoint(&path, PROJECT_ID)
        .expect("checkpoint survived the restart")
        .seq;
    assert_eq!(checkpoint, 4);

    let (mut engine, _bridge) = engine_for(&workspace);
    let mut sink = CollectingSink::default();
    assert_eq!(
        engine.baseline(&mut sink, checkpoint),
        BaselineOutcome::Healthy { applied: 0 }
    );
    assert!(
        sink.records.is_empty(),
        "nothing before the checkpoint replays"
    );
    assert_eq!(engine.last_seq(), 4);
}

#[test]
fn degraded_states_are_visible_without_a_ui() {
    let _guard = INTERACTION_GUARD
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = common::temp_dir("checkpoint-degraded");
    let service = service_at(&dir.join("config.json"));

    let disabled = workspace_named(&dir, "journal-disabled");
    service
        .add_workspace(&disabled.display().to_string())
        .expect("add disabled workspace");
    let (mut engine, _bridge) = engine_for(&disabled);
    let mut sink = CollectingSink::default();
    assert_eq!(
        engine.baseline(&mut sink, 0),
        BaselineOutcome::JournalDisabled
    );
    assert_eq!(sink.snapshots.len(), 1, "export data is still available");
    assert_eq!(sink.snapshots[0].len(), 7);
    assert!(sink.records.is_empty());
    assert_eq!(sink.states.last(), Some(&SyncState::JournalDisabled));

    let truncated = workspace_named(&dir, "journal-truncated");
    service
        .add_workspace(&truncated.display().to_string())
        .expect("add truncated workspace");
    let (mut engine, _bridge) = engine_for(&truncated);
    let mut sink = CollectingSink::default();
    assert_eq!(
        engine.baseline(&mut sink, 0),
        BaselineOutcome::JournalTruncated {
            floor: 5,
            recovered: false
        }
    );
    assert_eq!(
        sink.snapshot_since,
        vec![0, 4],
        "the store is reseeded at floor - 1 before the retry"
    );
    assert_eq!(
        sink.states.last(),
        Some(&SyncState::JournalTruncated {
            floor: 5,
            recovered: false
        })
    );
}
