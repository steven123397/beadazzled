# ADR-0004: 未知字段的保留方式与 TS 形状

状态：已接受（2026-11-01）
影响模块：`bridge`、前端类型层（`src/bindings/bd.ts`）
相关：`spec/SPEC-bridge.md` 契约：类型；实现见 `src-tauri/src/bridge/types.rs`

## 背景

`SPEC-bridge` 要求「未知字段必须保留」，以保证 bd 升级不丢数据。Rust 侧用
`#[serde(flatten)]` 把未知字段收进 `extra`。实现 `bza-3ej` 时，原 spec 的 TS
片段把 `extra` 写成嵌套属性：

```ts
export type Issue = { ...; extra: Record<string, unknown> };
```

这与实际 wire 形状冲突，且 ts-rs 的能力也限制了实现方式：

1. **serde flatten 在 wire 上平铺。** 序列化 `Issue` 时不会产生 `"extra"` 键，
   未知字段（`_type`、`close_reason`、`lease_expires_at` 等）与已知字段同级。
   TS 若声明 `extra` 属性，前端访问 `issue.extra` 永远是 `undefined`，这是
   编译器抓不到的静默错误。
2. **ts-rs 10.1 无法直接表达 flatten map。** `#[ts(type = "...")]` 不允许与
   `#[ts(flatten)]`（由 serde 属性推导）同时使用；`serde_json::Map` 没有 `TS`
   实现；启用 `serde-json-impl` 后映射到 `HashMap`，其 `inline_flattened()`
   会 panic（ts-rs 不支持 flatten map）。

## 决策

- Rust 侧维持 `#[serde(flatten)] pub extra: ExtraFields`，wire 形状与
  `bd export` 保持一致，fixture 可以原样往返。
- `ExtraFields` 是 `#[serde(transparent)]` newtype，包裹
  `Map<String, Value>`；手写 `TS` 实现，`name()` / `inline()` /
  `inline_flattened()` 都返回 `{ [key: string]: unknown }`。这样 ts-rs 能
  把它合并进父对象。
- 生成的绑定用索引签名，而不是嵌套属性：

  ```ts
  export type Issue = {
    id: string;
    ...
    comment_count: number;
    [key: string]: unknown;
  };
  ```

  所有承载 bd 数据的类型（`Comment`、`Dependency`、`JournalRecord`、
  `WorkspaceContext`）都按同样方式保留未知字段。
- **未知字段是逃生舱，不是常规访问路径。** 某个 key 一旦有业务含义，就把它
  提升为 Rust 命名字段并重新生成绑定；不长期靠 `issue['some_key']` 访问。
- `spec/SPEC-bridge.md` 的 TS 片段同步为索引签名，避免文档与生成物漂移。

## 后果

- TS 类型与跨 IPC 的 JSON 一致；不存在「声明了但运行时没有」的 `extra` 属性。
- 索引签名让拼错属性名的访问合法且类型为 `unknown`（如 `issue.assigne`），
  这是保留任意未知字段的固有代价；用「提升为命名字段」规则控制影响面。
- 读取未知字段时需要显式收窄，例如：
  `const reason = issue['close_reason']; if (typeof reason === 'string') { ... }`。
- 绑定由 `npm run gen:bindings` 生成，fixtures 往返测试
  （`src-tauri/tests/bridge_types.rs`）与 `git diff --exit-code src/bindings`
  共同守住该契约。

## 被拒绝的备选

- **取消 flatten，把 `extra` 序列化成嵌套对象。** 与 `bd export` 的形状不一致，
  会破坏 fixture 往返的意义；若同时保留 flatten 反序列化，则需要自定义
  `Serialize`，增加一个不直观的分叉。
- **保留嵌套 `extra` 的 TS 声明。** 类型会撒谎，前端得到静默 `undefined`；
  违反「检查失败不许静默降级」的同类原则。
- **升级 ts-rs 12 换取可能的 flatten map 支持。** 需要把 MSRV 从 1.77.2
  抬到 1.78，且未验证其行为；为一个约 20 行的补丁改动工具链基线不值得。
- **手写/后处理 TS 绑定。** 放弃 Rust 作为唯一事实来源，长期必然漂移。