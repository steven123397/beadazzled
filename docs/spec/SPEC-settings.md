# Spec: settings — 设置与诊断

状态：v0.1.0 · 依赖：`shell`、`workspace`

## Objective

把「为什么没数据/为什么不能写」变成用户自己能看懂、能修的状态：

- 指定或重新检测 `bd`；
- 管理多工作区；
- 查看同步与 journal 的真实状态；
- 切换语言、主题；
- 复制一份可粘贴到 issue 的诊断信息。

## 页面结构

```
通用       语言（en / zh-CN） · 主题（light / dark / system）
bd         当前路径 · 版本 · [重新检测] · [指定路径] · 安装引导
工作区     列表（名称、路径、project id、最近打开）· 添加 / 移除 / 重新定位
同步       实时性状态 · lastSeq · 上次刷新 · journal 开关与引导 · [立即刷新]
诊断       bd context 摘要 · dolt_mode · schema · 最近 20 条调用/错误 · [复制]
关于       应用版本 · 开源许可 · 仓库链接 · [检查更新]
```

## 各区块行为

### 通用

- 语言、主题切换即时生效并写注册表（见 `SPEC-shell`）。
- 不提供「遥测」「自动发送崩溃报告」类开关（v0.1.0 无遥测）。

### bd

- 显示当前解析来源（`configured` / `PATH`）与版本。
- 「指定路径」选择文件后立即执行 `bd --version`：
  - 成功且 ≥1.3.2 → 保存；
  - 失败 → 保留原路径，显示错误码与原因。
- 「重新检测」清空缓存重新走发现顺序。
- 未找到时展示 `winget install --id GasTownHall.Beads -e`，提供复制按钮。
- 版本不满足时显示实际版本与最低要求（1.3.2）。

### 工作区

- 列表项：显示名、`repo_root`、project id 短码、最近打开时间、worktree 标记、`missing` 标记。
- 操作：添加（目录选择）、移除（仅注册表，不删文件，二次确认）、重新定位（选择新目录后沿用展示名）、切换为当前。
- 当前活动工作区有明确标识；点击切换后回到该工作区的 List。
- 同一路径重复添加直接切换，不重复登记。

### 同步

- 显示 `SyncState` 的完整文案、lastSeq、上次刷新时间、检查点时间。
- journal 关闭时：显示「实时更新已关闭」，给出 `bd config set events-journal true` 复制按钮，并说明开启后需刷新一次。
- 「立即刷新」触发一次基线（与 `Ctrl+R` 等价）。
- 显示最近一次错误的错误码、时间、摘要（可展开 detail）。

### 诊断

- 来源为 bridge 的调用环形缓冲（最近 200 次，展示最近 20 条）与 `bd context --json` 结果。
- 「复制诊断」生成纯文本块：

```
beadazzled <version>
bd <version> at <path>
workspace: <repo_root>
project: <project_id> · dolt_mode=<mode> · schema=<n>
sync: <state> · lastSeq=<n> · lastRefresh=<iso>
error: <code> — <message>
```

- 不包含任何 token、密钥、完整正文；路径与票 id 允许出现。
- 可选「打开配置目录」按钮（系统文件管理器）。

### 关于

- 应用版本来自 Tauri `getVersion()`。
- 仓库链接用系统浏览器打开。
- 「检查更新」调用 updater（见 `SPEC-release`）；无更新时显示「已是最新」。

## Acceptance Criteria

1. **路径校验**：指定无效路径 → 错误可见、原配置不变；指定有效路径 → 立即生效并在诊断中显示 `configured`。
2. **重新检测**：清空配置路径后点「重新检测」能发现 PATH 中的 bd。
3. **未安装引导**：bd 缺失时设置页仍可打开，winget 命令可复制。
4. **工作区操作**：添加/移除/重新定位/切换全部生效并持久化；移除不触碰磁盘。
5. **journal 引导**：`journal-disabled` 时显示开关命令与「开启后刷新」说明。
6. **诊断真实**：`bd context` 字段与真实值一致；复制内容格式固定、可解析、无 secret。
7. **即时生效**：语言与主题切换无需重启；刷新设置页后仍保持。
8. **零隐式 bd**：打开设置页本身不调用 bd；只有「重新检测 / 指定路径 / 立即刷新 / 检查更新」会触发。
9. **错误可见**：bd 不可用、工作区缺失、配置损坏三类状态都有对应提示。
10. **可访问性**：表单控件有 label；键盘可完成路径设置与工作区切换；axe 无严重违规。

## Module Commands

- `npm run test:unit -- src/features/settings`
- `npm run e2e -- settings`

## Module Structure

```
src/features/settings/
  SettingsView.tsx
  GeneralSection.tsx
  BdSection.tsx
  WorkspaceSection.tsx
  SyncSection.tsx
  DiagnosticsSection.tsx
  AboutSection.tsx
```

## Module Code Style

- 设置项只经 `workspace` 的 registry API 读写，不在组件里直接写配置文件。
- 诊断文本由纯函数生成（`buildDiagnostics(config, state, calls) => string`），便于快照测试。
- 所有危险操作（移除工作区）使用统一确认对话框。

## Boundaries

- **Always**：校验后再保存；错误可见；诊断无 secret；危险操作二次确认。
- **Ask first**：加入遥测/崩溃上报；增加网络请求；改变配置文件位置。
- **Never**：保存密钥或 token；静默重置配置；在没有用户操作时调用 bd（诊断页按需刷新）。

## Open Questions

1. **日志文件**：v0.1.0 只在内存保留环形缓冲，不落盘；是否需要可选日志文件（便于远程排障）待定。
2. **检查更新位置**：设置页与关于区块各有一个入口是否重复，倾向只在「关于」保留。
3. **重新定位**：是否允许把已有条目指向一个 project_id 不同的工作区（等同替换）——当前拒绝并要求先移除，避免检查点串库。