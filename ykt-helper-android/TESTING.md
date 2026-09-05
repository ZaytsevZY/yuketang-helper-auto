# Android 原型测试说明

## 当前结论

本目录目前只是一个基于 Android SDK 的客户端开发原型，尚不能认定为可用版本。

已经验证的内容：

- Gradle Debug 构建成功。
- 8 个本地单元测试通过。
- Android Lint 没有 Error。
- macOS ARM64 上的 Android 36 模拟器可以安装、冷启动并打开雨课堂登录页。
- 底部助手抽屉、课堂页、AI 页和模型配置页可以显示和切换。

仍待真实环境验证的内容：

- 雨课堂、荷塘雨课堂和长江雨课堂的实际账号登录与登录态持久化。
- 课堂列表、签到、课件与题目接口在不同账号和课程中的兼容性。
- 课堂 WebSocket 连接、新题推送和断线重连。
- OpenAI-compatible 文本与视觉模型的真实调用。
- 单选、多选、投票、填空和主观题的答案格式与提交结果。
- 不同 Android 版本、屏幕尺寸和手机厂商 WebView 的兼容性。
- 切后台、锁屏、旋转屏幕、弱网和网络恢复后的行为。

## 构建检查

```bash
cd /Users/bytedance/Desktop/zhayi/university/yuketang-helper-auto/ykt-helper-android

export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools

./gradlew clean testDebugUnitTest lintDebug assembleDebug
```

预期结果是 `BUILD SUCCESSFUL`，APK 位于：

```text
app/build/outputs/apk/debug/app-debug.apk
```

## 模拟器测试

```bash
$ANDROID_HOME/emulator/emulator -avd Yuketang_API_36 &
$ANDROID_HOME/platform-tools/adb wait-for-device
./gradlew installDebug
$ANDROID_HOME/platform-tools/adb shell am start -n com.zaytsev.yuketanghelper/.MainActivity
```

关闭整个模拟器：

```bash
$ANDROID_HOME/platform-tools/adb emu kill
```

## 安卓真机测试

在手机中开启开发者选项和 USB 调试，连接 Mac 后执行：

```bash
$ANDROID_HOME/platform-tools/adb devices
$ANDROID_HOME/platform-tools/adb install -r app/build/outputs/apk/debug/app-debug.apk
```

请先确认 `adb devices` 中设备状态为 `device`，而不是 `unauthorized`。

## 建议测试顺序

1. 使用非重要账号或测试课堂登录，重启应用后确认登录态是否保留。
2. 配置一个 HTTPS、兼容 OpenAI 接口的模型服务，并执行“保存并测试连接”。
3. 在“课堂”页刷新列表，确认课程名称、状态和连接行为正确。
4. 使用测试题逐一验证题目识别、AI 建议、课件图片和课件问答。
5. 核对答案格式后再确认提交，并在雨课堂网页端检查服务器实际记录。
6. 分别测试切后台、锁屏、断网和恢复网络，确认不会重复提交。

自动分析不等于自动提交。当前原型要求用户在确认对话框中再次确认才会发送答案。

## 测试记录

报告问题时至少记录：

- 手机型号、Android 版本和 Android System WebView 版本。
- 使用的雨课堂环境以及发生问题的页面。
- 操作步骤、预期结果和实际结果。
- 是否能够稳定复现。
- 脱敏后的截图或错误提示；不要提交 Cookie、Authorization、API Key 或真实课程隐私信息。

只有真实登录、课堂推题、模型调用和答案提交全部通过后，才能把状态从“待测试”调整为“可试用”。
