//! Debounced persistence for `config.json`.
//!
//! Workspace edits are rare, but sync checkpoints are written while records
//! stream in; this writer coalesces everything arriving inside a 500ms window
//! into one atomic save. [`ConfigWriter::flush`] forces the pending snapshot to
//! disk on app exit.

use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use crate::workspace::registry::{save_atomic, AppConfig};

/// The registry write budget from `SPEC-workspace`.
pub const SAVE_DEBOUNCE: Duration = Duration::from_millis(500);

type Saver = Arc<dyn Fn(&Path, &AppConfig) -> io::Result<()> + Send + Sync>;

pub struct ConfigWriter {
    path: PathBuf,
    delay: Duration,
    saver: Saver,
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    pending: Option<AppConfig>,
    running: bool,
    last_error: Option<String>,
}

impl ConfigWriter {
    pub fn new(path: impl Into<PathBuf>) -> Arc<Self> {
        Self::with_saver(path, SAVE_DEBOUNCE, Arc::new(save_atomic))
    }

    /// Test seam: a custom delay and saver.
    pub fn with_saver(path: impl Into<PathBuf>, delay: Duration, saver: Saver) -> Arc<Self> {
        Arc::new(Self {
            path: path.into(),
            delay,
            saver,
            inner: Mutex::new(Inner::default()),
        })
    }

    /// Queues a snapshot; a worker saves the latest one after the debounce.
    pub fn queue(self: &Arc<Self>, config: AppConfig) {
        let mut inner = lock(&self.inner);
        inner.pending = Some(config);
        if inner.running {
            return;
        }
        inner.running = true;
        drop(inner);

        let writer = Arc::clone(self);
        thread::spawn(move || writer.work());
    }

    /// Writes the pending snapshot immediately and reports any earlier failure.
    pub fn flush(&self) -> io::Result<()> {
        let pending = lock(&self.inner).pending.take();
        if let Some(config) = pending {
            self.save(&config)?;
        }
        if let Some(message) = lock(&self.inner).last_error.take() {
            return Err(io::Error::other(message));
        }
        Ok(())
    }

    /// The last background save failure, if any.
    pub fn last_error(&self) -> Option<String> {
        lock(&self.inner).last_error.clone()
    }

    fn work(&self) {
        loop {
            thread::sleep(self.delay);
            let pending = lock(&self.inner).pending.take();
            if let Some(config) = pending {
                if let Err(error) = self.save(&config) {
                    lock(&self.inner).last_error = Some(error.to_string());
                }
                continue;
            }

            let mut inner = lock(&self.inner);
            if inner.pending.is_none() {
                inner.running = false;
                return;
            }
        }
    }

    fn save(&self, config: &AppConfig) -> io::Result<()> {
        (self.saver)(&self.path, config)
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    fn config_with_bd(path: &str) -> AppConfig {
        AppConfig {
            bd_path: Some(path.to_owned()),
            ..AppConfig::default()
        }
    }

    fn recording_writer(delay: Duration) -> (Arc<ConfigWriter>, Arc<StdMutex<Vec<AppConfig>>>) {
        let saved = Arc::new(StdMutex::new(Vec::new()));
        let capture = Arc::clone(&saved);
        let writer = ConfigWriter::with_saver(
            "config.json",
            delay,
            Arc::new(move |_path, config| {
                capture.lock().unwrap().push(config.clone());
                Ok(())
            }),
        );
        (writer, saved)
    }

    #[test]
    fn coalesces_writes_inside_the_debounce_window() {
        let (writer, saved) = recording_writer(Duration::from_millis(20));

        writer.queue(config_with_bd("a"));
        writer.queue(config_with_bd("b"));
        writer.queue(config_with_bd("c"));

        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while saved.lock().unwrap().is_empty() && std::time::Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }

        let saved = saved.lock().unwrap().clone();
        assert_eq!(saved.len(), 1, "one save for three edits");
        assert_eq!(saved[0].bd_path.as_deref(), Some("c"));
    }

    #[test]
    fn flush_writes_pending_immediately() {
        let (writer, saved) = recording_writer(Duration::from_secs(60));

        writer.queue(config_with_bd("a"));
        writer.flush().expect("flush");

        assert_eq!(saved.lock().unwrap().len(), 1);
        assert_eq!(saved.lock().unwrap()[0].bd_path.as_deref(), Some("a"));
    }

    #[test]
    fn a_background_failure_is_reported_by_the_next_flush() {
        let writer = ConfigWriter::with_saver(
            "config.json",
            Duration::from_millis(5),
            Arc::new(|_path, _config| Err(io::Error::other("disk full"))),
        );

        writer.queue(config_with_bd("a"));
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while writer.last_error().is_none() && std::time::Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }

        let error = writer.flush().expect_err("the failure surfaces");
        assert!(error.to_string().contains("disk full"));
    }
}
