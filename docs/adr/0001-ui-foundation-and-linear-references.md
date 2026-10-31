# ADR-0001: UI 基线与 Linear 风格参考来源

状态：已接受（2026-10-31）
影响模块：`shell`、`list`、`detail`、`board`、`settings`

## 背景

目标观感是 Linear 水准，但不从零盲搓、也不照截图猜。需要明确：

1. 组件从哪来、以什么形式进入仓库；
2. Linear 风格的视觉 token 从哪来；
3. 哪些开源项目可以移植代码，哪些只能看；
4. 如何满足 MIT 许可证的署名义务。

## 决策

### 1. 组件基线：shadcn/ui 源码内联

- 使用 shadcn/ui（MIT，基于 Radix）生成组件源码到 `src/components/ui/`，作为仓库内可修改的代码，而不是运行时依赖。
- 不引入成品组件库（MUI/Ant/Chakra 等）；不引入需要主题覆盖才能改观感的库。
- 命令面板用 `cmdk`（MIT）；拖拽用 `dnd-kit`（MIT，键盘 sensor）；虚拟滚动用 `@tanstack/react-virtual`（MIT）；图标 `lucide-react`（ISC）。

### 2. 主题 token：Cuelark Linear 主题为起点

- 以 Cuelark UI 的 Linear 主题（MIT）为 CSS 变量起点：主色 `#5e6ad2`、Inter 510/590、8px 圆角、明暗两套变量。
- 落到 `src/styles/tokens.css` 后按本项目预算调整：正文对比度 ≥4.5:1、行高 36px、正文 15px/1.65/72ch。
- 不复制 Linear 的商标、Logo 或品牌文案；产品名与图标独立。

### 3. 参考实现：Circle（MIT）为主

- `ln-dev7/circle`（MIT，纯前端，无后端）作为 Linear 风格的主要参考。
- 参考映射：

| 我们的模块 | Circle 参考路径 |
|---|---|
| 应用壳 / 侧栏 | `components/layout/main-layout.tsx`、`components/layout/sidebar/` |
| 命令面板 | `components/layout/command-palette.tsx` |
| 列表行 | `components/common/issues/issue-line.tsx` |
| 筛选 / 分组 | `components/common/issues/issue-filter-bar.tsx`、`grouped-issues-view.tsx` |
| 详情页 | `components/common/issues/details/issue-details.tsx` |
| 属性面板 | `components/common/issues/details/issue-properties-panel.tsx` |
| 状态 / 优先级选择器 | `status-selector.tsx`、`priority-selector.tsx` |
| 新建票 | `components/layout/sidebar/create-new-issue/` |
| 看板卡片 / 拖拽 | 无直接等价物；参考 `components/common/projects/projects-board.tsx` 与 issue 行样式 |

- 只移植需要的单个组件，不整仓 fork。移植时必须：
  - 去掉 `next/link`、`next/navigation`、`useParams`、`nuqs`、`mock-data`，改接 react-router、我们自己的 URL 状态与 store/writes；
  - 按本项目 Prettier 配置重新格式化（Circle 用 3 空格，我们用 2 空格）；
  - 颜色只走 token，不保留硬编码色值。
- `soft-track`（MIT，React + Vite）作为次级参考：peek/panel/page、保存视图、命令面板。
- `zite/issue-tracker`（MIT，Vite + shadcn + TanStack Table + dnd-kit）作为 table/board 实现参考。

### 4. 许可证红线

- **可以复制/修改**：MIT、Apache-2.0、ISC、BSD 的代码，必须在 `NOTICE` 记录来源仓库、文件路径、commit。
- **只能阅读、不得复制代码**：AGPL（Plane）、EPL（Huly）、ELv2（Exponential）。
- **不参考**：CC BY-NC（如 Vector）——非商用限制与本项目 MIT 开源分发冲突。
- Circle 的付费 BaseUI 版本（Square UI Pro）不在 MIT 仓库内，**不得**获取或复制。

### 5. 参考代码的存放

- 参考仓库 clone 到 `.upstream/`（已 gitignore），不参与构建、不进入安装包。
- 任何进入 `src/` 的移植代码必须同时更新 `NOTICE`；review 时检查。

## 后果

- 减少从零设计列表/详情/命令面板的工作量，观感有可对照的实现。
- 需要一次性的移植与改造工作（Next → Vite、mock → bd store），已拆进 `shell` / `list` / `detail` / `board` 任务。
- 引入 MIT 署名义务：`NOTICE` 文件随仓库分发。
- 不增加运行时依赖体积：shadcn 组件是源码；是否引入 `cmdk`、`dnd-kit`、`virtual` 已在 spec 中限定。

## 被拒绝的备选

- **整仓 fork Circle**：数据层、路由、多租户模型都与本项目无关，改造成本高于按组件移植。
- **使用 Plane/Huly 作为底座**：许可证不兼容 MIT 分发。
- **纯手写 + 截图对照**：正是本 ADR 要避免的路径。
- **购买/使用 Square UI Pro**：不在开源许可内，且与 MIT 分发冲突。