//! Stable error codes for every failure the bridge reports.
//!
//! The set is fixed by `docs/spec/SPEC-bridge.md`; consumers branch on the code and
//! show the message. Unknown failures map to `BD_EXIT_NONZERO` rather than a
//! guessed code.

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::fmt;
use ts_rs::TS;

use crate::bridge::types::ExtraFields;

/// The 15 codes from `SPEC-bridge.md`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BridgeErrorCode {
    BdNotFound,
    BdNotExecutable,
    BdVersionUnsupported,
    WsNotBeads,
    WsInaccessible,
    BdTimeout,
    BdExitNonzero,
    BdLocked,
    BdSchemaMismatch,
    JournalDisabled,
    JournalTruncated,
    BdParseFailed,
    BdOutputTooLarge,
    WriteConflict,
    Internal,
}

impl BridgeErrorCode {
    pub const ALL: [Self; 15] = [
        Self::BdNotFound,
        Self::BdNotExecutable,
        Self::BdVersionUnsupported,
        Self::WsNotBeads,
        Self::WsInaccessible,
        Self::BdTimeout,
        Self::BdExitNonzero,
        Self::BdLocked,
        Self::BdSchemaMismatch,
        Self::JournalDisabled,
        Self::JournalTruncated,
        Self::BdParseFailed,
        Self::BdOutputTooLarge,
        Self::WriteConflict,
        Self::Internal,
    ];

    /// The wire representation of the code, e.g. `BD_NOT_FOUND`.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::BdNotFound => "BD_NOT_FOUND",
            Self::BdNotExecutable => "BD_NOT_EXECUTABLE",
            Self::BdVersionUnsupported => "BD_VERSION_UNSUPPORTED",
            Self::WsNotBeads => "WS_NOT_BEADS",
            Self::WsInaccessible => "WS_INACCESSIBLE",
            Self::BdTimeout => "BD_TIMEOUT",
            Self::BdExitNonzero => "BD_EXIT_NONZERO",
            Self::BdLocked => "BD_LOCKED",
            Self::BdSchemaMismatch => "BD_SCHEMA_MISMATCH",
            Self::JournalDisabled => "JOURNAL_DISABLED",
            Self::JournalTruncated => "JOURNAL_TRUNCATED",
            Self::BdParseFailed => "BD_PARSE_FAILED",
            Self::BdOutputTooLarge => "BD_OUTPUT_TOO_LARGE",
            Self::WriteConflict => "WRITE_CONFLICT",
            Self::Internal => "INTERNAL",
        }
    }
}

/// A failure reported to the frontend.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct BridgeError {
    pub code: BridgeErrorCode,
    /// One sentence meant for the user.
    pub message: String,
    /// Diagnostic fields (exit code, stderr excerpt, line number, ...).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub detail: Option<ExtraFields>,
}

impl BridgeError {
    pub fn new(code: BridgeErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            detail: None,
        }
    }

    pub fn with_detail(mut self, detail: Map<String, Value>) -> Self {
        self.detail = Some(ExtraFields(detail));
        self
    }
}

impl fmt::Display for BridgeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code.as_str(), self.message)
    }
}

impl std::error::Error for BridgeError {}

/// stderr kept in error details, per SPEC-bridge's output limits.
const STDERR_EXCERPT_LIMIT: usize = 2 * 1024;

/// Maps a nonzero `bd` exit to the stable error contract.
///
/// Only patterns with recorded evidence are recognized; anything else stays
/// `BD_EXIT_NONZERO` with the exit code and a stderr excerpt. Unknown stderr
/// is never interpreted as a more specific failure.
pub fn map_exit(exit_code: i32, stderr: &str) -> BridgeError {
    map_exit_with_output(exit_code, stderr, "")
}

