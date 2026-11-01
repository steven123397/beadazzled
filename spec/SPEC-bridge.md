# Spec: bridge — bd 进程与数据契约

状态：v0.1.0 · 依赖：无 · 被 `sync` / `writes` / `workspace` 消费
依据：数据通路研究（见 [capability-map](capability-map.md)）；质量契约 [CONSTRAINTS.md](../CONSTRAINTS.md)

## Objective

把 `bd` CLI 收成一个进程层，向后端其余部分提供**唯一**的类型化数据通路：

- 全量读取：`bd export`
- 增量读取：`bd events tail --json`
- 写操作：`bd create / update / close / reopen / comment`
- 环境探测：`bd --version`、`bd -C <ws> context --json`、`bd config get`

产出：Rust 模块 `src-tauri/src/bridge/` + 生成的 TS 绑定 `src/bindings/bd.ts`。除本模块外，任何代码不得 spawn `bd`、不得读取 `.beads/embeddeddolt/`。

## 契约：类型

Rust 为唯一事实来源；用 `ts-rs` 生成 TS（禁止手改 `src/bindings/`）。未知字段必须保留（`#[serde(flatten)]` 的 `extra`，Rust 侧实现为 `ExtraFields`），以保证 bd 升级不丢数据。`extra` 是实现细节：wire 上未知字段平铺在对象顶层，因此 TS 侧用索引签名表达，而不是嵌套属性（见 [ADR-0004](../docs/adr/0004-unknown-fields-and-ts-shape.md)）。

```ts
// src/bindings/bd.ts —— 由 Rust 生成，勿手改
export type Issue = {
  id: string;
  title: string;
  description: string;
  acceptance_criteria?: string;
  status: string;              // open | in_progress | blocked | deferred | closed | pinned | hooked
  priority: number;            // 0-4
  issue_type: string;
  owner?: string;
  assignee?: string;
  created_at: string;
  created_by?: string;
  updated_at: string;
  started_at?: string;
  closed_at?: string;
  labels: string[];
  comments?: Comment[];
  dependencies?: Dependency[];   // 本票依赖谁（depends_on_id）
  dependency_count: number;
  dependent_count: number;
  comment_count: number;
  [key: string]: unknown;        // bd 新增的未知字段（wire 上平铺在顶层）
};

export type Comment = {
  id: string;
  issue_id: string;
  author: string;
  text: string;
  created_at: string;
};

export type Dependency = {
  issue_id: string;
  depends_on_id: string;
  type: string;
  created_at: string;
  created_by?: string;
  metadata?: string;
};

export type JournalRecord = {
  seq: number;
  ts: string;
  op: 'create' | 'update' | 'close' | 'delete' | 'dep_add' | 'dep_remove' | 'comment';
  issue_id: string;
  actor?: string;
  issue: Issue | null;          // delete 时为 null
  dep?: { kind: string; target: string; metadata?: string };
  comment?: { id: string; author: string; text: string; created_at: string; source?: string };
};

export type BridgeErrorCode =
  | 'BD_NOT_FOUND' | 'BD_NOT_EXECUTABLE' | 'BD_VERSION_UNSUPPORTED'
  | 'WS_NOT_BEADS' | 'WS_INACCESSIBLE'
  | 'BD_TIMEOUT' | 'BD_EXIT_NONZERO' | 'BD_LOCKED' | 'BD_SCHEMA_MISMATCH'
  | 'JOURNAL_DISABLED' | 'JOURNAL_TRUNCATED'
  | 'BD_PARSE_FAILED' | 'BD_OUTPUT_TOO_LARGE'
  | 'WRITE_CONFLICT' | 'INTERNAL';

export type BridgeError = {
  code: BridgeErrorCode;
  message: string;                       // 面向用户的一句话
  detail?: Record<string, unknown>;      // 原始 stderr 摘要、exit code、line 等
};
```

所有承载 bd 数据的类型（`Comment`、`Dependency`、`JournalRecord`、`WorkspaceContext`）都以同样的 `[key: string]: unknown` 索引签名保留未知字段；`JournalRecord.issue` 在 `delete` 时为 `null`。`src/bindings/bd.ts` 的实际输出以生成结果为准。

## 契约：Rust 接口

