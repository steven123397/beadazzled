//! The only place that spawns `bd`.
//!
//! Short calls (`run`) are serialized per workspace and enforce a timeout, a
//! Job Object kill-on-close, a pipe grace period and output limits. Journal
//! follow processes (`spawn_follow`) bypass the workspace semaphore and have
//! no timeout; the caller reads their stdout incrementally.
//!
//! Windows-only by design: this app targets Windows, and the process rules in
//! SPEC-bridge depend on `CREATE_NO_WINDOW`, Job Objects and named-pipe peeks.

use std::collections::{HashMap, VecDeque};
use std::ffi::OsString;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, ChildStdout, Command, ExitStatus, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::Value;
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows_sys::Win32::System::Pipes::PeekNamedPipe;

use crate::bridge::{BridgeError, BridgeErrorCode};

/// Timeouts from SPEC-bridge §进程规则.
pub const VERSION_TIMEOUT: Duration = Duration::from_secs(5);
pub const READ_TIMEOUT: Duration = Duration::from_secs(30);
pub const WRITE_TIMEOUT: Duration = Duration::from_secs(20);

/// How long to keep reading after the child exits before force-closing pipes.
pub const PIPE_GRACE: Duration = Duration::from_secs(1);

const POLL_INTERVAL: Duration = Duration::from_millis(10);
const CALL_LOG_CAPACITY: usize = 200;
const ARGV_SUMMARY_LIMIT: usize = 200;
const READ_CHUNK: usize = 64 * 1024;
const STDERR_CHUNK: usize = 8 * 1024;
const FOLLOW_STDERR_LIMIT: usize = 2 * 1024;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Output caps; the defaults are the SPEC-bridge values.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OutputLimits {
    pub total: usize,
    pub line: usize,
    pub stderr: usize,
}

impl Default for OutputLimits {
    fn default() -> Self {
        Self {
            total: 64 * 1024 * 1024,
            line: 16 * 1024 * 1024,
            stderr: 2 * 1024,
        }
    }
}

/// One `bd` invocation.
///
/// Workspace-scoped calls always prepend `-C <workspace>`. Global probes such
/// as `bd --version` use [`ProcessRequest::global`] and omit `-C`, because bd
/// 1.3.2 rejects `-C` on a directory that is not a beads workspace.
#[derive(Debug, Clone)]
pub struct ProcessRequest {
    pub command: String,
    pub workspace: Option<PathBuf>,
    pub args: Vec<OsString>,
    pub stdin: Option<Vec<u8>>,
    /// Short calls always have a timeout; `spawn_follow` ignores this field.
    pub timeout: Duration,
    pub env: Vec<(OsString, OsString)>,
    pub limits: OutputLimits,
}

impl ProcessRequest {
    pub fn new(
        command: impl Into<String>,
        workspace: impl Into<PathBuf>,
        args: Vec<OsString>,
    ) -> Self {
        Self {
            command: command.into(),
            workspace: Some(workspace.into()),
            args,
            stdin: None,
            timeout: READ_TIMEOUT,
            env: Vec::new(),
            limits: OutputLimits::default(),
        }
    }

    /// A workspace-less call (for example `bd --version`).
    pub fn global(command: impl Into<String>, args: Vec<OsString>) -> Self {
        Self {
            command: command.into(),
            workspace: None,
            args,
            stdin: None,
            timeout: READ_TIMEOUT,
            env: Vec::new(),
            limits: OutputLimits::default(),
        }
    }
}

/// Captured result of a short call. Nonzero exits are returned, not mapped.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessOutput {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub duration: Duration,
}

/// One entry in the diagnostics ring buffer.
#[derive(Debug, Clone)]
pub struct CallRecord {
    pub command: String,
    pub argv_summary: String,
    pub duration: Duration,
    pub exit_code: Option<i32>,
    pub error_code: Option<BridgeErrorCode>,
}

type CallLog = Arc<Mutex<VecDeque<CallRecord>>>;

