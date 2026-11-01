# Phase 3 shell 视觉基线

截图于 2026-11-01，Checkpoint 3 人工确认用。视口 1280×800。

- `welcome-light.png` / `welcome-dark.png` — 欢迎页
- `list-light.png` / `list-dark.png` — List 占位
- `board-light.png` — Board 占位
- `settings-light.png` — Settings 占位
- `palette-light.png` / `palette-dark.png` — 命令面板（输入 `bza`，显示票结果）
- `help-light.png` — `?` 快捷键面板（由注册表生成）
- `settings-zh.png` — 切换到中文后的 Settings
- `welcome-webview2.png` — 真实 release 应用（WebView2）的欢迎页，非浏览器模拟

前十个由 Playwright Chromium + `tests/e2e/fakeBridge.ts` 驱动 Vite dev server 截取；
`welcome-webview2.png` 由 `chromium.connectOverCDP` 连接真实 Tauri 应用的
WebView2 截取。两者使用同一套渲染与 token；真实应用截图用于确认 WebView2
下的字体、密度与主题没有偏差。

走查记录：截图暴露的三个 shell 缺口已登记为 `bza-btl.1`（侧栏折叠未持久化）、
`bza-btl.2`（状态栏无诊断弹层）、`bza-btl.3`（顶栏与欢迎页的鼠标入口缺失）。