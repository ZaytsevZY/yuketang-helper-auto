---
name: 雨课堂助手
description: 以真实雨课堂网页为中心的克制白绿桌面工作区
colors:
  primary: '#088a57'
  primary-strong: '#066d46'
  primary-soft: '#eaf6ef'
  canvas: '#f7f8f7'
  surface: '#ffffff'
  surface-subtle: '#f6f8f7'
  text: '#202824'
  text-muted: '#66736c'
  line: '#e1e6e3'
  line-strong: '#cbd4cf'
  caution: '#a66913'
  caution-soft: '#fff9e9'
  danger: '#8d2d2d'
  danger-soft: '#fff3f1'
  websocket: '#6f55ae'
typography:
  headline:
    fontFamily: 'Microsoft YaHei UI, Microsoft YaHei, Segoe UI, system-ui, sans-serif'
    fontSize: '18px'
    fontWeight: 700
    lineHeight: 1.25
  title:
    fontFamily: 'Microsoft YaHei UI, Microsoft YaHei, Segoe UI, system-ui, sans-serif'
    fontSize: '15px'
    fontWeight: 700
    lineHeight: 1.4
  body:
    fontFamily: 'Microsoft YaHei UI, Microsoft YaHei, Segoe UI, system-ui, sans-serif'
    fontSize: '12px'
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: 'Microsoft YaHei UI, Microsoft YaHei, Segoe UI, system-ui, sans-serif'
    fontSize: '12px'
    fontWeight: 650
    lineHeight: 1.4
  mono:
    fontFamily: 'Consolas, monospace'
    fontSize: '12px'
    fontWeight: 400
    lineHeight: 1.45
rounded:
  compact: '4px'
  small: '5px'
  control: '6px'
  field: '7px'
  empty: '8px'
  round: '50%'
spacing:
  compact: '4px'
  snug: '6px'
  small: '8px'
  medium: '12px'
  panel: '14px'
  large: '16px'
  section: '20px'
  empty: '28px'
components:
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.surface}'
    typography: '{typography.label}'
    rounded: '{rounded.control}'
    padding: '7px 12px'
    height: '30px'
  button-primary-hover:
    backgroundColor: '{colors.primary-strong}'
    textColor: '{colors.surface}'
    rounded: '{rounded.control}'
  button-secondary:
    backgroundColor: '#f8fcfa'
    textColor: '{colors.primary-strong}'
    typography: '{typography.label}'
    rounded: '{rounded.control}'
    padding: '7px 12px'
    height: '30px'
  button-quiet:
    backgroundColor: 'transparent'
    textColor: '{colors.text-muted}'
    typography: '{typography.body}'
    rounded: '{rounded.control}'
    padding: '7px 10px'
    height: '30px'
  field:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
    typography: '{typography.body}'
    rounded: '{rounded.control}'
    padding: '0 9px'
    height: '32px'
  selection-row:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
    typography: '{typography.body}'
    rounded: '{rounded.control}'
    padding: '10px'
  source-chip:
    backgroundColor: '{colors.primary-soft}'
    textColor: '{colors.primary-strong}'
    typography: '{typography.label}'
    rounded: '{rounded.compact}'
    padding: '3px 5px'
---

# Design System: 雨课堂助手

## Overview

**Creative North Star: "静默的浏览器伴侣"**

雨课堂助手是一套安静、可信的白绿桌面界面：暖白表面、炭灰文字、细灰分隔线建立原生工具感，翠绿只标记主动作、选中项与健康状态。视觉应像浏览器旁边的一套精密工具，而不是抢占注意力的课堂播控台。

系统以紧凑但不拥挤的 12–14px 中文信息密度工作。真实雨课堂网页始终是视觉与任务中心；助手、来源与网络诊断退居边缘，按需展开。独立“模型”页使用 Profile 卡片呈现服务连接及 LLM、VLM、OCR、Translate 分工。界面只呈现真实获得的课堂、题目、课件、OCR、翻译与网络状态，未知、空、加载和失败都有诚实的表达。

**Key Characteristics:**

- 暖白底色、炭灰文字与低对比细线组成克制的桌面工具质感。
- 翠绿是稀缺的操作与状态信号，琥珀仅用于谨慎提示。
- 真实网页面积优先，右侧助手和底部网络实验室都可收起。
- 线性分区、列表和表格优先于漂浮卡片与大面积装饰。
- 数据来源、确认边界与空状态直接可见，不以示例内容冒充真实结果。

## Colors

