# bd fixtures

Recorded output from real `bd` (>= 1.3.2) lives here. At least three samples are
required before the bridge layer is implemented (bza-3ej):

- `export-*.json` — full `bd export` snapshots covering comments, dependencies
  and several issue statuses.
- `events-*.jsonl` — `bd events` journal excerpts, including the records emitted
  by write commands.

Rules:

- Never capture secrets, tokens or machine-specific absolute paths.
- Do not fabricate samples: they must come from a real `bd` version.
- Bridge tests must parse these files only; they must never spawn a real `bd`
  (see `CONSTRAINTS.md`).