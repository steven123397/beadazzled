//! Parsing and stderr mapping tests.
//!
//! Like the other bridge tests, these use recorded bd output and synthetic
//! stderr only; a real `bd` is never spawned.

use beadazzled_lib::bridge::{
    map_exit,
    parse::{journal_disabled, journal_truncated, parse_export, JournalStream},
    BridgeError, BridgeErrorCode,
};
use serde_json::Value;

fn read_fixture(name: &str) -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/fixtures/bd")
        .join(name);
    std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("read {}: {error}", path.display()))
}

fn exit_code(error: &BridgeError) -> Option<i64> {
    error.detail.as_ref()?.0.get("exit_code")?.as_i64()
}

fn detail_value<'a>(error: &'a BridgeError, key: &str) -> Option<&'a Value> {
    error.detail.as_ref()?.0.get(key)
}

#[test]
fn parse_export_reads_the_recorded_fixture() {
    let issues = parse_export(read_fixture("export-statuses.json").as_bytes())
        .expect("the recorded export parses");

    assert_eq!(issues.len(), 6);
    assert!(issues.iter().all(|issue| !issue.status.is_empty()));
}

#[test]
fn parse_export_skips_blank_lines() {
    let text = read_fixture("export-statuses.json");
    let first = text.lines().next().expect("fixture has a line");
    let input = format!("\n{first}\n\n");

    let issues = parse_export(input.as_bytes()).expect("blank lines are skipped");
    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].id, "fx-maz");
}

#[test]
fn parse_export_reports_a_bad_line_with_its_number() {
    let text = read_fixture("export-statuses.json");
    let first = text.lines().next().expect("fixture has a line");
    let input = format!("{first}\n{{not json}}\n");

    let error = parse_export(input.as_bytes()).expect_err("a bad line fails the export");

    assert_eq!(error.code, BridgeErrorCode::BdParseFailed);
    assert_eq!(
        detail_value(&error, "line").and_then(Value::as_u64),
        Some(2)
    );
    assert!(error.message.contains("line 2"), "{}", error.message);
}

#[test]
fn parse_export_rejects_a_truncated_last_line() {
    let text = read_fixture("export-statuses.json");
    let first = text.lines().next().expect("fixture has a line");
    let input = format!("{first}\n{first}");

    let error = parse_export(input.as_bytes()).expect_err("a missing final newline is truncation");

    assert_eq!(error.code, BridgeErrorCode::BdParseFailed);
    assert_eq!(
        detail_value(&error, "line").and_then(Value::as_u64),
        Some(2)
    );
    assert!(error.message.contains("truncated"), "{}", error.message);
}

#[test]
fn parse_export_rejects_invalid_utf8() {
    let error = parse_export(b"{\"id\":\"\xff\"}\n").expect_err("invalid UTF-8 fails");

    assert_eq!(error.code, BridgeErrorCode::BdParseFailed);
}

#[test]
fn parse_export_accepts_empty_output() {
    assert!(parse_export(b"")
        .expect("empty output is empty, not an error")
        .is_empty());
}

#[test]
fn journal_stream_buffers_incomplete_lines() {
    let text = read_fixture("events-writes.jsonl");
    let first = text.lines().next().expect("fixture has a line");
    let bytes = first.as_bytes();
    let split = bytes.len() / 2;

    let mut stream = JournalStream::new();
    assert!(stream
        .push(&bytes[..split])
        .expect("partial chunk is buffered")
        .is_empty());
    assert!(stream.has_partial());
    assert!(stream
        .push(&bytes[split..])
        .expect("still partial")
        .is_empty());

    let records = stream.push(b"\n").expect("the completed line parses");
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].seq, 1);
    assert!(!stream.has_partial());
}

#[test]
fn journal_stream_returns_complete_records_and_keeps_the_tail() {
    let text = read_fixture("events-writes.jsonl");
    let mut lines = text.lines();
    let first = lines.next().expect("fixture has a line");
    let second = lines.next().expect("fixture has a second line");
    let half = second.len() / 2;
    let chunk = format!("{first}\n{}", &second[..half]);

    let mut stream = JournalStream::new();
    let records = stream.push(chunk.as_bytes()).expect("complete line parses");

    assert_eq!(records.len(), 1);
    assert!(stream.has_partial());
    let tail = stream.take_partial().expect("the partial line is kept");
    assert_eq!(tail.as_slice(), &second.as_bytes()[..half]);
    assert!(!stream.has_partial());
}

#[test]
fn journal_stream_reports_a_bad_line_with_its_number() {
    let mut stream = JournalStream::new();

    let error = stream
        .push(b"not-json\n")
        .expect_err("a bad line fails the stream");

    assert_eq!(error.code, BridgeErrorCode::BdParseFailed);
    assert!(error.message.contains("line 1"), "{}", error.message);
}

