# 测量记录

本目录只放**当前仍然有效**的性能与质量测量，以及发布物的构建/审计记录。
已关闭工单的验收快照移到 [`archive/`](archive/)，保留原文但不再更新。

命名：`YYYY-MM-DD-<主题>.md`。同一指标重新测量时新增日期文件，并在新文件里
说明它替代了哪一份；不要改写旧数字。

## 当前基线

| 文档 | 记录什么 | 对应预算 / 依据 |
|---|---|---|
| [2026-11-01-startup.md](2026-11-01-startup.md) | 冷启动、热启动；含 2026-11-04 的测量节奏修复与三轮复测 | CONSTRAINTS 冷启动 ≤2.0s、热启动 ≤800ms |
| [2026-11-02-navigation.md](2026-11-02-navigation.md) | 详情打开、64 KiB 长文首渲染 | CONSTRAINTS 详情页切换 ≤50ms |
| [2026-11-02-list-scroll.md](2026-11-02-list-scroll.md) | List 1000 条滚动帧率 | CONSTRAINTS 滚动 p50/p95/max |
| [2026-11-02-board-scroll.md](2026-11-02-board-scroll.md) | Board 1000 卡滚动帧率 | 同上 |
| [2026-11-03-scroll-budget-alignment.md](2026-11-03-scroll-budget-alignment.md) | 滚动判定口径与阻塞卡场景 | 同上 |
| [2026-11-02-first-screen-budget.md](2026-11-02-first-screen-budget.md) | 首屏 150 KB 预算的成本归因 | CONSTRAINTS 首屏 JS ≤150 KB gzip |
| [2026-11-04-memory.md](2026-11-04-memory.md) | WebView2 进程树工作集、数据增量 | ADR-0011 内存预算 |
| [2026-11-04-release-build.md](2026-11-04-release-build.md) | v0.1.0 构建、签名、产物与校验输出 | 发布证据 |
| [2026-11-04-license-audit.md](2026-11-04-license-audit.md) | 第三方来源与依赖许可证审计 | NOTICE |

`assets/` 存放上述记录引用的截图。

## 归档

`archive/` 里是已关闭工单的验收矩阵与检查点快照（Board、Settings、Checkpoint 7、
发布级视觉收口）。它们回答的是“当时这批验收通过了吗”，不再是当前基线；
需要追溯交付证据时再查。