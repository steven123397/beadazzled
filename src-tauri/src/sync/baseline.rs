//! Baseline orchestration and the sync engine.
//!
//! The engine runs `export` → one-shot `journal` backfill → `follow`, and owns
//! the visible [`SyncState`]. Ticket data is never stored here: the snapshot
//! and records go to a [`SyncSink`], which the Tauri layer forwards to the
//! frontend store.

use std::time::Duration;

use super::follow::{Backoff, FollowOutcome};
use super::state::{LoadingStep, SyncSink, SyncState};
use crate::bridge::{BridgeError, BridgeErrorCode, Issue, JournalRecord};

/// One-shot backfill cap; the rest of a large backlog arrives through follow.
pub const MAX_BASELINE_RECORDS: usize = 50_000;
/// Read budget for the backfill (`SPEC-sync`): records or time, first wins.
pub const BACKFILL_DEADLINE: Duration = Duration::from_secs(8);

/// Tunables; tests shrink the caps instead of building 50k records.
#[derive(Debug, Clone)]
pub struct SyncConfig {
    pub max_baseline_records: usize,
    pub backfill_deadline: Duration,
}

impl Default for SyncConfig {
    fn default() -> Self {
        Self {
            max_baseline_records: MAX_BASELINE_RECORDS,
            backfill_deadline: BACKFILL_DEADLINE,
        }
    }
}

/// A live journal stream. `next_batch` blocks in follow mode and returns an
/// empty batch at EOF.
pub trait FollowStream {
    fn next_batch(&mut self) -> Result<Vec<JournalRecord>, BridgeError>;
}

/// The slice of the bridge the engine needs; tests supply a scripted fake.
pub trait SyncSource {
    fn export(&self) -> Result<Vec<Issue>, BridgeError>;
    fn journal(&self, since: i64, follow: bool) -> Result<Box<dyn FollowStream>, BridgeError>;

    /// Ends a blocked follow read (terminates the bd process). The engine's
    /// `should_stop` flag still decides when the loop returns; fakes that
    /// never block keep the default.
    fn interrupt_follow(&self) {}

    /// Reads the backfill within the record and time budgets. The default
    /// reads the one-shot journal in full (fakes rely on it); [`BdBridge`]
    /// overrides this with a bounded scan.
    fn backfill(
        &self,
        since: i64,
        max_records: usize,
        deadline: Duration,
    ) -> Result<Vec<JournalRecord>, BridgeError> {
        let _ = deadline;
        let mut stream = self.journal(since, false)?;
        let mut records = stream.next_batch()?;
        records.truncate(max_records);
        Ok(records)
    }
}

/// How a baseline ended.
#[derive(Debug, Clone, PartialEq)]
pub enum BaselineOutcome {
    Healthy { applied: usize },
    JournalDisabled,
    JournalTruncated { floor: i64, recovered: bool },
    BdUnavailable(BridgeError),
}

/// A skipped sequence; the caller must rebuild the baseline.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SeqGap {
    pub expected: i64,
    pub got: i64,
}

/// Owns sync state and drives baseline + follow for one workspace.
pub struct SyncEngine<S: SyncSource> {
    source: S,
    config: SyncConfig,
    state: SyncState,
    last_seq: i64,
    last_event_at: Option<String>,
    backoff: Backoff,
}

impl<S: SyncSource> SyncEngine<S> {
    pub fn new(source: S, config: SyncConfig) -> Self {
        Self {
            source,
            config,
            state: SyncState::Loading {
                step: LoadingStep::Export,
            },
            last_seq: 0,
            last_event_at: None,
            backoff: Backoff::new(),
        }
    }

    pub fn state(&self) -> &SyncState {
        &self.state
    }

    /// The last applied sequence; persist it as the workspace checkpoint.
    pub fn last_seq(&self) -> i64 {
        self.last_seq
    }

    pub fn last_event_at(&self) -> Option<&str> {
        self.last_event_at.as_deref()
    }