/// Runs short bd calls serially per workspace and records diagnostics.
#[derive(Debug)]
pub struct ProcessRunner {
    bd_path: PathBuf,
    workspace_locks: Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>,
    calls: CallLog,
}

impl ProcessRunner {
    pub fn new(bd_path: impl Into<PathBuf>) -> Self {
        Self {
            bd_path: bd_path.into(),
            workspace_locks: Mutex::new(HashMap::new()),
            calls: Arc::new(Mutex::new(VecDeque::new())),
        }
    }

    pub fn bd_path(&self) -> &Path {
        &self.bd_path
    }

    /// Runs a short call. The workspace lock is held for the whole call, so a
    /// refresh and a write on the same workspace never overlap. The timeout
    /// starts after the lock is acquired: queueing behind another call must not
    /// consume this call's budget.
    pub fn run(&self, request: &ProcessRequest) -> Result<ProcessOutput, BridgeError> {
        let (result, started) = match &request.workspace {
            Some(workspace) => {
                let lock = self.workspace_lock(workspace);
                let _guard = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
                let started = Instant::now();
                (self.run_locked(request, started), started)
            }
            None => {
                let started = Instant::now();
                (self.run_locked(request, started), started)
            }
        };

        match result {
            Ok(output) => {
                self.record(request, started, Some(output.exit_code), None);
                Ok(output)
            }
            Err(error) => {
                self.record(request, started, None, Some(error.code));
                Err(error)
            }
        }
    }

    /// Starts a long-running journal follow process. It deliberately does not
    /// take the workspace lock: otherwise a follow would block every refresh
    /// and write until the process exits.
    pub fn spawn_follow(&self, request: &ProcessRequest) -> Result<FollowProcess, BridgeError> {
        let started = Instant::now();
        let follow_request = ProcessRequest {
            stdin: None,
            ..request.clone()
        };

        let (mut child, job) = match self.spawn_child(&follow_request) {
            Ok(pair) => pair,
            Err(error) => {
                self.record(request, started, None, Some(error.code));
                return Err(error);
            }
        };

        let stdout = child.stdout.take();
        let stderr_buffer = Arc::new(Mutex::new(Vec::new()));
        if let Some(stderr) = child.stderr.take() {
            let buffer = Arc::clone(&stderr_buffer);
            std::thread::spawn(move || drain_follow_stderr(stderr, buffer));
        }

        Ok(FollowProcess {
            child,
            job,
            stdout,
            stderr: stderr_buffer,
            log: Arc::clone(&self.calls),
            command: request.command.clone(),
            argv_summary: argv_summary(&request.args),
            started,
            finished: false,
        })
    }

    /// Most recent calls, oldest first.
    pub fn recent_calls(&self) -> Vec<CallRecord> {
        self.calls
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .cloned()
            .collect()
    }

    fn run_locked(
        &self,
        request: &ProcessRequest,
        started: Instant,
    ) -> Result<ProcessOutput, BridgeError> {
        let (mut child, job) = self.spawn_child(request)?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| internal_error("bd stdout pipe was not created"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| internal_error("bd stderr pipe was not created"))?;

        match capture(&mut child, stdout, stderr, request, started) {
            Ok(output) => Ok(output),
            Err(error) => {
                job.terminate();
                let _ = child.wait();
                Err(error)
            }
        }
    }

