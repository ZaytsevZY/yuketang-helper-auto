# ADR 0002：进程模型

- 状态：已接受
- 日期：2026-08-30

## 决策

Electron 主进程持有 Backend Runtime 和系统能力；preload 仅暴露类型化、逐项定义的 API；Vue Renderer 只展示数据和发送用户意图。远程雨课堂页面将在 M1 使用独立 `WebContentsView`，不与本地 Renderer 共用执行环境。

Renderer 启用 `contextIsolation` 和 `sandbox`，关闭 `nodeIntegration`。Renderer 不得直接导入 Backend、Storage、Routing、Electron 或 Node 模块，该规则由 lint 与边界检查共同执行。

## 影响

新增能力必须先定义 contract，再由主进程注册明确的处理器。不能通过全局对象暴露通用 IPC 或 Node API。
