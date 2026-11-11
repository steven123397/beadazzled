# Spec: release — 安装包、签名与自动更新

状态：v0.1.0 · 依赖：`shell`
依据：paper-30min v1.4.0 的既有做法（Tauri updater minisign + NSIS + GitHub Releases + 四层证据），已核对其 `tauri.conf.json` 与发布文档。

## Objective

让用户**下载一个安装包、双击、装上即用**，并且之后的更新不需要再手动找安装包。

发布形态（用户已定）：**开源、免费、自动更新**。不做 Authenticode 代码签名。
许可证：**MIT**（仓库根 [LICENSE](../../LICENSE)）；第三方来源与依赖署名见 [NOTICE](../../NOTICE)。

## 两种「签名」的边界（必须先说清）

| 类型 | 作用 | 本项目的选择 |
|---|---|---|
| Authenticode 代码签名证书 | Windows 信任链、SmartScreen 声誉 | **不做**。无证书时 SmartScreen 可能提示「未知发布者」，在 README 与发布说明中如实说明，不宣称签名可信 |
| updater 签名（minisign） | 证明更新包完整、未被篡改，由 Tauri updater 校验 | **必做**。自生成密钥对，公钥内置应用，私钥只在本机/CI secret |

## 构建与产物体

- 目标：Windows x64，NSIS 安装包，`installMode: currentUser`。
- 应用标识：`com.steven123397.beadazzled`；产品名 `beadazzled`。
- 版本：语义化，从 **0.1.0** 起；`package.json`、`src-tauri/Cargo.toml`、`tauri.conf.json` 三处一致（构建前脚本校验）。
- 产物体积：安装包 ≤15 MB（`npm run build:app && npm run check:size`，CONSTRAINTS）。
- 不捆绑 bd、不打包 Node、不打包额外运行时。
- 图标与安装器资源纳入仓库；安装目录与卸载行为由 NSIS 默认模板负责，不做自定义安装脚本（除非有实测需求）。

## 自动更新

```jsonc
// src-tauri/tauri.conf.json（片段）
"plugins": {
  "updater": {
    "pubkey": "<minisign 公钥>",
    "endpoints": [
      "https://github.com/steven123397/beadazzled/releases/latest/download/latest.json"
    ],
    "windows": { "installMode": "passive" }
  }
}
```

- 发布资产：`beadazzled_<version>_x64-setup.exe`、同名 `.sig`、`latest.json`。
- 稳定通道只指向正式版；不上传 beta 到 `latest`（若以后需要 beta，使用独立 `latest-beta.json`，不替换稳定入口）。
- 启动后延迟检查（≥10s，避免与基线争用 bd / 首屏）；检查失败静默记录到诊断，不打扰用户。
- v0.1.0 的检查频率固定为「启动后一次 + 手动检查」，不设每日轮询（已定）。
- 手动检查入口在「关于」；无更新时显示「已是最新」。
- 更新流程：用户确认 → 下载 → 校验签名 → passive 安装 → 自动重启；不做后台静默安装、不静默重启。
- 拒绝签名不匹配或版本不更高的更新包；不做降级。
- 更新检查不调用 bd、不阻塞启动。

## 密钥管理

- 生成：`npm run tauri signer generate -- -w <path>`（或 Tauri 文档等价命令）。
- 私钥与口令**只在本机安全位置或 CI secret**；仓库、日志、诊断信息中不得出现。
- 公钥写入 `tauri.conf.json` 并提交。
- 密钥丢失 = 现有安装无法自动更新到新密钥。必须在首次发布前备份私钥与口令（离线）。
- 提交前 `gitleaks detect --source . --redact --no-banner` 必须为 0（CONSTRAINTS）。

## 发布流程（四层证据）

沿用 paper-30min 的经验，每层证据单独记录，未执行的项目写明「未验证」，不因一次放行永久降低门槛。

1. **源码可交付**：目标版本在 `main`；代码审查收敛；版本号三处一致；CONSTRAINTS 全部检查通过（CI 或本地等效证据）。Actions 发布的 preflight 必须确认目标提交的 `Quality gates (Windows)` 已成功。
2. **构建产物一致**：默认由人工触发的 `release.yml` 从目标 main 提交重新构建并签名；核对安装包文件名、实际字节与 `.sig`、`latest.json` 中的版本与 URL；`npm run make:latest` 在写 manifest 前用 updater 公钥验签，并只接受与版本及安装包名一致的规范 GitHub Releases HTTPS URL；生成后运行 `npm run verify:release` 独立复核，再执行 `check:size`。任何一步失败都不得创建 Release。
3. **远端附件一致**：Draft 上传后，从 GitHub 下载回 `.exe`、`.sig`、`latest.json`，重新验签并比较哈希；确认 Draft 的版本、提交与发布说明正确后才允许人工 Publish。Publish 后确认 `latest` 端点实际返回目标版本。
4. **安装行为可用**：在真实 Windows 上走查：全新安装、原地升级（从上一版本）、应用内更新、卸载；列出未覆盖的组合。Draft 资产可先用于全新安装/原地升级，应用内更新的 latest 通道在 Publish 后验证。

