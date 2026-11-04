# ADR-0011: 内存预算改为「总工作集 + 数据增量」

状态：已接受（2026-11-04）
影响模块：`release`、`list`、`board`、`detail`
测量记录：`docs/measurements/2026-11-04-memory.md`

## 背景

CONSTRAINTS 原定「常驻内存（1000 条票）≤150 MB」，来源是 WebView2 占用
的粗略猜测，没有实测。2026-11-04 用 release 构建 + 真实 bd 工作区测量：

| 场景 | 总工作集 | 说明 |
|---|---|---|
| 1 条票 | 436–449 MB | host 35–38 MB；WebView2 browser 127–138 MB；GPU 106–129 MB；renderer 80–99 MB；utility 约 60 MB；crashpad 12 MB |
| 1000 条票 | 445–457 MB | 数据增量约 +9 MB，JS heap 5.5 MB，DOM 约 1,047 个节点 |

固定的 WebView2 多进程开销占 95% 以上。应用代码无法把 GPU 进程和 browser
进程降到 150 MB 以内，因此原预算在任何构建上都会失败，失去门禁意义。

## 决策

- **指标**：应用 host 进程 + 该 WebView2 profile 下全部
  `msedgewebview2.exe` 进程的工作集总和；列表就绪后连续采样取中位数。
- **预算**（两项同时满足）：
  - 1000 条票总工作集 ≤ **600 MB**；
  - 相对 1 条票基线的增量 ≤ **50 MB**。
- `npm run measure:memory` 同时测量 1 条与 1000 条，任一项超标即 FAIL。
- 基线与目标使用相同的构建、profile 与采样流程；DevTools 连接本身会增加
  约 10–20 MB，两次测量都在连接后采样，因此增量比较不受影响。

参考机（Windows 11 Home China 10.0.26300，WebView2 156.0.4314.58）：
基线约 445 MB，1000 条约 455 MB，增量约 +9 MB。

## 后果

- 预算反映真实占用，而不是无法达到的猜测值；应用侧的数据保留与渲染回归
  仍有 50 MB 的增量信号。
- WebView2 或 Windows 升级会让总量漂移；增量门槛更稳定，总量作为兜底。
- 预算仍是 CONSTRAINTS 的 warn 项，连续三次超标按原规则提 issue 或重设。

## 被拒绝的备选

- **维持 150 MB**：所有构建都会失败，等于关闭门禁。
- **只测 JS heap**：5.5 MB 的数字很好看，但漏掉 WebView2 的主要成本。
- **只测 host 进程**：35 MB 同样掩盖 renderer、GPU 与 utility 的开销。
- **私有字节（Private Bytes）**：更接近增量成本，但与任务管理器「内存」
  列的口径不同，实测基线仍在 350 MB 量级，无法回到 150 MB。