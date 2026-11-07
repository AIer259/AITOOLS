# AITOOLS

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

个人 AI 工具集合。每个工具一个独立子目录，拥有自己的依赖、文档与发布节奏；构建产物统一发布到 GitHub Pages 工具集合站。

**在线站点**：<https://aier259.github.io/AITOOLS/>

## 项目

### [AINoteBook](AINoteBook/README.md)

本地优先的精简 Markdown 笔记应用，当前版本 **v0.22.0**。支持工作区浏览与拖拽整理、回收站与恢复、全量备份 ZIP 与合并恢复、流式导出与流式恢复、全局搜索（`Ctrl/Cmd+K`）、Markdown + 图片跨设备导入、嵌入文档附件归档与 ZIP 往返、复杂表格、着重块、代码块语言与语法高亮、数学公式（LaTeX）、图片、目录层级折叠与 PDF 导出。

**在线使用**：<https://aier259.github.io/AITOOLS/AINoteBook/>

- 工作区：点击「空间 / 私人」或文件夹进入列表，顶部面包屑逐级回退，侧栏支持拖拽整理
- 嵌入文档：自动归档到 `<主文件名>附件`，可随 Markdown ZIP 一起导出并在另一台电脑恢复，卡片可全屏放大
- 图片导入：支持 Markdown + 图片 ZIP 与单文件 data URI，写入本地资源库
- 目录与附件：目录默认只显示一、二级，高亮跟随滚动；附件文件夹默认折叠；删除主文件时附件一起移入回收站
- 数学公式：行内 `$...$` 或块级公式，斜杠命令插入，点击编辑（LaTeX + 实时预览，支持图片识别），KaTeX 渲染，Markdown 导出保留 LaTeX 源
- 搜索：`Ctrl/Cmd + K` 全局搜索全部活动笔记；顶栏放大镜搜索当前文档并高亮跳转，支持替换与全部替换
- 回收站：左侧底栏入口与数量；可恢复或永久删除，清空需输入确认短语
- 备份：顶栏备份菜单 →「导出全部笔记」导出全量 ZIP；「流式导出全部笔记」支持直接写盘；「从备份恢复」合并恢复；「流式从备份恢复」按条目读取 ZIP；启动时按备份时间与文档数变化提醒
- 在线更新：线上版启动时读取同源 `version.json`，发现新版本可一键刷新加载
- 技术栈：React · TypeScript · Vite · Tiptap · Zustand · IndexedDB
- 启动：

```bash
cd AINoteBook
npm ci
npm run dev
```

- 打开 <http://localhost:5174>
- 文档：[功能与使用说明](AINoteBook/README.md)
- 变更记录：[AINoteBook/CHANGELOG.md](AINoteBook/CHANGELOG.md)
- 项目贡献说明：[AINoteBook/CONTRIBUTING.md](AINoteBook/CONTRIBUTING.md)

## 新增工具

在仓库根目录创建新的同级目录，例如：

```text
AITOOLS/
├─ AINoteBook/
├─ YourTool/
└─ README.md
```

新工具至少应包含：

1. 子目录内的 `README.md`，说明功能、启动方式与限制；
2. 自己的依赖清单与锁文件（如 `package.json` / `package-lock.json`）；
3. 如需 CI，更新 `.github/workflows/ci.yml`，增加对应 job 与路径过滤；
4. 在根 README 的「项目」列表中添加入口；
5. 在 `site/tools.js` 的 `tools` 数组添加工具卡片数据（名称、描述、链接、标签）；
6. 在 `.github/workflows/deploy.yml` 增加该工具的构建步骤，并把构建产物复制到 `.tmp-site/<工具名>/`；
7. 所有工具运行在同一个 Pages 源下，浏览器存储需使用自己的前缀，避免 IndexedDB / localStorage 键冲突。

## 仓库结构

```text
AITOOLS/
├─ AINoteBook/            # 笔记应用
├─ site/                  # 工具集合站首页（静态）
├─ .github/               # CI、Issue / PR 模板
│  └─ workflows/
│     ├─ ci.yml
│     └─ deploy.yml       # 构建工具并发布 GitHub Pages
├─ CONTRIBUTING.md        # 仓库级贡献说明
├─ LICENSE
└─ README.md
```

## 贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT License](LICENSE) © 2026 AIer259
