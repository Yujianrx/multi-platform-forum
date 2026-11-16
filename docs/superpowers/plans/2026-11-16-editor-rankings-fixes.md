# Editor and Rankings Fixes Implementation Plan

**Goal:** 补齐可发现的草稿删除、首页人气榜和编辑页操作保护。
**Architecture:** 复用原删除和排名接口，抽出草稿按钮、首页榜单和路由离开保护；原发布审核逻辑保持。
**Tech Stack:** React、TypeScript、React Router、Fastify、Playwright。
**Spec:** docs/plans/2026-11-16-editor-rankings-fixes-design.md

## Global Constraints

- 不新增迁移、依赖或演示数据，不调整审核和积分。
- 用户已明确要求修复，本对话直接实施，无需重新确认已有范围。
- 无 Git 仓库；保留 v6 源码包和变更清单作为基线。

## Review Focus

- 我的发布和后台的未命名草稿也可删除；待审和已发布正文不能误删。
- 公开正文有新草稿时，删除保留原文。
- 操作栏在手机和长页面中可见且不遮挡导航。
- 自动保存并发、保存失败和上传中不能误跳转。
- 取消浏览器返回后可以继续编辑，成功发布不再拦截。

## Tasks

- [x] 1. 新增 DraftActions.tsx；用于 Profile、Detail、Admin；浏览器测试覆盖成员及管理员、公开正文保护。
- [x] 2. 新增 HomeRankings.tsx 并接入 Home；移除贡献榜底部裸链接；验证真实数据顺序、周期切换与空状态。
- [x] 3. 新增 EditingGuard.tsx、切换 RouterProvider；Editor 操作栏吸附、发布按钮直接提交；测试离开确认、保存失败、上传及浏览器返回。
- [x] 4. 构建、类型检查、相关接口测试和完整浏览器回归；检查桌面/手机截图。
- [x] 5. 更新维护及验证说明，制作源码包与上线交接，沿原备份验证流程同步部署。


实际上线版本 20261116-v7；回执见 docs/DEPLOYMENT-RECEIPT-20261116-V7.md。源码包保持上线校验时的 SHA256，不因补记回执重打包。
