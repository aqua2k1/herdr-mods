# Changes Plus：实现决策

状态：已实现于 `mods/changes-plus/`。功能、限制与测试以
[README](../mods/changes-plus/README.md) / [TESTING](../mods/changes-plus/TESTING.md) 为准。

目标：在原生 Changes 的只读 Git 行为之上，换成 Better Changes 的侧栏观感，
并把统一视图 diff 放进 Files Plus 那样的中间工作 pane。不覆盖宿主自带 mod，
不写 `.git`，不引入 staging / commit / 历史。

## 已确认的需求边界

- 侧栏分组按原生 status 字母：`Conflicts`（U / AA / DD）、`Changed`（A/M/D）、
  `Untracked`（`??`）。分组只读，不提供 stage/unstage。
- 不做提交框、Commit/Amend、Commits 历史、冲突解决、文件树/平铺切换、⋮ 菜单。
- 点击文件在**当前 tab 的工作区**内 `pane.split` 出 diff pane；每 tab 复用一个，
  通过 `shared("changes-plus.diff.<tab>")` + revision 更新。不用 `tab.new`。
- diff 只用统一视图；**Full file** 开关可在「仅变更 hunk」和「整个文件（变更行带标记）」间切换。
- diff 字体与 Files Plus 完全同源：`terminalFonts(settings())` 的
  `font_family` / `font_size`，设置变化时跟随；行高为字号 1.5 倍。

## 实现取舍

- `lib/git.js` 保留原生 Changes 的命令序列（`--no-optional-locks`、
  `core.fsmonitor=false`、`diff.autoRefreshIndex=false`）与 1000 / 1500 /
  4000 上限；解析做成纯函数以便单测。
- 整文件模式用 `git diff --unified=2000 HEAD -- <path>`：对受控文件直接得到
  带 context 行的完整 diff，不需要自己把 patch 贴回文件；未跟踪文件用
  `readTextFile` 生成单一全 `+` hunk。
- diff 行同时记 oldNo / newNo，统一视图的两列行号都来自 Git 的 hunk 头。
- 预览副本以 300ms 轮询共享的 revision / Full file / 字体键；不重建侧栏，
  也不因聚焦 preview 而二次 split。
- `lib/`、`views/` 是本地副本：mod 不能跨目录 import。SVG 图标同样随 mod 走。

## Commits tab（后续补充）

- Header 用 Changes / Commits 两个 pill 切换；Commits 沿用 Better Changes 的分组规则：
  本地未推送（上游，或从未推送时用 `origin/HEAD`）、已推送的远端分支组，特性分支再加
  `origin/HEAD` 组。只读 `merge-base` / `rev-list`，从不 fetch、push 或改仓库。
- 提交行显示 subject、作者、相对时间、短 hash；点进去是提交详情（作者/日期/正文/变更文件）。
- 提交里的文件复用同一个中间 diff pane，用 `git show <hash> -- <path>` 取变化；
  Full file 用 `--unified=2000` 显示该提交时的整个文件。50 条一页，可 Load more。

## 验收

- `npm test`、`herdr-app check mods/changes-plus`。
- `npm run test:changes-panes`：隔离 app home + 真实 Git fixture + 真实窗口，
  验证分组、共享请求、pane 复用、Full file、字体设置与截图；不碰个人布局。
