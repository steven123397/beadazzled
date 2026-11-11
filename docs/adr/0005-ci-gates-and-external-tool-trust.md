# ADR-0005: CI 门禁与外部工具信任

状态：已接受（2026-11-01）
影响模块：CI、质量门禁（CONSTRAINTS）、bridge 测试、发布流程

## 背景

到 bza-ryr.4 为止，CONSTRAINTS 的 block 检查都只在本地自觉执行：没有 CI，
PR 不会自动跑 `check:fast` / `check:task` / `check:deps`；`cargo fmt --check`
与 `cargo clippy --all-targets -- -D warnings` 也没有 gate。另外，
`check-secrets.mjs` 与 `check-deps.mjs` 在本地会回退到 PATH 或可写的
`%LOCALAPPDATA%\Microsoft\WinGet\Packages` 解析 gitleaks / osv-scanner，
在 CI 上等于信任一个未固定的本地目录。

## 决策

- 使用 **GitHub Actions**，`windows-latest` 单 job（`Quality gates (Windows)`），
  在 `pull_request` 与 `push` 到 `main` 时运行；产品只支持 Windows。
- 顺序执行以下阻塞门禁（2026-11-11 与 workflow 实际步骤对齐）：
  1. `npm run check:fast`（typecheck、lint、版本一致、secrets）
  2. `npm run format:check`（Prettier；2026-11-11 接入，见 ADR-0013）
  3. `npm run check:rust:style`（`cargo fmt --check` + `cargo clippy --all-targets -- -D warnings`）
  4. `npm run build`（前端生产构建）
  5. `npm run check:bundle`（bundle seam 与首屏预算，读取构建产物）
  6. `npm run check:task`（check:bindings、架构边界、质量脚本单测、Vitest 单测、bridge 行覆盖率）
  7. `npm run e2e`（浏览器套件，fake bridge；含 axe）
  8. `npm run check:deps`（osv-scanner）
- **外部工具固定版本并从官方 release 下载**，workflow 内校验 SHA256 后才使用：
  - gitleaks 8.30.1，`gitleaks_8.30.1_windows_x64.zip`，
    SHA256 `d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e`
  - osv-scanner 2.7.0，`osv-scanner_windows_amd64.exe`，
    SHA256 `9964ed64ec9a387391eb4cc006ad5c531154821aef29b793e02c448de4686438`
  - 路径通过 `GITLEAKS_PATH` / `OSV_SCANNER_PATH` 显式注入；CI 不查询 PATH，
    也不读取 `%LOCALAPPDATA%`。
- `cargo-llvm-cov` 固定 `0.9.1` 并用 `--locked` 安装；同时安装
  `llvm-tools-preview`，保证覆盖率命令可在干净 runner 上运行。
- checkout 使用 `fetch-depth: 0`，让 gitleaks 扫描完整历史。
- CI 失败即 job 失败；在 GitHub 仓库设置中把该 job 设为 main 的必需检查
  （branch protection / ruleset）是**人工步骤**，不随代码自动生效。

## 后果

- PR 与 main push 都会跑完整门禁；配置 branch protection 后，失败会阻止合并。
- 首次 CI 需要编译 Tauri、覆盖率插桩和安装 cargo-llvm-cov，耗时明显；
  暂不缓存 `src-tauri/target`（体积大）。若持续超过可接受范围，再用缓存或
  独立 job 优化，不降低门禁强度。
- 升级 gitleaks / osv-scanner / cargo-llvm-cov 时，必须同时更新 workflow 中
  的版本与 SHA256，并同步 CONSTRAINTS 与本节记录。
- E2E（含 axe）已于 2026-11-04 接入本 workflow；安装包体积与性能测量仍不在
  本 workflow 中，由各自阶段的 issue 接线，CONSTRAINTS 的 Exceptions 保持登记。

## 被拒绝的备选

- **CI 中继续用 winget / PATH 解析工具**：版本与内容不可控，且依赖可写的
  `%LOCALAPPDATA%`，正是本次要消除的风险。
- **使用 `latest` 或未校验的下载**：无法复现，也无法发现供应链替换。
- **直接跑 `check:full`**：包含 E2E、`build:app`、体积与性能测量，当前缺少
  对应产物与 runner 配置；会把 CI 变成长期红灯，反而促使弱化门禁。
- **用第三方 install action 安装 cargo-llvm-cov**：`cargo install --locked`
  更透明；CI 时间若成为问题再评估，但必须固定版本。
## 附注：2026-11-01 工具路径与覆盖率开销（bza-ryr.23）

- `GITLEAKS_PATH` / `OSV_SCANNER_PATH` 现在 fail-closed：显式设置但文件不存在
  时直接失败，不再回退 PATH / WinGet。CI 注入的是确定路径，拼错必须看得见。
- `cargo llvm-cov --json --summary-only`：实测该开关保留每个文件的 summary
  （bridge 阈值只需要 `files[].summary.lines`），JSON 更小，已采用。
- 覆盖率只统计生产 bridge 文件：`test_support.rs` 与模块内 `tests.rs` /
  `bridge_tests.rs` 不计入分母（bza-ryr.25 把测试搬进 src 后需要这条）。
- 缓存结论沿用本节：`src-tauri/target` 仍不缓存（Windows 上体积大、失效频繁，
  缓存上限与恢复成本不划算）；cargo-llvm-cov 二进制缓存暂不接线——会新增
  actions/cache 步骤，其运行时版本需与 Node 24 升级策略一并核对。CI 时长
  成为实际问题时，再按“固定版本”原则评估。

## 附注：2026-11-11 format:check 接入 CI（bza-pzb.2）

- `npm run format:check` 成为阻塞门禁，位于 `check:fast` 之后；行尾策略
  （`endOfLine=auto`）与存量修复见 [ADR-0013](0013-prettier-eol-auto-and-ci-format-gate.md)。
- 格式检查不并入 `check:fast`：编辑循环保持 ≤5s 预算，全仓格式检查只在
  CI 层执行。

## 附注：2026-11-11 check:task 描述同步（bza-pzb.1）

- `check:task` 中的 `test:unit` 为纯 Vitest 单测运行，**不采集无阈值的
  Vitest 覆盖率**；上文门禁清单已据此修正。前端覆盖率门槛仍按
  CONSTRAINTS 的 Exceptions 登记（无门槛、待基线），bridge 行覆盖率
  ≥80% 门禁不变；本附注不恢复采集，也不弱化任何现有检查。
- 同次把门禁清单与 `ci.yml` 实际步骤对齐：`format:check`、`check:bundle`
  与浏览器 `e2e` 均早已或现已接入，旧清单未反映。
