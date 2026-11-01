use tauri::Manager;

pub mod bridge;
pub mod commands;
pub mod sync;
pub mod workspace;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = match tauri::Builder::default()
        .setup(|app| {
            let config_path = app.path().app_config_dir()?.join("config.json");
            let service = commands::WorkspaceService::open(config_path)?;
            app.manage(service);
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
            commands::workspace::workspace_flush,
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
            let service = app.state::<commands::WorkspaceService>();
            let _ = service.flush();
        }
    });
}
