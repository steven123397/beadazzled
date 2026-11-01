//! Tauri glue for the sync engine.
//!
//! One worker thread per active workspace owns a [`SyncEngine`]; its sink emits
//! snapshots, journal batches and state transitions to the webview and persists
//! the checkpoint through [`WorkspaceService`]. A generation counter makes a
//! stopped worker harmless even if it is still unwinding: stale sinks neither
//! emit nor write a checkpoint.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::bridge::{BdBridge, BridgeError, BridgeErrorCode, Issue, JournalRecord};
use crate::commands::WorkspaceService;
use crate::sync::{BaselineOutcome, SyncConfig, SyncEngine, SyncSink, SyncState};
use crate::workspace::discovery::BdStatus;

pub const EVENT_SNAPSHOT: &str = "sync:snapshot";
pub const EVENT_RECORDS: &str = "sync:records";
pub const EVENT_STATE: &str = "sync:state";

/// The export snapshot plus the checkpoint it was taken from.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotEvent {
    pub issues: Vec<Issue>,
    pub since: i64,
}

struct Running {
    stop: Arc<AtomicBool>,
    bridge: Arc<BdBridge>,
    handle: JoinHandle<()>,
}

/// Owns the active sync worker. Managed by Tauri; commands start/stop it.
pub struct SyncController {
    app: AppHandle,
    /// Incremented whenever a worker starts or stops; sinks compare against it.
    generation: Arc<AtomicU64>,
    running: Mutex<Option<Running>>,
}

impl SyncController {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            generation: Arc::new(AtomicU64::new(0)),
            running: Mutex::new(None),
        }
    }

    /// Starts a fresh baseline + follow worker for `workspace`.
    ///
    /// The previous worker is invalidated first. Errors here are setup errors
    /// (unknown workspace, bd missing); runtime failures are emitted as
    /// [`SyncState::BdUnavailable`] by the worker.
    pub fn start(&self, workspace: &str) -> Result<(), BridgeError> {
        self.stop();

        let service = self.app.state::<WorkspaceService>();
        let snapshot = service.snapshot();
        if snapshot.active.as_deref() != Some(workspace) {
            return Err(not_active(workspace));
        }
        if snapshot.missing.iter().any(|path| path == workspace) {
            return Err(ws_inaccessible(workspace));
        }
        let entry = snapshot
            .config
            .workspaces
            .iter()
            .find(|entry| entry.path == workspace)
            .ok_or_else(|| not_registered(workspace))?;
        let bd_path = match service.bd_status(false) {
            BdStatus::Ready { path, .. } => path,
            BdStatus::NotFound { .. } => {
                return Err(BridgeError::new(
                    BridgeErrorCode::BdNotFound,
                    "bd was not found; install it or set its path in Settings",
                ));
            }
            BdStatus::Unsupported { found, min, .. } => {
                return Err(BridgeError::new(
                    BridgeErrorCode::BdVersionUnsupported,
                    format!("bd {found} is older than {min}; update bd to continue"),
                ));
            }
            BdStatus::Broken { error, .. } => return Err(error),
        };
        let since = service
            .checkpoint(workspace, &entry.project_id)
            .map(|checkpoint| checkpoint.seq)
            .unwrap_or(0);

        let bridge = Arc::new(BdBridge::new(bd_path, workspace.to_owned()));
        let stop = Arc::new(AtomicBool::new(false));
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let sink = TauriSink {
            app: self.app.clone(),
            workspace: workspace.to_owned(),
            generation,
            current: Arc::clone(&self.generation),
        };
        let bridge_thread = Arc::clone(&bridge);
        let stop_thread = Arc::clone(&stop);
        let handle = thread::spawn(move || run_sync(bridge_thread, sink, since, stop_thread));

        *lock(&self.running) = Some(Running {
            stop,
            bridge,
            handle,
        });
        Ok(())
    }

    /// Stops the worker and invalidates its sink. The join happens on a helper
    /// thread so a command never blocks on a backoff sleep or a slow bd read.
    pub fn stop(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        let running = lock(&self.running).take();
        if let Some(running) = running {
            running.stop.store(true, Ordering::SeqCst);
            running.bridge.interrupt_follow();
            thread::spawn(move || {
                let _ = running.handle.join();
            });
        }
    }
}

fn run_sync(bridge: Arc<BdBridge>, mut sink: TauriSink, since: i64, stop: Arc<AtomicBool>) {
    let mut engine = SyncEngine::new(bridge, SyncConfig::default());
    if matches!(
        engine.baseline(&mut sink, since),
        BaselineOutcome::Healthy { .. }
    ) && !stop.load(Ordering::SeqCst)
    {
        let should_stop = || stop.load(Ordering::SeqCst);
        engine.follow(&mut sink, should_stop, thread::sleep);
    }
}

struct TauriSink {
    app: AppHandle,
    workspace: String,
    generation: u64,
    current: Arc<AtomicU64>,
}

impl TauriSink {
    fn alive(&self) -> bool {
        self.generation == self.current.load(Ordering::SeqCst)
    }

    fn persist(&self, seq: i64) {
        if !self.alive() {
            return;
        }
        if let Some(service) = self.app.try_state::<WorkspaceService>() {
            let _ = service.set_checkpoint(&self.workspace, seq);
        }
    }
}

impl SyncSink for TauriSink {
    fn snapshot(&mut self, issues: &[Issue], since: i64) {
        if !self.alive() {
            return;
        }
        let _ = self.app.emit(
            EVENT_SNAPSHOT,
            SnapshotEvent {
                issues: issues.to_vec(),
                since,
            },
        );
    }

    fn records(&mut self, records: &[JournalRecord]) {
        if !self.alive() || records.is_empty() {
            return;
        }
        let _ = self.app.emit(EVENT_RECORDS, records.to_vec());
        if let Some(last) = records.last() {
            self.persist(last.seq);
        }
    }

    fn state(&mut self, state: &SyncState) {
        if !self.alive() {
            return;
        }
        let _ = self.app.emit(EVENT_STATE, state.clone());
        if let SyncState::Healthy { last_seq, .. } = state {
            self.persist(*last_seq);
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn not_registered(path: &str) -> BridgeError {
    BridgeError::new(
        BridgeErrorCode::Internal,
        format!("workspace is not registered: {path}"),
    )
}

fn not_active(path: &str) -> BridgeError {
    BridgeError::new(
        BridgeErrorCode::Internal,
        format!("workspace is not the active one: {path}"),
    )
}

fn ws_inaccessible(path: &str) -> BridgeError {
    BridgeError::new(
        BridgeErrorCode::WsInaccessible,
        format!("the workspace directory is missing: {path}"),
    )
}

// ---- Tauri commands -------------------------------------------------------

#[tauri::command(async)]
pub fn sync_start(
    controller: State<'_, SyncController>,
    workspace: String,
) -> Result<(), BridgeError> {
    controller.start(&workspace)
}

#[tauri::command(async)]
pub fn sync_refresh(
    controller: State<'_, SyncController>,
    workspace: String,
) -> Result<(), BridgeError> {
    controller.start(&workspace)
}

#[tauri::command]
pub fn sync_stop(controller: State<'_, SyncController>) {
    controller.stop();
}
