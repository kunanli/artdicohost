# Apple Wallet 视觉与发行

本次活动使用深海军蓝、钴蓝与铂金的抽象建筑主视觉。姓名、日期、活动与二维码由 Wallet 原生字段显示，不把参加人的资料烘焙进图片，不添加未经确认的 VIP、座位或住宿权益。

## 可维护的原稿

- [生成原稿](assets/wallet-architecture-original.png)：1536 × 1024 PNG，1,686,514 bytes。
- SHA-256：`1a2c2f4090716274ef3f93e2ae8eb7bce88c8032dab9b5dba4f699421d8a598e`。
- 原稿由本次设计任务生成，没有个人资料、Apple 标志或二维码；保留原稿，后续 UI 设计可重新排版。
- 发行用 PNG 以 Sharp 技术重采样、索引调色板和压缩打包：海报 750 × 1000、背景 360 × 440、图标 29 / 58。高分辨率海报、背景在标准与 @2x 文件名共用相同字节，避免重复嵌入源码；Apple 客户端负责适配显示尺寸。

## 实际 pass 文件

图片嵌入既有 `functions/apple-wallet/pkpass.mjs`，无外部图片请求、新依赖、公开凭证或新增 FC 文件。`artwork.png` / `artwork@2x.png` 供支持 posterEventTicket 的系统使用，`background.png` / `background@2x.png` 与原有 eventTicket 字段提供兼容样式。包含可信事件语义，但不虚构座位。所有图片的 SHA-1 都包含在 manifest，并由同一证书身份生成 detached CMS 签章。

每个文件仍限 256 KiB，整张 pass 限 1 MiB、顶层 ZIP 条目限 12 个；不开放任意文件名、SVG、远程图或路径。证书、私钥、签章 bundle 与 FC 环境变量沿用既有私有配置。原稿仅存文档，不进入静态站 dist 或 FC 发布包。

## 验证边界

离线合成证书可验证图片完整性、manifest 哈希、OpenSSL CMS 签章、受控 ZIP、二维码目的地址，以及待审／候补／撤回不能领取 pass。浏览器下载成功只证明文件传输；真实 Apple Wallet 的新版海报、旧版兼容显示与扫码须由 iPhone 验收，不能把设计预览或 readiness 当成已通过实机。

后续替换图稿时，重新生成发行 PNG 并更新嵌入字节，保留原稿及哈希，跑 Apple Wallet 与发布包检查。不改报名 ID、二维码签名、名额授权或既有通知身份。已加入的卡片目前没有推送更新服务，替换画面后需重新下载加入。

通知、私人确认页、备份和回退沿用 [人员工作区](unified-people-workspace.md)、[Apple Wallet 设置](apple-wallet-setup.md) 与 [维护流程](maintenance-backup.md)。
