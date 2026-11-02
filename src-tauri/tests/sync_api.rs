//! Sync orchestration against `examples/fake_bd`.
//!
//! These exercise the real `BdBridge` adapter; the state matrix itself is
//! covered by the scripted fake source in `sync::baseline` unit tests.

mod common;

use std::fs;
use std::path::Path;

use beadazzled_lib::bridge::{BdBridge, Issue, JournalRecord};
use beadazzled_lib::sync::{
    BaselineOutcome, SyncConfig, SyncEngine, SyncSink, SyncSource, SyncState,
};

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

fn workspace_named(dir: &Path, name: &str) -> std::path::PathBuf {
    let workspace = dir.join(name);
    fs::create_dir_all(&workspace).expect("create workspace");
    workspace
}

#[test]
fn baseline_reads_the_export_then_the_journal_fixture() {
    let dir = common::temp_dir("sync-baseline");
    let workspace = common::workspace(&dir);
    let bridge = BdBridge::new(common::fake_bd_path(), &workspace);
    let mut engine = SyncEngine::new(bridge, SyncConfig::default());
    let mut sink = CollectingSink::default();

    let outcome = engine.baseline(&mut sink, 0);

    assert_eq!(outcome, BaselineOutcome::Healthy { applied: 13 });
    assert_eq!(sink.snapshots.len(), 1, "export replaces the store once");
    assert_eq!(sink.snapshots[0].len(), 7);
    assert_eq!(sink.records.len(), 13);
    assert_eq!(engine.last_seq(), 13);
    assert!(matches!(
        sink.states.last(),
        Some(SyncState::Healthy { last_seq: 13, .. })
    ));
}

#[test]
fn a_truncated_fixture_surfaces_the_error_instead_of_empty_data() {
    let dir = common::temp_dir("sync-truncated");
    let workspace = workspace_named(&dir, "journal-truncated");
    let bridge = BdBridge::new(common::fake_bd_path(), &workspace);
    let mut engine = SyncEngine::new(bridge, SyncConfig::default());
    let mut sink = CollectingSink::default();

    let outcome = engine.baseline(&mut sink, 0);

    assert_eq!(
        outcome,
        BaselineOutcome::JournalTruncated {
            floor: 5,
            recovered: false,
        }
    );
    assert_eq!(
        sink.snapshot_since,
        vec![0, 4],
        "the export snapshot is kept and reseeded at the truncation floor"
    );
    assert!(matches!(
        sink.states.last(),
        Some(SyncState::JournalTruncated {
            floor: 5,
            recovered: false
        })
    ));
}

#[test]
fn a_disabled_journal_keeps_the_export_data() {
    let dir = common::temp_dir("sync-disabled");
    let workspace = workspace_named(&dir, "journal-disabled");
    let bridge = BdBridge::new(common::fake_bd_path(), &workspace);
    let mut engine = SyncEngine::new(bridge, SyncConfig::default());
    let mut sink = CollectingSink::default();

    let outcome = engine.baseline(&mut sink, 0);

    assert_eq!(outcome, BaselineOutcome::JournalDisabled);
    assert_eq!(sink.snapshots.len(), 1);
    assert_eq!(sink.snapshots[0].len(), 7);
    assert!(sink.records.is_empty());
    assert_eq!(sink.states.last(), Some(&SyncState::JournalDisabled));
}

#[test]
fn the_bridge_implements_the_sync_source_contract() {
    let dir = common::temp_dir("sync-contract");
    let workspace = common::workspace(&dir);
    let bridge = BdBridge::new(common::fake_bd_path(), &workspace);

    let issues = SyncSource::export(&bridge).expect("export works through the trait");
    let mut journal =
        SyncSource::journal(&bridge, 0, false).expect("journal works through the trait");
    let records = journal.next_batch().expect("records parse");

    assert_eq!(issues.len(), 7);
    assert_eq!(records.len(), 13);
}
