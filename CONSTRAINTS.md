# CONSTRAINTS

本文件是本仓库的质量契约。agent 与人都必须遵守；**任何一条不得为了让某个变更通过而被弱化**。
修改阈值、预算或删减检查，只能通过一份 ADR + 本文件同步更新。

状态：2026-10-31 建立。项目尚无代码，标记为「待接线」的检查属于已知欠账，见 Exceptions。

## Floor（不可协商，无数字）

- **不新增 suppression 换绿灯**：`@ts-ignore`、`eslint-disable`、`#[allow]`、关闭规则等，除非同一行写明理由并在 review 中被接受。为通过检查而加的 suppression 一律拒绝。
- **不跳过、不删除测试**：主分支不允许 `.skip` / `xit` / `it.only` 残留。删测试必须说明替代覆盖在哪里。
- **不留未实现 stub**：能编译不等于功能存在。`todo!()`、`throw new Error("not implemented")` 不得进入主分支。
- **不提交 secrets**：示例配置写占位符，真实 key 只走环境变量。
- **票数据只能经 `bd` 命令获取**：`bd export` / `bd events` / `bd show` / 写命令。禁止打开或解析 `.beads/embeddeddolt/` 下任何文件。允许读取 `.beads/attachments/` 等文档化附件，但不得据此推断票状态。
- **交互路径上不调用 `bd`**：启动基线与显式刷新除外。实测单次调用 1.0–1.4s，一次就击穿体验。
- **检查失败不许静默降级**：失败要么修，要么登记进 Exceptions。参照 bv 的反面教材（导出失败静默退回空数据）。
- **不监听 `.beads/` 递归目录**：embedded Dolt 每次调用都会重写 `noms/`，连只读命令也算，递归监听会自激。变更信号默认走 events journal。

## 强制数值

失败处理遵循：**确定性 → block；测量性 → warn**（见 Exceptions 中的转正期限）。

`.beads/config.yaml` 必须保持 secret-free：`check:secrets` 会解析 active YAML 键，出现 `token` / `api_key` / `password` / `secret` / `credential` 后缀即失败；集成密钥只走环境变量（`GITHUB_TOKEN` / `LINEAR_API_KEY` 等），禁止 `bd config set --force-git-tracked`。见 [ADR-0006](docs/adr/0006-beads-config-secret-hygiene.md)。

