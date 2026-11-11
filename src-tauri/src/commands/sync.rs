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

use super::{not_active, not_registered, ws_inaccessible};
use crate::bridge::{BdBridge, BridgeError, BridgeErrorCode, Issue, JournalRecord};
use crate::commands::WorkspaceService;
use crate::sync::{BaselineOutcome, FollowOutcome, SyncConfig, SyncEngine, SyncSink, SyncState};
use crate::util::lock;

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
    /// Serialises start/stop: two overlapping commands must not each install a
    /// worker, or the displaced one keeps its bd follow process alive with no
    /// handle left to stop it.
    lifecycle: Mutex<()>,
    /// Held across a checkpoint write. Stopping takes it after bumping the
    /// generation, so a write that already passed its liveness check cannot
    /// land after the next generation begins.
    persist: Arc<Mutex<()>>,
}

impl SyncController {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            generation: Arc::new(AtomicU64::new(0)),
            running: Mutex::new(None),
            lifecycle: Mutex::new(()),
            persist: Arc::new(Mutex::new(())),
        }
    }

    /// Starts a fresh baseline + follow worker for `workspace`.
    ///
    /// The previous worker is invalidated first. Errors here are setup errors
    /// (unknown workspace, bd missing); runtime failures are emitted as
    /// [`SyncState::BdUnavailable`] by the worker.
    pub fn start(&self, workspace: &str) -> Result<(), BridgeError> {
        // The whole transition runs under one lock: a concurrent start would
        // otherwise overwrite the Running slot and orphan the worker it
        // replaced. `stop_locked` is used because this guard is already held.
        let _lifecycle = lock(&self.lifecycle);
        self.stop_locked();

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
        let bd_path = service.ready_bd_path()?;
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
            persist: Arc::clone(&self.persist),
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
        let _lifecycle = lock(&self.lifecycle);
        self.stop_locked();
    }

    fn stop_locked(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        // The generation is already bumped, so once this lock is free every
        // later write sees the new value and returns. Taking it waits out a
        // checkpoint write that is already in flight.
        drop(lock(&self.persist));
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

/// How many full rebuilds a worker attempts when the journal keeps losing
/// sequences before it reports bd as unavailable.
const MAX_GAP_REBUILDS: u32 = 3;

#[derive(Debug, PartialEq)]
enum FollowStep {
    Stop,
    Rebuild,
    GiveUp { expected: i64, got: i64 },
}

/// What the worker does after `follow` returns.
///
/// A gap means bd lost events: the engine documents that the caller must
/// rebuild the baseline. Ending the thread instead leaves the last emitted
/// state on `Healthy`, so the status bar claims "Live" while nothing is
/// syncing. Rebuilding is bounded so a pathological journal cannot spin.
fn follow_step(outcome: &FollowOutcome, rebuilds: u32) -> FollowStep {
    match outcome {
        FollowOutcome::Gap { .. } if rebuilds < MAX_GAP_REBUILDS => FollowStep::Rebuild,
        FollowOutcome::Gap { expected, got } => FollowStep::GiveUp {
            expected: *expected,
            got: *got,
        },
        // Every other outcome already emitted its own state (stopped,
        // journal disabled, truncated, bd unavailable).
        _ => FollowStep::Stop,
    }
}

fn run_sync(bridge: Arc<BdBridge>, mut sink: TauriSink, since: i64, stop: Arc<AtomicBool>) {
    let mut engine = SyncEngine::new(bridge, SyncConfig::default());
    let should_stop = || stop.load(Ordering::SeqCst);
    let mut since = since;
    let mut rebuilds = 0;

    loop {
        if should_stop() {
            return;
        }

        // A non-healthy baseline already emitted its state; the worker has
        // nothing left to follow.
        if !matches!(
            engine.baseline(&mut sink, since),
            BaselineOutcome::Healthy { .. }
        ) {
            return;
        }

        let outcome = engine.follow(&mut sink, should_stop, thread::sleep);
        match follow_step(&outcome, rebuilds) {
            FollowStep::Stop => return,
            FollowStep::Rebuild => {
                rebuilds += 1;
                // Rebuild from scratch: the missed sequences are unknown, so
                // the safe cursor is zero; a truncated journal falls back to
                // its floor inside the baseline.
                since = 0;
            }
            FollowStep::GiveUp { expected, got } => {
                sink.state(&SyncState::BdUnavailable {
                    error: BridgeError::new(
                        BridgeErrorCode::Internal,
                        format!(
                            "journal sequence gap at {got} (expected {expected}) survived {MAX_GAP_REBUILDS} rebuilds"
                        ),
                    ),
                });
                return;
            }
        }
    }
}

struct TauriSink {
    app: AppHandle,
    workspace: String,
    generation: u64,
    current: Arc<AtomicU64>,
    persist: Arc<Mutex<()>>,
}

impl TauriSink {
    fn alive(&self) -> bool {
        self.generation == self.current.load(Ordering::SeqCst)
    }

    fn persist(&self, seq: i64) {
        // The liveness check and the write are one critical section: `stop`
        // bumps the generation and then takes this lock, so a worker from the
        // previous generation can never write a checkpoint afterwards.
        let _guard = lock(&self.persist);
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
        let _ = self.app.emit(EVENT_RECORDS, records);
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

#[cfg(test)]
mod tests {
    use super::{
        follow_step, FollowStep, EVENT_RECORDS, EVENT_SNAPSHOT, EVENT_STATE, MAX_GAP_REBUILDS,
    };
    use crate::bridge::{BridgeError, BridgeErrorCode};
    use crate::sync::FollowOutcome;

    fn gap() -> FollowOutcome {
        FollowOutcome::Gap {
            expected: 7,
            got: 9,
        }
    }

    #[test]
    fn emitted_event_names_match_the_frontend_listener_contract() {
        assert_eq!(EVENT_SNAPSHOT, "sync:snapshot");
        assert_eq!(EVENT_RECORDS, "sync:records");
        assert_eq!(EVENT_STATE, "sync:state");
    }

    #[test]
    fn a_gap_asks_for_a_rebuild_while_attempts_remain() {
        for rebuilds in 0..MAX_GAP_REBUILDS {
            assert_eq!(follow_step(&gap(), rebuilds), FollowStep::Rebuild);
        }
    }

    #[test]
    fn a_gap_that_survives_every_rebuild_gives_up_with_the_sequences() {
        assert_eq!(
            follow_step(&gap(), MAX_GAP_REBUILDS),
            FollowStep::GiveUp {
                expected: 7,
                got: 9
            }
        );
    }

    #[test]
    fn terminal_outcomes_stop_without_rebuilding() {
        let cases = [
            FollowOutcome::Stopped,
            FollowOutcome::JournalDisabled,
            FollowOutcome::JournalTruncated { floor: 12 },
            FollowOutcome::BdUnavailable(BridgeError::new(BridgeErrorCode::Internal, "boom")),
        ];

        for outcome in cases {
            assert_eq!(follow_step(&outcome, 0), FollowStep::Stop);
        }
    }
}
