# Spec: shell — 应用框架、键盘、主题、i18n

状态：v0.1.0 · 依赖：`workspace`、`sync` · 被所有屏幕消费

## Objective

提供「打开就像用 Linear」的外框：稳定的导航、全程键盘可达、统一的视觉密度与主题、可切换的中英文，以及一眼能看懂的实时性状态。

壳层不承载业务逻辑：它只负责路由、键盘、主题令牌、i18n、状态栏与错误边界。

## 布局

```
┌──────────────────────────────────────────────────────────┐
│ 顶栏：工作区切换 · 搜索/命令面板入口 · 刷新 · 新建        │
├──────────┬───────────────────────────────────────────────┤
│ 侧栏     │ 主区域                                         │
│  List    │  list / board / detail / settings              │
│  Board   │                                               │
│  Settings│                                               │
├──────────┴───────────────────────────────────────────────┤
│ 状态栏：bd 版本 · 工作区 · 同步状态 · 上次刷新 · pending  │
└──────────────────────────────────────────────────────────┘
```

- 原生标题栏（不做自绘窗口控件），减少 v0.1.0 复杂度。
- 侧栏可折叠（`Ctrl+B`），状态持久化。
- 主区域滚动与侧栏滚动独立。

## 路由

Hash 路由（`react-router-dom` v7），工作区由 `projectId` 标识：

| 路由 | 内容 |
|---|---|
| `#/w/:projectId/list` | 列表（查询参数承载筛选/分组/排序/选中） |
| `#/w/:projectId/board` | 看板 |
| `#/w/:projectId/issue/:issueId` | 详情（覆盖在列表/看板上，Esc 返回） |
| `#/settings/:section` | 设置（栏目见 `SPEC-settings`；`#/settings` 重定向到 `general`） |
| `#/welcome` | 未就绪引导（bd 缺失 / 无工作区） |

- 切换工作区时替换 `:projectId` 并清空查询参数。
- 刷新应用后按 URL 恢复视图；若工作区已不存在 → `#/welcome` 并提示原因。
- 详情以右侧覆盖层呈现，保留底层列表的滚动位置与筛选。

## 键盘系统

全局（Windows 用 `Ctrl`，macOS 不交付但代码按 `Cmd` 处理）：

| 快捷键 | 动作 |
|---|---|
| `Ctrl+K` | 命令面板 |
| `Ctrl+R` | 刷新数据（**不是**重载页面；生产环境禁用 WebView 刷新） |
| `Ctrl+B` | 折叠/展开侧栏 |
| `Ctrl+1` / `Ctrl+2` | 切到 List / Board |
| `Ctrl+N` | 新建票 |
| `G` 然后 `L` / `B` / `S` | 跳转 List / Board / Settings |
| `?` | 快捷键帮助 |
| `Esc` | 关闭覆盖层 / 返回上一层 |

屏幕内（焦点分区明确）：

| 屏幕 | 键 | 动作 |
|---|---|---|
| List | `J` / `K` | 下/上一条 |
| List | `Enter` | 打开详情 |
| List | `/` | 聚焦搜索框 |
| Detail | `E` | 编辑标题/正文 |
| Detail | `C` | 评论 |
| Detail | `S` / `P` / `A` | 状态 / 优先级 / 指派菜单 |
| Detail | `Esc` | 关闭详情 |
| Board | `H` / `L` | 左右移动焦点列 |
| Board | `J` / `K` | 列内上下移动 |
| Board | `Shift+←/→` | 把当前卡片移到相邻的可投放列（跳过 Blocked/Other，触发状态写入） |
| Board | `Enter` | 打开详情 |

规则：
- 单键快捷方式只在焦点不在输入框/编辑器时生效。
- 所有快捷键可通过 `?` 面板查询；不提供自定义映射（v0.1.0）。
- 焦点顺序与视觉顺序一致；焦点环始终可见（≥3:1 对比）。

## 命令面板

`Ctrl+K` 打开，分组：

