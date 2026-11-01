//! Parses the recorded `bd` samples in `tests/fixtures/bd/`.
//!
//! These tests never spawn a real `bd`: the fixtures are recorded output from
//! bd 1.3.2 and the bridge must stay independent of the installed bd version.

use beadazzled_lib::bridge::{
    BridgeError, BridgeErrorCode, Issue, JournalOp, JournalRecord, WorkspaceContext,
};
use serde::de::DeserializeOwned;
use serde_json::{json, Map, Value};

fn read_fixture(name: &str) -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/fixtures/bd")
        .join(name);
    std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("read {}: {error}", path.display()))
}

fn parse_jsonl<T: DeserializeOwned>(fixture: &str) -> Vec<T> {
    read_fixture(fixture)
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            serde_json::from_str(line).unwrap_or_else(|error| panic!("bad fixture line: {error}"))
        })
        .collect()
}

#[test]
fn export_statuses_fixture_covers_every_status() {
    let issues: Vec<Issue> = parse_jsonl("export-statuses.json");
    assert_eq!(issues.len(), 6);

    let mut statuses: Vec<&str> = issues.iter().map(|issue| issue.status.as_str()).collect();
    statuses.sort_unstable();
    assert_eq!(
        statuses,
        [
            "blocked",
            "closed",
            "deferred",
            "in_progress",
            "open",
            "pinned"
        ]
    );

    assert!(issues.iter().all(|issue| issue.id.starts_with("fx-")));
    assert!(issues
        .iter()
        .any(|issue| issue.priority == 0 || issue.priority == 1));
}

#[test]
fn export_relations_fixture_parses_comments_and_dependencies() {
    let issues: Vec<Issue> = parse_jsonl("export-relations.json");
    assert_eq!(issues.len(), 7);

    let commented = issues
        .iter()
        .find(|issue| issue.id == "fx-maz")
        .expect("fx-maz is in the fixture");
    let comments = commented.comments.as_ref().expect("comments are present");
    assert_eq!(comments.len(), 2);
    assert!(comments
        .iter()
        .all(|comment| comment.issue_id == commented.id));
    assert!(comments
        .iter()
        .any(|comment| comment.text.contains("fresh profile")));

    let dependent = issues
        .iter()
        .find(|issue| issue.id == "fx-757")
        .expect("fx-757 is in the fixture");
    let dependencies = dependent
        .dependencies
        .as_ref()
        .expect("dependencies are present");
    assert_eq!(dependencies.len(), 1);
    assert_eq!(dependencies[0].issue_id, "fx-757");
    assert_eq!(dependencies[0].depends_on_id, "fx-maz");
    assert_eq!(dependencies[0].relation_type, "blocks");
    assert_eq!(dependencies[0].metadata.as_deref(), Some("{}"));

    assert!(issues.iter().any(|issue| issue.id == "fx-6gm"
        && issue.comments.as_ref().is_some_and(|comments| comments
            .iter()
            .any(|comment| comment.text.contains("快捷键")))));
}

#[test]
fn unknown_export_fields_are_kept_in_extra_and_round_trip() {
    let issues: Vec<Issue> = parse_jsonl("export-statuses.json");
    let closed = issues
        .iter()
        .find(|issue| issue.status == "closed")
        .expect("the fixture has a closed issue");

    assert_eq!(
        closed.extra.0.get("_type").and_then(Value::as_str),
        Some("issue")
    );
    assert_eq!(
        closed.extra.0.get("close_reason").and_then(Value::as_str),
        Some("Covered by the README install section.")
    );

    let reserialized = serde_json::to_value(closed).expect("issue serializes");
    assert_eq!(reserialized["_type"], json!("issue"));
    assert_eq!(
        reserialized["close_reason"],
        json!("Covered by the README install section.")
    );
}

#[test]
fn journal_fixture_parses_every_operation_kind() {
    let records: Vec<JournalRecord> = parse_jsonl("events-writes.jsonl");
    assert_eq!(records.len(), 13);
    assert_eq!(records.first().expect("records exist").seq, 1);

    let ops: Vec<JournalOp> = records.iter().map(|record| record.op).collect();
    for op in JournalOp::ALL {
        assert!(ops.contains(&op), "missing journal op {op:?}");
    }

    let deleted = records
        .iter()
        .find(|record| record.op == JournalOp::Delete)
        .expect("the fixture has a delete record");
    assert!(deleted.issue.is_none());
    assert!(deleted.actor.as_deref() == Some("fixture-user"));

    // Derived updates carry no actor; the field must stay optional.
    assert!(records.iter().any(|record| record.actor.is_none()));

    let dep_add = records
        .iter()
        .find(|record| record.op == JournalOp::DepAdd)
        .and_then(|record| record.dep.as_ref())
        .expect("the fixture has a dep_add record");
    assert_eq!(dep_add.kind, "blocks");
    assert_eq!(dep_add.target, "fx-96d");
    assert_eq!(dep_add.metadata.as_deref(), Some("{}"));

    let comment = records
        .iter()
        .find(|record| record.op == JournalOp::Comment)
        .and_then(|record| record.comment.as_ref())
        .expect("the fixture has a comment record");
    assert_eq!(comment.author, "fixture-user");
    assert_eq!(comment.source.as_deref(), Some("structured"));
}

