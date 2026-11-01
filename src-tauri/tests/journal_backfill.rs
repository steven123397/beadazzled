//! Bounded journal backfill: record cap, deadline and degraded detection.

mod common;

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use beadazzled_lib::bridge::{BdBridge, BridgeErrorCode};

fn fixture() -> String {
    let path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/bd/events-writes.jsonl");
    fs::read_to_string(path).expect("read the journal fixture")
}

fn workspace_with_journal(dir: &Path, lines: usize) -> PathBuf {
    let workspace = common::workspace(dir);
    let template: Vec<serde_json::Value> = fixture()
        .lines()
        .map(|line| serde_json::from_str(line).expect("journal fixture line"))
        .collect();
    let mut journal = String::new();
    for index in 0..lines {
        let mut record = template[index % template.len()].clone();
        record["seq"] = serde_json::json!(index as i64 + 1);
        journal.push_str(&record.to_string());
        journal.push('\n');
    }
    fs::write(workspace.join("journal.jsonl"), journal).expect("write journal");
    workspace
}

#[test]
fn the_record_limit_stops_the_read_and_keeps_the_first_records() {
    let dir = common::temp_dir("backfill-limit");
    let workspace = workspace_with_journal(&dir, 13);
    let bridge = BdBridge::new(common::fake_bd_path(), &workspace);

    let batch = bridge
        .journal_backfill(0, 5, Duration::from_secs(8))
        .expect("backfill succeeds");

    assert!(batch.stopped, "the record limit ended the read");
    assert_eq!(batch.records.len(), 5);
    assert_eq!(batch.records[0].seq, 1);
    assert_eq!(batch.records[4].seq, 5);
}

#[test]
fn the_deadline_stops_the_read_and_kills_the_process() {
    let dir = common::temp_dir("backfill-deadline");
    let workspace = workspace_with_journal(&dir, 200);
    fs::write(workspace.join("journal-slow"), b"").expect("mark a slow journal");
    let bridge = BdBridge::new(common::fake_bd_path(), &workspace);

    let started = Instant::now();
    let batch = bridge
        .journal_backfill(0, 50_000, Duration::from_millis(500))
        .expect("backfill succeeds");

    assert!(
        started.elapsed() < Duration::from_secs(2),
        "the deadline was honoured"
    );
    assert!(batch.stopped);
    assert!(!batch.records.is_empty(), "partial records are returned");
    assert!(
        batch.records.len() < 200,
        "the whole fixture must not be read"
    );

    std::thread::sleep(Duration::from_millis(400));
    assert!(
        !workspace.join("journal-done").exists(),
        "the fake journal process was killed"
    );
}

#[test]
fn a_disabled_journal_is_still_an_error() {
    let dir = common::temp_dir("backfill-disabled");
    let workspace = dir.join("journal-disabled");
    fs::create_dir_all(&workspace).expect("create workspace");
    let bridge = BdBridge::new(common::fake_bd_path(), &workspace);

    let error = bridge
        .journal_backfill(0, 50_000, Duration::from_secs(2))
        .expect_err("a disabled journal is not an empty result");

    assert_eq!(error.code, BridgeErrorCode::JournalDisabled);
}

#[test]
fn truncated_history_is_still_an_error() {
    let dir = common::temp_dir("backfill-truncated");
    let workspace = dir.join("journal-truncated");
    fs::create_dir_all(&workspace).expect("create workspace");
    let bridge = BdBridge::new(common::fake_bd_path(), &workspace);

    let error = bridge
        .journal_backfill(0, 50_000, Duration::from_secs(2))
        .expect_err("truncation is not an empty result");

    assert_eq!(error.code, BridgeErrorCode::JournalTruncated);
}
