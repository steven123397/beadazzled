//! Test stub for the bridge process layer.
//!
//! Behaviour is selected with `FAKE_BD_MODE`. Tests pass overrides through
//! `ProcessRequest::env`, so they never mutate the test process environment
//! (which would race with other tests).
//!
//! Modes:
//! - `bd-like` (default): emulate the bd commands BdBridge uses
//! - `ok`: print `ok` and exit 0 (optionally sleep `FAKE_BD_SLEEP_MS`)
//! - `dump-argv`: print the received argv as JSON
//! - `dump-argv-and-stdin`: print argv plus the number of stdin bytes
//! - `record`: capture argv/stdin to `FAKE_BD_CAPTURE_FILE`, then write
//!   `FAKE_BD_STDOUT` (or `FAKE_BD_STDOUT_FILE`) and exit `FAKE_BD_EXIT`
//! - `cat-file`: write `FAKE_BD_STDOUT_FILE` to stdout
//! - `exit`: print `FAKE_BD_STDERR` and exit with `FAKE_BD_EXIT`
//! - `pid-and-sleep`: write the pid to `FAKE_BD_PID_FILE`, then sleep
//! - `hang-with-grandchild`: spawn a grandchild that inherits stdout, then sleep
//! - `exit-with-grandchild`: spawn a grandchild that inherits stdout, then exit
//! - `sleep-long`: sleep for `FAKE_BD_SLEEP_MS` (used by the grandchild modes)
//! - `stream`: print JSON lines every `FAKE_BD_STREAM_INTERVAL_MS`
//! - `log-interval`: sleep, then write start/end timestamps to `FAKE_BD_LOG_DIR`
//! - `stderr-flood`: write `FAKE_BD_STDERR_BYTES` bytes to stderr
//! - `large`: write `FAKE_BD_OUTPUT_BYTES` bytes with optional newlines

