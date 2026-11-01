pub mod bridge;
pub mod sync;
pub mod workspace;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(error) = tauri::Builder::default().run(tauri::generate_context!()) {
        eprintln!("failed to run beadazzled: {error}");
        std::process::exit(1);
    }
}
