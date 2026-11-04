# beadazzled

A Windows desktop client for [beads](https://github.com/gastownhall/beads) — the `bd`
issue tracker — built for reading.

![List view](docs/design/2026-11-03-list/list-light.png)

## What it is

beadazzled puts a Linear-grade window in front of a `bd` workspace: List, Board,
Detail and Settings, keyboard-first, light and dark, with a command palette and
URL-addressable filters.

- **List** — virtualised for 1000+ tickets, filters, grouping, saved views, J/K navigation.
- **Board** — derived columns, keyboard move, blockers visible on the card.
- **Detail** — Markdown body, acceptance criteria and comments as documents, metadata and
  dependency editing, status changes written back through `bd`.
- **Settings** — workspace registry, bd discovery, preferences, diagnostics, updates.

beadazzled only ever talks to `bd`. It does not open the Dolt database, does not
run a background service, and makes no network requests apart from the update
check and the links you choose to open.

## Requirements

- Windows 10/11 x64, with the WebView2 Evergreen runtime (present on Windows 11 and
  on most Windows 10 installs).
- `bd` **1.3.2 or newer**, on `PATH` or configured in Settings → bd. beadazzled never
  bundles `bd`.

## Install

1. Download `beadazzled_0.1.0_x64-setup.exe` from
   [Releases](https://github.com/steven123397/beadazzled/releases).
2. Compare its SHA-256 with the value on the release page before running it.
3. Run the installer. It installs per-user into `%LOCALAPPDATA%\beadazzled` and does not
   need administrator rights. Uninstall from Settings → Apps, or with `uninstall.exe`
   in the install folder.

Then add a workspace from the welcome screen or Settings → Workspaces.

### Windows SmartScreen

This build is **not Authenticode-signed**. Windows may show “Unknown publisher” or
“Windows protected your PC” the first time you run it. That warning is expected; this
project does not claim to have OS-level publisher trust. Check that you downloaded from
this repository's Releases page and that the SHA-256 matches before choosing
**More info → Run anyway**.

Update packages are a separate matter: every update is signed with minisign and is
rejected if the signature does not match the key built into the app.

## Updates

beadazzled checks once, ten seconds after launch, and on demand from
**Settings → About**. When a newer signed release is published it offers to install it;
the installer runs passively and the app restarts. There is no daily polling and no
silent background restart.

## Status

v0.1.0 is the first release. Not included yet: dependency graph, dependency editing,
formulas/molecules/gates, team collaboration, macOS and Linux, and direct Dolt access.
See [docs/releases/v0.1.0.md](docs/releases/v0.1.0.md) for the full change list, the
measurements and the known limitations.

## Development

Prerequisites: Node.js 24, Rust stable (MSVC toolchain), and the Tauri 2 prerequisites
for Windows.

```bash
npm ci
npm run dev            # Tauri window with hot reload
npm run dev:web        # browser only, with a fake bridge

npm run check:fast     # typecheck, lint, version consistency, secrets
npm run test:unit      # Vitest
npm run e2e            # Playwright against the real bundle and a fake bridge
npm run test:rust      # bridge tests
npm run build:app      # signed NSIS installer (needs the release key)
```

The quality contract — budgets, gates and the exceptions that are allowed — lives in
[CONSTRAINTS.md](CONSTRAINTS.md). Architecture decisions are recorded in
[docs/adr](docs/adr).

## License

MIT — see [LICENSE](LICENSE). Third-party attribution, including the projects whose
domain definitions and visual references shaped this app, is in [NOTICE](NOTICE).