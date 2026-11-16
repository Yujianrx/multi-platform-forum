# Xiaoyu Community Implementation Plan

**Goal:** 实现已确认的四项体验修复与小鱼号品牌更新。

**Architecture:** 原有两栏布局、站点设置和权限体系；头像新增独立私有存储与版本复核。品牌直接使用用户提供的透明矢量/PNG。

**Tech Stack:** React/TypeScript、Fastify、PGlite/PostgreSQL、sharp、Playwright。

**Spec:** docs/plans/2026-11-14-xiaoyu-community-design.md

## Global Constraints
- 站点名称“小鱼号AI共创社区”；保留 LOGO 字形、人物形象与透明通道。
- 避免不必要的辅助标签与说明。
- 头像 5 MB / 20 MP、仅 PNG/JPEG/WebP、重编码 256px；待审素材不可公开、旧审核不可覆盖新版本。
- 无外部部署、无新服务或 API 密钥需求，无额外确认或子代理。

## Review Focus
- 查询参数顺序、搜索字符串与浏览器后退不误激活其他导航。
- 900/1200/1440px 主列与侧栏对齐；390px 无横向溢出。
- 头像上传伪扩展、超限、扫描失败、未登录与越权读取保持隔离。
- 待审头像替换和旧审批并发不覆盖最新头像。
- 刷新和其他成员查看时头像一致，默认/失败图保留可读替代。

### Task 1: Layout and brand
Files: src/App.tsx, src/BrandIdentity.tsx, src/pages/Home.tsx, src/pages/Detail.tsx, src/pages/Login.tsx, src/brand.css, public/brand/, migrations/006_xiaoyu_brand.sql.
- [x] 导出透明矢量，保留原图人物，更新站名和品牌组件。
- [x] 调整首页和详情 DOM 网格，导航路径+类型精确激活。
- [x] 浏览器核对对齐、响应式和品牌可见性。

### Task 2: Avatar lifecycle
Files: migrations/005_user_avatars.sql, server/avatars.ts, server/app.ts, server/core.ts, server/discovery.ts, server/content.ts, server/forum.ts, server/social.ts, src/AvatarSettings.tsx, src/AvatarReview.tsx, src/components.tsx, src/pages/Profile.tsx, src/pages/Admin.tsx.
- [x] 实现私有上传/读取/移除、待审图和版本绑定人工复核 API。
- [x] 头像版本加入会话、作者、卡片和评论响应；接通全部 Avatar 使用处。
- [x] 实现选择、预览、取消、保存和管理员复核 UI。
- [x] 集成测试验证权限、安全检查、审核与替换边界。

### Task 3: Validation and delivery
Files: tests/avatars.test.ts, tests/e2e/branding-profile.spec.ts, docs/VERIFICATION.md, README.md, outputs/.
- [x] 构建、头像集成与完整浏览器回归通过。
- [x] 检查登录、首页、详情、资料页的桌面和手机截图。
- [x] 清理测试数据，更新源码与验收包，确认预览可用。
