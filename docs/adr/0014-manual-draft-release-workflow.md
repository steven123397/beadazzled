# ADR-0014: 人工触发的 Draft Release 工作流

状态：已接受（2026-11-11）
影响模块：GitHub Actions、发布签名、GitHub Releases、updater 清单、发布证据

## 背景

ADR-0005 只把质量检查接入 `ci.yml`。发布仍要求维护者在本机保存 updater
私钥、执行 Tauri 构建、生成 `latest.json`，再手动上传三个资产。这个动作重复，
而且本机构建容易把旧哈希写进发布说明。

自动化上传原本是 SPEC-release 的「Ask first」边界。维护者已明确批准半自动方案：
人工触发，Actions 构建、签名、校验并上传 Draft Release，最终 Publish 仍由人执行。

官方依据：

- Tauri GitHub pipeline 支持 `workflow_dispatch`、`contents: write` 与 Draft Release：
  https://v2.tauri.app/distribute/pipelines/github/
- Tauri updater 在构建时读取 `TAURI_SIGNING_PRIVATE_KEY`，可选密码为
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：
  https://v2.tauri.app/plugin/updater/#signing-updates
- GitHub `workflow_dispatch` 可从选定 ref 人工运行；Environment 的 secrets 只有
  通过该 Environment 保护规则的 job 才能读取：
  https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch
  https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments

## 决策

- 新增独立 `release.yml`，只接受 `workflow_dispatch`，不因 push、PR 或 tag 自动发布。
- `preflight` job 使用只读权限，要求触发 ref 精确为 `refs/heads/main`，并确认
  目标提交来自 `.github/workflows/ci.yml` 的最新 main push 运行已成功，并进一步
  核对该运行中恰好一个 `Quality gates (Windows)` job 已成功，避免同名 check、
  名为 main 的 tag 或未来被跳过的 job 替代质量门禁。Draft job 检出同一个完整 SHA，而不是在
  构建时重新解析浮动的 main。
- `draft` job 使用 `release` Environment。仓库设置必须只允许 main 部署到该
  Environment，并配置 required reviewers。私钥和可选口令只存 Environment
  secrets，只注入签名构建步骤；普通 CI 不持有这些 secrets。
- 顶层 token 权限为空；preflight 只有 `actions: read` / `contents: read`，Draft
  job 只有其所需的 `contents: write`。checkout 不持久化 token；不创建或使用 PAT。
  持签名密钥的 job 将 checkout/setup-node 固定到完整 commit SHA，而不是 movable tag。
- Windows runner、Node 24、stable Rust、`npm ci` 与质量 CI 保持同一工具链基线。
  依次执行版本校验、签名构建、`make:latest`、`verify:release`、`check:size`，
  任一失败都不得创建 Release。
- 构建前检查远端 tag 以便尽早失败；上传前再通过 GitHub API 原子创建
  `refs/tags/v<version>`，并绑定目标完整 SHA，随后用 `gh release create --draft
  --verify-tag` 上传安装包、`.sig` 与 `latest.json`。这样构建期间出现的同名 tag
  只会让创建失败，不会把 Draft 指向其他提交。Draft 创建后立即重读 tag 并再次
  比对 SHA；若 writer 在两次 API 调用之间移动 tag，运行失败并明确禁止 Publish。不使用 `--clobber`，不上传覆盖既有
  Release，不自动 Publish。同一仓库的发布运行串行，且不取消正在执行的发布。
- 当前工作流只接受稳定版 `x.y.z`；prerelease 必须失败，不得进入稳定 `latest`
  通道。beta 若未来需要，另设通道与触发规则。
- `docs/releases/v<version>.md` 是用户说明模板，不写死构建哈希。工作流从实际
  安装包计算 SHA-256，把提交 SHA、构建验签声明、字节数与哈希追加到 Draft 说明
  和 updater notes，避免复用本机旧构建的证据。模板中任何 64 位十六进制串都
  视为疑似旧哈希而拒绝，覆盖 `sha256`、`SHA-256:`、`sha256sum` 等写法。
- 多行说明通过 `make-latest-json --notes-file` 读取。Windows PowerShell 经
  `npm run --notes <多行文本>` 传递时实测会把换行后的内容丢掉，不能用作发布通道。
- Draft 上传后仍需下载回验、真实 Windows 安装/升级验证；维护者确认后才 Publish。
  Publish 后再验证 `releases/latest` 与应用内更新。失败留下的 Draft 由人检查并
  决定删除或继续处理，工作流不自动删除。

## 后果

- 日常发布不再要求本机执行完整 Tauri 构建和上传，但首次使用前必须把签名私钥
  安全地复制到 GitHub Environment secrets；私钥的暴露面因此扩大到 GitHub 的
  secret 存储与经审批的 release job。
- 工作流只有合入默认分支后才会出现「Run workflow」入口。缺少 secrets、版本说明
  或成功 CI 时应失败，不得回退成未签名构建或自动发布。
- Draft 的资产上传不是跨三个文件的本地事务；上传中断可能留下不完整 Draft 或
  已创建但尚无 Release 的 tag。这些是可见、可人工处理的状态，不得通过自动删除
  或覆盖来掩盖；重跑前由人核对 tag 指向与 Draft 内容。
- 本地手工发布可保留为故障备用，但必须执行同一套验签、哈希、四层证据与人工
  Publish 规则，不能成为绕过门禁的通道。

## 被拒绝的备选

- **push tag 后直接正式发布**：触发即影响 updater 的 latest 通道，缺少 Draft
  下载回验与人工放行。
- **继续使用 `tauri-action` 的自动发布路径**：其 Draft 能力可用，但本项目需要
  固定复用 `make-latest-json` 的规范 URL、签名版本/global signature 校验及
  `verify-release` 独立复核；使用 CLI + 现有脚本更直接，也少一个 action 依赖。
- **把签名私钥交给普通 CI**：PR 质量检查不需要发布能力，扩大 secret 与写权限
  没有收益。
- **构建成功后自动 Publish**：跳过远端附件、真实安装和更新通道确认，不符合
  本次明确批准的半自动边界。
