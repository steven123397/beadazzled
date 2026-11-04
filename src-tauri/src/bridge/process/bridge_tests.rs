//! Process-layer and end-to-end tests driven by `examples/fake_bd`.
//!
//! These exercise timeouts, job-object tree kill, pipe grace, output limits,
//! per-workspace serialization and the WriteCommand -> argv -> process ->
//! parse chain. A real `bd` is never spawned.
//!
//! They live inside the crate so `process` and `parse` can stay private
//! (bza-ryr.25); the integration-test equivalents were removed.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::Value;
use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
use windows_sys::Win32::System::Threading::{
    GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
};

use super::{
    workspace_lock, LineCursor, OutputBudget, OutputLimits, ProcessRequest, ProcessRunner,
    ScanBounds, ScanStop, PIPE_GRACE,
};
use crate::bridge::argv::{argv_for, CreateSpec, WriteCommand};
use crate::bridge::error::{map_exit, BridgeError, BridgeErrorCode};
use crate::bridge::parse::{parse_export, JournalStream};
use crate::bridge::test_support::{env, fake_bd, runner, temp_dir, workspace};

fn request(workspace: &Path, mode: &str) -> ProcessRequest {
    let mut request = ProcessRequest::new("test", workspace, Vec::new());
    request.timeout = Duration::from_secs(5);
    request.env.push(env("FAKE_BD_MODE", mode));
    request
}

#[test]
fn workspace_commands_run_with_the_workspace_as_cwd() {
    let dir = temp_dir("cwd");
    let workspace = workspace(&dir);

    let output = runner()
        .run(&request(&workspace, "cwd"))
        .expect("fake_bd reports its cwd");

    assert_eq!(Path::new(output.stdout.trim()), workspace.as_path());
}

fn detail<'a>(error: &'a BridgeError, key: &str) -> Option<&'a Value> {
    error.detail.as_ref()?.0.get(key)
}

