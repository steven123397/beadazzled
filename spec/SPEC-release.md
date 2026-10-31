# Spec: release — 安装包、签名与自动更新

状态：v0.1.0 · 依赖：`shell`
依据：paper-30min v1.4.0 的既有做法（Tauri updater minisign + NSIS + GitHub Releases + 四层证据），已核对其 `tauri.conf.json` 与发布文档。

## Objective

让用户**下载一个安装包、双击、装上即用**，并且之后的更新不需要再手动找安装包。

发布形态（用户已定）：**开源、免费、自动更新**。不做 Authenticode 代码签名。
许可证：**MIT**（仓库根 [LICENSE](../LICENSE)）。

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
- 更新流程：下载 → 校验签名 → passive 安装 → 提示重启；不强制重启、不后台静默重启。
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

1. **源码可交付**：目标版本在 `main`；代码审查收敛；版本号三处一致；CONSTRAINTS 全部检查通过（CI 或本地等效证据）。
2. **本地产物一致**：从最终源码重新构建并签名；核对安装包文件名、实际字节与 `.sig`、`latest.json` 中的版本与 URL；运行 `npm run verify:release`。
3. **远端附件一致**：上传后从 GitHub 下载回 `.exe`、`.sig`、`latest.json`，重新验签并比较哈希；确认 `latest` 端点实际返回目标版本。
4. **安装行为可用**：在真实 Windows 上走查：全新安装、原地升级（从上一版本）、应用内更新、卸载；列出未覆盖的组合。

`npm run verify:release` 至少检查：

- `.sig` 与安装包字节匹配（用公钥验证）；
- `latest.json` 的版本、平台条目、URL、`signature` 与实际产物一致；
- 安装包 SHA-256 与清单记录一致；
- 版本号三处一致且与 `latest.json` 相同；
- 输出可粘贴的证据摘要（不写文件、不含私钥）。

## 版本与发布渠道

- 发布在 GitHub Releases（公开仓库），tag 形如 `v0.1.0`。
- `docs/releases/<version>.md` 记录：变更、已知限制、验证证据、未验证项。
- CI（GitHub Actions）负责检查；发布构建在本机完成（签名密钥不进入仓库），上传用 `gh release upload`。
- 首个正式版 v0.1.0 之前允许 `v0.1.0-beta.N` 预发布，但不得占用 `latest` 端点。

## 性能与质量接线

CONSTRAINTS 中的以下检查在发布前必须跑过并留证据：

- 安装包体积 ≤15 MB
- 冷启动 ≤2.0s（P95）、热启动 ≤800ms
- 常驻内存 ≤150 MB（1000 条票）
- 详情切换 ≤50ms、列表滚动 60fps
- 3 条真实 E2E 全绿
- 依赖高危漏洞 0、secrets 0

测量脚本产出的数字写入 `docs/releases/<version>.md`；未达标按 CONSTRAINTS 的 block/warn 规则处理，不得改预算迁就结果。

## Acceptance Criteria

1. **安装可用**：全新 Windows 用户双击安装包完成安装，开始菜单启动，卸载干净（无残留配置除非用户保留）。
2. **体积**：安装包 ≤15 MB；`check:size` 在超限时失败。
3. **自动更新闭环**：安装 v0.1.0 → 发布 v0.1.1 → 应用检测、下载、验签、passive 安装、重启后版本更新。
4. **篡改拒绝**：修改安装包字节后，更新流程因签名不匹配失败并给出可见错误。
5. **清单一致**：`verify:release` 对正确产物通过；对错误签名、版本不一致、URL 不匹配分别失败。
6. **密钥不泄露**：gitleaks 0；仓库历史与诊断输出中无私有密钥或口令。
7. **SmartScreen 如实说明**：README 与发布说明写明「未做 Authenticode 签名，系统可能提示未知发布者」，不暗示已获信任。
8. **启动预算**：冷启动 ≤2.0s（P95）、热启动 ≤800ms，数字记录在发布说明。
9. **E2E**：安装→列表、详情阅读、改状态并持久化三条真实 E2E 全绿。
10. **无 bd 阻塞**：更新检查与启动不调用 bd；bd 不可用时更新流程仍可用。

## Module Commands

- `npm run build:app` — 构建 NSIS 安装包
- `npm run check:size` — 体积预算
- `npm run verify:release` — 本地产物与清单校验
- `npm run e2e -- --real` — 3 条真实 E2E
- `npm run measure:startup|memory|navigation|scroll`
- `gitleaks detect --source . --redact --no-banner`

## Module Structure

```
src-tauri/tauri.conf.json        bundle / updater / 图标
src-tauri/capabilities/          最小权限（updater、opener、dialog 等）
scripts/check-size.mjs           安装包体积
scripts/verify-release.mjs       签名、清单、哈希校验
scripts/measure-*.mjs            启动/内存/导航/滚动
docs/releases/                   版本发布记录
.github/workflows/checks.yml     typecheck / lint / tests / gitleaks / osv
```

## Module Code Style

- 发布脚本只读产物、只输出证据摘要；不得自动上传或删除 Release。
- 任何涉及上传/删除的操作由人执行（`gh release upload`），脚本不持有凭据。
- 配置中的密钥字段只允许公钥；私钥路径通过环境变量传入，不写进任何被提交的文件。

## Boundaries

- **Always**：签名后校验；四层证据；版本三处一致；发布说明写清未验证项。
- **Ask first**：切换到 beta 通道；改变更新端点；引入 Authenticode 证书；自动化上传。
- **Never**：提交私钥/口令；关闭签名校验；静默强制更新；把 beta 指向 `latest`；在证据缺失时宣称发布完成。

## Open Questions

1. **CI 发布构建**：当前沿用「本机构建 + 手动上传」，因为签名密钥不进入仓库；若以后改用 GitHub Actions secret，需同时评估密钥暴露面。