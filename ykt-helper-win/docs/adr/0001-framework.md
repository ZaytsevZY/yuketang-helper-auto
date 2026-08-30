# ADR 0001：桌面框架与工作区

- 状态：已接受
- 日期：2026-08-30

## 决策

首版使用 Electron、Vue 3、TypeScript、Vite 和 npm workspaces。核心能力拆成无 GUI 依赖的 TypeScript 包，桌面与 CLI 作为两个组合入口。

## 原因

现有 userscript 是 JavaScript，Electron 能复用语言和 Chromium 行为，也能在后续阶段通过 `WebContentsView`、`webRequest` 与 CDP 观察雨课堂页面。M0 不引入 Rust 或额外 monorepo 工具。

## 影响

安装体积高于系统 WebView 方案，但开发和网络调试环境更一致。安装器和 portable 打包推迟到 M9。
