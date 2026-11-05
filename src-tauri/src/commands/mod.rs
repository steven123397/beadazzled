//! Tauri command surface.
//!
//! Commands stay thin: the logic lives in the services so it can be tested
//! without a running webview.

use serde_json::{Map, Value};

use crate::bridge::{BridgeError, BridgeErrorCode};
use crate::workspace::discovery::{BdStatus, MIN_BD_VERSION};

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
    let mut detail = Map::new();
    detail.insert("path".to_owned(), Value::String(path.to_owned()));
    BridgeError::new(
        BridgeErrorCode::WsInaccessible,
        format!("the workspace directory is missing: {path}"),
    )
    .with_detail(detail)
}

pub(crate) fn not_active(path: &str) -> BridgeError {
    BridgeError::new(
        BridgeErrorCode::Internal,
        format!("workspace is not the active one: {path}"),
    )
}

pub(crate) fn bd_status_error(status: &BdStatus) -> BridgeError {
    match status {
        BdStatus::Unsupported { found, min, .. } => {
            let mut detail = Map::new();
            detail.insert("found".to_owned(), Value::String(found.clone()));
            detail.insert("min".to_owned(), Value::String(min.clone()));
            BridgeError::new(
                BridgeErrorCode::BdVersionUnsupported,
                format!("bd {found} is older than the required {min}"),
            )
            .with_detail(detail)
        }
        BdStatus::Broken { error, .. } => error.clone(),
        BdStatus::NotFound { searched } => {
            let mut detail = Map::new();
            detail.insert(
                "searched".to_owned(),
                Value::Array(searched.iter().cloned().map(Value::String).collect()),
            );
            BridgeError::new(
                BridgeErrorCode::BdNotFound,
                format!(
                    "bd was not found; install it or set its path in Settings (requires {MIN_BD_VERSION})"
                ),
            )
            .with_detail(detail)
        }
        BdStatus::Ready { .. } => BridgeError::new(
            BridgeErrorCode::Internal,
            "bd status error was requested for a ready bd",
        ),
    }
}
