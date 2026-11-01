//! Stable error codes for every failure the bridge reports.
//!
//! The set is fixed by `spec/SPEC-bridge.md`; consumers branch on the code and
//! show the message. Unknown failures map to `BD_EXIT_NONZERO` rather than a
//! guessed code.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
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
