# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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
