# Settings 验收矩阵（2026-11-03）

状态：验收记录，回答 `bza-weo` 的「覆盖路径校验、工作区操作、诊断格式、零隐式 bd」
与 `SPEC-settings` 的 10 条 Acceptance Criteria。

命令：`npm run test:unit -- src/features/settings`、`npm run e2e -- settings`、
`cargo test --manifest-path src-tauri/Cargo.toml`。

| # | 验收标准 | 覆盖 | 结果 |
|---|---|---|---|
| 1 | 路径校验：无效路径错误可见、原配置不变；有效路径立即生效 | Rust `an_unusable_bd_path_is_rejected_and_the_previous_one_stays`、`a_new_valid_bd_path_is_persisted`；`BdSection.test.tsx` 拒绝/来源显示；e2e `settings-states` 的 detect 用例 | 通过 |
| 2 | 重新检测：清空配置后能从 PATH 发现 bd | discovery `missing_configured_path_falls_back_to_path_and_says_so`；service `clearing_the_bd_path_falls_back_to_PATH_lookup`；e2e 断言 `bd_status:refresh` 只在点「重新检测」时出现 | 通过 |
| 3 | 未安装引导：无 bd 时页面可开、winget 可复制 | e2e `settings-states`（not-found → 页面可开、命令可见、复制成功）；`App.test.tsx` 无工作区仍可进入设置 | 通过 |
| 4 | 工作区操作持久化；移除不触碰磁盘 | Rust `adding_a_workspace_persists_it_and_opens_it`、`switching_and_removing_update_the_active_workspace`（含 `assert!(first.is_dir())`）、`relocating_keeps_the_name_and_the_checkpoint_for_the_same_project`、`a_restart_reopens_the_last_workspace`；`WorkspaceSection.test.tsx` 8 例；e2e add/open/remove、relocate、switch | 通过 |
| 5 | journal 关闭有开启命令与「开启后刷新」说明 | `SyncSection.test.tsx`；e2e `settings-states` 复制 `bd config set events-journal true` | 通过 |
| 6 | 诊断真实、格式固定、无 secret | Rust `diagnostics_api`（project/dolt_mode/schema 与 fake bd 一致）；`diagnostics.test.ts` 六行格式；e2e 复制后逐行断言；`App.test.tsx` 断言无 token/secret/password | 通过 |
| 7 | 语言/主题即时生效并持久化 | `GeneralSection.test.tsx`；Rust `preferences_are_written_without_touching_the_rest_of_the_config`（flush 后重读 config）；`PreferencesBridge.test.tsx` 水合与单次写入；e2e localStorage 与 `app_set_preferences` | 通过（见未覆盖 3） |
| 8 | 零隐式 bd：打开页面不调用 bd | e2e `settings.spec` 打开后清空 log 再交互，无 `bd_status`；工作区流程只有缓存读取，无 `bd_status:refresh`；诊断只在点击后调用 | 通过 |
| 9 | 错误可见：bd 不可用 / 工作区缺失 / 配置损坏 | `BdSection.test.tsx`（not-found/unsupported/broken）；`SyncSection.test.tsx`（bd-unavailable 含 code/message/detail）；`WorkspaceSection.test.tsx`（missing）；Welcome 的 corruptBackup 由 shell 测试覆盖 | 通过（见未覆盖 4） |
| 10 | 可访问性：控件有 label、键盘可完成、axe 无严重违规 | `GeneralSection.test.tsx`/`BdSection.test.tsx` 用 label 查询控件；e2e 确认对话框焦点陷阱 + Tab 留在框内 + Escape 取消；`accessibility.spec.ts` 明暗两套设置页 axe | 通过（见未覆盖 5） |

## 复测结果（2026-11-03）

- 单测：573 passed（settings 36 条：通用 2、bd 9、工作区 8、同步 5、诊断 5、关于 3、dialog 4）
- E2E：50 passed（settings 相关 10 条：偏好、取消选择、诊断复制、工作区增删移、重新定位、bd 缺失、重新检测、journal、切换工作区、确认框键盘）
- Rust：workspace_commands 24、diagnostics_api 3、bridge 共享缓冲 1，全部通过；clippy `-D warnings`、fmt 干净
- axe：设置页明/暗 0 serious/critical
- 首屏 145.7 KB gzip（预算 150）；NSIS 2.34 MB / MSI 3.43 MB（预算 15 MB）

## 已知未覆盖

1. **原生文件/目录对话框**：`tauri-plugin-dialog` 只在真实 webview 可用。E2E 通过
   注入 picker 覆盖「选中路径」「取消」「插件不可用」三条分支，原生对话框本身
   需人工点一次确认。
2. **「打开配置目录」未实现**：需要 `opener:allow-reveal-item-in-dir`，当前
   capability 有意不授予；SPEC 里它是可选项。
3. **刷新后保持**：浏览器 E2E 每次导航都会重新注入默认配置，无法端到端复现
   「刷新后仍是上次语言」。持久化由 Rust 写入测试与 `PreferencesBridge` 水合
   测试共同覆盖。
4. **配置损坏提示**在 Welcome 显示，Settings 内不重复；diagnostics 文本也不含
   corruptBackup（SPEC 的固定六行没有该字段）。
5. **键盘完成路径选择**依赖原生对话框的键盘行为，未自动化；页面内控件的
   键盘可达性由原生控件、label 与确认框焦点陷阱覆盖。