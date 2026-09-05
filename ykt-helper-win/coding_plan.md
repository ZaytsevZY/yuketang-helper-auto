# 雨课堂助手桌面版迁移计划

## 1. 目标与原则

本项目将从浏览器 userscript 迁移为面向学生用户的经典桌面程序。桌面 GUI 是主要产品入口，CLI 与 skills 是同一套核心能力的自动化入口，而不是要求普通用户围绕 CLI 操作。

迁移后的程序需要同时满足以下目标：

- 提供贴近浏览器雨课堂的桌面 GUI，可在程序内登录和浏览雨课堂。
- 清晰展示课堂、课件、题目、HTTP 请求和 WebSocket 消息之间的关系，方便学习、调试和二次开发。
- 将业务逻辑从 DOM、Vuex、GM API 和 userscript 注入环境中解耦。
- 提供稳定、受控、可审计的 CLI/skills 接口，供 OpenCode 等 agent harness 调用。
- 将 LLM 定位为可选的答案建议模块，而不是直接提交答案的单次调用入口。
- 支持标准雨课堂、荷塘雨课堂和长江雨课堂的独立适配。
- 最终提供 Windows installer 和 portable 可执行版本。

## 2. 技术选型

首版采用以下技术栈：

- 桌面框架：Electron
- 前端：Vue 3 + TypeScript + Vite
- 桌面网页容器：Electron `WebContentsView`
- 核心运行时：TypeScript/Node.js
- 数据库：SQLite
- 配置：JSON 或 SQLite
- 凭据：Windows Credential Manager 等系统凭据存储
- 打包：Electron Forge
- 测试：单元测试、协议 fixture、契约测试和桌面集成测试

选择 Electron 的主要原因：

- 与现有 JavaScript 源码技术栈一致，降低迁移和学生二次开发门槛。
- 自带一致的 Chromium 环境，适合嵌入雨课堂页面。
- 可以通过 `session.webRequest` 和 Chrome DevTools Protocol 观察 HTTP 与 WebSocket。
- 主进程、渲染进程和 preload 的职责清晰，适合展示经典桌面程序架构。

Tauri 可作为未来的体积优化方案，但首版不采用。它会引入 Rust，并依赖操作系统 WebView，不利于首轮迁移和跨平台网络调试的一致性。

参考资料：

