//! Parsers for `bd export` (JSONL) and `bd events tail --json` (streaming).
//!
//! `BD_JSON_ENVELOPE` is deliberately not used: it only wraps `bd show/list`,
//! while `bd export` stays raw JSONL (SPEC-bridge, 解析规则).

use serde_json::{json, Map, Value};

use crate::bridge::types::{Issue, JournalRecord};
use crate::bridge::{BridgeError, BridgeErrorCode};

/// Exact marker bd writes when the events journal is disabled.
const JOURNAL_DISABLED_MARKER: &str = "events journal is disabled";

/// Parses a full `bd export` snapshot.
///
/// The output must be newline-terminated: a final line without its newline is
/// treated as a truncated write. Any bad line fails the whole export; callers
/// never receive partial data.
pub fn parse_export(stdout: &[u8]) -> Result<Vec<Issue>, BridgeError> {
    if stdout.is_empty() {
        return Ok(Vec::new());
    }

    let text = std::str::from_utf8(stdout).map_err(|error| {
        BridgeError::new(
            BridgeErrorCode::BdParseFailed,
            format!("bd export produced invalid UTF-8: {error}"),
        )
    })?;

    if !text.ends_with('\n') {
        let line = text.bytes().filter(|byte| *byte == b'\n').count() + 1;
        return Err(parse_error(
            format!("bd export output is truncated: line {line} has no trailing newline"),
            line,
            None,
        ));
    }

    let mut issues = Vec::new();
    for (index, line) in text.split('\n').enumerate() {
        let line_number = index + 1;
        let line = line.trim_end_matches('\r');
        if line.trim().is_empty() {
            continue;
        }

        let issue = serde_json::from_str::<Issue>(line).map_err(|error| {
            parse_error(
                format!("bd export line {line_number} is not a valid issue: {error}"),
                line_number,
                Some(error.to_string()),
            )
        })?;
        issues.push(issue);
    }

    Ok(issues)
}

/// Incremental parser for `bd events tail --json`.
///
/// Bytes after the last newline stay buffered until the next chunk, so chunk
/// boundaries that split a JSON line are harmless. Callers in follow mode call
/// [`JournalStream::take_partial`] when the process exits to discard a final
/// half line and log one warning.
#[derive(Debug, Default)]
pub struct JournalStream {
    buffer: Vec<u8>,
    lines_seen: usize,
}

impl JournalStream {
    pub fn new() -> Self {
        Self::default()
    }

    /// Appends a chunk and returns every record completed by it.
    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<JournalRecord>, BridgeError> {
        self.buffer.extend_from_slice(chunk);
        let mut records = Vec::new();

        while let Some(newline) = self.buffer.iter().position(|byte| *byte == b'\n') {
            let mut line: Vec<u8> = self.buffer.drain(..=newline).collect();
            line.pop();
            self.lines_seen += 1;
            let line_number = self.lines_seen;

            let text = std::str::from_utf8(&line).map_err(|error| {
                parse_error(
                    format!("bd journal line {line_number} is not valid UTF-8: {error}"),
                    line_number,
                    None,
                )
            })?;
            let text = text.trim_end_matches('\r');
            if text.trim().is_empty() {
                continue;
            }

            let record = serde_json::from_str::<JournalRecord>(text).map_err(|error| {
                parse_error(
                    format!("bd journal line {line_number} is not a valid record: {error}"),
                    line_number,
                    Some(error.to_string()),
                )
            })?;
            records.push(record);
        }

        Ok(records)
    }

    pub fn has_partial(&self) -> bool {
        !self.buffer.is_empty()
    }

    /// Returns and clears the buffered incomplete line, if one is left.
    pub fn take_partial(&mut self) -> Option<Vec<u8>> {
        if self.buffer.is_empty() {
            None
        } else {
            Some(std::mem::take(&mut self.buffer))
        }
    }
}

/// Recognizes bd's "events journal is disabled" note.
///
/// Per SPEC-bridge this requires exit 0, an empty stdout and the exact stderr
/// marker. Unknown stderr is never guessed.
pub fn journal_disabled(exit_code: i32, stdout: &[u8], stderr: &str) -> Option<BridgeError> {
    if exit_code != 0 {
        return None;
    }
    if !stdout.iter().all(|byte| byte.is_ascii_whitespace()) {
        return None;
    }
    if !stderr.contains(JOURNAL_DISABLED_MARKER) {
        return None;
    }

    Some(BridgeError::new(
        BridgeErrorCode::JournalDisabled,
        "the events journal is disabled for this workspace",
    ))
}

/// Recognizes the JSON truncation marker emitted on stdout or stderr.
pub fn journal_truncated(stdout: &[u8], stderr: &str) -> Option<BridgeError> {
    std::str::from_utf8(stdout)
        .ok()
        .and_then(truncation_from_text)
        .or_else(|| truncation_from_text(stderr))
}

fn truncation_from_text(text: &str) -> Option<BridgeError> {
    text.lines()
        .find_map(truncation_from_line)
        .or_else(|| truncation_from_line(text.trim()))
}

fn truncation_from_line(line: &str) -> Option<BridgeError> {
    let start = line.find('{')?;
    let end = line.rfind('}')?;
    if end < start {
        return None;
    }

    let value = serde_json::from_str::<Value>(&line[start..=end]).ok()?;
    if value.get("code").and_then(Value::as_str)? != "events_journal_truncated" {
        return None;
    }

    let since = value.get("since").and_then(Value::as_i64)?;
    let floor = value.get("floor").and_then(Value::as_i64)?;
    let head = value.get("head").and_then(Value::as_i64)?;

    let mut detail = Map::new();
    detail.insert("since".to_owned(), json!(since));
    detail.insert("floor".to_owned(), json!(floor));
    detail.insert("head".to_owned(), json!(head));

    Some(
        BridgeError::new(
            BridgeErrorCode::JournalTruncated,
            "the events journal has been truncated; re-baseline from a full export",
        )
        .with_detail(detail),
    )
}

fn parse_error(message: String, line: usize, source: Option<String>) -> BridgeError {
    let mut detail = Map::new();
    detail.insert("line".to_owned(), json!(line));
    if let Some(source) = source {
        detail.insert("source".to_owned(), Value::String(source));
    }

    BridgeError::new(BridgeErrorCode::BdParseFailed, message).with_detail(detail)
}
