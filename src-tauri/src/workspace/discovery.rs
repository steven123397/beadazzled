//! bd discovery: configured path first, then PATH, with a cached status.
//!
//! Discovery never spawns anything itself; the caller supplies a probe closure
//! (the real one calls [`crate::bridge::BdBridge::version`]). That keeps every
//! branch testable without a `bd` binary.

use std::env;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use crate::bridge::{BdVersion, BridgeError, BridgeErrorCode};
use crate::util::lock;

/// The executable name to look for on PATH.
pub const BD_EXECUTABLE: &str = if cfg!(windows) { "bd.exe" } else { "bd" };

/// The minimum bd version the app supports (mirrors `SPEC-bridge`).
pub const MIN_BD_VERSION: &str = "1.3.2";

/// The outcome of locating and probing bd.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum BdStatus {
    Ready {
        path: String,
        version: String,
    },
    NotFound {
        searched: Vec<String>,
    },
    Unsupported {
        path: String,
        found: String,
        min: String,
    },
    Broken {
        path: String,
        error: BridgeError,
    },
}

/// Locates bd once and caches the result until an explicit refresh.
#[derive(Debug)]
pub struct BdDiscovery {
    configured: Option<String>,
    path_var: Option<OsString>,
    cached: Mutex<Option<BdStatus>>,
    diagnostics: Mutex<Vec<String>>,
}

impl BdDiscovery {
    pub fn new(configured: Option<&str>, path_var: Option<OsString>) -> Self {
        Self {
            configured: configured.map(str::to_owned),
            path_var,
            cached: Mutex::new(None),
            diagnostics: Mutex::new(Vec::new()),
        }
    }

    /// Uses the process PATH; the caller supplies the configured path.
    pub fn from_env(configured: Option<&str>) -> Self {
        Self::new(configured, env::var_os("PATH"))
    }

    /// The cached status, probing bd only on the first call.
    pub fn status<F>(&self, probe: F) -> BdStatus
    where
        F: Fn(&Path) -> Result<BdVersion, BridgeError>,
    {
        if let Some(status) = lock(&self.cached).clone() {
            return status;
        }
        let status = self.compute(&probe);
        *lock(&self.cached) = Some(status.clone());
        status
    }

    /// Probes again, replacing the cached status (the settings page button).
    pub fn refresh<F>(&self, probe: F) -> BdStatus
    where
        F: Fn(&Path) -> Result<BdVersion, BridgeError>,
    {
        let status = self.compute(&probe);
        *lock(&self.cached) = Some(status.clone());
        status
    }

    /// Seeds the cache with a status computed elsewhere.
    ///
    /// Settings probes a candidate path before storing it; priming the new
    /// discovery with that result keeps the follow-up cached read from
    /// spawning `bd --version` a second time for the same answer.
    pub fn prime(&self, status: BdStatus) {
        *lock(&self.cached) = Some(status);
    }

    /// Human-readable notes about fallbacks taken during discovery.
    pub fn diagnostics(&self) -> Vec<String> {
        lock(&self.diagnostics).clone()
    }

    fn compute<F>(&self, probe: &F) -> BdStatus
    where
        F: Fn(&Path) -> Result<BdVersion, BridgeError>,
    {
        let mut searched = Vec::new();
        let mut diagnostics = Vec::new();
        let mut candidates: Vec<PathBuf> = Vec::new();

        if let Some(configured) = &self.configured {
            let path = PathBuf::from(configured);
            searched.push(configured.clone());
            if path.is_file() {
                candidates.push(path);
            } else {
                diagnostics.push(format!(
                    "configured bd path {configured} was not found; falling back to PATH"
                ));
            }
        }

        if let Some(path_var) = &self.path_var {
            for directory in env::split_paths(path_var) {
                if directory.as_os_str().is_empty() {
                    continue;
                }
                let candidate = directory.join(BD_EXECUTABLE);
                searched.push(candidate.display().to_string());
                if candidate.is_file() {
                    candidates.push(candidate);
                }
            }
        }

        for candidate in candidates {
            let display = candidate.display().to_string();
            match probe(&candidate) {
                Ok(version) => {
                    self.store_diagnostics(diagnostics);
                    return BdStatus::Ready {
                        path: display,
                        version: version.raw,
                    };
                }
                Err(error) if error.code == BridgeErrorCode::BdNotFound => {
                    if self.configured.as_deref() == Some(display.as_str()) {
                        diagnostics.push(format!(
                            "configured bd path {display} is no longer usable; falling back to PATH"
                        ));
                    }
                }
                Err(error) if error.code == BridgeErrorCode::BdVersionUnsupported => {
                    let (found, min) = version_bounds(&error);
                    self.store_diagnostics(diagnostics);
                    return BdStatus::Unsupported {
                        path: display,
                        found,
                        min,
                    };
                }
                Err(error) => {
                    self.store_diagnostics(diagnostics);
                    return BdStatus::Broken {
                        path: display,
                        error,
                    };
                }
            }
        }

        self.store_diagnostics(diagnostics);
        BdStatus::NotFound { searched }
    }

