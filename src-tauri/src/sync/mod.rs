//! Baseline + journal follow orchestration.
//!
//! The engine owns the visible sync state. It never applies ticket data itself:
//! the snapshot and records go to a [`SyncSink`] (the Tauri layer forwards them
//! to the store), and every transition is pushed to the same sink so the
//! frontend cannot miss a degraded state.

pub mod baseline;
pub mod follow;
pub mod state;

pub use baseline::{
    BaselineOutcome, FollowStream, SeqGap, SyncConfig, SyncEngine, SyncSource, MAX_BASELINE_RECORDS,
};
pub use follow::{Backoff, FollowOutcome};
pub use state::{LoadingStep, SyncSink, SyncState};

use crate::bridge::{BdBridge, BridgeError, Issue, JournalReader, JournalRecord};

impl SyncSource for BdBridge {
    fn export(&self) -> Result<Vec<Issue>, BridgeError> {
        BdBridge::export(self)
    }

    fn journal(&self, since: i64, follow: bool) -> Result<Box<dyn FollowStream>, BridgeError> {
        Ok(Box::new(BdBridge::journal(self, since, follow)?))
    }

    fn backfill(
        &self,
        since: i64,
        max_records: usize,
        deadline: std::time::Duration,
    ) -> Result<Vec<JournalRecord>, BridgeError> {
        Ok(BdBridge::journal_backfill(self, since, max_records, deadline)?.records)
    }

    fn interrupt_follow(&self) {
        BdBridge::interrupt_follow(self);
    }
}

impl<T: SyncSource + ?Sized> SyncSource for std::sync::Arc<T> {
    fn export(&self) -> Result<Vec<Issue>, BridgeError> {
        (**self).export()
    }

    fn journal(&self, since: i64, follow: bool) -> Result<Box<dyn FollowStream>, BridgeError> {
        (**self).journal(since, follow)
    }

    fn backfill(
        &self,
        since: i64,
        max_records: usize,
        deadline: std::time::Duration,
    ) -> Result<Vec<JournalRecord>, BridgeError> {
        (**self).backfill(since, max_records, deadline)
    }

    fn interrupt_follow(&self) {
        (**self).interrupt_follow();
    }
}

impl FollowStream for JournalReader {
    fn next_batch(&mut self) -> Result<Vec<JournalRecord>, BridgeError> {
        JournalReader::next_batch(self)
    }
}
