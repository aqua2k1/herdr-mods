# Files Plus MOD：调研与实施计划

状态：原生 MVP 已实现于 `mods/files-plus/`；下文保留调研与后续阶段，不能视为全部已交付。实际功能、限制及测试见 [README](../mods/files-plus/README.md) / [TESTING](../mods/files-plus/TESTING.md)。

目标是在原生 Files 基础上增强（按需求移除 Git 标记及状态查询），提供图片缩放、代码、Markdown 和 PDF 只读预览，覆盖 Windows / Linux / macOS，以及 Herdr 已连接的远程机器。当前 Linux/WSLg 实际窗口已验证；Windows 仅 helper 实测，macOS 未实测；远程完整窗口验收被现有机器连接故障阻塞。

## 1. 建议结论

做独立的 `mods/files-plus/`，由个人布局替换 Files 面板引用；不覆盖宿主自带 `files`，不改终端渲染，不引入 WebView。

已按交互修订：保留原生右侧 Files 树、目录层级/缩进/SVG 图标与展开状态，只改文件点击后的打开/渲染规则。文件在当前 tab 的工作区内、工作 pane 右侧新建或复用预览 pane；右侧 Files/Changes 不被替换。预览可独立原生 zoom/关闭，生命周期不与侧栏绑定；代码/Markdown 字体、字号读取终端设置，不再固定 12px。

采用 **原生 GPUI 预览器 + 统一文件来源层 + 可选 PDF helper**：

- 代码：复用已有只读 `EditorState` / `Editor`。
- Markdown：先复用 `TextView.markdown`，再解决相对图片与受控资源加载。
- 图片：用 GPUI `image()`，交互参考 Zed 的原生图片查看器。
- PDF：单独验证本地原生渲染 helper，把可见页转成图片供 GPUI 显示；不假设 PDF.js 能在当前 MOD 中运行。
- 远程：沿用 Herdr 的机器连接与 `on` 路由，不额外要求用户挂载 SSHFS，也不把远程路径当作本机路径。

先交付纯 MOD 可实现的能力，再决定是否提交小范围宿主接口补充。不能把“远程文本可读”视为“远程二进制已支持”。

## 2. 本地代码核验

本次同时只读检查了相邻的 `../herdr-app/` 源码。

| 现状 | 依据 | 对计划的影响 |
| --- | --- | --- |
| Files 已有懒加载文件树、Git 标记、焦点目录/机器跟随、状态恢复 | `../herdr-app/defaults/mods/files/main.js` | 保留文件树、目录/机器跟随和状态恢复，移除 Git 标记及相关查询；继续保持每目录 500、总计 5,000 条的保护 |
| 已有只读代码预览；显示最多 400,000 字符 | 同上 | 不再引入另一套代码编辑器 |
| `readTextFile(path, { on })` 支持远程，UTF-8 文本上限 1 MiB | `../herdr-app/defaults/herdr.d.ts`、`src/mod_files.rs`、`src/mods.rs` | 大文件不能“先读全量再截断”；远程当前实现也不等于范围读取 |
| 无 DOM、CSS、WebView；不是 Node 环境 | `../herdr-app/defaults/AGENTS.md` | PDF.js / Monaco / React 图片查看器不能直接移植 |
| 有宿主实现的受限 `fs/promises`，本机 home 可读、appHome 可写 | 同上；`src/mods.rs` 的 `capabilities()`；`vendor/gpui-kit/crates/shell/src/engine/quickjs/standard/fs.rs` | 可以读小型本地图片并暂存成应用资源；不意味着完整 Node fs，也不覆盖 home 外的所有工作区 |
| fs 单次读取上限 64 MiB、写入上限 8 MiB | `vendor/gpui-kit/crates/shell/src/engine/quickjs/host.rs` | MVP 必须在读取前检查大小，不能把超限文件直接送入缓存 |
| `image(path)` 从应用资源目录加载；有滚轮、鼠标交互 API | `vendor/gpui-kit/crates/shell/src/typings.rs` | 本地预览需资源缓存；缩放/平移可在 MOD 层实现，精确尺寸/布局能力需原型核验 |
| `TextView.markdown` 可用，但内置图片 loader 只接受绝对 HTTP(S) URL | 同上；`materialize/text_view.rs` | Markdown 正文可以先做，相对本地/远程图片不能直接交给 TextView |
| MOD 网络权限不受限 | `src/mods.rs`、`defaults/AGENTS.md` | 不能把不可信 Markdown 原样交给会自动抓外链图片的 renderer |
| 远程 exec 输出为有界文本，最多 8 MiB；无公开通用远程二进制文件 API | `defaults/herdr.d.ts`、`src/mods.rs` | Base64 仅能作小文件、有上限的过渡方案；不应承诺任意大小传输 |
| 远程不走 `watchFolder`，Files 有 10 秒刷新 | `defaults/mods/files/main.js` | 先维持轮询和手动刷新，增加当前文件版本检查 |

