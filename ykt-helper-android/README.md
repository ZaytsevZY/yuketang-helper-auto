# 雨课堂助手 Android

基于 `feat/dev3.0` 协议与产品流程实现的原生 Android MVP。主界面使用全屏雨课堂 WebView，课堂、题目、AI、课件、模型与设置位于底部助手抽屉。

## 当前能力

- 雨课堂、荷塘雨课堂、长江雨课堂网页登录与 Cookie 持久化。
- 后退、前进、刷新和服务器切换。
- 读取课堂列表、签到、获取课件与题目，并连接课堂 WebSocket。
- 检测解锁题目后自动生成 AI 答案建议。
- 对当前课件页进行视觉问答。
- OpenAI-compatible 模型服务配置；API Key 使用 Android Keystore 加密。
- 答案格式校验和用户逐次确认提交。

Android 版不包含 Electron 网络实验室、CDP 深度捕获、流量导出或源码诊断。

## 构建

需要 JDK 17+ 和 Android SDK 36：

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
./gradlew testDebugUnitTest lintDebug assembleDebug
```

APK 输出：

```text
app/build/outputs/apk/debug/app-debug.apk
```

安装到模拟器或 USB/Wi-Fi 调试设备：

```bash
/opt/homebrew/share/android-commandlinetools/platform-tools/adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## 使用顺序

1. 在全屏网页中完成雨课堂登录。
2. 展开底部抽屉，在“模型”中配置 HTTPS Base URL、API Key、文本模型和视觉模型。
3. 在“课堂”中刷新并连接课堂。
4. 收到题目后查看自动生成的建议，进入“题目”核对。
5. 只有在确认对话框中再次确认，答案才会提交到雨课堂。

## 安全边界

- 远程 WebView 不注入 JavaScript bridge。
- 主页面只允许 HTTPS 的 `yuketang.cn` 及子域；其他链接交给系统浏览器或对应 App。
- 禁止明文 HTTP 模型接口。
- 不在日志或普通设置中保存 Cookie、Token 和 API Key。
- 不提供无确认自动提交。
