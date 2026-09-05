# 雨课堂助手桌面版

当前已完成 `coding_plan.md` 的 M0 至 M6 与 M8，M7 暂时跳过。程序可在独立的 `WebContentsView` 中登录和浏览雨课堂，观察、脱敏和导出网络记录；Backend 可复用受控浏览器会话，主动读取课堂和课件、连接课堂 WebSocket，并通过统一 Facade 验证和提交人工答案。设置、用户、日志、课件索引及 AI 建议审计记录可在重启后恢复。

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
- `packages/storage`：SQLite 应用数据、系统加密凭据文件和受限磁盘资源缓存。
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

## 本地存储

M5 使用 Node 内置 SQLite 保存普通设置、用户信息、脱敏日志和课件 JSON；图片、PDF 等二进制资源保存在独立缓存目录，默认总上限 256 MiB、单项上限 32 MiB，并识别 `Cache-Control`、`Expires`、`ETag` 和 `Last-Modified`。Electron 的持久 session 继续负责网页 Cookie 与 Chromium 自身缓存。

雨课堂 Authorization Token 不进入 SQLite：当前网页 localStorage 和主动请求返回的 `Set-Auth` 会同步到 Electron `safeStorage` 加密的凭据文件，失效响应会清除旧值。设置中出现 Cookie、Token、API Key、Password 等敏感字段会被拒绝，日志和课件元数据在写入前统一脱敏。

默认数据位于 Electron `userData/storage`。也可使用隔离 profile 启动：

```powershell
npm start -- --debug-profile
npm start -- --portable
```

`--debug-profile` 使用独立调试数据目录；`--portable` 将整个 Electron userData（包括 Cookie、网页缓存和应用数据库）放到可执行文件旁的 `ykt-helper-data`。

## AI 工作流

M8 将模型调用收敛到统一 `AiProviderPlugin` 接口，默认提供 OpenAI-compatible 实现。Provider 只负责模型发现和文本生成，无权调用答题提交服务；其他协议可以通过注入同一接口接入。

题目分析会返回结构化 `AnswerProposal`，包含建议状态、答案、解释、上下文来源、置信度、校验问题和失败原因。每条建议会写入 SQLite；手动采用建议后仍需在题目页校验并确认，提交记录会保存建议答案与最终答案的差异及确认主体。

软件默认启用 AI，不提供单独的 LLM 总开关。开启“自动确认提交”后，新题会由 Agent 调用模型、校验答案并直接提交，相关日志以 `confirmedBy: agent` 标记；未配置模型或调用失败不会阻断课堂和人工答题功能。
