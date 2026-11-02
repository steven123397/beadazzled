# Spec: board — 看板视图

状态：v0.1.0 · 依赖：`shell`、`sync`、`writes`
列模型：派生列（参考 Scotty 0.4，见 [ADR-0002](../adr/0002-bd-bridge-concurrency-and-scotty-reuse.md)）

## Objective

按工作状态看全貌，并且**拖一下就真的写进 bd**——不是视觉玩具。拖动必须串行、带守卫、等回声；竞争与失败要明说。

列不是 bd 状态的镜像，而是从 `status + blockingDeps` 派生出来的工作视图：阻塞的票自然落到 Blocked，依赖清掉后自动回到 Ready。

## 列

固定顺序：`Backlog → Ready → In Progress → Blocked → Done → Other（条件）`。

| 列 | 成员规则 | 可投放？ | 投放写入 |
|---|---|---|---|
| Backlog | `status = deferred` | 是 | `-s deferred` |
| Ready | `status = open` 且 `blockingDeps` 为空 | 是 | `-s open` |
| In Progress | `status = in_progress` 或 `hooked` | 是 | `-s in_progress` |
| Blocked | `status = blocked`，或 `status = open` 且有未完成阻塞依赖 | **否** | — |
| Done | `status = closed` | 是 | `bd close` |
| Other | `pinned` 及未知状态 | **否** | — |

- **Blocked 不可拖入、不可拖出**。依赖造成的阻塞需在 CLI 解除依赖；`status=blocked` 且无依赖的票，可在详情页状态菜单改回 `open`（随后自动落到 Ready）。
- **Other 仅在存在此类票时显示**，保证数据「看得见」；Other 中的卡片可拖出到真实列。
- 列头显示名称与计数；列可滚动，列内虚拟化。
- 列顺序固定，不支持自定义（v0.1.0）。

### 派生规则（唯一实现）

```ts
export function columnOf(issue: Issue, blockers: string[]): ColumnId {
  if (issue.status === 'closed') return 'done';
  if (issue.status === 'blocked' || (issue.status === 'open' && blockers.length > 0)) return 'blocked';
  if (issue.status === 'deferred') return 'backlog';
  if (issue.status === 'in_progress' || issue.status === 'hooked') return 'in-progress';
  if (issue.status === 'open') return 'ready';
  return 'other';
}
```

`blockers = blockingDeps(issue)`，定义见 `SPEC-writes`（仅 `blocks` / `conditional-blocks` / `waits-for`，目标未关闭；`parent-child` 不计入）。

判定顺序即上表顺序：Done 最先，Blocked 次之，避免「open + 阻塞」被误判进 Ready。

## 卡片

```
[P1] bza-a3f2dd
标题（最多 3 行，超出省略）
[标签] [标签] +N          @assignee
```

- 优先级用文字/图标（P0–P4），不只靠颜色。
- Blocked 卡片显示 `blocked by N` 与阻塞票 id（悬停/展开），并标注是「依赖阻塞」还是「手动 blocked」。
- 卡片可点击打开详情；详情覆盖层关闭后回到原位置。
- 列内排序固定：优先级升序（0 在前）→ 更新时间降序；不提供看板内排序控件。

## 筛选

- 复用 `list` 的筛选状态（`q / priority / type / assignee / label / ready`）。
- **状态筛选在看板隐藏**（列本身表达工作状态）；若 URL 带有 status 参数，看板忽略但保留。
- 筛选后某列可能为空 → 显示列级空状态，列仍保留。
- 列计数反映筛选后的卡片数；顶部显示「结果数 / 总数」。

## 拖动与写入

使用 dnd-kit（pointer + keyboard sensor）：

1. 拖动开始时记录卡片**真实 status**（不是列 id）。
2. 目标列必须可投放；Blocked 与 Other 拒绝悬停与落下。
3. 投放映射：
   - Backlog → `bd update <id> -s deferred --if-status <源状态>`
   - Ready → `bd update <id> -s open --if-status <源状态>`
   - In Progress → `bd update <id> -s in_progress --if-status <源状态>`
   - Done → `bd close <id>`（bd 会检查未完成子票；拒绝时原样显示）
   - 源是 Done、目标是其它列：先 `bd reopen <id>`；目标不是 `open` 时再发 `-s <目标>`（两条按序执行）
   - **已知不对称**：`bd close` 没有 `--if-status` 之类的并发守卫（CLI 未提供），Done 目标的关闭是按看板快照无条件执行的；update 路径有守卫。不加前端预检——预检本身会竞态，失败时按第 6 条显示 bd 原因。
4. **投放前的二维校验**：
   - `canChangeStatus`（见 `SPEC-writes`）：有未完成阻塞依赖时，禁止目标 `in_progress` / `closed`；
   - **Ready 目标额外要求 `blockingDeps` 为空**——否则写入后卡片仍会落在 Blocked，视觉上「拖了没动」，必须在落下前拒绝并提示。
   - 被拒绝：卡片不动、无 bd 调用、提示列出阻塞票。
5. **不做乐观移动**：卡片停留在原列并显示 pending 标记，直到 journal 回声到达后才移动。
6. 失败：卡片不动，显示错误；冲突（exit 13）提示「已在别处修改」并刷新。
7. pending 期间该卡片不可再次拖动。

依赖被清除（journal 更新）后，卡片按派生规则自动从 Blocked 移到 Ready，无需用户操作。

## 键盘

