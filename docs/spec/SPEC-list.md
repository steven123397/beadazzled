# Spec: list — 列表视图

状态：v0.1.0 · 依赖：`shell`、`sync`

## Objective

一个能读、能扫、能筛的列表：1000 条票下保持 60fps，键盘可在不离开列表的情况下定位与打开任何票。

列表是 v0.1.0 的默认首页，也是「比 Scotty 好看好读」最直接的体现。

## 内容与布局

每行（36px，`--row-height`）：

```
[状态图标+文字]  [ID]  [标题………………………………]  [优先级]  [类型]  [指派人]  [标签]  [更新时间]
```

- 标题占主要宽度，单行省略；悬停显示完整标题。
- 状态用图标 + 文字（不只靠颜色）；优先级 0–4 用文字/图标表示（P0 最高）。
- 标签最多显示 2 个 + `+N`。
- 时间为相对时间（`3h ago` / `昨天`），悬停显示绝对时间。
- 行悬停高亮，焦点行有可见焦点环；当前打开详情的行为选中态。

## 筛选、分组、排序

筛选（可组合，全部客户端计算）：

| 维度 | 控制 |
|---|---|
| 文本 | `q`：匹配 id / 标题 / 标签（大小写不敏感） |
| 状态 | 多选：open / in_progress / blocked / deferred / closed / pinned / hooked |
| 优先级 | 多选：0–4 |
| 类型 | 多选：来自票数据中出现过的类型 |
| 指派人 | 多选：出现过的 assignee / 「未指派」 |
| 标签 | 多选：出现过的标签 |
| Ready | 开关：status=open 且所有依赖目标均已 closed |

分组：`none`（默认）/ `status` / `priority` / `type` / `assignee`；分组头显示计数，可折叠。
排序：`updated`（默认，降序）/ `priority`（0 在前）/ `created` / `title` / `id`；支持升降序。

所有筛选/分组/排序状态写入 URL 查询参数，刷新与深链接可恢复；每个工作区记住上次状态。

筛选栏显示：结果数 / 总数；有筛选时提供「清除」。

## 派生计算

```ts
// src/features/list/filter.ts —— 纯函数
export function selectVisibleIssues(issues: Issue[], view: ListViewState): Issue[];
```

- 先过滤 → 再分组 → 再排序；每步纯函数，便于单测。
- Ready 判定：`status === 'open'` 且 `blockingDeps(issue)` 为空（定义见 `SPEC-writes`）；依赖目标不在 store 中视为未完成。
- 文本索引在 store 更新时增量维护，避免每次输入全量扫描。

## 性能

- `@tanstack/react-virtual` 虚拟化；overscan 10 行。
- 行组件 `React.memo`，props 只传 id 与派生显示值。
- 1000 行滚动 60fps；筛选 1000 条 ≤16ms；不可见的行不渲染。
- 打开详情后返回，滚动位置与焦点行保持不变。

## 状态区分

| 情况 | 呈现 |
|---|---|
| 基线加载中 | 骨架屏（10 行占位） |
| 工作区无票 | 空状态 +「新建第一条票」按钮 |
| 有票但筛选无结果 | 「没有匹配的票」+「清除筛选」 |
| bd 不可用 | 错误状态（来自 `sync`），保留上次数据并标注过期 |
| journal 降级 | 列表正常显示，状态栏黄点 |

**任何情况下不得用空列表表示加载或失败。**

## Acceptance Criteria

1. **滚动性能**：1000 条票下滚动稳定 60fps（`npm run measure:scroll`），无布局跳动。
2. **筛选速度**：1000 条票、6 种筛选组合，单次筛选 ≤16ms（Vitest 基准）。
3. **纯函数正确**：filter / group / sort 各自有表驱动单测；组合顺序固定为过滤→分组→排序。
4. **Ready 语义**：阻塞依赖未关闭时不计 Ready；依赖目标缺失时不计 Ready；全部关闭后计入。
5. **键盘**：`J/K` 移动焦点行，`Enter` 打开详情，返回后焦点与滚动恢复；`/` 聚焦搜索。
6. **深链接**：含 `q/status/priority/type/assignee/label/group/sort/ready` 的 URL 重启后完整恢复。
7. **空/错/载区分**：三种状态分别有可断言的 DOM 标志与文案。
8. **所有状态可读**：7 种 bd 状态都有图标与文字；未知状态显示原始值而不是空白。
9. **零 bd**：筛选、排序、滚动、开关分组期间 fake bridge 调用计数为 0。
10. **可访问性**：axe 无严重违规；行具备可读的 aria 标签；焦点环对比度达标。

## Module Commands

- `npm run test:unit -- src/features/list`
- `npm run measure:scroll`
- `npm run e2e -- list`

## Module Structure

```
src/features/list/
  ListView.tsx        虚拟列表与键盘容器
  Row.tsx             单行（memo）
  FilterBar.tsx       筛选/分组/排序控制
  GroupHeader.tsx     分组头与计数
  view-state.ts       ListViewState 与 URL 序列化
  filter.ts           matchesFilter / selectVisibleIssues
  group.ts            groupIssues
  sort.ts             sortIssues
  ready.ts            ready 判定
```

## Module Code Style

- 派生计算全部放纯函数文件，组件只做渲染与事件。
- `ListViewState` 是唯一视图状态来源；组件不各自持有筛选状态。
- URL 序列化使用固定键名，未知键忽略并保留（前向兼容）。

参考实现（MIT，移植规则见 [ADR-0001](../adr/0001-ui-foundation-and-linear-references.md)）：Circle 的 `issue-line.tsx`（行布局）、`issue-filter-bar.tsx`（筛选）、`grouped-issues-view.tsx`（分组）。

## Boundaries

- **Always**：虚拟化；纯函数派生；URL 可恢复；状态/错误可见。
- **Ask first**：增加新筛选维度；引入服务端/后台计算；改变默认排序。
- **Never**：在渲染中调用 IPC/bd；每次按键重建全文索引；用颜色单独表达状态；在 list 内直接改票（写操作走详情或看板）。

## Open Questions

1. **搜索是否覆盖正文**：v0.1.0 只搜 id/标题/标签；正文搜索需要额外索引与高亮，留到后续版本。
2. **列显隐**：窄窗口下哪些列优先（建议：ID、标题、状态、优先级固定；指派人/标签/时间可隐藏），需在实现时按 900px 断点确认。
3. **分组折叠状态**：是否跨会话记住；倾向按工作区持久化，成本低。