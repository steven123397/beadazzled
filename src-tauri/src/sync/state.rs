//! The six observable sync states and the sink that receives changes.
//!
//! `SyncState` is the contract with the frontend (`SPEC-sync`); the sink is how
//! the engine pushes states, snapshots and journal records onward without
//! knowing about Tauri or the ticket store.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::bridge::{BridgeError, Issue, JournalRecord};

/// Which half of the baseline is running.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum LoadingStep {
    Export,
    Journal,
}

/// The six states from `SPEC-sync`. Every variant must have a UI mapping.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum SyncState {
    Loading {
        step: LoadingStep,
    },
    Healthy {
        #[serde(rename = "lastSeq")]
        #[ts(type = "number")]
        last_seq: i64,
        #[serde(rename = "lastEventAt")]
        last_event_at: Option<String>,
    },
    /// The events journal is off; data still comes from `bd export`.
    JournalDisabled,
    /// History was pruned; the baseline was rebuilt from the reported floor.
    JournalTruncated {
        #[ts(type = "number")]
        floor: i64,
        recovered: bool,
    },
    /// The follow process died; a reconnect is scheduled after a backoff delay.
    Restarting {
        attempt: u32,
    },
    /// bd cannot be used; the last good data is kept and marked stale.
    BdUnavailable {
        error: BridgeError,
    },
}

/// Receives everything the engine produces: a snapshot, journal records and
/// every state transition. Implementations forward to Tauri events and the
/// ticket store.
pub trait SyncSink {
    /// The full `bd export` snapshot; replaces the store contents. `since` is
    /// the checkpoint the snapshot was taken at (0 for a first run or rebuild),
    /// so the consumer can seed its journal cursor correctly.
    fn snapshot(&mut self, issues: &[Issue], since: i64);
    /// Journal records in ascending seq order, already filtered for idempotency.
    fn records(&mut self, records: &[JournalRecord]);
    /// Every state transition, including the initial loading state.
    fn state(&mut self, state: &SyncState);
}

/// A sink that records everything, for tests.
#[cfg(test)]
#[derive(Debug, Default)]
pub struct RecordingSink {
    pub snapshots: Vec<Vec<Issue>>,
    /// The cursor each snapshot was emitted with, in order.
    pub snapshot_since: Vec<i64>,
    pub records: Vec<JournalRecord>,
    pub states: Vec<SyncState>,
}

#[cfg(test)]
impl SyncSink for RecordingSink {
    fn snapshot(&mut self, issues: &[Issue], since: i64) {
        self.snapshots.push(issues.to_vec());
        self.snapshot_since.push(since);
    }

    fn records(&mut self, records: &[JournalRecord]) {
        self.records.extend_from_slice(records);
    }

    fn state(&mut self, state: &SyncState) {
        self.states.push(state.clone());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bridge::{BridgeError, BridgeErrorCode};
    use serde_json::json;

    fn unavailable() -> BridgeError {
        BridgeError::new(BridgeErrorCode::BdNotFound, "bd is not installed")
    }

    #[test]
    fn all_six_states_have_a_stable_wire_shape() {
        let cases = [
            (
                SyncState::Loading {
                    step: LoadingStep::Export,
                },
                json!({ "kind": "loading", "step": "export" }),
            ),
            (
                SyncState::JournalDisabled,
                json!({ "kind": "journal-disabled" }),
            ),
            (
                SyncState::JournalTruncated {
                    floor: 50,
                    recovered: true,
                },
                json!({ "kind": "journal-truncated", "floor": 50, "recovered": true }),
            ),
            (
                SyncState::Restarting { attempt: 3 },
                json!({ "kind": "restarting", "attempt": 3 }),
            ),
            (
                SyncState::BdUnavailable {
                    error: unavailable(),
                },
                json!({
                    "kind": "bd-unavailable",
                    "error": { "code": "BD_NOT_FOUND", "message": "bd is not installed" },
                }),
            ),
        ];

        for (state, expected) in cases {
            assert_eq!(
                serde_json::to_value(&state).expect("state serialises"),
                expected
            );
        }
    }

    #[test]
    fn healthy_carries_the_last_sequence_and_event_time() {
        let state = SyncState::Healthy {
            last_seq: 42,
            last_event_at: Some("2026-11-01T00:00:00Z".to_owned()),
        };

        assert_eq!(
            serde_json::to_value(&state).expect("state serialises"),
            json!({
                "kind": "healthy",
                "lastSeq": 42,
                "lastEventAt": "2026-11-01T00:00:00Z",
            })
        );
    }

    #[test]
    fn healthy_can_report_no_event_yet() {
        let state = SyncState::Healthy {
            last_seq: 0,
            last_event_at: None,
        };

        assert_eq!(
            serde_json::to_value(&state).expect("state serialises"),
            json!({ "kind": "healthy", "lastSeq": 0, "lastEventAt": null })
        );
    }
}