    /// Runs `export` → journal backfill. `since` is the checkpoint (0 when the
    /// workspace has none or its `project_id` changed).
    pub fn baseline<K: SyncSink>(&mut self, sink: &mut K, since: i64) -> BaselineOutcome {
        self.baseline_attempt(sink, since, false)
    }

    /// Follows the journal, pushing records and states to `sink`.
    ///
    /// Blocks until the caller stops it, the journal is disabled, history is
    /// truncated, a gap appears, or five reconnects fail. `sleep` is injected
    /// so tests can assert the backoff without waiting.
    pub fn follow<K: SyncSink>(
        &mut self,
        sink: &mut K,
        should_stop: impl Fn() -> bool,
        sleep: impl Fn(Duration),
    ) -> FollowOutcome {
        loop {
            if should_stop() {
                return FollowOutcome::Stopped;
            }

            let error = match self.source.journal(self.last_seq, true) {
                Ok(stream) => match self.consume(stream, sink, &should_stop) {
                    Consume::Stopped => return FollowOutcome::Stopped,
                    Consume::Terminal(outcome) => return outcome,
                    Consume::Failed(error) => error,
                    Consume::Ended => BridgeError::new(
                        BridgeErrorCode::Internal,
                        "bd journal stream ended unexpectedly",
                    ),
                },
                Err(error) => {
                    if let Some(outcome) = self.follow_terminal(sink, &error) {
                        return outcome;
                    }
                    error
                }
            };

            if should_stop() {
                return FollowOutcome::Stopped;
            }
            if !self.wait_before_retry(sink, &sleep) {
                return self.follow_unavailable(sink, error);
            }
        }
    }

    fn baseline_attempt<K: SyncSink>(
        &mut self,
        sink: &mut K,
        since: i64,
        rebuilt: bool,
    ) -> BaselineOutcome {
        self.last_seq = since;
        self.set_state(
            sink,
            SyncState::Loading {
                step: LoadingStep::Export,
            },
        );

        let issues = match self.source.export() {
            Ok(issues) => issues,
            Err(error) => return self.unavailable(sink, &error),
        };
        sink.snapshot(&issues);

        self.set_state(
            sink,
            SyncState::Loading {
                step: LoadingStep::Journal,
            },
        );

        let mut journal_since = since;
        let mut truncation_retried = false;

        loop {
            match self.source.backfill(
                journal_since,
                self.config.max_baseline_records,
                self.config.backfill_deadline,
            ) {
                Ok(mut records) => {
                    if records.len() > self.config.max_baseline_records {
                        records.truncate(self.config.max_baseline_records);
                    }
                    let (applied, gap) = self.apply(sink, records);
                    if let Some(gap) = gap {
                        if !rebuilt {
                            return self.baseline_attempt(sink, 0, true);
                        }
                        let error = BridgeError::new(
                            BridgeErrorCode::Internal,
                            format!(
                                "journal sequence gap at {} (expected {}); bd lost events",
                                gap.got, gap.expected
                            ),
                        );
                        return self.unavailable(sink, &error);
                    }
                    self.set_state(
                        sink,
                        SyncState::Healthy {
                            last_seq: self.last_seq,
                            last_event_at: self.last_event_at.clone(),
                        },
                    );
                    return BaselineOutcome::Healthy { applied };
                }
                Err(error) => match self.baseline_failure(
                    sink,
                    &error,
                    &mut journal_since,
                    &mut truncation_retried,
                ) {
                    FailureAction::Retry => continue,
                    FailureAction::Done(outcome) => return outcome,
                },
            }
        }
    }

    fn baseline_failure<K: SyncSink>(
        &mut self,
        sink: &mut K,
        error: &BridgeError,
        journal_since: &mut i64,
        retried: &mut bool,
    ) -> FailureAction {
        match error.code {
            BridgeErrorCode::JournalTruncated => {
                let Some((floor, _head)) = truncation_bounds(error) else {
                    return FailureAction::Done(self.unavailable(sink, error));
                };
                if *retried {
                    self.set_state(
                        sink,
                        SyncState::JournalTruncated {
                            floor,
                            recovered: false,
                        },
                    );
                    return FailureAction::Done(BaselineOutcome::JournalTruncated {
                        floor,
                        recovered: false,
                    });
                }
                *retried = true;
                self.last_seq = floor - 1;
                *journal_since = floor - 1;
                self.set_state(
                    sink,
                    SyncState::JournalTruncated {
                        floor,
                        recovered: true,
                    },
                );
                FailureAction::Retry
            }
            BridgeErrorCode::JournalDisabled => {
                self.set_state(sink, SyncState::JournalDisabled);
                FailureAction::Done(BaselineOutcome::JournalDisabled)
            }
            _ => FailureAction::Done(self.unavailable(sink, error)),
        }
    }

