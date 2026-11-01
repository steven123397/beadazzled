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

fn process_is_running(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return false;
        }
        let mut exit_code = 0u32;
        let ok = GetExitCodeProcess(handle, &mut exit_code);
        CloseHandle(handle);
        ok != 0 && exit_code == STILL_ACTIVE as u32
    }
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
    fs::write(workspace.join("journal-pid"), b"").expect("mark a pid file");
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

    let pid: u32 = fs::read_to_string(workspace.join("journal.pid"))
        .expect("the fake journal wrote its pid")
        .trim()
        .parse()
        .expect("the pid is a number");
    assert!(
        !process_is_running(pid),
        "the fake journal process was killed, not left running"
    );
}

#[test]
fn a_partial_line_at_the_end_is_dropped_not_an_error() {
    let dir = common::temp_dir("backfill-partial");
    let workspace = workspace_with_journal(&dir, 3);
    let journal = workspace.join("journal.jsonl");
    let contents = fs::read_to_string(&journal).expect("read the journal");
    fs::write(&journal, contents.trim_end_matches('\n')).expect("drop the final newline");
    let bridge = BdBridge::new(common::fake_bd_path(), &workspace);

    let batch = bridge
        .journal_backfill(0, 50_000, Duration::from_secs(2))
        .expect("a partial tail is not an error");

    assert!(!batch.stopped, "the process reached end of output");
    assert_eq!(batch.records.len(), 2, "only complete lines are returned");
    assert_eq!(batch.records.last().map(|record| record.seq), Some(2));
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
