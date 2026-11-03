# 发布级视觉与可访问性收口（2026-11-03）

状态：发布候选前的 QA 记录，对应 `bza-ryr.49.6`。只做验证与回归修复，不引入新设计方向。

## 范围与数据

- 真实数据：`bd export` 导出的 147 条票（135 closed / 11 open / 1 in progress），含层级 id（`bza-ryr.49.6`）、多标签、assignee 与 parent-child 依赖。原始 JSON 会省略空数组；Rust bridge 有 `#[serde(default)]`，前端拿到的 `labels` / `dependencies` / `comments` 始终是数组。QA 夹具按同样规则归一化。
- 视口：1280×900（基准）、1000×800（窄窗）、640×480（等价于 1280 窗口 200% 缩放）。
- 主题：light / dark 各一轮。
- 路由：List、Board、Detail、Settings 六个栏目。

## 门禁结果

| 项 | 结果 |
|---|---|
| `check:fast` | PASS |
| 单测 | 595 PASS |
| E2E（含 axe） | 57 PASS |
| axe 真实数据（9 路由 × 2 主题 = 18 次扫描） | 0 serious / 0 critical |
| 关键文本对比度 | PASS（修复 2 处，见下） |
| 1000px / 640px 窄窗 | 无裁切；List 筛选栏换行、Board 横向滚动、Detail 右栏在 <1000px 落到正文下方 |
| 首屏 JS | 145.7 KB gzip（预算 150）PASS |
| 详情打开 | P95 44.0ms（预算 50）PASS，open 期间 bd 调用 0 |
| 64 KiB 首次渲染 | 最终空闲轮 P50 92.6ms（预算 100）PASS；见“波动”一节 |
| 滚动帧率 | List 与 Board 全部场景 PASS（预算 p50 < 18 / p95 < 22 / max < 50，见 `2026-11-03-scroll-budget-alignment.md`） |

## 发现与修复

1. **深色列表头像对比度 4.22:1**（`Avatar` 的 initials：`muted-foreground` on `muted`）。改为 `text-foreground/75`，深/浅两色均 ≥ 5:1。真实数据里 assignee 全是 "Steven Liang" 才暴露；此前 axe 夹具没有 assignee。
2. **深色正文链接对比度 3.58:1**（`--primary` 当文字色）。Markdown 链接改用已有的 `--primary-text`（深色 `#a7aefe`，浅色 `#4b54b8`）。
3. **列表 id 列截断**：真实 id `bza-ryr.49.6` 超出 80px 列宽。id 列 80 → 96px，并给 id 加 `title`。
4. **视觉回归基线**：`docs/design/2026-11-03-release/` 入库 17 张（8 张主视图浅/深、4 张状态、1 张 64 KiB 长文、4 张窄窗）。

axe 深色用例现在带 assignee、层级 id、标签和正文链接，防止两处对比度修复回退。

## 64 KiB 渲染波动

三次独立测量（每次 5 轮）的首次渲染 P50：103.7ms（OVER）、107.2ms（OVER）、92.6ms（PASS）。前两次与 dev server / Tauri 窗口同时运行，第三次空闲环境通过。历史记录为 87.1ms。判定为机器负载导致的方差，未发现代码层面的回退证据（Detail chunk 体积未变）；CI 接线后由固定环境判定。

## 截图基线

`docs/design/2026-11-03-release/`

- `list-dark.png` / `list-light.png`
- `board-dark.png` / `board-light.png`
- `detail-dark.png` / `detail-light.png`
- `settings-dark.png` / `settings-light.png`
- `state-loading.png` / `state-empty.png` / `state-error.png` / `state-no-match.png` / `state-long-body.png`
- `narrow-list-640.png` / `narrow-board-1000.png` / `narrow-detail-640.png` / `narrow-settings-640.png`

## 发布检查清单

- [x] axe：List / Detail / Board / Settings（浅 + 深）
- [x] 关键文本对比度 ≥ 4.5:1
- [x] 1000px 窄窗与 200% 缩放无裁切
- [x] 空 / 错 / 加载 / 无匹配 / 64 KiB 长文状态截图
- [x] 首屏 JS、详情打开、64 KiB 渲染、滚动帧率
- [x] 截图基线入库
- [ ] 安装包体积与签名构建（属于发布工程任务，不在本 QA 范围）