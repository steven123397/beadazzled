# 设计截图

`docs/design/<date>-<screen>/` 存放每个屏幕的设计评审基线，供 review 和验收对照；`docs/measurements/assets/` 存放性能/发布测量的证据截图。

入库规则：

- 每个屏幕保留浅色、深色各一张主视图；状态变体只保留无法用文字说清的那几张（focus、hover、下拉展开、空状态）。
- 单张控制在 1280px 宽、通常 <100KB；截图前收起无关窗口与面板。
- 中间迭代截图不进仓库。Playwright 的 `test-results/`、`playwright-report/` 已在 `.gitignore` 中，不要手动提交。
- 暂不使用 Git LFS：目前全部入库截图约 1.9MB，仓库 `.git` 约 5.7MB，LFS 的克隆、CI、配额成本高于收益。当截图体积占仓库主体（例如接近 100MB）时再评估 LFS 或把大图移到 release/CI artifact。