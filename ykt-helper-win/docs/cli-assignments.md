# 独立 CLI：作业与考试

在 `ykt-helper-win` 目录构建后，入口为 `node apps/cli/dist/ykt-cli.cjs`（下文简称 `ykt`）。作业命令加 `--headless` 后使用纯 Node HTTP 会话，不启动 Electron、浏览器、Desktop Runtime 或本机 RPC 管道。原有不带 `--headless` 的 Desktop 模式保持兼容。

## 会话

独立模式使用用户显式提供的有效荷塘雨课堂会话，尚不提供扫码登录。通过 `--session-file <path>` 或 `YKT_SESSION_FILE` 指定私有 JSON 文件；`--session-file -` 从 stdin 读取。文件格式：

```json
{
  "environment": "pro",
  "cookieHeader": "sessionid=<登录会话>; csrftoken=<CSRF值>; uv_id=<学校ID>",
  "bearerToken": null,
  "userId": null
}
```

使用账号实际登录请求的完整 Cookie；`bearerToken` 和 `userId` 可省略。凭据不作为命令行参数传递、不写入结果或缓存。请将会话文件保存在仓库外并限制文件权限（macOS/Linux 可用 `chmod 600`）。凭据失效时返回 `SESSION_EXPIRED`，清除此会话的作业缓存；更新文件后重试。不会读取 Desktop Cookie 数据库或调用系统钥匙串。

考试结果服务通过官方 `gen_token → /login → /exam_room/cover` 建立独立 Cookie 会话，使用域名/路径规则管理 `Set-Cookie`，不把平台 Cookie 或 Bearer 复制给考试域，也不跟随登录重定向。只有两次实时封面校验均证明已交卷、已出分且开放查看，才读取内部题目接口；进行中、未作答、未出分或未开放的考试保持封面。未发布标准答案时不从个人作答推断答案。

## 命令

以下命令末尾均可追加 `--headless --session-file /path/to/session.json`；若不追加，则连接已运行的 Desktop。

```sh
# 列表：状态、截止时间、已答数、批改分数、逐题作答状态和官网链接
ykt assignment list --refresh
ykt homework list --search "课程名" --graded
ykt exam list --search "Academic Ethics Self-testing" --graded
ykt assignment list --kind homework --status partial

# 用列表返回的 id 读取详情，题号按原试卷编号（从 1 开始）
ykt exam detail '<id>'
ykt exam question '<id>' --index 2 --refresh
ykt exam answer '<id>' --index 2
ykt homework question '<id>' --index 1
```

`assignment` 同时处理作业与考试；`homework` 和 `exam` 是带类型检查的别名。列表 `--search` 匹配课程名或标题（忽略大小写），`--status` 接受 `unanswered`、`partial`、`answered`、`unknown`，`--graded` 只保留已批改条目。筛选后仍保留部分收集失败等 `warnings`。

`detail` 保留完整 DTO；`question` 仅返回指定题的题干、选项、个人作答、附件、批改分数、反馈和已发布参考答案，另附作业元数据；`answer` 返回该题平台提供的 `correctAnswerHtml` 和 `explanationHtml`。没有题目权限返回 `REVIEW_UNAVAILABLE`，没有已发布标准答案返回 `ANSWER_UNAVAILABLE`，不存在的题号返回 `NOT_FOUND`。不提供作业/考试提交、考试开始或重置命令。

输出保持 JSON，正文保留原始 HTML 与 `fontUrl`，单题结果标记 `contentEncoding: "source-html"`。这不是加密字体解码，不能把原始置换字符当作明文；详见[字体规范](font-policy.md)。本 CLI 不执行题目 HTML、OCR 或自动调用 AI。

## 缓存与刷新

独立模式将列表与详情缓存到 `~/.yuketang-helper-cli/cache`；可通过 `--cache-dir <path>` 隔离测试。缓存按环境和登录凭据摘要隔离，最长 30 分钟、每会话最多 80 份详情，跨 CLI 进程复用。目录/新文件权限分别为 `0700`/`0600`（Windows 仍受系统 ACL 控制），写入采用原子替换；缓存含个人作答，不能公开分享。

列表刷新复用现有最多 4 路并发收集，并使详情缓存失效；单题或详情的 `--refresh` 只强制刷新该条目的详情（列表不存在或过期时先收集列表）。显式刷新失败直接报错，不回退旧答案。返回的 `fetchedAt` 是实际采集时间，命中缓存时保持原值。

## 无 Desktop 实测

2026-09-20，退出本项目 Desktop 后，使用此前保存的登录凭据（只取凭据，不回放旧响应）执行 `exam list --headless --refresh` 和 `exam question <id> --index 2 --headless --refresh`，实时查到 `Academic Ethics Self-testing` 并取得第 2 题。随后独立 `exam answer` 进程命中相同 `fetchedAt` 的缓存，返回平台已发布标准答案 `B`。测试期间未使用 computer use，也未启动 Desktop 或浏览器。
