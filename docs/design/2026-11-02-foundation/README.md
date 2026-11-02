# 设计基座（2026-11-02）

状态：bza-ryr.49.1 落地记录。截图由 `node scripts/capture-ui.mjs` 生成，产物在同目录。

## 依赖选择

按讨论选「轻量基线」：只新增 `class-variance-authority` 与 `lucide-react`，**不引入 Radix**。

- 下拉选择器用原生 `<select>` 包一层 token 样式：系统绘制弹层，键盘、触屏、读屏天然正确。
- 菜单与工具提示是仓库内 ~100 行的小组件，复用既有覆盖层/焦点约定，行为由 `menu.test.tsx` / `tooltip.test.tsx` 覆盖。
- 首屏从 130.3 KB 增至 142.5 KB gzip（预算 150），主要来自图标与新增组件代码。

## tokens

`src/styles/tokens.css` 在原有颜色之外补齐：

| 类别 | 变量 |
|---|---|
| 控件密度 | `--control-xs/sm/md`（22/26/30px）、`--row-height` 36px |
| 交互面 | `--hover`、`--selected`、`--selected-foreground`、`--border-subtle`、`--border-strong` |
| 字号 | `--text-2xs` 11px … `--text-2xl` 22px（`--ui-font` 13 / `--doc-font` 15 仍是锚点） |
| 圆角 | `--radius-sm/md/lg`（6/8/10px） |
| 阴影 | `--shadow-xs/sm/md/popover` |

全部经 `@theme inline` 暴露为 Tailwind 工具类（`bg-hover`、`h-control-sm`、`rounded-md`、`shadow-popover` …），页面不再手写边框与背景色值。

## primitives

`src/components/ui/`：Button（6 变体 × 4 尺寸）、IconButton、Input、Textarea、Select、Badge、Avatar、Menu、Tooltip、StatusIcon、PriorityIcon。

`StatusIcon` 用 lucide 的圆形系列表达七种状态，未知状态回退到空心圆；`PriorityIcon` 是三条升序横杠，P0 用 destructive 色整体强调。

## 屏幕接入

- **Shell**：侧栏改成 36px 行高、`bg-selected` 当前项、折叠时悬停出提示；顶栏用 Select + ghost Button + IconButton，刷新是图标按钮；底栏保持单按钮结构（诊断面板入口）。
- **List**：筛选栏控件换成 Input/Select/Button；行内状态用 StatusIcon、优先级用 PriorityIcon + 数字、标签用 Badge；悬停/聚焦改用 `--hover/--selected`。
- **Detail**：标题区、编辑器操作、元数据栏全部换用 primitives；只读态也显示状态/优先级图标。

## 验证

- 449 单测、30 条 E2E 通过；axe 四个路由 + 两个覆盖层 + 详情页无 serious/critical（其中一处 `kbd` 4.43:1 已修）。
- 首屏 142.5 KB gzip；`check:bundle` 通过。
- 截图：`list-light.png`、`list-dark.png`、`detail-light.png`、`detail-dark.png`。

## 已知欠账

- 搜索框在 `pressSequentially` 快速输入下仍偶发丢字符（bza-ryr.51）。已把输入改为本地草稿驱动，失败率下降但仍未归零。
- 逐屏像素级打磨、hover/active 动效与截图基线对比属于 .49.2–.49.6。