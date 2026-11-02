# Spec: workspace — bd 发现与工作区管理

状态：v0.1.0 · 依赖：`bridge` · 被 `shell` / `settings` 消费

## Objective

让用户**添加一次、之后双击即回**：

- 发现可用的 `bd`（显式路径 → PATH），并校验版本；
- 添加 / 切换 / 移除 beads 工作区，记住最近使用；
- 为 `sync` 提供持久化的 journal 检查点与工作区身份，避免在错误的工作区上续读 seq；
- bd 缺失或版本不符时给出可执行的引导，而不是白屏。

**决策**：bd 由用户自备，应用永不捆绑（bd 约 150 MB，见 [capability-map](capability-map.md)）。

## bd 发现与校验

解析顺序（找到即停）：

1. 注册表中的 `bdPath`（用户在设置页显式指定）；
2. PATH 中的 `bd`（Windows 上为 `bd.exe`）。

校验：

```
bd --version            → 解析 semver；< 1.3.2 → unsupported
bd -C <ws> context --json → 确认工作区有效并取 project_id
```

状态模型：

```ts
export type BdStatus =
  | { kind: 'ready'; path: string; version: string }
  | { kind: 'not-found'; searched: string[] }
  | { kind: 'unsupported'; path: string; found: string; min: string }
  | { kind: 'broken'; path: string; error: BridgeError };
```

- `not-found` → 引导页显示 `winget install --id GasTownHall.Beads -e` 与「手动指定路径」按钮。
- `unsupported` → 显示实际版本与最低要求；允许仍以只读方式打开（见 Open Questions）。
- 版本检查结果在进程内缓存；设置页「重新检测」可强制刷新。

## 工作区校验与身份

添加工作区：

1. 用户选择目录（目录选择器，或从最近列表恢复）。
2. 运行 `bd -C <dir> context --json`（超时 10s）：
   - 成功 → 取 `repo_root` 作为规范路径（用户可能选中子目录），取 `project_id` 作为身份；
   - `WS_NOT_BEADS` / `WS_INACCESSIBLE` → 拒绝添加并显示原因。
3. 以 `repo_root` 的规范化绝对路径去重；已存在则直接切换，不重复登记。

身份与检查点：

- 检查点按 `project_id` 归属。打开时若当前 `project_id` 与登记值不同（数据库被重建/替换）→ **丢弃检查点，做一次完整基线**，避免在另一套 seq 空间上续读。
- `is_worktree: true` 的工作区允许添加；界面标注「worktree」。
- `dolt_mode` 记录到诊断信息；embedded 是 v0.1.0 唯一支持的模式（server 模式不禁止，但不做专门适配）。

## 注册表

位置：Tauri `app_config_dir()/config.json`。原子写入（临时文件 + rename），写入去抖 500ms，退出前强制落盘。

```ts
export type AppConfig = {
  schemaVersion: 1;
  bdPath: string | null;                 // 显式路径；null 表示走 PATH
  language: 'en' | 'zh-CN';
  theme: 'light' | 'dark' | 'system';
  lastWorkspacePath: string | null;
  workspaces: WorkspaceEntry[];
};

export type WorkspaceEntry = {
  path: string;                          // repo_root 规范绝对路径
  name: string;                          // 默认取目录名，可重命名
  projectId: string;
  isWorktree: boolean;
  lastOpenedAt: string;                  // ISO 时间
  checkpoint: { seq: number; savedAt: string } | null;
};
```

- 注册表**不保存任何 secret**。
- 读取失败（损坏 JSON）→ 原文件改名为 `config.corrupt-<timestamp>.json`，以空配置启动并在界面提示；不得静默清空用户数据。
- 工作区目录被删除/移动 → 条目保留并标记 `missing`，提供「移除」与「重新定位」。

## 生命周期

