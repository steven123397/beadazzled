# ADR-0013: Prettier 行尾策略 endOfLine=auto 与 format:check 接入 CI

状态：已接受（2026-11-11）
影响模块：工程脚本、CI、质量门禁（CONSTRAINTS）
执行票：`bza-pzb.2`

## 背景

仓库 Git 配置为 `core.autocrlf=true`，Windows 工作区跟踪文件为 CRLF，
而 `.prettierrc` 未声明 `endOfLine`，Prettier 3 默认按 `lf` 检查。结果是
`npm run format:check` 在本机一次性报告 286 个文件，检查事实上不可用；
CI（`windows-latest`，checkout 后同样为 CRLF 工作区）也因此从未接入该
门禁。Phase 1–5 期间积累了 55 个存在真实格式漂移的文件（24 个末尾缺换行，
31 个有换行/宽度差异），与行尾问题混在一起无法区分。

## 决策

1. `.prettierrc` 声明 `"endOfLine": "auto"`：按各文件现有行尾检查，
   Windows CRLF 工作区与 LF checkout 的结果一致、可重复。配置写入
   `.prettierrc` 而非 npm script 的 CLI 参数，使编辑器 Prettier 插件与
   命令行行为一致。
2. `npm run format:check` 接入 CI，作为 `check:fast` 之后的阻塞门禁；
   不并入 `check:fast`，因为编辑循环有 ≤5s 预算，全仓格式检查不属于该层。
3. 存量 55 个失败文件以单独 commit 修复（仅 `prettier --write`，无行为
   变更），与策略变更分开，便于审查与回溯。
4. 不引入 `.gitattributes` 全仓行尾规范化，不做无关全仓格式化。

## 后果

- 本机（`core.autocrlf=true`）与 CI 的 `format:check` 结果可重复，格式
  漂移重新成为可执行的 block 门禁，防止继续积累。
- `auto` 不强制新文件采用统一行尾：文件行尾以其首个换行为准，混合行尾
  会被规范为该风格。接受这一宽容度，因为仓库 blob 在 `core.autocrlf=true`
  下始终以 LF 存储，行尾差异不进入版本库。
- 若未来需要强制统一行尾，再评估 `.gitattributes`（`eol=lf`）+ 工作区
  重新检出的方案，届时需独立 ADR。

## 被拒绝的备选

- **`endOfLine: "lf"` + `.gitattributes` 强制 LF 检出**：长期更严格，但
  要求全仓工作区一次性重新检出（touch 所有文本文件），超出收尾票范围；
  且当前贡献环境只有 Windows，收益主要是防御性的。
- **修改本机 `core.autocrlf` 或要求贡献者改 Git 配置**：把仓库质量建立在
  不可控的机器配置上，CI runner 行为也无法随之约束。
- **跳过失败文件、删除检查或全仓格式化换绿灯**：CONSTRAINTS 明确禁止；
  这些做法要么掩盖真实漂移，要么制造无关 diff。