```rust
pub struct BdBridge {
    bd_path: PathBuf,
    workspace: PathBuf,
}

impl BdBridge {
    pub async fn version(&self) -> Result<BdVersion, BridgeError>;
    pub async fn context(&self) -> Result<WorkspaceContext, BridgeError>;
    pub async fn export(&self) -> Result<Vec<Issue>, BridgeError>;
    /// follow=false 时一次读完并返回；follow=true 时返回行流。
    pub async fn journal(&self, since: i64, follow: bool) -> Result<JournalReader, BridgeError>;
    pub async fn write(&self, cmd: WriteCommand) -> Result<WriteOutcome, BridgeError>;
    pub async fn config_get(&self, key: &str) -> Result<String, BridgeError>;
}

pub enum WriteCommand {
    Create(CreateSpec),        // title, description, issue_type, priority, labels, acceptance
    Update(UpdateSpec),        // id + 字段集合 + 可选 guard(status/assignee)
    Close { id: String, reason: Option<String> },
    Reopen { id: String },
    Comment { id: String, text: String },
}
```

`WriteOutcome` 至少含 `{ exit_code, created_id: Option<String>, stderr_excerpt: Option<String> }`。写命令的参数映射见 `SPEC-writes`；bridge 只负责「结构化命令 → argv/stdin → 进程结果」。

## 进程规则（全部强制）

| 规则 | 要求 |
|---|---|
| 参数传递 | `Command::new(bd_path).args([...])`，**永不经 shell**；用户文本不拼接 |
| 工作区 | 每个工作区调用显式 `-C <workspace>`，不依赖继承的 cwd；`bd --version` 等全局探测例外，不带 `-C`（bd 1.3.2 在非 beads 目录会拒绝 `-C`） |
| 窗口 | Windows `CREATE_NO_WINDOW`（`0x0800_0000`），stderr/stdout 均为管道 |
| 长文本 | description / comment 走 stdin；acceptance 只有 argv 通道，上限 16 KiB（见 `SPEC-writes` OQ1），由写入层在 spawn 前校验；长 close reason 走 `--reason-file -` |
| 超时 | 短调用必须有超时：version 5s、context/export/journal once 30s、write 20s；journal follow 无超时 |
| 进程树 | 子进程加入 Job Object（KILL_ON_JOB_CLOSE）；超时关闭 job，杀整棵树 |
| 管道宽限 | 进程退出后最多再读 1s 至 EOF；仍未 EOF 时强制关闭读端——若 stdout 未 EOF，返回 `BD_PARSE_FAILED`，不把可能截断的数据当成功；stderr 未 EOF 可丢弃尾部 |
| 输出上限 | export 总计 64 MiB、单行 16 MiB、stderr 留前 2 KiB；journal follow 单行同样 16 MiB；超限 `BD_OUTPUT_TOO_LARGE` |
| 编码 | 以字节读到行结束再按 UTF-8 严格解析；stdout 非法 UTF-8 → `BD_PARSE_FAILED`；stderr 用 lossy |
| 重试 | **写命令永不自动重试**；只读命令允许由调用方（sync）决定重试 |
| 并发 | 同一工作区的短调用串行（工作区路径先规范化，避免大小写/尾分隔符产生两个锁）；长期 `follow` 不参与（见下节）；follow 的 stderr 由 bridge 持续 drain，防止管道写满阻塞 |
| 日志 | 内存环形缓冲保留最近 200 次调用（命令名、argv 摘要、耗时、exit、错误码），供设置页诊断 |

## 并发与串行化

- 同一工作区的**短生命周期** bd 调用（`version` / `context` / `export` / `write` / `config`）在 bridge 内按工作区串行；不同工作区可并行。
- 长期运行的 `journal(follow=true)` **不参与**该信号量——否则一次刷新或写入会等跟随进程退出，永远等不到。
- 实测（bd 1.3.2，Windows）：`--follow` 运行期间并发 5 个 `export` + 5 个 `create`，全部 exit 0、无锁错误、journal 正常产出。结论：follow 与短调用可以共存。
- Scotty 0.4.0 采用更保守的「所有 bd 调用（含只读）串行」策略，依据是 embedded Dolt 的并发风险。我们保留 bridge 信号量作为第二道保险（覆盖「刷新 export 与写入重叠」），但允许 follow 例外；bd 升级后必须重跑该并发验证。
- 写命令仍由 `writes` 的单队列串行；bridge 信号量不改变队列语义，只保证进程层不重叠。

