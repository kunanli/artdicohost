# ARTDiCO HOST · artdico.host

**最新已發布：**[PR #68](https://github.com/kunanli/artdicohost/pull/68) 已合併至 main `3bf1b6956ebbe1f14af0ac50b5b6883f569de15a`，範圍見[嘉賓公開展示與舊審閱精簡](docs/redesign/admin-data-cleanup-audit.md)。嘉賓依公開開關展示、真實出席獨立；舊人工審閱改歷史唯讀。資料未刪除，展位、住宿、志工流程維持。[PR 檢查 41425057862](https://github.com/kunanli/artdicohost/actions/runs/41425057862) 已通過1638項測試及同版捲動6／排版4／實際素材13；[main 流程 41426077899](https://github.com/kunanli/artdicohost/actions/runs/41426077899) 四工作成功，同版6／4／實際13、私有OSS、13後台及10:18:01 UTC的60公開物件HTTPS核對完成。

**前次已驗證發布（歷史基準）：**[PR #67：Hero 海報字體與公開區域呈現](docs/redesign/hero-poster-typography-release.md)，main `30b4ca6d0891699093f63b9ec790621906f64391`。Hero 真文字、實心／描邊、組織 Logo 單一呈現與空作品整區隱藏已交付；當次[PR 檢查 41414451982](https://github.com/kunanli/artdicohost/actions/runs/41414451982) 的1635項測試及同版捲動6／排版4／實際素材13通過，[main 流程 41415375940](https://github.com/kunanli/artdicohost/actions/runs/41415375940) 四工作成功，私有OSS、13後台與08:56:49 UTC的60公開物件HTTPS回執保留。

更早 [PR66：手機圈內組織、全頁星空與報名更正](docs/redesign/mobile-organizations-profile-release.md)，main `c5166922`，保留當次1634測試、13後台及61公開物件HTTPS回執。首頁樣式沿 [CSS／字級規範](docs/frontend-typography.md)。

活動行唯一一般報名路徑已整理，匯出轉接仍待匿名表頭，正式入口／審核政策尚未切換，見[操作路徑](docs/redesign/external-registration-wallet.md)。以下較早階段的發布與文檔保留作歷史，最新狀態以頁首及[接續台帳](docs/session-recovery.md)為準。

本次改版執行入口：[分階段總覽](docs/redesign/README.md)、[操作手冊](docs/redesign/02-staff-and-attendee-runbook.md)、[驗收與發布](docs/redesign/03-release-and-acceptance.md)。P1–P6、[UX1 操作／層級](docs/redesign/ux-clarity-release.md) 及 [UX2 具名寄送與連續處理](docs/redesign/ux-workflow-release.md) 均已完成程式交付及正式發布；UX2 main `5ec45815` 的 1586 項測試、私有 OSS、13 個後台頁面及 51 個公開物件核驗通過。四項真人／真實資料驗收仍待主辦方記錄。下方 10 月發布資訊為歷史基準，現況以接續台帳及當輪紀錄為準。

[首頁原稿對齊與嘉賓相容修復](docs/redesign/home-reference-release.md) 已由 PR #58 正式發布於 main `30e184fd`：原稿構圖、組織 Logo／名稱與舊公開嘉賓「出席待确认」相容顯示已交付。main 的 1593 項測試、私有 OSS、13 個後台頁面及 53 個準確公開物件 HTTPS 均通過；九筆公開嘉賓資料仍在，不代表九人已確認出席。四項真人／真實資料驗收維持獨立待辦。

前輪 [氣泡職稱與正式 Logo 邊界修復](docs/redesign/bubbles-logo-release.md) 由 PR #59 發布於 main `bd49a745`，1611 項測試及 60 個公開物件等回執保留為歷史；獨立顯示單位與職位由 [PR #60](docs/redesign/guest-identity-reference-release.md) 交付，後續呈現以頁首最新紀錄為準。

项目：GlobalGameJam 中国交流聚会 × ARTDiCO HOST 学生嘉年华 2026。公开活动页 `artdico.host`、正式报名与独立香港 FC 工作人员后台已启用。资料保存以服务端已确认回执为准；开发和发布的准确来源、实际验收与未配置项目见[接续台账](docs/session-recovery.md)及[验收清单](docs/morning-acceptance.md)。

[PR #42](https://github.com/kunanli/artdicohost/pull/42)／[PR #43](https://github.com/kunanli/artdicohost/pull/43) 已实际发布，main **`d9d0dd2cc52eac755aef8deda5de9c91024b741d`**，2026-10-22 **01:05:35（UTC+08）**完成。[正式运行 39639330823](https://github.com/kunanli/artdicohost/actions/runs/39639330823) attempt 1 的 check／deploy-fc／deploy 全成功。 1304项main检查、真实私有OSS／共同300政策、13个API后台路径、46个公开对象HTTPS及匿名公开内容／CORS核对通过。公开／出席红绿状态、前台返回刷新、统一游戏与作品及组织／展位关系、嘉宾照片选填、跟进人固定彩色标签均已上线。[准确证据](docs/games-publication-release-2026-10-21.md)、[操作](docs/publication-games-operations.md)、[新session接续](docs/session-recovery.md)。

**仍需主办方操作：**本次未代建 `zhouyufei`、`wangying`；现有管理员先在[用户管理](https://api.artdico.host/admin/settings/accounts/)核对，未建立才按准备／保存及回执流程创建，快捷预填不是已建立账号。Wallet沿用已配置的受控签章，iPhone真机添加另验；EmailJS用户已确认正常，保留受控设置。

## 目标
一页式简体中文活动落地页；展示日程和参与方式；正式报名收集 GGJ SO/RO、新站点、行业嘉宾、机构及生态合作伙伴资料，并支持独立确认讲者、赞助、展位与住宿安排。已确认 2026-12-05、09:30 签到、10:00–18:00 正式活动，场地为深圳前海5号楼；待邀嘉宾、协办署名与其他安排仍按各自确认状态展示。

## 技术决策
参考私有仓库 `kunanli/igda_shenzhen`（2026-10-18 检查）：Astro、Function Compute、GitHub Actions、静态 OSS 公共站点、私有 OSS JSON 报名。新建独立仓库和独立 OSS/FC 资源；**不要复制旧密钥、成员数据或直接改 IGDA 正式站**。

## 文档入口

历史操作文档：[统一保存](docs/admin-save-workflow.md)、[默认公开](docs/default-public-visibility.md)、[设置回执](docs/settings-save-feedback.md)、[当次验收／发布记录](docs/admin-save-visibility-release-2026-10-22.md)。以下PR42／43等仅供追溯，最新发布状态以页首及接续台账为准。

| 主要流程 | 操作说明 | 实际发布证据 |
| --- | --- | --- |
| 公开状态、游戏／作品、跟进人色标 | [当前操作](docs/publication-games-operations.md) | [PR #42／#43](docs/games-publication-release-2026-10-21.md) |
| 后台独立页与直接保存 | [页面与保存](docs/admin-independent-pages.md) | [PR #41](docs/admin-pages-release-2026-10-21.md) |
| 人员、嘉宾／讲者、组织、场次与展位关联，共同300名额 | [人员关系](docs/people-relationships.md) | [PR #36](docs/people-release-2026-10-21.md) |
| 学生、精简申请与人工审核 | [报名与审核](docs/public-application-review.md) | [PR #37](docs/application-release-2026-10-21.md) |
| 本机自动暂存、刷新恢复、就近保存与协作者 | [保存与权限](docs/usability-autosave-accounts.md)、[账号](docs/staff-accounts.md) | [PR #38](docs/usability-release-2026-10-21.md) |
| 新版邀请函、字体与私人PNG | [邀请函操作](docs/invitation-poster-v2.md) | [PR #39／#40](docs/invitation-release-2026-10-21.md) |
| 志愿者名单、排班及缺额 | [志愿者](docs/volunteer-operations.md) | [PR #35](docs/volunteer-release-2026-10-21.md) |

- [志愿者与分工](docs/volunteer-operations.md)：既有人员关联、沟通、可服务时段、岗位班次、缺额及 Excel
- [统一人员、去重与身份分流](docs/unified-people-workspace.md)：疑似重复核对、主资料与单一名额、待分流／一般参会者／受邀嘉宾／讲者／参展团队
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

已实现活动页、私有报名与审核、人员／组织关系、活动与展位编排、志愿者、通知、邀请图、Excel及后台账号。Wallet 已有签章配置与下载流程，真实 iPhone 加入验收待完成。二维码签到、支付、邮件营销及自动奖项评定尚未实施；不把计划当作现有功能。
