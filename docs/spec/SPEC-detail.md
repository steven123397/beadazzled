# Spec: detail — 文档式详情页

状态：v0.1.0 · 依赖：`shell`、`sync`、`writes`

## Objective

把一条票读成一篇文档：正文、验收条件、评论、阻塞关系都在同一页，长文阅读不疲劳；需要改的时候不用离开页面。

这是「Linear 水准阅读体验」的核心交付点。

## 布局

```
┌────────────────────────────────────────────────────────────┐
│ 返回   bza-a3f2dd · 复制 id           [状态] [优先级] [···]│
│ 标题（可 inline 编辑）                                     │
├──────────────────────────────────────────┬─────────────────┤
│ 正文（Markdown，72ch）                    │ 元数据栏        │
│ 验收条件                                  │ 类型 / 指派     │
│ 设计 / 备注（存在时折叠展示）              │ 标签            │
│ ── 评论 ──                                │ 创建 / 更新     │
│ 评论时间线                                │ 阻塞 (blocked by)│
│ 评论输入框                                │ 阻塞了 (blocks) │
└──────────────────────────────────────────┴─────────────────┘
```

- 详情以覆盖层方式打开，底层列表/看板保留滚动与筛选。
- 正文列最大 72ch，15px / 1.65；元数据栏 280px，窄窗口（<1000px）折叠到正文下方。
- 打开详情不发起任何 bd 调用；数据来自内存 store。

## 内容来源（bd export 字段）

| 区块 | 字段 |
|---|---|
| 标题 / id | `title` / `id` |
| 正文 | `description`（Markdown） |
| 验收条件 | `acceptance_criteria` |
| 设计/备注 | `design` / `notes`（存在于 `extra` 时展示，折叠） |
| 元数据 | `status` / `priority` / `issue_type` / `assignee` / `labels` / `created_at` / `updated_at` / `closed_at` |
| 评论 | `comments[]`（按 `created_at` 升序） |
| 阻塞（blocked by） | 本票 `dependencies[]` 中类型为 `blocks` / `conditional-blocks` / `waits-for` 的边，解析 `depends_on_id` |
| 阻塞了（blocks） | 扫描 store 中所有票的 `dependencies`，反查指向本票的同类边 |

- 依赖只读展示，可点击跳转到目标票；**v0.1.0 不提供依赖编辑**。
- 两组只计入三种阻塞类型：`parent-child`、`related` 等关系不在详情页出现，与 `canChangeStatus` 的阻塞判定一致。
- 目标票不在 store（已删除/不可见）→ 显示 id 并标注「未找到」。
- 每组关系显示计数与状态摘要（例如 `2 blocked by · 1 closed`）。

## 阅读体验

- 正文渲染：`react-markdown` + `remark-gfm`（表格、任务列表、删除线）+ `rehype-sanitize`。
- **禁止**原始 HTML、`<script>`、`<iframe>`、事件属性；渲染后不得出现可执行内容。
- 代码块等宽字体、可横向滚动；v0.1.0 不做语法高亮。
- 链接使用系统浏览器打开；不在应用内导航。
- 远程图片（http/https）**默认不自动加载**，渲染为占位链接与地址；v0.1.0 不提供开关，后续版本按性能与隐私表现再评估。
- 空正文/空验收显示弱化占位文案，不留空白块。
- 长文不折叠正文；评论超过 10 条时按时间全部展示（虚拟化仅在超过 200 条评论时启用）。

## 编辑

| 操作 | 交互 | 命令（见 `SPEC-writes`） |
|---|---|---|
| 标题 | 点击标题或 `E` → inline 输入 | `--title` |
| 正文 | `E` → Markdown 文本区 + 预览切换 | `--body-file -`（stdin） |
| 验收条件 | 独立编辑区 | `--acceptance` |
| 状态/优先级/指派/标签 | 元数据栏控件 | `update` 对应标志 |
| 评论 | 底部输入框，`Ctrl+Enter` 提交 | `bd comment --stdin` |
| 关闭/重开 | 元数据栏按钮 | `bd close` / `bd reopen` |

编辑规则：

- 显式「保存 / 取消」；`Esc` 取消并保留原文；不做自动保存。
- 保存后进入 pending，控件禁用；**不回显不更新界面**，等 journal 回声（`writes`）。
- 保存失败：保留草稿与编辑态，错误就地显示（不弹全屏对话框）。
- 多人并发：标题/正文无守卫，按 bd 的最后写入为准；状态/优先级/指派使用 `--if-status` / `--if-assignee` 守卫，冲突时提示并刷新。
- **依赖拦截**：状态菜单与看板共用 `canChangeStatus`（见 `SPEC-writes`）。存在未完成阻塞依赖时，`in_progress` / `closed` 选项禁用并列出阻塞票；`open` / `blocked` 可用。被禁止时说明「v0.1.0 需在 CLI 解除依赖」，不产生 bd 调用。
- 评论提交失败保留输入内容。

