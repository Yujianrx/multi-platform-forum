# AI 共创社区 Implementation Plan

**Goal:** 交付本地可运行、具备 Linux 容器部署条件的内部分享社区。

**Architecture:** React 单页应用；Fastify API、同进程持久化任务 worker；PostgreSQL 事务和统一权限服务；受保护磁盘存储。

**Tech Stack:** TypeScript、React、Fastify、PostgreSQL/PGlite、Zod、Vite、Vitest、Playwright。

**Spec:** docs/plans/2026-11-13-community-design.md；完整用户需求见 docs/product-requirements.txt。

执行方式：用户已要求本会话持续开发，直接实施，不额外分派代理。

## Global Constraints

- 公司内部、邀请码注册；普通用户不能更改角色部门。
- 四种内容类型；持久化数据库与文件；生产不得使用模拟审核。
- 所有发现、互动、历史、通知与下载均实时鉴权。
- 不接入支付、私信、企业微信或在线执行技能。

## Review Focus

- 并发注册同一邀请码最后名额：只成功一次。
- 修改部门或范围后旧链接与旧会话请求：即时重新判权。
- 旧审核任务晚到：不得发布新修订。
- 扫描异常、压缩炸弹及路径穿越：隔离或拒绝。
- 缺少真实审核服务的生产配置：绝不自动通过。

## Task 1 基础与账号

- [x] server/db.ts + migrations/001_init.sql：统一 query/transaction 接口和约束。
- [x] server/auth.ts：注册、登录、退出、资料、密码重置、限流及 CSRF。
- [x] src/styles.css、src/App.tsx：设计系统、路由、会话与错误反馈。
- [x] tests/integration.test.ts：账号与邀请码并发测试。

## Task 2 权限与后台基础

- [x] server/permissions.ts：canRead/canManage SQL 谓词及资源校验。
- [x] server/admin.ts：部门、用户、邀请、授权、操作日志。
- [x] tests/integration.test.ts：部门越权、停用、角色升级测试。

## Task 3 发布、存储、版本与审核

- [x] server/content.ts：不可变修订、草稿、审核与旧版本保留。
- [x] server/storage.ts：真实类型验证、受限解析、隔离与下载。
- [x] server/moderation.ts：规则、供应商接口、租约、失败重试。
- [x] src/pages/Editor.tsx、Detail.tsx：四类表单、预览、进度、版本。
- [x] tests/integration.test.ts：修订、审核状态、文件安全、下载去重。

## Task 4 内容发现

- [x] server/discovery.ts：中文搜索、过滤、分页、轮播及事件榜单。
- [x] src/pages/Home.tsx、Explore.tsx：首页、分类、搜索和排行榜。
- [x] 测试部门内容在搜索、榜单、轮播中不可泄露。

## Task 5 互动与管理

- [x] server/social.ts：点赞、收藏、评论、回复、通知、举报。
- [x] src/pages/Profile.tsx、Admin.tsx：个人中心、配置与管理。
- [x] 测试互动持久化、评论审核、管理范围和通知过滤。

## Task 6 运行验证与部署

- [x] npm run build、npm test；端到端注册发布审核下载。
- [x] 桌面与手机截图；修复溢出、操作不可达及焦点问题。
- [x] Dockerfile、compose.yaml、deploy/Caddyfile、备份恢复与审核接入文档。
- [x] 记录实际执行结果和未验证外部依赖，打包完整源码。

## 最终状态

2026-11-13：本地实现与验证完成。31 项集成测试、5 项浏览器端到端测试通过。部署文件已准备，远程服务器与真实外部服务未配置/未部署，详见 docs/VERIFICATION.md。
