# Contributing

感谢关注 AINoteBook。提交代码前请先阅读以下约定。

## 环境

- Node.js 20 及以上
- Chrome 或 Edge（PDF 预览与本地 E2E 自测）
- 所有数据保存在浏览器本地 IndexedDB，没有后端或账号系统

## 本地开发

当前项目位于 `AINoteBook/` 子目录：

```bash
cd AINoteBook
npm ci
npm run dev
```

开发服务器默认固定在 <http://localhost:5174>。如需并行运行第二个实例：

```bash
npm run dev -- --port 5173
```

端口不同代表不同的浏览器源，IndexedDB 数据互不共享。

## 提交前检查

在 `AINoteBook/` 目录执行：

```bash
npm run check
```

该命令会执行 TypeScript 类型检查并完成生产构建。

## 端到端自测（可选）

在 `AINoteBook/` 目录执行。自测脚本依赖本机 Chrome 与临时安装的 Puppeteer：

```bash
npm install --no-save puppeteer-core
npm run dev -- --port 5173
node scripts/check-stage1.mjs
# 依次运行 check-stage2 ~ check-stage5、check-note-layout、check-image、check-callout、check-table
```

脚本内的 Chrome 路径与测试端口目前按 Windows 本地环境配置；在其他系统运行时请修改脚本顶部的 `CHROME` 与 `URL` 常量。

## 新增工具

在仓库根目录创建新的同级目录，并：

1. 添加子目录 `README.md`；
2. 添加独立依赖清单与锁文件；
3. 更新根 `README.md` 的项目列表；
4. 如需 CI，在 `.github/workflows/ci.yml` 增加对应 job 与路径过滤。

## 提交与 PR

- 从 `main` 创建功能分支，例如 `feat/table-shortcuts`、`fix/export-image`。
- PR 中注明受影响项目（如 `AINoteBook`）。
- 提交信息使用简洁的英文祈使句，例如 `fix: keep table width after resize`。
- 一个 PR 尽量只解决一个问题；在 PR 描述中填写复现步骤、测试结果与截图。
- 提交前确认没有把 `node_modules/`、`dist/`、`.tmp-*`、个人数据或密钥加入版本库。

## 许可证

提交贡献即表示同意以 [MIT License](LICENSE) 授权。
