//! End-to-end bridge tests: WriteCommand -> argv -> process -> parse/map.
//!
//! Every step runs against `examples/fake_bd`; a real `bd` is never spawned.

mod common;

use std::fs;
use std::path::{Path, PathBuf};

use beadazzled_lib::bridge::argv::{argv_for, CreateSpec, WriteCommand};
use beadazzled_lib::bridge::parse::{parse_export, JournalStream};
use beadazzled_lib::bridge::process::ProcessRequest;
use beadazzled_lib::bridge::{map_exit, BridgeErrorCode};
use serde_json::Value;

use common::{env, runner, temp_dir, workspace};

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/fixtures/bd")
        .join(name)
}

#[test]
fn create_round_trips_through_argv_process_and_stdin() {
    let dir = temp_dir("integration-create");
    let ws = workspace(&dir);
    let capture = dir.join("capture.json");
    let description = format!("中文 \"quoted\" & |\n{}", "x".repeat(64 * 1024));

    let command = WriteCommand::Create(CreateSpec {
        title: "Integration title".to_owned(),
        description: description.clone(),
        issue_type: "task".to_owned(),
        priority: 1,
        labels: vec!["integration".to_owned()],
        acceptance: Some("round trips".to_owned()),
        assignee: None,
    });
    let mut argv = argv_for(&command);

    let mut request = ProcessRequest::new("create", &ws, argv.args.clone());
    request.stdin = argv.stdin.take();
    request.env.push(env("FAKE_BD_MODE", "record"));
    request
        .env
        .push(env("FAKE_BD_CAPTURE_FILE", capture.as_os_str().to_owned()));
    request.env.push(env("FAKE_BD_STDOUT", "bza-new\n"));

    let output = runner().run(&request).expect("fake_bd succeeds");
    assert_eq!(output.exit_code, 0);
    assert_eq!(output.stdout, "bza-new\n");

    let captured: Value =
        serde_json::from_str(&fs::read_to_string(&capture).expect("read capture"))
            .expect("capture is JSON");
    let args: Vec<String> = captured["args"]
        .as_array()
        .expect("args array")
        .iter()
        .map(|arg| arg.as_str().expect("string arg").to_owned())
        .collect();

    assert_eq!(args[0], "-C");
    assert_eq!(args[1], ws.display().to_string());
    assert!(args.iter().any(|arg| arg == "create"));
    assert!(args.iter().any(|arg| arg == "--silent"));
    assert!(args.iter().all(|arg| arg != &description));
    assert_eq!(
        captured["stdin_len"].as_u64(),
        Some(description.len() as u64)
    );
    assert_eq!(captured["stdin"].as_str(), Some(description.as_str()));
}

#[test]
fn export_fixture_round_trips_through_process_and_parser() {
    let dir = temp_dir("integration-export");
    let ws = workspace(&dir);
    let mut request = ProcessRequest::new("export", &ws, vec!["export".into()]);
    request.env.push(env("FAKE_BD_MODE", "cat-file"));
    request.env.push(env(
        "FAKE_BD_STDOUT_FILE",
        fixture("export-relations.json").as_os_str().to_owned(),
    ));

    let output = runner().run(&request).expect("fake_bd streams the fixture");

    assert_eq!(output.exit_code, 0);
    let issues = parse_export(output.stdout.as_bytes()).expect("fixture parses");
    assert_eq!(issues.len(), 7);
}

#[test]
fn journal_fixture_round_trips_through_process_and_stream() {
    let dir = temp_dir("integration-journal");
    let ws = workspace(&dir);
    let mut request = ProcessRequest::new(
        "journal",
        &ws,
        vec!["events".into(), "tail".into(), "--json".into()],
    );
    request.env.push(env("FAKE_BD_MODE", "cat-file"));
    request.env.push(env(
        "FAKE_BD_STDOUT_FILE",
        fixture("events-writes.jsonl").as_os_str().to_owned(),
    ));

    let output = runner().run(&request).expect("fake_bd streams the fixture");
    let bytes = output.stdout.as_bytes();
    let mut stream = JournalStream::new();
    let mut records = Vec::new();
    for chunk in bytes.chunks(bytes.len() / 3 + 1) {
        records.extend(stream.push(chunk).expect("chunk parses"));
    }

    assert_eq!(records.len(), 13);
    assert!(!stream.has_partial());
}

#[test]
fn a_stale_write_maps_exit_13_to_write_conflict() {
    let dir = temp_dir("integration-conflict");
    let ws = workspace(&dir);
    let mut request = ProcessRequest::new(
        "write",
        &ws,
        vec![
            "update".into(),
            "bza-1".into(),
            "-s".into(),
            "closed".into(),
        ],
    );
    request.env.push(env("FAKE_BD_MODE", "record"));
    request.env.push(env("FAKE_BD_EXIT", "13"));
    request
        .env
        .push(env("FAKE_BD_STDERR", "Error: precondition no longer held"));

    let output = runner().run(&request).expect("a nonzero exit is output");
    assert_eq!(output.exit_code, 13);

    let error = map_exit(output.exit_code, &output.stderr);
    assert_eq!(error.code, BridgeErrorCode::WriteConflict);
}
