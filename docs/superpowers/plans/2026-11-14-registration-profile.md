# Registration and profile policy implementation plan

**Goal:** 清晰邀请注册、8–128 位简单密码、个人资料即时更新，内容审核仅覆盖发帖与回复。
**Architecture:** 保持 React/Fastify 架构，共用纯数据密码规则，简化头像路由与 UI，SQL 迁移清理旧待审状态。
**Tech Stack:** TypeScript / Zod / React / PostgreSQL / PGlite / Vitest / Playwright。
**Spec:** docs/plans/2026-11-14-registration-profile-design.md

## Constraints and review focus
- 密码 8–128 位，不强制组合，不接受全空白，登录不追溯拦截已有密码。
- 注册字段提示明确但不加重复装饰标签；移动端无溢出。
- 头像、姓名、简介及管理员站点资料不进入内容审核，生产与开发行为一致。
- 旧待审头像可迁移，停用账号与文件安全限制仍生效，正文审核继续执行。
- 不记录密码、不改用户现有密码、不重置数据；无 Git 仓库，不使用子代理。

## Tasks
- [x] 调整前后端密码规则和注册字段说明，补充边界与真实注册/重置/修改测试。
- [x] 删除头像复核流程，头像保存即时生效；清理旧待审状态，资料 Logo 去除人工审核理由。
- [x] 验证内容审核仍只处理正文/帖子/评论；检查桌面和手机注册。
- [x] 构建、重启预览、回归测试，更新资料和源码包。
