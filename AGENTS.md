# 项目协作约束

Avoid unnecessary secondary labels and descriptions. Let the layout do the explaining.
避免不必要的辅助标签与说明。让布局本身发挥解释作用。

- 先读 `CONTRIBUTING.md` 与 `docs/MAINTENANCE.md`，按当前用户任务完成工作；保留其他人的修改。
- 网页和手机网页共用服务端；手机样式在 `src/mobile/` 隔离，未要求调整桌面时保持电脑布局。小程序与云函数在 `wechat/`，沿用同一账号、权限、内容和审核数据源。
- 不向源码或公开记录写入密钥、真实账号凭据、数据库与私有附件。不得使用开发 seed 或本地数据库覆盖已有环境。
- 数据库迁移只追加，不修改已应用 SQL；正文和附件统一审核、账号免审及积分规则依 `docs/MAINTENANCE.md` 保持。
- 验证与实际改动相匹配，纯文档更新检查内容和链接即可。提交、部署、云函数发布和微信审核状态分开记录，不将上传称为正式上线。
