---
name: 雨课堂助手
description: 真实网页为主、磨砂工具按需浮现的桌面伴侣
colors:
  primary: '#087c56'
  primary-strong: '#066646'
  primary-soft: '#e7f3ed'
  surface: '#ffffff'
  surface-subtle: '#f4f5f7'
  chrome: '#eef0f4'
  glass: 'rgb(247 248 251 / 96%)'
  panel-edge: '#8993a3'
  panel-edge-focused: '#637083'
  text: '#24272e'
  text-muted: '#606671'
  line: '#e0e3e8'
  line-strong: '#c7ccd4'
  caution: '#916013'
  error: '#963429'
  selection-text: '#0b3524'
  selection-fill: '#b8ead0'
  navigation-disabled: '#9a9faa'
  address-line: '#d5d9e1'
  tools-active: '#d2e6dc'
  error-soft: '#fff1ed'
typography:
  tool-error-label:
    fontSize: '12px'
  title:
    fontSize: '18px'
    fontWeight: 700
    lineHeight: 1.4
  body:
    fontSize: '13px'
    fontWeight: 400
    lineHeight: 1.55
  control:
    fontSize: '14px'
    lineHeight: 1.4
rounded:
  chip: '4px'
  control: '6px'
  icon: '8px'
  tab: '9px'
  address: '10px'
  tile: '8px'
  panel: '16px'
spacing:
  tight: '4px'
  small: '8px'
  inset: '12px'
  compact-page: '16px'
  page: '20px'
  launcher: '12px'
components:
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.surface}'
    typography: '{typography.control}'
    rounded: '{rounded.control}'
    height: '36px'
  button-primary-hover:
    backgroundColor: '{colors.primary-strong}'
    textColor: '{colors.surface}'
  button-secondary:
    backgroundColor: '#f8fcfa'
    textColor: '{colors.primary-strong}'
    typography: '{typography.control}'
    rounded: '{rounded.control}'
    height: '36px'
  button-quiet:
    backgroundColor: 'transparent'
    textColor: '{colors.text-muted}'
    typography: '{typography.control}'
    rounded: '{rounded.control}'
    height: '36px'
  field:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
    typography: '{typography.control}'
    rounded: '{rounded.control}'
    padding: '0 9px'
    height: '36px'
  browser-navigation:
    backgroundColor: 'transparent'
    textColor: '{colors.text-muted}'
    rounded: '{rounded.icon}'
    height: '36px'
    width: '36px'
  tool-tile:
    backgroundColor: 'transparent'
    textColor: '{colors.text}'
    rounded: '{rounded.tile}'
    padding: '6px'
    height: '44px'
  floating-panel:
    backgroundColor: '{colors.glass}'
    textColor: '{colors.text}'
    rounded: '{rounded.panel}'
    borderColor: '{colors.panel-edge}'
  panel-titlebar:
    backgroundColor: 'rgb(255 255 255 / 35%)'
    textColor: '{colors.text}'
    padding: '6px 10px'
    height: '52px'
  panel-control:
    backgroundColor: 'transparent'
    textColor: '{colors.text-muted}'
    rounded: '{rounded.icon}'
    height: '36px'
    width: '36px'
  source-chip:
    backgroundColor: '{colors.primary-soft}'
    textColor: '{colors.primary-strong}'
    rounded: '{rounded.chip}'
    padding: '3px 5px'
---

# Design System: 雨课堂助手

## Overview

**Creative North Star: "浮于网页之上的桌面工具"**

用户确定的方向是 macOS 风格的桌面重置：真实雨课堂网页是唯一主工作面，助手以按需出现的磨砂浮层提供工具。冷白、深灰、克制的绿色和柔和圆角建立清楚的层次；工具入口依靠图标与空间排列组织，不再用一长排功能标签分割工作区。

这是已实现界面的代码提取记录。系统字体、清晰焦点与可滚动内容优先于装饰；保留浏览器原生的网页标签，功能导航则使用独立工具网格。每个工具拥有稳定身份和独立的原生视图，同一工具重复打开会唤回已有面板。磨砂质感是高不透明度着色表面，不承诺原生 macOS vibrancy。

**Key Characteristics:**

- 真实网页持续占据工具栏以下的完整主区域。
- 助手和网络诊断可同时打开，各自拥有可移动、缩放和收起的浮层。
- 图标网格提供功能入口，正文与操作控件保持可读尺寸。
- 窄窗口减少网格列数，并让内容独立滚动。