    fn spawn_child(&self, request: &ProcessRequest) -> Result<(Child, JobHandle), BridgeError> {
        let mut command = Command::new(&self.bd_path);
        if let Some(workspace) = &request.workspace {
            command.arg("-C").arg(workspace);
        }
        command
            .args(&request.args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(if request.stdin.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            });

        for (key, value) in &request.env {
            command.env(key, value);
        }

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = command
            .spawn()
            .map_err(|error| spawn_error(&self.bd_path, error))?;
        let job = match JobHandle::assign(&child) {
            Ok(job) => job,
            Err(error) => {
                // Do not leave an uncontained process behind.
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        };

        if let Some(input) = &request.stdin {
            if let Some(mut stdin) = child.stdin.take() {
                let input = input.clone();
                std::thread::spawn(move || {
                    let _ = stdin.write_all(&input);
                });
            }
        }

        Ok((child, job))
    }

    fn workspace_lock(&self, workspace: &Path) -> Arc<Mutex<()>> {
        self.workspace_locks
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .entry(Self::normalize_workspace(workspace))
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    fn normalize_workspace(workspace: &Path) -> PathBuf {
        // Windows treats these as the same directory, but PathBuf equality does
        // not: normalize before using the path as a mutex key.
        let trimmed = workspace
            .to_string_lossy()
            .trim_end_matches(['\\', '/'])
            .to_owned();
        let canonical = std::fs::canonicalize(&trimmed).unwrap_or_else(|_| PathBuf::from(&trimmed));
        let text = canonical.to_string_lossy();
        let stripped = text.strip_prefix(r"\\?\").unwrap_or(&text);
        PathBuf::from(stripped.to_lowercase())
    }

    fn record(
        &self,
        request: &ProcessRequest,
        started: Instant,
        exit_code: Option<i32>,
        error_code: Option<BridgeErrorCode>,
    ) {
        push_record(
            &self.calls,
            CallRecord {
                command: request.command.clone(),
                argv_summary: argv_summary(&request.args),
                duration: started.elapsed(),
                exit_code,
                error_code,
            },
        );
    }
}

fn drain_follow_stderr(mut stderr: ChildStderr, buffer: Arc<Mutex<Vec<u8>>>) {
    let mut chunk = [0u8; STDERR_CHUNK];
    loop {
        match stderr.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(read) => {
                let mut captured = buffer
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                let remaining = FOLLOW_STDERR_LIMIT.saturating_sub(captured.len());
                if remaining > 0 {
                    let take = remaining.min(read);
                    captured.extend_from_slice(&chunk[..take]);
                }
            }
        }
    }
}

/// A long-running follow process. Dropping it kills the whole process tree.
pub struct FollowProcess {
    child: Child,
    job: JobHandle,
    stdout: Option<ChildStdout>,
    stderr: Arc<Mutex<Vec<u8>>>,
    log: CallLog,
    command: String,
    argv_summary: String,
    started: Instant,
    finished: bool,
}

impl FollowProcess {
    pub fn id(&self) -> u32 {
        self.child.id()
    }

    pub fn take_stdout(&mut self) -> Option<ChildStdout> {
        self.stdout.take()
    }

    /// The first 2 KiB of follow stderr, drained internally so the child can
    /// never block on a full stderr pipe.
    pub fn stderr_snapshot(&self) -> Vec<u8> {
        self.stderr
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    pub fn stderr_lossy(&self) -> String {
        String::from_utf8_lossy(&self.stderr_snapshot()).into_owned()
    }

    pub fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        self.child.try_wait()
    }

    pub fn kill(&mut self) -> io::Result<()> {
        self.stop();
        Ok(())
    }

    fn stop(&mut self) {
        if self.finished {
            return;
        }
        self.finished = true;

        let exit_code = self
            .child
            .try_wait()
            .ok()
            .flatten()
            .and_then(|status| status.code());
        self.job.terminate();
        let _ = self.child.wait();

        push_record(
            &self.log,
            CallRecord {
                command: self.command.clone(),
                argv_summary: self.argv_summary.clone(),
                duration: self.started.elapsed(),
                exit_code,
                error_code: None,
            },
        );
    }
}

impl Drop for FollowProcess {
    fn drop(&mut self) {
        self.stop();
    }
}

fn capture(
    child: &mut Child,
    mut stdout: ChildStdout,
    mut stderr: ChildStderr,
    request: &ProcessRequest,
    started: Instant,
) -> Result<ProcessOutput, BridgeError> {
    let limits = request.limits;
    let deadline = started + request.timeout;
    let mut out = Vec::new();
    let mut err = Vec::new();
    let mut budget = OutputBudget::default();
    let mut stdout_buf = [0u8; READ_CHUNK];
    let mut stderr_buf = [0u8; STDERR_CHUNK];
    let stdout_handle = stdout_handle(&stdout);
    let stderr_handle = stderr_handle(&stderr);
    let mut stdout_eof = false;
    let mut stderr_eof = false;
    let mut status: Option<ExitStatus> = None;
    let mut grace_deadline: Option<Instant> = None;

    loop {
        let mut progressed = false;

        if !stdout_eof {
            match pump_stdout(
                &mut stdout,
                stdout_handle,
                &mut stdout_buf,
                &mut out,
                &mut budget,
                limits,
            )? {
                PipeState::Idle => {}
                PipeState::Progress => progressed = true,
                PipeState::Eof => stdout_eof = true,
            }
        }

        if !stderr_eof {
            match pump_stderr(
                &mut stderr,
                stderr_handle,
                &mut stderr_buf,
                &mut err,
                limits,
            ) {
                PipeState::Idle => {}
                PipeState::Progress => progressed = true,
                PipeState::Eof => stderr_eof = true,
            }
        }

        if status.is_none() {
            if let Some(exit) = child
                .try_wait()
                .map_err(|error| internal_error(format!("waiting for bd failed: {error}")))?
            {
                status = Some(exit);
                grace_deadline = Some(Instant::now() + PIPE_GRACE);
            }
        }

        match status {
            Some(exit) => {
                if stdout_eof && stderr_eof {
                    return build_output(exit, out, err, started);
                }
                if grace_deadline.is_some_and(|grace| Instant::now() >= grace) {
                    if !stdout_eof {
                        // Force-closing a still-open stdout can drop the tail
                        // of a JSONL export; never return partial data as Ok.
                        return Err(partial_stdout_error(out.len(), err.len()));
                    }
                    return build_output(exit, out, err, started);
                }
            }
            None => {
                if Instant::now() >= deadline {
                    return Err(timeout_error(request));
                }
            }
        }

        if !progressed {
            std::thread::sleep(POLL_INTERVAL);
        }
    }
}

enum PipeState {
    Idle,
    Progress,
    Eof,
}

enum Available {
    Empty,
    Bytes(usize),
    Eof,
}

fn pump_stdout(
    pipe: &mut ChildStdout,
    handle: HANDLE,
    buffer: &mut [u8],
    out: &mut Vec<u8>,
    budget: &mut OutputBudget,
    limits: OutputLimits,
) -> Result<PipeState, BridgeError> {
    match available_bytes(handle) {
        Available::Empty => Ok(PipeState::Idle),
        Available::Eof => Ok(PipeState::Eof),
        Available::Bytes(available) => {
            let want = available.min(buffer.len());
            match pipe.read(&mut buffer[..want]) {
                Ok(0) => Ok(PipeState::Eof),
                Ok(read) => {
                    if !budget.push(&buffer[..read], limits) {
                        return Err(output_too_large(limits, budget.total()));
                    }
                    out.extend_from_slice(&buffer[..read]);
                    Ok(PipeState::Progress)
                }
                Err(error) => Err(internal_error(format!("reading bd stdout failed: {error}"))),
            }
        }
    }
}

fn pump_stderr(
    pipe: &mut ChildStderr,
    handle: HANDLE,
    buffer: &mut [u8],
    err: &mut Vec<u8>,
    limits: OutputLimits,
) -> PipeState {
    match available_bytes(handle) {
        Available::Empty => PipeState::Idle,
        Available::Eof => PipeState::Eof,
        Available::Bytes(available) => {
            let want = available.min(buffer.len());
            match pipe.read(&mut buffer[..want]) {
                Ok(0) => PipeState::Eof,
                Ok(read) => {
                    let remaining = limits.stderr.saturating_sub(err.len());
                    if remaining > 0 {
                        let take = remaining.min(read);
                        err.extend_from_slice(&buffer[..take]);
                    }
                    PipeState::Progress
                }
                Err(_) => PipeState::Eof,
            }
        }
    }
}

fn available_bytes(handle: HANDLE) -> Available {
    let mut available = 0u32;
    let ok = unsafe {
        PeekNamedPipe(
            handle,
            std::ptr::null_mut(),
            0,
            std::ptr::null_mut(),
            &mut available,
            std::ptr::null_mut(),
        )
    };

    // A failed peek means the writer side is gone (or the pipe is unusable).
    // Either way there is nothing more to read; the exit code still tells the
    // caller what happened.
    if ok == 0 {
        Available::Eof
    } else if available == 0 {
        Available::Empty
    } else {
        Available::Bytes(available as usize)
    }
}

fn stdout_handle(stdout: &ChildStdout) -> HANDLE {
    use std::os::windows::io::AsRawHandle;
    stdout.as_raw_handle() as HANDLE
}

fn stderr_handle(stderr: &ChildStderr) -> HANDLE {
    use std::os::windows::io::AsRawHandle;
    stderr.as_raw_handle() as HANDLE
}

#[derive(Default)]
struct OutputBudget {
    total: usize,
    line: usize,
}

impl OutputBudget {
    fn push(&mut self, bytes: &[u8], limits: OutputLimits) -> bool {
        self.total += bytes.len();
        if self.total > limits.total {
            return false;
        }

        for byte in bytes {
            if *byte == b'\n' {
                self.line = 0;
            } else {
                self.line += 1;
                if self.line > limits.line {
                    return false;
                }
            }
        }

        true
    }

    fn total(&self) -> usize {
        self.total
    }
}

fn build_output(
    status: ExitStatus,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    started: Instant,
) -> Result<ProcessOutput, BridgeError> {
    let stdout = String::from_utf8(stdout).map_err(|error| {
        BridgeError::new(
            BridgeErrorCode::BdParseFailed,
            format!("bd stdout was not valid UTF-8: {error}"),
        )
    })?;

    Ok(ProcessOutput {
        exit_code: status.code().unwrap_or(-1),
        stdout,
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
        duration: started.elapsed(),
    })
}

fn timeout_error(request: &ProcessRequest) -> BridgeError {
    let timeout = request.timeout;
    let mut detail = serde_json::Map::new();
    detail.insert("command".to_owned(), Value::String(request.command.clone()));
    detail.insert(
        "timeout_ms".to_owned(),
        Value::from(timeout.as_millis() as u64),
    );

    BridgeError::new(
        BridgeErrorCode::BdTimeout,
        format!(
            "bd {} timed out after {} ms",
            request.command,
            timeout.as_millis()
        ),
    )
    .with_detail(detail)
}

fn partial_stdout_error(stdout_bytes: usize, stderr_bytes: usize) -> BridgeError {
    let mut detail = serde_json::Map::new();
    detail.insert("stdout_bytes".to_owned(), Value::from(stdout_bytes as u64));
    detail.insert("stderr_bytes".to_owned(), Value::from(stderr_bytes as u64));

    BridgeError::new(
        BridgeErrorCode::BdParseFailed,
        "bd exited while stdout was still open; output may be truncated",
    )
    .with_detail(detail)
}

fn output_too_large(limits: OutputLimits, total: usize) -> BridgeError {
    let mut detail = serde_json::Map::new();
    detail.insert("limit_bytes".to_owned(), Value::from(limits.total as u64));
    detail.insert(
        "line_limit_bytes".to_owned(),
        Value::from(limits.line as u64),
    );
    detail.insert("read_bytes".to_owned(), Value::from(total as u64));

    BridgeError::new(
        BridgeErrorCode::BdOutputTooLarge,
        "bd produced more output than the bridge can capture",
    )
    .with_detail(detail)
}

fn spawn_error(path: &Path, error: io::Error) -> BridgeError {
    let mut detail = serde_json::Map::new();
    detail.insert("path".to_owned(), Value::String(path.display().to_string()));

    let raw = error.raw_os_error();
    let (code, message) = match error.kind() {
        io::ErrorKind::NotFound => (
            BridgeErrorCode::BdNotFound,
            format!("bd was not found at {}", path.display()),
        ),
        io::ErrorKind::PermissionDenied => (
            BridgeErrorCode::BdNotExecutable,
            format!("bd at {} cannot be executed", path.display()),
        ),
        // ERROR_BAD_EXE_FORMAT (193) and ERROR_FILENAME_EXCED_RANGE (206)
        // surface as ErrorKind::Uncategorized on Windows.
        _ if raw == Some(193) || raw == Some(206) => (
            BridgeErrorCode::BdNotExecutable,
            format!("bd at {} cannot be executed", path.display()),
        ),
        _ => (
            BridgeErrorCode::Internal,
            format!("could not start bd at {}: {error}", path.display()),
        ),
    };

    BridgeError::new(code, message).with_detail(detail)
}

fn internal_error(message: impl Into<String>) -> BridgeError {
    BridgeError::new(BridgeErrorCode::Internal, message)
}

fn argv_summary(args: &[OsString]) -> String {
    let joined = args
        .iter()
        .map(|arg| arg.to_string_lossy())
        .collect::<Vec<_>>()
        .join(" ");
    truncate_chars(&joined, ARGV_SUMMARY_LIMIT)
}

fn truncate_chars(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_owned();
    }

    let mut truncated: String = text.chars().take(limit).collect();
    truncated.push('…');
    truncated
}

fn push_record(log: &CallLog, record: CallRecord) {
    let mut calls = log.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if calls.len() >= CALL_LOG_CAPACITY {
        calls.pop_front();
    }
    calls.push_back(record);
}

struct JobHandle(HANDLE);

impl JobHandle {
    fn assign(child: &Child) -> Result<Self, BridgeError> {
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(internal_error(format!(
                "CreateJobObject failed: {}",
                io::Error::last_os_error()
            )));
        }
        let job = Self(handle);

        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let ok = unsafe {
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if ok == 0 {
            return Err(internal_error(format!(
                "SetInformationJobObject failed: {}",
                io::Error::last_os_error()
            )));
        }

        use std::os::windows::io::AsRawHandle;
        let process = child.as_raw_handle() as HANDLE;
        let ok = unsafe { AssignProcessToJobObject(job.0, process) };
        if ok == 0 {
            return Err(internal_error(format!(
                "AssignProcessToJobObject failed: {}",
                io::Error::last_os_error()
            )));
        }

        Ok(job)
    }

    fn terminate(&self) {
        unsafe {
            TerminateJobObject(self.0, 1);
        }
    }
}

impl Drop for JobHandle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(command: &str) -> CallRecord {
        CallRecord {
            command: command.to_owned(),
            argv_summary: String::new(),
            duration: Duration::ZERO,
            exit_code: None,
            error_code: None,
        }
    }

    #[test]
    fn call_log_keeps_the_latest_two_hundred_records() {
        let log: CallLog = Arc::new(Mutex::new(VecDeque::new()));
        for index in 0..205 {
            push_record(&log, sample(&index.to_string()));
        }

        let calls = log.lock().expect("log lock");
        assert_eq!(calls.len(), CALL_LOG_CAPACITY);
        assert_eq!(calls.front().expect("front").command, "5");
        assert_eq!(calls.back().expect("back").command, "204");
    }

    #[test]
    fn argv_summary_truncates_long_arguments() {
        let args = vec![OsString::from("x".repeat(300))];
        let summary = argv_summary(&args);

        assert_eq!(summary.chars().count(), ARGV_SUMMARY_LIMIT + 1);
        assert!(summary.ends_with('…'));
    }
}
