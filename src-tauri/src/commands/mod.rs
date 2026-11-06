//! Tauri command surface.
//!
//! Commands stay thin: the logic lives in the services so it can be tested
//! without a running webview.

use serde_json::Value;

use crate::bridge::error::{detail_keys, version_unsupported};
use crate::bridge::{BridgeError, BridgeErrorCode};
use crate::workspace::discovery::{min_bd_version, BdStatus};

pub mod config_writer;
pub mod diagnostics;
pub mod sync;
pub mod workspace;

pub use sync::SyncController;
pub use workspace::WorkspaceService;

pub(crate) fn not_registered(path: &str) -> BridgeError {
    BridgeError::new(
        BridgeErrorCode::Internal,
        format!("workspace is not registered: {path}"),
    )
}

pub(crate) fn ws_inaccessible(path: &str) -> BridgeError {
    BridgeError::with_fields(
        BridgeErrorCode::WsInaccessible,
        format!("the workspace directory is missing: {path}"),
        [("path", Value::String(path.to_owned()))],
    )
}

pub(crate) fn not_active(path: &str) -> BridgeError {
    BridgeError::new(
        BridgeErrorCode::Internal,
        format!("workspace is not the active one: {path}"),
    )
}

pub(crate) fn bd_status_error(status: &BdStatus) -> BridgeError {
    match status {
        BdStatus::Unsupported { found, min, .. } => version_unsupported(found, min),
        BdStatus::Broken { error, .. } => error.clone(),
        BdStatus::NotFound { searched } => BridgeError::with_fields(
            BridgeErrorCode::BdNotFound,
            format!(
                "bd was not found; install it or set its path in Settings (requires {})",
                min_bd_version()
            ),
            [(
                detail_keys::SEARCHED,
                Value::Array(searched.iter().cloned().map(Value::String).collect()),
            )],
        ),
        BdStatus::Ready { .. } => BridgeError::new(
            BridgeErrorCode::Internal,
            "bd status error was requested for a ready bd",
        ),
    }
}