1. **跳转**：List / Board / Settings / 最近工作区
2. **动作**：刷新、新建票、切换主题、切换语言、复制诊断
3. **票**：按 id / 标题模糊匹配，显示状态与优先级

- 模糊匹配在 1000 条票 + 200 个动作下 ≤50ms。
- `Enter` 执行，`↑/↓` 移动，`Esc` 关闭；支持鼠标但不依赖鼠标。
- 输入 `>` 只显示动作，输入 `#` 只显示票（可选语法，v0.1.0 实现）。

## UI 基线与参考实现

决策见 [ADR-0001](../adr/0001-ui-foundation-and-linear-references.md)。摘要：

- **组件基线**：shadcn/ui 源码内联到 `src/components/ui/`（MIT，基于 Radix）；命令面板 `cmdk`，拖拽 `dnd-kit`，虚拟滚动 `@tanstack/react-virtual`。不引入运行时成品组件库。
- **主题 token**：以 Cuelark UI 的 Linear 主题（MIT）为起点，落到 `src/styles/tokens.css` 后按本项目预算调整；不使用 Linear 商标、Logo、品牌文案。
- **主要参考**：Circle（MIT，纯前端）。`components/layout/main-layout.tsx`、`sidebar/`、`command-palette.tsx` 对应本模块；列表/详情/看板的参考见各自 spec。
- **移植规则**：只取需要的单文件；把 `next/link`、`next/navigation`、`useParams`、`nuqs`、`mock-data` 换成本项目的 react-router、URL 状态、store/writes；按 2 空格 Prettier 重新格式化；颜色只走 token。
- **许可证红线**：可复制 MIT / Apache-2.0 / ISC / BSD，并在 `NOTICE` 记录来源仓库、路径、commit；AGPL（Plane）、EPL（Huly）、ELv2（Exponential）只看不抄；CC BY-NC 不参考。
- 参考仓库放在 `.upstream/`（gitignored），不参与构建。

## 主题与密度

CSS 变量令牌（`src/styles/tokens.css`），起点为 Cuelark UI 的 Linear 主题（MIT），再按本项目对比度/密度预算调整：

```css
:root {
  --background: #f9f8f9;
  --foreground: #282a30;
  --card: #ffffff;
  --muted: #f1f0f2;
  --muted-foreground: #6f6e77;
  --border: #e9e8ea;
  --input: #dcdbdd;
  --primary: #5e6ad2;
  --primary-foreground: #ffffff;
  --ring: #7170ff;
  --destructive: #c4362f;
  --warning: #9a6400;
  --success: #1d7a4a;
  --radius: 8px;
  --row-height: 36px;
  --ui-font: 13px;
  --doc-font: 15px;
  --doc-leading: 1.65;
  --doc-measure: 72ch;
}

.dark {
  --background: #08090a;
  --foreground: #f7f8f8;
  --card: #0f1011;
  --muted: #1c1c1f;
  --muted-foreground: #8a8f98;
  --border: #23252a;
  --input: #34343a;
  --primary: #5e6ad2;
  --ring: #7170ff;
}
```

- `light` / `dark` / `system` 三档；`system` 跟随 `prefers-color-scheme`，切换即时生效、无需重载、持久化。
- 正文对比度 ≥4.5:1；大字号 ≥3:1（CONSTRAINTS）。
- 间距 4px 基准；列表行高 36px；详情正文 15px / 1.65 / 最大 72ch。
- 不使用成品组件库的主题层；Radix 只提供行为与可访问性。

## i18n

- 默认 `en`，可切 `zh-CN`；切换即时生效，不重载。
- 文案集中在 `src/lib/i18n/en.ts`（事实来源）与 `zh-CN.ts`；组件内禁止硬编码用户可见字符串。
- 键为扁平点号命名（`detail.comment.placeholder`）；支持简单插值 `{count}`。
- 日期/数字用 `Intl`，随语言切换。
- 测试断言：两份目录键集合完全一致、无空值、无未翻译占位。

## 状态栏与错误边界

