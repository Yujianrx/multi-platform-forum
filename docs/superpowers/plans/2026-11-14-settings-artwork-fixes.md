# Settings and artwork fixes implementation plan

**Goal:** 修复设置崩溃、后台字号、按钮拉伸，换用从原始人物新生成的清晰轮播。
**Architecture:** 沿用现有组件和权限；修复请求结果生命周期，共享按钮皮肤保持端部比例，CSS 局部调大后台字体并居中轮播内容。
**Tech Stack:** React / TypeScript / CSS / Playwright / image_gen。
**Spec:** docs/plans/2026-11-14-settings-artwork-fixes-design.md

## Constraints and review focus
- 仅用 public/brand/xiaoyu-mascot.png 作为轮播人物参考，不再编辑多轮旧横幅。
- 所有管理标签切换不拿旧响应初始化设置；保存后重新打开显示真实值。
- 按钮 80–400px 宽度端部比例一致，无串格、压扁或圆角拉长。
- 后台各级字体增加 1px；320/390/768/1440px 无横向溢出。
- 轮播桌面文字组垂直居中，手机文字与插画不重叠；所有素材留项目副本与提示词。

## Tasks
- [x] 浏览器复现崩溃，记录错误栈；增加切换管理页面的回归测试并修复根因。
- [x] 修正共享按钮皮肤和图标比例；后台字号增加 1px，并检查桌面与手机。
- [x] 从原始人物生成三张新图，接入版本化路径；居中文字组。
- [x] 构建、相关浏览器及 API 回归，更新截图、报告和源码包，确认预览可用。
