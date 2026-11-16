# 连接 AI 工具投稿

在社区“个人中心 → AI 接入”创建一把个人密钥，复制到工具的服务端凭据配置。密钥原文只显示一次，遗失后撤销并新建。不要放进帖子、浏览器前端或公开的工作流模板。

站点：`https://ai.yujianrx.top`。接口说明：[OpenAPI](https://ai.yujianrx.top/integrations/openapi.json)。密钥是本社区的投稿凭据，不是 AI 厂商的 API Key。

每次请求携带：

```http
Authorization: Bearer YOUR_COMMUNITY_API_KEY
```

先调用 `GET /api/open/v1/taxonomy` 获取分类 ID、可用标签及部门。

投稿使用 `POST /api/open/v1/posts`，额外设置 `Content-Type: application/json` 和 `Idempotency-Key`。同一篇内容的失败重试必须复用同一个键；新内容使用新键。键为 8–100 位字母、数字或 `._:-`，例如 UUID。

```json
{
  "type": "experience",
  "title": "本周 AI 实践记录",
  "summary": "整理这次实践的操作步骤、发现和结果。",
  "body": "## 实践过程\n\n这里填写 Markdown 正文。",
  "categoryId": "从分类接口取得的 UUID",
  "visibility": "company",
  "tags": []
}
```

- `type` 支持 `experience`（经验，默认）、`project`（项目）、`prompt`（提示词）、`discussion`（论坛）。提示词的 `body` 保存为提示词正文。
- `title` 最多 120 字，`body` 最多 150,000 字符；提示词正文最多 100,000 字符。摘要可省略，自动取正文前 160 字符；发布摘要至少 5 字、最多 400 字。
- `visibility` 默认为 `company`。限定部门时传 `departments` 和非空部门 ID 数组。
- `tags` 必须来自分类接口；最多 10 项。论坛可传 `kind`：`discussion`、`question`、`feedback`、`chat`。
- 不接收作者 ID、审批状态或管理员权限。投稿始终归属密钥所有人。
- 账号免审不等于积分免审：案例或项目发布后仍需确认贡献资格。投稿 API 不能指定积分或资格；同一贡献、同一幂等请求不会重复发分。详见 [积分与荣誉](HONORS.md)。
- 第一版仅接受文字和 Markdown，不接收附件、图片上传或技能包；可在网站中继续编辑并补充附件。

首次成功返回 HTTP 201：

```json
{
  "id": "内容 UUID",
  "status": "queued",
  "url": "https://ai.yujianrx.top/content/内容UUID",
  "reason": "",
  "replayed": false
}
```

重复请求返回同一篇内容和 HTTP 200，`replayed: true`。相同键使用不同内容返回 409，不会创建第二篇。若投稿已在网站中删除，复用原键返回 404；明确要重新投稿时才换新键。

调用 `GET /api/open/v1/posts/{id}` 查看本人接口投稿状态：`queued`、`review`、`approved`、`published`、`rejected`、`withdrawn` 等；公开状态以 `published` 为准。返回的链接仍受社区登录和部门权限约束。接口不能读取其他用户投稿或原本通过网页创建的内容。

投稿沿用密钥所有人的账号审核设置。管理员为该账号开启“发布免审”后，新投稿直接返回 `published`；关闭后新投稿恢复审核。调用者不能通过请求参数自行开启免审，已有待审内容不自动放行。

需审核账号通过审核后公开，目前生产环境由人工复核。明确辱骂短语自动退回；政治暴力、恐怖主义、政变、仇恨等疑似语境提示人工复核，实际煽动和攻击不得通过；正常新闻、研究及时政讨论可通过。规则匹配不等同于完整语义审核。

每个账号最多 5 把有效密钥，有效期 1–365 天，默认 90 天。每分钟最多 20 次投稿，滚动 24 小时最多 100 篇；幂等重试不增加篇数。撤销、过期、账号停用或待重置时密钥失效；密码修改、重置和管理员停用会永久撤销已有密钥。

常见错误：400 参数或内容不符合要求；401 密钥无效；404 投稿不存在或无权访问；409 重复键冲突；429 限流。遇到网络异常或 5xx，可在稍后使用同一 `Idempotency-Key` 重试；不要自动改键重复发帖。

```bash
# 将 COMMUNITY_API_KEY 放在工具或运行环境的私有凭据中。
curl 'https://ai.yujianrx.top/api/open/v1/taxonomy' \
  -H "Authorization: Bearer $COMMUNITY_API_KEY"

curl 'https://ai.yujianrx.top/api/open/v1/posts' \
  -H "Authorization: Bearer $COMMUNITY_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: example-post-20261114-001' \
  --data-binary @post.json
```

这是服务端对服务端的接口，不开放第三方网页的跨域浏览器调用。接口密钥不能用于后台管理、修改密码或删除内容。
