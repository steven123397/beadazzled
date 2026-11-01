//! Table-driven tests for the pure write-command argv mapping.
//!
//! These assert exact argv and stdin contents; the process layer adds `-C`
//! and never uses a shell.

use std::ffi::OsString;

use beadazzled_lib::bridge::argv::{
    argv_for, AssigneeChange, CreateSpec, UpdateSpec, WriteCommand, LONG_TEXT_THRESHOLD,
};

fn strings(args: &[OsString]) -> Vec<String> {
    args.iter()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect()
}

fn assert_args(actual: &[OsString], expected: &[&str]) {
    let expected: Vec<String> = expected.iter().map(|value| (*value).to_owned()).collect();
    assert_eq!(strings(actual), expected);
}

fn create_spec(title: &str, description: &str) -> CreateSpec {
    CreateSpec {
        title: title.to_owned(),
        description: description.to_owned(),
        issue_type: "task".to_owned(),
        priority: 2,
        labels: Vec::new(),
        acceptance: None,
        assignee: None,
    }
}

#[test]
fn create_puts_the_description_on_stdin_and_asks_for_the_id() {
    let command = WriteCommand::Create(CreateSpec {
        title: "Fix login".to_owned(),
        description: "line one\nline two".to_owned(),
        issue_type: "bug".to_owned(),
        priority: 1,
        labels: vec!["auth".to_owned(), "windows".to_owned()],
        acceptance: Some("no redirect loop".to_owned()),
        assignee: Some("alice".to_owned()),
    });

    let argv = argv_for(&command);

    assert_args(
        &argv.args,
        &[
            "create",
            "--title",
            "Fix login",
            "--type",
            "bug",
            "--priority",
            "1",
            "--assignee",
            "alice",
            "--acceptance",
            "no redirect loop",
            "--labels",
            "auth,windows",
            "--silent",
            "--stdin",
        ],
    );
    assert_eq!(
        argv.stdin.as_deref(),
        Some(b"line one\nline two".as_slice())
    );
}

#[test]
fn create_adds_allow_empty_description_only_for_an_empty_body() {
    let argv = argv_for(&WriteCommand::Create(create_spec("T", "")));

    assert_args(
        &argv.args,
        &[
            "create",
            "--title",
            "T",
            "--type",
            "task",
            "--priority",
            "2",
            "--allow-empty-description",
            "--silent",
            "--stdin",
        ],
    );
    assert_eq!(argv.stdin.as_deref(), Some(b"".as_slice()));
}

#[test]
fn update_merges_every_field_into_one_command() {
    let mut spec = UpdateSpec::new("bza-1");
    spec.status = Some("closed".to_owned());
    spec.priority = Some(1);
    spec.assignee = Some(AssigneeChange::Set("bob".to_owned()));
    spec.title = Some("New title".to_owned());
    spec.description = Some("new body\n".to_owned());
    spec.acceptance = Some("done".to_owned());
    spec.add_labels = vec!["ui".to_owned(), "中文".to_owned()];
    spec.remove_labels = vec!["old".to_owned()];
    spec.if_status = Some("in_progress".to_owned());
    spec.if_assignee = Some("bob".to_owned());

    let argv = argv_for(&WriteCommand::Update(spec));

    assert_args(
        &argv.args,
        &[
            "update",
            "bza-1",
            "-s",
            "closed",
            "-p",
            "1",
            "-a",
            "bob",
            "--title",
            "New title",
            "--body-file",
            "-",
            "--acceptance",
            "done",
            "--add-label",
            "ui",
            "--add-label",
            "中文",
            "--remove-label",
            "old",
            "--if-status",
            "in_progress",
            "--if-assignee",
            "bob",
        ],
    );
    assert_eq!(argv.stdin.as_deref(), Some(b"new body\n".as_slice()));
    assert_eq!(
        strings(&argv.args)
            .iter()
            .filter(|arg| arg.as_str() == "update")
            .count(),
        1
    );
}

#[test]
fn update_status_carries_the_expected_status_guard() {
    let mut spec = UpdateSpec::new("bza-1");
    spec.status = Some("in_progress".to_owned());
    spec.if_status = Some("open".to_owned());

    let argv = argv_for(&WriteCommand::Update(spec));

    assert_args(
        &argv.args,
        &[
            "update",
            "bza-1",
            "-s",
            "in_progress",
            "--if-status",
            "open",
        ],
    );
    assert!(argv.stdin.is_none());
}