色彩以纸白与带绿意的中性色为底，仅用一支清晰的翠绿建立动作层级；协议与风险色只服务于辨识，不参与装饰。

### Primary

- **可信翠绿**：用于主要按钮、选中状态、健康状态点、焦点边界与品牌标记。
- **深林翠绿**：用于主按钮悬停、绿色文字以及需要比背景更高对比的活跃状态。
- **薄荷雾绿**：用于选中行、筛选状态、来源标签与轻量反馈背景。

### Secondary

- **WebSocket 紫**：仅标记 WebSocket 类型，让网络记录可快速扫描；它不是第二品牌色。

### Tertiary

- **谨慎琥珀**：用于不可撤销确认、深度捕获风险和领域事件辨识；保持小面积、低饱和。
- **错误暗红**：仅用于失败、无效校验和错误日志，并总是搭配明确文字。

### Neutral

- **暖白画布**：应用最外层背景，弱化桌面窗口与真实网页的边界竞争。
- **纯白表面**：顶栏输入、助手面板、表格和可操作容器的主要承载面。
- **雾白表面**：折叠栏、网络实验室与占位区的次级层。
- **炭灰正文**：所有核心信息、标题与控件文字。
- **苔灰次文**：元数据、解释文字、计数与辅助状态。
- **细雾分隔线 / 强雾分隔线**：分别用于行内分隔与面板边界。

### Named Rules

**The One Green Signal Rule.** 翠绿只表示品牌、当前选择、健康状态或可执行的主动作；同一局部不得同时出现多个竞争性的绿色主按钮。

**The Honest Status Rule.** 颜色必须与状态文字、图标或结构共同出现；不得只靠颜色表达成功、错误、连接或选中。

## Typography

**Display Font:** 不使用独立展示字体。
**Body Font:** Microsoft YaHei UI（后备为 Microsoft YaHei、Segoe UI、system-ui、sans-serif）
**Label/Mono Font:** Microsoft YaHei UI；协议、路径与日志使用 Consolas（后备为 monospace）

**Character:** 字体选择贴近 Windows 原生环境，字重而非字号承担主要层级。短标题清晰稳重，正文与元数据保持紧凑，技术字符串用等宽字体以提升追踪效率。

### Hierarchy

- **Headline**（700，18px，1.25）：右侧工作页主标题；每个面板只出现一次。
- **Title**（700，15px，1.4）：品牌、面板标题和高层容器标题。
- **Body**（400，12px，1.55）：界面正文、说明与可扫描元数据；长文不是此系统的常态。
- **Label**（650，12px，1.4）：按钮、字段标签、分区标题与强调行。
- **Mono**（400，12px，1.45）：URL、HTTP/WS 记录、模块路径与诊断载荷。

### Named Rules

**The Native Chinese Rhythm Rule.** 界面默认使用 Windows 中文系统字体，不引入带强烈编辑感的展示字体；层级通过 12px、15px、18px 和 400/650/700 的有限组合建立。

## Layout

桌面框架采用边缘工具围绕真实网页的空间模型。顶部是固定 96px 的双层浏览器与任务栏；右侧助手展开宽度为 380px，收起后保留 44px 窄轨；底部网络实验室展开高度为 300px、折叠为 43px。网页容器使用扣除这些工具区域后的全部空间，不在中心再叠加模拟课堂卡片。

主要面板以 14px 水平内边距和 16–20px 分区节奏组织。列表、定义表、表单与网络记录沿单一阅读轴排列；网络详情在可用宽度内采用“记录列表 + 两列详情”。920px 以下限制助手对网页的占用，980px 以下压缩品牌和运行时辅助信息；680px 以下助手默认收起，展开时成为全宽任务面板，真实网页暂时隐藏，网络实验室隐藏。响应式优先收起次要工具，不把主要控件压到不可读。

**The Webpage First Rule.** 真实雨课堂网页始终获得最大连续区域；任何新增工具都先进入可收起的助手或网络实验室，而不是覆盖网页。

**The Collapse Before Compression Rule.** 窄屏先隐藏辅助标签、折叠助手和网络实验室，再考虑缩小控件或文字。

## Elevation & Depth

系统以边界线和轻微色调差建立层级，整体保持平坦。只有固定浏览器顶栏使用低强度环境阴影，将窗口控制区与网页内容分开；选中与聚焦通过描边和浅色底表达，不使用漂浮卡片堆叠。

### Shadow Vocabulary

