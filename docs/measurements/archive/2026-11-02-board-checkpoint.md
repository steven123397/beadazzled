# Checkpoint 6：Board 完成（2026-11-02）

状态：验收记录。对应 `bza-pie` 的两条验收标准。

## 验收标准

1. 看板 E2E 通过。
2. 依赖清空后自动迁移演示通过。

## 证据

### 看板 E2E

```bash
npm run e2e
```

结果：40 passed，其中 `tests/e2e/board.spec.ts` 10 条：

- 真实指针拖到可投放列（走到写入闸门后因无写 seam 拒绝）
- 拖入 Blocked 被拒绝、从 Blocked 拖出被拒绝
- H/L/J/K 焦点移动与 Enter 打开详情
- 筛选控件上的 Enter 保留原生行为（不打开票）
- 详情返回后恢复列滚动偏移与焦点卡
- 拖动与拒绝全程零 bd 调用
- dnd-kit keyboard sensor 激活与 Escape 取消
- 1000 卡片列虚拟化；滚动、聚焦、筛选零 bd

### 依赖清空后的自动迁移

`src/features/board/checkpoint.test.ts`：

1. 用真实 `TicketStore` + `applySnapshot` 建立基线：一张票同时被两张票阻塞，落在 Blocked。
2. 用真实 journal reducer `applyRecords` 关闭第一张阻塞票：仍留在 Blocked。
3. 关闭最后一张阻塞票：同一份 store 数据重新派生后，卡片出现在 Ready，Blocked 列为空。

整个过程没有任何看板操作或额外 bd 调用，验证的是「列由 `status + blockingDeps`
派生」而不是缓存搬家。`BoardView.test.tsx` 另有从渲染层重渲染的同类用例。

## 配套结果

| 项目 | 结果 |
|---|---|
| 单测 | 530 passed（board 78） |
| E2E | 40 passed（board 10） |
| 滚动 | `measure:scroll --view=board` p50 16.6–16.7ms / p95 18.8–18.9ms，PASS |
| axe | Board 路由 0 serious/critical |
| 首屏 | 143.2 / 150 KB gzip |
| 质量门 | `check:fast`、`check:task`、`check:boundaries`、`check:bindings`、`check:deps` 通过 |

15 条验收的逐项映射见 [board-verification](2026-11-02-board-verification.md)。

## 已知限制

浏览器 E2E 没有 `execute_write` 与 journal 回声 seam，因此「拖动 → 写入 → 回声迁移」
的真实命令链路由单测覆盖；本 Checkpoint 的迁移演示使用真实 store + reducer，
不是真实 `bd` 进程。真实 bd 只出现在发布阶段的三条 E2E。