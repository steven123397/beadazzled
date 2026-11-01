# ADR-0006: Beads config 的 secret 卫生

状态：已接受（2026-11-01）
影响模块：仓库 secret 卫生、`check:secrets`、CI

## 背景

`.beads/config.yaml` 被 git 跟踪，仓库是 public。bza-ryr.6 最初判断：
`bd config set` 会把 `github.token` / `linear.api_key` 明文写入该文件，唯一
防线是 gitleaks 的模式匹配。

实现前复核了 bd 1.3.2 的实际行为：

- 对 **git-tracked** 的 config.yaml，bd 拒绝写入 secret 键，并提示改用环境变量
  或 `git rm --cached`；只有 `--force-git-tracked` 能绕过。
- 取消跟踪后，同一条命令会成功把 token 明文写入 config.yaml。
- 删除 config.yaml 后 `bd context` 仍可用，但 `events-journal` 默认 false，
  且 `bd config set` 报 `no config.yaml found`。
- `.beads/hooks/*` 不含 secret 检查；gitleaks 只在 `check:fast` / CI 运行时执行。
- 当前 config 无 secret，gitleaks 扫描 19 个 commit 无泄露。

因此真正的残余风险是：`--force-git-tracked`、手动编辑、bd 版本行为变化，以及
gitleaks 对未知/token 形状的漏报；不是 bd 的默认写入路径。

## 决策

- **保留 `.beads/config.yaml` 的 git 跟踪**，保住 bd 的运行时拒绝，并避免
  `events-journal` 与 `sync.remote` 在每个 clone 上重新配置。
- 新增确定性检查 `scripts/lib/beads-config.mjs::findSecretConfigKeys`：
  - 忽略注释与空行；
  - 支持 bd 的嵌套形状（`github:` → `token:`）与扁平点号键（`github.token:`）；
  - 任何 active 键的末段匹配 `token` / `api_key` / `api_token` / `access_token`
    / `password` / `secret` / `credential(s)` 即视为违规。
- `npm run check:secrets` 在 gitleaks 之前执行该检查；违规时即使 gitleaks
  通过也返回非零。CI 的 `check:fast` 因此自动覆盖。
- 增加 quality test：解析器的嵌套/扁平/注释/非 secret 兄弟键用例，以及当前
  被跟踪 config.yaml 的断言。
- 在 `CLAUDE.md` 与 `CONSTRAINTS.md` 明确：集成密钥只走环境变量，禁止
  `bd config set --force-git-tracked`。

## 后果

- 任何把 secret 写进 active `config.yaml` 的提交都会在 `check:fast` / CI 失败。
- 三层防线：bd 的 git-tracked 拒绝（第一层）、确定性键检查（第二层）、
  gitleaks（第三层）。
- 解析器只覆盖 bd 实际写出的 block YAML；如果有人手写成 inline flow map
  （`github: {token: x}`）或带引号的键，仍可能漏过，review 与 gitleaks 兜底。
  出现这种需求时再引入完整 YAML 解析器，不提前加依赖。
- 如果未来某个非 secret 配置键合法地以 `token` 结尾，需要扩展白名单并在本
  ADR 记录；当前没有这种键。

## 被拒绝的备选

- **取消跟踪 + `config.yaml.example` 模板**（bd 自己的建议）：会让 bd 失去
  运行时拒绝，secret 可被写入本地明文文件；同时每个 clone 需要复制模板并重新
  开启 `events-journal`，`bd config set` 在文件缺失时还会直接失败。
- **只写文档、不加检查**：依赖人/agent 自觉，gitleaks 对未知 token 形状可能漏报。
- **为此引入完整 YAML 解析依赖**：当前只需覆盖 bd 的固定 block 形状；一旦有
  真实需求再升级，避免为假设的输入增加依赖。