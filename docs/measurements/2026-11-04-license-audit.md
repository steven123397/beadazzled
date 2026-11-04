# 第三方与许可证审查（2026-11-04）

状态：`bza-d9q` 落地记录，v0.1.0 发布前的 NOTICE 与许可证审计。

## 范围

1. 移植来源：Circle、Scotty、Cuelark（以及 shadcn/ui 的组件约定）是否进入仓库，进入的部分是否在 `NOTICE` 有记录。
2. 参考代码卫生：`src/` 中是否存在 `next/*`、`nuqs`、`mock-data` 导入。
3. 许可证红线：仓库与依赖中是否存在 AGPL、EPL、Elastic License 2.0、CC BY-NC 的代码。

## 方法

- **共享代码扫描**：把 `src/` 与 `.upstream/{circle,beads-ui,beady-eye,b9s,perles}` 的 TS/TSX 按空白归一化，取 5 行窗口做交集；Scotty（`D:\apps\bead-me-up-scotty`）单独按 `lib/schema.ts`、`lib/beads-view.ts` 的领域定义人工比对。
- **边界脚本**：`npm run check:boundaries`（也会匹配源码中的禁用许可证字样）。
- **npm**：遍历 `node_modules`，读取每个有 `name` 的包的 `license` / `licenses` 字段。
- **Cargo**：`cargo metadata --manifest-path src-tauri/Cargo.toml --format-version 1`，读取全部解析到的 crate 的 `license` 字段。

## 结果

### 移植来源

| 来源 | 进入仓库的形式 | NOTICE |
|---|---|---|
| Circle `b0ba7dd`（MIT） | 仅作视觉/结构参考；共享代码扫描无匹配块 | 已记录 |
| Scotty v0.4.0 `cf6dda1`（MIT） | 状态集合、依赖类型与阻塞语义（重写实现） | 已记录到具体文件 |
| Cuelark UI Linear 主题（MIT） | `src/styles/tokens.css` 的初始 CSS 变量值 | 已记录 |
| shadcn/ui（MIT） | `components.json` 与组件布局约定；`src/components/ui` 为自写实现 | 已记录 |

未发现逐字复制的 Circle / Scotty 源码。`src/components/ui` 的 primitive 均为本项目实现（无 Radix 依赖），因此按“约定来源”记录，而不是按复制来源。

### 参考代码卫生

- `npm run check:boundaries`：`clean (277 files scanned)`。
- `src/` 中无 `next/*`、`nuqs`、`mock-data` 导入。唯一出现这些字符串的地方是 `tests/quality/check-boundaries.node-test.mjs` 的负例夹具，用于验证脚本能抓到违规。

### 依赖许可证

| 生态 | 包/ crate 数 | 结果 |
|---|---|---|
| npm | 369 | 全部声明许可证；AGPL/EPL/Elv2/CC-BY-NC 0 个 |
| Cargo | 456 | 全部声明许可证；AGPL/EPL/Elv2/CC-BY-NC 0 个 |

npm 分布：MIT 310、Apache-2.0 21、ISC 10、BSD-2-Clause 8、MPL-2.0 6、Apache-2.0 OR MIT 3、BSD-3-Clause 3、MIT-0 2、MIT OR Apache-2.0 2、BlueOak-1.0.0 2、CC0-1.0 1、0BSD 1。

Cargo 中最常见的组合是 `MIT OR Apache-2.0` 一类双许可。`r-efi` 声明 `MIT OR Apache-2.0 OR LGPL-2.1-or-later`，本项目选择 MIT 分支；它不进入 Windows 产物。

## 结论

- `NOTICE` 已入库，覆盖所有被借鉴/移植的来源与直接依赖。
- 仓库与依赖中不存在四类红线许可证的代码。
- 两项已知边界：
  - `check-boundaries` 是文本扫描，不能证明任意非典型写法；来源判断仍需 review。
  - `cargo metadata` 解析所有目标平台（含非 Windows 依赖）；Windows 产物使用的 crate 是其中一个子集。