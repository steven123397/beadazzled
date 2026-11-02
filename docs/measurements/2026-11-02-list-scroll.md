# List 滚动帧率（2026-11-02）

状态：验收记录，回答 Checkpoint 4 的「1000 条滚动 60fps」。不改预算阈值。

关联：`bza-jdx`（Checkpoint 4）、[SPEC-list](../spec/SPEC-list.md) 验收标准 1、
`bza-bee`（测量脚本与 CI 接线）、`CONSTRAINTS.md` 的「列表滚动」。

## 问题

Checkpoint 4 需要 1000 条票据下滚动稳定 60fps。仓库里原有的 E2E 断言直接对
Vite dev server 计时，在这台机器上出现两种结果：p50 稳定在 16.6–16.9ms，但
p95 在 18–40ms 之间波动，单次最长帧到 79ms，同一份代码有时通过、有时失败。

需要分清：是产品本身掉帧，还是 dev 构建与测量环境的问题。

## 方法

1. 用 `VITE_E2E=1 npm run build` 生成**生产构建**，把 Playwright 的数据 seam
   编进去；默认 `npm run build` 仍然会 tree-shake 掉它（`check:bundle-seam`
   会验证这一点）。
2. `vite preview` 提供静态产物，Chromium 打开 `#/w/p1/list`，注入 1000 条固定
   票据。
3. 每轮连续滚动 120 帧、每帧 48px（约 1.3 行/帧，2 秒），记录相邻
   `requestAnimationFrame` 的时间差；跑 5 轮取中位数。
4. 预算沿用原 E2E 断言的数值：p50 < 20ms、p95 < 24ms、max < 50ms。

命令：`npm run measure:scroll`（`scripts/measure-scroll.mjs`）。

环境：Windows 11、i5-13500H、平衡电源计划；测量时浏览器与其他应用同时运行。

## 结果

生产构建，5 轮：

| run | p50 | p95 | max |
|---:|---:|---:|---:|
| 1 | 16.6ms | 18.9ms | 19.5ms |
| 2 | 16.7ms | 18.6ms | 19.6ms |
| 3 | 16.6ms | 18.1ms | 24.4ms |
| 4 | 16.6ms | 18.5ms | 24.4ms |
| 5 | 16.8ms | 18.6ms | 21.1ms |
| **中位数** | **16.6ms** | **18.6ms** | **21.1ms** |

对照：同一测量跑在 dev server（React development build）上时，p50 仍是
16.6–16.9ms，但 p95 为 22–40ms、max 到 79ms，且随宿主负载明显漂移。

## 结论

1. **生产构建达标**：中位帧 16.6ms 是满帧 60Hz，p95 18.6ms 只比满帧多 2ms，
   最长帧 21–24ms；没有持续掉帧。
2. **dev server 不能作为 60fps 证据**：同一份代码在 React development build
   下挂载行的成本接近翻倍，p95 会被推到预算边缘。原 E2E 断言因此从
   `tests/e2e/list.spec.ts` 移到 `npm run measure:scroll`，阈值不变，测量对象
   改为真正发布的产物。
3. **CI 接线仍归 `bza-bee`**：本脚本目前只本地运行；`CONSTRAINTS.md` 中该项目
   的「待接线」状态不变。
4. 环境噪声仍在：测量机上同时运行浏览器与其他应用。本次 5 轮的中位数和最大值
   都远离预算，说明结论不依赖某一轮的偶然值。