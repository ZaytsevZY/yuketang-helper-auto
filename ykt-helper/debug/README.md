# YKT Local Test Lab

这是 userscript、浏览器扩展内容脚本和 Electron/WebView 共用的本地基础测试宿主。内置 `测试ppt` 共 6 页：封面、两道单选题、一道多选题和两道填空题。

## 启动

```bash
cd ykt-helper
npm ci
npm run debug
```

打开 `http://127.0.0.1:8765/debug/`，分别进入老师端和学生端。老师端播放/切换 PPT、发题；学生端实时接收并作答。`npm run dev` 可持续生成固定名称的 `dist/ykt-helper.debug.user.js`，已启动服务器时刷新页面即可。

默认地址会自动加载仓库的 userscript 构建。测试浏览器扩展或 Electron 自身的注入代码时，使用：

```text
http://127.0.0.1:8765/lesson/fullscreen/v3/mock-lesson/exercise/3?ykt_mock=1&inject=external
```

此模式不加载仓库 userscript，避免重复注入。老师端随后发出的 PPT 与题目信号会进入外部注入代码。

### 浏览器扩展

仅在开发版 manifest 中增加 `http://127.0.0.1:8765/*` 的 content-script match，生产 manifest 不要包含该权限。

### Electron

BrowserWindow/WebView 加载上述学生端 `inject=external` 地址，在页面就绪后注入待测构建，再从老师端播放课件或发题。

## 调试协议

页面在产品代码加载前安装一个完全本地的传输层：

- `XMLHttpRequest`：返回课件、答题、补交、签到等 mock 结果。
- `fetch`：雨课堂业务请求仅响应已定义的 mock 路由。
- `BroadcastChannel` + `localStorage`：在老师/学生标签页之间同步课堂状态和答案。
- `WebSocket`：在学生页中向待测代码发送 `fetchtimeline`、`unlockproblem` 和 `lessonfinished`。
- `GM_xmlhttpRequest`：默认通过本机代理访问 Kimi API；代理只允许 `https://api.moonshot.cn`，不会记录密钥或请求正文。

控制台与外部注入脚本共用全局 API：

```js
window.__YKT_MOCK__.emit({
  op: 'unlockproblem',
  problem: {
    prob: 90002,
    sid: 'mock-slide-2',
    pres: 'mock-presentation-test-ppt',
    dt: Date.now(),
    limit: 120
  }
});

window.__YKT_MOCK__.setOnline(false);
window.__YKT_MOCK__.getSnapshot();
```

同时会发出 `ykt-mock:signal`、`ykt-mock:network` 和 `ykt-mock:log` CustomEvent，方便 Electron preload 或浏览器扩展监听。

## 本地日志

老师端和学生端默认记录浏览器 `console`、未捕获异常、Mock 网络事件和 AI 请求结果。日志按天写入：

```text
ykt-helper/logs/debug-YYYY-MM-DD.ndjson
```

日志写入前会遮蔽 API Key、Authorization、token、密码和图片/视频 base64；单条超长文本也会截断。`logs/` 已加入仓库忽略规则，不会被 Git 跟踪。

## 自动化验证

```bash
npm run test:debug
npm run test:debug:browser
npm run test:model-params
```

浏览器测试会按当前操作系统自动发现 Chrome、Edge 或 Chromium；如果浏览器安装在自定义位置，可设置 `CHROME_PATH`。

## 安全边界

- 页面使用固定的 `mock-lesson`、本地课件和 `90002`–`90006` 题目，不保存真实账号数据。
- `测试ppt.pptx` 已提取为 6 页本地 fixture，不依赖原始下载路径。原始渲染图保存在 `debug/fixtures/test-ppt/`，运行时使用带完整中文题干的可读截图源，避免本机缺失 Microsoft Yahei 时丢字。
- 课堂状态仅保存在同源浏览器的本地存储中，答题和 WebSocket 交互不会发往雨课堂。
- AI 分析会真实访问 Kimi 并产生额度消耗；请使用已经轮换的新密钥。
- 正式线上验证仍需在用户明确操作的真实课堂中单独进行。
