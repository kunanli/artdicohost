# ARTDiCO HOST · artdico.host

项目：GlobalGameJam 中国交流聚会 × ARTDiCO HOST 学生嘉年华 2026。公开活动页 `artdico.host`、正式报名与独立香港 FC 工作人员后台已启用。资料保存以服务端已确认回执为准；开发和发布的准确来源、实际验收与未配置项目见[接续台账](docs/session-recovery.md)及[验收清单](docs/morning-acceptance.md)。

2026-10-21 人员步骤指引、个人工作页、设置与通知中心及内容保存防呆已上线 [PR #34](https://github.com/kunanli/artdicohost/pull/34)／main `ddf7a2e`。877 项本机／PR／main 检查、真私有 OSS、300 人政策及 26/26 HTTPS 回读通过，16:45:43（UTC+08）全成功；[完整发布证据](docs/staff-operations-release-2026-10-21.md)、[人员与保存操作](docs/staff-operations-workspace.md)。

2026-10-21 嘉宾与组织的本地图片编辑已上线 [PR #33](https://github.com/kunanli/artdicohost/pull/33)：裁切／缩放／拖动、取色去背与手动画笔、透明 PNG，以及服务更新期间的原图片保留与明确重试。817 项本机／PR／main 检查、真实私有 OSS 与 23 个 HTTPS 对象全部通过；[操作及完整证据](docs/staff-image-editing.md)、[邀请 PNG／ZIP、群码和 EmailJS 实际状态](docs/invitation-delivery-status-2026-10-21.md)。

2026-10-21 后台左侧快捷导航已上线 [PR #31](https://github.com/kunanli/artdicohost/pull/31)：四工作区切换、活动编辑八区直达、当前区块标记及手机收合。802 项检查、六组相关浏览器流程、真实私有 OSS 与 23 个 HTTPS 对象通过；首次验收的窗口切换失败及恢复见[发布记录](docs/navigation-release-2026-10-21.md)，[操作说明](docs/staff-navigation.md)。

2026-10-21 独立「参与组织」已上线 [PR #30](https://github.com/kunanli/artdicohost/pull/30)：后台维护组织图片、名称、链接及参展／一般参与；不必占用展位，保存和发布分别执行。802 项检查与实际部署通过，[操作说明](docs/participating-organizations.md)及[完整证据](docs/organization-release-2026-10-21.md)。

2026-10-21 参会体验更新跟踪 [PR #29](https://github.com/kunanli/artdicohost/pull/29)：人物与照片、逐场职责、精简 VI、保留原件的 Excel、报名确认／打印，以及确认信和 Wallet 的受控设置。用户随后回报 EmailJS 收件正常且已配置 key；实际名单与通知状态在私密后台核对，不将合成测试称为实际寄信。Apple Developer enrollment 进行中，签章证书与真机验收仍待完成；当前状态见接续台账。

## 目标
一页式简体中文活动落地页；展示日程和参与方式；正式报名收集 GGJ SO/RO、新站点、行业嘉宾、机构及生态合作伙伴资料，并支持独立确认讲者、赞助、展位与住宿安排。已确认 2026-12-05、09:30 签到、10:00–18:00 正式活动，场地为深圳前海5号楼；待邀嘉宾、协办署名与其他安排仍按各自确认状态展示。

## 技术决策
参考私有仓库 `kunanli/igda_shenzhen`（2026-10-18 检查）：Astro、Function Compute、GitHub Actions、静态 OSS 公共站点、私有 OSS JSON 报名。新建独立仓库和独立 OSS/FC 资源；**不要复制旧密钥、成员数据或直接改 IGDA 正式站**。

2026-10-21「志愿者与分工」已上线 [PR #35](https://github.com/kunanli/artdicohost/pull/35)／main `19b0d10`。942 项 PR／main 检查、真实私有 OSS 的志愿者 CAS／完整历史恢复、300 人政策与 27/27 HTTPS 回读通过，17:47:01（UTC+08）全部成功；[操作](docs/volunteer-operations.md)、[证据](docs/volunteer-release-2026-10-21.md)。接续实施[人员关系及确认参加同步名额](docs/people-relationships.md)，再更新用户提供的邀请函及字体。

## 文档入口
- [志愿者与分工](docs/volunteer-operations.md)：既有人员关联、沟通、可服务时段、岗位班次、缺额及 Excel；候选发布状态见接续台账
- [人员串联与步骤指引](docs/staff-operations-workspace.md)：单人工作页、沟通与安排、云端保存防呆、权限边界及设置中心
- [嘉宾与组织图片编辑](docs/staff-image-editing.md)：裁切／缩放／去背景、透明 PNG、上传失败保留与重试（发布状态见接续台账）
- [后台快捷导航](docs/staff-navigation.md)：四个工作区切换、活动区块直达与手机收合选单
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
- `docs/backend-readiness.md`：后台账号、编辑及报名统计的本机实现和云端待办
- `docs/cloud-content-setup.md`：云端内容内核、专用 FC 执行角色与接入过程；当前发布证据见接续台账
- `docs/invitation-planning-workflow.md`：人员安排、微信邀请图、基本资料修正与嘉宾草稿交接
- `docs/06-architecture-data.md`：存储结构及 API 契约
- `docs/07-security-privacy.md`：隐私和安全红线
- `docs/08-deployment.md`：部署环境和上线清单
- `docs/automatic-deployment.md`、`docs/domain-https.md`：当前阿里云静态部署及域名操作记录
- `docs/registration-server-contract.md`：正式报名服务端校验准备及接入边界
- `docs/fc-startup-preflight.md`：历史香港 FC 启动包、控制台验收及回退参考
- `docs/automatic-fc-deployment.md`：由 GitHub 自动发布独立内容包与配置账号的流程

## 第一版范围
前端、一页内容、表单持久化、独立管理员登录、筛选/备注/导出、隐私告知、基础测试与部署方案。电子票、二维码签到、邮件批量营销、支付、自动奖项评定均不在首版范围。
