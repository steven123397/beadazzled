# Capability Map: beadazzled

状态：2026-10-31 经用户批准。模块边界、依赖方向或构建顺序如需变化，先改本文件再改模块 spec。
首个发布：**v0.1.0**（用户指定，不从 v1 起算）。
数据通路依据：`viking://user/win-dev/peers/github.com-steven123397-beadazzled/resources/community-data-paths/community-data-paths.md`
质量契约：[CONSTRAINTS.md](../CONSTRAINTS.md)（本文件不得弱化其中任何一条）。

## Objective

Windows 桌面应用，成为 **beads 前端在 Windows 上的最好选择**：Linear 水准的观感、文档级阅读体验、功能面对标 Scotty（含写操作）、装上即用。

- **用户**：因为 beads 没有好前端而转去用 Linear 的尝试者；已经在用其它 beads 前端、想要更好阅读与键盘体验的 Windows 开发者。
- **为什么现在**：社区前端在 Windows 上要么不支持（b9s 明确不支持），要么必须 clone + build + 起本地服务（Scotty）；beads 官方明确不做 UI。
- **成功**：下载安装 → 添加仓库 → 在 List / Board 看到全部票 → 打开详情像读文档一样读完正文、验收、评论、上下游 → 顺手改状态或评论，全程不开终端。
- **分发**：开源免费（MIT），GitHub Releases，应用内自动更新。
- **v0.1.0 不做**：Graph、依赖编辑、formula / molecule / gate / swarm、团队协作与权限、macOS / Linux、直连 Dolt、把 bd 全部子命令搬上 UI。

## Global Tech Stack

| 层 | 选择 | 说明 |
|---|---|---|
| 桌面壳 | Tauri v2（Rust 后端） | 安装包体积、WebView2 复用、进程控制能力 |
| 前端 | React 19 + TypeScript + Vite | 团队与生态熟悉度 |
| 样式 | Tailwind v4 + CSS 变量 | 主题与密度可控 |
| 组件 | shadcn/ui 源码内联（基于 Radix） | 组件进仓库、可改可审计；不引入运行时组件库 |
| 命令面板 | cmdk | Linear 式 ⌘K |
| 拖拽 | dnd-kit（含 keyboard sensor） | 看板键盘可达 |
| 虚拟滚动 | `@tanstack/react-virtual` | 1000 条 60fps |
| 状态 | Zustand + 归一化 ticket store | 无 HTTP，不引入 TanStack Query |
| 路由 | react-router-dom v7（hash history） | 深链接与返回 |
| UI 参考 | Circle（MIT）· Cuelark Linear 主题（MIT） | 按组件移植、记 NOTICE；见 [ADR-0001](../docs/adr/0001-ui-foundation-and-linear-references.md) |
| Markdown | react-markdown + remark-gfm + rehype-sanitize | 详情页文档阅读 |
| 测试 | Vitest + Testing Library / cargo test / Playwright / tauri-driver | 见测试策略 |
| 发布 | NSIS x64 + tauri-plugin-updater（minisign）+ GitHub Releases | 不做 Authenticode，见 `SPEC-release` |

**版本要求**：`bd` ≥ 1.3.2（journal 语义与 `--if-status` 守卫按此实现）；应用自身从 v0.1.0 起。
**bd 获取**：用户自备。解析顺序为「设置中的显式路径 → PATH」。**永不捆绑 bd**（bd 本体约 150 MB，与 15 MB 安装包预算冲突）。

## Commands

| 用途 | 命令 |
|---|---|
| 开发（Tauri） | `npm run dev` |
| 仅前端 + IPC mock | `npm run dev:web` |
| 类型检查 | `npm run typecheck` |
| Lint | `npm run lint` |
| 前端单测 | `npm run test:unit` |
| 覆盖率 | `npm run test:unit -- --coverage` |
| Rust 测试 | `npm run test:rust` |
| 生成 TS 绑定 | `npm run gen:bindings` |
| 绑定漂移 | `npm run check:bindings` |
| 架构边界 | `npm run check:boundaries` |
| 生产构建 | `npm run build` |
| 安装包 | `npm run build:app` |
| 安装包体积 | `npm run build:app && npm run check:size` |
| E2E | `npm run e2e` |
| 性能测量 | `npm run measure:startup` / `measure:memory` / `measure:navigation` / `measure:scroll` |
| 发布校验 | `npm run verify:release` |

