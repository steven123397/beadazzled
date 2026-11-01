//! Tauri command surface.
//!
//! Commands stay thin: the logic lives in the services so it can be tested
//! without a running webview.

pub mod config_writer;
pub mod sync;
pub mod workspace;

pub use sync::SyncController;
pub use workspace::WorkspaceService;
