# Spec: writes — 写队列与命令映射

状态：v0.1.0 · 依赖：`bridge`（命令执行）、`sync`（回声）· 被 `detail` / `board` 消费

## Objective

把用户编辑变成**可预测、可回显、可解释失败**的 bd 写操作：

- 所有写入串行经过同一队列，不并发、不抢锁；
- 不做乐观更新：界面在 journal 回声到达后才改变，天然与数据库一致；
- 写失败必须带着 bd 的原因回到界面，不吞错、不自动重试；
- 竞争（别人先改了）用 bd 的 `--if-status / --if-assignee` 守卫显式处理。

v0.1.0 支持：新建、改状态/优先级/指派/标题/正文/验收、标签增删、评论、关闭、重开。
**不支持**：依赖增删、批量操作、删除票、force close。

## 命令映射（唯一事实来源）

所有命令均带 `-C <workspace>`，且由 `bridge` 以 argv 数组执行。

| 用户动作 | bd 命令 | 备注 |
|---|---|---|
| 新建 | `bd create --title <t> --type <type> --priority <p> [--assignee <a>] [--acceptance <s>] [--labels a,b] --silent --stdin` | description 走 stdin；空描述时加 `--allow-empty-description`；`--silent` 只回 id |
| 改状态 | `bd update <id> -s <status> [--if-status <expected>]` | 看板拖动必须带 expected；列表/详情可不带 |
| 改优先级 | `bd update <id> -p <0-4>` | |
| 改指派 | `bd update <id> -a <name>`；取消指派用 `-a ""` | 已实测：空字符串清除 assignee，exit 0 |
| 改标题 | `bd update <id> --title <t>` | |
| 改正文 | `bd update <id> --body-file -` | 正文走 stdin（长度与引号安全） |
| 改验收 | `bd update <id> --acceptance <s>` | 长度上限见 Open Questions |
| 加标签 | `bd update <id> --add-label <l>`（可重复） | 不替换全部标签 |
| 去标签 | `bd update <id> --remove-label <l>`（可重复） | |
| 评论 | `bd comment <id> --stdin` | 文本走 stdin |
| 关闭 | `bd close <id> [-r <reason>]` | 长原因用 `--reason-file -`；有未完成子票时 bd 会拒绝，原样上报 |
| 重开 | `bd reopen <id>` | |

同一用户动作涉及多字段时合并为**一条** `bd update`（例如状态 + 优先级 + 标签一次提交）。不允许把一次用户动作拆成多条命令。

## 队列语义

```ts
type QueuedWrite = {
  key: string;              // 去重键：issueId + 动作 + 规范化 payload
  issueId: string | null;
  build: () => WriteCommand;
  resolve: (r: WriteResult) => void;
  reject: (e: BridgeError) => void;
};

type WriteResult =
  | { status: 'ok'; createdId?: string }
  | { status: 'conflict'; error: BridgeError }
  | { status: 'failed'; error: BridgeError };
```

- **单队列、单在飞**：每个工作区一个 FIFO；上一条命令结束（成功或失败）后才发下一条。
- **去重**：完全相同的 `key` 在尚未派发时复用同一个 Promise，只产生一次 bd 调用。
- **不合并**不同的编辑意图；同一 issue 的连续编辑依次执行，避免丢失用户操作。
- **不可取消**：已派发的命令不可取消；未派发的可以从队列移除（界面关闭时清理）。
- **禁止重试**：`create` 非幂等；任何写失败都不自动重试。
- **超时**：沿用 bridge 的 20s；超时视为失败并上报 `BD_TIMEOUT`。

## 写后流程

```
用户提交 → 队列 → bridge.write → 成功?
  ├─ 否：exit 13 → conflict：提示「已在别处修改」，触发一次基线，不回滚界面（本来就没改）
  │      其它   → failed：显示错误码 + stderr 摘要；状态不变；pending 清除
  └─ 是：等待 sync.waitForEcho(issueId, afterSeq, 3000)
          ├─ echoed   → 清除 pending，界面由 store 更新
          ├─ timeout  → 触发基线 + 提示「已保存，视图已刷新」
          └─ disabled → 立即触发基线
```

- `afterSeq` 在派发前记录当前 `sync.lastSeq`；用于判断回声是否已到。
- pending 期间该 issue 的编辑控件禁用，行/卡片显示轻微加载态；**库内状态不变**。

## 状态修改守卫（board / detail 共用）

依赖编辑不在 v0.1.0，但**读依赖**可以，因此状态修改按依赖拦截，而不是按 `blocked` 状态拦截：

```ts
export type StatusChangeDecision =
  | { allowed: true }
  | { allowed: false; reason: 'blocked-by-dependencies'; blockers: string[] };

export function canChangeStatus(
  issue: Issue,
  target: Status,
  unresolvedBlockers: string[],
): StatusChangeDecision;
```

规则：

- `unresolvedBlockers.length > 0` 且 target ∈ {`in_progress`, `closed`} → 禁止。
- 其余目标（`open`、`blocked`、`deferred` 等）允许；`target === issue.status` 视为无操作。
- 看板拖动、看板键盘移动、详情页状态菜单、批量入口（v0.1.0 无）**必须**调用同一个函数；禁止任何入口单独实现判定。
- 被拒绝时：卡片/票不动、无 bd 调用、提示列出阻塞票 id，并说明「v0.1.0 需在 CLI 解除依赖」。
- 子票约束（关闭有未完成子票的父票）不在应用层预判，交给 bd 拒绝并原样显示。

**什么算「未完成阻塞依赖」**（与 Scotty 的 `blockingDeps` 一致）：

