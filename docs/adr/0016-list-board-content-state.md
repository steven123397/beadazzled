# ADR-0016: List/Board 同步健康与内容状态分层

状态：已接受（2026-11-12 用户拍板）
影响模块：`sync`、`list`、`board`
决策票：`bza-90d`；执行票：`bza-q20`

## 背景

List 与 Board 各自用三元表达式派生根节点的 `data-state`。在
`bd-unavailable && total > 0` 时，List 标记为 `bd-unavailable`，Board 标记为
`ready`；但两屏实际都保留缓存内容并显示相同的 stale banner。原始审查所称
“一屏显示缓存、另一屏显示整屏错误”不成立，真实漂移发生在 DOM 状态语义。

两屏对筛选零结果的处理也不同：List 按 `SPEC-list` 显示整屏
`NoMatchState`；Board 按 `SPEC-board` 保留固定列并显示列级空态。这是不同
视图的有意差异，不应为了复用代码而抹平。

`bza-90d` 在 2026-11-06 的初轮结论曾决定新增 `stale` 内容状态，并让 Board
引入与 List 相同的整屏 `no-match`。2026-11-12 对照当前代码与规格复核后，
用户批准以本 ADR 取代这两项初轮结论。

## 决策

1. `data-sync` 表达同步健康，`data-state` 表达内容呈现，两者保持正交。
   `stale` 只是 `bd-unavailable` 且有缓存时的提示，不新增为内容状态值。
2. 新建共享纯函数 `src/lib/view/derive-view-state.ts`，统一以下优先级：
   - 无缓存且基线加载：`loading`；
   - 无缓存且 bd 不可用：`bd-unavailable`；
   - 无缓存且不在上述状态：`empty`；
   - 有缓存且调用方声明筛选零结果：`no-match`；
   - 其余：`ready`。
3. List 传入 `visible.length === 0 && activeFilters`，保留整屏无匹配状态。
   Board 不声明 `no-match`，筛选零结果时仍为 `ready` 并保留固定列；stale
   banner 继续直接由 `syncState.kind === 'bd-unavailable' && total > 0` 驱动。
4. 两屏的渲染分支必须使用派生出的内容状态，不再各自重复无缓存错误判断。
   既有加载、空数据、无缓存错误及 Board 列级空态的可见 UI 不变；List 有缓存
   且 bd 不可用时的 `data-state` 改为 `ready` 或 `no-match`。
5. 纯函数用表驱动测试固定优先级，组件测试覆盖两屏有/无缓存、筛选零结果和
   stale banner 组合。不修改 `SyncState`，不增加运行时依赖，也不改变模块
   依赖方向。

## 后果

- `data-state="ready"` 不再意味着数据一定新鲜；需要同步健康时必须读取
  `data-sync`。内容是否可操作与数据是否过期可以独立判断和测试。
- List 的既有测试需要从“有缓存仍为 `bd-unavailable`”改为断言 `ready`；
  App 的无缓存错误回归测试保持 `bd-unavailable`。
- Board 的列级空态得到明确回归覆盖，未来若要改为整屏无匹配页，必须先修改
  `SPEC-board`，不能以共享派生逻辑为由静默改变。
- 共享函数只统一基础状态机，不强迫两个视图采用相同的筛选零结果呈现。

## 被拒绝的备选

- **新增 `stale` 内容状态**：与已有 `data-sync="bd-unavailable"` 重复，并在
  “有缓存 + 筛选零结果 + bd 不可用”时与 `no-match` 争夺同一状态槽，混淆
  同步健康与内容呈现。
- **Board 照搬 List 的整屏 `NoMatchState`**：会移除所有看板列，违反
  `SPEC-board`“筛选后列仍保留”的现有契约。
- **保留两份三元表达式，只修改断言**：无法消除派生优先级继续漂移的根因。