use std::env;
use std::fs;
use std::io::{self, Read, Write};
use std::process::{self, Child, Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

fn main() {
    let mode = env::var("FAKE_BD_MODE").unwrap_or_else(|_| "bd-like".to_owned());
    let args: Vec<String> = env::args().skip(1).collect();

    match mode.as_str() {
        "bd-like" => {
            let command_index = args
                .iter()
                .position(|arg| arg == "-C")
                .map(|index| index + 2)
                .unwrap_or(0);
            let command = args.get(command_index).map(String::as_str).unwrap_or("");
            let workspace = command_index
                .checked_sub(1)
                .and_then(|index| args.get(index))
                .map(String::as_str)
                .unwrap_or("");

            match command {
                "--version" => {
                    if args.iter().any(|arg| arg == "-C") {
                        eprintln!("cannot use -C directory: no beads project found");
                        process::exit(1);
                    }
                    println!("bd version 1.3.2 (9b65b9e19)");
                }
                "context" => {
                    if workspace.to_lowercase().contains("not-beads") {
                        eprintln!("Error: not a beads workspace");
                        process::exit(1);
                    }
                    print_fixture_with_workspace("context.json", workspace);
                }
                "export" => print_fixture("export-relations.json"),
                "events" => {
                    let lowercase = workspace.to_lowercase();
                    let root = std::path::Path::new(workspace);
                    if root.join("journal-argv").exists() {
                        write_journal_argv(workspace, &args);
                    }
                    if lowercase.contains("journal-disabled") {
                        eprintln!("note: the events journal is disabled for this workspace");
                    } else if lowercase.contains("journal-truncated") {
                        println!(
                            "{{\"code\":\"events_journal_truncated\",\"since\":1,\"floor\":5,\"head\":9}}"
                        );
                    } else if root.join("journal-hang").exists() {
                        stream_journal_hang(workspace);
                    } else if root.join("journal-split").exists() {
                        stream_journal_split();
                    } else if let Some(contents) = journal_file(workspace) {
                        if root.join("journal-pid").exists() {
                            fs::write(root.join("journal.pid"), process::id().to_string())
                                .expect("write the journal pid");
                        }
                        if root.join("journal-slow").exists() {
                            stream_journal_slow(workspace, &contents);
                        } else {
                            io::stdout()
                                .write_all(&contents)
                                .expect("write journal file");
                            io::stdout().flush().expect("flush journal file");
                        }
                    } else {
                        print_fixture("events-writes.jsonl");
                    }
                }
                "config" => println!("true"),
                "create" => println!("bza-new"),
                "update" => {
                    if args.iter().any(|arg| arg == "stale") {
                        eprintln!("Error: precondition no longer held");
                        process::exit(13);
                    }
                }
                "close" | "reopen" | "comment" => {}
                other => {
                    eprintln!("fake_bd: bd-like unknown command {other}");
                    process::exit(2);
                }
            }
        }
        "ok" => {
            sleep_ms(env_u64("FAKE_BD_SLEEP_MS", 0));
            println!("ok");
        }
        "dump-argv" => {
            println!("{}", serde_json::json!({ "args": args }));
        }
        "dump-argv-and-stdin" => {
            let mut input = Vec::new();
            io::stdin().read_to_end(&mut input).expect("read stdin");
            println!(
                "{}",
                serde_json::json!({ "args": args, "stdin_len": input.len() })
            );
        }
        "record" => {
            let mut input = Vec::new();
            io::stdin().read_to_end(&mut input).expect("read stdin");

            if let Some(path) = env::var_os("FAKE_BD_CAPTURE_FILE") {
                let capture = serde_json::json!({
                    "args": args,
                    "stdin": String::from_utf8_lossy(&input),
                    "stdin_len": input.len(),
                });
                fs::write(path, capture.to_string()).expect("write capture file");
            }

            if let Some(path) = env::var_os("FAKE_BD_STDOUT_FILE") {
                let bytes = fs::read(path).expect("read stdout fixture");
                io::stdout().write_all(&bytes).expect("write stdout");
            } else if let Ok(stdout) = env::var("FAKE_BD_STDOUT") {
                print!("{stdout}");
            }

            if let Ok(stderr) = env::var("FAKE_BD_STDERR") {
                eprint!("{stderr}");
            }
            io::stdout().flush().expect("flush stdout");

            let code = env_u64("FAKE_BD_EXIT", 0) as i32;
            if code != 0 {
                process::exit(code);
            }
        }
        "cat-file" => {
            let path = env::var_os("FAKE_BD_STDOUT_FILE").expect("FAKE_BD_STDOUT_FILE is set");
            let bytes = fs::read(path).expect("read stdout fixture");
            io::stdout().write_all(&bytes).expect("write stdout");
            io::stdout().flush().expect("flush stdout");

            if let Ok(stderr) = env::var("FAKE_BD_STDERR") {
                eprint!("{stderr}");
            }

            let code = env_u64("FAKE_BD_EXIT", 0) as i32;
            if code != 0 {
                process::exit(code);
            }
        }
        "exit" => {
            eprint!(
                "{}",
                env::var("FAKE_BD_STDERR").unwrap_or_else(|_| "fake failure".to_owned())
            );
            process::exit(env_u64("FAKE_BD_EXIT", 1) as i32);
        }
        "pid-and-sleep" => {
            write_marker(env::var_os("FAKE_BD_START_AT_FILE"));
            write_pid(env::var_os("FAKE_BD_PID_FILE"));
            sleep_ms(env_u64("FAKE_BD_SLEEP_MS", 60_000));
        }
        "hang-with-grandchild" => {
            write_pid(env::var_os("FAKE_BD_PID_FILE"));
            let grandchild = spawn_self("sleep-long", &args);
            if let Some(path) = env::var_os("FAKE_BD_GRANDCHILD_PID_FILE") {
                fs::write(path, grandchild.id().to_string()).expect("write grandchild pid");
            }
            // Deliberately orphan the grandchild: it must outlive this process
            // so the bridge can observe a pipe held open. The bridge's Job
            // Object owns its lifetime.
            std::mem::forget(grandchild);
            sleep_ms(env_u64("FAKE_BD_SLEEP_MS", 60_000));
        }
        "exit-with-grandchild" => {
            let grandchild = spawn_self("sleep-long", &args);
            if let Some(path) = env::var_os("FAKE_BD_GRANDCHILD_PID_FILE") {
                fs::write(path, grandchild.id().to_string()).expect("write grandchild pid");
            }
            write_marker(env::var_os("FAKE_BD_EXIT_AT_FILE"));
            // Return without waiting: the grandchild keeps stdout open. The
            // bridge's Job Object owns its lifetime.
            std::mem::forget(grandchild);
        }
        "sleep-long" => {
            sleep_ms(env_u64("FAKE_BD_SLEEP_MS", 60_000));
        }
        "invalid-utf8" => {
            io::stdout()
                .write_all(&[0xff, 0xfe, b'\n'])
                .expect("write invalid UTF-8");
        }
        "stream" => {
            let count = env_u64("FAKE_BD_STREAM_COUNT", 20);
            let interval = env_u64("FAKE_BD_STREAM_INTERVAL_MS", 50);
            for index in 0..count {
                println!(
                    "{}",
                    serde_json::json!({
                        "seq": index,
                        "ts": "2026-11-01T00:00:00Z",
                        "op": "create",
                        "issue_id": "fx-live",
                        "issue": null,
                    })
                );
                io::stdout().flush().expect("flush stdout");
                sleep_ms(interval);
            }
        }
        "log-interval" => {
            let start = now_ms();
            sleep_ms(env_u64("FAKE_BD_SLEEP_MS", 200));
            let end = now_ms();
            let dir = env::var("FAKE_BD_LOG_DIR").expect("FAKE_BD_LOG_DIR is set");
            let record = serde_json::json!({
                "pid": process::id(),
                "start": start,
                "end": end,
                "args": args,
            });
            fs::create_dir_all(&dir).expect("create log dir");
            fs::write(format!("{dir}/{}.json", process::id()), record.to_string())
                .expect("write interval log");
        }
        "stderr-flood" => {
            let bytes = env_u64("FAKE_BD_STDERR_BYTES", 128 * 1024) as usize;
            let mut stderr = io::stderr().lock();
            stderr
                .write_all(b"flood-start\n")
                .expect("write stderr marker");
            let chunk = [b'e'; 1024];
            let mut remaining = bytes;
            while remaining > 0 {
                let take = remaining.min(chunk.len());
                stderr
                    .write_all(&chunk[..take])
                    .expect("write stderr flood");
                remaining -= take;
            }
            stderr.flush().expect("flush stderr");
        }
        "large" => {
            let bytes = env_u64("FAKE_BD_OUTPUT_BYTES", 4096) as usize;
            let newline_every = env_u64("FAKE_BD_NEWLINE_EVERY", 0) as usize;
            write_large(bytes, newline_every);
        }
        other => {
            eprintln!("fake_bd: unknown mode {other}");
            process::exit(2);
        }
    }
}

fn print_fixture(name: &str) {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/fixtures/bd")
        .join(name);
    let bytes = fs::read(&path).expect("read fixture");
    io::stdout().write_all(&bytes).expect("write fixture");
    io::stdout().flush().expect("flush fixture");
}

/// Prints a fixture with every `<workspace>` placeholder replaced by the
/// `-C` argument, so `context` reports the workspace the caller asked about.
/// Streams a journal one line at a time; used by the backfill deadline test.
/// The `journal-done` marker only appears when the stream runs to completion,
/// so a killed reader leaves no marker behind.
fn stream_journal_slow(workspace: &str, contents: &[u8]) {
    for line in contents.split(|byte| *byte == b'\n') {
        if line.is_empty() {
            continue;
        }
        io::stdout().write_all(line).expect("write journal line");
        io::stdout().write_all(b"\n").expect("write newline");
        io::stdout().flush().expect("flush journal line");
        std::thread::sleep(Duration::from_millis(25));
    }
    let _ = fs::write(
        std::path::Path::new(workspace).join("journal-done"),
        b"done",
    );
}

/// Writes the received argv so a test can assert which flags bd was given.
fn write_journal_argv(workspace: &str, args: &[String]) {
    let path = std::path::Path::new(workspace).join("journal-argv.json");
    let record = serde_json::json!({ "args": args });
    fs::write(path, record.to_string()).expect("write argv capture");
}

/// Writes the first journal record, then holds stdout open and stays silent.
/// A reader blocked here can only be released by terminating the process.
fn stream_journal_hang(workspace: &str) {
    if let Some(contents) = journal_file(workspace) {
        if let Some(line) = contents
            .split(|byte| *byte == b'\n')
            .find(|line| !line.is_empty())
        {
            let mut stdout = io::stdout();
            stdout
                .write_all(line)
                .expect("write the first journal line");
            stdout.write_all(b"\n").expect("write the newline");
            stdout.flush().expect("flush the first journal line");
        }
    }
    sleep_ms(60_000);
}

/// Writes one record in two flushes, so the reader sees a half line first.
fn stream_journal_split() {
    let record = serde_json::json!({
        "seq": 1,
        "ts": "2026-11-01T00:00:00Z",
        "op": "update",
        "issue_id": "fx-split",
        "issue": {
            "id": "fx-split",
            "title": "Split across reads",
            "description": "x".repeat(10 * 1024),
            "status": "open",
            "priority": 2,
            "issue_type": "task",
            "created_at": "2026-11-01T00:00:00Z",
            "updated_at": "2026-11-01T00:00:00Z"
        }
    })
    .to_string();
    let split = record.len() / 2;
    let mut stdout = io::stdout();
    stdout
        .write_all(&record.as_bytes()[..split])
        .expect("write the first half");
    stdout.flush().expect("flush the first half");
    std::thread::sleep(Duration::from_millis(150));
    stdout
        .write_all(&record.as_bytes()[split..])
        .expect("write the second half");
    stdout.write_all(b"\n").expect("write the newline");
    stdout.flush().expect("flush the second half");
}

/// A workspace-local `journal.jsonl` stands in for bd's journal in the data
/// plane integration test; appending a line simulates the record a write emits.
fn journal_file(workspace: &str) -> Option<Vec<u8>> {
    fs::read(std::path::Path::new(workspace).join("journal.jsonl")).ok()
}

fn print_fixture_with_workspace(name: &str, workspace: &str) {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/fixtures/bd")
        .join(name);
    let fixture = fs::read_to_string(&path).expect("read fixture");
    let escaped = serde_json::to_string(workspace).expect("escape workspace");
    let rendered = fixture.replace("<workspace>", escaped.trim_matches('"'));
    io::stdout()
        .write_all(rendered.as_bytes())
        .expect("write fixture");
    io::stdout().flush().expect("flush fixture");
}

fn spawn_self(mode: &str, args: &[String]) -> Child {
    let exe = env::current_exe().expect("current executable");
    Command::new(exe)
        .args(args)
        .env("FAKE_BD_MODE", mode)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("spawn fake_bd grandchild")
}

fn write_pid(path: Option<std::ffi::OsString>) {
    if let Some(path) = path {
        fs::write(path, process::id().to_string()).expect("write pid file");
    }
}

fn write_marker(path: Option<std::ffi::OsString>) {
    if let Some(path) = path {
        fs::write(path, now_ms().to_string()).expect("write timestamp marker");
    }
}

fn write_large(bytes: usize, newline_every: usize) {
    let mut stdout = io::stdout().lock();
    let chunk = [b'x'; 1024];
    let mut remaining = bytes;
    let mut since_newline = 0usize;

    while remaining > 0 {
        let mut take = remaining.min(chunk.len());
        if newline_every > 0 {
            take = take.min(newline_every - since_newline);
        }
        stdout.write_all(&chunk[..take]).expect("write stdout");
        remaining -= take;
        since_newline += take;

        if newline_every > 0 && since_newline == newline_every {
            stdout.write_all(b"\n").expect("write newline");
            since_newline = 0;
        }
    }
    stdout.flush().expect("flush stdout");
}

fn sleep_ms(milliseconds: u64) {
    if milliseconds > 0 {
        std::thread::sleep(Duration::from_millis(milliseconds));
    }
}

fn env_u64(key: &str, default: u64) -> u64 {
    env::var(key)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is after the epoch")
        .as_millis() as u64
}
