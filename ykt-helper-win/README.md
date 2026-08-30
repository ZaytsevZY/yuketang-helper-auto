# 雨课堂助手桌面版

这是 `coding_plan.md` 的 M0 架构基线。当前版本只验证进程边界、共享 Backend Facade、桌面壳和 CLI，不包含登录、网页嵌入或真实课堂功能。

## 开发命令

```powershell
npm install
npm run build
npm test
npm run lint
npm run format:check
```

构建后运行桌面壳：

```powershell
npm start
```

调用 CLI 的同一 Backend Facade：

```powershell
npm run cli -- status
```

CLI 的 stdout 只输出 JSON；诊断和用法信息写入 stderr。

## 当前边界

- `packages/contracts`：共享 DTO、领域事件、错误码、Facade 和 IPC 契约。
- `packages/routing`：M0 空 Routing 服务；M2 再接入 Browser Observer。
- `packages/storage`：供测试和基线使用的内存存储；M5 再接入 SQLite 与系统凭据库。
- `packages/backend`：唯一 Backend Runtime 和 Facade 实现。
- `apps/desktop`：Electron 主进程、受限 preload 和 Vue Renderer。
- `apps/cli`：调用 Backend Runtime 的 JSON 命令行入口。

`npm run boundaries` 会检查内部包依赖方向，并阻止 Renderer 导入 Backend、Routing、Storage、Electron 或 Node 内置模块。

架构决策记录位于 [`docs/adr`](docs/adr)。
