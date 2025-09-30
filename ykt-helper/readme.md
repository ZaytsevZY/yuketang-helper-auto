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
│   ├── kimi.js                # Kimi API 调用（支持文本和Vision模式）
│   ├── deepseek.js            # DeepSeek API（备用）
│   └── gpt.ts                 # GPT API（未实现）
├── capture/
│   └── screenshoot.js         # 页面截图功能（支持Vision模式）
├── core/                      # 核心配置
│   ├── env.js                 # 环境适配器
│   ├── storage.js             # 存储管理
│   └── types.js               # 类型定义与常量
├── net/                       # 网络拦截
│   ├── ws-interceptor.js      # WebSocket 拦截
│   └── xhr-interceptor.js     # XHR 拦截
├── state/                     # 状态管理
│   ├── actions.js             # 动作处理器（融合模式自动答题）
│   └── repo.js                # 数据仓库
├── tsm/                       # 雨课堂业务逻辑
│   ├── ai-format.js           # AI 格式化（智能提示和解析）
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

## 核心功能特性

### 🎯 AI 融合分析模式
- **智能识别**：同时利用页面文本信息和图像内容进行题目分析
- **Vision 支持**：使用 Kimi Vision 模型识别图表、公式、图像等视觉元素
- **自适应策略**：根据题目内容自动选择最佳分析策略
- **精确格式控制**：针对不同题型提供严格的答案格式要求

### 📝 题目类型支持
| 题型 | 答案格式 | 字数限制 | 示例 |
|-----|---------|---------|------|
| 单选题 | 单个字母 | 解释50字以内 | `答案: A` |
| 多选题 | 多个字母用顿号分开 | 解释80字以内 | `答案: A、B、C` |
| 投票题 | 单个字母 | 解释50字以内 | `答案: B` |
| 填空题 | 直接内容，多空用逗号分开 | 解释60字以内 | `答案: 光合作用,呼吸作用` |
| 主观题 | 完整回答 | 100字以内，复杂题目可适当增加 | `答案: [详细回答]` |

### 🔧 自动答题流程
1. **题目解锁检测**：实时监控新题目出现
2. **页面截图**：自动截取题目区域图像
3. **融合分析**：结合文本信息和图像内容进行AI分析
4. **智能解析**：根据题型精确解析AI回答格式
5. **自动提交**：验证答案格式后自动提交

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
  onUnlockProblem(data),          // 题目解锁（融合模式分析）
  handleAutoAnswer(problem),       // 自动答题（融合模式）
  navigateTo(presId, slideId),    // 导航到指定页面
  launchLessonHelper()            // 启动课堂助手
}
```

### ai/kimi.js - AI 服务
```javascript
// 文本模式API调用
export function queryKimi(question, aiCfg)
// 参数: question(题目), aiCfg(配置)
// 返回: Promise<string> AI回答

// Vision模式API调用
export function queryKimiVision(imageBase64, textPrompt, aiCfg)
// 参数: imageBase64(图像), textPrompt(文本提示), aiCfg(配置)
// 返回: Promise<string> AI回答
// 支持图像+文本融合分析
```

### capture/screenshoot.js - 截图服务
```javascript
// 截取问题页面截图
export async function captureProblemScreenshot()
// 返回: Promise<HTMLCanvasElement> 截图画布

// 获取Vision API专用的base64图像数据
export async function captureProblemForVision()
// 返回: Promise<string> base64编码的图像数据
// 自动压缩和优化图像大小
```

### tsm/ai-format.js - 智能格式化
```javascript
// 生成文本模式AI提示
export function formatProblemForAI(problem, TYPE_MAP)
// 根据题型生成精确的格式要求

// 生成Vision模式AI提示（融合模式）
export function formatProblemForVision(problem, TYPE_MAP, hasTextInfo)
// 结合文本信息和图像分析的智能提示

// 智能解析AI回答
export function parseAIAnswer(problem, aiAnswer)
// 支持多种答案格式的智能识别和解析
// 增强的错误处理和格式兼容性
```

### ui/ui-api.js - UI 统一接口
```javascript
export const ui = {
  config: {},                     // 配置对象
  saveConfig(),                   // 保存配置
  
  // 面板控制
  showPresentationPanel(visible), // 显示课件面板
  showAIPanel(visible),          // 显示AI融合分析面板
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

## 面板组件

- **settings**: 配置 Kimi API Key、自动答题参数
- **ai**: AI 融合分析交互面板（文本+图像）
- **presentation**: 课件浏览与下载
- **problem-list**: 题目历史记录
- **active-problems**: 当前活跃题目
- **tutorial**: 使用教程
- **auto-answer-popup**: 自动答题结果弹窗

## AI 服务配置

### Kimi API 配置
1. 访问 [Kimi开放平台](https://platform.moonshot.cn/) 申请 API Key
2. 在设置面板中配置 Kimi API Key
3. 系统支持以下模型：
   - **文本模型**: `moonshot-v1-8k` - 用于纯文本分析
   - **Vision模型**: `moonshot-v1-8k-vision-preview` - 用于图像+文本融合分析

### Vision模式特性
- **自动截图**: 智能识别题目区域并截图
- **图像压缩**: 自动优化图像大小以符合API限制
- **融合分析**: 同时利用页面文本和图像信息
- **格式优化**: 针对不同题型生成专门的Vision提示

### API 兼容性
项目使用 OpenAI 兼容的 API 格式，便于后续扩展其他AI服务。

## 智能解析增强

### 答案格式识别
- **单选/投票题**: 支持 `A`、`选择A`、`答案是A` 等多种表述
- **多选题**: 支持 `A、B、C`、`A,B,C`、`ABC` 等多种分隔符
- **填空题**: 智能识别多空答案，支持逗号、分号等分隔符
- **主观题**: 保留完整内容，自动去除多余格式

### 错误恢复机制
- 详细的调试日志输出
- 多种格式尝试解析
- 智能容错处理
- 用户友好的错误提示

## 配置文件

### userscript.meta.js
包含用户脚本元数据，版本更新需修改此文件。

### rollup.config.mjs  
构建配置，控制打包输出格式。

## 开发注意事项

1. **版本管理**: 新功能开发后需更新 `userscript.meta.js` 版本号
2. **UI组件**: 采用 HTML + JS 模板形式，样式统一在 `styles.css` 中定义
3. **网络处理**: 通过拦截器统一处理所有网络请求
4. **状态管理**: 集中在 `repo` 和 `actions` 中，确保数据一致性
5. **AI服务**: 优先使用融合模式，确保最佳识别效果
6. **图像处理**: 注意图像大小限制，自动压缩优化
7. **格式控制**: 严格控制AI输出格式，确保解析成功率
8. **错误处理**: 提供详细的调试信息和用户反馈

## 使用建议

### 最佳实践
1. **API Key配置**: 确保使用有效的 Kimi API Key
2. **网络环境**: 保证稳定的网络连接以支持Vision API调用
3. **页面加载**: 等待页面完全加载后再进行AI分析
4. **题目复杂度**: 对于复杂图表题目，融合模式效果最佳

### 故障排除
- **解析失败**: 检查AI回答格式是否符合要求
- **截图失败**: 确保页面内容已完全渲染
- **API错误**: 验证API Key有效性和网络连接
- **格式错误**: 查看控制台日志了解具体解析过程

---

*本项目采用融合AI分析技术，结合文本识别和图像分析，为雨课堂提供智能化的答题辅助服务。*