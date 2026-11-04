# Contributing to AINoteBook

本文件是 AINoteBook 的项目级贡献说明。仓库级规则见 [AITOOLS CONTRIBUTING](../CONTRIBUTING.md)。

## 环境

- Node.js 20 及以上
- Chrome 或 Edge（PDF 预览与本地 E2E 自测）
- 所有数据保存在浏览器本地 IndexedDB，没有后端或账号系统

## 本地开发

当前项目位于 AITOOLS 仓库的 `AINoteBook/` 子目录：

```bash
npm ci
npm run dev
```

开发服务器默认固定在 <http://localhost:5174>。如需并行运行第二个实例：

```bash
npm run dev -- --port 5173
```

端口不同代表不同的浏览器源，IndexedDB 数据互不共享。

## 提交前检查

```bash
npm run check
```

该命令会执行 TypeScript 类型检查、架构依赖检查并完成生产构建。

## 架构边界

- `src/domain/`：纯领域命令，接收数据、返回结果；不 import store、React、IndexedDB
- `src/application/`：用例/命令，只依赖 domain、基础设施与 `NoteRepository` 接口；不直接 import Zustand / React
- `src/lib/`：基础设施与纯工具，不得 import `src/store` 或 `src/components`
- `src/store/`：Zustand 适配器，负责状态、持久化与用例编排；不得 import `src/components`
- 新增功能时，领域规则放 `domain/`，流程编排放 `application/`，React 交互与 toast 留在 `components/` / `extensions/`

`npm run check:arch`（已包含在 `npm run check` 中）会扫描 import，发现反向依赖时失败。

## 数据模型约定

- 树元数据存 `ainb.tree.v2`，Markdown 正文只存 `ainb.node.<id>`；不要再给 `TreeNode` 加回 `content`
- 读取正文使用 `loadNodeContent` 或 store 的 `readContent`（会优先返回尚未落盘的待保存内容）
- 树查询不要反复扫描扁平数组：组件用 `useTreeIndex()`、领域/用例用 `getTreeIndex(nodes)`，通过 `byId` / `activeChildren` / `trashRoots` 读取
- 新节点必须生成 fractional-index `order`；兄弟排序用 `compareOrder`
- 附件关系使用 `doc.attachmentFolderId` 与 `folder.ownerDocId` 双向关联，不要按名称反查
- 旧 `ainb.tree.v1` 只用于迁移，不再写入

## 端到端自测（可选）

自测脚本依赖本机 Chrome 与临时安装的 Puppeteer：

```bash
npm install --no-save puppeteer-core
npm run dev -- --port 5173
node scripts/check-stage1.mjs
# 依次运行 check-stage2 ~ check-stage5、check-note-layout、check-image、check-callout、check-table、check-codeblock、check-link、check-toolbar、check-toc
```

脚本内的 Chrome 路径与测试端口目前按 Windows 本地环境配置；在其他系统运行时请修改脚本顶部的 `CHROME` 与 `URL` 常量。`check-codeblock.mjs`、`check-link.mjs`、`check-toolbar.mjs` 与 `check-toc.mjs` 支持 `APP_URL` 与 `CHROME_PATH` 环境变量覆盖测试地址与浏览器路径。自测会产生 `.tmp-*` 临时目录，可直接删除。

## 提交与 PR

- 从 `main` 创建功能分支，例如 `feat/table-shortcuts`、`fix/export-image`。
- 提交信息使用简洁的英文祈使句，例如 `fix: keep table width after resize`。
- 一个 PR 尽量只解决一个问题；在 PR 描述中填写复现步骤、测试结果与截图。
- 提交前确认没有把 `node_modules/`、`dist/`、`.tmp-*`、个人数据或密钥加入版本库。
- PR 中注明「受影响项目：AINoteBook」。

## 许可证

提交贡献即表示同意以 [MIT License](../LICENSE) 授权。
