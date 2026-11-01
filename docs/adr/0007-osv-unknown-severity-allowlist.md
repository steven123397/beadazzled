# ADR-0007: OSV unknown 严重度采用 allowlist 阻断

状态：已接受（2026-11-01）
影响模块：`check:deps`、`osv-allowlist.json`、CI、`CONSTRAINTS.md`

## 背景

`scripts/check-deps.mjs` 只从 OSV 记录的 `database_specific.severity` 判级，
缺失该字段时记为 `unknown` 且不阻断。bza-ryr.5（Bridge Phase 1 安全审查的
Optional 项）指出：RUSTSEC 记录经常没有该字段；如果将来出现只带 CVSS 向量
的真高危，会被漏过。

2026-11-01 用 osv-scanner 2.7.0 实测当前 4 条记录：

- `minimatch` 的 GHSA（MODERATE，带 `CVSS_V4` 向量）；
- `glib` 的 RUSTSEC-2024-0429（**无 severity**，别名 GHSA-wrw7-89jp-8q8g
  为 MODERATE）与同漏洞的 GHSA 记录（MODERATE）；
- `proc-macro-error` 的 RUSTSEC-2024-0370（**无 severity**，unmaintained）。

即两条 unknown 都是 RUSTSEC 记录，且都没有 CVSS 向量（现有向量全是
`CVSS_V4`）。`glib` / `proc-macro-error` 只经
`glib-macros <- glib <- gtk <- tauri` 的 Linux 目标路径进入 `Cargo.lock`，
Windows 构建不编译。

## 决策

采用 **allowlist 阻断**（bza-ryr.5 的选项 b）：

- unknown 严重度的记录默认 **block**，不再"报告但不阻断"。
- 只有 `osv-allowlist.json` 中登记的条目才放行；每条必须带 `id`、`reason`
  与 `expires`（`YYYY-MM-DD`）。解析失败、字段缺失、日期非法或 id 重复都会
  让 `check:deps` 失败，而不是跳过该条目。
- 条目在 `expires` 当天仍有效；过期后即使对应漏洞已消失也失败，强制到期
  复审（续期或删除）。
- 登记了但匹配不到任何 unknown 的条目只提示清理，不阻断。
- 当前登记 RUSTSEC-2024-0429 与 RUSTSEC-2024-0370，`expires` 均为
  2027-01-31，理由写明严重度来源与 Linux-only 依赖路径。

## 后果

- 任何新的 unknown 依赖漏洞都会让 CI 失败，直到有人判断严重度并登记
  （带理由和到期日）或升级/移除依赖。失败方向是关闭的。
- 不需要维护 CVSS 打分实现；allowlist 本身就是一次显式的人工判级记录，
  到期复审防止它长期腐化。
- `osv-allowlist.json` 成为需要评审的契约文件：新增条目应说明为何不阻断，
  并在 EXPIRY 前处理。
- 若同一漏洞同时有 RUSTSEC 与 GHSA 两条记录，RUSTSEC 一侧需要单独登记
  （GHSA 一侧有 severity，不受影响）。

## 被拒绝的备选

- **解析 `severity[]` 的 CVSS v3/v4 base score，≥7.0 视为 high**（选项 a）：
  自动判级更省人工，但 CVSS v4 base score 需要宏向量查表与插值，实现量大、
  易错；而且当前两条 unknown 都没有 CVSS 向量，此选项不会改变今天的阻断
  结果，等于为假设的输入先付实现成本。将来若 unknown 记录普遍带向量，再
  评估引入。
- **保持现状、只记录 unknown**：真高危只有 CVSS 时会被静默放过，与
  `CONSTRAINTS.md` 的「检查失败不许静默降级」冲突。