//! Parsers for `bd export` (JSONL) and `bd events tail --json` (streaming).
//!
//! `BD_JSON_ENVELOPE` is deliberately not used: it only wraps `bd show/list`,
//! while `bd export` stays raw JSONL (SPEC-bridge, 解析规则).

use serde_json::{json, Map, Value};

use crate::bridge::types::{Issue, JournalRecord};
use crate::bridge::{BridgeError, BridgeErrorCode};

#[cfg(test)]
mod tests;

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
/// A single journal record embeds the full issue, so the line cap mirrors the
/// process layer's 16 MiB stdout line limit.
pub const JOURNAL_LINE_LIMIT: usize = 16 * 1024 * 1024;

#[derive(Debug)]
pub struct JournalStream {
    buffer: Vec<u8>,
    lines_seen: usize,
    scan_offset: usize,
    line_limit: usize,
}

impl Default for JournalStream {
    fn default() -> Self {
        Self {
            buffer: Vec::new(),
            lines_seen: 0,
            scan_offset: 0,
            line_limit: JOURNAL_LINE_LIMIT,
        }
    }
}

impl JournalStream {
    pub fn new() -> Self {
        Self::default()
    }

    /// Overrides the per-line cap, mainly for tests.
    #[cfg(test)]
    pub fn with_line_limit(line_limit: usize) -> Self {
        Self {
            line_limit,
            ..Self::default()
        }
    }

    /// Appends a chunk and returns every record completed by it.
    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<JournalRecord>, BridgeError> {
        self.buffer.extend_from_slice(chunk);
        let mut records = Vec::new();
        // Walk the buffer once. Copying each line out keeps the borrows simple;
        // draining per line would memmove the rest of the buffer every time,
        // which is quadratic when a backfill pushes the whole scan at once.
        let mut line_start = 0;
        let mut scan_from = self.scan_offset;

        while let Some(offset) = self.buffer[scan_from..]
            .iter()
            .position(|byte| *byte == b'\n')
        {
            let newline = scan_from + offset;
            let line = self.buffer[line_start..newline].to_vec();
            if line.len() > self.line_limit {
                return Err(journal_line_too_large(line.len(), self.line_limit));
            }

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
            if !text.trim().is_empty() {
                let record = serde_json::from_str::<JournalRecord>(text).map_err(|error| {
                    parse_error(
                        format!("bd journal line {line_number} is not a valid record: {error}"),
                        line_number,
                        Some(error.to_string()),
                    )
                })?;
                records.push(record);
            }

            line_start = newline + 1;
            scan_from = line_start;
        }

        let remaining = &self.buffer[line_start..];
        if remaining.len() > self.line_limit {
            return Err(journal_line_too_large(remaining.len(), self.line_limit));
        }
        if line_start > 0 {
            self.buffer.drain(..line_start);
        }
        self.scan_offset = self.buffer.len();

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
            self.scan_offset = 0;
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

fn journal_line_too_large(bytes: usize, limit: usize) -> BridgeError {
    let mut detail = Map::new();
    detail.insert("line_bytes".to_owned(), json!(bytes));
    detail.insert("line_limit_bytes".to_owned(), json!(limit));

    BridgeError::new(
        BridgeErrorCode::BdOutputTooLarge,
        "bd journal line exceeded the capture limit",
    )
    .with_detail(detail)
}

fn parse_error(message: String, line: usize, source: Option<String>) -> BridgeError {
    let mut detail = Map::new();
    detail.insert("line".to_owned(), json!(line));
    if let Some(source) = source {
        detail.insert("source".to_owned(), Value::String(source));
    }

    BridgeError::new(BridgeErrorCode::BdParseFailed, message).with_detail(detail)
}
