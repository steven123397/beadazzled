//! A follow read that blocks on a silent journal must still be stoppable.

mod common;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

use beadazzled_lib::bridge::{BdBridge, Issue, JournalRecord};
use beadazzled_lib::sync::{FollowOutcome, SyncConfig, SyncEngine, SyncSink, SyncState};

struct CountingSink {
    received: Arc<AtomicUsize>,
}

impl SyncSink for CountingSink {
    fn snapshot(&mut self, _issues: &[Issue], _since: i64) {}

    fn records(&mut self, records: &[JournalRecord]) {
        self.received.fetch_add(records.len(), Ordering::SeqCst);
    }

    fn state(&mut self, _state: &SyncState) {}
}

fn fixture() -> String {
    let path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/bd/events-writes.jsonl");
    fs::read_to_string(path).expect("read the journal fixture")
}

fn hanging_workspace(dir: &Path, lines: usize) -> PathBuf {
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
    // fake_bd writes one record, then holds stdout open without writing again.
    fs::write(workspace.join("journal-hang"), b"").expect("mark a silent journal");
    workspace
}

#[test]
fn interrupting_follow_ends_a_blocked_read() {
    let dir = common::temp_dir("follow-interrupt");
    let workspace = hanging_workspace(&dir, 5);
    let bridge = Arc::new(BdBridge::new(common::fake_bd_path(), &workspace));
    let engine = SyncEngine::new(Arc::clone(&bridge), SyncConfig::default());
    let received = Arc::new(AtomicUsize::new(0));
    let stop = Arc::new(AtomicBool::new(false));

    let (outcome_tx, outcome_rx) = mpsc::channel();
    let thread_received = Arc::clone(&received);
    let thread_stop = Arc::clone(&stop);
    let handle = std::thread::spawn(move || {
        let mut engine = engine;
        let mut sink = CountingSink {
            received: thread_received,
        };
        let outcome = engine.follow(
            &mut sink,
            move || thread_stop.load(Ordering::SeqCst),
            |_| {},
        );
        outcome_tx.send(outcome).expect("send the outcome");
    });

    let deadline = Instant::now() + Duration::from_secs(2);
    while received.load(Ordering::SeqCst) == 0 && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(
        received.load(Ordering::SeqCst) > 0,
        "the follow stream started"
    );

    // The stream needs ~5s to finish on its own, so ending well before that
    // proves the blocked read was interrupted rather than timing out.
    stop.store(true, Ordering::SeqCst);
    bridge.interrupt_follow();

    let outcome = outcome_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("the follow loop ended after the interrupt");
    assert_eq!(outcome, FollowOutcome::Stopped);
    handle.join().expect("follow thread");
}
