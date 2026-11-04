# Board 验收矩阵（2026-11-02）

状态：验收记录，回答 `bza-z2l` 的「15 条验收对应测试通过」。对应
[SPEC-board](../../spec/SPEC-board.md) 的 Acceptance Criteria。

命令：`npm run test:unit -- src/features/board`、`npm run e2e -- board`、
`npm run measure:scroll -- --view=board`。

| # | 验收标准 | 覆盖 | 结果 |
|---|---|---|---|
| 1 | 列归属（deferred/open/阻塞/in_progress/hooked/closed/blocked/pinned/未知） | `columns.test.ts` 表驱动 11 例 | 通过 |
| 2 | 投放映射（Backlog/Ready/In Progress/Done，Done→非 open 两条按序） | `move.test.ts` 命令序列断言 + `BoardView.drag.test.tsx` 捕获 `onDragEnd` 断言拖动侧命令 | 通过 |
| 3 | Blocked 不可投放：拖入、拖出均零 bd 且有提示 | `move.test.ts` + `BoardView.test.tsx` + `BoardView.drag.test.tsx` + `board.spec.ts` 真实拖动 | 通过 |
| 4 | Ready 拒绝仍有未完成阻塞的卡片 | `move.test.ts` `ready-blocked` | 通过 |
| 5 | 守卫：in_progress + 阻塞拖到 Done 被拒绝；详情菜单同结果 | `move.test.ts` + `guard.test.ts` + `MetadataRail.test.tsx` | 通过 |
| 6 | 自动迁移：最后一条阻塞依赖清除后 Blocked → Ready | `checkpoint.test.ts` 真实 store + reducer；`BoardView.test.tsx` 渲染层重渲染 | 通过 |
| 7 | 不乐观：回声前卡片留在源列且 pending；store 不变 | `BoardView.test.tsx` 挂起 submit 的 pending 用例；`App.test.tsx` 真实写链路在 echo 前断言列计数不变 | 通过 |
| 8 | 冲突：exit 13 不移动、提示、只触发一次基线、不重试 | `BoardView.test.tsx` 冲突用例 + `App.test.tsx` 板级冲突用例 + `flow.test.ts` `refreshes === 1` | 通过 |
| 9 | 失败回显：关闭被拒时显示 bd 原因，卡片原位 | `BoardView.test.tsx` `BD_EXIT_NONZERO` + stderr | 通过 |
| 10 | 键盘等价：Shift+→ 与拖动同命令序列；跳过 Blocked/Other；Blocked 按键零写入 | `BoardView.test.tsx` + `BoardView.drag.test.tsx` + `keyboard.test.ts` + `board.spec.ts` | 通过 |
| 11 | Other 列：有票才显示、计数、可拖出 | `columns.test.ts` + `BoardView.test.tsx` + `move.test.ts` Other 源 | 通过 |
| 12 | 筛选一致：同一组筛选 List 与 Board 票集合相同（除状态） | `columns.test.ts` 对四组筛选比对 `filterForBoard` 与 `selectVisibleIssues` | 通过 |
| 13 | 性能：1000 卡片滚动 60fps；拖动只渲染一个 overlay | `measure:scroll --view=board`（p50 16.6–16.7ms / p95 18.8–18.9ms）+ `board.spec.ts` 1000 卡片虚拟化 | 通过 |
| 14 | 零 bd：滚动、筛选、聚焦、拖动拒绝期间无 fake bridge 调用 | `board.spec.ts` 两组 `invokeLog` 空数组断言 | 通过 |
| 15 | 可访问性：keyboard sensor 可用；移动结果 aria-live；axe 无严重违规 | `board.spec.ts` keyboard sensor 激活/取消；`BoardView.test.tsx` aria-live 断言；`accessibility.spec.ts` axe | 通过 |

## 复测结果（2026-11-02，修复审查发现后）

- 单测：530 passed（board 78 条）
- E2E：40 passed（board 10 条，含 1000 卡片、真实指针拖动、筛选控件 Enter 与详情返回位置恢复）
- `measure:scroll --view=board`：board-steady p50 16.7ms / p95 18.9ms；
  board-fling p50 16.6ms / p95 18.8ms，均 PASS
- `check:fast`、`check:task`、`check:boundaries`、`check:bindings`、`check:deps` 通过

## 已知未覆盖

- 浏览器 E2E 不产生真实写命令：fake bridge 没有 `execute_write` 与 journal
  回声 seam。「拖动 → 写入 → 回声迁移」现在由 `BoardView.drag.test.tsx`
  （捕获 `onDragEnd` 断言命令序列）与 `App.test.tsx`（真实 `useWrite`/flow +
  fake sync 回声，断言列计数在 echo 前后变化）覆盖；E2E 仍只验证拒绝路径与零 bd。
  若后续补写 seam，可再把 #2、#6、#8 的真实进程链路搬到 E2E。