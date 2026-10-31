//! Smoke test: the Tauri library crate builds and exposes its entry point.
//!
//! Real bridge coverage starts with the typed bd layer (bza-3ej).

#[test]
fn library_exposes_the_run_entry_point() {
    let entry_point: fn() = beadazzled_lib::run;
    let _ = entry_point;
}