    fn store_diagnostics(&self, diagnostics: Vec<String>) {
        *lock(&self.diagnostics) = diagnostics;
    }
}

fn version_bounds(error: &BridgeError) -> (String, String) {
    let detail = error.detail.as_ref().map(|extra| &extra.0);
    let found = detail
        .and_then(|values| values.get("found"))
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_owned();
    let min = detail
        .and_then(|values| values.get("min"))
        .and_then(Value::as_str)
        .unwrap_or(MIN_BD_VERSION)
        .to_owned();
    (found, min)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bridge::{BdVersion, BridgeError, BridgeErrorCode};
    use serde_json::{Map, Value};
    use std::ffi::OsString;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "beadazzled-discovery-{}-{name}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn fake_bd(directory: &Path) -> PathBuf {
        fs::create_dir_all(directory).expect("create bd directory");
        let path = directory.join(BD_EXECUTABLE);
        fs::write(&path, b"").expect("write fake bd");
        path
    }

    fn path_var(directories: &[&Path]) -> OsString {
        std::env::join_paths(directories).expect("join PATH entries")
    }

    fn version(raw: &str) -> BdVersion {
        let mut parts = raw
            .split('.')
            .map(|part| part.parse::<u32>().expect("number"));
        BdVersion {
            major: parts.next().expect("major"),
            minor: parts.next().expect("minor"),
            patch: parts.next().expect("patch"),
            raw: raw.to_owned(),
        }
    }

    fn unsupported(found: &str) -> BridgeError {
        let mut detail = Map::new();
        detail.insert("found".to_owned(), Value::String(found.to_owned()));
        detail.insert("min".to_owned(), Value::String(MIN_BD_VERSION.to_owned()));
        BridgeError::new(
            BridgeErrorCode::BdVersionUnsupported,
            format!("bd {found} is older than the required {MIN_BD_VERSION}"),
        )
        .with_detail(detail)
    }

    #[test]
    fn configured_path_wins_over_path() {
        let dir = temp_dir("configured-wins");
        let configured = fake_bd(&dir.join("configured"));
        let on_path = fake_bd(&dir.join("on-path"));
        let discovery = BdDiscovery::new(
            Some(configured.to_str().expect("utf-8 path")),
            Some(path_var(&[on_path.parent().expect("parent")])),
        );

        let status = discovery.status(|path| {
            assert_eq!(path, configured, "the configured path is probed first");
            Ok(version("1.3.2"))
        });

        assert_eq!(
            status,
            BdStatus::Ready {
                path: configured.display().to_string(),
                version: "1.3.2".to_owned(),
            }
        );
    }

    #[test]
    fn missing_configured_path_falls_back_to_path_and_says_so() {
        let dir = temp_dir("fallback");
        let configured = dir.join("not-here").join(BD_EXECUTABLE);
        let path_directory = dir.join("on-path");
        let on_path = fake_bd(&path_directory);
        let discovery = BdDiscovery::new(
            Some(configured.to_str().expect("utf-8 path")),
            Some(path_var(&[&path_directory])),
        );

        let status = discovery.status(|path| {
            assert_eq!(path, on_path);
            Ok(version("1.10.0"))
        });

        assert_eq!(
            status,
            BdStatus::Ready {
                path: on_path.display().to_string(),
                version: "1.10.0".to_owned(),
            }
        );
        assert!(
            discovery
                .diagnostics()
                .iter()
                .any(|line| line.contains("falling back to PATH")),
            "{:?}",
            discovery.diagnostics()
        );
    }

    #[test]
    fn a_configured_bd_that_disappeared_falls_back_to_path() {
        let dir = temp_dir("vanished");
        let configured = fake_bd(&dir.join("configured"));
        let path_directory = dir.join("on-path");
        let on_path = fake_bd(&path_directory);
        let discovery = BdDiscovery::new(
            Some(configured.to_str().expect("utf-8 path")),
            Some(path_var(&[&path_directory])),
        );

        let status = discovery.status(|path| {
            if path == configured {
                Err(BridgeError::new(
                    BridgeErrorCode::BdNotFound,
                    "bd disappeared",
                ))
            } else {
                assert_eq!(path, on_path);
                Ok(version("1.3.2"))
            }
        });

        assert!(matches!(status, BdStatus::Ready { .. }), "{status:?}");
    }

    #[test]
    fn no_bd_anywhere_lists_every_candidate_searched() {
        let dir = temp_dir("nowhere");
        let empty = dir.join("empty");
        fs::create_dir_all(&empty).expect("create empty dir");
        let configured = dir.join("configured").join(BD_EXECUTABLE);
        let discovery = BdDiscovery::new(
            Some(configured.to_str().expect("utf-8 path")),
            Some(path_var(&[&empty])),
        );

        let status = discovery.status(|_| panic!("nothing should be probed"));

        match status {
            BdStatus::NotFound { searched } => {
                assert!(
                    searched.iter().any(|item| item.contains("configured")),
                    "{searched:?}"
                );
                assert!(
                    searched.iter().any(|item| item.contains("empty")),
                    "{searched:?}"
                );
            }
            other => panic!("expected not-found, got {other:?}"),
        }
    }

    #[test]
    fn an_old_bd_reports_unsupported_with_found_and_min() {
        let dir = temp_dir("old");
        let bd = fake_bd(&dir.join("bin"));
        let discovery = BdDiscovery::new(Some(bd.to_str().expect("utf-8 path")), None);

        let status = discovery.status(|_| Err(unsupported("1.2.9")));

        assert_eq!(
            status,
            BdStatus::Unsupported {
                path: bd.display().to_string(),
                found: "1.2.9".to_owned(),
                min: MIN_BD_VERSION.to_owned(),
            }
        );
    }

    #[test]
    fn unparseable_version_output_is_broken() {
        let dir = temp_dir("broken");
        let bd = fake_bd(&dir.join("bin"));
        let discovery = BdDiscovery::new(Some(bd.to_str().expect("utf-8 path")), None);

        let status = discovery.status(|_| {
            Err(BridgeError::new(
                BridgeErrorCode::BdParseFailed,
                "unexpected bd --version output",
            ))
        });

        match status {
            BdStatus::Broken { path, error } => {
                assert_eq!(path, bd.display().to_string());
                assert_eq!(error.code, BridgeErrorCode::BdParseFailed);
            }
            other => panic!("expected broken, got {other:?}"),
        }
    }

    #[test]
    fn status_is_cached_until_an_explicit_refresh() {
        let dir = temp_dir("cache");
        let bd = fake_bd(&dir.join("bin"));
        let discovery = BdDiscovery::new(Some(bd.to_str().expect("utf-8 path")), None);
        let calls = AtomicUsize::new(0);

        let first = discovery.status(|_| {
            calls.fetch_add(1, Ordering::Relaxed);
            Ok(version("1.3.2"))
        });
        let cached = discovery.status(|_| {
            calls.fetch_add(1, Ordering::Relaxed);
            Ok(version("9.9.9"))
        });
        assert_eq!(first, cached);
        assert_eq!(calls.load(Ordering::Relaxed), 1);

        let refreshed = discovery.refresh(|_| {
            calls.fetch_add(1, Ordering::Relaxed);
            Ok(version("1.3.3"))
        });
        assert_eq!(
            refreshed,
            BdStatus::Ready {
                path: bd.display().to_string(),
                version: "1.3.3".to_owned(),
            }
        );
        assert_eq!(calls.load(Ordering::Relaxed), 2);
    }

    #[test]
    fn diagnostics_start_empty_and_survive_a_cache_hit() {
        let dir = temp_dir("diagnostics");
        let bd = fake_bd(&dir.join("bin"));
        let discovery = BdDiscovery::new(Some(bd.to_str().expect("utf-8 path")), None);
        assert!(discovery.diagnostics().is_empty());

        discovery.status(|_| Ok(version("1.3.2")));
        discovery.status(|_| Ok(version("1.3.2")));
        assert!(discovery.diagnostics().is_empty());
    }
}
