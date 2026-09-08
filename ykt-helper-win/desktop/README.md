# Electron 发行包体

此目录是 Electron Forge 的完整应用目录。`npm run prepare:desktop` 会把桌面端和 CLI 的构建结果同步到这里；这些生成目录不提交到 Git。

- `npm run make:win`：生成 Squirrel Windows 安装器。
- `npm run make:portable`：生成 ZIP Portable 包。

两种发行物使用同一份应用内容。Portable 包含 `portable.flag`，应用数据会写入可执行文件旁的 `ykt-helper-data`。两种发行物都在应用根目录提供 `ykt.cmd`，用于连接正在运行的桌面端 CLI 服务。