## Project Structure

```
src/
  app/                应用壳：路由、providers、全局键盘、状态栏
  features/           功能面：list / board / detail / settings / workspace
  components/         共享展示组件（无业务逻辑）
  lib/                IPC 客户端、store、i18n、markdown、格式化
  bindings/           ts-rs 生成的 TS 类型（禁止手改）
  styles/             全局样式与主题变量
src-tauri/
  src/bridge/         bd 进程层、argv 构造、解析、错误码（唯一允许 spawn bd 的地方）
  src/sync/           基线与 journal 跟随、事件应用、实时性状态机
  src/workspace/      bd 发现、工作区注册表与校验
  src/commands/       Tauri command 暴露面
  tests/              Rust 集成测试
  examples/           fake_bd 测试桩（测试专用）
scripts/              边界、体积、性能、发布校验脚本
tests/
  fixtures/bd/        录制自真实 bd 的 export / events JSONL 样本
  e2e/                Playwright 与 tauri-driver 用例
spec/                 本目录
docs/adr/             架构决策记录（编号递增，不删旧）
```

## Code Style

- TypeScript：Prettier（2 空格、单引号、trailing comma `es5`、行宽 100）；ESLint flat config；组件 PascalCase，其余 camelCase；文件名 kebab-case；禁止默认导出（路由懒加载等框架要求除外）。
- Rust：rustfmt 默认 + clippy `-D warnings`；生产路径禁止 `unwrap` / `expect`；错误用 `thiserror` 枚举，对外只暴露稳定错误码。
- 注释解释「为什么」，不复述代码；每个模块的公开接口在 spec 中先定义再实现。

```ts
// src/features/list/filter.ts
export function matchesFilter(issue: Issue, filter: ListFilter): boolean {
  if (filter.status.length > 0 && !filter.status.includes(issue.status)) return false;
  const query = filter.query.trim().toLowerCase();
  return query === '' || issue.title.toLowerCase().includes(query) || issue.id.includes(query);
}
```

```rust
// src-tauri/src/bridge/error.rs
#[derive(Debug, thiserror::Error)]
pub enum BridgeError {
    #[error("bd not found at {path}")]
    BdNotFound { path: String },
    #[error("bd timed out after {timeout_ms}ms: {command}")]
    Timeout { command: String, timeout_ms: u64 },
}
```

## Testing Strategy

| 层 | 工具 | 位置 | 覆盖对象 |
|---|---|---|---|
| 纯逻辑单测 | Vitest | 与源码同目录 `*.test.ts` | store reducer、筛选/排序、格式化、i18n 键一致 |
| 组件测试 | Vitest + Testing Library | 同上 | 列表/详情/看板渲染与键盘行为（mock IPC） |
| Rust 单测/集成 | cargo test | `src-tauri/tests/` | argv 构造、JSONL 解析、错误映射、超时与管道 |
| 浏览器 E2E | Playwright | `tests/e2e/` | 完整 UI 流程（mock IPC，不出真 bd） |
| 真实 E2E | tauri-driver | `tests/e2e/` | 3 条：安装→列表、详情阅读、改状态并持久化 |
| 性能/体积 | 脚本 | `scripts/` | CONSTRAINTS 中的数值预算 |

**硬规则**：bridge 单测禁止 spawn 真 `bd`，只用 `examples/fake_bd` 与录制样本；真 `bd` 只出现在 3 条真实 E2E。

## Global Boundaries

**Always**
- 票数据只经 `bd` 命令获取；所有 bd 调用收敛到 `bridge`。
- 每个写操作先写 beads issue，再改代码；质量检查按 CONSTRAINTS 分层执行。
- 失败必须可见：区分「没有数据」与「读不到数据」。
- 用户输入进入 argv 前必须走结构化参数；长正文走 stdin。

**Ask first**
- 新增运行时依赖（尤其是 >50 KB 的前端包）。
- 修改 `CONSTRAINTS.md` 的阈值或检查项。
- 变更模块边界、依赖方向或数据契约。
- 引入需要网络的服务（更新源除外）。

