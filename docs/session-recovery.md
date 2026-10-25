# 新 session 接续入口

本页在 2026-10-25 依据远端 main 与 Actions 实际日志整理。文档分支为 `docs/session-handoff-20261025`，以已发布 main `6984f8226cc7fa040a962500d29b63a5af3dc9eb` 为祖先；只保存交接资料，不为补记录再次部署。后续 main 前进时，先核对新版本及实际运行，不盲用本页 SHA。

## 已验证的线上基准

[PR #44](https://github.com/kunanli/artdicohost/pull/44) 已合并，main **`6984f8226cc7fa040a962500d29b63a5af3dc9eb`**；[正式运行 39701127548](https://github.com/kunanli/artdicohost/actions/runs/39701127548) attempt 1 的三个 job 全部成功，2026-10-22 **08:50:08（UTC+08）**完成。准确证据见[本轮发布记录](admin-save-visibility-release-2026-10-22.md)。

| 实际证据 | 结果 |
| --- | --- |
| check `119570341801` | 1335 项测试通过、0 失败；128 文件内容包核对及离线启动通过 |
| deploy-fc `119571860192` | 真实私有 OSS 隔离验收通过；两独立客户端、一个 FC 进程；内容及正式报名启用；核定政策／共同 300 名额、13 个后台 HTTPS 页面、匿名公开内容／CORS通过 |
| deploy `119572998848` | 46 个公开对象上传及 SHA-256 回读；另经 `https://artdico.host` 核对全部 46 个对象的 HTTPS／内容 |

FC 的 `codeChecksum` 是 CRC64，包／artifact 的 SHA-256 不是远端 FC SHA-256 回读。进程标记、储存验收、启用配置及公开站点回读分别核对，不能只凭绿色总状态或 artifact 存在宣称成功。

公开内容在 **2026-10-22 08:48:50（UTC+08）**的匿名观测为版本 12（原发布时间 `2026-10-21T15:24:23.594Z`），嘉宾 0、组织 2、作品 0、展位 13、场次 43。这是当时的已发布快照，不是现在的私人人员、报名、出席、草稿或已分配位置总数；本次没有重新读取私密后台。

## 当前保存与公开规则

公开页延续用户选择：深灰背景／白字、少量 GGJ 蓝和 ARTDiCO 橙点缀；单一大 Hero、真实活动倒数、收合导航与区块分色。品牌聚焦 Hero，不恢复顶部重复字标；嘉宾、组织、作品钩子及日程按既有版型维护。最初文案／白底设计属于历史，不作为本轮视觉待办。

- 所有可编辑表单使用主要「保存」按钮及就近回执，成功后保留编辑对象；账号密码清空，明确新增才开始下一笔。本机暂存不冒充云端保存，已载入草稿固定浮窗已移除。
- 嘉宾、组织、游戏与作品、展位四类默认绿色「公开」，手动「未公开」才隐藏。照片／封面、出席、确认及安排不再阻挡公开，原有事实及授权记录仍分别保留。
- 绿色开关是设置状态；前台仍需明确「发布到前台」，可在各列表附近操作。发布会更新全部已保存活动内容，部署不替工作人员发布真实草稿。旧发布快照不在读取时重生成。
- 字段错误保留填写；未知回执保留原 `operationId`、正文和 `expectedRevision`，先核对，不换键盲建或重送。保存、发布、名额核准、生成图片、人工发出和邮件接受各是独立动作。

[保存操作](admin-save-workflow.md)、[默认公开](default-public-visibility.md)、[设置回执](settings-save-feedback.md)。PR #42／#43 的[游戏与作品／跟进人说明](publication-games-operations.md)及 PR #41 的[独立页面](admin-independent-pages.md)仍保留，其旧公开阻挡规则以本轮说明为准。

## 新 session 的第一步

文档工作树：`/workspace/artdicohost/.local-data/session-handoff-20261025`。若新环境没有此工作树，先从远端同名文档分支读取本页；不要清空旧工作区或忽略目录来切换版本。

1. 阅读 `AGENTS.md`、`README.md`、本页及[PR #44 证据](admin-save-visibility-release-2026-10-22.md)，按任务再读具体契约；[验收操作](morning-acceptance.md)与[文档历史](development-status.md)分开。
2. 保留文档分支；核对本机分支／`git status`、远端最新 main 与对应 **push** 运行。工作区可能仍保留落后的旧 main、隔离 worktree 和本机数据，不能据旧聊天重放改动。
3. 早期 `feat/cloud-activation`、`feat/cloud-live-acceptance` 以及孤立提交 `9718b069` 属旧进度。账号缺 Variables 已被后续 PR #25 及云端生命周期取代；不要重新推送旧草稿、cherry-pick 已集成 worker 或重建角色／域名／Secret。
4. 后续代码任务从最新基准独立分支逐阶段完成，按授权检查、PR、合并及实际发布，无需逐次申请上线确认。main 已前进时不能重跑过时运行绕过门禁。纯文档证据保存不触发应用重新发布。
5. 本次只做文件与公开发布证据核对；没有代建正式账号、读取真实名单、发邀请、改运行配置或替换群码。

## 微信群码：当前待用户提供

入口：[后台群码设置](https://api.artdico.host/admin/settings/group/)，需要现有管理员权限。初始聊天图片标示有效至 **2026-10-26**，没有具体到期时刻；这只是初始图片历史，不是已核对的当前后台有效期。

请用户在微信取得最新群码，回到本聊天上传图片，并提供**新的有效截止日期**；若已知具体时刻及其时区，一并提供。后续以用户最新图片及日期为准，不反复沿用旧日期、不猜测午夜或 23:59。若只有日期，在实际填写分钟精度的到期字段前核对真实时刻。

后台支援 PNG／JPEG／WebP、最多 512 KiB，服务端当前最多允许未来七天，提供 1／3／7 天快捷值；这是新图片的输入上限，不延长微信原码。按真实期限填写并保存，核对原图摘要／有效期／修订回执后才可记录已替换；只能向合资格的已确认报名收据提供受保护入口，不放公开活动页。

本次只提醒，**未取得新图、未自动延长、未验证可入群、未替换网站**。既有群码提醒保持原状；未来提醒也须以用户最新资料为准。[设置细节](settings-save-feedback.md)。

## 仍需真实条件或工作人员核对

- **账号：**现有管理员先在[用户管理](https://api.artdico.host/admin/settings/accounts/)核对协作账号是否已存在；本开发没有代建 `zhouyufei`、`wangying`。未建立才准备、核对权限、保存并确认回执，私下交付密码，不重复创建。[账号指引](staff-accounts.md)。
- **Wallet：**设置与下载流程已实现；Apple Developer enrollment、真实 Pass Type ID、私钥／完整证书链及 iPhone 验收仍由主办方完成，私钥不经聊天。[设置](apple-wallet-setup.md)。
- **EmailJS：**既有接续记录载明用户已确认正常。保留现有受控设置，不因本次交接重新配置或实寄测试；服务商接受不等于送达，unknown 不盲重送。[邮件设置](delivery-configuration.md)。
- **真实资料：**原问卷历史为 39 行（38 同意联系、1 拒绝）；旧本机恢复／准备记录不能证明现在是否已经导入或邀请。本次未读取私密后台，不迁移本机原件、不重复导入、代登记、安排、确认授权或群发。私密现况由已有权限的工作人员核对。
- **后续提案：**现场二维码签到、支付、邮件营销及自动奖项评定尚未实施，须另定范围；不是当前保存改版的未完成事项。

## 操作入口与不可变边界

| 工作 | 入口／文档 |
| --- | --- |
| 人员、回复、跟进与稳定关联 | `/admin/contacts/`、`/admin/person/#…`；[人员关系](people-relationships.md) |
| 嘉宾、组织、作品、日程、15 个展位及发布 | `/admin/content/{guests,organizations,showcases,sessions,booths,arrangements,publish}/`；[活动工作区](staff-operations-workspace.md) |
| 报名审核与共同名额 | `/admin/registrations/`；[申请审核](public-application-review.md) |
| 志愿者、班次、缺额 | `/admin/volunteers/`；[志愿者操作](volunteer-operations.md) |
| 设置、入群、邀请与账号 | `/admin/settings/{delivery,group,invitations,accounts}/` |
| 邀请图与私人确认页 | [邀请函](invitation-poster-v2.md)、[确认信](registration-confirmation.md) |
| 加密备份、隔离恢复及回退 | [完整备份](maintenance-backup.md)、[部署与回滚](08-deployment.md) |

活动为 2026-12-05，深圳前海5号楼3F，09:30 签到、10:00–18:00 正式活动；报名截止当日 12:00（UTC+08），所有参会与工作人员共用 300 名额。资料保留至 2027-03-05；处理者及隐私联系沿用受控业务设置。

申请待审核不占位、不自动获邀；核准、confirmed／候补、实际出席、公开设置及授权不互相冒充。按稳定 ID 关联人物／组织／作品／场次，不按姓名或邮箱模糊合并，也不把角色／团队人数重复算入名额。

保留兼容的 schemaVersion1／storageVersion1、名额 v2／v3、原 unknown 正文、旧已保存未公开设置及历史日志。代码回退不覆盖新业务数据；没有 Delete 权限不能声称物理擦除。不得读取 Secret、输出密钥、拿真实报名／收件人测试、扩大 IAM、修改其他项目或公开原群码。

## 可复制给新 session

> 接续 kunanli/artdicohost。先读 AGENTS.md、README.md、docs/session-recovery.md 及 docs/admin-save-visibility-release-2026-10-22.md。交接文档在 docs/session-handoff-20261025 分支，基于已发布 main 6984f8226cc7fa040a962500d29b63a5af3dc9eb；先核对最新 main 和实际 Actions。PR #44 已完成部署及验收，不重做旧账号／角色／域名草稿。当前先等我提供最新微信群码图片与新的截止日期；初始 2026-10-26 无具体时刻，不自动延长或假称已替换，不改既有提醒。只用合成资料开发，不重导历史名单、不实寄、不读 Secret；其他待办按本页真实条件处理。
