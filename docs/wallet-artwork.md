# Apple Wallet 视觉与发行

本场电子纪念卡使用黑底和彩色 HOST 字样。姓名、身份、日期与活动内容由 Wallet 原生字段显示。独立参会凭证使用下文的抽象建筑主视觉与签到码。

## 可维护的原稿

- [生成原稿](assets/wallet-architecture-original.png)：1536 × 1024 PNG，1,686,514 bytes。
- SHA-256：`1a2c2f4090716274ef3f93e2ae8eb7bce88c8032dab9b5dba4f699421d8a598e`。
- 原稿由本次设计任务生成，没有个人资料、Apple 标志或二维码；保留原稿，后续 UI 设计可重新排版。
- 发行用 PNG 以 Sharp 技术重采样、索引调色板和压缩打包：海报 750 × 1000、背景 360 × 440、图标 29 / 58。高分辨率海报、背景在标准与 @2x 文件名共用相同字节，避免重复嵌入源码；Apple 客户端负责适配显示尺寸。

## 实际 pass 文件

图片嵌入既有 `functions/apple-wallet/pkpass.mjs`，无外部图片请求、新依赖、公开凭证或新增 FC 文件。`artwork.png` / `artwork@2x.png` 供支持 posterEventTicket 的系统使用，`background.png` / `background@2x.png` 与原有 eventTicket 字段提供兼容样式。包含可信事件语义，但不虚构座位。所有图片的 SHA-1 都包含在 manifest，并由同一证书身份生成 detached CMS 签章。

iOS 27 起使用 `posterGeneric` 纪念卡。358 × 448 pt 黑底海报上的 HOST 字样等比宽 290 pt，两侧各留 34 pt。在按实机画面估算的 320 pt 居中裁切内，字样占可视宽度约 91%。合成检查另覆盖 300 pt 居中裁切。海报以静态 `artwork@2x.png` 与 `artwork@3x.png` 打包，3x 版本 SHA-256 为 `2369cee87c4979a43b6419fc59252377dcc39a7400f48f217dfbde76572081bf`。图下直接显示实际身份与姓名。已保存的 GGJ 站点和角色／分工各自占一栏。底栏显示日期、时间及地点简称。iOS 决定卡框、留白和栏位位置。

较早的 iOS 使用同一签章文件的 `eventTicket` 版型及 `strip.png` 横幅。横幅按 375 × 98 pt 输出为 1x、2x、3x PNG。姓名与身份使用次栏位，日期、时间和社群资料使用辅助栏位。有社群资料时，地点简称移至卡面顶部。参见 [Apple Poster Generic](https://developer.apple.com/documentation/walletpasses/creating-a-poster-generic-pass)。

Wallet 的「附加资料」显示两句简介、完整地址、A 区上午与下午时段、B 区日程、C 区展位及独立游戏。行程来自主办方提供的三张行程图，作为发行时文字随签章包保存，打开附加资料即可直接查看。较早 iOS 可从票券详情查看同一份行程。票券更多详情可另开地图或活动网站。申请表直接提供选填的所属站点及角色／游戏开发分工，经工作人员保存后用于卡片。经工作人员写入的电话显示在票券详情及 JPEG。

本场联名标题的第一行为 `GGJ China Meetup 2026`，第二行为 `x ARTDiCO HOST`。新版版型使用 126 × 30 pt 的 `primaryLogo`，兼容版使用 160 × 50 pt 的 `logo`。两个版本都使用 Liberation Sans Bold，完整名称在票券详情保留为文字。

纪念卡包内无签到码和活动日到期字段，保留原活动日期供识别。现场签到使用活动行原电子票。已加入旧卡的收件人可从有效的原链接重新下载，沿用相同票券序号。

每个文件限 256 KiB，整张 pass 限 1 MiB，顶层 ZIP 条目限 15 个。只接受已知票券文件名。证书、私钥、签章 bundle 与 FC 环境变量沿用既有私有配置。原稿仅存文档。

## 验证边界

离线合成证书可验证图片完整性、manifest 哈希、OpenSSL CMS 签章、受控 ZIP、二维码目的地址，以及待审／候补／撤回不能领取 pass。浏览器下载成功只证明文件传输；真实 Apple Wallet 的新版海报、旧版兼容显示与扫码须由 iPhone 验收，不能把设计预览或 readiness 当成已通过实机。

后续替换图稿时，重新生成发行 PNG 并更新嵌入字节，保留原稿及哈希，跑 Apple Wallet 与发布包检查。不改报名 ID、二维码签名、名额授权或既有通知身份。已加入的卡片目前没有推送更新服务，替换画面后需重新下载加入。

通知、私人确认页、备份和回退沿用 [人员工作区](unified-people-workspace.md)、[Apple Wallet 设置](apple-wallet-setup.md) 与 [维护流程](maintenance-backup.md)。