#[test]
fn journal_issue_payloads_default_fields_bd_omits() {
    let records: Vec<JournalRecord> = parse_jsonl("events-writes.jsonl");
    let created = records
        .iter()
        .find(|record| {
            record.op == JournalOp::Create
                && record
                    .issue
                    .as_ref()
                    .is_some_and(|issue| issue.id == "fx-anq")
        })
        .and_then(|record| record.issue.as_ref())
        .expect("fx-anq is in the journal fixture");

    // `bd events` omits empty labels and the count columns entirely.
    assert!(created.labels.is_empty());
    assert_eq!(created.dependency_count, 0);
    assert_eq!(created.dependent_count, 0);
    assert_eq!(created.comment_count, 0);
    assert!(created.extra.0.get("is_blocked").is_none());

    let blocked = records
        .iter()
        .find(|record| record.op == JournalOp::DepAdd)
        .and_then(|record| record.issue.as_ref())
        .expect("the dep_add record carries the issue");
    assert_eq!(
        blocked.extra.0.get("is_blocked").and_then(Value::as_bool),
        Some(true)
    );
}

#[test]
fn workspace_context_fixture_keeps_unknown_fields() {
    let context: WorkspaceContext =
        serde_json::from_str(&read_fixture("context.json")).expect("context fixture parses");

    assert_eq!(context.bd_version, "1.3.2");
    assert_eq!(context.dolt_mode, "embedded");
    assert_eq!(context.schema_version, 1);
    assert_eq!(
        context.extra.0.get("backend").and_then(Value::as_str),
        Some("dolt")
    );

    let reserialized = serde_json::to_value(&context).expect("context serializes");
    assert_eq!(reserialized["backend"], json!("dolt"));
    assert_eq!(reserialized["role"], json!("maintainer"));
}

#[test]
fn bridge_error_codes_match_the_spec() {
    const EXPECTED: [&str; 15] = [
        "BD_NOT_FOUND",
        "BD_NOT_EXECUTABLE",
        "BD_VERSION_UNSUPPORTED",
        "WS_NOT_BEADS",
        "WS_INACCESSIBLE",
        "BD_TIMEOUT",
        "BD_EXIT_NONZERO",
        "BD_LOCKED",
        "BD_SCHEMA_MISMATCH",
        "JOURNAL_DISABLED",
        "JOURNAL_TRUNCATED",
        "BD_PARSE_FAILED",
        "BD_OUTPUT_TOO_LARGE",
        "WRITE_CONFLICT",
        "INTERNAL",
    ];

    assert_eq!(BridgeErrorCode::ALL.len(), EXPECTED.len());
    for code in BridgeErrorCode::ALL {
        let wire = serde_json::to_value(code).expect("code serializes");
        assert_eq!(wire, Value::String(code.as_str().to_owned()));
        assert!(EXPECTED.contains(&code.as_str()), "unexpected {code:?}");

        let parsed: BridgeErrorCode =
            serde_json::from_value(wire).expect("code deserializes from its wire value");
        assert_eq!(parsed, code);
    }
}

#[test]
fn bridge_error_serializes_detail_and_displays_the_code() {
    let mut detail = Map::new();
    detail.insert("exit_code".to_owned(), json!(13));

    let error = BridgeError::new(
        BridgeErrorCode::WriteConflict,
        "issue changed while you were editing",
    )
    .with_detail(detail);

    assert_eq!(
        error.to_string(),
        "WRITE_CONFLICT: issue changed while you were editing"
    );

    let value = serde_json::to_value(&error).expect("error serializes");
    assert_eq!(value["code"], json!("WRITE_CONFLICT"));
    assert_eq!(value["detail"]["exit_code"], json!(13));

    let parsed: BridgeError = serde_json::from_value(value).expect("error deserializes");
    assert_eq!(parsed, error);
}

#[test]
fn fixtures_contain_no_machine_specific_paths() {
    for fixture in [
        "export-statuses.json",
        "export-relations.json",
        "events-writes.jsonl",
        "context.json",
    ] {
        let text = read_fixture(fixture);
        assert!(!text.contains("D:\\"), "{fixture} contains a D: path");
        assert!(!text.contains("C:\\"), "{fixture} contains a C: path");
    }
}
