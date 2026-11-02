use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::Manager;

pub mod bridge;
pub mod commands;
pub mod sync;
pub mod workspace;

/// Accepts a trace path only when it resolves inside the OS temp directory.
///
/// `BEADAZZLED_STARTUP_TRACE` is a debugging hook, and a release binary must not
/// truncate a file anywhere a caller points an environment variable. The
/// measurement script always writes under `os.tmpdir()`, so the temp directory
/// is the whole legitimate surface.
fn allowed_trace_path(candidate: &Path, temp_dir: &Path) -> Option<PathBuf> {
    if !candidate.is_absolute() {
        return None;
    }
    let parent = candidate.parent()?.canonicalize().ok()?;
    let temp = temp_dir.canonicalize().ok()?;
    parent.starts_with(temp).then(|| candidate.to_path_buf())
}

/// Leaves a timestamp for `scripts/measure-startup.mjs`.
///
/// The measurement script launches the release binary without the DevTools
/// protocol (which would add hundreds of milliseconds), so the app reports its
/// own page-load mark instead. Nothing is written unless the caller explicitly
/// sets the environment variable to a path inside the temp directory.
fn write_startup_trace(label: &str, url: &str) {
    let Some(candidate) = std::env::var_os("BEADAZZLED_STARTUP_TRACE") else {
        return;
    };
    let Some(path) = allowed_trace_path(Path::new(&candidate), &std::env::temp_dir()) else {
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

#[cfg(test)]
mod tests {
    use super::allowed_trace_path;
    use std::fs;
    use std::path::{Path, PathBuf};

    fn scratch_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("beadazzled-trace-{tag}-{}", std::process::id()));
        fs::create_dir_all(&dir).expect("create scratch dir");
        dir
    }

    #[test]
    fn accepts_a_trace_path_inside_the_temp_directory() {
        let temp = scratch_dir("inside");
        let candidate = temp.join("page-load.trace");

        let allowed = allowed_trace_path(&candidate, &temp);

        assert_eq!(allowed.as_deref(), Some(candidate.as_path()));
        fs::remove_dir_all(&temp).ok();
    }

    #[test]
    fn rejects_a_path_under_a_different_root() {
        let temp = scratch_dir("root");
        let other = scratch_dir("other");
        let candidate = temp.join("page-load.trace");

        assert_eq!(allowed_trace_path(&candidate, &other), None);

        fs::remove_dir_all(&temp).ok();
        fs::remove_dir_all(&other).ok();
    }

    #[test]
    fn rejects_a_path_outside_the_temp_directory() {
        let temp = scratch_dir("outside-check");
        let cwd = std::env::current_dir().expect("working directory");
        // The file need not exist; only its parent has to resolve.
        let candidate = cwd.join("beadazzled-trace-should-not-be-written.txt");

        assert_eq!(allowed_trace_path(&candidate, &temp), None);

        fs::remove_dir_all(&temp).ok();
    }

    #[test]
    fn rejects_relative_and_unresolvable_paths() {
        let temp = scratch_dir("relative");

        assert_eq!(
            allowed_trace_path(Path::new("page-load.trace"), &temp),
            None
        );
        assert_eq!(
            allowed_trace_path(&temp.join("missing/page-load.trace"), &temp),
            None
        );

        fs::remove_dir_all(&temp).ok();
    }
}
