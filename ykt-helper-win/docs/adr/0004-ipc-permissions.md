# ADR 0004：IPC 权限

- 状态：已接受
- 日期：2026-08-30

## 决策

IPC channel 名称、请求和响应类型统一放在 `@ykt/contracts`。preload 只暴露业务方法，不暴露 `ipcRenderer`。主进程处理器验证调用来源；远程页面不得注册或获得任何 Backend IPC。

后续写操作按“读取、建议、验证、提交”分别授权，提交还需显式 commit 意图和幂等键。M0 仅开放只读的运行状态查询。

## 影响

每项 IPC 能力都需要显式 contract 和 handler，接口数量略有增加，但权限范围可审查、可测试。
