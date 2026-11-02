## 项目约定

- idea：`docs/ideas/`，一个想法一个文件
- 决策记录：`docs/adr/`，编号递增，不删旧
- 规格：`docs/spec/SPEC.md`；多模块用 `docs/spec/SPEC-<id>.md` + `docs/spec/capability-map.md`；外部工具：无
- task：单一来源为 beads（本项目 `.beads`，通过 `bd` 读写），plan 由 `bd create --graph` 建图承载，不另建 `tasks/plan.md`、`tasks/todo.md`
- 子智能体模型：派发时显式传 `model` —— code-reviewer、security-auditor 用 opus；doubt-challenger、test-engineer、web-performance-auditor 用 sonnet
- secret 卫生：`.beads/config.yaml` 必须保持 secret-free；集成密钥只走环境变量（`GITHUB_TOKEN` / `LINEAR_API_KEY` 等），不要用 `bd config set --force-git-tracked`。`npm run check:secrets` 会先做确定性键检查，再跑 gitleaks。
- 质量约束：见 `CONSTRAINTS.md`；任何变更都不得为了让检查通过而弱化它
- 以上文件在第一次真正产出时创建，不预建空目录

## 构建环境

- 本机代理为 `127.0.0.1:7897`。环境变量 `_HTTP_PROXY` / `_HTTPS_PROXY`（带前导下划线）**不要改动**（2026-12-20 前有特殊原因），cargo / npm 不识别这些名字。
- 需要下载 crate 时，在命令前显式带代理，不要改全局 `~/.cargo/config.toml` 或环境变量：

  ```bash
  HTTP_PROXY=http://127.0.0.1:7897 HTTPS_PROXY=http://127.0.0.1:7897 \
  CARGO_HTTP_PROXY=http://127.0.0.1:7897 cargo build --manifest-path src-tauri/Cargo.toml
  ```

- npm 缓存已在 D 盘（`D:\apps\nodejs\node_cache`）；Rust `target/` 位于项目内（D 盘），C 盘只保留工具链与 crate 缓存。
- Playwright 浏览器缓存在 D 盘：用户级环境变量 `PLAYWRIGHT_BROWSERS_PATH=D:\tmp\ms-playwright`；新开的终端自动生效，旧终端需重开或手动带上该变量。`D:\apps` 只放应用程序，不放缓存。

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:1105d646 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Do NOT use `bd remember` — persistent engineering knowledge belongs in OpenViking; do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->
