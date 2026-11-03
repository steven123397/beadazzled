# List 视觉打磨（2026-11-03）

状态：bza-ryr.49.2 落地记录。截图由
`node scripts/capture-ui.mjs --out=docs/design/2026-11-03-list` 生成，包含 List 的
默认、hover、focus、分组、1024 窄窗、侧栏收起、打开的下拉，以及 Board /
Settings / Detail 在同一个 shell 卡片下的回归图。

## 布局

- Shell 主栏是 10px 圆角的独立卡片：`bg-card` + `border` + `shadow-xs`，与侧栏
  留 8px 间隙；侧栏收起时宽度过渡到 0，主卡片向左延展占满，顶栏左侧的按钮负责
  展开。List / Detail / Board / Settings 共用。
- List 行高 42px，行卡片左右只留 4px、上下 **没有间隙**，相邻行贴在一起；默认透明
  无边框，hover 用 `--hover`，focus/选中用 `--selected` 加左侧 2px `--primary`
  强调条。行宽已经贴近面板边缘；再宽于 1.2 倍需要收窄侧栏或加宽窗口。
- 分组头是 30px 圆角条，和上下行留 4px 间隙；带状态/优先级图标、折叠 chevron
  和计数。

## 配色与字号

- 浅色层次拉开：侧栏/顶栏/状态栏用 `--background #f1f0f2`，主卡片用
  `--card #fbfbfc`；`--muted`、`--hover`、`--selected`、边框同步加深。
  `--muted-foreground` 调到 `#67666e`、`--warning` 调到 `#8a5a00`，保证深灰底上
  仍有 4.5:1 对比度。
- 全局小字号整体抬高：`--text-2xs` 11→12、`--text-xs` 12→13。List 行内仍是
  13/14，标签和时间钉在 12px，所以其他页面整体抬到 List 的基准，List 本身不再
  变大。
- 搜索框改用 Input 的 `controlSize="md"`（32px），和筛选按钮、反向按钮同高。

## 行内信息

- 行内基础字号 13px，标题 14px / 500；状态和优先级只留 16px 图标，文字进
  `aria-label` 和 `title`，分组头里仍显示状态名。
- assignee 用 Avatar 首字母 + 名字；未分配用虚线圆 + 斜体文案。
- 标签列 144px（`lg`）/ 160px（`xl`），最多 2 个 + `+N`；`truncate` 放在 Badge
  内部的文本节点上，超长时显示省略号，Badge 的 `title` 给出完整标签。
- 类型列只在同屏出现多种类型时显示；更新时间 12px。
- 不设列头：Linear 和 Scotty 的参考列表都没有列头，靠固定列宽和分组头对齐。

## 筛选栏

- 控件 32px 高、13px 字，搜索框同高；分三组：搜索 + 五个筛选；Ready；
  分组/排序/反向。组间距 12px，组内 6px。
- 分组和排序从原生 `<select>` 换成 `src/components/ui/popover-select.tsx`；顶栏
  workspace 也改用同一个组件。弹层统一 8px 圆角、13px 选项、16px 控件，鼠标点击
  不再出现蓝色描边，键盘焦点才走共享焦点环。
- 弹层与列表使用 `.thin-scrollbar`：8px 圆角滑块，替代 Windows 默认宽滚动条。
- 1280 下单行；1024 下因控件放大和组间距会折成两行，这是当前取舍。

## 验证

- 591 单测、52 条 E2E 通过（含 axe；无 serious/critical）。
- 首屏 145.0 KB gzip，预算 150 KB。
- 截图矩阵：`list-light/dark`、`list-grouped-light/dark`、`list-hover-light`、
  `list-focus-light`、`list-narrow-light`、`list-collapsed-light`、
  `list-assignee-open-light`、`list-sort-open-light`、`list-workspace-open-light`、
  `detail-light/dark`、`board-light/dark`、`settings-light`。

## 后续

- 虚拟列表的 sticky 分组头留给 49.5。
- Settings 页仍有一批原生 `<select>`（语言、主题等），统一交给
  `bza-ryr.49.7`；Detail 的 MetadataRail 原生 select 记在 `bza-ryr.49.3`。
- 1024 下筛选栏的两行布局如果不可接受，可以再收窄搜索框或在窄窗隐藏次要筛选。
- Board / Settings / Detail 本轮只验证 shell 卡片没有破版，逐屏像素打磨按
  49.3 / 49.4 继续。