## 3. 参考实现与取舍

### Zed：主要参考，原生 GPUI 路线最接近

- [图片查看器源码](https://github.com/zed-industries/zed/blob/main/crates/image_viewer/src/image_viewer.rs)：借鉴 Fit、100%、缩放/平移状态、鼠标锚点缩放。Fit 默认不把小图放大。
- [Markdown 预览源码](https://github.com/zed-industries/zed/blob/main/crates/markdown_preview/src/markdown_preview_view.rs)：借鉴正文解析、图片解析、链接动作分离，不直接复制其 Rust 项目依赖。
- [远程开发文档](https://zed.dev/docs/remote-development)：借鉴本机 UI、远程文件来源的分层；Markdown 相对图片还需要单独接入资源解析。

### VS Code：借鉴文件类型分发和安全边界，不搬 Webview

- [Custom Editor API](https://code.visualstudio.com/api/extension-guides/custom-editors)：文件模型和不同 viewer 分离；同一文件可切换源代码/预览。
- [Markdown 预览实现](https://github.com/microsoft/vscode/blob/main/extensions/markdown-language-features/src/preview/documentRenderer.ts)、[安全说明](https://code.visualstudio.com/docs/languages/markdown)：资源加载必须受控。其 CSP/Webview 方案只适用于浏览器，不是 Herdr 当前可用组件。

### JupyterLab：借鉴轻量 renderer registry

- [Document 架构](https://jupyterlab.readthedocs.io/en/latest/extension/documents.html)、[RenderMimeRegistry](https://github.com/jupyterlab/jupyterlab/blob/main/packages/rendermime/src/registry.ts)：文件来源、文档状态和 renderer 解耦；按类型选择预览器。这里只实现小注册表，不引入整套插件系统。

### PDF.js：参考按需渲染，不作为当前直接依赖

- [PDF.js FAQ](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions)、[API](https://github.com/mozilla/pdf.js/blob/master/src/display/api.js)：借鉴只渲染可见页、回收离屏资源、按需读取的设计。
- [VS Code PDF 扩展](https://github.com/mathematic-inc/vscode-pdf)使用 PDF.js，但依赖浏览器环境。Herdr 当前没有其 DOM/canvas/worker 配套环境。
- 原生 helper 的候选是 PDFium / MuPDF / Poppler 路线，尚未完成打包、授权、签名及沙箱核验；P0 后才能定选型，不把系统预装工具作为三平台成立的前提。

## 4. 产品范围

### 首版

- 保留文件树、焦点工作目录/远程机器跟随、加载/错误状态。
- 不显示 Git 标记，不执行 `git status` / `git rev-parse`，移除相关状态缓存和刷新逻辑，减少本机及远程开销。
- 预览器按“扩展名候选 + 必要的文件头校验”分发；未知类型显示大小/类型及不可预览原因，不强制按 UTF-8 解码。
- 代码：语法高亮、选择复制、只读、明确的大小上限；代码/Markdown 取 `settings().font_family/font_size` 并跟随设置变化，侧栏继续使用原生 UI 字体。
- Markdown：预览/源码切换，标题、列表、表格、引用、围栏代码；不支持脚本、Mermaid 执行或任意 HTML。
- 图片：首批 PNG/JPEG，其他格式通过宿主解码测试再列入支持表；Fit、100%、放大/缩小、比例显示、双轴滚动。随后实现鼠标锚点缩放与拖拽平移。
- PDF：纵向连续页面、原生滚动、适合宽度和缩放；通过页尺寸元数据与虚拟列表，仅渲染可见页及前后邻页并回收离屏缓存。不承诺文字选择、搜索、表单、批注或 OCR。
- 本机与远程行为一致；尚未具备的传输/渲染能力必须明确提示，不能假装支持。

### 暂不做

文件编辑/保存、文件管理操作、完整 IDE、所有图片格式、超大图瓦片系统、PDF 编辑和同步滚动。避免把一个预览 MOD 扩大成文件管理器。

## 5. 架构

```text
FilesPanel（原生侧栏树、图标、缩进、选中状态）
  ├─ 文件点击 → 当前 tab 的原生 pane.split / 复用预览 pane
  ├─ PreviewController（独立 pane、类型分发、版本/请求序号、生命周期）
  ├─ FileSource（本机 / herdr-core 远程）
  ├─ ResourceResolver + Cache（Markdown 图片、图片资源、PDF 页面）
  └─ Renderers：code / markdown / image / pdf / unsupported
```

建议目录：`mods/files-plus/{main.js,mod.json,lib/,renderers/,helpers/,test/,README.md}`；布局接入说明放在 `integrations/files-plus/`。

内部资源身份统一为 `{ machine, path }`，另记录 workspace root 和目标系统的路径规则。缓存键至少包含机器、规范化路径、文件版本、预览参数（PDF 页码/DPI 等），不能只用文件名。

切换文件/space/机器时递增请求序号；旧结果不得覆盖当前预览。底层不能真正取消时，至少忽略旧结果并清理资源。关闭预览时释放 Editor、图片引用和 helper 任务。

## 6. 远程和 PDF 的关键决策

### 文件来源层

首版采用纯 MOD 方案，媒体读取上限 **5 MiB（5,242,880 字节）**。实测发现远程 `hc` 会额外 Base64 包装，整包传 5 MiB 仍可能超过内部 8 MiB 输出上限；现已改成每块最多 1 MiB 的读取协议，校验 offset/size/块数、内容与元数据版本，并作末次复检。过期请求停止后续块读取。远程 Windows 与 POSIX 分别适配，不根据本机 OS 推断远端 OS。

首版远程图片不以新增宿主接口为前提。未来若需要大文件/PDF，可与宿主维护者讨论 `stat`、有上限的二进制/范围读取、应用图片资源句柄等能力；这些不是已有 API。

过渡方案不是正式的流式传输层：Base64 有体积和复制开销，exec 有输出上限，mtime/size 检查也不能单独保证读取一致性。超限媒体的完整支持依赖正式文件接口或另行批准的传输方案。

### PDF

优先验证**本机 helper 渲染**：远程 PDF 经受限文件来源层取到本机后渲染，远端无需安装 PDF 工具。对大文件，范围读取是否可用取决于选定后端；如果后端需要完整文件，应显示下载进度并执行大小限制，不能承诺随机访问。

helper 要求：固定 argv、结构化响应、超时、输出尺寸限制、崩溃隔离、禁止 PDF JS/外部动作；在可行平台增加 OS 沙箱。单独进程不自动等于沙箱。评估三平台架构、动态库、签名、公证、许可和更新渠道，再决定随包发布还是可选安装。

当前已实现连续滚动：先读有界页尺寸元数据，再由原生虚拟列表定位可见页；串行渲染可见页及前后各一页。滚动/缩放时旧 range/DPI 结果丢弃并清理，不把整本 PDF 一次性栅格化。

## 7. Markdown 资源和安全

- `TextView` 的 HTTP 图片可能自动访问网络。首版用解析器识别并移除/占位图片及相关 HTML，再渲染正文；不要用正则替换全部 Markdown。
- 相对图片以文档所在目录为基准，在**同一机器**解析；显式允许的项目根目录之外默认拒绝，符号链接校验在文件所属机器执行。
- 本地图片不能简单改写成缓存路径后交给现有 TextView：它的 loader 只接受 HTTP(S)。后续需组合原生图片节点，或增加资源 resolver 桥接；不为此偷偷启动本地 HTTP server。
- 外链图片默认不加载；用户明确允许后再下载，并控制重定向、大小和目的地址。链接动作采用 scheme 白名单；禁止 `javascript:`、命令执行类 scheme 和任意文件打开。
- 所有 helper 使用固定命令与参数数组；涉及 PowerShell/POSIX shell 时严格处理特殊字符，不把文件名直接拼成命令。
- 缓存仅写 appHome 内专用目录，文件名使用不可冲突的资源标识。实现中使用 `layouts/files-plus-assets/`：宿主 watcher 会对该路径的删除触发原生图片缓存失效，避免只 unlink `data/` 文件而留下 GPUI 解码缓存；不修改任何布局 JSON。PDF helper 使用 owner lease，关闭后不再发布迟到输出。下载的远程内容按敏感文件处理。
- 按需求不额外设置图片像素上限，不主动压缩或降采样，保持原图细节；当前共享媒体读取层保留上述 5 MiB 文件大小限制。每个查看器只展示一张图片，不预解码其他图片；切换/关闭时释放旧图引用，并核验宿主图片缓存的实际回收行为。单张高像素图片仍可能占用大量内存，宿主解码器/GPU 的硬性限制无法取消；加载失败时给出明确提示。

## 8. 分阶段交付与验收门槛

| 阶段 | 交付 | 必须通过的门槛 |
| --- | --- | --- |
| P0 能力验证 | 最小 MOD 原型、宿主版本/能力表、PDF 后端与二进制传输决策记录 | 验证本地图片缓存/解码、自然尺寸和滚轮事件；验证 home 外工作区降级；远程 POSIX/Windows 小文件读取；PDF helper 至少一个平台单页输出，并给出另外两平台的可交付证据 |
| P1 基础 Files Plus | 独立 MOD、保留文件树、代码预览、Markdown 正文/源码、统一错误处理 | 除明确移除的 Git 功能外，原有 Files 行为无回归；验证不触发 Git 查询；路径与并发单测；`herdr-app check`；应用内查看后续异步状态 |
| P2 图片 | 本地/远程小图、Fit/100%/缩放、滚动/平移、资源生命周期 | 三平台实测；超限/损坏图不阻塞；快速切换不串图；缓存可回收；明确过渡传输大小限制 |
| P3 Markdown 资源 | 相对图片 resolver、外链策略、图片节点或宿主桥接 | 本机/远程相对路径正确；禁止越界与静默外联；源码/预览切换不丢选择文件 |
| P4 PDF | 本机 helper、远程文件接入、分页/缩放/可见页缓存 | 三平台打包与许可证核验；大文件策略；损坏/加密 PDF 提示；helper 超时/崩溃不影响窗口 |
| P5 发布 | 安装/卸载、布局迁移、依赖诊断、支持矩阵与截图 | 所有宣称支持的平台/连接组合实际验证；保留原 Files 回退入口；不修改用户默认布局与其他 MOD |

P0 完成后再估工期。代码/Markdown 正文可先发布；不能因 PDF 尚未选型而阻塞整个 MOD，也不能在 PDF 未验收前宣传为完整支持。

## 9. 测试矩阵

- 本机：Windows（盘符、UNC、大小写）、Linux、macOS；空格、中文、emoji、括号、单双引号、长路径、符号链接。
- 远程：至少覆盖 Windows 客户端→Linux、Linux 客户端→Windows、macOS 客户端→Linux，并补充同系统和 macOS 远端；完整支持声明需要对应组合的实测证据。
- 故障：离线、断线重连、权限拒绝、文件删除/替换、目录快速切换、同名跨机器文件、helper 缺失和超时。
- 资源：超限文本、非 UTF-8、二进制伪装扩展名、巨大像素图片、损坏图片、多页/加密/损坏 PDF、关闭后内存与磁盘回收。
- 安全：Markdown 外链/HTML 图片不隐式请求；路径 `..`、编码路径、symlink 越界；命令参数注入；PDF 外部动作与异常渲染成本。
- 自动化：`npm test` 覆盖纯逻辑和模拟 I/O；参考宿主 `scripts/files.test.ts` 扩展目录兼容用例。实现后运行 `herdr-app check <mod目录>`，并在真实应用里检验布局、事件、异步加载和截图。实际已运行的项目与尚未验证的部分以 `mods/files-plus/TESTING.md` 为准，不把本计划矩阵当作已通过的测试。
