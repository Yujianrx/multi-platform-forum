# Deletion and View Rankings Implementation Plan

**Goal:** 补齐安全草稿删除、员工账号删除、点赞及真实浏览榜入口，保留线上既有审核与荣誉行为。
**Architecture:** 新增迁移 014，保留历史外键；在现有内容与管理端点中事务处理删除，浏览事件与论坛阅读状态分开保存。前端沿用原组件与风格。
**Tech Stack:** React/TypeScript、Fastify、PGlite/PostgreSQL、Vitest、Playwright。
**Spec:** docs/plans/2026-11-16-deletion-views-design.md。

## Global Constraints
- 用户已明确要求落实验证，当前对话原生顺序实施；无须再次确认，不派生代理，不运行线上删除或种子数据。
- 不改写已部署 001–013 迁移；仅显式删除目标账号改变状态，其他会话、密码、附件和业务数据保留。
- 保留通过免原因、批量审核、19 条规则、账号免审、可选贡献确认、积分和勋章。

## Review Focus
- 已发表文章的新草稿删除不能删掉公开版本或撤分；旧修订 ID 必须冲突失败。
- 普通成员与版主不能删除其他账号；管理员本人和最后有效管理员受保护，重复删除不能重复审计。
- 删除账号会话与个人接口密钥失效，历史文章/回复/点赞/榜单/邀请外键继续有效，不修改其他成员。
- 浏览事件必须在权限及发布状态校验后记录，作者刷新与同日重复访问不加量，跨北京时间日期可以新增。
- 迁移真实论坛阅读状态不能伪造浏览历史，点赞/下载接口与贡献榜继续通过旧测试。

## Tasks
- [x] 1. 添加 tests/deletion-views.test.ts：草稿权限与修订冲突、账号凭据撤销和历史关联、浏览周期/去重/权限；运行失败测试。
- [x] 2. migrations/014_deletion_and_views.sql；server/admin.ts、content.ts、auth.ts、permissions.ts、discovery.ts、forum.ts 与新 views.ts；实现测试对应行为，定向通过。补充跨日、013 升级和管理员互删并发测试，完整 131 项通过。
- [x] 3. Profile.tsx 草稿删除、Admin.tsx 账号删除、Explore.tsx 三榜、Detail.tsx 浏览事件与 HomeHonors 入口；tests/e2e/deletion-views.spec.ts 三项独立浏览器流程通过，截图已检查。
- [x] 4. 构建、完整 131 项 Vitest / 40 项 Playwright 通过，隔离副本验证 45 个旧业务表数据完整保留；维护文档、部署交接清单、备份后更新本地预览及源码包已完成。未执行线上部署或真实删除。

检查完成后记录实际测试结果。当前无 Git 仓库，不创建虚构提交。
