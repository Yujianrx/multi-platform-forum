# 论坛默认素材

- `forum-logo.svg`：透明对话气泡与 FORUM 标识。
- `forum-illustration.svg`：登录页的抽象交流插画。
- `forum-banners/`：3:1 经验交流、项目协作与资源分享横幅；左侧预留实时文字，右侧为主题插画。
- `ui-red/`：通用操作、编辑与管理图标和按钮底图。
- `badges/`：贡献勋章图片，业务条件见 `docs/HONORS.md`。
- `optimized/`：自动生成的轻量素材与体积清单，文件名包含内容哈希。

运行 `npm run assets:optimize` 更新网页映射、样式以及 `wechat/miniprogram/assets/` 中的 LOGO 和轮播；`npm run build` 自动执行相同步骤。修改源图后应同时提交生成结果，不手工改哈希映射。

默认素材无企业名称与人物。管理员上传的站点 LOGO 与轮播优先显示，保存在鉴权存储中，不随源码分发。
