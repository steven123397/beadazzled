# 详情导航与长文预算初测（2026-11-02）

状态：bza-mxv 记录，不改变预算阈值。
对应预算：[CONSTRAINTS.md](../../CONSTRAINTS.md) 详情页切换 ≤50ms；`SPEC-detail` 64 KiB Markdown 首次渲染 ≤100ms。

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
3. 打开样本：点击行 → 详情 `h1` 出现后下一帧，5 次/run。
4. 长文样本：每 run 先打开一次长文票作为进程/JIT 预热（记为 cold），随后再打开 3 次并计入 warm 统计。
5. 长文渲染完成的判据是正文末尾的 `64KIB-SENTINEL` 出现在 `.markdown-body` 中，确保整棵 Markdown 树已渲染。
6. 预算判定：打开取 P95（≤50ms），长文取 P50（≤100ms）；同时报告 P95/max 与首次打开值。
7. 打开详情期间 `__invokeLog` 必须为空（零 bd 调用），否则进程退出码为 1。

## 结果

```
run 1: open 27.5, 27.1, 31.2, 32.2, 27.2ms; 64 KiB cold 58.7ms, warm 80.1, 50.1, 44.2ms
run 2: open 29.4, 30.7, 31.2, 29.6, 30.8ms; 64 KiB cold 66.7ms, warm 48.1, 47.3, 46.6ms
run 3: open 27.5, 31.2, 29.0, 26.8, 29.7ms; 64 KiB cold 139.1ms, warm 46.6, 48.5, 67.6ms
run 4: open 27.4, 32.0, 29.9, 31.1, 29.4ms; 64 KiB cold 87.9ms, warm 73.3, 64.2, 69.8ms
run 5: open 27.9, 28.7, 27.7, 30.0, 30.8ms; 64 KiB cold 92.4ms, warm 96.0, 78.3, 66.3ms
```

| 指标 | n | P50 | P95 | max | 预算 | 结论 |
|---|---:|---:|---:|---:|---:|---|
| 打开详情 | 25 | 29.6ms | **32.0ms** | 32.2ms | 50ms（P95） | PASS |
| 64 KiB 正文（warm） | 15 | **64.2ms** | 96.0ms | 96.0ms | 100ms（P50） | PASS |
| 64 KiB 正文（进程内首次） | 5 | 87.9ms | — | 139.1ms | 100ms（参考） | 边界 |

打开详情的 bd 调用：**0**。

## 解释

- 首次打开的长文样本包含 V8 对 Markdown 管道的 JIT 预热，波动较大（58.7–139.1ms）；预热后的初始挂载 P50 为 64.2ms。两个统计口径都保留在脚本输出里，不隐藏首次成本。
- 长文 P95 仍会因 GC/帧对齐偶尔接近 100ms（本次 96.0ms），因此预算按 P50 判定并同时报告 P95/max；CONSTRAINTS 中该项为 warn 级。
- 详情路由仍为懒加载 chunk（约 57 KB gzip），首屏 JS 保持在 150 KB 预算内。