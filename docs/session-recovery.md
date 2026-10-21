# 开发接续：先读本页

## 当前实际版本

[PR #42](https://github.com/kunanli/artdicohost/pull/42)／[PR #43](https://github.com/kunanli/artdicohost/pull/43) 已实际发布，main **`d9d0dd2cc52eac755aef8deda5de9c91024b741d`**，2026-10-22 **01:05:35（UTC+08）**完成。[正式运行 39639330823](https://github.com/kunanli/artdicohost/actions/runs/39639330823) attempt 1 的 check／deploy-fc／deploy 全成功。

本轮已完成：真实公开状态及原因、公开／出席红绿标记、前台返回刷新、学生／独立／团队统一「游戏与作品」、作品与组织／展位关联、嘉宾照片选填，以及人员列表／个人工作页的跟进人固定彩色标签。后台独立子页、就近直接保存与本机暂存继续有效。**没有等待开发的跟进人色标任务，也不要重新执行旧计划。** [操作说明](publication-games-operations.md)、[完整发布证据](games-publication-release-2026-10-21.md)。

正式验证：1304 项测试、545源码、Astro406（0错误／0警告）、23页构建及依赖审计通过；实际私有OSS十阶段／两独立客户端／一个FC、共同300政策、13个API后台路径与46个公开对象HTTPS通过。内容和报名启用。新增匿名公开内容／CORS验证的实际结果为：**实际已发布版本12，发布时间2026-10-21T15:24:23.594Z；公开快照为嘉宾0、组织2、作品0、展位13、场次43**；这些数量只计已发布快照，不是私人人员、报名、出席或草稿总数，也不证明所有私有草稿已发布。开发没有替真实对象确认、授权、发布草稿或发信。

## 新 session 从这里开始

1. 阅读本页、[操作说明](publication-games-operations.md)、[发布证据](games-publication-release-2026-10-21.md)，再看 `AGENTS.md` 和任务涉及的契约。当前工作区 `/workspace/artdicohost`。
2. 核对 `git status`、当前分支、远端main及上述Actions。本次最终文档保存在已推送的 **`docs/games-final-release-proof-2026-10-21`**，以实际main `d9d0dd2` 为祖先；只补文档，不为记录证据再次触发正式部署。新任务可以从此证据分支建立独立分支，继续保留最新文档。后续若main已前进，先核对新的发布证据，不盲用本页SHA。
3. 本轮PR head `a5c7125bb2914300ae7d10cf3367909e1e44987a`、完整树 `bfee4bbcbf023f411e3ee9092cbf2ed6a28fd76d`；main合并树相同。原产品阶段本机 `f81c964` 与远端 `46af17e` 的树3b157ac一致，仅提交元数据不同；之后PR43仅修匿名验证及测试／workflow／文档，产品界面不再修改。已集成worker提交及旧feature分支不要再次cherry-pick。历史独立页PR41／main `d504ecc`、邀请函PR39／40等仅供追溯。
4. Git原生push曾因认证失效失败，已使用当前GitHub连接的Git Data接口等价推送，逐项验证blob／tree／parent／ref，并公开fetch核对树一致。不要为恢复而读取凭证或强制推送。当前环境不允许直连正式站域名，实际HTTPS证据来自既有Actions；遵守下一环境的网络策略，不绕过代理或TLS。
5. 新功能逐阶段执行：源码／必要检查／准确来源包／PR检查／main实际部署，完成本阶段才接下一项。没有新增已授权而尚未完成的本轮代码事项；以下是外部条件与真实业务核对。

## 仍需真实条件／工作人员操作

- **账号：**本次没有代建正式 `zhouyufei`、`wangying`。现有管理员先在[用户管理](https://api.artdico.host/admin/settings/accounts/)核对是否已经建立；若未建立，分别「准备」预填、核对权限、按「保存工作人员账号」，看到有效回执后私下交付本页显示的初始密码。快捷预填或合成测试不等于账号已存在；不得重复创建。[账号指引](staff-accounts.md)。
- **Wallet：**Apple Developer enrollment完成后，加入真实Pass Type ID、签章私钥及完整证书链，再做iPhone验收。设置与票券流程已实现，真实签章尚待主办方，不冒称已经可用。[设置步骤](apple-wallet-setup.md)。
- **真实资料：**工作人员核对人物／组织／作品授权、照片、群二维码及有效期、实际场次与展位。先在对应独立页保存，取得云端回执，再到[预览与发布](https://api.artdico.host/admin/content/publish/)明确发布。开发部署不会替真实人授权或发布其草稿。
- **后续提案：**二维码现场签到、支付、邮件营销与自动奖项评定尚未实施，不属于本轮已完成清单；后续开发须另定范围与逐阶段验证。
- **EmailJS：**用户已确认实际发送正常，保留 `LoginPlan`／`template_89mgpj9`／`support@artdico.co` 的受控设置，不为接续重新配置或实寄测试。服务商接受不等于送达，unknown不盲重送。

## 入口与已完成能力

| 工作 | 入口／说明 |
| --- | --- |
| 人员、跟进与关系总览 | `/admin/contacts/`，单人 `/admin/person/#…`；人物、组织成员、场次、展位及志愿分工按稳定ID关联，不按姓名／邮箱猜测合并；[关系操作](people-relationships.md) |
| 回复、公开状态与负责人 | 实际attending绿色、pending红色未确认、declined红色不出席；公开快照存在为绿色，不存在为红色，未知中性；待更新／待撤下保留前台旧版事实；同名跟进人固定色标、未指派灰色 |
| 内容独立页 | `/admin/content/` 下 `overview/`、`event/`、`arrangements/`、`guests/`、`organizations/`、`showcases/`、`sessions/`、`booths/`、`publish/`；各区附近直接保存 |
| 游戏与作品 | `/admin/content/showcases/`；学生／独立／团队，同展位多作品，创作者组织与展位组织分别关联；旧ID、字段缺省、原件及历史保留 |
| 志愿者与分工 | `/admin/volunteers/`；名单、岗位、时段、缺额、冲突与Excel；[操作](volunteer-operations.md) |
| 报名与审核 | `/admin/registrations/`；学生类别、精简单页、主题提案、先人工审核再容量确认／候补；[操作](public-application-review.md) |
| 设置独立页 | `/admin/settings/` 下 `delivery/`、`group/`、`invitations/`、`accounts/`，账号管理仍仅管理员 |
| 保存与恢复 | 本机自动暂存、明确恢复、就近云端保存、离页防呆、未知原请求核对；[操作](usability-autosave-accounts.md) |
| 邀请函与通知 | 新海报、上传字体、完整姓名、PNG／批量ZIP、私人确认页打印及个人PNG；生成／下载／人工发出／通知结果分别记录；[邀请函](invitation-poster-v2.md)、[确认信](registration-confirmation.md) |
| 图片与导出 | 嘉宾／组织裁切、缩放、拖动、取色去背；嘉宾照片可不填；[图片](staff-image-editing.md)、[Excel](excel-export.md) |

## 必须保持的业务与数据边界

活动2026-12-05，10:00–18:00，深圳前海5号楼3F；09:30是签到。报名截止当日12:00（UTC+08），所有参会与工作人员共用300。处理者ARTDiCO HOST活动筹备团队，隐私联系沿用受控业务邮箱，保留至2027-03-05。

公开申请提交先待审核，不占位、不发正式邀请；核准后由原容量CAS确认或候补，旧confirmed不要求补审，代登记不冒充网站隐私同意。出席回复、正式名额、公开资料确认和公开授权分别维护。多重角色、组织成员、作品或填报团队人数不会额外增加名额；旧已答应未关联者先预览再明确同步。

原始问卷39行曾恢复到忽略目录，38行同意联系、1行拒绝、11项选填URL警告；不能据旧恢复记录推断用户之后的操作。真实最新数据以私密后台为准，不重复导入、代登记、安排或群发。停止公开只撤授权并保留确认、关联、资料及历史，保存后还须明确发布才撤下。

旧 `showcases[]`、schemaVersion1／storageVersion1不迁移；own可选kind／organizationId兼容缺省，旧学生分类只用于显示，不重写旧bytes。原unknown正文、expectedRevision／operationId保留，不换键盲建；通知unknown不重送。密码、token、原图不缓存，本机暂存不是云端保存。退出清私密DOM与本账号草稿；退出未知如实提示。

源码／私有业务与IGDA资源完全隔离；不改DNS／IAM、不购买服务、不读secret、不拿真实报名或收件人测试。修复须兼容现有v2／v3与日志，不用旧快照覆盖新报名。代码回退与业务恢复分开，先按[完整备份／恢复](maintenance-backup.md)及[部署／回滚](08-deployment.md)执行受控流程，不以历史代码直接覆写新字段。

旧记录：[前阶段独立页证据](admin-pages-release-2026-10-21.md)、[邀请函证据](invitation-release-2026-10-21.md)、[更早接续历史](session-history-2026-10-21.md)。这些记录不是当前待办。
