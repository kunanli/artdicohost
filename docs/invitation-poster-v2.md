# 新版邀请函、上传字体与个人下载

## 来源与顺序

从已真实上线 PR #38／main `19fe621` 及发布证据 `ef5a26e` 接续。用户提供两张 1080×1920 海报（第一张姓名仅示例，第二张为空名版）及 Noto Sans SC Regular／Medium TTF。本阶段实现新版视觉、完整姓名与核准参会者私人 PNG；Wallet 签章仍等待主办方真实证书。

## 契约

- 新手动邀请明确使用 `renderVersion:'ggj2026-poster-v2'`；旧五字段设置不补版本、不改变原 JSON／hash。旧 PNG 模板保留，未知版本拒绝；新背景只含固定视觉，日期／时段／地点／姓名由实际保存事实绘制。
- 海报固定文案为用户版本：GGJ中国组织者交流会 × ARTDiCO 嘉年华、INVITATION、诚邀、相聚一起，创意不息。示例姓名不进入真实记录。
- 共用 `buildPosterInvitationSettings(name,event)` 在既有 shared/organizer-progress.mjs：实际 ISO 日期，活动 time.label 或 opening–end；精确既有前海完整地址才映射用户核定「深圳前海5号楼3F」，自订资料保真。旧邮件／Wallet 事实不为换图暗改。
- 完整姓名最多 120 个合法字符，按字素排版、不截断；地点兼容原 300 字上限。字体明确载入成功才量字绘图，失败无假成功。字体分包保留用户 Medium 全 cmap；Regular 仅日期与固定标记，保留 OFL／原版权并改派生字体名称。
- 新 manual ID 纳入内容 digest，同一正文重播同 ID，新版本保留旧记录。Email ID、outbox、request ID 与 unknown 去重不变，不补寄。新图准备不等于实际发出；旧实际联系／未知结果仍在总览，不能因新版本重置为未联系。
- 公开私人确认回读新增严格 invitation descriptor：仅 immutable public 来源且当前 confirmed（含改 crew）为 ready；其他状态／工作人员代录 false。旧 v1/v2 不要求补审。descriptor 带明确 V2 settings，不新增可猜的公开网址、日志或令牌。
- 个人点击前与 PNG 完成后分别重新读取，比较本人身份、事实及资格，不比较别人的全局 revision。hash／pagehide／新读取消旧结果，释放 Blob；通用文件名、手机可见预览与下载，无 staff generated/sent 或发信副作用。

## 分工与发布

Domain／历史：contacts-schema、organizer-progress、intent service/batch 与测试。API：confirmation service 与通知文案。手动 UI：contacts／batch。公开确认 UI：confirmation client/page。Renderer：完整字体载入与完整排版。Root：imagegen 图片编辑、字体生成与许可证、部署静态路径／MIME／资源限额、集成及发布；独立 Chromium 验证真实 PNG／字体／权限／竞争。

保持既有 128 个文件、40 个私有静态资源、单件 2 MiB、合计 8 MiB；只合并纯前端公共 chunk 腾出字体名额，不提高资源上限。生成、预览、下载不发邮件、不写真实名单；测试全部合成隔离。完整检查、源码／Astro／构建／审计、原生浏览器、准确来源候选包与离线启动通过后创建 PR，等待准确 CI 再合并，并核对真实云端及 exact HTTPS。

## 当前状态

已完成计划与接口研究，刚开始实施。不可称新版邀请函、字体或个人 PNG 已上线。实际发布证据须完成后另记，并更新接续台账／验收页。