#[test]
fn journal_disabled_requires_exit_zero_an_empty_stream_and_the_marker() {
    let stderr = "note: the events journal is disabled for this workspace \
                  (enable with 'bd config set events-journal true')";

    let error = journal_disabled(0, b"", stderr).expect("the disabled journal is detected");
    assert_eq!(error.code, BridgeErrorCode::JournalDisabled);

    assert!(journal_disabled(0, b"{}\n", stderr).is_none());
    assert!(journal_disabled(1, b"", stderr).is_none());
    assert!(journal_disabled(0, b"", "some other note").is_none());
}

#[test]
fn journal_truncation_is_detected_on_stdout() {
    let error = journal_truncated(
        br#"{"code":"events_journal_truncated","since":1,"floor":5,"head":9}"#,
        "",
    )
    .expect("the truncation JSON is detected");

    assert_eq!(error.code, BridgeErrorCode::JournalTruncated);
    assert_eq!(
        detail_value(&error, "since").and_then(Value::as_i64),
        Some(1)
    );
    assert_eq!(
        detail_value(&error, "floor").and_then(Value::as_i64),
        Some(5)
    );
    assert_eq!(
        detail_value(&error, "head").and_then(Value::as_i64),
        Some(9)
    );
}

#[test]
fn journal_truncation_is_detected_on_stderr_with_extra_lines() {
    let stderr = "note: something\n\
                  {\"code\":\"events_journal_truncated\",\"since\":2,\"floor\":7,\"head\":10}\n";

    let error = journal_truncated(b"", stderr).expect("stderr JSON is detected");

    assert_eq!(error.code, BridgeErrorCode::JournalTruncated);
    assert_eq!(
        detail_value(&error, "since").and_then(Value::as_i64),
        Some(2)
    );
    assert_eq!(
        detail_value(&error, "floor").and_then(Value::as_i64),
        Some(7)
    );
    assert_eq!(
        detail_value(&error, "head").and_then(Value::as_i64),
        Some(10)
    );
}

#[test]
fn unknown_journal_json_is_not_guessed() {
    assert!(journal_truncated(
        br#"{"code":"some_other_error","since":1,"floor":2,"head":3}"#,
        ""
    )
    .is_none());
    assert!(journal_truncated(b"", "plain text").is_none());
}

#[test]
fn map_exit_maps_stale_guards_to_write_conflict() {
    let error = map_exit(13, "Error: precondition no longer held");

    assert_eq!(error.code, BridgeErrorCode::WriteConflict);
    assert_eq!(exit_code(&error), Some(13));
}

#[test]
fn map_exit_maps_database_locks() {
    let error = map_exit(1, "Error: database is locked by another writer");

    assert_eq!(error.code, BridgeErrorCode::BdLocked);
}

#[test]
fn map_exit_preserves_pending_migration_text() {
    let stderr = "Error: pending schema migration detected\nrun 'bd migrate'";

    let error = map_exit(1, stderr);

    assert_eq!(error.code, BridgeErrorCode::BdSchemaMismatch);
    let hint = detail_value(&error, "hint")
        .and_then(Value::as_str)
        .expect("the matching line is preserved");
    assert!(hint.contains("pending schema migration"), "{hint}");
    let full = detail_value(&error, "stderr")
        .and_then(Value::as_str)
        .expect("stderr is preserved");
    assert!(full.contains("bd migrate"), "{full}");
}

#[test]
fn map_exit_maps_missing_workspace_errors() {
    assert_eq!(
        map_exit(1, "fatal: not a beads workspace").code,
        BridgeErrorCode::WsNotBeads
    );
    assert_eq!(
        map_exit(1, "Error: no beads database found").code,
        BridgeErrorCode::WsNotBeads
    );
}

#[test]
fn map_exit_does_not_guess_unknown_failures() {
    let error = map_exit(2, "something odd happened");

    assert_eq!(error.code, BridgeErrorCode::BdExitNonzero);
    assert_eq!(exit_code(&error), Some(2));
    assert!(error.message.contains('2'), "{}", error.message);
    assert_eq!(
        detail_value(&error, "stderr").and_then(Value::as_str),
        Some("something odd happened")
    );
}

#[test]
fn map_exit_does_not_treat_a_lone_schema_word_as_mismatch() {
    let error = map_exit(1, "schema mentioned without a compatibility problem");

    assert_eq!(error.code, BridgeErrorCode::BdExitNonzero);
}

#[test]
fn map_exit_keeps_only_the_first_two_kib_of_stderr() {
    let stderr = "x".repeat(4096);

    let error = map_exit(1, &stderr);

    assert_eq!(error.code, BridgeErrorCode::BdExitNonzero);
    let kept = detail_value(&error, "stderr")
        .and_then(Value::as_str)
        .expect("stderr excerpt");
    assert_eq!(kept.len(), 2048);
}