## Colors

冷白与石墨灰构成安静底色；绿色只承担主操作、选中、焦点与健康状态。

### Primary

- **沉静翠绿 / 深翠绿**：分别用于主动作与其悬停、工具图标和强调文字。
- **薄荷浅绿**：用于按下、选择和轻量状态反馈。
- **工具激活浅绿**：标记工具按钮的悬停或展开；**选区深绿 / 选区薄荷绿**仅用于文本选择前景与背景。

### Neutral

- **冷白表面 / 冷灰顶栏**：承载字段、内容和浏览器控制区。
- **磨砂白**：浮层的高不透明度背景，保证网页复杂时仍能阅读。
- **石墨正文 / 灰蓝次文**：分别承担任务信息与解释、元数据。
- **细灰边界 / 强灰边界**：区分内容行、输入与结构边缘；**地址栏灰边**用于地址字段的默认轮廓。
- **禁用导航灰**：用于浏览器不可用的前进、后退等操作，不作为正文色。

谨慎琥珀和错误红仅表达对应状态，并始终配合文字；浏览器与浮层错误消息使用浅红错误底。

**The One Green Signal Rule.** 绿色必须对应操作、选择或状态，不能成为大面积装饰。

## Typography

字体栈以 macOS 系统字体开头，同时保留 Windows 中文与通用系统后备；不加载展示字体。任务标题使用 title，说明与信息正文使用 body，助手按钮和单行输入使用 control。浏览器标签与网络筛选仍保留紧凑正文尺度；不要把所有技术元数据都误记成操作控件。tool-error-label 仅用于工具入口的真实加载失败及重试提示。

**The Layout Explains Rule.** 用户已明确要求由布局与控件表达交互。保留功能名称、实际错误与连接状态，不追加多面板/拖动说明、面板计数、“已打开”徽标或底部 Esc 提示；键盘操作通过控件语义和必要的可访问标签保留。

**The Readable Controls Rule.** 常规助手操作使用至少 36px 高度和 14px 字号；窄屏通过换行与滚动适应，不继续缩小正文。

## Layout

顶部浏览器控制区总高 104px，网页标签行 46px、导航行 58px。它下方的嵌入网页占满主区域；打开工具不改变网页宽度，也不预留右侧栏或底部实验室。

面板在网页工作区内独立定位、叠放和缩放，通常保留 12px 外边距，极小工作区会进一步缩减。普通面板默认宽 560px，网络面板默认宽 640px，默认高度不超过 640px；这些是初始尺寸，不是缩放上限。最小尺寸以 360 × 240px 为目标，但始终受可用工作区限制，位置也会被约束在工作区内。新面板采用 28px 错位，避免完全重合。

“全部工具”默认和复位尺寸为 560 × 240px。宽度不足 514px 时，高度最多 280px，给第三行工具留出位置。自动排列也按这一高度限制工具启动器，用户仍可手动缩放或展开。

每个面板的标题栏固定、内容独立滚动。工具网格根据面板可用宽度按列排列，列宽至少 78px（极窄时单列），列间距 4px，网格宽度上限 560px。工具入口的图标与名称并排，按钮最小高度 44px。响应式查询分别依据主窗口或独立面板视口，不能只按外层窗口宽度推断布局。自动排列优先以 12px 间隔平铺；单格高度不足 240px 时改为错位层叠，保留可恢复的操作入口。

主窗口宽度不超过 760px 时隐藏品牌文字；不超过 560px 时收紧顶栏间距、简化环境与地址装饰。工具视口高度不超过 500px 时，网络工具的整个内容区域纵向滚动，避免筛选区挤掉记录与详情。网络工作区将记录和详情上下排列，详情内部保留两列。窗口初始大小受显示器工作区限制，常规最小尺寸为 480 × 400px。

**The Webpage First Rule.** 工具可以覆盖网页；未覆盖区域保持原生网页交互。收起全部面板后立即还原完整网页工作面，不遗留固定栏或诊断底座。

## Elevation & Depth

浮层用 1px 灰蓝描边、高不透明度着色和圆角与网页分离。描边位于原生视图内，聚焦面板置于上层并加深描边、提高标题栏亮度，普通内容继续用分隔线组织。CSS 声明了模糊与饱和度处理，但 Chromium 的独立 WebContentsView 之间不能依赖 backdrop-filter 模糊背后的网页，因此着色底是实际可读性保障。减少透明度偏好使用实色背景。