**Never**
- 打开或解析 `.beads/embeddeddolt/` 下任何文件。
- 递归监听 `.beads/`。
- 用 shell 拼接命令；把用户文本拼进命令行字符串。
- 静默降级（失败退回空列表）。
- 在交互路径上调用 `bd`（启动基线、显式刷新与写命令除外）。
- 提交 secrets；捆绑 bd 二进制。

## Module Map

| Module id | Responsibility | Depends on | 阶段 |
|---|---|---|---|
| `bridge` | bd 进程层：argv-only、隐藏窗口、超时、进程树终止、管道宽限、错误码映射；export / events / 写命令的类型化封装 | — | v0.1.0 |
| `sync` | 启动基线 → journal 末尾 → 增量跟随；正常/关闭/裁剪/不可用四态；断档重建与写后回声 | bridge | v0.1.0 |
| `writes` | 写队列：串行化、去重、状态守卫、失败回显、超时 | bridge | v0.1.0 |
| `workspace` | bd 发现与版本校验、工作区添加/切换/最近列表、注册表持久化 | bridge | v0.1.0 |
| `shell` | 窗口框架、路由、命令面板、键盘系统、主题、i18n、状态栏 | workspace, sync | v0.1.0 |
| `list` | 列表视图：筛选/分组/排序/搜索/虚拟滚动 | shell, sync | v0.1.0 |
| `detail` | 文档式详情：正文、验收、评论、依赖阅读、编辑入口 | shell, sync, writes | v0.1.0 |
| `board` | 看板：派生列（Backlog / Ready / In Progress / Blocked / Done）、拖动改状态、键盘移动 | shell, sync, writes | v0.1.0 |
| `settings` | 设置页：bd 路径、语言、主题、工作区管理、诊断 | shell, workspace | v0.1.0 |
| `release` | NSIS 安装包、自动更新、签名与四层发布校验、性能/体积接线 | shell | v0.1.0 |
| `graph` | 关系图 | shell, sync | v0.2.0（本阶段不写 spec） |

依赖方向单一、无环。`graph` 在 v0.1.0 不实现，也不在构建序列内。

## Build Order

```
bridge → workspace, sync, writes → shell → list → detail → board → settings → release
                                                                      (v0.2.0) graph
```

- `workspace` / `sync` / `writes` 三者只依赖 `bridge`，可并行；`sync` 与 `writes` 之间的回声协作以接口约定为准（`SPEC-writes` 定义调用顺序）。
- `shell` 是第一个可视交付点；`list` 之后每完成一个屏幕即可独立验收。

## Contract Ownership

| 契约 | 归属 spec | 消费者 |
|---|---|---|
| bd 命令、argv、输出解析、错误码、类型绑定 | `SPEC-bridge` | 所有模块 |
| 实时性状态机、事件应用语义、快照/增量一致性 | `SPEC-sync` | shell、list、detail、board |
| 写命令映射、队列、竞争守卫、回声等待、状态修改守卫（依赖拦截） | `SPEC-writes` | detail、board |
| 工作区注册表、bd 发现与版本 | `SPEC-workspace` | shell、settings |
| 路由、快捷键、主题令牌、i18n 键 | `SPEC-shell` | list、detail、board、settings |
| 发布通道、更新签名、四层证据 | `SPEC-release` | — |

## Module Specs

- [SPEC-bridge](SPEC-bridge.md)
- [SPEC-sync](SPEC-sync.md)
- [SPEC-writes](SPEC-writes.md)
- [SPEC-workspace](SPEC-workspace.md)
- [SPEC-shell](SPEC-shell.md)
- [SPEC-list](SPEC-list.md)
- [SPEC-detail](SPEC-detail.md)
- [SPEC-board](SPEC-board.md)
- [SPEC-settings](SPEC-settings.md)
- [SPEC-release](SPEC-release.md)

## Open Questions（全局）

1. **跨机同步后的可见性**：`bd dolt pull` 合入的数据不进 journal，v0.1.0 只靠显式刷新（`Ctrl+R`）与降级时聚焦刷新补齐；是否接受这个已知缺口作为 v0.1.0 行为。
2. **工作区数量上限**：注册表不设上限，但 v0.1.0 同一时刻只保留一个活动工作区的 journal 跟随进程。

已定：bd 2.x 不在 v0.1.0 考虑范围，出现大版本变动时再评估；许可证为 MIT。