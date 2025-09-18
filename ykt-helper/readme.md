# ykt-helper开发版本使用指南

## 组装方法

+ 下载`Node.js`
+ 进入`ykt-helper`目录
+ 安装npm依赖
```bash
npm i
```
+ 组装文件(会输出到`../dist`文件夹)
```bash
npm run build
```

## 打包版
请直接使用`../release/ykt-helper.user.js`，使用方法是直接放入篡改猴（油猴，Tampermonkey）。

## 开发说明
ykt-helper的源代码文件目录如下：
```
C:.
│  index.js
│
├─ai
│      deepseek.js
│      gpt.ts
│      kimi.ts
│
├─capture
│      screenshoot.js
│
├─core
│      env.js
│      storage.js
│      types.js
│
├─net
│      ws-interceptor.js
│      xhr-interceptor.js
│
├─state
│      actions.js
│      repo.js
│
├─tsm
│      ai-format.js
│      answer.js
│
└─ui
    │  styles.css
    │  styles.js
    │  toast.js
    │  toolbar.js
    │  ui-api.js
    │
    └─panels
            active-problems.html
            active-problems.js
            ai.html
            ai.js
            auto-answer-popup.js
            presentation.html
            presentation.js
            problem-list.html
            problem-list.js
            settings.html
            settings.js
            tutorial.html
            tutorial.js
```
+ `index.js`：脚本的主入口，包括初始化方法
+ `ai/`：调用AI的API，目前只支持deepseek
+ `capture/`：供AI功能使用方法
    + `screenshot.js`: 用的是“问题区块选择器优先”的截取策略，用来截取题目
+ `core/`：配置文件
    + `env.js`：gm和window配置
    + `storage.js`：浏览器存储配置
    + `types.js`：常量和枚举变量配置，包括题目种类和要调用的API
+ `net/`：网络适配器
    + `ws-interceptor.js`：处理WebSocket
    + `xhr-interceptor.js`：处理XmlHttpRequest
+ `state/`：状态管理器
    + `actions.js`：存储状态转移和生命周期管理方法
    + `repo.js`：存储全局变量（主要是课件）和变量管理方法
+ `tsm/`：格式文件
    + `ai-format.js`：前处理文件，包括给AI的Prompts
    + `answer.js`：后处理文件，包括答案解析方法
+ `ui/`：界面文件
    + `panels`：分功能的html和js
        + `active-problems`：题目检测
        + `ai`：AI交互
        + `auto-answer-popup`：自动作答
        + `presentation`：课件管理
        + `problem-list`：题目管理
        + `settings`：设置
        + `tutorial`：使用指南
    + `style.css`：样式文件
    + `toast`：显示弹窗
    + `toolbar`：显示工具栏
    + `ui-api`：路由文件

在开发新功能后请在`userscript.meta.js`中进行版本更新。

===

## 声明
请不要将雨课堂助手用于网络攻击、作弊或其他任何不适当的行为，不当行为造成的后果由实际操作者自负。