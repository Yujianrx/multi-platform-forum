# 小鱼号微信小程序

在微信开发者工具导入本目录。小程序原生页面在 `miniprogram/`，微信身份云函数在 `cloudfunctions/communityIdentity/`；首页、讨论、个人页和发布流程沿用小鱼号手机网页的红白品牌与布局。

[仓库首页](../README.md) · [开发与操作规范](../CONTRIBUTING.md) · [手机网页基准](../docs/MOBILE.md) · [维护与上线约束](../docs/MAINTENANCE.md)

## 版本状态

截至 2026-11-18，最近交接记录为 **0.2.0 开发版已上传，尚未提交审核**。现有 [微信接入回执](../docs/DEPLOYMENT-RECEIPT-20261117-WECHAT.md) 记录的是初次 0.1.0 开发版与网站 v10 接入，保留为历史验收证据，不改写成后续版本的发布结果。正式提审和发布状态需在微信公众平台确认并追加回执。

## 代码入口

| 位置 | 职责 |
| --- | --- |
| `miniprogram/pages/` | 首页、讨论、详情、发布、消息、个人页、榜单 |
| `miniprogram/components/` | 内容卡片、加载与错误状态、私有图片、正文展示 |
| `miniprogram/custom-tab-bar/` | 首页、讨论、发布、消息、我的五入口 |
| `miniprogram/lib/api.js` | 云函数调用、登录状态与社区接口 |
| `cloudfunctions/communityIdentity/` | 微信身份、手机号能力和服务端接口桥接 |
| `../server/miniprogram.ts` | 账号绑定、小程序会话及服务端访问边界 |

修改小程序使用 `area:wechat` 标签；同时改动共用服务端时加 `area:backend`，涉及云函数配置或上线时加 `type:deployment`。

## 登录与数据

网页管理员可在「成员与权限」为成员填写手机号。成员在小程序授权微信手机号后可进入对应的原账号，也可使用社区账号密码登录。新成员使用同一套邀请码注册。已经配对的微信可直接登录，[社区绑定页](https://ai.yujianrx.top/wechat)继续提供配对及解除绑定。

小程序通过 `wx.cloud.callFunction` 调用 `communityIdentity`，云函数通过 HTTPS 访问社区服务器上允许小程序使用的接口。网页与小程序共用账号、内容、部门权限和审核记录。小程序单个附件上限为 700 KiB，更大的附件可在网页处理。

小程序内支持搜索、资源与论坛、附件预览、点赞收藏、评论回复、消息、榜单、个人贡献、草稿与发布。编辑器输入 Markdown。后台审核、成员管理和 ZIP 下载继续通过网页操作。

## 部署

1. 使用微信开发者工具中已确认的 AppID `wxba3e4b720e083da7` 和环境 `cloud1-d5g26cy701a189c0a`。运行 `cloud functions deploy --env cloud1-d5g26cy701a189c0a --names communityIdentity --project <工程路径> --remote-npm-install` 部署云函数。
2. 在 `communityIdentity` 的函数环境变量配置 `MINIPROGRAM_APP_ID` 与 `MINIPROGRAM_BRIDGE_SECRET`。社区服务器运行环境使用相同的两个变量。密钥只经服务器和云函数配置传递，不放进工程、前端、部署回执或共享文件。云函数推荐超时 10 秒。
3. 核对微信手机号授权资质和隐私保护指引。在真机验证手机号登录、列表、讨论和附件，再用不同权限的成员验证部门可见范围。使用隔离数据验证发布和复核等写入。
4. 通过微信公众平台核对主体、备案、用户隐私保护指引及社区服务类目。提审只提供隔离的审核体验账号与内容。开发版上传、体验版、提审与审核通过后发布是不同状态，以微信后台为准。

### 回退

关闭小程序接入时，可保留迁移后的结构。停止社区服务，撤销 `sessions` 中 `mini_app_id IS NOT NULL` 的会话，恢复备份中的原配置，并切回原发布目录。撤销小程序会话必须先于切回 v9，旧版 Web 代码不区分小程序会话。恢复服务后检查网站和 HTTPS。避免用旧数据库覆盖此后新增的线上数据。
