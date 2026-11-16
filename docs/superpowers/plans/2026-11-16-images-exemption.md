# Image Loading and Account Exemption Implementation Plan

**Goal:** 减少图片传输和重复下载，管理员可按账号启用免审发布。
**Architecture:** 生成品牌素材清单并替换运行时引用，静态缓存与鉴权缓存分离；统一 enqueue 入口按当前账号权限即时应用发布结果，复用修订/通知机制。
**Tech Stack:** React / TypeScript / Sharp / Fastify / SQL / Vitest / Playwright。
**Spec:** docs/plans/2026-11-16-images-exemption-design.md

## Constraints
- 不覆盖用户原始素材，不改视觉风格，不放宽私有文件鉴权或隔离。
- 默认所有账号需审核；仅管理员能变更，成员字段注入无效。
- 接口与网页投稿一致；待审历史不自动放行；实际结果决定前端状态。

## Tasks
- [x] 添加素材优化脚本、哈希清单、精简按钮图及响应式轮播，配置缓存与异步解码。
- [x] 鉴权图片提供私有 ETag 条件响应，验证权限变化后不能读取缓存。
- [x] 新增账号免审字段与管理员开关，统一提交入口同步发布及记录。
- [x] 更新发布/回复文案与跳转，补充权限、关闭开关、附件与接口回归。
- [x] 构建、全量测试、预览验证、体积对比，备份重启并更新说明和源码包。

当前会话直接实施，不使用子代理。无 Git 仓库。原始图片只做网页编码衍生，不重新生图。