- [Electron 进程模型](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view)
- [Electron Debugger](https://www.electronjs.org/docs/latest/api/debugger/)
- [Chrome DevTools Protocol Network](https://chromedevtools.github.io/devtools-protocol/1-3/Network/)
- [Electron Forge](https://www.electronjs.org/docs/latest/tutorial/forge-overview)

## 3. 目标目录结构

```text
ykt-helper-win/
├─ apps/
│  ├─ desktop/
│  │  ├─ main/                 # Electron 主进程、窗口、会话、IPC
│  │  ├─ preload/              # 严格受限的类型化桥接
│  │  └─ renderer/             # Vue GUI，仅负责展示与交互
│  └─ cli/                     # agent 与高级用户入口
│
├─ packages/
│  ├─ contracts/               # DTO、事件、IPC、CLI JSON Schema
│  ├─ routing/
│  │  ├─ browser-observer/     # 观察嵌入网页的 HTTP/WS
│  │  ├─ http-client/          # 主动调用雨课堂 API
│  │  ├─ websocket-client/     # 独立课堂 WebSocket
│  │  ├─ host-adapters/        # standard/pro/changjiang
│  │  ├─ normalizer/           # 原始包转换为统一领域事件
│  │  └─ recorder/             # 脱敏、存储、导出、回放
│  ├─ backend/
│  │  ├─ domain/               # Lesson、Problem、Answer 等领域对象
│  │  ├─ services/             # 登录、课堂、课件、题目、提交
│  │  ├─ workflows/            # 观察、分析、确认、执行
│  │  └─ llm/                  # 可选 LLM provider
│  ├─ storage/
│  │  ├─ database/             # SQLite
│  │  ├─ secrets/              # 系统凭据存储
│  │  ├─ cache/                # 图片、课件、临时文件
│  │  └─ config/               # 用户配置
│  └─ skill-sdk/               # CLI 封装、技能模板、示例
│
├─ skills/
│  └─ yuketang/
│     ├─ SKILL.md
│     └─ examples/
│
├─ legacy/
│  └─ userscript/              # 迁移期保留现有脚本
│
├─ tests/
│  ├─ fixtures/
│  ├─ contract/
│  └─ integration/
│
└─ coding_plan.md
```

需要明确区分两个 routing 概念：

- `frontend/router`：Vue 页面导航。
- `packages/routing`：雨课堂网络、协议和事件路由。

## 4. 系统数据流

```text
嵌入的雨课堂网页
       │ HTTP / WebSocket
       ▼
Browser Observer ──► Recorder ──► 网络调试面板
       │
       ▼
Normalizer ──► Domain Events ──► Backend Services
                                      ▲
         ┌────────────────────────────┼────────────────────┐
         │                            │                    │
      Vue GUI                    CLI / Skills          Storage
```

GUI、CLI 和 skills 不分别实现业务逻辑，而是调用同一个 Backend Facade：

```ts
interface YuketangFacade {
  listLessons(): Promise<Lesson[]>;
  watchLesson(id: string): AsyncIterable<LessonEvent>;
  getProblem(id: string): Promise<ProblemContext>;
  validateAnswer(input: AnswerInput): Promise<ValidationResult>;
  submitAnswer(input: AnswerInput): Promise<SubmissionResult>;
}
```

## 5. 模块职责

### 5.1 Desktop Main

Electron 主进程负责：

- 应用生命周期和窗口管理。
- 本地 Vue 页面与远程雨课堂页面的创建和布局。
- 雨课堂 session partition、Cookie 和权限管理。
- Backend Runtime 的启动和停止。
- 类型化 IPC 注册和调用方校验。
- 本地文件、系统凭据、通知和日志等系统能力。

雨课堂远程页面必须：

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- 限制允许导航的域名。
- 禁止远程页面直接访问 Backend、CLI、文件系统或任意 IPC。

### 5.2 Frontend

推荐主窗口采用四区布局：

- 左侧：课堂、课件、题目、AI、设置、开发工具。
- 中央：真实雨课堂网页。
- 右侧：当前课堂、题目结构、课件和操作解释。
- 底部：HTTP、WebSocket、领域事件和程序日志。

Frontend 只负责：

- 展示 ViewModel。
- 收集用户输入。
- 调用受限的 preload API。
- 订阅 Backend 和 Routing 事件。

Frontend 不直接访问数据库、系统凭据、Node API 或雨课堂内部接口。

### 5.3 Routing

Routing 包含两类数据源。

#### Browser Observer

用于观察嵌入雨课堂网页产生的真实网络流量：

- 使用 Electron `session.webRequest` 捕获 URL、Headers、状态码和耗时。
- 可选使用 Chrome DevTools Protocol 捕获响应正文和 WebSocket 帧。
- 将原始网络数据交给 Normalizer，而不是在捕获器内编写业务逻辑。
- 所有 Cookie、Authorization、Token 在写入数据库前脱敏。

深度捕获分为两种模式：

- 普通模式：只使用 `webRequest`，不读取完整 body 和 WS frame。
- 深度模式：连接 CDP，读取 response body 和 WebSocket frame。

深度模式需要处理 Chromium DevTools 打开后调试协议连接被占用或断开的情况。

#### Active Client

用于脱离网页主动调用雨课堂：

- 读取受控浏览器会话中的 Cookie。
- 获取用户和正在上课列表。
- 签到并管理 `Set-Auth`、Bearer Token 和 lessonToken。
- 建立独立课堂 WebSocket。
- 获取课件、幻灯片和题目。
- 验证、提交或补交答案。

标准、荷塘、长江环境分别实现 host adapter，避免在业务代码中通过大量候选 URL 猜测接口。

#### Network Lab

网络调试页面需要提供：

- HTTP 请求列表、状态码、耗时和来源。
- WebSocket 收发帧时间线。
- 原始数据和解析结果双栏展示。
- 原始接口包到 `LessonEvent` 的映射说明。
- 请求过滤、搜索和暂停捕获。
- 脱敏 fixture 导出。
- 使用 fixture 离线回放 parser。
- 区分网页产生的请求和程序主动调用的请求。

首版不提供任意网络请求重放。后续仅在开发者模式增加，并对写操作进行显式确认。

### 5.4 Backend

Backend 不依赖 Vue、Electron DOM、CLI 或 userscript 环境，主要包含：

- 领域对象和运行时 schema。
- 课堂状态机。
- 课件和题目服务。
- 图片、PDF、OCR 等媒体服务。
- 答案验证和提交服务。
- 任务和工作流编排。
- 对 GUI、CLI 和 skills 暴露统一 Facade。

需要避免全局 `repo.currentLessonId` 等单课堂状态。每个课堂应拥有独立的 `LessonSession`，支持多课堂并行但隔离状态。

### 5.5 LLM

LLM 是 Backend 的可选 provider，采用以下流程：

```text
ProblemContext
  → ContextBuilder
  → Solver/LLM
  → AnswerProposal
  → Validator
  → 用户或 agent 确认
  → AnswerService.submit()
```

约束：

- LLM 只能返回 `AnswerProposal`，不能直接调用提交接口。
- Proposal 包含答案、解释、上下文来源、置信度和模型信息。
- GUI 明确区分“模型建议”和“实际提交”。
- 未配置 LLM 时提供人工答题，不生成默认答案。
- LLM 失败不得产生提交操作。
- 保存建议与最终提交之间的差异，便于学习和审计。

### 5.6 Storage

| 数据 | 存储方式 |
|---|---|
| 课堂、题目、事件、网络索引 | SQLite |
| Cookie、Bearer Token、API Key | 系统凭据存储 |
| 课件、图片、PDF | 文件缓存目录 |
| 普通设置 | JSON 或 SQLite |
| HTTP/WS 原始数据 | 有容量上限的脱敏记录 |
| GUI、CLI、agent 写操作 | 审计日志 |

数据库和普通日志不得保存完整 Cookie、Authorization 或 API Key。调试界面默认显示脱敏值。

### 5.7 CLI 与 Skills

CLI 既可以连接正在运行的桌面程序，也可以独立启动 Backend：

```text
ykt gui
ykt status
ykt lesson list --json
ykt lesson watch <id> --jsonl
ykt problem get <id> --json
ykt answer propose <id> --from -
ykt answer validate <id> --from -
ykt answer submit <id> --from - --commit
ykt routing tail --type websocket --jsonl
ykt routing export --sanitized
```

运行模式：

- 桌面程序运行时：CLI 通过 Windows Named Pipe 调用同一 Runtime，复用登录和课堂会话。
- 桌面程序未运行时：CLI 可通过 `--headless` 启动精简 Runtime。
- CLI stdout 只输出稳定 JSON/JSONL，日志写 stderr。
- CLI、GUI 共享 contracts、权限检查、幂等控制、审计和错误码。

Skills 不直接访问数据库或 Routing 内部模块，只调用公开 CLI。技能文档需要明确：

- 如何发现当前课堂。
- 如何获取题目和课件上下文。
- 如何区分建议、验证和提交。
- 如何处理截止时间与验证失败。
- 哪些命令具有副作用。
- OpenCode 等 agent harness 的调用示例。

## 6. 现有代码迁移映射

| 当前模块 | 目标位置 | 迁移方式 |
|---|---|---|
| `src/core/types.js` | `packages/backend/domain` | 转 TypeScript，并增加运行时 schema |
| `src/state/repo.js` | `backend/domain` + `storage/repositories` | 去除全局状态和 localStorage |
| `src/state/actions.js` | `backend/workflows` | 拆分状态机、通知和提交行为 |
| `src/net/*-interceptor.js` | `routing/browser-observer` | 改为 Electron/CDP 观察器 |
| 主动 API 代码 | `routing/http-client`、`host-adapters` | 统一 SessionManager 和错误模型 |
| `src/tsm/answer.js` | `backend/services/answer-service` | 保留 payload 规则，替换 XHR 和 Token 来源 |
| `src/ai/*` | `backend/llm/providers` | 改为只产生 Proposal 的 provider |
| `src/capture/*` | `backend/services/media-service` | 优先直接下载资源，浏览器截图仅作兜底 |
| `src/ui/*` | `apps/desktop/renderer` | 使用 Vue 组件重写 |
| `src/index.js` | Desktop/CLI composition roots | 拆分启动逻辑和依赖注入 |

迁移期间保留 userscript，但只修复阻塞性问题，不继续在其上增加大型新功能。

## 7. 分阶段迁移计划

### M0：架构基线

任务：

- 创建 Electron + Vue + TypeScript workspace。
- 建立 `contracts`、`routing`、`backend`、`storage` 包。
- 配置单元测试、lint、格式化和包依赖边界检查。
- 编写 ADR：框架选择、进程模型、认证存储、IPC 权限和日志策略。
- 定义第一版 `YuketangFacade`、DTO、领域事件和错误码。

验收：

- 空桌面程序和空 CLI 能调用同一个 Backend Facade。
- Renderer 无法直接导入 Backend 或 Node 模块。

### M1：桌面壳与网页嵌入

任务：

- 实现本地 Vue 控制界面。
- 使用独立 `WebContentsView` 加载雨课堂。
- 使用持久 session partition 保存登录状态。
- 支持域名切换、后退、前进、刷新和页面状态显示。
- 限制导航、新窗口、权限请求和外部链接。
- 建立 main、preload、renderer 之间的类型化 IPC。

验收：

- 用户可在程序内正常登录和浏览雨课堂。
- 远程页面无法访问本地 API、文件系统或任意 IPC。

### M2：Routing 网络实验室

任务：

- 接入 `webRequest` 请求观察。
- 接入可开关的 CDP 深度捕获。
- 展示 HTTP、WebSocket 和解析后的领域事件。
- 实现脱敏、容量限制、搜索和 fixture 导出。
- 建立 event normalizer 插件接口。
- 实现 fixture 离线回放工具。

验收：

- 打开课堂后能看到 checkin、presentation、problem 和 WS frame。
- 能从原始网络消息追踪到对应的领域事件。
- 导出的 fixture 不包含真实凭据。

### M3：Backend 核心抽取

任务：

- 迁移题型、课件、问题和答案模型。
- 把全局 repo 改成依赖注入的 Repository。
- 把 actions 改成课堂状态机和工作流。
- 移除 DOM、Vuex、toast、GM API 和 localStorage 依赖。
- 为状态机、题型、答案格式和超时逻辑增加测试。

验收：

- 不启动 GUI，也能使用录制数据重现题目解锁流程。
- Backend 测试不需要浏览器环境。

### M4：主动网络客户端

任务：

- 实现统一 SessionManager。
- 实现 standard、pro、changjiang host adapters。
- 实现用户信息、on-lesson、checkin、presentation、answer 和 retry。
- 实现独立课堂 WebSocket、断线重连、事件去重和优雅退出。
- 对比网页真实请求与 Active Client 请求。
- 统一 problemId 类型、时间戳单位和 Token 生命周期。

验收：

- 登录网页后，Backend 可以复用会话独立列出课堂和题目。
- 断线重连后不会重复处理同一题目事件。

### M5：Storage

任务：

- 引入 SQLite Repository。
- 建立系统凭据存储。
- 建立图片、课件、日志缓存。
- 实现数据保留、清理和导出策略。
- 实现 portable/debug profile。
- 对日志和数据库进行敏感数据扫描测试。

验收：

- 重启程序后保留登录、课堂缓存和调试记录。
- 日志、fixture 和普通数据库表中不存在明文凭据。

### M6：GUI 功能迁移

任务：

- 迁移课堂、课件、题目和设置页面至顶栏。
- 增加题目上下文与网络来源联动。
- 增加手工答题、验证、确认提交。
- 迁移课件图片、PDF、OCR 和翻译。
- 将 AI Profile 作为独立页面迁移，覆盖 LLM、VLM、OCR 与 Translate 模型分工；AI 服务通过兼容接口的 `/models` 动态发现模型并以卡片管理，不再预置过时的 Kimi 模型。
- 提供“查看对应源码模块”和数据流说明入口。
- 增加操作历史与错误诊断页面。

验收：

- GUI 达到现有 userscript 的主要功能覆盖。
- 输入 Base URL 与 API Key 后能够从 `/models` 获取模型并加入 Profile 池；Moonshot 新接口是基础功能测试项。
- API Key 仅保存到系统凭据存储，普通设置与日志只保留 Profile 元数据和配置状态。
- 用户能看到数据来自哪个 HTTP API 或 WS 事件。

### M7：CLI 与 Skills

任务：

- 发布稳定 JSON/JSONL contracts。
- 实现运行中桌面程序连接和 headless 模式。
- 区分只读、建议、验证和提交权限。
- 增加幂等键、`--dry-run` 和 `--commit`。
- 编写 `skills/yuketang/SKILL.md`。
- 编写 OpenCode 等 harness 示例。

验收：

- 同一道题在 GUI 和 CLI 中得到相同的标准化结构。
- CLI 提交状态能即时反映在 GUI。
- Skill 不需要访问内部模块或数据库。

### M8：LLM Workflow

任务：

- 把现有 provider 改成统一插件接口。
- 输出结构化 AnswerProposal，而不是直接提交。
- 增加解释、上下文、置信度和失败原因。
- 支持 GUI 人工确认及 agent 显式确认。
- 保存建议和最终提交之间的差异。
- 删除无 API Key 时自动生成默认答案的行为。

验收：

- 关闭 LLM 不影响登录、监听、题目和人工答题功能。
- LLM 超时、格式错误或网络失败不会产生提交。

### M9：发布

任务：

- 使用 Electron Forge 构建 Windows installer 和 portable 版本。
- 配置版本信息、图标、升级和卸载。
- 加入代码签名、校验和和依赖清单。
- 在干净 Windows 虚拟机验证安装、登录、网络捕获和 CLI。
- userscript 至少保留一个迁移周期。
- 编写用户手册、开发者手册和网络调试教程。

验收：

- 未安装 Node.js 的 Windows 用户可正常运行。
- 安装包中不包含开发凭据、测试课堂数据或 source map 敏感信息。
- GUI、CLI 和 portable 版本通过发布冒烟测试。

## 8. 第一里程碑

第一版优先完成以下闭环：

```text
桌面程序内登录雨课堂
→ 网络面板显示 HTTP/WS
→ Routing 解析课堂和题目
→ GUI 展示标准化题目
→ CLI 读取同一题目
→ 人工输入答案
→ dry-run 验证
→ GUI 确认提交
```

该闭环能够同时验证 Frontend、Routing、Backend、Storage 和 CLI 五层架构。第一里程碑不要求完整迁移 AI、OCR、翻译和 PDF 功能。

## 9. 风险与控制措施

### 非公开接口变化

- 为三个环境分别维护 host adapter。
- 所有响应使用运行时 schema 校验。
- 使用脱敏 fixture 做回归测试。
- GUI 显示原始消息和 schema 错误，便于快速适配。

### Electron 远程页面安全

- 远程页面禁用 Node integration。
- 启用 context isolation 和 sandbox。
- 对 IPC sender、URL、参数和权限进行白名单校验。
- 本地 Vue 页面与远程雨课堂页面使用不同 WebContents。

### 凭据泄漏

- Token 进入 Storage 前分类处理。
- 凭据只存系统凭据库。
- 网络记录默认脱敏。
- 导出、日志和错误对象统一经过 redactor。

### 网络调试性能

- 普通模式默认不保存完整 body。
- CDP 深度捕获由用户显式开启。
- 为单条消息和总存储量设置上限。
- 大型图片、视频等二进制资源只保存元数据。

### GUI、CLI 行为不一致

- 两者只能通过 Backend Facade 操作业务。
- contracts 包作为唯一 DTO 来源。
- 为 GUI IPC 和 CLI JSON 编写契约测试。

### LLM 越权提交

- LLM provider 无权访问 AnswerService。
- Proposal、Validate、Submit 使用不同命令和权限。
- 所有提交必须携带用户或 agent 的显式 commit 意图。

## 10. 时间预估

单人开发的初步估算：

- 可运行的第一里程碑：4–6 周。
- 三环境兼容、现有主要功能迁移、CLI/skills 和安装包：8–12 周。

该估算需要在完成 M2 并获得三个环境的真实脱敏协议样本后重新校准。
