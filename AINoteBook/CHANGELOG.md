# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 嵌入文档卡片新增「全屏」按钮，全屏浮层铺满顶栏以下区域（顶栏保留可操作），右上角或 `Esc` 关闭返回主文档。
- 嵌入 PDF 卡片与全屏浮层新增「替换附件」：在 Chrome 阅读器中标注后，点阅读器「下载」导出带标注 PDF，再用「替换附件」覆盖原附件，实现标注半自动保存。
- 文档内搜索新增「替换」与「全部替换」，支持替换为空（即删除匹配）；搜索结果数量随正文编辑实时刷新。
- 目录面板高亮跟随正文滚动，自动定位当前阅读章节。
- 数学公式：斜杠命令插入行内 / 块级公式，正文输入 `$...$` 自动转为行内公式；点击公式打开编辑框（LaTeX 输入 + 实时预览，可删除），KaTeX 渲染；Markdown 导出保留 LaTeX 源。
- 公式图片识别：编辑框内上传公式图片，用浏览器本地模型（texify）自动识别为 LaTeX；首次使用需下载约 360MB 模型并缓存，之后离线，图片不上传。

### Changed

- 全局搜索跳转到结果后，关闭文档内搜索不再跳到文档末尾，光标停留在命中位置。
- 左侧文件树的文件夹默认收起，刷新后保持收起；打开文档时仍自动展开其所在路径。

### Tests

- 新增 `scripts/check-embed-fullscreen.mjs`、`check-embed-replace.mjs`、`check-search-replace.mjs`、`check-toc-spy.mjs`、`check-sidebar-collapse.mjs`、`check-math.mjs`。

## [0.22.0] - 2026-11-05

### Added

- 顶栏备份菜单新增「流式导出全部笔记」：优先用 File System Access 直接写入所选文件，失败时回退 OPFS 暂存下载或内存 Blob 下载；现有「导出全部笔记」保持不变。
- 备份菜单新增「流式从备份恢复」：读取 ZIP 中央目录后按条目流式解压，不再整包载入内存；不支持流式解压时自动回退现有「从备份恢复」。
- 全局搜索：`Ctrl/Cmd+K` 打开居中弹窗，按标题与正文检索全部活动笔记，显示路径与命中片段；点击结果打开文档并跳到第一处。侧栏产品图标下方新增「搜索全部笔记」按钮，与快捷键等效。
- 搜索索引与图片引用索引共用首次正文扫描，一次建立 `ainb.search.<id>` 与 `ainb.assetRef.<id>`，编辑时增量更新。

### Changed

- 正文输入只保存正文与图片引用，不再在每次防抖保存时重写整棵树。
- 图片清理改用 `ainb.assetRef.<docId>` 引用索引，启动时不再读取全部文档正文；索引缺失时按批重建，回收站中的文档仍计为引用。
- Markdown ZIP 与全量备份导出时只读取一次资源索引，同一图片 Blob 在多篇文档间复用；图片、PDF / Word 原始文件改用 STORE 压缩，Markdown 与 JSON 保持 DEFLATE。

### Tests

- 新增 `scripts/check-asset-refs.mjs`，覆盖输入不写树、引用键生成、索引重建、回收站引用保护与永久删除后的图片清理。
- 新增 `scripts/check-stream-export.mjs`，覆盖 FSA 主路径、取消选择、OPFS 回退、Blob 回退、临时文件清理与流式恢复。
- 新增 `scripts/check-global-search.mjs`，覆盖共用索引构建、中文/英文跨文档命中、路径与片段、回收站排除、结果跳转高亮与增量索引。
- 新增 `scripts/check-sidebar-search.mjs`，覆盖侧栏搜索入口的位置、点击打开与关闭。
- `check-backup.mjs` 增加导出读取次数与 ZIP 压缩方法断言。

## [0.21.0] - 2026-11-04

### Added

