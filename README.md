# ARTDiCO HOST · artdico.host

项目：GlobalGameJam 中国交流聚会 × ARTDiCO HOST 学生嘉年华 2026。公开活动页 `artdico.host`、正式报名与独立香港 FC 工作人员后台已启用。资料保存以服务端已确认回执为准；开发和发布的准确来源、实际验收与未配置项目见[接续台账](docs/session-recovery.md)及[验收清单](docs/morning-acceptance.md)。

[PR #44](https://github.com/kunanli/artdicohost/pull/44) 已实际发布，main **`6984f8226cc7fa040a962500d29b63a5af3dc9eb`**，[正式运行 39701127548](https://github.com/kunanli/artdicohost/actions/runs/39701127548) 三个 job 全成功，2026-10-22 **08:50:08（UTC+08）**完成。1335 项检查、真实私有 OSS 隔离验收／共同 300 政策、13 个后台 HTTPS 页面、46 个公开对象 SHA-256 回读／HTTPS 及匿名公开内容／CORS通过。统一保存与就近回执、四类内容默认公开、就近明确发布和移除草稿固定浮窗均已上线；部署不替工作人员发布真实草稿。[准确证据](docs/admin-save-visibility-release-2026-10-22.md)、[新 session 入口](docs/session-recovery.md)。

2026-10-25 文档交接保存在 `docs/session-handoff-20261025`，不为补记录再次部署。群码需用户提供最新图片及新的截止日期；初始日期 `2026-10-26` 无具体时刻，未在本次自动延长、验证入群或替换。

**仍需主办方操作：**本次未代建 `zhouyufei`、`wangying`；现有管理员先在[用户管理](https://api.artdico.host/admin/settings/accounts/)核对，未建立才按准备／保存及回执流程创建，快捷预填不是已建立账号。Wallet待Apple真实签章与iPhone验收；EmailJS用户已确认正常，保留受控设置。

## 目标
一页式简体中文活动落地页；展示日程和参与方式；正式报名收集 GGJ SO/RO、新站点、行业嘉宾、机构及生态合作伙伴资料，并支持独立确认讲者、赞助、展位与住宿安排。已确认 2026-12-05、09:30 签到、10:00–18:00 正式活动，场地为深圳前海5号楼；待邀嘉宾、协办署名与其他安排仍按各自确认状态展示。

## 技术决策
参考私有仓库 `kunanli/igda_shenzhen`（2026-10-18 检查）：Astro、Function Compute、GitHub Actions、静态 OSS 公共站点、私有 OSS JSON 报名。新建独立仓库和独立 OSS/FC 资源；**不要复制旧密钥、成员数据或直接改 IGDA 正式站**。

## 文档入口

本轮改版：[统一保存](docs/admin-save-workflow.md)、[默认公开](docs/default-public-visibility.md)、[设置回执](docs/settings-save-feedback.md)、[准确验收／发布记录](docs/admin-save-visibility-release-2026-10-22.md)。本轮正式状态以该记录及接续入口为准，下面 PR #42／#43 为前一已发布基准。

| 主要流程 | 操作说明 | 实际发布证据 |
| --- | --- | --- |
| 统一保存、四类默认公开及就近发布 | [保存](docs/admin-save-workflow.md)、[公开规则](docs/default-public-visibility.md) | [PR #44](docs/admin-save-visibility-release-2026-10-22.md) |
| 公开状态、游戏／作品、跟进人色标 | [当前操作](docs/publication-games-operations.md) | [PR #42／#43](docs/games-publication-release-2026-10-21.md) |
| 后台独立页与直接保存 | [页面与保存](docs/admin-independent-pages.md) | [PR #41](docs/admin-pages-release-2026-10-21.md) |
| 人员、嘉宾／讲者、组织、场次与展位关联，共同300名额 | [人员关系](docs/people-relationships.md) | [PR #36](docs/people-release-2026-10-21.md) |
| 学生、精简申请与人工审核 | [报名与审核](docs/public-application-review.md) | [PR #37](docs/application-release-2026-10-21.md) |
| 本机自动暂存、刷新恢复、就近保存与协作者 | [保存与权限](docs/usability-autosave-accounts.md)、[账号](docs/staff-accounts.md) | [PR #38](docs/usability-release-2026-10-21.md) |
| 新版邀请函、字体与私人PNG | [邀请函操作](docs/invitation-poster-v2.md) | [PR #39／#40](docs/invitation-release-2026-10-21.md) |
| 志愿者名单、排班及缺额 | [志愿者](docs/volunteer-operations.md) | [PR #35](docs/volunteer-release-2026-10-21.md) |

- [志愿者与分工](docs/volunteer-operations.md)：既有人员关联、沟通、可服务时段、岗位班次、缺额及 Excel
- [人员串联与步骤指引](docs/staff-operations-workspace.md)：单人工作页、沟通与安排、云端保存防呆、权限边界及设置中心
- [嘉宾与组织图片编辑](docs/staff-image-editing.md)：裁切／缩放／去背景、透明 PNG、上传失败保留与重试（发布状态见接续台账）
- [后台快捷导航](docs/staff-navigation.md)：六个工作区、内容／设置独立子页与手机收合选单
- [参与组织](docs/participating-organizations.md)：独立维护组织图片、名称、链接及参展／一般参与，保存与发布分别执行
- [接续台账](docs/session-recovery.md)、[验收清单](docs/morning-acceptance.md)：中断恢复、准确发布证据与实际资料操作
- [人物与媒体](docs/profile-media.md)、[逐场职责](docs/participant-duties.md)、[Excel 导出](docs/excel-export.md)：本轮后台资料与保留范围
- [参会前端](docs/attendee-experience-ui.md)、[确认信](docs/registration-confirmation.md)、[受控设置](docs/delivery-configuration.md)、[Apple Wallet](docs/apple-wallet-setup.md)：确认、打印、设置及轮替
- `AGENTS.md`：Codex 行为边界与开发顺序
- `docs/01-product-prd.md`：需求、角色、功能与验收
- `docs/02-page-copy.md`：可上站的简体中文文案
- `docs/03-agenda.md`：三场地日程
- `docs/04-form.md`：报名字段、分支与提示语
- `docs/05-admin.md`：后台审核与 Maria 导出
- `docs/backend-readiness.md`：后台账号、编辑及报名统计的早期设计；当前上线状态见接续台账
- `docs/cloud-content-setup.md`：云端内容内核、专用 FC 执行角色与接入过程；当前发布证据见接续台账
- `docs/invitation-planning-workflow.md`：人员安排、微信邀请图、基本资料修正与嘉宾草稿交接
- `docs/06-architecture-data.md`：存储结构及 API 契约
- `docs/07-security-privacy.md`：隐私和安全红线
- `docs/08-deployment.md`：部署环境和上线清单
- `docs/automatic-deployment.md`、`docs/domain-https.md`：当前阿里云静态部署及域名操作记录
- `docs/registration-server-contract.md`：正式报名服务端校验准备及接入边界
- `docs/fc-startup-preflight.md`：历史香港 FC 启动包、控制台验收及回退参考
- `docs/automatic-fc-deployment.md`：由 GitHub 自动发布独立内容包与配置账号的流程

## 范围

已实现活动页、私有报名与审核、人员／组织关系、活动与展位编排、志愿者、通知、邀请图、Excel及后台账号。Wallet 已有设置与下载流程，真实签章及设备验收待完成。二维码签到、支付、邮件营销及自动奖项评定尚未实施；不把计划当作现有功能。