- 同步状态四色（绿/黄/黄/红）与文字标签，鼠标悬停显示细节；点击打开诊断弹层（bd 版本、工作区路径、lastSeq、最近错误）。
- 未就绪状态（bd 缺失/版本不符/工作区丢失）统一走 `#/welcome`，给出可执行命令与「选择工作区」按钮。
- 顶层 Error Boundary：渲染错误码、可复制的诊断信息，不让窗口白屏。
- 列表/看板加载中显示骨架屏；**不得**用空列表表示加载或失败。

## Acceptance Criteria

1. **键盘闭环**：仅用键盘完成「打开工作区 → List → 详情 → 改状态 → 返回 → 切 Board」，E2E 断言全程无鼠标事件。
2. **面板性能**：1000 条票 + 200 动作下，命令面板输入到结果渲染 ≤50ms。
3. **主题**：三档切换即时生效、持久化、重启保持；两套主题文本对比度达标。
4. **i18n 完整**：en / zh-CN 键集合相等，切换后所有可见字符串变化且无 `{placeholder}` 残留。
5. **状态可见**：6 个 `SyncState` 在状态栏都有对应文案与颜色；`bd-unavailable` 时仍能打开设置与诊断。
6. **路由恢复**：带筛选参数的列表深链接在重启后恢复；不存在的 projectId 落到 `#/welcome`。
7. **零 bd 交互**：导航、滚动、切换屏幕期间 fake bridge 调用计数为 0。
8. **启动预算**：冷启动到可交互 ≤2.0s（P95），热启动 ≤800ms（CONSTRAINTS）。
9. **错误不白屏**：注入渲染异常时 Error Boundary 显示错误码与可复制诊断。
10. **焦点**：所有可交互元素的焦点可见；`Tab` 顺序与视觉一致（手动走查 + axe）。
11. **参考代码卫生**：`src/` 中不存在 `next/*`、`nuqs`、`mock-data` 导入；任何移植文件在 `NOTICE` 有对应来源记录；仓库中不存在 AGPL/EPL/ELv2/CC-BY-NC 项目的代码（脚本 + review）。

## Module Commands

- `npm run dev` / `npm run dev:web` — 壳层开发
- `npm run test:unit -- src/app src/lib/i18n`
- `npm run measure:startup` — 启动预算
- `npm run e2e -- keyboard` — 键盘闭环

## Module Structure

```
src/app/
  App.tsx            路由与 providers
  router.tsx         hash 路由定义
  shell/             Layout、侧栏、顶栏、状态栏、欢迎页
  keyboard/          快捷键注册、焦点分区、帮助面板
  palette/           命令面板（动作 + 票搜索）
src/components/ui/    shadcn 源码组件（button、dialog、command、sidebar 等）
src/components/      Button、Menu、Dialog、Toast 等本项目共享原语（基于 ui/）
src/lib/i18n/        en.ts、zh-CN.ts、t()
src/styles/          tokens.css、globals.css
```

## Module Code Style

- 组件只读 store 的 selector，不直接调用 IPC；IPC 调用集中在 `src/lib/`。
- 样式只用令牌变量与 Tailwind 语义类，不写裸色值（主题例外集中在一个文件）。
- 每个快捷键在 `keyboard/registry.ts` 注册一次，帮助面板由注册表生成，避免文档与实现漂移。

## Boundaries

- **Always**：键盘可达；字符串进 i18n；状态用显式文案；错误可见。
- **Ask first**：新增全局快捷键；更换路由库；引入 UI 组件库；自定义窗口边框。
- **Never**：组件内硬编码用户文案；直接调用 bd/IPC；用空状态表达加载或失败；禁用焦点环。

## Open Questions

1. **`Ctrl+R` 冲突**：Tauri WebView2 默认刷新快捷键需在开发环境屏蔽；生产环境确认不会触发页面重载。
2. **`G` 组合键超时**：按 `G` 后等待下一个键的超时（拟 800ms）需实测手感。
3. **自绘标题栏**：v0.1.0 用原生标题栏；若视觉验收认为差距明显，再评估自绘（会带来拖拽区与窗口按钮的额外工作）。