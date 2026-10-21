# 公开状态、游戏／作品与跟进人标签：最终发布证据

[PR #42](https://github.com/kunanli/artdicohost/pull/42)／[PR #43](https://github.com/kunanli/artdicohost/pull/43) 已实际发布，main **`d9d0dd2cc52eac755aef8deda5de9c91024b741d`**，2026-10-22 **01:05:35（UTC+08）**完成。[正式运行 39639330823](https://github.com/kunanli/artdicohost/actions/runs/39639330823) attempt 1 的 check／deploy-fc／deploy 全成功。 本文件替代开发中检查点的待发布状态；旧检查点可从Git历史追溯。[操作](publication-games-operations.md)、[新session入口](session-recovery.md)。所有写入与业务端到端验证均合成隔离；正式HTTPS及匿名CORS只读实际发布内容，没有真实名单、报名、授权或发信写入。

## 最终行为

- 以同次已保存draft与实际published公开投影、稳定ID核对状态：绿色已公开，红色未公开，未知中性；待更新／待撤下保留前台旧版事实。独立发布页集中差异与原因，只有精确ACK的云端base可明确发布；保存、出席确认或路由不会自动公开。
- 嘉宾停止公开仅撤consent，不重置确认；照片及公开职责选填，空照片显示姓名首字且不请求空图片地址，姓名／机构、确认与授权校验仍在。
- 学生／独立／团队统一「游戏与作品」，稳定ID关联创作者组织与展位，同展位可多作品；创作者组织与展位占用组织独立。旧缺kind仅显示学生，新记录默认indie；两store兼容漏字段、明确解除、旧孤儿关系、原unknown正文及完整加密备份，不提高schemaVersion／storageVersion，不改共同300。
- 前台focus／visibility／pageshow有界重读；去重、取消reader与晚到response、较旧版本及同revision内容冲突保护。读失败保留最后已核对版本并提示，200明确空集合可撤下。
- 人员列表与个人页按真实回复显示出席红绿；未知不进入未公开筛选。跟进人固定彩色姓名标签、未指派灰色，原姓名与筛选值不变，颜色不代表权限；实际小字对比达AA。
- 部署激活后固定匿名公开data／CORS验证，无cookie／认证／跳转，日志仅版本／时间／数量，不输出姓名或正文。404只称未有发布，不假称同步。

## 来源分别绑定

| 来源 | 准确标识 |
| --- | --- |
| 前阶段正式main | `d504ecc83d4c5bd90e7d4142c5ab7879d07b1b77`，PR41已部署 |
| 产品UI冻结 | `9bdad4597b6f632dab02940fed69dedcbac59e51`；之后为测试／文档、匿名验证及workflow修正，UI不再改 |
| 最终PR43 head | `a5c7125bb2914300ae7d10cf3367909e1e44987a` |
| Git完整树 | `bfee4bbcbf023f411e3ee9092cbf2ed6a28fd76d`；最终head与合并main一致，原产品阶段f81c964／46af17e同树3b157ac |
| 原产品PR42检查（历史） | [39633825508](https://github.com/kunanli/artdicohost/actions/runs/39633825508)，attempt1；check119338842021，16:20:13–16:23:26 UTC；运行16:23:28成功 |
| 原产品PR42合并测试来源（历史） | `baa7d97fa2bcde131fc3c966276b6b0eee575960`，不是本机head包或实际main |
| 最终PR43检查 | [run 39638495519](https://github.com/kunanli/artdicohost/actions/runs/39638495519)，check119355514144，2026-10-21 16:51:16–16:55:24 UTC成功，运行16:55:25完成；1304项／545源码／Astro406／23页／审计、两ZIP及实际只读公开版本12／CORS通过 |
| 最终PR43合并测试来源 | `bfd7fb56d650a467fb11d5aaaf33271eec6e4b56`，与本机head／实际main分别绑定 |
| 实际合并main | `d9d0dd2cc52eac755aef8deda5de9c91024b741d`，父提交0164330及a5c7125 |
| 实际main运行 | [39639330823](https://github.com/kunanli/artdicohost/actions/runs/39639330823)，attempt1；创建2026-10-21 16:56:48 UTC，最终2026-10-21 17:05:35 UTC成功 |
| 最终文档 | `docs/games-final-release-proof-2026-10-21`，从同一实际main保存证据；不为文档另行部署 |

Git原生push认证失效后，以已连接GitHub的Git Data接口上传相同blob／tree，验证parent／ref后公开fetch核对；未读取凭证、未force push。f81c964与46af17e只有提交元数据不同，不重新cherry-pick旧分支。

## 本机产品冻结验证与原生验收（随后另增诊断回归）

源码545通过；Astro406为0错误／0警告／1项既有hint；**1298/1298**测试、82.946300422秒，23页建置与依赖审计零已知漏洞。冻结dist为2026-10-21 15:52:05.958540559 UTC；公开HTML SHA256 `78e5de9ba8ba2440ee8ecc45d7a527cf603da8e7c3b16c058b2f23189bd147bc`。

同一实际建置与隔离FC runtime、两个origin及native IndexedDB：**新增30／后台核心39／组织4／人员关系23／图片12全部通过，零pageErrors**。覆盖保存→匿名不变→明确发布→返回前台显示、三分类与多作品／组织链接、旧raw／unknown精确重试、proof区退出、空照片、出席／公开红绿及owner颜色一致；320／390／1440实际滚动完成后hit-test、原生编辑按钮点击及截图通过。root目视手机头像首字、作品卡及桌面负责人标签。各组不同范围，不冒称全部是独立断言。

本机证据位于忽略目录 `/workspace/games-browser/.local-data/browser-evidence/games-publication/`：results、a-pages、a-organizations、a-relationships、a-image-editor及provenance JSON和截图；不上传合成业务正文作正式数据。旧浏览器脚本更新已退休文案、真实anchor／URL对象及actualpublished语义，并加强旧快照不变／隐私断言，没有放宽写入防护。

## 原产品46af17e准确head包：历史证明，非最终诊断修正包

46af17e从空目录按已提交来源构建并完整verify，2026-10-21 **16:19:11.987 UTC**完成；目录 `.local-data/games-exact-46af17e4e957fffa409053c3af8d2d46adf75e28/publication`。

| 项目 | 实际／上限 |
| --- | --- |
| 包条目 | 128文件／86源码／40静态资产 |
| 静态合计 | 7,366,917／8,388,608 B |
| 最大资产 | 1,661,625／2,097,152 B |
| deflate文字合计 | 1,877,689／4,194,304 B；121 deflated／7 stored |
| Runtime XZ | 28,636,324 B，原BCJ6及官方Node pin不变 |
| ZIP | 35,652,580／35,999,982 B，余347,402 B |
| Code JSON | 47,536,799／48,000,000 B，余463,201 B |

ZIP SHA256 **`70ed0f1ef195460d93eb039d3fca0f976da94102a81bcdf44701f66ef8dcda5f`**。Node24.19.0，官方二进制SHA256 `bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12`。实际ZIP在networknone／只读／nonroot1000／pids64／512MiB／0.35CPU／tmpfs192MiB／capdropALL／no-new-privileges Docker **17.006秒**启动通过，40资产与13路由、bootstrap／closed／synthetic配置均核对。此本机包不冒充main实际部署artifact；旧f81c964包只留历史。

## 最终a5c7125准确head包

最终head a5c7125bb2914300ae7d10cf3367909e1e44987a，2026-10-21 16:53:57.320 UTC完成，目录 `.local-data/games-exact-a5c7125bb2914300ae7d10cf3367909e1e44987a/publication`。128文件／86源码／40资产，静态7,366,917／8,388,608 B、最大1,661,625／2,097,152 B、文字deflate1,877,689／4,194,304 B（121 deflated／7 stored），runtimeXZ28,636,324 B。ZIP **35,652,584／35,999,982 B**（余347,398），CodeJSON **47,536,803／48,000,000 B**（余463,197）；SHA256 **`6dc970f364437b1598e6982f4d490d9c2c3eb82986d944ef62367962f1fdb0f0`**。隔离已提交源码构建、完整verify、同一官方Node pin及原受限实际ZIP Docker **14.611秒**启动均通过，40资产／13路由、bootstrap／closed／synthetic核对，容器退出并移除。没有放宽任何预算或使用真实配置。

这是最终PR43准确来源的本机包；与原46af17e包、CI合成合并包及实际main包分别绑定，不借用SHA。产品界面仍为9bdad45冻结来源，新增诊断／CORS验证修正不改UI。

## 已解决的正式验收失败

原PR42合并0164330的run39634798298通过1298项、真实OSS／300、激活及13后台HTTPS，但新增匿名验证失败，公开OSS跳过。PR43早期诊断3090dca／run39637287514的1303项通过，实际观察是固定码CREDENTIALS／HTTP200；验证器错误地把响应ACAC存在当作请求带凭证。固定请求原本credentials:omit；现在按Fetch匿名模式忽略这项响应授权旗标，仍禁止Cookie／Authorization请求、Set-Cookie回应、跳转及非法投影，11项回归通过。以下是修复后全成功的实际结果，不把前次失败写成成功或隐去。

## 实际main检查、激活与HTTPS

| Job | 准确结果 |
| --- | --- |
| check `119358417584` | 2026-10-21 16:56:50–17:01:05 UTC成功；1304/1304、零失败／跳过；545源码、Astro406（0错误／0警告／1既有hint）、23页及审计零已知漏洞。准确main的6文件29,507,159 B启动包6.499秒与128文件／40资产／13路由内容包15.096秒受限离线启动、完整verify通过；46份公开文件准备完成。 |
| deploy-fc `119360636421` | 2026-10-21 17:01:08–17:04:07 UTC成功；quiesced17:01:30.580→acceptance-armed17:03:39.553→activated17:03:58.144。真实私有OSS十阶段／两独立客户端／一个FC通过；内容与报名启用，共同300政策及报名别名17:03:59.613核对；13个后台HTTPS路径17:04:03.280通过；新严格匿名公开data／CORS于17:04:04.190验证。 |
| deploy `119362247573` | 2026-10-21 17:04:09–17:05:31 UTC成功；46个对象实际上传及OSS SHA256回读17:04:23.824–17:05:17.263；46个正式HTTPS对象的大小／MIME／SHA256／可呈现HTML核对17:05:18.689–17:05:29.431通过，来源均为同一d9d0dd2。全运行17:05:35 UTC成功（2026-10-22 01:05:35 UTC+08），远端main仍同一SHA。 |

新增公开验证的安全报告：`{"verified":true,"cors":true,"publication":"published","revision":12,"publishedAt":"2026-10-21T15:24:23.594Z","counts":{"guests":0,"organizations":2,"showcases":0,"booths":13,"sessions":43}}`。

实际已发布版本12，发布时间2026-10-21T15:24:23.594Z；公开快照为嘉宾0、组织2、作品0、展位13、场次43。数量只计已发布快照，不是私人人员／报名／出席／草稿总数。验证只匿名读取已发布快照，不读私有草稿，不自动发布。旧`probe-content-endpoint`的admin页观察不是公开内容／CORS证据；本次以激活后的新固定公开data验证为准。真实十阶段保持原1000次／90秒边界，不用本机计数冒充云端实际请求数。main保持同一SHA直到三个job成功，未用补文档重跑或启停业务。

## 保留与后续

无新依赖、IAM、DNS、服务、凭证或资源预算放宽；128／40、2MiB／8MiB、ZIP／CodeJSON及XZ边界保持。EmailJS现有配置不重置，人工审核、名额、历史、未知回执、旧海报与字体不删改。没有代建zhouyufei／wangying，现有管理员先核对再创建；Wallet真实证书与iPhone仍待主办方。真实授权／照片／群码／安排由工作人员维护。回退先备份，使用理解新增可选字段的兼容写入版本，不用旧完整快照覆盖新业务。[恢复入口](session-recovery.md)。
