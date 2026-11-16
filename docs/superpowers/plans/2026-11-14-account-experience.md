# Account Experience Implementation Plan

**Goal:** 头像可裁剪，新密码 6–20 位，登录图片验证码只保存摘要，部门采用附图 13 项。
**Architecture:** React 裁剪交互提交原图与归一化坐标，Sharp 服务端裁切；独立验证码模块由认证路由调用；SQL 部门迁移保留 ID 与引用。
**Tech Stack:** React / TypeScript / Fastify / Sharp / PostgreSQL / Vitest / Playwright。
**Spec:** docs/plans/2026-11-14-account-experience-design.md

## Constraints and review focus
- 不改现有密码和部门关系，不回退头像免审核，不记录验证码或密码明文。
- 原始头像校验后裁切，坐标越界、非正方形、动画、大图拒绝。
- 验证码一次性消费必须原子；错误、超时和刷新后不能复用；无有效码不能验证密码。
- 历史超过 20 位密码仍可登录和修改；新密码前后端一致。
- 手机裁剪可操作且无溢出，预览与实际保存一致。

## Tasks
- [x] 新建 server/captcha.ts 与 migrations/008_login_captcha.sql，接入 auth.ts 和登录表单；测试摘要、绑定、过期、一次性与限流。
- [x] 调整 account-policy.ts、密码文案与测试边界，保留登录历史密码兼容。
- [x] 新建 src/AvatarCropper.tsx 与裁剪样式，AvatarSettings 提交坐标，avatars.ts 验证并裁切；测试横图、竖图、缩放拖动和真实输出。
- [x] 新建 migrations/009_company_departments.sql，按附图初始化及排序，seed 和 taxonomy 使用新部门；验证原 ID 和关系不变。
- [x] 独立浏览器测试环境、构建、完整回归、随机验证码实际预览检查、文档与源码包。

由当前会话直接实施并自查；无 Git 仓库，不使用子代理。依次运行定向测试、npm run build、npm test、npm run test:e2e。
