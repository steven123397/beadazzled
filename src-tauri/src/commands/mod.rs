//! Tauri command surface.
//!
//! Commands stay thin: the logic lives in the services so it can be tested
//! without a running webview.

pub mod config_writer;
pub mod workspace;

pub use workspace::WorkspaceService;
