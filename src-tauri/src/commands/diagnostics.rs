//! Diagnostics data for Settings.
//!
//! Everything here is on demand: the command is the only place that spawns bd
//! from the settings page, and the frontend calls it only when the user asks
//! for the report.

use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::bridge::{shared_call_log, BdBridge, BridgeError, BridgeErrorCode, WorkspaceContext};
use crate::commands::WorkspaceService;
use crate::util::lock;
use crate::workspace::discovery::BdStatus;

/// The newest calls kept for the report. The shared buffer holds 200; the
/// screen shows the most recent 20 of these.
const CALL_LIMIT: usize = 200;

/// One bd invocation, reduced to what a pasted report needs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsCall {
    pub command: String,
    /// Arguments with user-written values redacted; never a full issue body.
    pub argv: String,
    #[ts(type = "number")]
    pub duration_ms: u64,
    pub exit_code: Option<i32>,
    pub error_code: Option<BridgeErrorCode>,
}

/// What the diagnostics panel renders and copies.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsSnapshot {
    pub bd: BdStatus,
    /// The active workspace path, when one is registered.
    pub workspace: Option<String>,
    /// `bd context --json` for the active workspace, when it answered.
    pub context: Option<DiagnosticsContext>,
    /// Why the context call failed, when it did.
    pub context_error: Option<BridgeError>,
    /// Newest first.
    pub calls: Vec<DiagnosticsCall>,
}

/// The `bd context` fields the report actually shows.
///
/// `WorkspaceContext` flattens every unknown `bd context --json` field into
/// `extra`; forwarding that across the IPC boundary would ship config values
/// we never render, so the report projects an allowlist instead.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsContext {
    pub project_id: String,
    pub dolt_mode: String,
    #[ts(type = "number")]
    pub schema_version: i64,
}

impl From<&WorkspaceContext> for DiagnosticsContext {
    fn from(context: &WorkspaceContext) -> Self {
        Self {
            project_id: context.project_id.clone(),
            dolt_mode: context.dolt_mode.clone(),
            schema_version: context.schema_version,
        }
    }
}

pub fn collect(service: &WorkspaceService) -> DiagnosticsSnapshot {
    let snapshot = service.snapshot();
    let workspace = snapshot.active;
    let bd = service.bd_status(false);

    let (context, context_error) = match (&workspace, &bd) {
        (Some(directory), BdStatus::Ready { path, .. }) if Path::new(directory).is_dir() => {
            match BdBridge::new(path, directory).context() {
                Ok(context) => (Some(DiagnosticsContext::from(&context)), None),
                Err(error) => (None, Some(error)),
            }
        }
        // No workspace, or its directory is gone: there is nothing to ask bd
        // about, and spawning one would only produce a confusing error.
        _ => (None, None),
    };

    let mut calls: Vec<DiagnosticsCall> = lock(&shared_call_log()).iter().map(summarize).collect();
    calls.reverse();
    calls.truncate(CALL_LIMIT);

    DiagnosticsSnapshot {
        bd,
        workspace,
        context,
        context_error,
        calls,
    }
}

fn summarize(record: &crate::bridge::CallRecord) -> DiagnosticsCall {
    DiagnosticsCall {
        command: record.command.clone(),
        argv: record.argv_summary.clone(),
        duration_ms: u64::try_from(record.duration.as_millis()).unwrap_or(u64::MAX),
        exit_code: record.exit_code,
        error_code: record.error_code,
    }
}

#[tauri::command(async)]
pub fn settings_diagnostics(service: tauri::State<'_, WorkspaceService>) -> DiagnosticsSnapshot {
    collect(&service)
}
