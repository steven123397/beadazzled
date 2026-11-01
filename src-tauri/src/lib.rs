use std::time::{SystemTime, UNIX_EPOCH};

use tauri::Manager;

pub mod bridge;
pub mod commands;
pub mod sync;
pub mod workspace;

/// Leaves a timestamp for `scripts/measure-startup.mjs`.
///
/// The measurement script launches the release binary without the DevTools
/// protocol (which would add hundreds of milliseconds), so the app reports its
/// own page-load mark instead. Nothing is written unless the caller explicitly
/// sets the environment variable.
fn write_startup_trace(label: &str, url: &str) {
    let Some(path) = std::env::var_os("BEADAZZLED_STARTUP_TRACE") else {
        return;
    };
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let _ = std::fs::write(path, format!("{label} {stamp} {url}\n"));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = match tauri::Builder::default()
        .on_page_load(|_webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                write_startup_trace("page-load-finished", payload.url().as_str());
            }
        })
        .setup(|app| {
            let config_path = app.path().app_config_dir()?.join("config.json");
            let service = commands::WorkspaceService::open(config_path)?;
            app.manage(service);
            let sync = commands::SyncController::new(app.handle().clone());
            app.manage(sync);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::workspace::workspace_snapshot,
            commands::workspace::bd_status,
            commands::workspace::bd_set_path,
            commands::workspace::workspace_add,
            commands::workspace::workspace_switch,
            commands::workspace::workspace_remove,
            commands::workspace::workspace_relocate,
            commands::workspace::workspace_set_checkpoint,
            commands::workspace::workspace_checkpoint,
            commands::workspace::execute_write,
            commands::workspace::workspace_flush,
            commands::sync::sync_start,
            commands::sync::sync_refresh,
            commands::sync::sync_stop,
        ])
        .build(tauri::generate_context!())
    {
        Ok(app) => app,
        Err(error) => {
            eprintln!("failed to run beadazzled: {error}");
            std::process::exit(1);
        }
    };

    app.run(|app, event| {
        if let tauri::RunEvent::Exit = event {
            app.state::<commands::SyncController>().stop();
            let service = app.state::<commands::WorkspaceService>();
            if let Err(error) = service.flush() {
                eprintln!("failed to flush the workspace config on exit: {error}");
            }
        }
    });
}
