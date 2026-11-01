# 公开视觉素材

`student-showcase-concept.png` 为本项目于 2026-10-20 生成的原创抽象创作概念视觉，用于学生嘉年华展示区。它不是已确认学生的作品、游戏截图、影片封面或嘉宾照片；页面说明“创作概念视觉 · 学生作品陆续公布”。不含外部活动、组织标志或真实个人资料。

由 Astro Image 在构建时转为 WebP，仅发布页面引用的生成资源；原始 PNG 不直接放入公开桶。没有外部影像、字体或嵌入播放器请求。替换为真实作品前须核对作品展示授权与准确署名。

## 2026-11-01 首页设计衍生素材

`home/planet-purple.webp` 与 `home/host-wordmark.webp` 分别缩放／压缩自主办方提供的 `FrontEnd_Resource/组件/紫色星球组件.png`、`HOST文字组件.png`，保留透明背景。橙色星球由同一无文字纹理以 CSS 色相变化呈现；球内标题、说明及活动信息均为 HTML，不使用烘焙文字的星球或整页长图代替正文。

`home/event-share.png` 是 1200 × 630 的独立分享图，使用同一星球与已核实的日期、时间及场地信息，不包含未核实数量、真实人物、作品或参与组织标志。它经首页本地 `_astro` 引用进入发布清单；完整绝对网址用于社交 metadata。

`fonts/home-regular.woff2`／`home-bold.woff2` 从提供的 Noto Sans SC Regular／Bold 提取首页用字，重命名为 **ARTDiCO Home SC**，各自保留原版权及完整 SIL Open Font License 1.1。完整许可同时嵌入公开页底「字体许可」。新增姓名或其他文字未涵盖的字形由系统中文字体回退，不阻挡阅读。MiSans 目录只有附属文件，未作为字型引用。

这些字型及图片只由首页专用组件／样式引入，共用 Layout 没有新增素材 import，不进入 FC 后台资源依赖。来源与衍生 SHA-256／大小记录于 `docs/home-asset-manifest.json`；开发环境可使用系统 Pillow、fontTools 与 Brotli 运行 `/usr/bin/python3 scripts/prepare-home-assets.py` 重新生成。站点构建仅消费已提交的衍生文件，无新增运行依赖，不复制原 10 MB TTF 或未确认的头像／作品／Logo。
