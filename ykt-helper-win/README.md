# 雨课堂助手桌面版

当前已完成 `coding_plan.md` 的 M0 至 M4。程序可在独立的 `WebContentsView` 中登录和浏览雨课堂，观察、脱敏和导出网络记录；Backend 可复用受控浏览器会话，主动读取课堂和课件、连接课堂 WebSocket，并通过统一 Facade 验证和提交人工答案。

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
- `packages/routing`：Browser Observer、主动 HTTP 客户端、环境适配器、SessionManager 和课堂 WebSocket。
- `packages/storage`：供测试和基线使用的内存存储；M5 再接入 SQLite 与系统凭据库。
- `packages/backend`：领域模型、每课堂独立状态、工作流、答案验证以及统一 Facade。
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

## Backend 离线回放

M3 将旧脚本中的课件、题目、题型、答案和超时规则迁入纯 TypeScript Backend，不依赖 DOM、Vuex、toast、GM API 或 localStorage。可使用脱敏后的标准课堂事件 fixture 重现题目解锁流程：

```powershell
npm run build
npm run lesson:replay -- tests/fixtures/lesson-unlock.json
```

## 主动网络客户端

M4 为 standard、pro 和 changjiang 分别固定了 host adapter，并实现用户信息、正在上课、签到、课件、答题和补交接口。Cookie 从 Electron 专用 session 读取，Bearer、`Set-Auth` 和 lessonToken 由 `SessionManager` 管理。

独立课堂 WebSocket 支持 hello 握手、断线重连、跨重连事件去重和统一关闭。主动 HTTP/WS 记录使用 `active` 来源写入网络实验室，并沿用相同的凭据脱敏规则。

当前 UI 不会自动签到或提交；相关能力只通过 Backend Facade 和受限 IPC 暴露，等待后续课堂与题目界面显式调用。
