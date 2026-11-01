//! Typed bridge between the app and the `bd` CLI.
//!
//! This module is the only place allowed to spawn `bd` (enforced by
//! `npm run check:boundaries`). [`BdBridge`] is the single typed entry for
//! sync/writes/workspace; the lower-level modules are implementation details.

pub mod argv;
pub mod error;
mod parse;
mod process;
#[cfg(test)]
mod test_support;
pub mod types;

use std::ffi::OsString;
use std::io::Read;
use std::path::PathBuf;
use std::process::ChildStdout;
use std::time::Duration;

use serde_json::{Map, Value};

use self::parse::{journal_disabled, journal_truncated, parse_export, JournalStream};
use self::process::{
    FollowProcess, ProcessRequest, ProcessRunner, READ_TIMEOUT, VERSION_TIMEOUT, WRITE_TIMEOUT,
};

pub use argv::{argv_for, Argv, AssigneeChange, CreateSpec, UpdateSpec, WriteCommand};
pub use error::{map_exit, BridgeError, BridgeErrorCode};
pub use process::CallRecord;
pub use types::{
    Comment, Dependency, Issue, JournalComment, JournalDep, JournalOp, JournalRecord,
    WorkspaceContext,
};

const MIN_BD_VERSION: (u32, u32, u32) = (1, 3, 2);
const JOURNAL_PREFIX_LIMIT: usize = 8 * 1024;

/// The typed entry point for all bd access.
#[derive(Debug)]
pub struct BdBridge {
    runner: ProcessRunner,
    workspace: PathBuf,
}

impl BdBridge {
    pub fn new(bd_path: impl Into<PathBuf>, workspace: impl Into<PathBuf>) -> Self {
        Self {
            runner: ProcessRunner::new(bd_path),
            workspace: workspace.into(),
        }
    }

    /// `bd --version` without `-C`; bd 1.3.2 rejects `-C` outside a workspace.
    pub fn version(&self) -> Result<BdVersion, BridgeError> {
        let mut request = ProcessRequest::global("version", vec![OsString::from("--version")]);
        request.timeout = VERSION_TIMEOUT;
        let output = self.runner.run(&request)?;
        if output.exit_code != 0 {
            return Err(map_exit(output.exit_code, &output.stderr));
        }
        parse_bd_version(&output.stdout)
    }

    pub fn context(&self) -> Result<WorkspaceContext, BridgeError> {
        let request = self.request(
            "context",
            vec![OsString::from("context"), OsString::from("--json")],
            READ_TIMEOUT,
        );
        let output = self.runner.run(&request)?;
        if output.exit_code != 0 {
            return Err(map_exit(output.exit_code, &output.stderr));
        }
        serde_json::from_str(&output.stdout).map_err(|error| {
            BridgeError::new(
                BridgeErrorCode::BdParseFailed,
                format!("bd context is not valid JSON: {error}"),
            )
        })
    }

    pub fn export(&self) -> Result<Vec<Issue>, BridgeError> {
        let request = self.request("export", vec![OsString::from("export")], READ_TIMEOUT);
        let output = self.runner.run(&request)?;
        if output.exit_code != 0 {
            return Err(map_exit(output.exit_code, &output.stderr));
        }
        parse_export(output.stdout.as_bytes())
    }

