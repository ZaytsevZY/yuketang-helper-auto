# Electron 发行包体

此目录是 Electron Forge 的完整应用目录。`npm run prepare:desktop` 会把桌面端和 CLI 的构建结果同步到这里；这些生成目录不提交到 Git。

- `npm run make:win`：生成 Squirrel Windows 安装器，输出到 `desktop/out/windows/installer/`。
- `npm run make:portable`：生成 Windows ZIP Portable 包，输出到 `desktop/out/windows/portable/`。
- `npm run make:mac`：在 macOS 上生成本地测试 `.app`、DMG 和 ZIP，输出到 `desktop/out/macos/local/`。
- `npm run make:mac:release`：生成经过 Developer ID 签名和 Apple 公证的 macOS 发行包，输出到 `desktop/out/macos/release/`。

上述命令均在项目根目录执行。公共运行文件由 `prepare:desktop` 准备；不要同时运行多条准备/打包命令。`forge.shared.cjs` 只定义公共包体，`forge.windows.config.cjs` 与 `forge.macos.config.cjs` 分别负责平台配置、签名和产物。`forge.config.cjs` 根据各入口显式指定的平台加载配置，配置与目标平台不符会拒绝打包。

仅 Windows Portable 包含 `portable.flag`，应用数据会写入可执行文件旁的 `ykt-helper-data`。Windows 两种发行物都在应用根目录提供 `ykt.cmd`。macOS 的 CLI 启动器为 `雨课堂助手.app/Contents/Resources/ykt`；它和 CLI 在签名前写入包体，不会在签名后修改 `.app`。

macOS 的架构选择、正式签名和公证凭据配置见[项目发行说明](../README.md#macos-发行包)。本地包使用 ad-hoc 签名，不能替代 Developer ID 签名和公证，也不保证系统通知已经获得授权。
