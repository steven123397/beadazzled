# ADR-0003: bridge 覆盖率用 Rust 工具链测量

状态：已接受（2026-10-31）
影响模块：`bridge`、CI、质量门禁（CONSTRAINTS）

## 背景

`CONSTRAINTS.md` 要求 `bridge` 行覆盖 ≥ 80%，但原来的命令写的是
`npm run test:unit -- --coverage`。`npm run test:unit` 跑的是 Vitest，只能统计
TS/TSX；而 `bridge` 是 `src-tauri/src/bridge/` 下的 Rust 模块（见
`docs/spec/capability-map.md` 的 Module Map 与 Testing Strategy）。这条门槛因此
无法测量它声称要测的代码，bridge 零测试时仍会显示「通过」——属于
CONSTRAINTS 明令禁止的静默假绿。

## 决策

- `bridge` 覆盖率改用 **cargo-llvm-cov**（依赖 rustup 的 `llvm-tools-preview`）。
- 新增 `npm run test:rust:coverage`，实现于
  `scripts/check-bridge-coverage.mjs`；阈值逻辑在
  `scripts/lib/bridge-coverage.mjs`，用 `node --test` 单测覆盖。
- 只统计 `src-tauri/src/bridge/`（以及 `bridge.rs`）下的文件；行覆盖 ≥ 80% 才通过。
- bridge 尚未实现时，脚本输出明确提示并退出 0：不是静默跳过，而是
  「无可测代码」，且 CONSTRAINTS 的例外在 bridge 落地前仍然有效。
- Vitest 覆盖率（`test:unit -- --coverage`）继续服务前端，不再承担 bridge 门槛。
- `check:task` 接入 `test:rust:coverage`。

## 后果

- bridge 一旦有代码，覆盖率不足 80% 会让 `check:task` 失败（block）。
- 本机需要：`rustup component add llvm-tools-preview` +
  `cargo-llvm-cov`（CI 上对应安装步骤，见 `SPEC-release` 的门禁接入）。
- cargo-llvm-cov 会以插桩方式重新编译依赖，首次构建较慢；如果 bridge 落地后
  实测超过 CONSTRAINTS 的 90s 任务层预算，把该检查移到 `check:full` 并更新
  CONSTRAINTS（仍用 ADR 记录）。
- 前端覆盖率目前无门槛；待基线明确后在 CONSTRAINTS 中 ratchet。

## 被拒绝的备选

- **把门槛改成 TS 层**：会放弃对真正会坏的 bridge 层的约束，等于弱化检查。
- **继续用 Vitest 覆盖率冒充 bridge 覆盖率**：假绿，直接违反 CONSTRAINTS。
- **用 `cargo test` 的测试数量代替覆盖率**：无法反映行覆盖，阈值失去意义。