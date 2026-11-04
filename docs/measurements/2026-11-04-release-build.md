# 发布构建与签名（2026-11-04）

状态：`bza-1db`、`bza-058` 的构建与产物记录。发布候选 v0.1.0。

## 环境

| 项 | 值 |
|---|---|
| 系统 | Windows 11 Home China 10.0.26300 |
| 工具链 | Tauri 2.12.5、Rust stable（MSVC x64） |
| 构建命令 | `npm run build:app`（先跑 `check-versions`，再 `tauri build`） |
| 签名环境 | `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` |

## 配置

- `bundle.targets = ["nsis"]`，`bundle.windows.nsis.installMode = "currentUser"`。
- `bundle.createUpdaterArtifacts = true`，构建产出安装包 `.sig`。
- `bundle.resources` 把仓库根的 `NOTICE` 与 `LICENSE` 放进安装目录；
  NSIS 卸载脚本同时删除两者。
- `[profile.release]`：`strip = true`、`lto = true`、`codegen-units = 1`、
  `opt-level = "s"`、`panic = "abort"`。
  - 体积换构建时间（一次 release 构建约 7–8 分钟）。
  - `panic = "abort"` 的前提：所有 command 返回 `Result`，没有依赖展开的恢复
    路径；生产代码中没有 `catch_unwind`，测试里的 `panic!` 不进入 release。
- 版本三处一致（`package.json`、`src-tauri/Cargo.toml`、
  `src-tauri/tauri.conf.json`），由 `check:versions` 在 `check:fast` 和
  `build:app` 前校验。

## 产物

| 产物 | 大小 | SHA-256 |
|---|---:|---|
| `src-tauri/target/release/beadazzled.exe` | 5,501,440 B（5.25 MB） | — |
| `beadazzled_0.1.0_x64-setup.exe` | 2,254,990 B（2.15 MB） | `bce157443d96fe1ba2ff77c9d86cd75bb040975faffc7cac82c6443a3a2e3f22` |
| `beadazzled_0.1.0_x64-setup.exe.sig` | 440 B | — |
| `latest.json` | 由 `npm run make:latest` 生成 | 同上 |

签名 key id：`08170ebc532efce9`（minisign 公钥注释显示为
`E9FC2E53BC0E1708`）。公钥在 `tauri.conf.json` 的 `plugins.updater.pubkey`。

## 验证

| 检查 | 结果 |
|---|---|
| `npm run check:size` | PASS（2.15 MB，预算 15 MB） |
| `npm run verify:release` | PASS（签名、版本、URL、SHA-256） |
| `npm run e2e:real -- --installer …` | 安装 → 列表 → 详情 → 改状态持久化 → 卸载，全部 PASS |
| 安装目录 | `%LOCALAPPDATA%\beadazzled`；卸载后目录与卸载注册项均消失 |
| 安装包内容 | `installer.nsi` 含 `File … LICENSE` / `File … NOTICE`，卸载时删除 |
| 首屏 JS | 146.7 KB gzip（预算 150 KB） |

`verify:release` 输出：

```
verify-release: PASS
  version    0.1.0 (package.json, Cargo.toml, tauri.conf.json, latest.json)
  artifact   beadazzled_0.1.0_x64-setup.exe (2,254,990 bytes)
  sha256     bce157443d96fe1ba2ff77c9d86cd75bb040975faffc7cac82c6443a3a2e3f22
  signature  OK (key id 08170ebc532efce9)
  manifest   windows-x86_64 -> https://github.com/steven123397/beadazzled/releases/download/v0.1.0/beadazzled_0.1.0_x64-setup.exe
```

## 复现

```bash
# 1. 构建（私钥内容与口令来自本机安全位置，不写入仓库）
export TAURI_SIGNING_PRIVATE_KEY="$(cat "$USERPROFILE/.tauri/beadazzled.key")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(…DPAPI 解密…)"
npm run build:app
npm run check:size

# 2. 生成并校验清单
npm run make:latest -- --installer src-tauri/target/release/bundle/nsis/beadazzled_0.1.0_x64-setup.exe
npm run verify:release -- --installer src-tauri/target/release/bundle/nsis/beadazzled_0.1.0_x64-setup.exe

# 3. 真实桌面 E2E（含静默安装与卸载）
npm run e2e:real -- --installer src-tauri/target/release/bundle/nsis/beadazzled_0.1.0_x64-setup.exe
```

## 未验证 / 边界

- 未做 Authenticode 代码签名：SmartScreen 可能提示「未知发布者」。
- 未上传到 GitHub Release；远端附件一致性（证据第 3 层）尚未验证。
- 更新闭环需要已发布的 v0.1.0 与后续 v0.1.1 才能演示；当前验证覆盖了
  本地 `.sig` / `latest.json` 的签名与清单一致性，以及篡改检测。
- 安装测试使用静默安装（`/S`）到 currentUser，未走交互式安装向导与
  SmartScreen 提示。