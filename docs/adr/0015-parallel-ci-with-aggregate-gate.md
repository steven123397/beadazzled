# ADR-0015: CI 两路并行与同名汇总门禁

状态：已接受（2026-11-11）
影响模块：GitHub Actions、branch protection、发布 preflight、Rust 工具链缓存

## 背景

ADR-0005 使用单个 `Quality gates (Windows)` job 串行执行所有检查。2026-11-11
最近一次 main 运行耗时 902 秒，其中：

- `cargo-llvm-cov` 安装 113 秒，Rust fmt/clippy 135 秒；
- `check:bindings` 约 176 秒，bridge coverage 约 197 秒；
- Rust 链合计约 621 秒，而其余前端、脚本和浏览器工作约 4 分钟。

因此按 lint、format、unit 等小步骤拆很多 job 不能缩短关键路径。真正有价值的是
Rust 与其他工作并行。但 branch protection 只要求 `Quality gates (Windows)`，
发布 preflight 也核对这个同名 job，直接拆成多个独立检查会让部分失败绕过门禁。

官方依据：

- `needs` 汇总依赖与 `always()`：
  https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idneeds
  https://docs.github.com/en/actions/reference/workflows-and-actions/expressions#always
- cache 精确命中、miss 后成功保存及 `cache-hit` 输出：
  https://docs.github.com/en/actions/using-workflows/caching-dependencies-to-speed-up-workflows

## 决策

- `ci.yml` 保留原 PR 与 main push 触发条件，设两个无相互依赖的执行 job：
  - `frontend`：fast checks、格式、前端 build/bundle、boundaries、脚本 quality、
    Vitest、Playwright E2E、依赖审计；gitleaks 仍需 `fetch-depth: 0`。
  - `rust`：Rust 组件、`check:bindings`、Rust fmt/clippy、bridge coverage。
    bindings 必须先于本工作区内后续 cargo test。相关 Node 脚本只使用内置模块，
    此 job 不运行 `npm ci`。
- 新增 `quality` 汇总 job，显示名仍为 **`Quality gates (Windows)`**：
  `needs: [frontend, rust]` 且 `if: always()`。它显式读取两路 result，任一路非
  success 都以失败退出。branch protection、发布 preflight 和门禁名称不变。
- 本地 `check:task` 保持原有顺序与内容；CI 直接调用相同子检查，避免在并行 job
  中再次串行执行整个 `check:task`。不删除测试、不降低覆盖率或其他阈值。
- 使用 `actions/cache` 只缓存 `~/.cargo/bin/cargo-llvm-cov.exe`，key 绑定 runner OS、
  CPU 架构与固定版本 0.9.1，不使用旧版本 restore key。精确命中才跳过安装；miss 仍执行
  `cargo install cargo-llvm-cov --version 0.9.1 --locked`。随后总是执行
  `cargo llvm-cov --version`，损坏或不完整的恢复结果直接失败。
- CI 的 checkout、setup-node、cache 全部固定到官方完整 commit SHA，与发布工作流
  的供应链边界一致。cache 中不放 secrets、token 或项目 target 目录。

## 后果

- 按单次实测估算，墙钟时间约从 15 分钟降至 10–11 分钟；cache 命中后可能约 9
  分钟。这些是估算，不是实测承诺，必须以随后真实 PR/main 运行为准。
- 两个执行 job 会重复少量 checkout/setup，增加总 runner 工作量，但并行缩短等待。
  Rust job 共享自己的 cargo 编译产物，不再继续拆分 Rust 内部步骤。
- 首次运行或工具版本变化仍会支付 `cargo-llvm-cov` 编译时间；cache 只在 job 成功
  后保存。缓存不承载凭据，固定 key 也不复用其他版本的二进制。
- 汇总 job 是实际阻塞门禁。若未来增加执行 job，必须同步加入 `needs` 与结果检查，
  不能只让新 job 在旁边运行。

## 被拒绝的备选

- **按每个小检查拆 job**：增加 npm/setup 重复，且不能缩短约 10 分钟的 Rust 关键路径。
- **把每个 job 都设为 branch protection required check**：增加仓库外部配置与
  发布 preflight 耦合，也不需要；同名汇总已能保持单一门禁。
- **本轮缓存 `src-tauri/target`**：沿用 ADR-0005 的谨慎结论，先缓存小而稳定的
  工具二进制，不在没有新证据时引入大体积、频繁失效的 target cache。
- **通过删除 main push、减少测试或降低阈值提速**：不改变本次已确认的触发与门禁，
  这些都不是本次并行化的手段。