/// Like [`map_exit`], but also reads the JSON error bd prints on stdout.
///
/// `bd context --json` reports an unusable workspace as
/// `{"error": "cannot resolve repo context: ..."}` with an empty stderr, so
/// classifying only stderr would surface a generic "bd rejected the change"
/// instead of "this directory is not a beads workspace".
pub fn map_exit_with_output(exit_code: i32, stderr: &str, stdout: &str) -> BridgeError {
    let stdout_error = bd_stdout_error(stdout);
    let report = if stderr.trim().is_empty() {
        stdout_error.clone().unwrap_or_default()
    } else {
        stderr.to_owned()
    };
    let excerpt = stderr_excerpt(&report);
    let lower = report.to_ascii_lowercase();

    if exit_code == 13 {
        return BridgeError::new(
            BridgeErrorCode::WriteConflict,
            "the issue changed while you were editing it; reload and try again",
        )
        .with_detail(failure_detail(exit_code, stderr, &excerpt, &stdout_error));
    }

    if lower.contains("database is locked") || lower.contains("lock conflict") {
        return BridgeError::new(
            BridgeErrorCode::BdLocked,
            "beads is locked by another process; retry after it finishes",
        )
        .with_detail(failure_detail(exit_code, stderr, &excerpt, &stdout_error));
    }

    if is_schema_mismatch(&lower) {
        let mut detail = failure_detail(exit_code, stderr, &excerpt, &stdout_error);
        if let Some(hint) = matching_line(
            &report,
            &[
                "pending schema migration",
                "bd_allow_remote_migrate",
                "schema",
                "migration",
            ],
        ) {
            detail.insert("hint".to_owned(), Value::String(hint));
        }
        return BridgeError::new(
            BridgeErrorCode::BdSchemaMismatch,
            "the beads schema needs a migration before this app can use it",
        )
        .with_detail(detail);
    }

    if lower.contains("not a beads workspace")
        || lower.contains("no beads database")
        || lower.contains("no beads project found")
        || lower.contains("no .beads directory")
        || lower.contains("cannot resolve repo context")
    {
        return BridgeError::new(
            BridgeErrorCode::WsNotBeads,
            "this directory is not a beads workspace",
        )
        .with_detail(failure_detail(exit_code, stderr, &excerpt, &stdout_error));
    }

    BridgeError::new(
        BridgeErrorCode::BdExitNonzero,
        format!("bd exited with status {exit_code}"),
    )
    .with_detail(failure_detail(exit_code, stderr, &excerpt, &stdout_error))
}

/// The `error` string from bd's JSON-on-stdout failure form, if this is one.
fn bd_stdout_error(stdout: &str) -> Option<String> {
    let value: Value = serde_json::from_str(stdout.trim()).ok()?;
    value
        .get("error")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|message| !message.is_empty())
        .map(str::to_owned)
}

/// Detail fields for a failed call. `stderr` stays empty when the failure came
/// from stdout, so the two sources never masquerade as one another.
fn failure_detail(
    exit_code: i32,
    stderr: &str,
    excerpt: &str,
    stdout_error: &Option<String>,
) -> Map<String, Value> {
    let mut detail = exit_detail(
        exit_code,
        if stderr.trim().is_empty() {
            ""
        } else {
            excerpt
        },
    );
    if let Some(message) = stdout_error {
        detail.insert("bd_error".to_owned(), Value::String(message.clone()));
    }
    detail
}

fn stderr_excerpt(stderr: &str) -> String {
    if stderr.len() <= STDERR_EXCERPT_LIMIT {
        return stderr.to_owned();
    }

    let mut end = STDERR_EXCERPT_LIMIT;
    while end > 0 && !stderr.is_char_boundary(end) {
        end -= 1;
    }
    stderr[..end].to_owned()
}

fn exit_detail(exit_code: i32, excerpt: &str) -> Map<String, Value> {
    let mut detail = Map::new();
    detail.insert("exit_code".to_owned(), json!(exit_code));
    if !excerpt.is_empty() {
        detail.insert("stderr".to_owned(), Value::String(excerpt.to_owned()));
    }
    detail
}

fn is_schema_mismatch(lower: &str) -> bool {
    lower.contains("pending schema migration")
        || lower.contains("bd_allow_remote_migrate")
        || (lower.contains("schema")
            && (lower.contains("migration")
                || lower.contains("incompatible")
                || lower.contains("mismatch")
                || lower.contains("newer")
                || lower.contains("older")))
}

fn matching_line(stderr: &str, needles: &[&str]) -> Option<String> {
    stderr
        .lines()
        .find(|line| {
            let lower = line.to_ascii_lowercase();
            needles.iter().any(|needle| lower.contains(needle))
        })
        .map(|line| line.trim_end().to_owned())
}
