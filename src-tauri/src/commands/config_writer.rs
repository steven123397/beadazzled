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
type QueueHook = Arc<dyn Fn() + Send + Sync>;

pub struct ConfigWriter {
    path: PathBuf,
    delay: Duration,
    saver: Saver,
    inner: Mutex<Inner>,
    /// Serializes saves: an older snapshot must never land after a newer one.
    save_lock: Mutex<()>,
    /// Test seam: pauses one queue call to force an interleaving.
    queue_hook: Mutex<Option<QueueHook>>,
}

#[derive(Default)]
struct Inner {
    /// The newest snapshot and the generation it was queued with.
    pending: Option<(u64, AppConfig)>,
    generation: u64,
    /// Highest generation that reached the disk.
    saved: u64,
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
            save_lock: Mutex::new(()),
            queue_hook: Mutex::new(None),
        })
    }

    /// Test seam: runs before a snapshot is stored, so a test can hold one
    /// queue call while another mutation runs.
    #[doc(hidden)]
    pub fn set_queue_hook(&self, hook: Option<QueueHook>) {
        *lock(&self.queue_hook) = hook;
    }

    /// Queues a snapshot; a worker saves the latest one after the debounce.
    pub fn queue(self: &Arc<Self>, config: AppConfig) {
        let hook = lock(&self.queue_hook).clone();
        if let Some(hook) = hook {
            hook();
        }
        let mut inner = lock(&self.inner);
        inner.generation += 1;
        inner.pending = Some((inner.generation, config));
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
        let result = match pending {
            Some((generation, config)) => self.save_if_newer(generation, &config),
            None => {
                // Wait for a save that is already in flight: app exit must not
                // cut it off halfway through the atomic write.
                let _guard = lock(&self.save_lock);
                Ok(())
            }
        };
        if let Some(message) = lock(&self.inner).last_error.take() {
            return Err(io::Error::other(message));
        }
        result
    }

    /// The last background save failure, if any.
    pub fn last_error(&self) -> Option<String> {
        lock(&self.inner).last_error.clone()
    }

    fn work(&self) {
        loop {
            thread::sleep(self.delay);
            let pending = lock(&self.inner).pending.take();
            if let Some((generation, config)) = pending {
                let _ = self.save_if_newer(generation, &config);
                continue;
            }

            let mut inner = lock(&self.inner);
            if inner.pending.is_none() {
                inner.running = false;
                return;
            }
        }
    }

    /// Saves one snapshot unless a newer one already reached the disk.
    ///
    /// A background save can start before `flush` and finish after it; without
    /// the generation check the older bytes would win the last rename.
    fn save_if_newer(&self, generation: u64, config: &AppConfig) -> io::Result<()> {
        let _guard = lock(&self.save_lock);
        if generation <= lock(&self.inner).saved {
            return Ok(());
        }
        let result = (self.saver)(&self.path, config);
        let mut inner = lock(&self.inner);
        match &result {
            Ok(()) => inner.saved = inner.saved.max(generation),
            Err(error) => inner.last_error = Some(error.to_string()),
        }
        result
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
    use std::sync::mpsc;
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

    #[test]
    fn a_save_that_started_first_cannot_overwrite_a_newer_flush() {
        let saved = Arc::new(StdMutex::new(Vec::<String>::new()));
        let (started_tx, started_rx) = mpsc::channel::<()>();
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let started_tx = Arc::new(StdMutex::new(Some(started_tx)));
        let release_rx = Arc::new(StdMutex::new(release_rx));

        let capture = Arc::clone(&saved);
        let writer = ConfigWriter::with_saver(
            "config.json",
            Duration::from_millis(5),
            Arc::new(move |_path, config| {
                let name = config.bd_path.clone().unwrap_or_default();
                if name == "a" {
                    if let Some(tx) = started_tx.lock().unwrap().take() {
                        tx.send(()).expect("signal the first save started");
                    }
                    release_rx
                        .lock()
                        .unwrap()
                        .recv()
                        .expect("wait for the test to release the save");
                }
                capture.lock().unwrap().push(name);
                Ok(())
            }),
        );

        writer.queue(config_with_bd("a"));
        started_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("the background save started");

        writer.queue(config_with_bd("b"));
        let flushing = {
            let writer = Arc::clone(&writer);
            thread::spawn(move || writer.flush())
        };

        // Give flush a moment to write "b" before "a" finishes (the old
        // behaviour) or to block behind the in-flight save (the fix).
        let deadline = std::time::Instant::now() + Duration::from_millis(300);
        while !saved.lock().unwrap().iter().any(|name| name == "b")
            && std::time::Instant::now() < deadline
        {
            thread::sleep(Duration::from_millis(5));
        }
        release_tx.send(()).expect("release the first save");
        flushing
            .join()
            .expect("flush thread")
            .expect("the flush succeeds");
        thread::sleep(Duration::from_millis(100));

        let saved = saved.lock().unwrap().clone();
        assert_eq!(
            saved.last().map(String::as_str),
            Some("b"),
            "an older background save must not land after the newer flush: {saved:?}"
        );
    }
}
