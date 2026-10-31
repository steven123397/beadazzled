# ADR-0002: 复用 Scotty 的 bd 运维规则与领域定义

状态：已接受（2026-10-31）
影响模块：`bridge`、`sync`、`writes`、`list`、`board`
参考源码：`brendan-appstart/bead-me-up-scotty` v0.4.0（MIT，Copyright 2026 Brendan），本地 clone 在 `D:\apps\bead-me-up-scotty`

## 背景

Scotty 是与本项目功能面最接近的成熟实现，数据层同样走 `bd` CLI。需要判断：底层有哪些值得复用、许可证是否允许、哪些不能照搬。

许可证：**MIT**，允许复制、修改、再分发，唯一义务是保留版权与许可声明。

## 决策

### 1. 复用其领域定义（移植到本项目，记 NOTICE）

- **状态 / 类型 / 依赖类型枚举**：7 个状态、9 个核心类型、12 种依赖类型。
- **阻塞依赖语义**：`BLOCKING_DEP_TYPES = blocks, parent-child, conditional-blocks, waits-for`；
  - 用户可见的阻塞进一步排除 `parent-child`（子票指向父 epic，计入会产生「被父 epic 阻塞」的噪声）；
  - `related / relates-to / discovered-from / duplicates / supersedes / caused-by / validates / tracks` 不阻塞。
  - 已写入 `SPEC-writes` 的 `blockingDeps` 与 `SPEC-list` 的 Ready 判定。
- **筛选模型**：多选 facet（status/type/priority/origin/labels/assignee）+ 搜索，空数组表示不约束。
- **快捷键注册表结构**：`{keys, label, sequence?}` 分组，帮助面板由注册表生成。
- **看板列模型**（已采用）：派生列 `Backlog / Ready / In Progress / Blocked / Done`，Blocked 列不可投放；Ready = open 且无阻塞；依赖清空后卡片自动回到 Ready。

### 2. 复用其运维规则（写入 spec，不直接搬代码）

- **argv-only + `execFile` 等价物**：本项目在 Rust 侧用 `Command::args`，规则一致。
- **输出缓冲上限**：Scotty `maxBuffer` 32 MiB；本项目 64 MiB（见 `SPEC-bridge`）。
- **迁移错误稳定码**：把 `pending schema migration` / `BD_ALLOW_REMOTE_MIGRATE` 的纯文本 stderr 映射为固定码，避免把整段提示丢进 UI。本项目映射为 `BD_SCHEMA_MISMATCH`（bd 上游 issue #4259）。
- **`.beads` 非递归监听 + 200ms 防抖**：本项目不使用文件监听（走 events journal），但其自激根因判断与我们的 CONSTRAINTS 一致，保留为反例依据。
- **短调用串行**：Scotty 按工作区串行所有 bd 调用（含只读）。本项目采用「短调用串行 + 长跟随例外」，并实测验证。

### 3. 并发策略的实测结论

bd 1.3.2 / Windows 实测：

- `bd events tail --follow --json` 运行期间，并发 3 次 `export` + 2 次 `create` + 1 次 `update`：全部 exit 0，无锁错误，follow 正常收到 5 条事件。
- 进一步并发 5 个 `export` + 5 个 `create`（follow 同时运行）：全部 exit 0，无 stderr。
- 结论：follow 与短调用可以共存；bridge 仍对短调用加工作区信号量，作为「刷新与写入重叠」的第二道保险。
- **约束**：bd 升级（尤其 2.x）后必须重跑该并发验证，再决定是否收紧为全串行。

### 4. 不复用的部分

- Next.js server / API routes / SSE registry / React Query 轮询 / demo-store：本项目是 Tauri，事件由 Rust → WebView 推送。
- 文件监听作为变更信号：已被 events journal 取代。
- 自更新、Docker、遥测、发布流程：与本项目形态无关。
- UI 外壳：Scotty 用 Base UI + Next.js，本项目选 shadcn/ui + Circle 参考（见 ADR-0001）。

### 5. `BD_JSON_ENVELOPE` 不采用

实测：`BD_JSON_ENVELOPE=1` 只包装 `bd show/list`（`{data, schema_version}`）；`bd export` 仍是原始 JSONL；错误仍是纯文本。我们的数据通路是 export + events，采用该变量没有收益。

## 后果

- 依赖阻塞的判定不再是「任何 dependencies」，而是三类阻塞依赖；避免把 `related`、`parent-child` 误判为阻塞。
- bridge 多一个按工作区的短调用信号量；不影响写队列语义。
- 迁移错误有稳定码，设置页诊断可读。
- 若移植 Scotty 的具体代码/枚举，`NOTICE` 记录来源与 commit；仅借鉴规则与语义则不产生额外义务。
- 看板采用派生列（Backlog / Ready / In Progress / Blocked / Done）：列 id 与 bd status 不再一一对应，但每次写入仍以真实 status 为准，并继续带 `--if-status` 守卫。

## 被拒绝的备选

- **把 Scotty 的 TS 数据层直接搬进 Tauri**：运行环境不同（Node vs Rust），且它基于文件监听与 React Query，和 journal 通路冲突。
- **按 bd status 直接分列（Open / In Progress / Blocked / Closed）**：已放弃。它会把「open 但有未完成阻塞」的票留在 Open 列，需要用户自己读徽章判断；派生列把这类票直接放进 Blocked，更接近实际工作状态。
- **采用 `BD_JSON_ENVELOPE` 统一错误**：实测不覆盖 export，且错误仍为文本。