## 生命周期边界

| 情况 | 行为 |
|---|---|
| 当前票被删除（journal `delete`） | 顶部提示「这条票已被删除」，3s 后自动关闭或用户手动返回 |
| 当前票被他人修改 | 直接由 store 更新；正在编辑的字段不覆盖草稿，显示「已在别处更新」 |
| 切换工作区 | 关闭详情，草稿丢弃前二次确认 |
| journal 降级 | 照常阅读与编辑；编辑后走基线刷新 |

## Acceptance Criteria

1. **打开性能**：从列表/看板打开详情 ≤50ms（`measure:navigation`），无 bd 调用、无网络请求。
2. **Markdown 正确**：GFM 表格、任务列表、代码块、嵌套列表渲染正确；快照测试覆盖 6 类结构。
3. **安全**：注入 `<script>`、`<img onerror>`、`<iframe>`、`javascript:` 链接的样本渲染后不产生可执行节点（DOM 断言 + 无控制台执行）。
4. **链接**：http(s) 链接调用系统浏览器；相对链接不触发应用内导航。
5. **评论**：按时间升序；作者、相对时间、正文完整；`Ctrl+Enter` 提交；失败保留文本。
6. **依赖阅读**：给定 fixture（A blocks B、C blocks B），B 的页面显示 blocked by = [A, C]；A 页面 blocks = [B]；已删除目标标注「未找到」；`parent-child` / `related` 边不出现在任一组。
7. **编辑闭环**：改标题/正文/验收 → 环境回声后界面更新；fake 环境失败时草稿保留且错误可见。
8. **冲突**：看板/详情同时改状态，守卫失败返回 exit 13 → 提示「已在别处修改」并刷新，不覆盖。
9. **删除处理**：详情打开时注入 delete 事件 → 提示可见，界面不崩溃。
10. **长文**：64 KiB Markdown 首次渲染 ≤100ms，滚动无卡顿。
11. **键盘**：`E/C/S/P/A/Esc` 全部可用，编辑态下不触发全局单键快捷键。
12. **可访问性**：标题层级正确（h1/h2）、评论列表语义、axe 无严重违规。
13. **依赖拦截**：有未完成阻塞依赖的票，详情页状态菜单中 `in_progress` / `closed` 禁用且列出阻塞票；`open` / `blocked` 可用；与看板拖动结果一致，拒绝时无 bd 调用。

## Module Commands

- `npm run test:unit -- src/features/detail`
- `npm run measure:navigation`
- `npm run e2e -- detail`

## Module Structure

```
src/features/detail/
  DetailView.tsx       页面骨架与生命周期
  Header.tsx           标题、id、状态与操作
  Markdown.tsx         渲染管道（sanitize 配置）
  Editor.tsx           正文/验收编辑（文本区 + 预览）
  MetadataRail.tsx     元数据、标签、时间
  Dependencies.tsx     blocked by / blocks 只读列表
  Comments.tsx         时间线与输入框
src/lib/store/selectors.ts  getIssue、getBlockedBy、getBlocks
```

## Module Code Style

- 渲染与编辑状态分离：`useDetailState` 管草稿，store 管事实，禁止把草稿写回 store。
- Markdown 管道只在一处配置 `rehype-sanitize` 白名单，禁止组件内另开渲染器。
- 所有写操作经 `useWrite`，不直接调用 IPC。

参考实现（MIT，移植规则见 [ADR-0001](../adr/0001-ui-foundation-and-linear-references.md)）：Circle 的 `issues/details/issue-details.tsx`（页面结构）、`issue-properties-panel.tsx`（元数据栏）、`status-selector.tsx` / `priority-selector.tsx`（选择器）。

## Boundaries

- **Always**：打开零 bd 调用；失败保留草稿；Markdown 消毒；状态/优先级写入带守卫。
- **Ask first**：允许远程图片或原始 HTML；增加依赖编辑；引入富文本编辑器。
- **Never**：自动保存；在渲染字符串里拼 HTML；静默丢弃草稿；覆盖用户正在编辑的内容。

## Open Questions

1. **编辑器选型**：v0.1.0 用文本区 + 预览切换；CodeMirror 6 留待正文写作需求明确后再评估。
2. **备注/设计字段**：bd export 中存在时展示；若长期为空，是否隐藏该区块需在实装后按真实数据判断。