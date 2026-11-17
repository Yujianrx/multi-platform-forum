# 手机端维护说明

本轮把用户确认的手机视觉接入现有网站，760px 及以下启用手机布局；761px 及以上保留桌面页面。电脑与手机共用账号、路由、API、内容模型和操作逻辑，没有第二套后端或数据库。

## 代码边界

| 文件 | 职责 |
| --- | --- |
| `src/mobile/useMobile.ts` | 共享屏宽订阅；只监听一个 MediaQueryList；与 CSS 断点保持一致 |
| `src/mobile/MobileShell.tsx` | 手机页头、搜索、底部导航、发布选择、个人菜单 |
| `src/mobile/MobileSheet.tsx` | 原生 dialog 底部面板，焦点和关闭、滚动锁恢复 |
| `src/mobile/MobileHome.tsx` | 最新/精选/榜单及真实内容筛选和分页；原轮播组件继续使用 |
| `src/mobile/MobileContentCard.tsx` | 单个内容的紧凑展示、鉴权封面与失败回退；无投稿逻辑 |
| `src/mobile/MobileForum.tsx` | 单列话题与筛选展示；接收原 Forum 页面查询结果和回调 |
| `src/mobile/MobileProfile.tsx` | 资料摘要、真实等级与勋章、个人标签；不处理账号修改 |
| `src/mobile/presentation.ts` | 摘要文本清理；正文仍用原安全富文本渲染器 |
| `src/mobile/mobile.css` | 手机样式；每条规则受媒体查询与 `.mobile-app` 限制 |

新移动组件使用 `m-` 类，按需加载，桌面首次打开不会请求 `Mobile*.js`。不要在旧的 `styles.css`、品牌 CSS 里继续叠加手机补丁。新手机样式不能使用无范围的 `body`、`button`、`.panel` 等选择器。

本次构建相对 v7 基线，公共 JS 的 gzip 体积约增加 1 KB，公共 CSS 约增加 4 KB；手机页面代码拆为独立加载文件。手机 CSS 保留在公共样式入口，避免首次切换布局时闪烁，桌面因媒体查询和根类限定不会应用这些规则。

接入点仅限 App 外壳、Home 展示分支、Forum 展示分支、Profile 展示分支及共用 ContentCard 的手机分支。不要分别挂载一整套桌面和手机页面再用 `display:none` 隐藏，否则会重复请求和运行效果。屏幕宽度切换不能给 Editor 或 ForumEditor 增加 key 或条件包装，避免卸载正在编辑的表单。

## 继续复用的行为

- 发布选择以 `/editor?type=experience|project|skill|prompt` 进入原 `create()`；讨论进入 `/forum/new`。不在底部导航里创建草稿。避免单次点击重复创建。
- 资源编辑、富文本、上传、自动保存、提交审核和离开确认全部沿用 `Editor.tsx`、`MediaComposer`、`EditingGuard`；不在手机模块复制保存代码。
- 页头在屏宽切换时会替换展示组件，编辑器需重新订阅当前页头的高度；不要删除 `Editor.tsx` 中测量效果对手机断点的依赖，否则切回桌面后悬浮工具栏可能被页头遮挡。
- 草稿删除复用 `DeleteDraftButton`；待审、退回、全部内容、资料密码、AI 接入和管理员入口保留在个人菜单。
- 首页榜单复用 `HonorLeaderboard`；仍可进入内容人气榜查看点赞、浏览和下载排序。
- 个人等级和勋章调用 `/honors/me`，勋章详情复用 `BadgeDetails`；不根据当前列表数量推算荣誉。
- 列表优先真实封面；没有封面或鉴权文件失败时，用真实标题和分类做文字封面。无样例标题、积分或用户写入。
- 通知仍使用现有分页与已读接口。没有新增私信、关注作者、交易、虚构统计等功能。

## 验证和回退

`npm run check`、`npm run build`、`npm run test:e2e -- tests/e2e/mobile-layout.spec.ts`。Windows 可将 `PLAYWRIGHT_EXECUTABLE_PATH` 指向本机 Edge。浏览器测试只使用 `work/` 中的隔离临时库，禁止生产 seed。

本地正常预览按 `README.md` 的快速开始执行 `npm run dev`，或使用已有环境的 `scripts/start-preview.ps1`。当前目录没有复制原环境的数据库和 `.env`，新机器先用 `npm ci` 安装锁定依赖；不能把浏览器测试入口当作正式预览或部署入口。实际手机截图为 `outputs/mobile-home.png`、`mobile-discuss.png`、`mobile-mine.png`，均由隔离测试环境生成。

`scripts/check-mobile-desktop.cjs baseline|candidate` 对同一隔离测试库记录首页、论坛、个人、编辑入口、消息及 761px 边界截图。比较报告保留原始差异像素；浏览器缩放图集的边缘抗锯齿允许最多 0.02%，截图尺寸必须相同。

本轮已作为 v8 上线，实际备份、保留项、桌面对比及正式验收见 `DEPLOYMENT-RECEIPT-20261116-MOBILE.md`。部署侧截图等待为懒加载图片设置了有界等待；生产副本中的头像缩放和单色阶渲染差异必须结合图片摘要及几何布局核验，不能仅扩大差异阈值。

本轮无迁移、无依赖变化。可以通过回退本次前端提交恢复原布局，不需要回滚数据库。后续上线仍须按 `MAINTENANCE.md` 的原备份与验证流程执行；不能将当前开发目录的 `data/`、`work/`、`outputs/`、环境文件或凭据覆盖正式服务器。

## 2026-11-17 交互修复（尚未上线）

- 卡片统一 4:5 封面（包含文字回退）、两行标题/摘要和作者栏。状态标记覆盖在封面上，不增加卡片高度，列表仍按行双列排列。
- `MobileRefresh.tsx` 负责顶部下拉手势和首页双击刷新；只在手机首页挂载。触摸取消、横向滑动、多指及页面非顶部不触发刷新。500ms 连续点击首页触发同一事件，保留频道、类型、分类及页码；正在刷新时不重复请求。
- `useApi.refresh()` 保留已挂载内容，使用请求序号和 URL 检查隔离过期响应。普通 `reload()` 仍保留原重载行为。点赞直接应用服务端返回的计数，评论后台更新对应列表，桌面布局不变。
- 验证包含 `tests/e2e/mobile-interactions.spec.ts`；原 `mobile-layout.spec.ts` 继续覆盖桌面断点和编辑保护。