    /// Unblocks a follow read that is waiting on the journal.
    ///
    /// Callers must flip their `should_stop` flag first: the interrupted read
    /// returns end-of-stream, and the loop exits on the next flag check.
    pub fn interrupt_follow(&self) {
        self.source.interrupt_follow();
    }

    fn consume<K: SyncSink>(
        &mut self,
        mut stream: Box<dyn FollowStream>,
        sink: &mut K,
        should_stop: &impl Fn() -> bool,
    ) -> Consume {
        let mut working = false;

        loop {
            if should_stop() {
                return Consume::Stopped;
            }
            match stream.next_batch() {
                Ok(batch) if batch.is_empty() => return Consume::Ended,
                Ok(batch) => {
                    if !working {
                        working = true;
                        self.backoff.reset();
                    }
                    let (_, gap) = self.apply(sink, batch);
                    if let Some(gap) = gap {
                        return Consume::Terminal(FollowOutcome::Gap {
                            expected: gap.expected,
                            got: gap.got,
                        });
                    }
                    self.set_state(
                        sink,
                        SyncState::Healthy {
                            last_seq: self.last_seq,
                            last_event_at: self.last_event_at.clone(),
                        },
                    );
                }
                Err(error) => {
                    if let Some(outcome) = self.follow_terminal(sink, &error) {
                        return Consume::Terminal(outcome);
                    }
                    return Consume::Failed(error);
                }
            }
        }
    }

    fn follow_terminal<K: SyncSink>(
        &mut self,
        sink: &mut K,
        error: &BridgeError,
    ) -> Option<FollowOutcome> {
        match error.code {
            BridgeErrorCode::JournalDisabled => {
                self.set_state(sink, SyncState::JournalDisabled);
                Some(FollowOutcome::JournalDisabled)
            }
            BridgeErrorCode::JournalTruncated => {
                let floor = truncation_bounds(error)
                    .map(|(floor, _head)| floor)
                    .unwrap_or(self.last_seq);
                self.set_state(
                    sink,
                    SyncState::JournalTruncated {
                        floor,
                        recovered: false,
                    },
                );
                Some(FollowOutcome::JournalTruncated { floor })
            }
            _ => None,
        }
    }

    /// Applies records in order, dropping already-seen seqs and stopping at the
    /// first gap. Returns how many records were forwarded.
    fn apply<K: SyncSink>(
        &mut self,
        sink: &mut K,
        records: Vec<JournalRecord>,
    ) -> (usize, Option<SeqGap>) {
        let mut fresh = Vec::new();
        let mut gap = None;

        for record in records {
            if record.seq <= self.last_seq {
                continue;
            }
            if record.seq != self.last_seq + 1 {
                gap = Some(SeqGap {
                    expected: self.last_seq + 1,
                    got: record.seq,
                });
                break;
            }
            self.last_seq = record.seq;
            self.last_event_at = Some(record.ts.clone());
            fresh.push(record);
        }

        let applied = fresh.len();
        if !fresh.is_empty() {
            sink.records(&fresh);
        }
        (applied, gap)
    }

    fn wait_before_retry<K: SyncSink>(&mut self, sink: &mut K, sleep: &impl Fn(Duration)) -> bool {
        match self.backoff.next_delay() {
            Some((attempt, delay)) => {
                self.set_state(sink, SyncState::Restarting { attempt });
                sleep(delay);
                true
            }
            None => false,
        }
    }

