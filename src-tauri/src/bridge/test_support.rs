//! Test-only helpers for the bridge unit tests.
//!
//! Every runner points at `examples/fake_bd`; a real `bd` is never used. The
//! helpers live inside the crate because `process` is private (bza-ryr.25).

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

use super::process::ProcessRunner;

pub fn temp_dir(name: &str) -> PathBuf {
    let dir =
        std::env::temp_dir().join(format!("beadazzled-process-{}-{name}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("create temp dir");
    dir
}

pub fn workspace(dir: &Path) -> PathBuf {
    let workspace = dir.join("workspace");
    fs::create_dir_all(&workspace).expect("create workspace");
    workspace
}

pub fn env(key: &str, value: impl Into<OsString>) -> (OsString, OsString) {
    (key.into(), value.into())
}

pub fn runner() -> ProcessRunner {
    ProcessRunner::new(fake_bd_path())
}

/// The fake bd executable, for tests that build their own runner.
pub fn fake_bd() -> PathBuf {
    fake_bd_path()
}

fn fake_bd_path() -> PathBuf {
    let path = std::env::var_os("FAKE_BD_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(locate_fake_bd);

    assert!(
        path.is_file(),
        "the fake_bd binary is missing at {}; run `cargo build --example fake_bd`",
        path.display()
    );

    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("examples/fake_bd.rs");
    let built_at = fs::metadata(&path).and_then(|metadata| metadata.modified());
    let source_at = fs::metadata(&source).and_then(|metadata| metadata.modified());
    if let (Ok(built_at), Ok(source_at)) = (built_at, source_at) {
        assert!(
            built_at >= source_at,
            "the fake_bd binary at {} is older than examples/fake_bd.rs; run \
             `cargo build --example fake_bd`",
            path.display()
        );
    }

    path
}

fn locate_fake_bd() -> PathBuf {
    let current = std::env::current_exe().expect("current test executable");
    let profile_dir = current
        .parent()
        .expect("deps directory")
        .parent()
        .expect("target profile directory");
    let plain = if cfg!(windows) {
        "fake_bd.exe"
    } else {
        "fake_bd"
    };
    let path = profile_dir.join("examples").join(plain);

    assert!(
        path.is_file(),
        "the fake_bd example was not built at {}; run `cargo build \
         --example fake_bd` or set FAKE_BD_PATH",
        path.display()
    );

    path
}