```
启动
  → 读注册表
  → 解析 bd（not-found 时停在引导页）
  → 有 lastWorkspacePath? 打开它 : 显示工作区选择
  → sync 基线（异步；shell 先可交互）

切换工作区
  → 停止当前 sync 跟随进程
  → 读目标检查点（project_id 匹配才用）
  → 启动基线

移除工作区
  → 停止跟随（若是当前活动工作区）
  → 删除注册表条目；不触碰磁盘上的 .beads
```

- v0.1.0 同一时刻只有一个活动工作区。
- 切换期间列表显示骨架屏，不回退到空列表。

## Acceptance Criteria

1. **发现顺序**：配置路径优先于 PATH；配置路径失效时回退 PATH 并在诊断中提示；两者都失败 → `not-found` 且显示 winget 命令。
2. **版本门槛**：1.3.2 / 1.10.0 通过；1.2.9 → `unsupported`；输出不可解析 → `broken`。
3. **添加校验**：普通文件夹 → `WS_NOT_BEADS`，注册表不变；有效工作区 → 以 `repo_root` 入表。
4. **去重**：同一工作区（不同写法路径）只登记一次；重复添加只触发切换。
5. **持久化**：重启后自动打开上次工作区；注册表原子写入，模拟写入中途崩溃不产生半文件。
6. **损坏恢复**：损坏的 config.json 被改名保留，应用以空配置启动并提示。
7. **身份变化**：project_id 变化时丢弃检查点并完整基线（journal 重新从头读）。
8. **缺失目录**：启动时目录不存在 → 显示错误并提供移除/重新定位，不崩溃。
9. **切换隔离**：切换工作区后，旧工作区的跟随进程已终止（fake bridge 断言），新工作区只用自己的检查点。
10. **路径健壮**：含空格、中文、长路径的工作区可添加、切换、读取。
11. **无 secret**：注册表与日志中不出现 token、密码、私钥（gitleaks + 单测断言字段白名单）。
12. **启动预算**：shell 在 bd 校验完成前即可交互；bd 校验不阻塞首屏（骨架屏 + 状态栏）。

## Module Commands

- `npm run test:unit -- src/lib/workspace` — 注册表读写、去重、损坏恢复
- `npm run test:rust` — bd 发现与 `context` 解析
- `npm run e2e` — 添加/切换/重启恢复流程

## Module Structure

```
src-tauri/src/workspace/
  discovery.rs     bd 路径解析、版本校验、缓存
  registry.rs      AppConfig 读写、原子写、损坏恢复
  validate.rs      context 调用与工作区身份
src/lib/workspace/
  useWorkspace.ts  当前工作区、切换、状态
  recent.ts        最近列表与展示
tests/fixtures/workspace/  context 样本、损坏配置样本
```

## Module Code Style

- 配置结构在 Rust 与 TS 两侧同名同形；TS 侧由 ts-rs 生成，避免手写漂移。
- 文件写入统一走 `registry.rs` 的 `save_atomic`，不允许组件层直接写文件。
- 路径一律先规范化再比较（大小写不敏感、分隔符统一）。

## Boundaries

- **Always**：添加前用 bd 校验；检查点绑定 project_id；原子写；损坏可恢复。
- **Ask first**：支持 bd server 模式、显示多活动工作区、改变注册表位置或字段。
- **Never**：捆绑 bd；读取 `.beads/embeddeddolt/`；在注册表存密钥；静默丢弃损坏配置；自动删除用户目录。

## Open Questions

1. **bd 2.x 策略**：当前按「< 1.3.2 拒绝」实现；2.x 是否只读放行、写操作需显式确认，待 bd 2.x 出现后决定（不阻塞 v0.1.0）。
2. **工作区重命名**：v0.1.0 只展示目录名，是否允许自定义显示名（仅影响 UI）——倾向允许，成本低，实现时确认。
3. **多窗口**：v0.1.0 单窗口单活动工作区；多窗口各自绑定工作区留到后续版本。