```ts
blockingDeps(issue) = issue.dependencies
  .filter(d => ['blocks', 'conditional-blocks', 'waits-for'].includes(d.type))
  .filter(d => statusOf(d.depends_on_id) !== 'closed')
  .map(d => d.depends_on_id);
```

- 只有上述三类依赖构成阻塞；`related` / `relates-to` / `discovered-from` / `duplicates` / `supersedes` / `caused-by` / `validates` / `tracks` 不阻塞。
- `parent-child` **不计入**用户可见的阻塞：边指向父 epic，计入会让每个子票都显示「被父 epic 阻塞」。层级关系在详情页单独展示。
- `status = blocked` 本身不进入该列表；状态是人为声明，依赖才是计算。
- 看板的 `Blocked` / `Other` 列不是投放目标；`Ready` 目标额外要求 `blockingDeps` 为空（否则写入后会落入 Blocked，见 `SPEC-board`）。
- `Ready` 筛选（`SPEC-list`）使用同一函数，保证「看板能拖」与「列表显示 Ready」不会互相矛盾。

**未来解封**：依赖编辑落地后，用户在应用内删除阻塞关系 → `unresolvedBlockers` 变空 → 同一守卫自动允许，无需修改本函数或迁移数据。

## 错误呈现

| 错误码 | 用户看到 | 后续 |
|---|---|---|
| `WRITE_CONFLICT` | 「这条票已在别处被修改，正在刷新」 | 自动基线，不重试 |
| `BD_TIMEOUT` | 「保存超时，bd 未在 20 秒内返回」 | 不改状态；用户可重试 |
| `BD_LOCKED` | 「数据库被占用，请稍后重试」 | 不改状态 |
| `BD_EXIT_NONZERO` | bd 原始错误摘要（截断到 300 字符）+ 展开详情 | 不改状态 |
| 其它 | 错误码 + 一句话 | 不改状态 |

不允许把失败降级成静默成功；不允许清空用户正在编辑的内容。

## Acceptance Criteria

1. **串行**：连续触发两次状态修改，fake bridge 记录到 2 次按序调用，无重叠。
2. **去重**：同一动作在派发前重复提交 5 次，只产生 1 次 bd 调用，5 个 Promise 同结果。
3. **长文本**：64 KiB 正文只经 stdin；argv 总长度 < 8 KiB；中文、引号、换行原样到达 fake_bd。
4. **守卫**：看板拖动产生 `--if-status <expected>`；fake_bd 返回 exit 13 → `WRITE_CONFLICT`，不重试，触发一次基线。
5. **失败不乐观**：fake_bd 失败时 store 中 issue 状态与派发前一致，错误可见，pending 清除。
6. **回声超时**：3s 内无回声 → 触发一次基线，提示可见，不重复写入。
7. **journal 关闭**：`waitForEcho` 返回 `disabled` 时，写成功后立即基线，界面最终反映新状态。
8. **合并字段**：一次提交状态 + 优先级 + 标签，fake_bd 只收到 1 条 update 命令，含全部标志。
9. **不可写状态**：bd 不可用 / 版本不支持时，所有写入口禁用并显示原因。
10. **无静默降级**：任何失败路径都有用户可见反馈（测试断言 toast/错误区的文本）。
11. **不重试**：注入一次 `BD_TIMEOUT` 后，fake_bd 调用次数仍为 1。
12. **守卫统一**：board 拖动、键盘移动、详情页菜单对「有未完成依赖 + target=in_progress/closed」都返回同一拒绝结果；拒绝时 bd 调用次数为 0；依赖清空后同一输入变为允许（表驱动测试）。
13. **阻塞类型**：`blocks` / `conditional-blocks` / `waits-for` 且目标未关闭 → 阻塞；`related` / `discovered-from` / `parent-child` 不计入；目标不在 store 视为未完成。

## Module Commands

- `npm run test:unit -- src/lib/writes` — 队列与命令映射测试
- `npm run test:rust` — argv 映射的 Rust 侧测试（若映射下沉到 Rust）

## Module Structure

```
src/lib/writes/
  queue.ts         串行队列、去重、pending 状态
  commands.ts      用户动作 → WriteCommand 的纯函数映射
  errors.ts        错误码 → 用户文案
  useWrite.ts      React 绑定（提交、pending、错误）
```

## Module Code Style

- `commands.ts` 只做纯映射，不执行；`queue.ts` 只调度，不构造 argv。
- 用户文案集中在 `errors.ts` 与 i18n 目录，不散落在组件里。
- 队列状态用显式联合类型，不用布尔组合（`isLoading && !isError`）。

## Boundaries

- **Always**：串行；长文本走 stdin；竞争用守卫；失败可见；写前记录 `afterSeq`。
- **Ask first**：新增写命令（尤其 `delete`、`--force`、批量）；引入写重试；改变回声等待时间。
- **Never**：乐观更新；并发写；自动重试 create；吞掉 stderr；shell 拼接；在写路径上读 `.beads/` 文件。

## Open Questions

1. **验收条件长度**：`--acceptance` 只有 argv 通道，超过约 30 KiB 会被 Windows 拒绝。实现时设 16 KiB 上限并在编辑器提示；若 bd 后续提供 stdin/file 入口再放开。
2. **关闭有子票的父票**：bd 默认拒绝；v0.1.0 原样显示拒绝原因，不提供 force 入口（避免误伤），是否在 v0.1.x 增加需确认。
3. **关闭原因**：`-r` 为 argv；超过 8 KiB 时改用 `--reason-file -`，需实测该标志与 `--stdin` 的交互。