- `H/L` 在列间移动焦点，`J/K` 在列内上下移动；焦点可以进入 Blocked / Other 列查看。
- `Shift+←/→` 把当前卡片移到**相邻的可投放列**：
  - 跳过 Blocked 与 Other（例如 In Progress 按 `Shift+→` 直接到 Done，Ready 按 `Shift+→` 到 In Progress）；
  - 与拖动走同一校验与写入路径，同样 pending / 失败处理。
- 焦点在 Blocked 卡片上按 `Shift+←/→`：不移动，aria-live 播报「Blocked 列不可移动；依赖需在 CLI 解除」。
- `Enter` 打开详情。
- 键盘移动需有 aria-live 播报（「已移动 bza-xxx 到 In Progress」/失败原因）。

## 性能

- 每列独立虚拟化；1000 张卡片整体滚动 60fps。
- 拖动时只渲染一个 drag overlay，不整列重排。
- 筛选、滚动、切换列期间零 bd 调用。

## Acceptance Criteria

1. **列归属**：表驱动断言 `deferred→Backlog`、`open 无阻塞→Ready`、`open 有阻塞→Blocked`、`in_progress→In Progress`、`hooked→In Progress`、`closed→Done`、`blocked→Blocked`（无论有无依赖）、`pinned/未知→Other`。
2. **投放映射**：Ready→1 条 `-s open`；In Progress→1 条 `-s in_progress`；Backlog→1 条 `-s deferred`；Done→`close`；Done→In Progress→`reopen` 后 `-s in_progress`（2 条按序）。
3. **Blocked 不可投放**：拖入或从 Blocked 拖出均无 bd 调用，提示可见。
4. **Ready 拒绝阻塞**：有未完成阻塞依赖的卡片拖到 Ready 被拒绝（否则会落入 Blocked）。
5. **守卫**：外部造成的 `in_progress` + 未完成阻塞，拖到 Done 被拒绝；详情页菜单得到同样结果。
6. **自动迁移**：清除最后一条阻塞依赖后，卡片从 Blocked 自动移到 Ready。
7. **不乐观**：回声到达前卡片仍在源列且带 pending 标记；store 中状态未变。
8. **冲突**：fake_bd 返回 exit 13 → 卡片不移动、提示可见、触发一次基线、不重试。
9. **失败回显**：拒绝关闭（有子票）时显示 bd 原因；卡片保持原位。
10. **键盘等价**：`Shift+→` 与拖动产生完全相同的命令序列与 pending 行为；键盘移动跳过 Blocked/Other；Blocked 卡片按键无写入且有播报。
11. **Other 列**：存在 pinned/未知状态时显示该列及计数；不存在时隐藏；卡片可拖出。
12. **筛选一致**：同一组筛选在 List 与 Board 得到相同票集合（除状态维度外）。
13. **性能**：1000 张卡片滚动 60fps；拖动 overlay 不引起整列重排。
14. **零 bd**：滚动、筛选、聚焦期间 fake bridge 调用计数为 0。
15. **可访问性**：keyboard sensor 可用；移动结果有 aria-live 播报；axe 无严重违规。

## Module Commands

- `npm run test:unit -- src/features/board`
- `npm run measure:scroll -- --view=board`
- `npm run e2e -- board`

## Module Structure

```
src/features/board/
  BoardView.tsx       列布局与拖拽上下文
  Column.tsx          列容器、计数、虚拟化
  Card.tsx            卡片（memo）
  DragOverlay.tsx     拖动预览
  columns.ts          columnOf 与列定义（纯函数）
  move.ts             目标列 → WriteCommand 的纯函数映射
  keyboard.ts         键盘移动（跳过不可投放列）
  position.ts         每工作区记住列滚动偏移与焦点卡（详情返回恢复）
```

筛选状态与控件来自 `src/lib/view` 与 `src/components/filter-bar.tsx`，与 list 共用。

## Module Code Style

- 列归属与「列 → 命令」都是纯函数，拖动与键盘共用；不在事件处理器里拼命令。
- 卡片 props 只含显示所需字段与 id；状态从 store selector 取，避免整列重渲染。
- 拖拽结果只表达「意图」，执行与错误处理全部交给 `writes`。

参考实现（MIT，移植规则见 [ADR-0001](../adr/0001-ui-foundation-and-linear-references.md)）：Scotty 的 `lib/board-columns.ts`（派生列模型，见 [ADR-0002](../adr/0002-bd-bridge-concurrency-and-scotty-reuse.md)）；Circle 没有 issue 看板，卡片样式参考 `issues/issue-line.tsx`，拖拽与列布局参考 `projects/projects-board.tsx`。

## Boundaries

- **Always**：先算列归属再渲染；投放前做守卫与 Ready 校验；不做乐观移动；失败可见；拖动与键盘同路径。
- **Ask first**：自定义列/列顺序；WIP 限制；拖动排序（同列内手动排序）；改变派生规则。
- **Never**：视觉移动后假设写入成功；并行写；拖动时直接改 store；隐藏 Blocked/Other 中的数据；允许 Blocked 成为投放目标。

## Open Questions

1. **Done → 非 open 目标**：当前拆成 `reopen` + `update` 两条命令；若 bd 提供单条原子写法，实现时替换。
2. **同列内手动排序**：v0.1.0 不做；固定排序规则是否需要用户可配置，留到后续版本。
3. **hooked 的展示**：当前并入 In Progress（与 Scotty 一致）；若实际使用中 hooked 语义差异明显，再单独成列。