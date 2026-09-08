# ADR 0003：认证与凭据存储

- 状态：已接受
- 日期：2026-08-30

## 决策

网页登录 Cookie 由专用 Electron persistent session 管理。Bearer Token、API Key 等独立凭据通过 Storage 的 secrets 接口保存，Windows 正式版本使用 Windows Credential Manager 或等价系统凭据库。

SQLite、JSON 配置、普通日志和 fixture 不保存完整 Cookie、Authorization 或 API Key。M0 的 `MemoryKeyValueStore` 只用于无凭据的架构验证，不作为凭据实现。

## 影响

M1 创建 session partition，M5 实现系统 secrets adapter 与敏感数据扫描测试。在此之前不提供持久凭据功能。
