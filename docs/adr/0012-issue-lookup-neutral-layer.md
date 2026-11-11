# ADR-0012: issue 查询下沉中立层，切断 store 到 sync 的反向依赖

状态：已接受（2026-11-06 用户拍板；2026-11-09 落盘）
影响模块：`sync`、`list`、`detail`、`board`
执行票：`bza-u7k` / `bza-is8`

## 背景

前端同时存在两套 byId 构造与查找逻辑：`view/filter.ts` 的
`indexById` / `lookupFrom`，以及 `store/selectors.ts` 的 `indexIssues` /
`getIssue`。`view/ready.ts` 又单独声明了 `IssueLookup`。旧 `getIssue` 的
byId 已由 null-prototype 记录承载，本身不会泄漏 `Object.prototype`；但它
依赖直接属性读取，若改接普通对象就没有 `lookupFrom` 的 own-property 防护，
两个入口对同一 id 的语义并不一致。

此外，`store/selectors.ts` 为使用 `emptyRecord` 而引用
`sync/reducer.ts`，形成 store → sync 的反向依赖。现有边界脚本只检查
Dolt、进程与参考实现引用，没有覆盖这条前端分层。

## 决策

1. 新建中立叶子模块 `src/lib/issues/index.ts`，统一提供 byId 构造器、
   带 `Object.hasOwn` 防护的查找器和 `IssueLookup` 类型。store 与 view
   都依赖它，不再各自维护一套。
2. 详情页专用的 `IssueIndex`（byId + dependents 反向边）仍留在
   `src/lib/store/selectors.ts`，但 byId 必须复用中立构造器；看板只构造
   byId，不额外建立详情专用的反向边。selectors 内部可以继续直接读取这些
   由本模块构造的 null-prototype 记录；接受外部普通对象的公开查找入口则
   统一经过 `lookupFrom` 的 `Object.hasOwn` 防护。
3. `emptyRecord` 从 `src/lib/sync/reducer.ts` 移到叶子模块
   `src/lib/records.ts`。sync、store 与其他调用方可以依赖该叶子，store
   不再为记录工具引用 sync。
4. `scripts/check-boundaries.mjs` 增加 `lib-store-to-sync` 规则，禁止
   `src/lib/store/*` 通过别名或相对路径引用 `src/lib/sync/*`。相对路径按
   导入文件位置归一化，避免把嵌套 store 目录自己的 `../sync/*` 误判为
   跨层引用。该检查与 `CONSTRAINTS.md` 同步登记。
5. 边界脚本仍是逐行文本扫描，不是模块解析器：非 `@` 别名、模板字面量、
   字符串拼接、间接 mock 与多行变体可能漏报，这些非常规形式仍由 review
   覆盖，不把脚本通过当作完整证明。

## 后果

- 新增 view / store → issues 的依赖方向，以及 sync / store → records 的
  叶子依赖；这些方向在 `docs/spec/capability-map.md` 中登记。
- 所有 issue 查找统一采用防原型链语义，详情页不再保留较弱的直接属性
  查询入口。
- 看板不再为了 byId 而建立 dependents 反向边；详情页仍一次构建完整的
  读写关系索引。
- B6 阻塞解除后，后续选择器调用方收敛可以使用同一中立模块，而无需
  重新引入 view ↔ store 或 store → sync 依赖。

## 被拒绝的备选

- **统一收敛到 `store/selectors.ts`**：会让 view 依赖 store，并容易通过
  store 间接依赖 sync，不能形成清晰的叶子边界。
- **保留两套查找器**：重复逻辑会继续漂移，且原型链防护只在部分调用方
  生效。
- **把 `emptyRecord` 并入 `utils.ts`**：该文件当前承载 Tailwind class
  合并，会把 UI 样式工具引入纯数据层的依赖图；独立 records 叶子更窄。