    /// `follow=false` runs one `events tail` and returns the records.
    /// `follow=true` starts a no-timeout reader; call [`JournalReader::next_batch`]
    /// from a worker thread because it blocks on the child's stdout.
    pub fn journal(&self, since: i64, follow: bool) -> Result<JournalReader, BridgeError> {
        let args = journal_args(since);
        if follow {
            let request = self.request("journal", args, READ_TIMEOUT);
            let mut process = self.runner.spawn_follow(&request)?;
            let stdout = process.take_stdout().ok_or_else(|| {
                BridgeError::new(
                    BridgeErrorCode::Internal,
                    "journal stdout pipe was not created",
                )
            })?;
            Ok(JournalReader::follow(process, stdout))
        } else {
            let request = self.request("journal", args, READ_TIMEOUT);
            let output = self.runner.run(&request)?;
            if let Some(error) = journal_truncated(output.stdout.as_bytes(), &output.stderr) {
                return Err(error);
            }
            if let Some(error) =
                journal_disabled(output.exit_code, output.stdout.as_bytes(), &output.stderr)
            {
                return Err(error);
            }
            if output.exit_code != 0 {
                return Err(map_exit(output.exit_code, &output.stderr));
            }
            let mut stream = JournalStream::new();
            let records = stream.push(output.stdout.as_bytes())?;
            if stream.has_partial() {
                return Err(BridgeError::new(
                    BridgeErrorCode::BdParseFailed,
                    "bd journal output ended in the middle of a line",
                ));
            }
            Ok(JournalReader::once(records))
        }
    }

    /// Runs one write command and maps a nonzero exit through [`map_exit`].
    pub fn write(&self, command: &WriteCommand) -> Result<WriteOutcome, BridgeError> {
        let argv = argv_for(command);
        let mut request = self.request("write", argv.args, WRITE_TIMEOUT);
        request.stdin = argv.stdin;

        let output = self.runner.run(&request)?;
        if output.exit_code != 0 {
            return Err(map_exit(output.exit_code, &output.stderr));
        }

        let created_id = match command {
            WriteCommand::Create(_) => {
                let id = output.stdout.trim();
                if id.is_empty() {
                    None
                } else {
                    Some(id.to_owned())
                }
            }
            _ => None,
        };
        let stderr_excerpt = if output.stderr.is_empty() {
            None
        } else {
            Some(output.stderr)
        };

        Ok(WriteOutcome {
            exit_code: output.exit_code,
            created_id,
            stderr_excerpt,
        })
    }

    pub fn config_get(&self, key: &str) -> Result<String, BridgeError> {
        let request = self.request(
            "config",
            vec![
                OsString::from("config"),
                OsString::from("get"),
                OsString::from(key),
            ],
            READ_TIMEOUT,
        );
        let output = self.runner.run(&request)?;
        if output.exit_code != 0 {
            return Err(map_exit(output.exit_code, &output.stderr));
        }
        Ok(output.stdout.trim().to_owned())
    }

    /// Diagnostics for the settings page.
    pub fn recent_calls(&self) -> Vec<CallRecord> {
        self.runner.recent_calls()
    }

