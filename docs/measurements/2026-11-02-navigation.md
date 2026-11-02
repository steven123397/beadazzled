# 详情导航与长文预算测量（2026-11-02）

状态：bza-mxv 初测，bza-ryr.50.5 统一判定口径后重测；不改变任何阈值。
对应预算：[CONSTRAINTS.md](../../CONSTRAINTS.md) 详情页切换 ≤50ms（P95）；`SPEC-detail` AC10 64 KiB 首次渲染 ≤100ms（P50）。

## 环境

| 项 | 值 |
|---|---|
| 系统 | Windows 11 Home China 10.0.26300 |
| 浏览器 | Playwright Chromium（本机安装） |
| 构建 | `vite build` 生产包，`dist-e2e`，React 生产模式 |
| 数据 | 1000 条票；长文票 64 KiB（正文为主，含标题、少量列表、表格与代码块） |
| 测量时间 | 2026-11-02（本地） |

## 方法

`npm run measure:navigation -- --runs=5`

1. 生产构建（`VITE_E2E=1` 只为注入数据，不改变渲染代码），`vite preview` 提供静态文件。
2. 每个 run 使用新页面；先打开一条普通票预热详情路由 chunk，再清空 `__invokeLog`。
3. 打开样本：点击行 → 详情 `h1` 出现后下一帧，5 次/run，取 P95 判定 ≤50ms。
4. 长文样本分两个口径，输出里分别标注：
   - **first render（AC10）**：每个新页面里第一次打开长文票，包含 V8 对该渲染管道的首次编译；
   - **steady state（参考）**：随后再打开 3 次，代表预热后的渲染成本。
5. 长文渲染完成的判据是正文末尾的 `64KIB-SENTINEL` 出现在 `.markdown-body` 中，确保整棵 Markdown 树已渲染。
6. AC10 的 ≤100ms 只判定 first render 的 P50；steady state 用同一数值作为参考一并报告，不参与 AC10 判定。
7. 打开详情期间 `__invokeLog` 必须为空（零 bd 调用），否则进程退出码为 1；超预算是 warn 级，只打印 OVER。

## 结果

```
run 1: open 27.8, 31.5, 31.9, 29.4, 29.1ms; 64 KiB first 78.1ms, steady 64.9, 47.7, 48.0ms
run 2: open 29.0, 34.4, 38.8, 31.2, 32.5ms; 64 KiB first 82.9ms, steady 49.7, 50.1, 61.0ms
run 3: open 30.3, 30.9, 31.7, 30.3, 32.5ms; 64 KiB first 76.6ms, steady 53.1, 51.3, 49.0ms
run 4: open 30.3, 31.8, 31.2, 32.4, 18.6ms; 64 KiB first 57.4ms, steady 65.0, 66.1, 56.7ms
run 5: open 30.3, 32.5, 31.7, 31.9, 31.7ms; 64 KiB first 131.7ms, steady 47.9, 52.9, 47.7ms
```

| 指标 | n | P50 | P95 | max | 预算 | 结论 |
|---|---:|---:|---:|---:|---:|---|
| 打开详情 | 25 | 31.5ms | **34.4ms** | 38.8ms | 50ms（P95） | PASS |
| 64 KiB 首次渲染（AC10） | 5 | **78.1ms** | 131.7ms | 131.7ms | 100ms（P50） | PASS |
| 64 KiB 稳态（参考） | 15 | **51.3ms** | 66.1ms | 66.1ms | 100ms（P50，参考） | PASS |

打开详情的 bd 调用：**0**。

## 解释

- first render 的波动来自 V8 对 Markdown 管道的首次编译：本次 5 个样本落在 57.4–131.7ms，其中一个超过 100ms。判定按 AC10 的 P50（78.1ms）执行，P95/max 原样报告，不隐藏单次超预算。
- 稳态 P50 51.3ms、P95 66.1ms，说明同一长文在预热后稳定落在预算内；该口径不作为 AC10 的证据。
- `tests/e2e/detail.spec.ts` 跑在 Vite dev server 上，只断言「打开详情能渲染且零 bd 调用」；50ms 与 100ms 都只由本脚本在生产包上判定。
- 任务列表复选框补了 `aria-label`（axe 的 “form elements must have labels”），对渲染耗时没有可测影响。
- 详情路由仍为懒加载 chunk（约 57 KB gzip），首屏 JS 保持在 150 KB 预算内。