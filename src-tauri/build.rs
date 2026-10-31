fn main() {
    tauri_build::build();

    // tauri-build only embeds the Common-Controls v6 manifest into the app
    // binary. Test binaries link the same Tauri runtime, so without a manifest
    // they load the legacy comctl32 and fail to start with STATUS_ENTRYPOINT_NOT_FOUND.
    #[cfg(windows)]
    {
        let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("test-manifest.xml");
        println!("cargo:rerun-if-changed=test-manifest.xml");
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg-tests=/MANIFESTINPUT:{}",
            manifest.display()
        );
    }
}