| 维度 | 预算 | 命令 | 阶段 | 失败 | 理由 | 状态 |
|---|---|---|---|---|---|---|
| secrets | 0 | `npm run check:secrets`（配置键检查 + gitleaks） | 编辑循环 | block | 仓库公开、安装包对外分发 | 可运行 |
| 类型 | 0 error | `npm run typecheck` | 编辑循环 | block | 无噪声、秒级 | 可运行 |
| lint | 0 error | `npm run lint` | 编辑循环 | block | 同上 | 可运行 |
| 格式 | 0 漂移 | `npm run format:check`（Prettier，`endOfLine=auto`） | CI | block | Windows CRLF 工作区与 CI 结果须可重复，见 [ADR-0013](docs/adr/0013-prettier-eol-auto-and-ci-format-gate.md) | 可运行 |
| 架构边界 | 0 违规 | `npm run check:boundaries` | 交还前 | block | 防止绕开 bd 桥直读 Dolt | 可运行 |
| 版本一致 | 3 处一致 | `npm run check:versions` | 编辑循环 | block | 安装包、Cargo 包与更新器必须看到同一个版本 | 可运行 |
| bridge 行覆盖 | ≥ 80% | `npm run test:rust:coverage` | 交还前 | block | 只有会真坏的那层值得设门槛 | 可运行（bridge 落地后生效） |
| 关键 E2E | 3 条全绿 | `npm run e2e:real`（本机）；`npm run e2e`（CI，浏览器套件） | CI + 发布 | block | 装→列表→详情→改状态 | 可运行（浏览器套件已接 CI；真实三条为本机发布证据） |
| 依赖高危漏洞 | 0；unknown 未豁免即为失败 | `npm run check:deps` | CI | block | 会随安装包分发出去；无 severity 的记录无法自动判级 | 可运行 |
| 安装包体积 | ≤ 15 MB | `npm run build:app && npm run check:size` | CI | block | Tauri 空壳 5–10MB；超过即说明选型错了 | 可运行（需先 `build:app`） |
| 首屏 JS（index.html 及其 preload） | ≤ 150 KB gzip | `npm run check:bundle`（`check:size` 会先跑它） | CI | block | 启动时间随首屏解析量线性增长；当前 143.2 KB，余量约 4.5% | 可运行（需先 `build`） |
| 冷启动→可交互 | ≤ 2.0s（P95） | `npm run measure:startup` | CI | warn | WebView2 冷启动实测量级 | 可运行（未接 CI） |
| 热启动→可交互 | ≤ 800ms | 同上 | CI | warn | 双击即开是核心卖点 | 可运行（未接 CI） |
| 常驻内存（1000 条票） | ≤ 600 MB，且 ≤ 1 条票基线 + 50 MB | `npm run measure:memory` | CI | warn | WebView2 多进程固定开销约 445 MB；增量门槛捕获应用回归（ADR-0011） | 可运行 |
| 详情页切换 | ≤ 50ms | `npm run measure:navigation` | CI | warn | 纯内存读取，只受渲染限制 | 脚本就绪（`docs/measurements/2026-11-02-navigation.md`）；CI 接线随 bza-bee |
| 列表滚动（1000 条） | 60fps 目标：p50 < 18ms、p95 < 22ms、max < 50ms（60Hz 为 16.7ms） | `npm run measure:scroll`（看板加 `--view=board`） | CI | warn | 虚拟滚动的基本盘 | 脚本就绪（`docs/measurements/2026-11-02-list-scroll.md`、`2026-11-02-board-scroll.md`）；CI 接线随 bza-bee |
| 正文对比度 | ≥ 4.5:1；大字号 ≥ 3:1 | axe（待有可运行 UI） | 交还前 | block | WCAG AA | 待接线 |
| 核心流程无鼠标可达 | 必须 | E2E + 手动 | 交还前 | block | 产品定位是键盘优先 | 待接线 |

架构边界同时禁止 `src/lib/store/*` 引用 `src/lib/sync/*`（`lib-store-to-sync`）；中立 issue 查询位于 `src/lib/issues`，无原型记录构造位于 `src/lib/records.ts`，依赖方向见 [ADR-0012](docs/adr/0012-issue-lookup-neutral-layer.md)。

依赖扫描的 severity 取 OSV 的 `database_specific.severity`。没有该字段的记录（常见于 RUSTSEC）判为 unknown，默认 **block**；只有登记在 `osv-allowlist.json` 的条目（`id` + `reason` + `expires`）才放行，条目到期后自动失败复审，匹配不到任何 unknown 的条目会提示清理。见 [ADR-0007](docs/adr/0007-osv-unknown-severity-allowlist.md)。

## 检查分层

| 层 | 预算 | 内容 |
|---|---|---|
| 编辑循环 | ≤ 5s | typecheck、lint、版本一致、secrets；只查改动文件 |
| 交还给人之前 | ≤ 90s | bridge 单测 + 改动行覆盖率 + 架构边界 |
| CI / review | 不限 | 全量测试、Rust 风格、依赖扫描、构建、体积与性能测量 |

CI 由 `.github/workflows/ci.yml` 执行（PR 与 main push）：`check:fast`、
`format:check`、`check:rust:style`、`check:task`、`check:deps`、`build`。外部工具固定版本并经
SHA256 校验：gitleaks 8.30.1、osv-scanner 2.7.0，通过 `GITLEAKS_PATH` /
`OSV_SCANNER_PATH` 注入；CI 不解析 PATH 或 `%LOCALAPPDATA%`。显式注入的路径
若不存在则直接失败，不回退 PATH / WinGet。见
[ADR-0005](docs/adr/0005-ci-gates-and-external-tool-trust.md)。

