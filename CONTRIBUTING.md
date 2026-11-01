# Contributing to AITOOLS

感谢关注 AITOOLS。本仓库包含多个独立 AI 工具，每个工具拥有自己的依赖、文档与测试方式。

## 项目

- [AINoteBook](AINoteBook/README.md) — 本地优先 Markdown 笔记应用
  - 项目开发、自测与提交约定：[AINoteBook/CONTRIBUTING.md](AINoteBook/CONTRIBUTING.md)

## 仓库级约定

- 从 `main` 创建功能分支，例如 `feat/table-shortcuts`、`fix/export-image`。
- 一个 PR 尽量只解决一个问题；PR 中注明受影响项目（如 `AINoteBook`）。
- 修改项目代码前，先阅读对应子目录的 README 与 CONTRIBUTING。
- 提交前在目标项目目录执行其类型检查 / 构建 / 测试命令。
- 不要提交 `node_modules/`、`dist/`、`.tmp-*`、个人数据、密钥或令牌。
- 文档变更同步更新对应 README / CHANGELOG。

## 新增工具

在仓库根目录创建一个新的同级目录，例如：

```text
AITOOLS/
├─ AINoteBook/
├─ YourTool/
└─ README.md
```

新工具至少应包含：

1. 子目录内的 `README.md`，说明功能、启动方式与限制；
2. 独立的依赖清单与锁文件；
3. 子目录内的 `CONTRIBUTING.md`（如有项目级约定）；
4. 在根 README 的「项目」列表中添加入口；
5. 如需 CI，在 `.github/workflows/ci.yml` 增加对应 job 与路径过滤。

## 许可证

提交贡献即表示同意以 [MIT License](LICENSE) 授权。