    fn unavailable<K: SyncSink>(&mut self, sink: &mut K, error: &BridgeError) -> BaselineOutcome {
        self.set_state(
            sink,
            SyncState::BdUnavailable {
                error: error.clone(),
            },
        );
        BaselineOutcome::BdUnavailable(error.clone())
    }

    fn follow_unavailable<K: SyncSink>(
        &mut self,
        sink: &mut K,
        error: BridgeError,
    ) -> FollowOutcome {
        self.set_state(
            sink,
            SyncState::BdUnavailable {
                error: error.clone(),
            },
        );
        FollowOutcome::BdUnavailable(error)
    }

    fn set_state<K: SyncSink>(&mut self, sink: &mut K, state: SyncState) {
        self.state = state.clone();
        sink.state(&state);
    }
}

enum FailureAction {
    Retry,
    Done(BaselineOutcome),
}

enum Consume {
    Stopped,
    Ended,
    Failed(BridgeError),
    Terminal(FollowOutcome),
}

fn truncation_bounds(error: &BridgeError) -> Option<(i64, i64)> {
    let detail = &error.detail.as_ref()?.0;
    let floor = detail.get("floor")?.as_i64()?;
    let head = detail.get("head")?.as_i64()?;
    Some((floor, head))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bridge::types::ExtraFields;
    use crate::bridge::{BridgeError, BridgeErrorCode, Issue, JournalRecord};
    use crate::sync::state::{LoadingStep, RecordingSink};
    use serde_json::{Map, Value};
    use std::cell::{Cell, RefCell};
    use std::collections::VecDeque;
    use std::rc::Rc;
    use std::sync::Mutex;
    use std::time::Duration;

    const TS: &str = "2026-11-01T00:00:00Z";

    fn issue(id: &str) -> Issue {
        Issue {
            id: id.to_owned(),
            title: format!("Issue {id}"),
            description: String::new(),
            acceptance_criteria: None,
            status: "open".to_owned(),
            priority: 2,
            issue_type: "task".to_owned(),
            owner: None,
            assignee: None,
            created_at: TS.to_owned(),
            created_by: None,
            updated_at: TS.to_owned(),
            started_at: None,
            closed_at: None,
            labels: Vec::new(),
            comments: None,
            dependencies: None,
            dependency_count: 0,
            dependent_count: 0,
            comment_count: 0,
            extra: ExtraFields::default(),
        }
    }

    fn record(seq: i64, issue_id: &str) -> JournalRecord {
        JournalRecord {
            seq,
            ts: format!("2026-11-01T00:00:{seq:02}Z"),
            op: "update".to_owned(),
            issue_id: issue_id.to_owned(),
            actor: None,
            issue: Some(issue(issue_id)),
            dep: None,
            comment: None,
            extra: ExtraFields::default(),
        }
    }

    fn seqs(records: &[JournalRecord]) -> Vec<i64> {
        records.iter().map(|record| record.seq).collect()
    }

    fn disabled() -> BridgeError {
        BridgeError::new(
            BridgeErrorCode::JournalDisabled,
            "the events journal is disabled",
        )
    }

    fn truncated(floor: i64, head: i64) -> BridgeError {
        let mut detail = Map::new();
        detail.insert("floor".to_owned(), Value::from(floor));
        detail.insert("head".to_owned(), Value::from(head));
        BridgeError::new(
            BridgeErrorCode::JournalTruncated,
            "the events journal was pruned",
        )
        .with_detail(detail)
    }

    fn failed() -> BridgeError {
        BridgeError::new(BridgeErrorCode::BdExitNonzero, "bd exited with status 1")
    }

    /// A follow stream scripted batch by batch; an empty script means EOF.
    struct FakeFollow {
        batches: VecDeque<Result<Vec<JournalRecord>, BridgeError>>,
    }

    impl FakeFollow {
        fn new(batches: Vec<Result<Vec<JournalRecord>, BridgeError>>) -> Self {
            Self {
                batches: batches.into(),
            }
        }
    }

    impl FollowStream for FakeFollow {
        fn next_batch(&mut self) -> Result<Vec<JournalRecord>, BridgeError> {
            match self.batches.pop_front() {
                Some(result) => result,
                None => Ok(Vec::new()),
            }
        }
    }

    type FollowScript = Vec<Result<Vec<JournalRecord>, BridgeError>>;

    #[derive(Default)]
    struct FakeSource {
        export_result: Mutex<Option<Result<Vec<Issue>, BridgeError>>>,
        once_results: Mutex<VecDeque<Result<Vec<JournalRecord>, BridgeError>>>,
        follow_results: Mutex<VecDeque<Result<FollowScript, BridgeError>>>,
        once_since: Mutex<Vec<i64>>,
        follow_since: Mutex<Vec<i64>>,
    }

    impl FakeSource {
        fn with_export(issues: Vec<Issue>) -> Self {
            let source = Self::default();
            *source.export_result.lock().unwrap() = Some(Ok(issues));
            source
        }

        fn with_export_error(error: BridgeError) -> Self {
            let source = Self::default();
            *source.export_result.lock().unwrap() = Some(Err(error));
            source
        }

        fn once(self, result: Result<Vec<JournalRecord>, BridgeError>) -> Self {
            self.once_results.lock().unwrap().push_back(result);
            self
        }

        fn follow_ok(self, batches: FollowScript) -> Self {
            self.follow_results.lock().unwrap().push_back(Ok(batches));
            self
        }

        fn follow_err(self, error: BridgeError) -> Self {
            self.follow_results.lock().unwrap().push_back(Err(error));
            self
        }

        fn once_calls(&self) -> Vec<i64> {
            self.once_since.lock().unwrap().clone()
        }

        fn follow_calls(&self) -> Vec<i64> {
            self.follow_since.lock().unwrap().clone()
        }
    }

    impl SyncSource for FakeSource {
        fn export(&self) -> Result<Vec<Issue>, BridgeError> {
            self.export_result
                .lock()
                .unwrap()
                .take()
                .expect("unexpected export call")
        }

        fn journal(&self, since: i64, follow: bool) -> Result<Box<dyn FollowStream>, BridgeError> {
            if follow {
                self.follow_since.lock().unwrap().push(since);
                let scripted = self
                    .follow_results
                    .lock()
                    .unwrap()
                    .pop_front()
                    .expect("unexpected follow call");
                scripted.map(|batches| Box::new(FakeFollow::new(batches)) as Box<dyn FollowStream>)
            } else {
                self.once_since.lock().unwrap().push(since);
                let scripted = self
                    .once_results
                    .lock()
                    .unwrap()
                    .pop_front()
                    .expect("unexpected one-shot journal call");
                scripted.map(|records| {
                    Box::new(FakeFollow::new(vec![Ok(records)])) as Box<dyn FollowStream>
                })
            }
        }
    }

    /// A sink that exposes how many records have arrived, for stopping follow.
    struct CountingSink {
        inner: RecordingSink,
        seen: Rc<Cell<usize>>,
    }

    impl CountingSink {
        fn new() -> (Self, Rc<Cell<usize>>) {
            let seen = Rc::new(Cell::new(0));
            (
                Self {
                    inner: RecordingSink::default(),
                    seen: Rc::clone(&seen),
                },
                seen,
            )
        }
    }

    impl SyncSink for CountingSink {
        fn snapshot(&mut self, issues: &[Issue]) {
            self.inner.snapshot(issues);
        }

        fn records(&mut self, records: &[JournalRecord]) {
            self.inner.records(records);
            self.seen.set(self.inner.records.len());
        }

        fn state(&mut self, state: &SyncState) {
            self.inner.state(state);
        }
    }

    fn engine(source: FakeSource, config: SyncConfig) -> SyncEngine<FakeSource> {
        SyncEngine::new(source, config)
    }

    #[test]
    fn baseline_exports_then_backfills_and_reaches_healthy() {
        let source = FakeSource::with_export(vec![issue("a"), issue("b")])
            .once(Ok(vec![record(1, "a"), record(2, "b")]));
        let mut engine = engine(source, SyncConfig::default());
        let mut sink = RecordingSink::default();

        let outcome = engine.baseline(&mut sink, 0);

        assert_eq!(outcome, BaselineOutcome::Healthy { applied: 2 });
        assert_eq!(sink.snapshots.len(), 1);
        assert_eq!(sink.snapshots[0].len(), 2);
        assert_eq!(seqs(&sink.records), vec![1, 2]);
        assert_eq!(
            sink.states,
            vec![
                SyncState::Loading {
                    step: LoadingStep::Export
                },
                SyncState::Loading {
                    step: LoadingStep::Journal
                },
                SyncState::Healthy {
                    last_seq: 2,
                    last_event_at: Some("2026-11-01T00:00:02Z".to_owned()),
                },
            ]
        );
        assert_eq!(engine.source.once_calls(), vec![0]);
    }

    #[test]
    fn baseline_starts_from_the_checkpoint_and_drops_seen_records() {
        let source = FakeSource::with_export(vec![issue("a")]).once(Ok(vec![
            record(5, "a"),
            record(6, "a"),
            record(7, "a"),
        ]));
        let mut engine = engine(source, SyncConfig::default());
        let mut sink = RecordingSink::default();

        let outcome = engine.baseline(&mut sink, 5);

        assert_eq!(outcome, BaselineOutcome::Healthy { applied: 2 });
        assert_eq!(seqs(&sink.records), vec![6, 7]);
        assert_eq!(engine.source.once_calls(), vec![5]);
        assert_eq!(engine.last_seq(), 7);
    }

    #[test]
    fn truncation_retries_from_floor_minus_one() {
        let backfill: Vec<JournalRecord> = (50..=80).map(|seq| record(seq, "a")).collect();
        let source = FakeSource::with_export(vec![issue("a")])
            .once(Err(truncated(50, 80)))
            .once(Ok(backfill));
        let mut engine = engine(source, SyncConfig::default());
        let mut sink = RecordingSink::default();

        let outcome = engine.baseline(&mut sink, 0);

        assert_eq!(outcome, BaselineOutcome::Healthy { applied: 31 });
        assert_eq!(engine.source.once_calls(), vec![0, 49]);
        assert_eq!(seqs(&sink.records).first(), Some(&50));
        assert_eq!(seqs(&sink.records).last(), Some(&80));
        assert!(sink.states.contains(&SyncState::JournalTruncated {
            floor: 50,
            recovered: true,
        }));
        assert_eq!(
            sink.states.last(),
            Some(&SyncState::Healthy {
                last_seq: 80,
                last_event_at: Some("2026-11-01T00:00:80Z".to_owned()),
            })
        );
    }

    #[test]
    fn a_second_truncation_stops_with_recovered_false() {
        let source = FakeSource::with_export(vec![issue("a")])
            .once(Err(truncated(50, 80)))
            .once(Err(truncated(60, 90)));
        let mut engine = engine(source, SyncConfig::default());
        let mut sink = RecordingSink::default();

        let outcome = engine.baseline(&mut sink, 0);

        assert_eq!(
            outcome,
            BaselineOutcome::JournalTruncated {
                floor: 60,
                recovered: false
            }
        );
        assert_eq!(
            sink.states.last(),
            Some(&SyncState::JournalTruncated {
                floor: 60,
                recovered: false
            })
        );
    }

    #[test]
    fn journal_disabled_keeps_the_export_snapshot() {
        let source = FakeSource::with_export(vec![issue("a")]).once(Err(disabled()));
        let mut engine = engine(source, SyncConfig::default());
        let mut sink = RecordingSink::default();

        let outcome = engine.baseline(&mut sink, 0);

        assert_eq!(outcome, BaselineOutcome::JournalDisabled);
        assert_eq!(
            sink.snapshots.len(),
            1,
            "the snapshot still reaches the store"
        );
        assert!(sink.records.is_empty());
        assert_eq!(sink.states.last(), Some(&SyncState::JournalDisabled));
    }

    #[test]
    fn export_failure_publishes_no_snapshot_and_reports_the_error() {
        let source = FakeSource::with_export_error(failed());
        let mut engine = engine(source, SyncConfig::default());
        let mut sink = RecordingSink::default();

        let outcome = engine.baseline(&mut sink, 0);

        assert!(matches!(outcome, BaselineOutcome::BdUnavailable(_)));
        assert!(sink.snapshots.is_empty());
        match sink.states.last() {
            Some(SyncState::BdUnavailable { error }) => {
                assert_eq!(error.code, BridgeErrorCode::BdExitNonzero);
            }
            other => panic!("expected bd-unavailable, got {other:?}"),
        }
    }

    #[test]
    fn the_baseline_applies_at_most_the_record_limit() {
        let records: Vec<JournalRecord> = (1..=5).map(|seq| record(seq, "a")).collect();
        let source = FakeSource::with_export(vec![issue("a")]).once(Ok(records));
        let config = SyncConfig {
            max_baseline_records: 3,
            ..SyncConfig::default()
        };
        let mut engine = engine(source, config);
        let mut sink = RecordingSink::default();

        let outcome = engine.baseline(&mut sink, 0);

        assert_eq!(outcome, BaselineOutcome::Healthy { applied: 3 });
        assert_eq!(seqs(&sink.records), vec![1, 2, 3]);
        assert_eq!(engine.last_seq(), 3);
    }

    #[test]
    fn follow_delivers_the_backlog_left_by_the_limit() {
        let initial: Vec<JournalRecord> = (1..=5).map(|seq| record(seq, "a")).collect();
        let source = FakeSource::with_export(vec![issue("a")])
            .once(Ok(initial))
            .follow_ok(vec![Ok(vec![record(4, "a"), record(5, "a")])]);
        let config = SyncConfig {
            max_baseline_records: 3,
            ..SyncConfig::default()
        };
        let mut engine = engine(source, config);
        let (mut sink, seen) = CountingSink::new();

        assert_eq!(
            engine.baseline(&mut sink, 0),
            BaselineOutcome::Healthy { applied: 3 }
        );
        let outcome = engine.follow(&mut sink, || seen.get() >= 5, |_| {});

        assert_eq!(outcome, FollowOutcome::Stopped);
        assert_eq!(seqs(&sink.inner.records), vec![1, 2, 3, 4, 5]);
        assert_eq!(engine.source.follow_calls(), vec![3]);
    }

    #[test]
    fn follow_reconnects_with_the_spec_backoff_then_gives_up() {
        let source = FakeSource::with_export(vec![issue("a")])
            .follow_err(failed())
            .follow_err(failed())
            .follow_err(failed())
            .follow_err(failed())
            .follow_err(failed())
            .follow_err(failed());
        let mut engine = engine(source, SyncConfig::default());
        let mut sink = RecordingSink::default();
        let sleeps = RefCell::new(Vec::new());

        let outcome = engine.follow(
            &mut sink,
            || false,
            |delay: Duration| sleeps.borrow_mut().push(delay.as_millis()),
        );

        assert!(matches!(outcome, FollowOutcome::BdUnavailable(_)));
        assert_eq!(
            *sleeps.borrow(),
            vec![250, 500, 1000, 2000, 4000],
            "five delays before giving up"
        );
        let attempts: Vec<u32> = sink
            .states
            .iter()
            .filter_map(|state| match state {
                SyncState::Restarting { attempt } => Some(*attempt),
                _ => None,
            })
            .collect();
        assert_eq!(attempts, vec![1, 2, 3, 4, 5]);
        assert!(matches!(
            sink.states.last(),
            Some(SyncState::BdUnavailable { .. })
        ));
    }

    #[test]
    fn a_working_batch_resets_the_backoff() {
        let source = FakeSource::with_export(vec![issue("a")])
            .follow_err(failed())
            .follow_err(failed())
            .follow_ok(vec![Ok(vec![record(1, "a")]), Err(failed())])
            .follow_ok(vec![Ok(vec![record(2, "a")])]);
        let config = SyncConfig::default();
        let mut engine = engine(source, config);
        let (mut sink, seen) = CountingSink::new();
        let sleeps = RefCell::new(Vec::new());

        let outcome = engine.follow(
            &mut sink,
            || seen.get() >= 2,
            |delay: Duration| sleeps.borrow_mut().push(delay.as_millis()),
        );

        assert_eq!(outcome, FollowOutcome::Stopped);
        assert_eq!(
            *sleeps.borrow(),
            vec![250, 500, 250],
            "the successful batch reset the schedule"
        );
        assert_eq!(seqs(&sink.inner.records), vec![1, 2]);
    }

    #[test]
    fn journal_disabled_during_follow_stops_without_reconnecting() {
        let source = FakeSource::with_export(vec![issue("a")]).follow_err(disabled());
        let mut engine = engine(source, SyncConfig::default());
        let mut sink = RecordingSink::default();
        let sleeps = RefCell::new(Vec::new());

        let outcome = engine.follow(
            &mut sink,
            || false,
            |delay: Duration| sleeps.borrow_mut().push(delay),
        );

        assert_eq!(outcome, FollowOutcome::JournalDisabled);
        assert!(sleeps.borrow().is_empty());
        assert_eq!(sink.states.last(), Some(&SyncState::JournalDisabled));
    }

    #[test]
    fn truncation_during_follow_surfaces_the_floor() {
        let source =
            FakeSource::with_export(vec![issue("a")]).follow_ok(vec![Err(truncated(50, 80))]);
        let mut engine = engine(source, SyncConfig::default());
        let mut sink = RecordingSink::default();

        let outcome = engine.follow(&mut sink, || false, |_| {});

        assert_eq!(outcome, FollowOutcome::JournalTruncated { floor: 50 });
        assert_eq!(
            sink.states.last(),
            Some(&SyncState::JournalTruncated {
                floor: 50,
                recovered: false
            })
        );
    }

    #[test]
    fn a_sequence_gap_is_reported_instead_of_applied() {
        let source = FakeSource::with_export(vec![issue("a")]).follow_ok(vec![Ok(vec![
            record(1, "a"),
            record(2, "a"),
            record(5, "a"),
        ])]);
        let mut engine = engine(source, SyncConfig::default());
        let mut sink = RecordingSink::default();

        let outcome = engine.follow(&mut sink, || false, |_| {});

        assert_eq!(
            outcome,
            FollowOutcome::Gap {
                expected: 3,
                got: 5
            }
        );
        assert_eq!(seqs(&sink.records), vec![1, 2]);
    }

    struct BackfillSource {
        seen: Mutex<Vec<(usize, Duration)>>,
    }

    impl Default for BackfillSource {
        fn default() -> Self {
            Self {
                seen: Mutex::new(Vec::new()),
            }
        }
    }

    impl SyncSource for BackfillSource {
        fn export(&self) -> Result<Vec<Issue>, BridgeError> {
            Ok(Vec::new())
        }

        fn journal(
            &self,
            _since: i64,
            _follow: bool,
        ) -> Result<Box<dyn FollowStream>, BridgeError> {
            panic!("the baseline must use backfill")
        }

        fn backfill(
            &self,
            _since: i64,
            max_records: usize,
            deadline: Duration,
        ) -> Result<Vec<JournalRecord>, BridgeError> {
            self.seen.lock().unwrap().push((max_records, deadline));
            Ok(Vec::new())
        }
    }

    #[test]
    fn the_baseline_passes_the_record_and_time_budgets_to_the_source() {
        let source = BackfillSource::default();
        let config = SyncConfig {
            max_baseline_records: 12,
            backfill_deadline: Duration::from_millis(5),
        };
        let mut engine = SyncEngine::new(source, config);
        let mut sink = RecordingSink::default();

        assert_eq!(
            engine.baseline(&mut sink, 0),
            BaselineOutcome::Healthy { applied: 0 }
        );
        assert_eq!(
            engine.source.seen.lock().unwrap().clone(),
            vec![(12, Duration::from_millis(5))]
        );
    }

    #[test]
    fn the_default_config_caps_the_backfill_at_fifty_thousand_records_or_eight_seconds() {
        let config = SyncConfig::default();

        assert_eq!(config.max_baseline_records, 50_000);
        assert_eq!(config.backfill_deadline, Duration::from_secs(8));
    }
}
