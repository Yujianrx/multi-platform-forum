# Mobile Layout Implementation Plan

**Goal:** 实现已批准的手机视觉，同时保留电脑页面及既有业务流程。

**Architecture:** 原页面保留数据与操作，手机模块提供展示组件；断点使用共享订阅，单一页面树避免重复请求。手机 CSS 在独立文件内限定到 760px 和移动根类。

**Tech Stack:** React 19、TypeScript、React Router 7、现有 Fastify API、Lucide、Playwright。

**Spec:** `docs/plans/2026-11-16-mobile-layout-design.md`

## Global Constraints

- 电脑端保持不变；手机断点 760px。
- 不改数据库、权限、审核和积分规则，不引入依赖，不部署。
- 表单和编辑状态不因屏宽改变而卸载。
- 所有内容和成绩来自现有 API。

## Review Focus

- 草稿编辑时点击导航或发布类型：必须经过既有离开保护。
- 从 390px 变为 900px：正文和保存状态保留。
- 无封面、长中文标题、错误图片：卡片不破图、不横向溢出。
- 待审/退回/空勋章/普通成员：入口与权限保留，不显示示例数据。
- 桌面页面：只有桌面分支挂载，没有手机请求、导航和样式泄漏。

## Task 1: Baseline and shell

Files: `src/mobile/useMobile.ts`, `MobileShell.tsx`, `MobileSheet.tsx`, `mobile.css`, `src/App.tsx`, `src/main.tsx`, `tests/e2e/mobile-layout.spec.ts`.

- [x] 建立原桌面首页/讨论/个人/编辑/消息及 761px 边界截图。
- [x] 新增共享断点订阅、独立导航与可访问底部弹层；路由和退出沿用 App。
- [x] 验证底部导航、搜索、发布入口以及 761px 不挂载手机外壳。

## Task 2: Feed and forum

Files: `src/mobile/MobileHome.tsx`, `MobileContentCard.tsx`, `MobileForum.tsx`, `src/pages/Home.tsx`, `Forum.tsx`, `src/components.tsx`.

Interfaces: MobileContentCard accepts existing `item`; MobileForum consumes existing request state, URLSearchParams and filter/page callbacks. MobileHome uses existing `/home`, `/contents`, `/taxonomy` and HonorLeaderboard.

- [x] 首页手机单一分支，默认最新，真实轮播、双列内容、类型/分类/精选/榜单和分页。
- [x] 讨论仅增加展示分支，保留原查询与全部筛选能力。
- [x] 浏览器验证分类、空状态、失败封面、长文本与讨论筛选。

## Task 3: Profile and shared workflows

Files: `src/mobile/MobileProfile.tsx`, `src/pages/Profile.tsx`, `src/Honors.tsx`, `src/pages/Editor.tsx`, `src/mobile/mobile.css`.

Interfaces: MobileProfile consumes existing user/tab, uses existing honors and author data; PersonalHonors accepts optional initial tab; Editor type selection reuses existing create handler.

- [x] 紧凑资料、真实积分进度与勋章，主标签和更多入口齐全。
- [x] 发布类型选择进入原编辑流程；复用通知列表，手机样式适配详情/编辑/设置。
- [x] 验证草稿保存删除、待审和退回入口、权限入口、离开保护与旋转屏幕不丢输入。

## Task 4: Regression and maintenance

Files: `docs/MOBILE.md`, `docs/VERIFICATION.md`, `tests/e2e/mobile-layout.spec.ts`.

- [x] `npm run check`、`npm run build` 与既有相关浏览器回归通过。
- [x] 对比桌面基线截图及 320/390/760/761 响应式截图，检查请求与溢出。
- [x] 记录维护边界、修改点、验证结果与本地预览方式。