bridge 测试**禁止真的 spawn `bd`**：单次调用 1.0–1.4s，几十个用例就能把 90 秒预算吃穿，还会把测试绑死在本机 bd 版本上。用录制好的真实 JSON 样本（`bd export` / `bd events`）跑纯逻辑；真实 `bd` 只出现在 3 条 E2E 里。

## 仅测量（当前无基线，先记录不设防）

| 指标 | 今日值 | 备注 |
|---|---|---|
| secrets | 0 | 2026-10-31 实测，gitleaks 8.30.1，2 commits / 29.34 KB / 395ms |
| 安装包体积 | NSIS x64 2.15 MB（2,257,663 B，v0.1.1）；release exe 5.25 MB | 2026-11-04 `build:app`；strip/LTO/opt-s；`check:size` PASS；NOTICE/LICENSE 随包 |
| 冷启动 | P95 908ms（n=20，P50 648ms） | 2026-11-04 实测，release 5.25MB；页面加载完成标记；预算 2000ms |
| 热启动 | P95 725–807ms（三轮 n=20，P50 620–638ms） | 2026-11-04 修复测量节奏后；原 873–990ms 的尾部尖峰消失，见 [记录](docs/measurements/2026-11-01-startup.md) |
| 内存 | 1000 条 467 MB；1 条基线 452 MB；增量 +15 MB | 2026-11-04，ADR-0011；预算 600 MB / 基线 +50 MB。见 [记录](docs/measurements/2026-11-04-memory.md) |
| 详情切换 | 打开 P95 32.7ms；64 KiB 首渲染 P50 102.4ms | 2026-11-04，预算 50ms / 100ms；64 KiB 略超属已记录噪声 |
| 滚动 | List 与 Board 全部场景 PASS | 2026-11-04，p50 <18 / p95 <22 / max <50；见 `2026-11-03-scroll-budget-alignment.md` |
| bridge 行覆盖率 | 91.2%（1226/1345 行，6 个 bridge 文件） | 2026-11-01 实测；阈值 80% 由 `check:task` 执行 |
| 依赖漏洞 | 0 高危（2 medium；5 unknown 已登记 allowlist，均为仅 Linux 编译路径） | 2026-11-04 实测，osv-scanner 2.7.0，npm + Cargo 锁文件 |
| 对比度、键盘可达 | axe 0 serious/critical；键盘闭环 E2E 通过 | 2026-11-01 实测；见 `tests/e2e/accessibility.spec.ts`、`keyboard-loop.spec.ts`；axe 尚未接 CI |

## Exceptions

| 项 | 原因 | owner | 到期 | 处置 |
|---|---|---|---|---|
| E2E / 体积 / 性能 / a11y 检查未接线 | 浏览器 E2E（含 axe）已于 2026-11-04 接入 CI；体积检查可运行但需先 `build:app`；性能为本机发布测量（GUI 计时噪声大）；真实安装 E2E 为本机证据 | steven123397 | 2026-12-31 | 已接线项不得回退；真实安装 E2E 保持本机发布证据 |
| 前端（Vitest）覆盖率无门槛 | 尚无历史基线；bridge 已单独设 80% 门槛 | steven123397 | 2026-12-31 | 前端基线明确后 ratchet 转 block |
| 性能预算暂为 warn | 已有可测产物；GUI 性能在 CI 上噪声大，暂不阻断 | steven123397 | 2026-12-31 | 连续三次超标时提 issue 或重设预算，不许默默调阈值 |
| ~~热启动 P95 四轮超标~~ | 2026-11-04 已解决：测量节奏修复后三轮 P95 725–807ms、P50 620–638ms，周期性尖峰消失 | steven123397 | 已关闭 2026-11-04 | 例外关闭；预算未改 |

## 更新规则

- 预算可以调整，但必须同时更新「理由」列并记录一次 ADR。
- ratchet 只往紧的方向走：把实测值定为不得下降的 floor。
- 连续三次测量超标：提 issue 或重设预算，二选一，不允许无限期挂着。