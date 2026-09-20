# 作业详情与渲染

协议参考 [OneTHU PR #32](https://github.com/smartThise/OneTHU/pull/32)，固定版本 `5225a05b72b091767eddf670c9391004d63b10af`。沿用本项目 Electron 登录、Facade/IPC 和 Vue 界面，未移植上游的 Tauri Cookie 复制或其他平台账号管理。

## 使用

作业列表点击标题或“查看详情”，可查看说明、题干、选项、我的作答、附件名称、题目得分、教师评语。具名批注优先，同文评语只显示一次。首次进入时读取详情，随后在同一登录会话内复用成功缓存（30 分钟、最多 80 项，按最近使用淘汰）；切换页面和返回详情不会重复请求。缓存仅存内存，重启后重建。“刷新详情”绕过缓存，只读取当前条目，不重新扫描全部课程；失败不写入缓存，界面保留当前已显示内容。“在官网查看”保留为阅读及异常回退入口。

符合截止时间、补交和剩余次数条件的作业提供“前往作答”。确认后在共享登录会话的官方窗口操作；助手不注入脚本、不调用提交接口。打开作答窗口前强制核对最新状态，关闭窗口后强制读取真实详情并更新当前列表项，失败时保留旧详情并显示错误。考试、试卷题型 6 和仅含外链题型 9 的作业不提供该入口；外链题可打开自身题目链接。

考试先读取 `/v/exam/cover`。仅在当前封面确认已交卷、已有批改分数（0 分有效），且 `show_perm/show_score` 为真、成绩已公布时读取复习详情。正在进行、未作答、未批改或未开放查看的考试只显示封面，不请求 token 或内部题目接口。考试详情只用于复习，不提供开始、重新作答或提交入口。

已批改考试沿用官网 `/trans` 的登录衔接：`POST /v/exam/gen_token`（网页 Cookie + CSRF，非 H5 Bearer 请求头）→ 考试域 `/login`（仅建立共享 Chromium 会话，目标为 `/result/{exam_id}`）→ `GET /exam_room/cover` 再次验证 → `GET /exam_room/problem_results` 与 `GET /exam_room/show_paper`。考试域限定已验证的 `tsinghua-exam.yuketang.cn` 和官方默认 `examination.xuetangx.com`；平台凭据不复制到考试域，token 不进入 Renderer。登录停在重定向处，由独立 GET 读取结果。兼容 [Electron 手动重定向报错](https://github.com/electron/electron/issues/43715)，但不会将取消重定向本身视为登录成功：随后封面必须正常返回且 `user.user_id` 与 token 对应的用户一致，才可继续。

2026-09-20 在当前账号的 Academic Ethics Self-testing 验证了 10 题、90/100 分及 1 道错题。`problem_results` 的顺序与 `show_paper.problems` 相反，且题目的 `index` 均为 0，因此按 `problem_id` 关联并按试卷顺序重新编号。`result/grade/finished/correct` 分别提供作答、得分、是否作答及正误；`Options` 使用 `key/value`。只有最新考试封面的 `show_answer=true` 才展示已返回的参考答案和解析。缺失或 -1 分保留未知/未批改；不会根据整卷分数给每题补造状态。

CLI：`npm run cli -- assignment detail <id> --environment pro`，ID 来自 `assignment list`。加 `--refresh` 强制更新详情。返回 HTML 是原始内容，可能含置换字符，不能直接作为已还原明文交给 AI。

## 数据与请求

- 作业详情：`/mooc-api/v1/lms/exercise/get_exercise_list/{leaf_type_id}/?classroom_id=…&term=latest&uv_id=…`，保留现有 `xtbz: ykt` 与会话处理。
- `data.font` 与当前详情绑定；`content.Body/Options/ProblemType/TypeText/score` 提供题面；`user.my_answer/remark/comment/my_score/status` 提供个人作答与反馈。附件只展示已返回的名称，不猜测下载地址。
- 有作答内容只标记“有作答记录”；明确 `status=3/4` 才提供提交/批改证据。不用整卷 `answer_count` 推断单题提交。`-1` 是未批改占位值；完整且已批改的逐题分数才合计为整卷分数，零分有效。
- 本次应用会话仍只在启动或显式刷新作业列表时全量收集，有限并发策略不变。详情按需读取、合并进行中的重复请求；显式刷新列表使详情缓存失效，旧详情请求不能重新填入新一轮缓存。账号/登录会话变化时清理该环境的列表与详情缓存，正在读取的旧账号响应不得返回新账号。环境之间隔离，课堂 Bearer/CSRF 轮换不影响同一 Cookie 登录会话的缓存。

## 渲染与资源

题目内容经过惰性模板 DOM 解析及标签/属性白名单重建，放进 `sandbox="allow-scripts"`、无 `allow-same-origin` 的独立 `srcdoc` 文档。CSP 仅允许带本地 nonce 的脚本；父页面校验消息来源、文档 token 及已解析的图片/链接集合。远端脚本、事件属性、样式、表单和活动嵌入不会进入页面。

KaTeX 0.16.22 随应用离线分包，包含公式时才加载。支持行内/块级公式，失败保留原文；代码和加密字符片段不做公式转换。渲染限制宏展开及尺寸，关闭信任型命令。

字体与图片代理在主进程使用 Chromium Session，Cookie 不进入 Renderer；请求及每次重定向都限雨课堂/学堂在线 HTTPS 域，使用荷塘 Referer。资源并发最多 4，单次网络超时 15 秒，字体上限 4 MiB、图片上限 12 MiB，流式读取并验证文件签名。图片先直接加载，失败后代理一次，仍失败显示占位。非平台图片可直接展示，但不通过带登录会话的代理；SVG 不进入代理通道。

字体缓存以完整 URL、环境与会话摘要为键，使用受容量限制的磁盘资源缓存，最长 7 天，每次读取复验签名。失败退避 10 分钟、同 URL 请求去重、允许一次强制重取；失败 Promise 不永久驻留。字体族随隔离文档唯一，正文和回退共用 `fonts.css`；使用实际字符样本检查字体加载结果和计算样式。自动检测不能证明每个置换字形与官方一致，真实新字体仍需视觉比对。

“AI解释”按钮按用户条件暂停：当前仅能用字体渲染字形，尚无可靠的置换字符到明文的还原路径，不能用 `textContent` 等替代解码。本功能没有把加密原文接入 AI、翻译或纯文本导出；字符与字形的边界及后续要求见 [字体规范](font-policy.md)。详情接口及媒体仍可能因平台权限或协议更新失败，官网入口始终保留。
