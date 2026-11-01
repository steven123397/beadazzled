//! Pure mapping from write commands to bd argv and stdin.
//!
//! The process layer prepends `-C <workspace>` and runs the args without a
//! shell, so every user string here stays a single argument, verbatim.

use std::ffi::OsString;

/// Text at or above this size travels on stdin; argv keeps only the flag.
pub const LONG_TEXT_THRESHOLD: usize = 8 * 1024;

/// One user write action. Callers merge multiple field edits into one
/// [`UpdateSpec`] so a single action always becomes a single `bd update`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WriteCommand {
    Create(CreateSpec),
    Update(UpdateSpec),
    Close { id: String, reason: Option<String> },
    Reopen { id: String },
    Comment { id: String, text: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateSpec {
    pub title: String,
    /// Always sent on stdin, never in argv.
    pub description: String,
    pub issue_type: String,
    pub priority: u8,
    pub labels: Vec<String>,
    pub acceptance: Option<String>,
    pub assignee: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateSpec {
    pub id: String,
    pub status: Option<String>,
    pub priority: Option<u8>,
    pub assignee: Option<AssigneeChange>,
    pub title: Option<String>,
    /// Sent on stdin via `--body-file -` when present.
    pub description: Option<String>,
    pub acceptance: Option<String>,
    pub add_labels: Vec<String>,
    pub remove_labels: Vec<String>,
    pub if_status: Option<String>,
    pub if_assignee: Option<String>,
}

impl UpdateSpec {
    pub fn new(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            status: None,
            priority: None,
            assignee: None,
            title: None,
            description: None,
            acceptance: None,
            add_labels: Vec::new(),
            remove_labels: Vec::new(),
            if_status: None,
            if_assignee: None,
        }
    }
}

/// Three-state assignee edit: leave untouched, set a name, or clear it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AssigneeChange {
    Set(String),
    Clear,
}

/// The argv and stdin fed to `bd` by the process layer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Argv {
    pub args: Vec<OsString>,
    pub stdin: Option<Vec<u8>>,
}

pub fn argv_for(command: &WriteCommand) -> Argv {
    match command {
        WriteCommand::Create(spec) => create_argv(spec),
        WriteCommand::Update(spec) => update_argv(spec),
        WriteCommand::Close { id, reason } => close_argv(id, reason.as_deref()),
        WriteCommand::Reopen { id } => Argv {
            args: vec![OsString::from("reopen"), OsString::from(id.as_str())],
            stdin: None,
        },
        WriteCommand::Comment { id, text } => Argv {
            args: vec![
                OsString::from("comment"),
                OsString::from(id.as_str()),
                OsString::from("--stdin"),
            ],
            stdin: Some(text.clone().into_bytes()),
        },
    }
}

fn create_argv(spec: &CreateSpec) -> Argv {
    let mut args = vec![OsString::from("create")];
    push_flag(&mut args, "--title", spec.title.clone());
    push_flag(&mut args, "--type", spec.issue_type.clone());
    push_flag(&mut args, "--priority", spec.priority.to_string());

    if let Some(assignee) = &spec.assignee {
        push_flag(&mut args, "--assignee", assignee.clone());
    }
    if let Some(acceptance) = &spec.acceptance {
        push_flag(&mut args, "--acceptance", acceptance.clone());
    }
    if !spec.labels.is_empty() {
        push_flag(&mut args, "--labels", spec.labels.join(","));
    }
    if spec.description.is_empty() {
        args.push(OsString::from("--allow-empty-description"));
    }

    args.push(OsString::from("--silent"));
    args.push(OsString::from("--stdin"));

    Argv {
        args,
        stdin: Some(spec.description.clone().into_bytes()),
    }
}

fn update_argv(spec: &UpdateSpec) -> Argv {
    let mut args = vec![OsString::from("update"), OsString::from(spec.id.as_str())];

    if let Some(status) = &spec.status {
        push_flag(&mut args, "-s", status.clone());
    }
    if let Some(priority) = spec.priority {
        push_flag(&mut args, "-p", priority.to_string());
    }
    if let Some(assignee) = &spec.assignee {
        let value = match assignee {
            AssigneeChange::Set(name) => OsString::from(name),
            // `-a ""` is the recorded way to clear the assignee.
            AssigneeChange::Clear => OsString::new(),
        };
        args.push(OsString::from("-a"));
        args.push(value);
    }
    if let Some(title) = &spec.title {
        push_flag(&mut args, "--title", title.clone());
    }

    let stdin = if let Some(description) = &spec.description {
        args.push(OsString::from("--body-file"));
        args.push(OsString::from("-"));
        Some(description.clone().into_bytes())
    } else {
        None
    };

    if let Some(acceptance) = &spec.acceptance {
        push_flag(&mut args, "--acceptance", acceptance.clone());
    }
    for label in &spec.add_labels {
        push_flag(&mut args, "--add-label", label.clone());
    }
    for label in &spec.remove_labels {
        push_flag(&mut args, "--remove-label", label.clone());
    }
    if let Some(if_status) = &spec.if_status {
        push_flag(&mut args, "--if-status", if_status.clone());
    }
    if let Some(if_assignee) = &spec.if_assignee {
        push_flag(&mut args, "--if-assignee", if_assignee.clone());
    }

    Argv { args, stdin }
}

fn close_argv(id: &str, reason: Option<&str>) -> Argv {
    let mut args = vec![OsString::from("close"), OsString::from(id)];
    let mut stdin = None;

    if let Some(reason) = reason.filter(|reason| !reason.is_empty()) {
        if reason.len() >= LONG_TEXT_THRESHOLD {
            args.push(OsString::from("--reason-file"));
            args.push(OsString::from("-"));
            stdin = Some(reason.as_bytes().to_vec());
        } else {
            push_flag(&mut args, "-r", reason.to_owned());
        }
    }

    Argv { args, stdin }
}

fn push_flag(args: &mut Vec<OsString>, flag: &str, value: impl Into<OsString>) {
    args.push(OsString::from(flag));
    args.push(value.into());
}
