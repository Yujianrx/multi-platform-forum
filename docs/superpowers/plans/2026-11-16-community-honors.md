# Community Honors Implementation Plan

**Goal:** 落地已确认的积分、等级、自然周榜和六枚勋章。
**Architecture:** 现有事务内同步资格/账本；独立 honors 模块负责重算、周榜快照和 API，复用鉴权与审计。前端复用荣誉组件，管理端按需加载，勋章 WebP。
**Tech Stack:** React/TypeScript, Fastify, PostgreSQL/PGlite, Sharp, Vitest, Playwright。
**Spec:** docs/plans/2026-11-16-community-honors-design.md（已确认）。

## Global Constraints
每次 20、每类每周 3、北京时间自然周、同分并列、无现金消费机制、历史不补分、免审发布不变、私有来源仍判权。
本会话顺序执行，不派生子代理；无 Git 仓库，不虚构提交。

## Review Focus
- 并发审核/采纳与删除锁顺序：源内容锁后荣誉全局事务锁，禁止反向请求内容锁。
- 来源修订变化/文件失效：资格和勋章及时失效，原周补位可重算。
- 停机跨年：UTC 持久化、上海周边界、历史结算补偿。
- 部门权限变化：流水与勋章不暴露无权来源标题、链接。
- 免审及管理代采纳：发布与得分条件独立。

## Tasks
- [x] 1. migrations/013_community_honors.sql、server/honors-policy.ts、honors-engine.ts：资格、幂等流水、上限/补位/等级/自动勋章/周榜。tests/honors.test.ts 覆盖给定边界。
- [x] 2. server/honors-routes.ts 与 moderation/content/social/forum/storage/admin 挂接：源变化、人工资格、人工授勋、读取判权与审计。tests/honors-api.test.ts 覆盖真实请求及越权。
- [x] 3. src/Honors.tsx、HonorsAdmin.tsx、honors.css：个人进度/流水/墙、四榜、历史、管理；嵌入 Home/Profile/Detail/Forum/Admin/App。生成并压缩六枚勋章素材。
- [x] 4. tests/e2e/honors.spec.ts：用户可见闭环、手机空状态、勋章详情与榜单，运行完整构建、单元集成与浏览器回归。最终 121 项 Vitest、37 项 Playwright 全部通过。
- [x] 5. 备份本地库，迁移重启最新预览，实际检查，更新 README/验收/源码包。

每项先以精确行为测试验证，再实现；测试通过才推进。既有 102 项 Vitest、34 项 Playwright 保持通过。不扩大测试与无关代码重构。
