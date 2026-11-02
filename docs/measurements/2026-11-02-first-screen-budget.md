# 首屏成本归因与 bundle 预算（2026-11-02）

状态：实验记录，回答「热启动超预算里有多少是我们自己的前端」。不改预算阈值。

关联：`bza-btl.4`（热启动 P95 超 800ms）、`CONSTRAINTS.md` 的「首屏 JS」预算、
[2026-11-01 启动测量](2026-11-01-startup.md)。

## 问题

热启动 P95 连续四轮超 800ms（801–965ms），但 P50 稳定在 651–661ms。在决定
「优化前端」还是「重设预算」之前，需要知道：这些时间里有多少是 WebView2 与进程
启动的固定成本，有多少是我们自己的 JS。

## 方法

1. 用同一份 Rust 代码构建两个 release 二进制：
   - **空壳**：`tauri build --config '{"build":{"beforeBuildCommand":"","frontendDist":"<空目录>"}}'`，
     `index.html` 只有 `<div id="root">`，没有任何 JS。
   - **真实**：正常的 `npm run build` + `tauri build --no-bundle`。
2. 两个二进制各跑 20 次预热后的热启动（复用同一个已预热的 WebView2 profile），
   每次之间杀掉进程树并清理 WebView2 子进程。
3. 关键改动：**交错**执行 A/B（每个样本轮流切换二进制，顺序每对翻转），
   而不是先跑完 A 再跑 B——否则轮间漂移会直接混进差值。
4. 对照实验：把两侧都指向同一个真实二进制，测出这套方法自身的噪声底。

测量探针不变：`on_page_load` → WebView2 `NavigationCompleted`（页面加载完成）。

## 结果

交错 A/B（24 对，同一 profile）：

| 变体 | n | P50 | P95 | min | max |
|---|---:|---:|---:|---:|---:|
| 空壳（无 JS） | 24 | 456ms | 503ms | 426ms | 514ms |
| 真实应用 | 24 | 459ms | 540ms | 429ms | 574ms |
| **差值** | | **+3ms** | **+37ms** | +3ms | +60ms |

对照（两侧都是真实二进制，24 对）：

| 侧 | n | P50 | P95 |
|---|---:|---:|---:|
| A | 24 | 458ms | 518ms |
| B | 24 | 464ms | 537ms |
| **噪声底** | | **±6ms** | **±19ms** |

同一二进制用仓库脚本（背靠背、非交错）warm-only 测两次：P50 625ms / 536ms，
P95 867ms / 879ms，且样本呈现**周期性慢值**（891、852、879、807、865、732…，
约每 3–4 次出现一次）。

## 结论

1. **前端成本很小，且在 P50 上落在噪声内**（+3ms，噪声 ±6ms）；P95 上约
   +20–40ms。整份 355KB/110KB gzip 的 JS 不是热启动超预算的原因。
2. **固定成本才是主体**：空壳自己就要 ~456ms（P50），约合 800ms 预算的 57%。
3. **仓库脚本的绝对值被测量节奏污染**：同一个二进制，背靠背循环测出 536–625ms，
   交错后只有 ~460ms；慢样本以约 3–4 次为周期出现。也就是说，之前记录的
   651–661ms P50 / 800–965ms P95 里，有一部分是测量方法造成的，不是应用变慢。
   这是测量工具的问题，已单独开 bead 跟踪，不在本次改动里修。
4. 因此**不据此调整 `.4` 的预算**：先修脚本节奏，再用同一口径重测，才有资格
   谈「优化」还是「重设阈值」。`bza-btl.4` 保持 open，例外条目继续有效。

## 首屏 bundle 预算

即便当前成本很小，预算仍然值得立：启动时间随首屏需要下载、解析、执行的字节数
增长，而未来的 List / Board / Detail 分别会带来虚拟滚动、拖拽、Markdown 渲染，
一旦被静态 import 进 shell，这些就全部落进首屏。

- 口径：`dist/index.html` 里的 `<script src>` 与 `<link rel="modulepreload">`，
  按 gzip -6 累加。路由懒加载的 chunk 不计入——这正是「不要往首屏塞东西」的护栏。
- 预算：**≤ 150 KB gzip**，确定性检查，失败即 block（`CONSTRAINTS.md`）。
- 当前值：**109.5 KB gzip**（单 chunk），余量约 27%。
- 实现：`scripts/check-bundle-budget.mjs`，由 `npm run check:bundle` 调用，
  `check:size` 与 CI 的 `Bundle checks` 步骤都会跑它。

## 复现

```bash
# 空壳对照（构建产物在临时目录，不污染 dist）
mkdir -p /tmp/empty && printf '<!doctype html><html><body><div id="root"></div></body></html>' > /tmp/empty/index.html
npx tauri build --no-bundle --config '{"build":{"beforeBuildCommand":"","frontendDist":"/tmp/empty"}}'
cp src-tauri/target/release/beadazzled.exe /tmp/beadazzled-empty.exe
npm run build && npm run build:app -- --no-bundle

# 首屏预算
npm run check:bundle
```

注意：空壳二进制会被 `measure:startup` 的新鲜度检查判为 `stale`——它引用的是
仓库外的 `frontendDist`，而 `dist/` 在它之后又被重建过。这个提示在该场景下是
误报，不影响样本。