# 滚动预算对齐与阻塞卡场景（2026-11-03）

状态：测量记录，回应 `bza-x8a` 的「measure:scroll 预算与 60fps 说法对齐；1000 卡 fixture 加入阻塞卡」。不改产品行为。

## 背景

原脚本的注释用 60Hz（16.7ms/帧）解释 p50，但门禁是 `p50 < 20ms、p95 < 24ms、max < 50ms`，两者口径不一致；fixture 也没有 `status = blocked` 的卡片，阻塞 chip 这一“每卡最重”的分支从未进入滚动测量。

## 变更

- 预算收紧为 `p50 < 18ms、p95 < 22ms、max < 50ms`，与 60Hz 帧预算对齐；p95 允许一帧余量，max 吸收单次 GC/编译停顿。
- 1000 条 fixture 每 11 条出一条 `blocked`（约 91 张），其中一半带真实依赖（`depends_on_id = bza-1`），同时覆盖手动阻塞和依赖阻塞两种 chip。
- 看板新增 `board-blocked` 场景，专门滚阻塞列（每卡多一行 chip，DOM 最重）。

## 结果（生产构建，1000 条，`--runs=3`）

列表：

| 场景 | p50 中位 | p95 中位 | 最大帧 |
|---|---|---|---|
| steady 48px/帧 | 16.7ms | 18.5ms | 36.8ms |
| fling 240px/帧 | 16.8ms | 20.0ms | 29.0ms |
| grouped 48px/帧 | 16.6ms | 18.3ms | 19.5ms |

看板（`--view=board`）：

| 场景 | p50 中位 | p95 中位 | 最大帧 |
|---|---|---|---|
| board-steady（Ready） | 16.9ms | 19.6ms | 21.0ms |
| board-fling（Ready） | 16.7ms | 19.1ms | 32.9ms |
| board-blocked（Blocked） | 17.0ms | 19.0ms | 30.9ms |

均通过新门禁；p50 距 18ms 预算约 1.3ms，p95 距 22ms 约 2.0ms。

## 结论

- 阻塞 chip 没有把滚动拖出帧预算：blocked 列与 Ready 列同量级。
- 原预算确实比 60fps 口径宽；收紧后仍有约 7% 的 p50 余量，不需要改产品代码。
- `CONSTRAINTS.md` 的滚动一行已改为「60fps 目标：p50 < 18ms、p95 < 22ms、max < 50ms」。