fn process_is_running(pid: u32) -> bool {
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

fn read_pid(path: &Path) -> u32 {
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        if let Ok(text) = fs::read_to_string(path) {
            if let Ok(pid) = text.trim().parse() {
                return pid;
            }
        }
        assert!(
            Instant::now() < deadline,
            "pid file {} was never written",
            path.display()
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn wait_for_exit(pid: u32) -> bool {
    let deadline = Instant::now() + Duration::from_secs(2);
    while Instant::now() < deadline {
        if !process_is_running(pid) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    !process_is_running(pid)
}

fn read_intervals(log_dir: &Path) -> Vec<(u64, u64)> {
    let mut intervals = Vec::new();
    for entry in fs::read_dir(log_dir).expect("read log dir") {
        let path = entry.expect("log entry").path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
            continue;
        }
        let value: Value = serde_json::from_str(&fs::read_to_string(path).expect("read log"))
            .expect("log is JSON");
        intervals.push((
            value["start"].as_u64().expect("start"),
            value["end"].as_u64().expect("end"),
        ));
    }
    intervals
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock is after the epoch")
        .as_millis() as u64
}

fn read_ms(path: &Path) -> u64 {
    fs::read_to_string(path)
        .unwrap_or_else(|error| panic!("read {}: {error}", path.display()))
        .trim()
        .parse()
        .expect("marker contains epoch milliseconds")
}

#[test]
fn argv_is_passed_verbatim_with_an_explicit_workspace_and_stdin() {
    let dir = temp_dir("argv");
    let workspace = workspace(&dir);
    let special = "中文 \"quoted\" & | line\nbreak";
    let mut request = request(&workspace, "dump-argv-and-stdin");
    request.args = vec!["--title".into(), special.into()];
    request.stdin = Some(vec![b'x'; 10 * 1024]);

    let output = runner().run(&request).expect("fake_bd succeeds");
    let value: Value = serde_json::from_str(output.stdout.trim()).expect("stdout is JSON");
    let args: Vec<String> = value["args"]
        .as_array()
        .expect("args array")
        .iter()
        .map(|arg| arg.as_str().expect("string arg").to_owned())
        .collect();

    assert_eq!(args[0], "-C");
    assert_eq!(args[1], workspace.display().to_string());
    assert_eq!(args[2], "--title");
    assert_eq!(args[3], special);
    assert_eq!(value["stdin_len"], 10 * 1024);
    assert!(args.iter().all(|arg| !arg.starts_with("xxxx")));
    assert_eq!(output.exit_code, 0);
    assert!(output.stderr.is_empty());
}

#[test]
fn nonzero_exit_is_returned_to_the_caller() {
    let dir = temp_dir("exit");
    let workspace = workspace(&dir);
    let mut request = request(&workspace, "exit");
    request.env.push(env("FAKE_BD_EXIT", "13"));
    request.env.push(env("FAKE_BD_STDERR", "guarded failure"));

    let output = runner()
        .run(&request)
        .expect("a nonzero exit is still output");

    assert_eq!(output.exit_code, 13);
    assert_eq!(output.stderr, "guarded failure");
}

#[test]
fn a_missing_bd_path_maps_to_bd_not_found() {
    let dir = temp_dir("missing");
    let workspace = workspace(&dir);
    let runner = ProcessRunner::new(dir.join("does-not-exist-bd"));

    let error = runner
        .run(&request(&workspace, "ok"))
        .expect_err("the bd path does not exist");

    assert_eq!(error.code, BridgeErrorCode::BdNotFound);
    assert_eq!(
        detail(&error, "path").and_then(Value::as_str),
        Some(dir.join("does-not-exist-bd").display().to_string().as_str())
    );
}

#[test]
fn an_existing_non_executable_file_maps_to_bd_not_executable() {
    let dir = temp_dir("bad-exe");
    let workspace = workspace(&dir);
    let bd = dir.join("bd.txt");
    fs::write(&bd, "not an executable").expect("write text file");
    let runner = ProcessRunner::new(bd);

    let error = runner
        .run(&request(&workspace, "ok"))
        .expect_err("a text file cannot be executed");

    assert_eq!(error.code, BridgeErrorCode::BdNotExecutable);
}

#[test]
fn an_invalid_spawn_path_maps_to_internal() {
    let dir = temp_dir("bad-path");
    let workspace = workspace(&dir);
    let runner = ProcessRunner::new("bad\0path");

    let error = runner
        .run(&request(&workspace, "ok"))
        .expect_err("a NUL path cannot be spawned");

    assert_eq!(error.code, BridgeErrorCode::Internal);
}

#[test]
fn a_child_that_exits_without_reading_stdin_does_not_block_the_call() {
    let dir = temp_dir("stdin-close");
    let workspace = workspace(&dir);
    let mut request = request(&workspace, "exit");
    request.stdin = Some(vec![b'x'; 64 * 1024]);
    request.env.push(env("FAKE_BD_EXIT", "0"));

    let started = Instant::now();
    let output = runner()
        .run(&request)
        .expect("the child exits without reading stdin");
    let elapsed = started.elapsed();

    assert_eq!(output.exit_code, 0);
    assert!(elapsed < Duration::from_secs(1), "{elapsed:?}");
}

#[test]
fn timeout_returns_bd_timeout_within_budget_and_kills_the_process() {
    let dir = temp_dir("timeout");
    let workspace = workspace(&dir);
    let pid_file = dir.join("bd.pid");
    let start_marker = dir.join("bd-start-at");
    let runner = runner();

    let mut request = request(&workspace, "pid-and-sleep");
    request.timeout = Duration::from_millis(1000);
    request
        .env
        .push(env("FAKE_BD_PID_FILE", pid_file.as_os_str().to_owned()));
    request.env.push(env(
        "FAKE_BD_START_AT_FILE",
        start_marker.as_os_str().to_owned(),
    ));
    request.env.push(env("FAKE_BD_SLEEP_MS", "60000"));

    let error = runner.run(&request).expect_err("the call times out");
    let finished_at = now_ms();

    assert_eq!(error.code, BridgeErrorCode::BdTimeout);
    // Measure from the child's own start marker so a slow test-runner spawn
    // does not count against the bridge's timeout budget.
    let response = Duration::from_millis(finished_at.saturating_sub(read_ms(&start_marker)));
    assert!(
        response < Duration::from_millis(1500),
        "returned {response:?} after bd started"
    );
    assert_eq!(
        detail(&error, "command").and_then(Value::as_str),
        Some("test")
    );
    assert_eq!(
        detail(&error, "timeout_ms").and_then(Value::as_u64),
        Some(1000)
    );

    let pid = read_pid(&pid_file);
    assert!(wait_for_exit(pid), "pid {pid} survived the timeout");
    assert_eq!(
        runner
            .recent_calls()
            .last()
            .expect("the timeout is logged")
            .error_code,
        Some(BridgeErrorCode::BdTimeout)
    );
}

#[test]
fn timeout_kills_grandchildren_too() {
    let dir = temp_dir("tree");
    let workspace = workspace(&dir);
    let parent_pid_file = dir.join("parent.pid");
    let grandchild_pid_file = dir.join("grandchild.pid");

    let mut request = request(&workspace, "hang-with-grandchild");
    request.timeout = Duration::from_millis(1000);
    request.env.push(env(
        "FAKE_BD_PID_FILE",
        parent_pid_file.as_os_str().to_owned(),
    ));
    request.env.push(env(
        "FAKE_BD_GRANDCHILD_PID_FILE",
        grandchild_pid_file.as_os_str().to_owned(),
    ));
    request.env.push(env("FAKE_BD_SLEEP_MS", "60000"));

    let error = runner().run(&request).expect_err("the call times out");
    assert_eq!(error.code, BridgeErrorCode::BdTimeout);

    let parent = read_pid(&parent_pid_file);
    let grandchild = read_pid(&grandchild_pid_file);
    assert!(wait_for_exit(parent), "parent {parent} survived");
    assert!(
        wait_for_exit(grandchild),
        "grandchild {grandchild} survived the job kill"
    );
}

#[test]
fn a_grandchild_holding_stdout_does_not_hang_the_call() {
    let dir = temp_dir("grace");
    let workspace = workspace(&dir);
    let grandchild_pid_file = dir.join("grandchild.pid");
    let exit_marker = dir.join("parent-exit-at");

    let mut request = request(&workspace, "exit-with-grandchild");
    request.env.push(env(
        "FAKE_BD_GRANDCHILD_PID_FILE",
        grandchild_pid_file.as_os_str().to_owned(),
    ));
    request.env.push(env(
        "FAKE_BD_EXIT_AT_FILE",
        exit_marker.as_os_str().to_owned(),
    ));
    request.env.push(env("FAKE_BD_SLEEP_MS", "10000"));

    let runner = Arc::new(runner());
    let handle = std::thread::spawn(move || runner.run(&request));
    let error = handle
        .join()
        .expect("runner thread")
        .expect_err("stdout held open after exit must not return partial data");
    let finished_at = now_ms();

    assert_eq!(error.code, BridgeErrorCode::BdParseFailed);
    assert!(
        error.message.contains("stdout was still open"),
        "{}",
        error.message
    );
    let after_exit = Duration::from_millis(finished_at.saturating_sub(read_ms(&exit_marker)));
    assert!(
        after_exit < PIPE_GRACE + Duration::from_millis(500),
        "returned {after_exit:?} after the parent exited"
    );

    let grandchild = read_pid(&grandchild_pid_file);
    assert!(
        wait_for_exit(grandchild),
        "the lingering grandchild was not killed"
    );
}

#[test]
fn a_long_stdout_line_maps_to_output_too_large() {
    let dir = temp_dir("line-limit");
    let workspace = workspace(&dir);
    let mut request = request(&workspace, "large");
    request.limits = OutputLimits {
        total: 4096,
        line: 512,
        stderr: 1024,
    };
    request.env.push(env("FAKE_BD_OUTPUT_BYTES", "600"));
    request.env.push(env("FAKE_BD_NEWLINE_EVERY", "0"));

    let error = runner()
        .run(&request)
        .expect_err("a 600-byte line exceeds the 512-byte line limit");

    assert_eq!(error.code, BridgeErrorCode::BdOutputTooLarge);
    assert_eq!(
        detail(&error, "line_limit_bytes").and_then(Value::as_u64),
        Some(512)
    );
}

#[test]
fn too_much_total_stdout_maps_to_output_too_large() {
    let dir = temp_dir("total-limit");
    let workspace = workspace(&dir);
    let mut request = request(&workspace, "large");
    request.limits = OutputLimits {
        total: 500,
        line: 1000,
        stderr: 1024,
    };
    request.env.push(env("FAKE_BD_OUTPUT_BYTES", "600"));
    request.env.push(env("FAKE_BD_NEWLINE_EVERY", "300"));

    let error = runner()
        .run(&request)
        .expect_err("600 bytes exceed the 500-byte total limit");

    assert_eq!(error.code, BridgeErrorCode::BdOutputTooLarge);
    assert_eq!(
        detail(&error, "limit_bytes").and_then(Value::as_u64),
        Some(500)
    );
}

#[test]
fn invalid_utf8_stdout_maps_to_parse_failed() {
    let dir = temp_dir("utf8");
    let workspace = workspace(&dir);

    let error = runner()
        .run(&request(&workspace, "invalid-utf8"))
        .expect_err("stdout is not valid UTF-8");

    assert_eq!(error.code, BridgeErrorCode::BdParseFailed);
}

#[test]
fn stderr_is_capped_but_fully_drained() {
    let dir = temp_dir("stderr");
    let workspace = workspace(&dir);
    let mut request = request(&workspace, "exit");
    request.limits.stderr = 64;
    request.env.push(env("FAKE_BD_STDERR", "x".repeat(3000)));
    request.env.push(env("FAKE_BD_EXIT", "1"));

    let started = Instant::now();
    let output = runner().run(&request).expect("nonzero exit is output");
    let elapsed = started.elapsed();
    assert_eq!(output.stderr.len(), 64);
    assert!(
        elapsed < PIPE_GRACE,
        "stderr was not drained to EOF: {elapsed:?}"
    );
}

#[test]
fn short_calls_on_the_same_workspace_do_not_overlap() {
    let dir = temp_dir("serial");
    let workspace = workspace(&dir);
    let log_dir = dir.join("log");
    fs::create_dir_all(&log_dir).expect("create log dir");
    let runner = Arc::new(runner());

    let make_request = || {
        let mut request = request(&workspace, "log-interval");
        request
            .env
            .push(env("FAKE_BD_LOG_DIR", log_dir.as_os_str().to_owned()));
        request.env.push(env("FAKE_BD_SLEEP_MS", "250"));
        request
    };

    let first_runner = Arc::clone(&runner);
    let first = make_request();
    let first = std::thread::spawn(move || first_runner.run(&first).expect("first call"));

    let second_runner = Arc::clone(&runner);
    let second = make_request();
    let second = std::thread::spawn(move || second_runner.run(&second).expect("second call"));

    first.join().expect("first thread");
    second.join().expect("second thread");

    let mut intervals = read_intervals(&log_dir);
    intervals.sort_unstable();
    assert_eq!(intervals.len(), 2);
    assert!(
        intervals[0].1 <= intervals[1].0,
        "calls overlapped: {intervals:?}"
    );
}

#[test]
fn separate_runners_for_one_workspace_still_serialize() {
    // Every IPC call builds its own BdBridge and ProcessRunner; the lock must
    // belong to the workspace (the external resource), not to the instance.
    let dir = temp_dir("serial-across-runners");
    let workspace = workspace(&dir);
    let log_dir = dir.join("log");
    fs::create_dir_all(&log_dir).expect("create log dir");

    let make_request = || {
        let mut request = request(&workspace, "log-interval");
        request
            .env
            .push(env("FAKE_BD_LOG_DIR", log_dir.as_os_str().to_owned()));
        request.env.push(env("FAKE_BD_SLEEP_MS", "250"));
        request
    };

    let first_runner = Arc::new(runner());
    let first = make_request();
    let first = std::thread::spawn(move || first_runner.run(&first).expect("first call"));

    let second_runner = Arc::new(runner());
    let second = make_request();
    let second = std::thread::spawn(move || second_runner.run(&second).expect("second call"));

    first.join().expect("first thread");
    second.join().expect("second thread");

    let mut intervals = read_intervals(&log_dir);
    intervals.sort_unstable();
    assert_eq!(intervals.len(), 2);
    assert!(
        intervals[0].1 <= intervals[1].0,
        "calls from separate runners overlapped: {intervals:?}"
    );
}

#[test]
fn the_line_cursor_stops_exactly_at_the_limit() {
    let mut seen = 0;
    let mut cursor = LineCursor {
        max: Some(2),
        seen: &mut seen,
    };

    assert!(!cursor.count(b"one\n"), "one line is below the limit");
    assert!(cursor.count(b"two\n"), "the second line reaches the limit");
    assert_eq!(seen, 2);
}

#[test]
fn scans_wait_for_the_workspace_lock() {
    let dir = temp_dir("scan-lock");
    let workspace = workspace(&dir);
    let runner = Arc::new(runner());
    let request = request(&workspace, "ok");

    let lock = workspace_lock(&workspace);
    let guard = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let scan = std::thread::spawn(move || runner.run_scan(&request, ScanBounds { max_lines: 10 }));

    std::thread::sleep(Duration::from_millis(200));
    assert!(
        !scan.is_finished(),
        "a bounded scan is a short call and must wait for the workspace lock"
    );
    drop(guard);

    let output = scan.join().expect("scan thread").expect("scan completes");
    assert_eq!(output.stop, ScanStop::Eof);
}

#[test]
fn different_spellings_of_one_workspace_share_the_lock() {
    let dir = temp_dir("workspace-spelling");
    let ws = workspace(&dir);
    let log_dir = dir.join("log");
    fs::create_dir_all(&log_dir).expect("create log dir");
    let runner = Arc::new(runner());

    let make_request = |workspace: PathBuf| {
        let mut request = request(&workspace, "log-interval");
        request
            .env
            .push(env("FAKE_BD_LOG_DIR", log_dir.as_os_str().to_owned()));
        request.env.push(env("FAKE_BD_SLEEP_MS", "250"));
        request
    };

    let first_workspace = PathBuf::from(format!("{}\\", ws.display()));
    let second_workspace = PathBuf::from(ws.display().to_string().to_uppercase());

    let first_runner = Arc::clone(&runner);
    let first = make_request(first_workspace);
    let first = std::thread::spawn(move || first_runner.run(&first).expect("first call"));

    let second_runner = Arc::clone(&runner);
    let second = make_request(second_workspace);
    let second = std::thread::spawn(move || second_runner.run(&second).expect("second call"));

    first.join().expect("first thread");
    second.join().expect("second thread");

    let mut intervals = read_intervals(&log_dir);
    intervals.sort_unstable();
    assert_eq!(intervals.len(), 2);
    assert!(
        intervals[0].1 <= intervals[1].0,
        "same workspace overlapped across spellings: {intervals:?}"
    );
}

#[test]
fn follow_processes_bypass_the_workspace_semaphore() {
    let dir = temp_dir("follow");
    let workspace = workspace(&dir);
    let runner = Arc::new(runner());

    let mut follow_request = request(&workspace, "stream");
    follow_request.env.push(env("FAKE_BD_STREAM_COUNT", "60"));
    follow_request
        .env
        .push(env("FAKE_BD_STREAM_INTERVAL_MS", "50"));
    let mut follow = runner.spawn_follow(&follow_request).expect("follow starts");
    let _stdout = follow.take_stdout().expect("follow exposes stdout");

    let mut short_request = request(&workspace, "ok");
    short_request.env.push(env("FAKE_BD_SLEEP_MS", "100"));
    let started = Instant::now();
    let output = runner
        .run(&short_request)
        .expect("a short call runs while follow is alive");
    let elapsed = started.elapsed();

    assert_eq!(output.stdout.trim(), "ok");
    assert!(elapsed < Duration::from_secs(1), "{elapsed:?}");
    assert!(
        follow.try_wait().expect("try_wait").is_none(),
        "follow should still be running"
    );

    follow.kill().expect("kill follow");
    assert!(follow.try_wait().expect("try_wait").is_some());
}

#[test]
fn follow_drains_stderr_so_a_chatty_child_cannot_block() {
    let dir = temp_dir("follow-stderr");
    let workspace = workspace(&dir);
    let mut request = request(&workspace, "stderr-flood");
    request.env.push(env("FAKE_BD_STDERR_BYTES", "131072"));
    let mut follow = runner().spawn_follow(&request).expect("follow starts");

    let deadline = Instant::now() + Duration::from_secs(2);
    let mut status = None;
    while Instant::now() < deadline {
        status = follow.try_wait().expect("try_wait");
        if status.is_some() {
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(status.is_some(), "follow blocked on a full stderr pipe");

    let stderr = follow.stderr_lossy();
    assert!(stderr.contains("flood-start"), "{stderr}");
    assert!(follow.stderr_snapshot().len() <= 2048);

    follow.kill().expect("kill follow");
}

#[test]
fn recent_calls_record_command_argv_duration_and_exit() {
    let dir = temp_dir("log");
    let workspace = workspace(&dir);
    let runner = runner();
    let mut request = request(&workspace, "ok");
    request.command = "version".to_owned();
    request.args = vec!["--version".into()];

    runner.run(&request).expect("fake_bd succeeds");

    let calls = runner.recent_calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].command, "version");
    assert!(calls[0].argv_summary.contains("--version"));
    assert_eq!(calls[0].exit_code, Some(0));
    assert_eq!(calls[0].error_code, None);
    assert!(calls[0].duration > Duration::ZERO);
}

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

#[test]
fn output_budget_resets_the_line_counter_after_a_newline() {
    let limits = OutputLimits {
        total: 1024,
        line: 8,
        stderr: 64,
    };
    let mut budget = OutputBudget::default();

    assert!(budget.push(b"12345678\n", limits));
    assert!(
        budget.push(b"12345678", limits),
        "the newline must reset the line counter"
    );
    assert_eq!(budget.total(), 17);
    assert!(
        !budget.push(b"9", limits),
        "a ninth byte on the new line exceeds the cap"
    );
}

#[test]
fn multibyte_stderr_is_capped_on_a_byte_boundary_without_panicking() {
    for (limit, expected) in [(5usize, "中\u{FFFD}"), (3, "中")] {
        let dir = temp_dir(&format!("stderr-multibyte-{limit}"));
        let workspace = workspace(&dir);
        let mut request = request(&workspace, "exit");
        request.limits.stderr = limit;
        request.env.push(env("FAKE_BD_STDERR", "中文"));
        request.env.push(env("FAKE_BD_EXIT", "1"));

        let output = runner().run(&request).expect("nonzero exit is output");

        assert_eq!(output.stderr, expected, "stderr limit {limit}");
        assert!(
            output.stderr.len() <= limit + 3,
            "lossy output must stay bounded: {}",
            output.stderr.len()
        );
    }
}

#[test]
fn journal_reader_returns_follow_records_before_the_child_exits() {
    let dir = temp_dir("follow-live");
    let workspace = workspace(&dir);
    let mut request = request(&workspace, "stream");
    request.env.push(env("FAKE_BD_STREAM_COUNT", "30"));
    request.env.push(env("FAKE_BD_STREAM_INTERVAL_MS", "200"));

    let mut process = runner().spawn_follow(&request).expect("follow starts");
    let stdout = process.take_stdout().expect("follow exposes stdout");
    let mut reader = crate::bridge::JournalReader::follow(process, stdout);

    let started = Instant::now();
    let records = reader.next_batch().expect("the first record arrives");
    let elapsed = started.elapsed();

    assert_eq!(records.first().expect("one record").seq, 0);
    assert!(
        elapsed < Duration::from_secs(2),
        "next_batch waited for the child to exit: {elapsed:?}"
    );

    drop(reader);
}

#[test]
fn runners_with_one_log_share_their_history() {
    // The diagnostics screen relies on this: sync, writes and an explicit
    // refresh each build their own bridge, and the report must see them all.
    let log = shared_log();
    let bd = fake_bd();
    let first = ProcessRunner::with_log(&bd, Arc::clone(&log));
    let second = ProcessRunner::with_log(&bd, Arc::clone(&log));
    let request = ProcessRequest::global("version", vec![std::ffi::OsString::from("--version")]);

    first.run(&request).expect("first version call");
    second.run(&request).expect("second version call");

    let calls = log.lock().expect("call log");
    assert_eq!(calls.len(), 2);
    assert!(calls.iter().all(|call| call.command == "version"));
}

fn shared_log() -> super::CallLog {
    Arc::new(std::sync::Mutex::new(std::collections::VecDeque::new()))
}
