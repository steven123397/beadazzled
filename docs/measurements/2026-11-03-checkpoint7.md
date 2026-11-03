# Checkpoint 7 证据（2026-11-03）

状态：功能面完成，**等待人工确认进入发布阶段**（`bza-8b5` 保持 in_progress）。
对应 SPEC-settings 的「四个屏幕可用、诊断可复制」与 Checkpoint 7 的三条验收。

## 1. 四个屏幕 E2E 通过

`npm run e2e`：**50 passed**。四个屏幕各自的用例：

| 屏幕 | 用例数 | 代表用例 |
|---|---|---|
| List | 13（`list.spec` 3 + `list-states.spec` 10） | 1000 条虚拟化与 J/K 焦点恢复、多词查询保空格、深链接恢复筛选、journal 降级仍可读、零 bd 断言 |
| Board | 10（`board.spec`） | 真实指针拖动、键盘移动、Blocked 拒绝、1000 卡片虚拟化、筛选一致、零 bd |
| Detail | 4（`detail.spec`） | 文档阅读、编辑与回声、返回列表位置恢复 |
| Settings | 10（`settings.spec` 3 + `settings-workspaces.spec` 3 + `settings-states.spec` 4） | 打开零 bd、偏好持久化、诊断按需加载与六行复制、工作区增删切移、无 bd 引导、确认框键盘 |

附加：`keyboard.spec` 3、`keyboard-loop.spec` 1、`accessibility.spec` 5（axe 覆盖四屏与明暗）、
`csp.spec` 2、`smoke.spec` 1、`perf-palette.spec` 1。

截图（明/暗 × 四屏）：`assets/phase7/cp7/cp7-{light,dark}-{list,board,detail,settings}.png`。

## 2. 诊断信息可复制

- 设置页「复制诊断」与状态栏共用 `formatDiagnostics`，输出固定六行：
  `beadazzled <version>` / `bd <version> at <path>` / `workspace:` /
  `project: … · dolt_mode=… · schema=…` / `sync: … · lastSeq=… · lastRefresh=…` / `error:`
- E2E 读取真实剪贴板并逐行断言（Windows 剪贴板为 CRLF，已按平台归一）。
- 内容只含版本、路径、project id、状态与错误；无 token、无正文（单测断言）。

## 3. 人工确认（待完成）

构建产物：

- `src-tauri/target/release/beadazzled.exe`
- `src-tauri/target/release/bundle/nsis/beadazzled_0.1.0_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/beadazzled_0.1.0_x64_en-US.msi`

建议按顺序确认：

1. 启动应用 → 添加一个真实 beads 仓库（原生目录选择框）→ List 出现票。
2. Board 拖动一张票，Detail 改状态或加评论，重开应用确认持久化。
3. 设置页：点「指定路径…」出现原生文件选择框；「重新检测」正常；「生成诊断」显示真实
   `bd context`（dolt_mode / schema）并复制；同步区块显示 Live 与 lastSeq。
4. 切换语言/主题后重启，保持上次选择。
5. journal 关闭的仓库：同步区块显示开启命令，复制后可在终端执行。

确认无误后关闭 `bza-8b5`，进入发布阶段（视觉打磨 + bza-1db / bza-058 / bza-bee / bza-51e）。

## 门禁（2026-11-03）

- 单测：**573 passed**（73 files）
- Rust：**211 passed**；clippy `-D warnings`、fmt 干净
- E2E：**50 passed**
- 首屏：**145.7 KB gzip**（预算 150）
- 安装包：**NSIS 2.34 MB / MSI 3.43 MB**（预算 15 MB）
- 架构边界、绑定漂移、依赖审计：干净

## 已知缺口

- 浏览器 E2E 不跑真实 `bd`，也不触发原生文件对话框；真实进程链路由 `bza-51e`
  （3 条真实 E2E 与发布证据）承担。
- 设置页的 5 项未覆盖见
  [2026-11-03-settings-verification.md](2026-11-03-settings-verification.md#已知未覆盖)。