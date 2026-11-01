//! Data types shared with the frontend, mirroring `bd export` and `bd events`.
//!
//! Shapes are recorded in `tests/fixtures/bd/`. Unknown fields are kept in
//! `extra` (serde flatten) so a bd upgrade cannot silently drop data.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use ts_rs::TS;

/// Unknown fields, kept verbatim so a bd upgrade cannot silently drop data.
///
/// serde flattens the map into the parent object, so TypeScript sees an index
/// signature rather than a nested `extra` property. The newtype exists only to
/// provide the `TS` implementation: ts-rs cannot derive one for a map, and
/// `#[ts(type = "...")]` is rejected on flattened fields.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ExtraFields(pub Map<String, Value>);

impl TS for ExtraFields {
    type WithoutGenerics = Self;

    fn decl() -> String {
        panic!("ExtraFields is only used as a flattened field")
    }

    fn decl_concrete() -> String {
        panic!("ExtraFields is only used as a flattened field")
    }

    fn name() -> String {
        "{ [key: string]: unknown }".to_owned()
    }

    fn inline() -> String {
        Self::name()
    }

    fn inline_flattened() -> String {
        Self::name()
    }
}

/// A ticket as emitted by `bd export` (one JSON object per line).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct Issue {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub acceptance_criteria: Option<String>,
    pub status: String,
    pub priority: u8,
    pub issue_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub owner: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub assignee: Option<String>,
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub created_by: Option<String>,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub started_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub closed_at: Option<String>,
    /// bd omits the field entirely when an issue has no labels.
    #[serde(default)]
    pub labels: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub comments: Option<Vec<Comment>>,
    /// Dependencies of this issue, i.e. what it depends on (`depends_on_id`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub dependencies: Option<Vec<Dependency>>,
    /// Journal payloads omit the counts, so they default to zero.
    #[serde(default)]
    pub dependency_count: u32,
    #[serde(default)]
    pub dependent_count: u32,
    #[serde(default)]
    pub comment_count: u32,
    #[serde(flatten)]
    pub extra: ExtraFields,
}

/// A comment attached to an issue.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct Comment {
    pub id: String,
    pub issue_id: String,
    pub author: String,
    pub text: String,
    pub created_at: String,
    #[serde(flatten)]
    pub extra: ExtraFields,
}

/// A dependency edge as it appears inside an exported issue.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct Dependency {
    pub issue_id: String,
    pub depends_on_id: String,
    #[serde(rename = "type")]
    pub relation_type: String,
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub created_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub metadata: Option<String>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}

/// The seven record kinds emitted by `bd events tail --json`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum JournalOp {
    Create,
    Update,
    Close,
    Delete,
    DepAdd,
    DepRemove,
    Comment,
}

impl JournalOp {
    pub const ALL: [Self; 7] = [
        Self::Create,
        Self::Update,
        Self::Close,
        Self::Delete,
        Self::DepAdd,
        Self::DepRemove,
        Self::Comment,
    ];
}

/// The dependency payload carried by `dep_add` / `dep_remove` journal rows.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct JournalDep {
    pub kind: String,
    pub target: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub metadata: Option<String>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}

/// The comment payload carried by a `comment` journal row.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct JournalComment {
    pub id: String,
    pub author: String,
    pub text: String,
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub source: Option<String>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}

/// One record from `bd events tail --json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct JournalRecord {
    /// bd assigns int64 sequence numbers; JS numbers are exact well past any
    /// realistic journal head, and the frontend contract uses `number`.
    #[ts(type = "number")]
    pub seq: i64,
    pub ts: String,
    pub op: JournalOp,
    pub issue_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub actor: Option<String>,
    /// Full issue state after the mutation; `null` on delete.
    pub issue: Option<Issue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub dep: Option<JournalDep>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub comment: Option<JournalComment>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}

/// The subset of `bd context --json` the app relies on.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct WorkspaceContext {
    pub project_id: String,
    pub bd_version: String,
    pub dolt_mode: String,
    #[ts(type = "number")]
    pub schema_version: i64,
    #[serde(flatten)]
    pub extra: ExtraFields,
}
