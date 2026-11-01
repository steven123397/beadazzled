# ADR-0009: CSP 基线与 devCsp 分离

状态：已接受（2026-11-01）
影响模块：`src-tauri/tauri.conf.json`、`tests/quality/csp-policy.node-test.mjs`、
`tests/e2e/csp.spec.ts`、detail 模块

## 背景

`src-tauri/tauri.conf.json` 的 `app.security.csp` 原为 `null`（不注入任何策略）。
detail 模块要渲染来自 bd 的不可信 Markdown，其第一道防线是 `rehype-sanitize`；
CSP 是第二道防线，在 sanitize 被绕过或漏配时阻止脚本执行、外连与框架嵌入。

越晚启用 CSP，返工面越大：shell 的主题/字体、list/board 的虚拟滚动、
detail 的图片占位都会陆续引入新的资源来源，届时再收紧需要回头改代码。
因此本任务在 detail 实装前先冻结策略。

Tauri v2 提供两个字段：

- `app.security.csp`：生产构建注入所有 HTML；
- `app.security.devCsp`：开发期使用（未设置时回退到 `csp`）。

Tauri 会在构建时读取 HTML，把自身脚本/样式的 nonce 与 hash 追加到
`script-src` / `style-src`，因此手写策略不需要为 Tauri 初始化脚本开口子。

## 决策

生产策略（对象形式，便于逐指令审查）：

| 指令 | 值 | 理由 |
|---|---|---|
| `default-src` | `'self'` | 默认只允许应用自身资源 |
| `script-src` | `'self'` | 禁止内联与 `eval`；Tauri 自动追加 nonce/hash |
| `style-src` | `'self' 'unsafe-inline'` | React 的内联 `style` 属性与 Radix 定位需要；样式注入不产生脚本执行 |
| `connect-src` | `'self' ipc: http://ipc.localhost` | Tauri v2 IPC 在 Windows 走 `http://ipc.localhost`，其余平台走 `ipc:` |
| `img-src` | `'self' data:` | detail 的远程图片只显示占位链接，不加载 |
| `font-src` | `'self'` | 字体随包分发 |
| `object-src` / `frame-src` / `frame-ancestors` | `'none'` | 不嵌入插件、iframe，也不允许被嵌入 |
| `base-uri` / `form-action` | `'none'` | 阻断 `<base>` 劫持与表单外发 |
| `media-src` | `'none'` | v0.1.0 无音视频 |

开发策略只放宽 Vite 必需的部分，其余与生产一致：

- `script-src` 追加 `'unsafe-inline'` 与 `http://localhost:1420`：
  `@vitejs/plugin-react` 的 React Refresh preamble 是内联 module script，
  实测 `curl http://localhost:1420/` 可确认；
- `connect-src` 追加 `http://localhost:1420`、`ws://localhost:1420`
  （HMR）、`ws://localhost:1421`（`TAURI_DEV_HOST` 场景的 HMR 端口）；
- `default-src` / `img-src` / `font-src` / `style-src` 追加
  `http://localhost:1420`，用于 dev server 直出的资源。

开发策略**不**加入 `'unsafe-eval'`；若将来某个依赖要求 eval，需要新的 ADR，
而不是顺手放宽。

`devCsp` 的放宽是有意的：开发环境不渲染来自其他工作区的不可信内容，
且不会作为产物分发。生产策略是唯一的安全承诺。

### devCsp 必须由 Vite 下发

实测（2026-11-01，Tauri 2.12.5 + WebView2）：`tauri dev` 使用 `devUrl` 时，
文档由 Vite 通过 HTTP 直接提供，Tauri 只在 `tauri://` 资源协议上注入 CSP，
**不会**拦截 dev server 的响应。因此仅写 `devCsp` 等于开发期没有 CSP。

处理方式（与 Modrinth App 的修法一致）：`vite.config.ts` 增加
`beadazzled:dev-csp` 插件，在 `serve` 模式下从 `tauri.conf.json` 读取
`devCsp` 并作为 `Content-Security-Policy` 响应头下发。这样：

- 开发期与生产期都有策略，且来源是同一份配置；
- CSP 违规在开发时就能暴露，而不是打包后才发现；
- 生产路径不受影响（插件 `apply: 'serve'`，构建时不执行）。

已知限制：`TAURI_DEV_HOST` 指向局域网设备时，HMR 实际使用
`ws://<host>:1421`，而静态的 `devCsp` 只列了 `localhost`。该场景需要在
`devCsp` 中补上对应主机，或临时改为 `ws:`；v0.1.0 不为此增加动态拼接逻辑。

## 验证

- `npm run test:quality` 中的 `csp-policy.node-test.mjs`：
  策略存在、生产不允许内联/远程/通配/`eval`、dev 覆盖 HMR 端点、
  锁定指令与生产一致、ADR 已落盘。
- `npm run e2e -- csp`：
  - 把生产策略作为响应头注入真实 Chromium，断言内联 `<script>`、
    `<img onerror>`、`<iframe>` 与 `javascript:` 链接都不执行，并产生对应
    directive 的 `securitypolicyviolation` 事件；
  - 断言 Vite dev server 对 `/` 返回的 `Content-Security-Policy` 与
    `devCsp` 完全一致，且应用在该策略下正常渲染、无违规与控制台错误。
- 人工：`npm run dev` 确认窗口加载、HMR 正常且控制台无 CSP 违规；
  首次打包后确认生产窗口加载与 IPC 正常。

## 后果

- 任何新增远端资源（图片、字体、API、CDN）都会在 review 时因 CSP 被拒而暴露，
  需要显式修改策略并补测试，而不是静默生效。
- `img-src` 没有 http/https：detail 未来若允许远程图片，必须改策略 + ADR。
- WebView2 的 `connect-src` 必须包含 `http://ipc.localhost`；漏掉会让所有
  `invoke` 失败。这一点由 config 测试与 e2e 冒烟共同守住。
- 生产环境 `script-src` 只有 `'self'` 加 Tauri 注入的 nonce/hash，
  因此禁止新增内联脚本；需要内联时改用外部文件。
- 开发环境允许内联脚本，detail 的注入样本在 dev 下不会被执行层拦截；
  XSS 验收必须同时看 sanitize 的 DOM 断言与生产策略测试。

## 被拒绝的备选

- **单字符串策略**：可读性差，`'self'` 与空格分隔的 source 容易写错，
  测试也难以逐指令断言。
- **dev 与生产共用一份策略**：Vite 的内联 preamble 会触发 CSP 违规，
  HMR 断开，开发流程无法进行。
- **dev 加 `'unsafe-eval'` 以兼容未知依赖**：当前没有依赖需要它，
  开了就是无理由的放宽；需要时再评估。
- **启用 `dangerousDisableAssetCspModification`**：会丢失 Tauri 自动注入的
  nonce/hash，等于自己维护白名单，收益为负。
- **允许 `https:` 图片**：与 SPEC-detail「远程图片默认不加载」冲突，
  且会把用户工作区内容外泄到第三方。