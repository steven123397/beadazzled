//! bd discovery, workspace validation and the persisted workspace registry.
//!
//! The registry owns the on-disk `config.json` (atomic writes, corruption
//! recovery) and the per-workspace journal checkpoint. `sync` reads and writes
//! the checkpoint through this module so a seq is never reused against a
//! different `project_id`.

pub mod discovery;
pub mod registry;
pub mod validate;
