//! Follow lifecycle pieces: the reconnect schedule and the follow outcome.
//!
//! The engine's follow loop lives in `baseline.rs` next to the shared record
//! application; this module keeps the delay policy isolated and testable.

use std::time::Duration;

use crate::bridge::BridgeError;

/// Reconnect delays: 250ms doubling to 4s, five attempts total.
const BACKOFF_MS: [u64; 5] = [250, 500, 1_000, 2_000, 4_000];

/// The reconnect schedule for a dead follow process.
#[derive(Debug, Clone)]
pub struct Backoff {
    attempt: usize,
}

impl Backoff {
    pub fn new() -> Self {
        Self { attempt: 0 }
    }

    /// The next attempt number and its delay, or `None` once the schedule is
    /// exhausted (the caller escalates to `bd-unavailable`).
    pub fn next_delay(&mut self) -> Option<(u32, Duration)> {
        let delay = BACKOFF_MS.get(self.attempt)?;
        self.attempt += 1;
        Some((self.attempt as u32, Duration::from_millis(*delay)))
    }

    /// Number of delays already used since the last success.
    pub fn attempts(&self) -> u32 {
        self.attempt as u32
    }

    /// Called once a follow stream proves it works (first batch received).
    pub fn reset(&mut self) {
        self.attempt = 0;
    }
}

impl Default for Backoff {
    fn default() -> Self {
        Self::new()
    }
}

/// Why the follow loop returned; the caller decides what to do next.
#[derive(Debug, Clone, PartialEq)]
pub enum FollowOutcome {
    /// The caller asked to stop.
    Stopped,
    /// The journal is off; no reconnect is attempted.
    JournalDisabled,
    /// History was pruned; the caller must rebuild the baseline.
    JournalTruncated { floor: i64 },
    /// A sequence was skipped; the caller must rebuild the baseline.
    Gap { expected: i64, got: i64 },
    /// Five backoff delays were used without a working follow.
    BdUnavailable(BridgeError),
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn the_backoff_matches_the_spec_schedule() {
        let mut backoff = Backoff::new();
        let mut seen = Vec::new();

        while let Some((attempt, delay)) = backoff.next_delay() {
            seen.push((attempt, delay.as_millis()));
        }

        assert_eq!(
            seen,
            vec![(1, 250), (2, 500), (3, 1000), (4, 2000), (5, 4000)]
        );
        assert_eq!(backoff.next_delay(), None, "the schedule is exhausted");
    }

    #[test]
    fn a_success_resets_the_schedule() {
        let mut backoff = Backoff::new();
        assert_eq!(backoff.next_delay(), Some((1, Duration::from_millis(250))));
        assert_eq!(backoff.next_delay(), Some((2, Duration::from_millis(500))));

        backoff.reset();

        assert_eq!(backoff.attempts(), 0);
        assert_eq!(backoff.next_delay(), Some((1, Duration::from_millis(250))));
    }

    #[test]
    fn attempts_counts_the_delays_already_used() {
        let mut backoff = Backoff::new();
        assert_eq!(backoff.attempts(), 0);

        backoff.next_delay();
        backoff.next_delay();

        assert_eq!(backoff.attempts(), 2);
    }
}