- 回收站：侧栏底栏入口与数量；删除的文档 / 文件夹先移入回收站，可恢复或永久删除；主文档恢复时附件文件夹一并恢复；附件文件夹只能随主文档处理；清空回收站需输入「确认清空回收站」。
- 侧栏支持折叠与拖拽调整宽度，状态在刷新后保留。
- 全量备份：顶栏备份菜单「导出全部笔记」导出 ZIP，包含所有活动文档的 Markdown、原始编辑器 JSON、图片、附件文件夹、PDF/Word 原文件与 `manifest.json`；启动时按从未备份、超过 30 天或文档数变化 ≥10 篇显示非阻塞提醒，支持 7 天后再提醒或不再提醒。
- 合并恢复：顶栏备份菜单「从备份恢复」选择备份 ZIP，将内容恢复到各分区新建的「备份恢复 &lt;时间&gt;」文件夹；恢复时生成新节点 ID 并重映射父子、附件与嵌入关系，不覆盖现有笔记。

### Changed

- 工作区删除改为软删除并写入 `deletedAt`，永久删除只在回收站内执行；永久删除后触发图片资源清理与存储统计刷新。
- 已删除节点从侧栏、工作区、嵌入文档选择器与拖拽候选中过滤；附件文件夹不可单独删除。
- 新增 `src/lib/treeIndex.ts` 派生只读索引：按 `nodes` 引用缓存，提供 O(1) 节点 / 子节点 / 附件查找与 O(子树) 回收站整包；侧栏、工作区、拖拽与回收站改走索引。
- 正文输入只更新待保存内容，不再改写树数组，避免每次按键重建索引与重渲染侧栏。
- 只读 Markdown 渲染的嵌入文档补充 `data-doc-id` / `data-doc-type` / `data-name`，备份 ZIP 可写回嵌入相对路径。

### Tests

- 新增 `scripts/check-trash.mjs`，覆盖移入回收站、刷新保留、附件文件夹子行恢复、永久删除与清空验证。
- 新增 `scripts/check-backup.mjs`，覆盖备份提醒、7 天 snooze、忽略、全量 ZIP、manifest、Markdown 相对路径、原始 JSON、PDF 原文件与合并恢复的 ID 重映射。
- 更新 `check-stage1.mjs`、`check-embed-export.mjs`、`check-image.mjs` 以匹配回收站流程。

## [0.20.0] - 2026-11-04

### Added

- GitHub Pages 工具集合站：站点根 `/AITOOLS/` 为工具索引，AINoteBook 部署在 `/AITOOLS/AINoteBook/`。
- 启动更新检测：线上版读取同源 `version.json`，发现新版本时弹窗提示；确认后刷新页面加载最新构建，选择「稍后」在本次会话内不再提示。
- 新增 `npm run build:pages`，以 `/AITOOLS/AINoteBook/` 为 base 构建线上版本。

### Changed

- 重构依赖方向：新增 `domain/` 纯领域命令与 `application/` 用例层；移除 `lib -> store` 反向依赖，`useNoteStore` 改为编排用例与持久化。
- 新增架构守卫 `npm run check:arch`，禁止 `lib -> store`、`store -> components` 等反向依赖；`npm run check` 已包含该检查。
- 图片灯箱改为全宽显示，右上角小 × 关闭，长图可在灯箱内滚动。
- 数据模型重构：树元数据改为 `ainb.tree.v2`，Markdown 正文拆分到 `ainb.node.<id>` 独立键；文档增加 `attachmentFolderId`，附件文件夹增加 `ownerDocId`；节点增加 fractional-index `order`，首次加载自动从 `ainb.tree.v1` 迁移。

### Tests

