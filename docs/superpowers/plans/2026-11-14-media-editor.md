# Media Editor Implementation Plan

**Goal:** 评论与发布统一支持附图、表情包、附件和工具栏。
**Architecture:** 复用 Markdown、私有存储、审核任务；新增评论素材用途和绑定表，共用前端编辑器。
**Tech Stack:** React / TypeScript / Fastify / PostgreSQL-PGlite / sharp / react-markdown。
**Spec:** docs/plans/2026-11-14-media-editor-design.md

## Global Constraints
- 沿用角色、部门、原资源关联权限与审核边界。
- 新旧文本和修订兼容，评论素材不赋予内容编辑权限。
- 使用已有依赖，自有 SVG 表情素材；本地模拟与真实审核区别保持明确。

## Review Focus
- 其他用户、其他帖子或已提交的附件被伪造引用：拒绝。
- 待审/退回/删除评论的图片链接被直接打开：仅作者或授权审核者可见，删除后不可见。
- 上传超限、类型伪装、动画超帧、未知附件：拒绝或隔离，不静默公开。
- 编辑中粘贴/拖放、多次上传、提交失败：内容不丢失，不重复发送。
- 仅图片/附件评论、手机窄屏、原有资源上传：可以正常完成。

### 1. 评论素材与存储
- [x] 新增 migrations/004_comment_media.sql，attachments.purpose 与 comment_attachments。
- [x] server/storage.ts 增加评论上传和下载分支、动画与文档检测；server/content.ts 阻止跨用途引用。
- [x] server/social.ts 绑定并返回素材；server/moderation.ts 覆盖评论图片与附件。
- [x] tests/media.test.ts 验证上述权限、审核、删除与解析边界。

### 2. 共用编辑器
- [x] src/MediaComposer.tsx / src/media-editor.css：工具栏、格式插入、Emoji/表情包、上传、粘贴、拖放、预览、附件列表。
- [x] public/stickers 自有 SVG 及 src/stickers.ts；MarkdownBody 仅允许可信素材路径。
- [x] Detail、Forum 回复与发布、Editor 正文接入同一组件，附件单独展示。

### 3. 验收交付
- [x] 浏览器实际提交带图片/表情/附件的评论、资源与论坛帖，核验刷新后的图片和下载。
- [x] 原有测试回归、构建、桌面与手机截图；重启本地预览并验证健康。
- [x] 更新 README、验收记录与源码交付包。
