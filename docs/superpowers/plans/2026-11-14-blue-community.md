# Blue Community Implementation Plan

**Goal:** 将首页改成图片轮播，并按用户指定参考页统一社区视觉和按钮。
**Architecture:** 沿用现有 React/Fastify、轮播配置与资源权限；独立图片轮播组件和最终加载的共享 CSS 主题。三张本地品牌图片由内置 image_gen 生成，不新增外部 API。
**Tech Stack:** React/TypeScript、CSS、Playwright、现有后台轮播 API。
**Spec:** docs/plans/2026-11-14-blue-community-design.md

## Global Constraints
- 保留“小鱼号AI共创社区”、原 LOGO 和小鱼角色特征。
- 避免不必要的辅助标签与说明；保留已确认的两栏和详情对齐。
- 业务权限、富文本、头像、审核规则不因外观变化改变。
- 本地实施，无 Git/部署/子代理；用户已授权执行。

## Review Focus
- 切换或配置更新不出现空图片、越界索引或无效链接。
- 悬停、键盘、手动暂停和减少动态偏好不互相覆盖。
- 手机图片、标题、按钮不重叠，无横向溢出。
- 旧硬编码绿色/橙色选中和悬停规则不盖过新主题。
- 后台自定义图片和受限资源仍走鉴权接口。

### Task 1: Image carousel
Files: public/brand/banners/, src/ImageCarousel.tsx, src/pages/Home.tsx, server/seed.ts.
- [x] 将三张生成图片及提示词保存至项目。
- [x] 实现完整图片轮播、默认图与原配置链接、暂停/手动/触摸/键盘、图片错误回退。
- [x] 补充第三张项目示例轮播；验证自定义封面和空配置。

### Task 2: Shared visual system
Files: src/community-theme.css, src/main.tsx, src/pages/Forum.tsx, src/pages/Home.tsx.
- [x] 按参考页落地蓝色渐变、白卡、胶囊按钮、选中/悬停/键盘焦点状态。
- [x] 调整论坛主视觉、列表、分栏和相关页面，移除重复装饰文案。
- [x] 真实检查首页、论坛、详情、发布、资料、登录与手机布局。

### Task 3: Regression and delivery
Files: tests/e2e/carousel-theme.spec.ts, tests/e2e/branding-profile.spec.ts, docs/VERIFICATION.md, README.md, outputs/.
- [x] 验证轮播切换/暂停/减少动态/错误回退/配置和手机。
- [x] 构建并运行完整浏览器回归；有行为影响时跑相关服务端检查。
- [x] 清理自产测试数据、更新截图文档和源码包、确认预览健康。
