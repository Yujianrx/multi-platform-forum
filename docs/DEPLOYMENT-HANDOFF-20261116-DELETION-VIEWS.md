# 草稿删除、员工删除与浏览榜：部署交接

本轮为本地源项目交付，未操作线上服务器，未删除任何线上或本地预览中的真实账号/草稿。服务器侧请从现有 `20261116-v5` 版本，沿用既有备份、隔离副本升级及 HTTPS 验证流程部署。

## 可部署改动

| 模块 | 改动 | 主要文件 |
| --- | --- | --- |
| 草稿删除 | 草稿箱逐项删除；未发布/已下架内容软删除，公开文章只丢弃新草稿；修订 ID 防过时误删，保留公开文章积分与评论 | `server/content.ts`、`server/permissions.ts`、`src/pages/Profile.tsx` |
| 员工删除 | 仅管理员；输入登录名确认；禁止删本人；撤销会话、接口密钥、重置凭证及管理授权，清头像简介，保留作者 ID 与历史数据 | `server/admin.ts`、`server/auth.ts`、`server/avatars.ts`、`src/pages/Admin.tsx` |
| 浏览榜 | 新增真实浏览事件、每日北京时间去重、排除作者、有权且已发布才计数；首页入口与点赞/浏览/下载三榜 | `server/views.ts`、`server/forum.ts`、`server/discovery.ts`、`src/pages/Detail.tsx`、`src/pages/Explore.tsx`、`src/Honors.tsx` |
| 维护约束 | 固化线上审核、免审、贡献资格与数据保留约定 | `docs/MAINTENANCE.md`、`docs/MODERATION.md`、`README.md` |

接口：`DELETE /api/contents/:id/draft`（`{revisionId: UUID|null}`）；`DELETE /api/admin/users/:id`（`{username: 登录名}`）；`POST /api/contents/:id/visit`；`GET /api/rankings?metric=views&period=week|month|all`。论坛原 visit 接口继续可用，同时记录浏览事件。写接口沿用会话、Origin、CSRF、角色和来源权限。

原 `/rankings?metric=likes`、`metric=downloads` 和 `/honors` 都保留，不将下载量重命名成浏览量。新榜不发积分。旧论坛只有最近阅读时间，迁移只保留这一真实记录，不能当成完整历史每日浏览。

## 数据库迁移

仅新增 **014_deletion_and_views.sql**：

- `users.deleted_at`、`users.deleted_by`，约束已删除账号不可启用；旧账号均为空。
- `revisions.discarded_at`，丢弃的未发布修订不再出现在版本读取中。
- `content_view_events`，按内容、用户和北京时间日期唯一，含事件时间索引。
- 从已发布话题的真实 `forum_visits.last_seen_at` 转入最近一次访问，排除作者；不创建演示内容、账号、积分或虚构访问。

001–013 与上次交付源码包逐字节一致。核对 `server/moderation.ts`、`src/admin-type.css`、两份 bulk-review 测试和 2026-11-14 两份设计/计划文档，亦与上次源码包逐字节一致；后台新增删除功能保留原审核分支及按钮行为。

## 本地验证与部署侧续做

本地生产构建和类型检查通过；完整 **131 项 Vitest、40 项 Playwright 全部通过**。新增测试覆盖权限、过时修订、凭据撤销、历史关联、管理员并发互删、跨北京时间日期、周期统计和 013→014 迁移。详细结果记录在 `docs/VERIFICATION.md`，对应截图与校验 JSON 在 `outputs/`。

本地预览已先停止进程并备份，再迁移重启。备份：`work/backup-before-deletion-20261116-145913/data`。另复制备份到隔离目录演练迁移，对 **45 个既有业务表的全部旧列和行**逐一比较，完全一致；只有新表/新列与迁移登记新增，旧账号删除数为 0。实际预览页面运行异常为 0。

这次升级演练使用 PGlite；服务器对话需再次对真实 PostgreSQL 副本演练，不把上一版 PostgreSQL 成功结果当成本版结果。重点检查删除事务、外键关联、会话与密钥撤销、原审核免原因通过、附件同事务放行、积分不自动认定，以及真实新浏览事件。

正式部署保留 `data/`、数据库、私有上传、环境密钥、现有密码和会话，禁止 seed。通过实际测试账号验证删除时应只使用隔离副本；正式站只检查页面、读接口和随机不存在的 ID，不删除真实账号、草稿或审批真实待审内容。

删除采用不可恢复的账号业务标记和匿名显示，保留历史外键，不物理级联清库。回滚代码前评估已删除账号与新约束，旧代码不识别删除标记；不能用覆盖整库的方式随意撤销代码升级。

源码包：`outputs/小鱼号AI共创社区-完整源码.zip`。迁移、源码、测试和维护文档随包交付，不包含 `.env`、数据目录、依赖目录、上传文件或凭据。变更文件与摘要见 `outputs/删除与浏览榜-源码变更清单.json`。
