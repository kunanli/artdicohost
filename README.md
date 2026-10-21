# ARTDiCO HOST · artdico.host

项目：GlobalGameJam 中国交流聚会 × ARTDiCO HOST 学生嘉年华 2026。公开活动页 `artdico.host`、正式报名与独立香港 FC 工作人员后台已启用。资料保存以服务端已确认回执为准；开发和发布的准确来源、实际验收与未配置项目见[接续台账](docs/session-recovery.md)及[验收清单](docs/morning-acceptance.md)。

2026-10-21 独立「参与组织」已上线 [PR #30](https://github.com/kunanli/artdicohost/pull/30)：后台维护组织图片、名称、链接及参展／一般参与；不必占用展位，保存和发布分别执行。802 项检查与实际部署通过，[操作说明](docs/participating-organizations.md)及[完整证据](docs/organization-release-2026-10-21.md)。

2026-10-21 参会体验更新跟踪 [PR #29](https://github.com/kunanli/artdicohost/pull/29)：人物与照片、逐场职责、精简 VI、保留原件的 Excel、报名确认／打印，以及确认信和 Wallet 的受控设置。合并与实际上线分别核对最新 main／Actions；邮件凭证和 Apple Developer／签章证书仍未提供，不将合成测试称为实际寄信或设备验收。原始 39 行的实际云端导入及邀请未执行。

## 目标
一页式简体中文活动落地页；展示日程和参与方式；正式报名收集 GGJ SO/RO、新站点、行业嘉宾、机构及生态合作伙伴资料，并支持独立确认讲者、赞助、展位与住宿安排。已确认 2026-12-05、09:30 签到、10:00–18:00 正式活动，场地为深圳前海5号楼；待邀嘉宾、协办署名与其他安排仍按各自确认状态展示。

## 技术决策
参考私有仓库 `kunanli/igda_shenzhen`（2026-10-18 检查）：Astro、Function Compute、GitHub Actions、静态 OSS 公共站点、私有 OSS JSON 报名。新建独立仓库和独立 OSS/FC 资源；**不要复制旧密钥、成员数据或直接改 IGDA 正式站**。

## 文档入口
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
