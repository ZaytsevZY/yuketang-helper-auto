# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

主要用户是在 Windows 桌面端使用雨课堂的学生。他们既需要在课堂进行中快速发现题目、核对上下文并谨慎提交答案，也需要在课后浏览课件、识别文字、翻译和回看操作记录。

## Product Purpose

雨课堂助手把真实雨课堂网页、课堂事件、题目、课件和可解释的网络来源放进同一个桌面工作区。成功意味着用户无需离开真实网页，即可理解当前课堂状态、完成课件辅助处理，并在每次提交前验证答案。

## Positioning

产品以受控的真实雨课堂网页为主工作区，同时将 HTTP API、WebSocket 事件和 Backend 领域状态映射为可追溯的助手界面，而不是替代网页或注入不可审计的自动化脚本。

## Operating Context

- 课堂实时操作与课后复习同等重要。
- 真实雨课堂网页始终位于中央并获得尽可能大的可用空间。
- 助手功能通过顶部入口切换，在侧边工作台中完成。
- 底部网络实验室用于观察、筛选、脱敏和导出 HTTP、WebSocket 与领域事件。
- 用户可能在 standard、pro 和 changjiang 三种雨课堂环境间切换。

## Capabilities and Constraints

- 桌面壳为 Electron，Renderer 使用 Vue 3 和 TypeScript。
- 远程页面禁用 Node integration，不能直接访问 Backend、文件系统或任意 IPC。
- M6 覆盖课堂、题目、课件、独立 AI Profile 页面、答案建议、OCR、翻译、设置、操作历史和错误诊断；Profile 卡片负责分配 LLM、VLM、OCR 与 Translate 模型。
- 题目必须先本地验证并预览规范化答案，再由用户逐次显式确认提交。
- 用户应能看到题目和状态来自哪个 HTTP API 或 WebSocket 事件。
- 课件辅助包含图片浏览、PDF 导出、OCR 和翻译；未连接 AI 服务、未发现兼容模型或凭据失效时明确报错，不得伪造结果。
- Cookie 与 Token 不进入普通数据库或 Renderer；日志和网络记录默认脱敏。
- M7 的 CLI、skills 权限模型和更广泛自动化不属于当前阶段。

## Brand Commitments

产品名称为“雨课堂助手”。界面文案使用清楚、克制、直接的简体中文，避免夸张承诺和游戏化表达。

## Evidence on Hand

- `coding_plan.md` 定义 M0–M9 的功能边界与验收标准。
- `packages/contracts`、`packages/backend`、`packages/routing` 和 `packages/storage` 提供已实现的状态、课堂、题目、提交、网络记录和持久化契约。
- `ykt-helper/src/ui` 保留旧 userscript 的课堂、课件、题目、设置、OCR、翻译和提醒交互，可作为功能覆盖证据，但不作为视觉权威。
- 当前没有正式品牌素材、真实课堂截图或可公开的生产数据；界面不得虚构真实用户、课堂或操作结果。

## Product Principles

- 真实网页优先：助手永远服务于网页任务，不抢占主工作区。
- 状态可追溯：关键数据和操作必须能解释其网络或领域来源。
- 提交可控：建议、验证和提交保持清晰分离，提交始终由用户确认。
- 实时与复习连续：课堂中产生的题目、课件和记录应自然延续到课后查看。
- 安全边界可见：凭据、脱敏、缓存和连接状态以准确但不过度打扰的方式呈现。

## Accessibility & Inclusion

界面应支持键盘操作、清晰焦点、状态文字与颜色双重表达，并在缩窄窗口时保持主要任务可完成。