### Actions 半自动发布

决策见 [ADR-0014](../adr/0014-manual-draft-release-workflow.md)。工作流只有合入默认分支后才会显示「Run workflow」。

首次使用前，仓库管理员必须在 **Settings → Environments → `release`** 完成：

- Deployment branches 选择 **Selected branches**，只允许 `main` branch；不得添加 tag 规则。
- 配置 **Required reviewers**；job 通过审批后才能读取 Environment secrets。单人维护时保留允许 self-review，否则无人可批准自己触发的运行。
- 添加 secret `TAURI_SIGNING_PRIVATE_KEY`，值是 updater 私钥内容，不是仓库内路径。
- 私钥有口令时添加 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`；未加密私钥不需要创建该 secret。不得把私钥或口令写入 workflow、仓库文件、issue、日志或 Release 说明。

每次发布：

1. 等目标 main 提交的 `Quality gates (Windows)` 成功，在 **Actions → Release → Run workflow** 选择 `main`。preflight 要求 ref 精确为 `refs/heads/main`，验证该 SHA 的 `.github/workflows/ci.yml` main push 运行及其中 `Quality gates (Windows)` job 均成功；同名 tag、其他分支、无成功 CI、prerelease 版本、缺少 `docs/releases/v<version>.md` 或 tag 已存在均应失败。
2. 工作流自动完成构建、签名、manifest 生成、独立验签和体积检查，随后原子创建指向目标 SHA 的 tag，再以 `--verify-tag` 创建 **Draft Release**；创建后重读 tag SHA，若发生移动则失败并禁止 Publish。只创建 Draft，不自动 Publish；同仓库发布运行串行，正在执行的发布不会被后续触发取消。
3. 下载 Draft 的三个资产完成第三层回验，并用 Draft 安装包做适用的真实安装验证。工作流不自动删除或覆盖失败留下的 Draft/tag，由人核对提交与内容后处理。
4. 人工点击 **Publish** 后才影响 `releases/latest`；随后验证 latest 端点、上一版本应用内更新及剩余第四层证据。`release.yml` 不含自动 Publish。

`npm run verify:release` 至少检查：

- `.sig` 与安装包字节匹配（用公钥验证）；armored 签名还必须通过 global
  signature 校验，trusted comment 中的 `version:` 与 `latest.json` 一致；
  `requireSignedVersion: true` 时缺失签名版本同样失败；
- `latest.json` 的版本、平台条目、URL、`signature` 与实际产物一致；URL 规范化后必须与
  `https://github.com/steven123397/beadazzled/releases/download/v<version>/<installer>`
  完全一致，防止点段逃逸到非预期仓库；安装包版本号按分隔符精确匹配，避免
  `0.1.10` 误配 `0.1.1`；
- 安装包 SHA-256 与清单记录一致；
- 版本号三处一致且与 `latest.json` 相同；
- 输出可粘贴的证据摘要（不写文件、不含私钥）。

## 版本与发布渠道

- 发布在 GitHub Releases（公开仓库），tag 形如 `v0.1.0`。
- `docs/releases/<version>.md` 是**给用户的发布说明模板**（Actions 读取 `v<version>.md`）：这个版本是什么、安装与卸载、SmartScreen、变更、已知限制。模板不得写死某次构建的 SHA-256；`release.yml` 会拒绝任何 64 位十六进制串，防止 `sha256`、`SHA-256:`、`sha256sum` 等旧哈希格式漏过，并把实际安装包的字节数、SHA-256、目标提交与验签声明追加到 Draft 说明和 updater notes。本地备用发布同样必须在构建后写入实际哈希。
- 内部证据记录在 OpenViking peer resource
  `viking://user/win-dev/peers/github.com-steven123397-beadazzled/resources/releases/`：
  四层验证、发布步骤、性能数字、未验证项与回滚说明按版本归档。仓库只保留
  用户可见的 `docs/releases/<version>.md`，不再创建 `<version>-evidence.md`。
- CI（GitHub Actions）负责检查；默认由 `release.yml` 在人工触发后构建、签名、校验并上传 **Draft Release**，最终 **Publish** 由人执行（ADR-0014）。本机手工构建上传只作故障备用，不得减少任何验签或四层证据。
- 首个正式版 v0.1.0 之前允许 `v0.1.0-beta.N` 预发布，但不得占用 `latest` 端点；当前 `release.yml` 只接受稳定版 `x.y.z`，beta 不得通过该工作流发布。

