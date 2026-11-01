//! Follow mode: the flag bd needs, cross-chunk lines and truncation markers.

mod common;

use std::fs;
use std::path::Path;

use beadazzled_lib::bridge::{BdBridge, BridgeErrorCode};

fn bridge_at(workspace: &Path) -> BdBridge {
    BdBridge::new(common::fake_bd_path(), workspace)
}

fn drain(reader: &mut beadazzled_lib::bridge::JournalReader) {
    while let Ok(batch) = reader.next_batch() {
        if batch.is_empty() {
            return;
        }
    }
}

#[test]
fn follow_mode_asks_bd_to_keep_the_stream_open() {
    let dir = common::temp_dir("follow-argv");
    let workspace = common::workspace(&dir);
    fs::write(workspace.join("journal-argv"), b"").expect("mark argv capture");

    let mut reader = bridge_at(&workspace)
        .journal(0, true)
        .expect("follow starts");
    drain(&mut reader);

    let captured =
        fs::read_to_string(workspace.join("journal-argv.json")).expect("argv was captured");
    let value: serde_json::Value = serde_json::from_str(&captured).expect("argv json");
    let args: Vec<String> = value["args"]
        .as_array()
        .expect("args array")
        .iter()
        .map(|arg| arg.as_str().expect("arg string").to_owned())
        .collect();

    assert!(
        args.iter().any(|arg| arg == "--follow"),
        "bd only keeps streaming with --follow; got {args:?}"
    );
    assert!(args.iter().any(|arg| arg == "--json"), "got {args:?}");
}

#[test]
fn a_line_split_across_reads_is_buffered_until_complete() {
    let dir = common::temp_dir("follow-split");
    let workspace = common::workspace(&dir);
    fs::write(workspace.join("journal-split"), b"").expect("mark a split journal");

    let mut reader = bridge_at(&workspace)
        .journal(0, true)
        .expect("follow starts");
    let batch = reader
        .next_batch()
        .expect("a half line is not the end of the stream");

    assert_eq!(batch.len(), 1, "the record arrives once it is complete");
    assert_eq!(batch[0].seq, 1);
    assert_eq!(
        batch[0].issue.as_ref().expect("issue payload").id,
        "fx-split"
    );
}

#[test]
fn a_truncation_marker_in_follow_mode_is_journal_truncated() {
    let dir = common::temp_dir("follow-truncated");
    let workspace = dir.join("journal-truncated");
    fs::create_dir_all(&workspace).expect("create workspace");

    let mut reader = bridge_at(&workspace)
        .journal(0, true)
        .expect("follow starts");
    let error = reader
        .next_batch()
        .expect_err("a truncation marker is not a record");

    assert_eq!(error.code, BridgeErrorCode::JournalTruncated);
}