#[test]
fn clearing_the_assignee_uses_an_empty_argument() {
    let mut spec = UpdateSpec::new("bza-2");
    spec.assignee = Some(AssigneeChange::Clear);

    let argv = argv_for(&WriteCommand::Update(spec));

    assert_args(&argv.args, &["update", "bza-2", "-a", ""]);
}

#[test]
fn clearing_the_description_adds_allow_empty_description() {
    let mut spec = UpdateSpec::new("bza-2");
    spec.description = Some(String::new());

    let argv = argv_for(&WriteCommand::Update(spec));

    assert_args(
        &argv.args,
        &[
            "update",
            "bza-2",
            "--body-file",
            "-",
            "--allow-empty-description",
        ],
    );
    assert_eq!(argv.stdin.as_deref(), Some(b"".as_slice()));
}

#[test]
fn long_descriptions_never_appear_in_argv() {
    let description = format!("中文 \"quoted\" & |\n{}", "x".repeat(64 * 1024));
    let mut spec = UpdateSpec::new("bza-1");
    spec.description = Some(description.clone());

    let argv = argv_for(&WriteCommand::Update(spec));

    assert_eq!(argv.stdin.as_deref(), Some(description.as_bytes()));
    assert!(argv
        .args
        .iter()
        .all(|arg| arg.to_string_lossy() != description));
    let argv_bytes: usize = argv
        .args
        .iter()
        .map(|arg| arg.to_string_lossy().len())
        .sum();
    assert!(
        argv_bytes < LONG_TEXT_THRESHOLD,
        "{argv_bytes} bytes in argv"
    );
}

#[test]
fn special_characters_are_passed_verbatim_in_argv() {
    let title = "中文标题 \"quoted\" & |\nsecond line";
    let acceptance = "验收：换行\n与引号 \"ok\"";
    let label = "标签, 带空格";
    let command = WriteCommand::Create(CreateSpec {
        title: title.to_owned(),
        description: "body".to_owned(),
        issue_type: "task".to_owned(),
        priority: 0,
        labels: vec![label.to_owned()],
        acceptance: Some(acceptance.to_owned()),
        assignee: None,
    });

    let argv = argv_for(&command);
    let args = strings(&argv.args);

    assert!(args.contains(&title.to_owned()));
    assert!(args.contains(&acceptance.to_owned()));
    assert!(args.contains(&label.to_owned()));
    assert!(argv
        .args
        .iter()
        .all(|arg| !arg.to_string_lossy().contains('\\')));
}

#[test]
fn comment_text_goes_to_stdin() {
    let text = "评论 \"quoted\"\nsecond line";
    let argv = argv_for(&WriteCommand::Comment {
        id: "bza-3".to_owned(),
        text: text.to_owned(),
    });

    assert_args(&argv.args, &["comment", "bza-3", "--stdin"]);
    assert_eq!(argv.stdin.as_deref(), Some(text.as_bytes()));
}

#[test]
fn close_uses_argv_for_a_short_reason_and_stdin_for_a_long_one() {
    let short = argv_for(&WriteCommand::Close {
        id: "bza-4".to_owned(),
        reason: Some("duplicate of bza-2".to_owned()),
    });
    assert_args(&short.args, &["close", "bza-4", "-r", "duplicate of bza-2"]);
    assert!(short.stdin.is_none());

    let reason = "x".repeat(LONG_TEXT_THRESHOLD);
    let long = argv_for(&WriteCommand::Close {
        id: "bza-4".to_owned(),
        reason: Some(reason.clone()),
    });
    assert_args(&long.args, &["close", "bza-4", "--reason-file", "-"]);
    assert_eq!(long.stdin.as_deref(), Some(reason.as_bytes()));

    let no_reason = argv_for(&WriteCommand::Close {
        id: "bza-4".to_owned(),
        reason: None,
    });
    assert_args(&no_reason.args, &["close", "bza-4"]);
    assert!(no_reason.stdin.is_none());
}

#[test]
fn reopen_has_no_extra_flags() {
    let argv = argv_for(&WriteCommand::Reopen {
        id: "bza-5".to_owned(),
    });

    assert_args(&argv.args, &["reopen", "bza-5"]);
    assert!(argv.stdin.is_none());
}
