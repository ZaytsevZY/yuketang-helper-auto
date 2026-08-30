# 雨课堂助手桌面版

当前已完成 `coding_plan.md` 的 M0 架构基线、M1 桌面网页容器和 M2 网络实验室。程序可在独立的 `WebContentsView` 中登录和浏览雨课堂，并观察、脱敏和导出该页面产生的网络记录；真实课堂业务仍留待后续阶段。

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

## 桌面网页容器

- 支持雨课堂、荷塘雨课堂和长江雨课堂入口切换。
- 登录 Cookie 保存在专用的 `persist:yuketang-browser` Electron session 中。
- 顶部本地控制栏提供后退、前进、刷新、地址和加载状态。
- 远程页面不注入 preload，关闭 Node integration，并启用 context isolation 和 sandbox。
- 主页面导航只允许 HTTPS 的 `yuketang.cn` 及其子域；外部导航、新窗口和权限请求默认拦截。

架构决策记录位于 [`docs/adr`](docs/adr)。

## 网络实验室

底部网络实验室默认通过 Electron `webRequest` 捕获 HTTP 元数据，不读取响应正文。开启“深度捕获”后通过 CDP 增加文本响应体和 WebSocket 帧；打开远程页面 DevTools 会占用或断开 CDP，界面会显示对应状态。

记录进入界面前会脱敏 Cookie、Authorization、Token、API Key 等字段，并受到以下限制：

- 单个文本正文或帧最多保留 64 KiB。
- 内存中最多保留 1000 条、合计约 2 MiB。
- 二进制响应体不读取。
- 导出内容使用同一批已脱敏记录。

实验室支持 HTTP、WebSocket、领域事件过滤、全文搜索、暂停、清空和 fixture 导出。合成 fixture 可在真实课堂流量到达前验证 normalizer：

```powershell
npm run build
npm run fixture:replay -- tests/fixtures/network-sample.json
```
