# AITOOLS

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

个人 AI 工具集合。每个工具一个独立子目录，拥有自己的依赖、文档与发布节奏。

## 项目

### [AINoteBook](AINoteBook/README.md)

本地优先的精简 Markdown 笔记应用，支持复杂表格、着重块、图片、嵌套文档与 PDF 导出。

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
