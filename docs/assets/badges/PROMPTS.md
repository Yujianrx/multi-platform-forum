# 社区荣誉勋章素材

2026-11-16 使用内置 `image_gen` 生成六枚独立透明 PNG，不调用第三方图片接口。原始输出原样保留在本目录；Sharp 仅用于等比缩放并编码为 256px WebP，不重绘画面。运行时素材位于 `public/brand/badges/`。

统一提示词（`${subject}` 按下表替换）：

```text
Use case: stylized-concept. Asset type: one premium community achievement badge for Xiaoyu AI co-creation community. Subject: ${subject}. Single centered emblem, circular ruby-red enamel medallion with champagne-gold beveled rim, tiny ivory accents, polished but restrained 3D product render. Warm soft studio highlights, legible silhouette at 48px, consistent front-facing slight dimensional relief. Square canvas, emblem fits within central 78%, generous transparent margin. Truly transparent background. No text, no letters, no numbers, no other objects or backdrop, no watermark. Red #D8292F, warm ivory #FFF9EE and gold palette.
```

生成参数均为 `transparent_background: true`。

| 文件名 | subject |
| --- | --- |
| first-case.png | an open ivory case-study book with a single golden spark above it |
| first-resource.png | a small ivory open resource toolbox with one golden wrench |
| first-answer.png | an ivory speech bubble bearing a large ruby-red checkmark |
| all-round.png | three interlocking golden stars arranged as one triangular emblem |
| consistent.png | four connected golden rings arranged in a compact diamond, exactly four rings |
| quality.png | a golden laurel wreath surrounding a simple stylized friendly little fish emblem, ivory fish and ruby red accent |

界面上的勋章名称与条件使用真实文字，未嵌入图像。未获得状态通过 CSS 灰度与透明度呈现，不生成虚构获得记录。