- **顶栏环境阴影**（`0 3px 12px rgb(31 52 42 / 7%)`）：只用于固定浏览器顶栏与内容面之间的轻微分离。
- **翠绿焦点光环**（`0 0 0 3px rgb(8 138 87 / 14%)`）：用于可交互控件获得键盘焦点时，与 2px 可见轮廓协同工作。

### Named Rules

**The Flat Workspace Rule.** 静止表面保持平坦；结构优先依靠 1px 分隔线、背景色差和留白，不为普通卡片添加阴影。

## Shapes

形状语言接近 Windows 桌面控件：按钮与输入采用轻微弧度（5–7px），内容容器与空状态最多使用 8px 圆角，来源标签使用紧凑的 4px 圆角。状态点与选项字母使用正圆。边框恒为细线，不使用胶囊式大圆角作为通用装饰。

## Components

### Buttons

- **Shape:** 紧凑矩形与轻微圆角（6px），常规高度至少 30px。
- **Primary:** 可信翠绿底、白字、650–700 字重；用于刷新、确认提交等唯一主动作。
- **Hover / Focus:** 悬停变为深林翠绿；键盘焦点使用绿色边界、3px 半透明光环和 2px 可见轮廓。
- **Secondary / Ghost:** 次按钮使用极浅绿白底与深绿字；安静按钮透明底、苔灰字，只承担收起、查看等低优先操作。
- **Disabled:** 使用雾灰底与灰字，并保留不可操作光标；不能只降低透明度。

### Chips

- **Style:** 来源、协议与轻量状态采用 4px 圆角、3px × 5px 内边距的紧凑标签。
- **State:** 选中/成功使用薄荷雾绿；谨慎使用琥珀浅底；WebSocket 可用协议紫文字，但不填充紫色大色块。

### Cards / Containers

- **Corner Style:** 常规选择行 6px，字段组 7px，空状态 8px。
- **Background:** 默认为纯白，次级或折叠容器使用雾白表面。
- **Shadow Strategy:** 面板和卡片无阴影，遵循 Flat Workspace Rule。
- **Border:** 1px 细雾线；选中时转为柔和绿边并配薄荷雾绿底。
- **Internal Padding:** 紧凑行 8–10px，面板页 14–16px。

### Inputs / Fields

- **Style:** 白底、强雾分隔线、6–7px 圆角；单行控件高 32px，水平内边距 9px。
- **Focus:** 边框转为可信翠绿，并出现半透明绿色焦点光环。
- **Error / Disabled:** 错误在字段附近使用暗红文字与浅红背景；禁用使用雾灰底和明确不可用状态。

### Navigation

浏览器导航是 32px 方形图标按钮；任务导航使用无边框文字项，激活时以深绿文字、极浅绿底和底部 2px 绿线共同表达。980px 以下隐藏非必要品牌文字和运行时标签；680px 以下任务导航等分可用宽度。

### Assistant Rail

展开态为连续的 380px 白色工作面，内容以分区和列表组织；收起态是 44px 雾白窄轨，保留清晰的纵向展开操作。窄屏首次进入默认收起，用户显式选择任务后才展开为全宽面板。

### Network Laboratory

固定于底部的诊断工作面使用 43px 工具栏和 300px 展开高度。记录列表、原始脱敏载荷和解析结果保持表格式密度；网络来源必须显示 HTTP、WS 或 DOMAIN 类型，并将原始记录与派生事件分栏呈现。

## Do's and Don'ts

### Do:

- **Do** 把真实网页留在中央最大连续区域，并让助手与诊断工具可收起。
- **Do** 用翠绿同时配合文字、边界或图标表达主动作、选择与健康状态。
- **Do** 使用真实空状态、加载状态和错误状态；未连接 AI 服务或未发现兼容模型时明确说明不可用。
- **Do** 在题目、课件和诊断数据旁保留 HTTP、WS 或领域事件来源。
- **Do** 让不可撤销提交保持“本地校验—答案预览—用户确认—显式提交”的可见顺序。

### Don't:

- **Don't** 把界面做成课堂播控台、监控大屏或卡片堆叠的仪表盘。
- **Don't** 伪造课堂名称、用户、题目答案、OCR 文本、翻译结果、成功状态或网络记录。
- **Don't** 用大面积翠绿、渐变、重阴影或胶囊按钮制造品牌感。
- **Don't** 在窄屏同时挤压真实网页、助手与网络实验室；先收起次要面板。
- **Don't** 让自动建议越过校验与逐次确认直接提交。