- 新增 `scripts/check-update.mjs`，覆盖新版本弹窗、稍后、立即更新、同版本与请求失败。
- 新增 `scripts/check-architecture.mjs`，检查 domain/application/lib/store 的依赖方向。
- `check-embed-md.mjs` 在检查文件树前先展开附件文件夹，匹配附件默认折叠行为。
- 更新 `check-image.mjs`、`check-tree-drag.mjs` 等自测，改为读取 `ainb.tree.v2` 与 `ainb.node.<id>`；测试夹具通过清空 v2 触发 v1 迁移。

## [0.12.0] - 2026-11-02

### Added

- 工作区浏览：点击「空间 / 私人」或文件夹，中栏显示其下的文件夹与文档；顶部面包屑可点击返回上级区域或文件夹。
- 嵌入文档归档：新嵌入的文档放入主笔记同级的「<主文件名>附件」文件夹；打开旧笔记时，与主文件平级的嵌入文档会自动迁入；附件文件夹默认折叠。
- 目录默认只显示一、二级，三级及之后折叠；用户手动展开/折叠在编辑过程中保留，切换笔记后恢复默认。
- 删除主文件时同步删除其附件文件夹与嵌入文档。
- 左侧支持拖拽文档 / 文件夹到目标文件夹或区域根目录；拖动主文件时附件文件夹与嵌入文档同步移动，附件内文档跨区域时 `area` 一并更新；附件文件夹及其中文档不可单独拖拽；目标已有同名附件文件夹时阻止移动并提示。
- Markdown ZIP 导出包含附件文件夹；导入 ZIP 时恢复附件文档与嵌入卡片（Markdown / PDF / Word），附件文件夹内未嵌入的文件也会一起导入。
- 导入支持 Markdown + 图片 ZIP：读取压缩包中的 Markdown 与 `assets/photos/` 图片，写入资源库后转换为可编辑笔记。
- 单文件 Markdown 导入支持 data URI 图片，导出后可在另一台电脑直接恢复图片。

### Fixed

- 修复导出的带图片 Markdown 无法在另一台电脑导入的问题。

### Tests

- 新增 `scripts/check-import-zip.mjs`，覆盖 ZIP 与单文件 data URI 图片导入、资源写入与刷新后持久化。
- 新增 `scripts/check-workspace.mjs`，覆盖区域/文件夹浏览、面包屑回退、侧栏高亮与刷新行为。
- 新增 `scripts/check-embed-export.mjs`，覆盖嵌入文档归档、附件文件夹默认折叠、ZIP 导出附件、跨设备导入恢复 Markdown / PDF / Word 嵌入，以及删除主文件同步删除附件。
- 新增 `scripts/check-toc-default.mjs`，覆盖目录默认展开一、二级、三级及之后折叠与手动展开。
- 新增 `scripts/check-tree-drag.mjs`，覆盖主文件附件捆绑移动、跨区域 area 更新、附件节点锁定与同名附件冲突。

## [0.11.0] - 2026-11-02

### Added

- 代码块语言选择：右上角显示当前语言，支持按名称、短名与中文别名搜索，选择结果随文档持久化。
- 代码块名称与复制：头部左侧可命名，名称仅保存在文档中、不进入任何导出；右侧复制按钮一键复制代码，并显示「已复制」反馈。
- 代码块语法高亮：基于 lowlight / highlight.js，覆盖常用语言及额外语言，适配浅色与深色主题；Markdown 导出保留语言围栏，PDF / 打印导出保留语言标识与高亮。
- 链接工具：悬停链接显示地址卡片，可复制链接；编辑弹窗支持修改 URL 与链接标题，删除链接时保留文字。
- 选区格式工具条：拖拽选中文字后显示加粗、斜体、下划线、链接、着色按钮；着色面板提供文字颜色、背景色、无颜色与自定义调色盘。
- 标题入口扩展到 H4 / H5：斜杠菜单新增「标题4」「标题5」，支持 `/h4`、`/h5`、`/bt4`、`/bt5` 等匹配。
- 目录折叠：目录按标题层级展示，有下级的标题可折叠 / 展开整棵子树；点击标题文字仍可跳转。
- 嵌入文档支持上传 Markdown：在「嵌入文档」弹窗中可直接上传 `.md` / `.markdown` 文件，解析后生成笔记并插入嵌入卡片，展开即可就地预览。

