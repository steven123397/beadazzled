# ADR-0017: localStorage 安全读写下沉到独立叶子

状态：已接受（2026-11-12 用户拍板）
影响模块：`shell`、`list`
决策票：`bza-hn2`；执行票：`bza-0z6`

## 背景

i18n、theme、shell/layout 与 view/storage 各自重复实现 localStorage 读写：
解析 storage、读取、写入及异常降级共八份 `try/catch`。这些逻辑需要共同保证
`window.localStorage` 属性访问、存储方法及编解码失败都不会破坏当前界面操作，
分散实现容易让后续修改只覆盖部分调用方。

各模块真正拥有的是不同的 key、类型守卫、默认值和编解码：语言与主题读取原始
字符串，侧栏保存布尔值，列表视图还要经过 JSON 校验和 URL round-trip。共享层
不应把这些领域规则合并成统一配置。

A5 已将 throwing-localStorage 测试桩收敛到 `src/test/storage.ts`，本决策不再
重复处理测试夹具。

## 决策

1. 新建零依赖叶子 `src/lib/persisted.ts`，提供：

   ```ts
   readSetting<T>(key, decode, fallback, storage?): T
   writeSetting<T>(key, encode, value, storage?): void
   ```

2. `readSetting` 在 `try` 内解析 `storage ?? window.localStorage`。缺失值返回
   `fallback`；storage 属性访问、读取或 `decode(raw)` 抛出异常时也返回同一
   回退值。`writeSetting` 在同一保护范围内完成 storage 解析、`encode(value)`
   和 `setItem`，任何失败都只丢失持久化，不向调用方抛出。
3. 只迁移 i18n、theme、shell/layout 与 view/storage 四个 localStorage 模块。
   各模块继续拥有自己的 key、默认值和编解码；view/storage 的 JSON 解析、结构
   校验和 URL 规范化仍由视图层负责，作为 `decode` 传入。
4. 不迁移 `session-position.ts`。它使用 sessionStorage 并承载工作区位置恢复，
   不为本次收敛增加存储区域参数或扩大验证范围。
5. 新 helper 用直接单测固定缺失值、读写异常和解编码异常语义；四个调用模块的
   既有测试必须无修改通过，以证明可见行为和回退行为不变。

## 后果

- i18n、theme、shell/layout 与 view/storage 新增到 `persisted.ts` 的单向叶子
  依赖；该落点登记在 `docs/spec/capability-map.md`，两个相关模块 spec 同步说明。
- 安全读写语义只有一份实现，调用方仍显式拥有各自的回退值与编解码，不引入
  全局配置描述符或统一存储 schema。
- 组件 props、URL、可见字符串和用户操作行为均不变；不增加运行时依赖。

## 被拒绝的备选

- **保留四份读写脚手架**：异常处理容易继续漂移，重复注释也不能保证行为一致。
- **并入 `utils.ts`**：该文件当前负责 Tailwind class 合并，会把无关的样式工具
  与持久化协议混在同一模块。
- **本次一并泛化 sessionStorage**：需要扩大 API 和位置恢复测试范围，不是迁移
  四个 localStorage 调用方所必需的改动。
- **用默认参数解析 `window.localStorage`**：参数会在进入函数体的 `try` 之前
  求值，无法在存储被禁用时按现有语义安全降级。