## 解析规则

- **export**：JSONL，逐行解析；空行跳过；某行 JSON 失败 → 整次失败并报告行号（不返回部分数据）。末行无换行视为截断 → `BD_PARSE_FAILED`。
- **journal**：逐行流式解析；chunk 边界处的不完整行必须缓冲到下一块；单行上限 16 MiB，超限 → `BD_OUTPUT_TOO_LARGE`；`follow` 模式下进程正常退出时，残留半行丢弃但记录一次警告；非零退出 → `BD_EXIT_NONZERO`。
- **journal 关闭**：实测 `bd events tail --json` 在 journal 关闭时退出码 0、stdout 为空、stderr 打一行 `note: the events journal is disabled...` → 映射 `JOURNAL_DISABLED`。识别依据为 stderr 包含 `events journal is disabled`；未知 stderr 不得猜测。
- **journal 裁剪**：stderr 或 stdout 中的 JSON 含 `{"code":"events_journal_truncated","since":N,"floor":F,"head":H}` → `JOURNAL_TRUNCATED`，detail 带 `since/floor/head`。
- **版本**：`bd --version`（不带 `-C`）形如 `bd version 1.3.2 (9b65b9e19)`；解析 semver，< 1.3.2 → `BD_VERSION_UNSUPPORTED`。
- **context**：`bd -C <ws> context --json` 必须返回含 `project_id`、`bd_version`、`dolt_mode`、`schema_version` 的对象。
- **BD_JSON_ENVELOPE**：实测 `BD_JSON_ENVELOPE=1` 只包装 `bd show/list`（`{data, schema_version}`）；`bd export` 仍是原始 JSONL，错误仍是纯文本。本条数据通路不使用该变量。

## 错误映射（保守原则）

只映射有稳定依据的情况；**不认识的失败一律 `BD_EXIT_NONZERO` 原样上报**（exit code + stderr 摘要），不臆造语义。

| 条件 | 错误码 |
|---|---|
| 显式路径不存在 / PATH 找不到 | `BD_NOT_FOUND` |
| 存在但无法执行（权限、损坏） | `BD_NOT_EXECUTABLE` |
| 版本低于下限 | `BD_VERSION_UNSUPPORTED` {found, min} |
| `.beads` 缺失、或 bd 报 not a beads workspace / no beads database / no beads project found | `WS_NOT_BEADS` |
| 工作区不可访问（权限、路径失效） | `WS_INACCESSIBLE` |
| 超过超时 | `BD_TIMEOUT` {command, timeout_ms} |
| exit 13 | `WRITE_CONFLICT` |
| stderr 含 database is locked / lock conflict | `BD_LOCKED` |
| stderr 含 schema / migration 不兼容，或 `pending schema migration` / `BD_ALLOW_REMOTE_MIGRATE` | `BD_SCHEMA_MISMATCH`（保留原文提示） |
| journal 关闭 | `JOURNAL_DISABLED` |
| journal 裁剪 | `JOURNAL_TRUNCATED` {since, floor, head} |
| 解析失败 / 输出超限 | `BD_PARSE_FAILED` / `BD_OUTPUT_TOO_LARGE` |
| 其它非零退出 | `BD_EXIT_NONZERO` {exit_code, stderr} |

## Acceptance Criteria