## 性能与质量接线

CONSTRAINTS 中的以下检查在发布前必须跑过并留证据：

- 安装包体积 ≤15 MB
- 冷启动 ≤2.0s（P95）、热启动 ≤800ms
- 常驻内存 ≤600 MB 且 ≤1 条基线 +50 MB（1000 条票；原 150 MB 预算已由
  [ADR-0011](../adr/0011-memory-budget.md) 重设）
- 详情切换 ≤50ms、列表滚动 60fps
- 3 条真实 E2E 全绿
- 依赖高危漏洞 0、secrets 0

测量脚本产出的数字写入上述 OpenViking 发布证据；未达标按 CONSTRAINTS 的 block/warn 规则处理，不得改预算迁就结果。

## Acceptance Criteria

1. **安装可用**：全新 Windows 用户双击安装包完成安装，开始菜单启动，卸载干净（无残留配置除非用户保留）。
2. **体积**：安装包 ≤15 MB；`check:size` 在超限时失败。
3. **自动更新闭环**：安装 v0.1.0 → 发布 v0.1.1 → 应用检测、下载、验签、passive 安装、重启后版本更新。
4. **篡改拒绝**：修改安装包字节后，更新流程因签名不匹配失败并给出可见错误。
5. **清单一致**：`verify:release` 对正确产物通过；对错误签名、版本不一致、URL 不匹配分别失败。
6. **密钥不泄露**：gitleaks 0；仓库历史与诊断输出中无私有密钥或口令。
7. **SmartScreen 如实说明**：README 与发布说明写明「未做 Authenticode 签名，系统可能提示未知发布者」，不暗示已获信任。
8. **启动预算**：冷启动 ≤2.0s（P95）、热启动 ≤800ms，数字记录在 OpenViking 发布证据。
9. **E2E**：安装→列表、详情阅读、改状态并持久化三条真实 E2E 全绿。
10. **无 bd 阻塞**：更新检查与启动不调用 bd；bd 不可用时更新流程仍可用。

## Module Commands

- `gh workflow run release.yml --ref main` — 等价于 Actions UI 的人工触发；仍需先完成 Environment 设置
- `npm run build:app` — 构建 NSIS 安装包（本地备用发布）
- `npm run check:size` — 体积预算
- `npm run make:latest` — 验签并生成更新清单；Actions 用 `--notes-file` 传多行说明，避免 Windows/npm 命令行截断换行后的内容
- `npm run verify:release` — 本地产物与清单校验
- `npm run e2e:real -- --installer <exe>` — 真实安装 → 列表 → 详情 → 改状态 → 卸载
- `npm run measure:startup|memory|navigation|scroll`
- `gitleaks detect --source . --redact --no-banner`

## Module Structure

```
src-tauri/tauri.conf.json        bundle / updater / 图标
src-tauri/capabilities/          最小权限（updater、opener、dialog 等）
scripts/check-size.mjs           安装包体积
scripts/check-versions.mjs       版本三处一致
scripts/verify-release.mjs       签名、清单、哈希校验
scripts/make-latest-json.mjs     生成更新清单
scripts/e2e-real.mjs             真实安装 → 列表 → 详情 → 改状态 → 卸载
scripts/measure-*.mjs            启动/内存/导航/滚动
docs/releases/                   用户可见的版本发布说明
.github/workflows/ci.yml         typecheck / lint / tests / gitleaks / osv / e2e
.github/workflows/release.yml    main preflight / 签名构建 / 验签 / Draft Release
```

## Module Code Style

- 普通发布脚本只读产物、只输出证据摘要；不得自动上传或删除 Release，不持有发布凭据。
- 上传只能由 `release.yml` 的受控 Draft step 或本地备用流程中的人执行；删除 Release 始终由人执行。任何自动化不得覆盖既有 Release。
- 配置中的密钥字段只允许公钥；私钥只经本机环境变量或 `release` Environment secrets 注入，不写进任何被提交的文件。

## Boundaries

- **Always**：签名后校验；四层证据；版本三处一致；发布说明写清未验证项；Actions 只创建 Draft，Publish 前完成下载回验。
- **Ask first**：切换到 beta 通道；改变更新端点；引入 Authenticode 证书；自动 Publish；修改 release Environment、签名密钥或 token 权限。
- **Never**：提交私钥/口令；关闭签名校验；静默强制更新；把 beta 指向 `latest`；在证据缺失时宣称发布完成；自动删除或覆盖 Release。

## Decisions

- CI 发布构建已由 [ADR-0014](../adr/0014-manual-draft-release-workflow.md) 决策为「人工触发 + Draft + 人工 Publish」。后续若要自动 Publish，必须另作决策并同步本规格与 CONSTRAINTS。