### Fixed

- 修复代码块语言下拉的搜索框点击后焦点被「点击空白处继续写」抢走、输入字符落入代码块的问题。
- 修复输入 `settings.py`、`script.sh`、`README.md` 等文件名时被自动识别为超链接的问题；自动链接现在只识别以 `http://`、`https://` 或 `www.` 开头的明确网址。
- 修复代码块名称在中文输入法组合输入时一个字母重复成多个的问题；名称输入框改为非受控，组合期间不由 React 回写值。
- 修复直接下载 PDF 时，编辑器中处于收起状态的折叠列表内容溢出、与下方内容重叠的问题；折叠块在 PDF 中统一展开，并以普通块布局导出。
- 修复直接下载 PDF 按固定高度分页导致文字行、表格行、图片与代码块被横向切断的问题；分页点改为避开内容边界，必要时在页底留白。
- 修复浏览器打印方式中折叠列表默认收起的问题；打印文档同样改为展开式普通块，不再依赖原生 `<details>` 的打印行为。

### Tests

- 新增 `scripts/check-codeblock.mjs`，覆盖语言搜索、选择、持久化、深浅主题高亮、代码块命名、复制、Markdown 与 PDF 导出、只读预览与搜索框焦点回归。
- 新增 `scripts/check-link.mjs`，覆盖链接悬停卡片、复制、编辑地址与标题、取消修改、删除链接保留文字。
- 新增 `scripts/check-toolbar.mjs`，覆盖选区工具条、加粗/斜体/下划线、文字颜色、背景色、自定义颜色与选区链接。
- `check-stage3.mjs` 增加 H4 / H5 斜杠插入断言。
- 新增 `scripts/check-toc.mjs`，覆盖目录层级、折叠全部下级、单独折叠子级与点击跳转。
- 新增 `scripts/check-embed-md.mjs`，覆盖在嵌入弹窗上传 `.md`、标题 / 列表 / 代码块渲染、文件树生成与刷新后持久化。
- 新增 `scripts/check-pdf-direct.mjs`，覆盖收起状态折叠块在 PDF 中的展开与不重叠、分页边缘留白与多页生成。
- 新增 `scripts/check-pdf-print.mjs`，覆盖浏览器打印文档中折叠块展开、内容可见与顺序正确。

## [0.1.0] - 2026-11-02

### Added

- 本地优先的「空间 / 私人」文档树，支持文件夹、文档、重命名、级联删除与展开收起。
- 基于 Tiptap 的 Markdown 编辑器：标题、列表、待办、引用、代码块、分割线、表格、Details 折叠块。
- 斜杠命令菜单，支持中文、英文、全拼与首字母匹配。
- 复杂表格：右侧 / 底部 / 右下角加行加列、自适应列宽、拖动列分隔线、工具条与右键菜单删除行/列/整表。
- 着重块：带边框与左上角 💡 图标，支持斜杠 `/着重`、`/zhuozhong`、`/zzk` 插入。
- 图片：粘贴 / 拖拽、SHA-256 去重、两段式放大灯箱、IndexedDB 资源存储与宽限期 mark-sweep。
- 嵌套文档：Markdown、PDF、Word（.docx）引用与就地预览。
- 文档内搜索、目录面板、导入 Markdown / Word、导出 Markdown 单文件 / ZIP 与 PDF 直接下载 / 浏览器打印。
- 浅色 / 深色双主题、固定纸张高度与正文内部滚动、IndexedDB 自动保存。

### Tests

- 五个阶段的功能自测、中栏布局、图片、着重块与复杂表格的 Puppeteer E2E 脚本。