1. **唯一入口**：`check:boundaries` 证明 `src-tauri/src/` 中除 `bridge/` 外无 `Command::new`；生产代码不得直接引用 `bridge::process/argv/parse`，只能经 `BdBridge`（测试与 `examples/fake_bd` 除外）；无 `cmd /C`、shell 拼接。
2. **argv 安全**：标题、标签、路径中的空格/引号/中文/换行在 fake_bd 收到的 argv 中逐字一致；≥8 KiB 正文只出现在 stdin，不出现在 argv。
3. **解析正确**：录制样本（含 comments、dependencies、多状态）解析为 Issue；未知字段进入 `extra` 且序列化后仍在。
4. **解析失败可见**：缺字段/坏 JSON/末行截断分别得到带行号的 `BD_PARSE_FAILED`，调用方拿不到部分结果。
5. **超时与进程树**：fake_bd 挂起且派生孙进程持有 stdout 时，bridge 在超时后 ≤1.5s 返回 `BD_TIMEOUT`，无残留进程。
6. **管道宽限**：fake_bd 退出但孙进程持有 stdout 时，bridge 在退出后 ≤1s 返回；stdout 未 EOF 时返回 `BD_PARSE_FAILED`，不返回可能截断的数据。
7. **journal 三态**：正常有记录、关闭（stderr note + 空 stdout + exit 0）、裁剪（JSON 错误）分别映射为数据 / `JOURNAL_DISABLED` / `JOURNAL_TRUNCATED`。
8. **写结果**：`create` 用 `--silent` 取回 id；非零退出携带 exit code 与 stderr 摘要；exit 13 → `WRITE_CONFLICT`。
9. **版本校验**：`1.3.2` / `1.10.0` 通过，`1.2.9` 拒绝，垃圾输出 → `BD_PARSE_FAILED`。
10. **覆盖率**：bridge 模块行覆盖 ≥ 80%（`cargo llvm-cov` 或等效；阈值与 CONSTRAINTS 一致）。
11. **测试不碰真 bd**：bridge 测试只使用录制样本与 `examples/fake_bd`。
12. **短调用串行**：同一工作区同时触发 refresh export 与 write 时，fake_bd 记录到的调用不重叠；follow 进程不在信号量内（可在其运行时完成 export）。
13. **迁移错误**：注入 `pending schema migration` 的 stderr → `BD_SCHEMA_MISMATCH`，错误 detail 保留原文提示。
14. **门面**：sync/writes/workspace 只经 `BdBridge` 的 `version/context/export/journal/write/config_get` 访问 bd；`BdBridge::version` 不带 `-C`；`journal(follow=true)` 返回可增量读取的 `JournalReader`。

## Module Commands

- `npm run test:rust` — `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run gen:bindings` — 通过 `export_bindings` 测试导出 ts-rs 绑定（会重写 `src/bindings/bd.ts`）
- `npm run check:bindings` — 重新生成后与已提交的 `src/bindings/bd.ts` 比较，工作区保持原样；CI 由 `check:task` 首先执行（`export_bindings` 会重写文件，检查必须跑在任何 cargo test 之前）
- `npm run check:boundaries` — 唯一入口与禁止路径检查

## Module Structure

```
src-tauri/src/bridge/
  mod.rs          BdBridge、命令编排
  process.rs      进程启动、job object、超时、管道宽限
  argv.rs         纯函数：WriteCommand → Vec<String>
  parse.rs        JSONL 解析、journal 行解析、错误 JSON
  error.rs        BridgeError、stderr/detail 映射
  types.rs        Issue / JournalRecord / WorkspaceContext
src-tauri/examples/fake_bd.rs  测试桩（按环境变量输出样本、睡眠、exit code）
src-tauri/tests/bridge_*.rs    集成测试
src/bindings/bd.ts             生成物
```

## Module Code Style

- argv 构造必须是**纯函数**，输入 `WriteCommand`，输出 `Vec<OsString>`；进程模块只做执行。
- 解析函数签名只返回 `Result<T, BridgeError>`，不做任何 UI 语义。
- 错误 detail 只放可序列化、可诊断的字段；不把完整 stderr（可能含大量文本）塞进用户消息。

## Boundaries

- **Always**：所有 bd 调用带 `-C`；所有子进程设超时与 job object；所有失败给稳定错误码。
- **Ask first**：扩大允许的 bd 子命令集合；调整超时或输出上限；改变错误码含义。
- **Never**：shell 拼接；读 `embeddeddolt`；自动重试写；把未知 stderr 解释成具体错误；把用户正文放进 argv；在测试中 spawn 真 `bd`。

## Open Questions

1. journal 关闭的 stderr note 是英文文本，bd 升级可能改词。缓解：只匹配 `events journal is disabled`，并在诊断页用 `bd config get events-journal` 交叉确认。
2. `bd export` 是否可能输出非 UTF-8（当前实测为 UTF-8）；若遇到，按 `BD_PARSE_FAILED` 上报而不是替换字符。