当前应用的阴影仅包括选中网页标签的轻阴影（`0 2px 5px rgb(25 31 45 / 7%)`）、工具入口悬停阴影（`0 4px 12px rgb(25 31 45 / 8%)`）和助手字段焦点光环（`0 0 0 3px rgb(8 138 87 / 14%)`）。全局键盘焦点另有可见描边。减少动态效果偏好停用动画和过渡。

## Shapes

外层工具面板使用最大圆角，图标入口和地址栏次之，表单与信息标签保持紧凑圆角。浏览器图标通常为 20px，工具网格图标为 20px，使用细线 SVG；状态点保留正圆。外层柔和，内部规整，不把每一段内容再包成漂浮卡片。

## Components

### Buttons

主按钮为翠绿白字，悬停加深；次按钮为浅色底与深绿字；安静按钮用于返回、关闭等低优先动作。禁用状态有明确灰色和不可用光标。键盘焦点可见，不依赖悬停才能发现操作。

### Inputs / Fields

表单使用白底、细边框与紧凑圆角；焦点强调绿色边界与光环。地址栏更圆润，独立高 38px；其内部输入保持完整可用宽度。长文本与来源信息允许换行，输入不得溢出工具视口。

### Navigation

网页标签继续服务于真正的多网页浏览。工具启动器的标题统一在标题栏显示，自动排列和收起全部使用同一栏的图标按钮。图标网格打开独立功能面板；已打开入口仅用浅绿底表示，按钮以 aria-pressed 向辅助技术表达状态，不添加“已打开”文字。不同工具可以并存。主壳的已打开面板按钮用于找回和聚焦被遮挡的面板，不承担完整功能目录。功能面板可再次打开工具启动器，关联任务也可在当前面板内切换并返回。

### Cards / Containers

磨砂浮层是共享的窗口样式，每个功能使用独立容器；内部仍使用列表、表单和轻边框内容块。网络诊断拥有自己的面板，不占据底部固定区域。AI Profile 卡片仍表达模型服务与角色分配，不改变功能含义。通知宽度随视口收缩，长内容在限定高度内滚动，避免覆盖小窗口中的全部操作区域。各任务只呈现对应内容；诊断内容只在诊断页出现，不附加到作业或课程页面。

### Floating Panel Controls

标题栏提供工具入口、复位、展开/还原和收起按钮。拖动标题移动面板，右下手柄调整大小；标题双击也可展开/还原。展开仅占满网页工作区，保留浏览器控制区。指针操作使用捕获和屏幕坐标差值，面板移动期间手势保持连续。

标题或缩放手柄聚焦时，方向键以 10px 调整，Shift + 方向键以 40px 调整；展开态先还原才能移动或缩放。点击或键盘进入面板会将它置顶。Esc 只收起当前面板，焦点移到仍可见的最上层面板，没有其他面板时返回主壳。“收起全部”返回完整网页；复位恢复当前面板默认位置与大小。

收起不销毁面板，本次运行中再次打开保留其组件状态和位置；应用重启或失败重建不提供状态延续保证。视图按稳定工具 ID 缓存，内容按需加载并使用 Vue KeepAlive；手势逻辑由作用域内的组合式函数管理，释放时清理指针捕获和待执行帧。

### Chips

HTTP、WS、领域来源与轻量状态保留短标签；它们辅助追溯，不作为主要导航。来源标签中的微型文字不能作为表单或按钮的字号基准。

## Do's and Don'ts

### Do:

- **Do** 保留真实网页完整区域，让辅助任务按需浮现并可关闭。
- **Do** 用图标和清晰的空间排列组织工具，同时保留简短功能名称；打开状态用绿色底与 aria-pressed 表达。
- **Do** 依据每个面板的视口调整网格、换行与滚动，并保留复位和找回入口。
- **Do** 保留可见焦点、状态文字以及真实的空、加载、失败状态。

### Don't:

- **Don't** 恢复永久右侧助手、底部网络实验室或替代工具网格的完整横排功能目录。
- **Don't** 把 CSS 磨砂效果描述为跨原生视图模糊或原生 vibrancy。
- **Don't** 用缩小正文与操作控件来解决小屏空间不足。
- **Don't** 用虚构课堂、答案、模型连接或网络记录填充界面。
- **Don't** 重新加入解释布局的段落、打开数量、“已打开”徽标或底部快捷键提示。
