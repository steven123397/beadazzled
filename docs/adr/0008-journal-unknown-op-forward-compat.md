# ADR-0008: journal 未知 op 的前向兼容形状

状态：已接受（2026-11-01）
影响模块：`bridge` 类型层、`src/bindings/bd.ts`、sync 契约、`SPEC-bridge`
相关：bza-ryr.21；类型实现见 `src-tauri/src/bridge/types.rs`

## 背景

`JournalRecord.op` 原本是 7 变体的封闭枚举（`create` / `update` / `close` /
`delete` / `dep_add` / `dep_remove` / `comment`）。serde 反序列化遇到未知变体
会失败，而 journal 是逐行流式解析并且 `follow` 长期运行：bd 未来新增一个
操作（例如 `reopen`）会让**从该行起的所有记录**变成 `BD_PARSE_FAILED`，
跟随进程事实上停摆。

`SPEC-bridge` 的既有原则是「bd 升级不丢数据、不静默降级」，因此这里既要
“不认识也不崩”，也要保留原始值以便诊断。

## 决策

- `JournalRecord.op` 改为 **`String`**，原样保存 wire 上的 op。
- 保留 `JournalOp` 枚举作为**已知操作的类型化视图**，并提供：
  - `JournalOp::as_wire()` / `JournalOp::from_wire()`；
  - `JournalRecord::op_kind() -> Option<JournalOp>`，未知 op 返回 `None`。
- serde 不再用枚举解析该字段，未知 op 的行照常解析；sync 侧按
  `op_kind()` 分发，`None` 的记录**忽略但推进 seq**。
- ts-rs 绑定随之变为 `op: string`；`JournalOp` 联合类型仍导出，供前端比较
  已知值或做常量表。
- `SPEC-bridge` 的 TS 契约、解析规则与验收项同步更新。

## 后果

- bd 新增 journal 操作不会破坏解析或 follow；原始 op 字符串保留在记录里，
  诊断页和日志能看到实际值。
- Rust 调用方失去字段上的编译期封闭联合，改用 `op_kind()` 做类型化匹配；
  必须显式处理 `None`，而前向兼容本来就需要这个分支。
- TS 侧 `op` 不再是字面量联合：拼写错误不会被编译器发现。用导出的
  `JournalOp` 做比较或维护 op → 文案的映射表来约束；这也是未知值必须被
  允许的固有代价。
- `as_wire()` 的字符串与 serde 的 `rename_all = "snake_case"` 是两处来源，
  用表驱动测试（`JournalOp::ALL` 往返）锁住一致性。

## 被拒绝的备选

- **`#[serde(other)] Unknown`**：serde 只允许在 internally/adjacently tagged
  枚举上使用；即使可行，它也把原值折叠成 `Unknown`，丢失诊断信息，与
  「未知数据保留」的原则不一致。
- **`JournalOp::Unknown(String)` + 自定义 serde**：能同时保留原值与类型，
  但 ts-rs 会把带数据的变体生成为 `{ "unknown": string }` 之类的形状，
  需要手写 `TS` 实现并维护；当前收益不足以抵消复杂度。
- **保持封闭枚举**：一个未知 op 就让整条 journal 失败，直接破坏 follow，
  与 `CONSTRAINTS.md` 的「检查失败不许静默降级」在方向上也冲突——这里
  需要的不是失败，而是可解释地跳过。