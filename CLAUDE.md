## 项目约定

- idea：`docs/ideas/`，一个想法一个文件
- 决策记录：`docs/adr/`，编号递增，不删旧
- 规格：`SPEC.md`；多模块用 `spec/SPEC-<id>.md` + `spec/capability-map.md`；外部工具：无
- task：单一来源为 beads（本项目 `.beads`，通过 `bd` 读写），plan 由 `bd create --graph` 建图承载，不另建 `tasks/plan.md`、`tasks/todo.md`
- 子智能体模型：派发时显式传 `model` —— code-reviewer、security-auditor 用 opus；doubt-challenger、test-engineer、web-performance-auditor 用 sonnet
- 以上文件在第一次真正产出时创建，不预建空目录