    fn request(&self, command: &str, args: Vec<OsString>, timeout: Duration) -> ProcessRequest {
        let mut request = ProcessRequest::new(command, self.workspace.clone(), args);
        request.timeout = timeout;
        request
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BdVersion {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
    pub raw: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WriteOutcome {
    pub exit_code: i32,
    pub created_id: Option<String>,
    pub stderr_excerpt: Option<String>,
}

/// A one-shot batch or a live follow stream of journal records.
pub struct JournalReader {
    kind: JournalReaderKind,
}

enum JournalReaderKind {
    Once {
        records: Vec<JournalRecord>,
        position: usize,
    },
    Follow {
        process: Box<FollowProcess>,
        stdout: ChildStdout,
        stream: JournalStream,
        prefix: Vec<u8>,
        done: bool,
    },
}

impl JournalReader {
    fn once(records: Vec<JournalRecord>) -> Self {
        Self {
            kind: JournalReaderKind::Once {
                records,
                position: 0,
            },
        }
    }

    fn follow(process: FollowProcess, stdout: ChildStdout) -> Self {
        Self {
            kind: JournalReaderKind::Follow {
                process: Box::new(process),
                stdout,
                stream: JournalStream::new(),
                prefix: Vec::new(),
                done: false,
            },
        }
    }

    /// Returns the next batch of records. In follow mode this blocks until the
    /// child writes more data or exits.
    pub fn next_batch(&mut self) -> Result<Vec<JournalRecord>, BridgeError> {
        match &mut self.kind {
            JournalReaderKind::Once { records, position } => {
                if *position >= records.len() {
                    return Ok(Vec::new());
                }
                let batch = records[*position..].to_vec();
                *position = records.len();
                Ok(batch)
            }
            JournalReaderKind::Follow {
                process,
                stdout,
                stream,
                prefix,
                done,
            } => {
                if *done {
                    return Ok(Vec::new());
                }

                let mut buffer = [0u8; 64 * 1024];
                let read = stdout.read(&mut buffer).map_err(|error| {
                    BridgeError::new(
                        BridgeErrorCode::Internal,
                        format!("reading bd journal failed: {error}"),
                    )
                })?;

                if read == 0 {
                    *done = true;
                    let exit_code = process
                        .try_wait()
                        .ok()
                        .flatten()
                        .and_then(|status| status.code())
                        .unwrap_or(-1);
                    let stderr = process.stderr_lossy();
                    if let Some(error) = journal_disabled(exit_code, prefix.as_slice(), &stderr) {
                        return Err(error);
                    }
                    if let Some(error) = journal_truncated(prefix.as_slice(), &stderr) {
                        return Err(error);
                    }
                    stream.take_partial();
                    return Ok(Vec::new());
                }

                remember_prefix(prefix, &buffer[..read]);
                stream.push(&buffer[..read])
            }
        }
    }
}

impl std::fmt::Debug for JournalReader {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.kind {
            JournalReaderKind::Once { records, position } => f
                .debug_struct("JournalReader::Once")
                .field("records", records)
                .field("position", position)
                .finish(),
            JournalReaderKind::Follow { done, .. } => f
                .debug_struct("JournalReader::Follow")
                .field("done", done)
                .finish(),
        }
    }
}

fn journal_args(since: i64) -> Vec<OsString> {
    vec![
        OsString::from("events"),
        OsString::from("tail"),
        OsString::from("--since"),
        OsString::from(since.to_string()),
        OsString::from("--json"),
    ]
}

fn parse_bd_version(stdout: &str) -> Result<BdVersion, BridgeError> {
    let raw = stdout.trim();
    let rest = raw
        .strip_prefix("bd version ")
        .ok_or_else(|| version_parse_error(raw))?;
    let token = rest
        .split_whitespace()
        .next()
        .ok_or_else(|| version_parse_error(raw))?;

    let mut parts = token.split('.');
    let major = parts
        .next()
        .and_then(|part| part.parse::<u32>().ok())
        .ok_or_else(|| version_parse_error(raw))?;
    let minor = parts
        .next()
        .and_then(|part| part.parse::<u32>().ok())
        .ok_or_else(|| version_parse_error(raw))?;
    let patch = parts
        .next()
        .and_then(|part| part.parse::<u32>().ok())
        .ok_or_else(|| version_parse_error(raw))?;
    if parts.next().is_some() {
        return Err(version_parse_error(raw));
    }

    let version = BdVersion {
        major,
        minor,
        patch,
        raw: token.to_owned(),
    };
    if (major, minor, patch) < MIN_BD_VERSION {
        let min = format!(
            "{}.{}.{}",
            MIN_BD_VERSION.0, MIN_BD_VERSION.1, MIN_BD_VERSION.2
        );
        let mut detail = Map::new();
        detail.insert("found".to_owned(), Value::String(token.to_owned()));
        detail.insert("min".to_owned(), Value::String(min.clone()));
        return Err(BridgeError::new(
            BridgeErrorCode::BdVersionUnsupported,
            format!("bd {token} is older than the required {min}"),
        )
        .with_detail(detail));
    }

    Ok(version)
}

fn version_parse_error(raw: &str) -> BridgeError {
    BridgeError::new(
        BridgeErrorCode::BdParseFailed,
        format!("unexpected bd --version output: {raw}"),
    )
}

fn remember_prefix(prefix: &mut Vec<u8>, chunk: &[u8]) {
    let remaining = JOURNAL_PREFIX_LIMIT.saturating_sub(prefix.len());
    if remaining > 0 {
        let take = remaining.min(chunk.len());
        prefix.extend_from_slice(&chunk[..take]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::state::{LoadingStep, SyncState};
    use crate::workspace::discovery::BdStatus;
    use crate::workspace::registry::{AppConfig, Checkpoint, Language, Theme, WorkspaceEntry};
    use std::fs;
    use std::path::Path;
    use ts_rs::TS;

    /// Regenerates `src/bindings/bd.ts`. `npm run gen:bindings` runs exactly
    /// this test, and `scripts/gen-bindings.mjs` fails loudly if the filter
    /// matches nothing.
    #[test]
    fn export_bindings() {
        let declarations = [
            Issue::decl(),
            Comment::decl(),
            Dependency::decl(),
            JournalOp::decl(),
            JournalDep::decl(),
            JournalComment::decl(),
            JournalRecord::decl(),
            WorkspaceContext::decl(),
            BridgeErrorCode::decl(),
            BridgeError::decl(),
            AppConfig::decl(),
            WorkspaceEntry::decl(),
            Checkpoint::decl(),
            Language::decl(),
            Theme::decl(),
            BdStatus::decl(),
            SyncState::decl(),
            LoadingStep::decl(),
        ];

        let mut output = String::from(
            "// Generated by `npm run gen:bindings` from the Rust types. Do not edit.\n",
        );
        for declaration in declarations {
            assert!(
                !declaration.trim().is_empty(),
                "empty TypeScript declaration"
            );
            output.push('\n');
            output.push_str("export ");
            output.push_str(declaration.trim_end());
            output.push('\n');
        }

        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/bindings/bd.ts");
        fs::create_dir_all(path.parent().expect("bindings directory"))
            .expect("create bindings dir");
        fs::write(&path, &output).expect("write TypeScript bindings");

        let written = fs::read_to_string(&path).expect("read TypeScript bindings");
        for expected in [
            "Issue",
            "Comment",
            "Dependency",
            "JournalRecord",
            "WorkspaceContext",
            "BridgeError",
            "AppConfig",
            "WorkspaceEntry",
            "BdStatus",
            "SyncState",
            "LoadingStep",
        ] {
            assert!(
                written.contains(expected),
                "bindings are missing {expected}"
            );
        }
    }

    #[test]
    fn version_parser_accepts_the_minimum_and_newer_versions() {
        let minimum = parse_bd_version("bd version 1.3.2 (9b65b9e19)").expect("1.3.2 is supported");
        assert_eq!((minimum.major, minimum.minor, minimum.patch), (1, 3, 2));

        let newer = parse_bd_version("bd version 1.10.0\n").expect("1.10.0 is supported");
        assert_eq!((newer.major, newer.minor, newer.patch), (1, 10, 0));
    }

    #[test]
    fn version_parser_rejects_old_versions() {
        let error = parse_bd_version("bd version 1.2.9 (abc)").expect_err("1.2.9 is too old");

        assert_eq!(error.code, BridgeErrorCode::BdVersionUnsupported);
        let detail = error.detail.as_ref().expect("detail");
        assert_eq!(
            detail.0.get("found").and_then(serde_json::Value::as_str),
            Some("1.2.9")
        );
        assert_eq!(
            detail.0.get("min").and_then(serde_json::Value::as_str),
            Some("1.3.2")
        );
    }

    #[test]
    fn version_parser_rejects_garbage() {
        for raw in [
            "not bd",
            "bd version",
            "bd version 1.3",
            "bd version 1.3.2.1",
        ] {
            let error = parse_bd_version(raw).expect_err(raw);
            assert_eq!(error.code, BridgeErrorCode::BdParseFailed, "{raw}");
        }
    }
}
