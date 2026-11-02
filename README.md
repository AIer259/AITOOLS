# AITOOLS

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

个人 AI 工具集合。每个工具一个独立子目录，拥有自己的依赖、文档与发布节奏。

## 项目

### [AINoteBook](AINoteBook/README.md)

本地优先的精简 Markdown 笔记应用，当前版本 **v0.12.0**。支持工作区浏览与拖拽整理、Markdown + 图片跨设备导入、嵌入文档附件归档与 ZIP 往返、复杂表格、着重块、代码块语言与语法高亮、图片、目录层级折叠与 PDF 导出。

- 工作区：点击「空间 / 私人」或文件夹进入列表，顶部面包屑逐级回退，侧栏支持拖拽整理
- 嵌入文档：自动归档到 `<主文件名>附件`，可随 Markdown ZIP 一起导出并在另一台电脑恢复
- 图片导入：支持 Markdown + 图片 ZIP 与单文件 data URI，写入本地资源库
- 目录与附件：目录默认只显示一、二级；附件文件夹默认折叠；删除主文件同步删除附件
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
4. 在根 README 的「项目」列表中添加入口。

## 仓库结构

```text
AITOOLS/
├─ AINoteBook/            # 笔记应用
├─ .github/               # CI、Issue / PR 模板
├─ CONTRIBUTING.md        # 仓库级贡献说明
├─ LICENSE
└─ README.md
```

## 贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT License](LICENSE) © 2026 AIer259
