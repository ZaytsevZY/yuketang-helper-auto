# ykt-helper 开发文档

## 项目构建

### 环境要求
- Node.js
- npm

### 构建步骤
```bash
npm i                # 安装依赖
npm run build        # 构建到 dist/ 目录
npm run dev          # 开发模式（监听文件变化）
```

### 使用方式
直接使用 `release/ykt-helper.user.js`，导入 Tampermonkey 即可。

## 项目架构

```
src/
├── index.js                    # 主入口
├── ai/                         # AI 服务
│   ├── kimi.js                # Kimi API 调用（主要AI服务）
│   ├── deepseek.js            # DeepSeek API（备用）
│   └── gpt.ts                 # GPT API（未实现）
├── capture/
│   └── screenshoot.js         # 截图功能
├── core/                      # 核心配置
│   ├── env.js                 # 环境适配器
│   ├── storage.js             # 存储管理
│   └── types.js               # 类型定义与常量
├── net/                       # 网络拦截
│   ├── ws-interceptor.js      # WebSocket 拦截
│   └── xhr-interceptor.js     # XHR 拦截
├── state/                     # 状态管理
│   ├── actions.js             # 动作处理器
│   └── repo.js                # 数据仓库
├── tsm/                       # 雨课堂业务逻辑
│   ├── ai-format.js           # AI 格式化
│   └── answer.js              # 答题接口
└── ui/                        # 用户界面
    ├── panels/                # 面板组件
    │   ├── *.html            # 面板模板
    │   ├── *.js              # 面板逻辑
    │   └── auto-answer-popup.js # 自动答题弹窗
    ├── styles.css             # 样式定义
    ├── styles.js              # 样式注入
    ├── toast.js               # 提示组件
    ├── toolbar.js             # 工具栏
    └── ui-api.js              # UI 统一接口
```

## 核心模块接口

### state/repo.js - 数据仓库
```javascript
export const repo = {
  presentations: Map,          // 课件数据
  slides: Map,                // 幻灯片数据  
  problems: Map,              // 题目数据
  problemStatus: Map,         // 题目状态
  encounteredProblems: [],    // 遭遇的题目列表
  
  // 方法
  setPresentation(id, data),  // 设置课件
  upsertSlide(slide),         // 更新幻灯片
  upsertProblem(prob),        // 更新题目
  loadStoredPresentations()   // 加载存储的课件
}
```

### state/actions.js - 动作处理
```javascript
export const actions = {
  onPresentationLoaded(id, data),  // 课件加载完成
  onUnlockProblem(data),          // 题目解锁
  handleAutoAnswer(problem),       // 自动答题
  navigateTo(presId, slideId),    // 导航到指定页面
  launchLessonHelper()            // 启动课堂助手
}
```

### ui/ui-api.js - UI 统一接口
```javascript
export const ui = {
  config: {},                     // 配置对象
  saveConfig(),                   // 保存配置
  
  // 面板控制
  showPresentationPanel(visible), // 显示课件面板
  showAIPanel(visible),          // 显示AI面板
  toggleSettingsPanel(),         // 切换设置面板
  
  // 数据更新
  updatePresentationList(),      // 更新课件列表
  updateSlideView(),            // 更新幻灯片视图
  updateProblemList(),          // 更新题目列表
  
  // 工具方法
  toast(message),               // 显示提示
  notifyProblem(problem, slide) // 题目通知
}
```

### ai/kimi.js - AI 服务（主要）
```javascript
export function queryKimi(question, aiCfg)
// 参数: question(题目), aiCfg(配置)
// 返回: Promise<string> AI回答
// 使用 Kimi (Moonshot AI) 提供智能答题服务
```

### ai/deepseek.js - AI 服务（备用）
```javascript
export function queryDeepSeek(question, aiCfg)
// 参数: question(题目), aiCfg(配置)
// 返回: Promise<string> AI回答
// 备用 AI 服务
```

### tsm/answer.js - 答题接口
```javascript
export function submitAnswer(problem, result)  // 提交答案
export function retryAnswer(problem, result, dt) // 重试答案
```

### core/storage.js - 存储管理
```javascript
export class StorageManager {
  get(key, defaultValue),       // 获取数据
  set(key, value),             // 设置数据
  getMap(key),                 // 获取Map数据
  setMap(key, map),            // 设置Map数据
  alterMap(key, fn)            // 修改Map数据
}
```

## 面板组件

- `settings`: 配置 Kimi API Key、自动答题参数
- `ai`: AI 问答交互（基于 Kimi）
- `presentation`: 课件浏览与下载
- `problem-list`: 题目历史记录
- `active-problems`: 当前活跃题目
- `tutorial`: 使用教程
- `auto-answer-popup`: 自动答题结果弹窗

## AI 服务配置

### Kimi API 配置
1. 访问 [Kimi开放平台](https://platform.moonshot.cn/) 申请 API Key
2. 在设置面板中配置 Kimi API Key
3. 系统将使用 `kimi-k2-0905-preview` 模型进行智能答题

### API 兼容性
项目使用 OpenAI 兼容的 API 格式，便于后续扩展其他AI服务。

## 配置文件

### userscript.meta.js
包含用户脚本元数据，版本更新需修改此文件。

### rollup.config.mjs  
构建配置，控制打包输出格式。

## 开发注意事项

1. 新功能开发后需更新 `userscript.meta.js` 版本号
2. UI 组件采用 HTML + JS 模板形式
3. 样式统一在 `styles.css` 中定义
4. 网络请求通过拦截器统一处理
5. 状态管理集中在 `repo` 和 `actions` 中
6. AI 服务采用 Kimi 作为主要服务，DeepSeek 作为备用选项
7. 所有AI API调用都遵循OpenAI兼容格式，便于扩展