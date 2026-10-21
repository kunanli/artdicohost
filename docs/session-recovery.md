# 开发接续与验收计划

## 当前开发：志愿者与分工；完成后继续人员关系总览（2026-10-21）

使用者已同意新增志愿者名册、沟通／答复、可服务时间、岗位／区域／负责人、班次需求与缺额、冲突检查、Excel，以及既有个人页关联。分支 `feat/volunteer-operations`，从已验证 main `ddf7a2e` 和文档证据 `0cc60e7` 接续；计划提交 `8735756`，追加下一阶段计划 `94eec4c`。尚未宣称志愿者已上线。[操作与契约范围](volunteer-operations.md)、[实施计划](implementation-plan.md)。

隔离 worktree：`/workspace/volunteer-domain`（校验／排程／仓库）、`volunteer-api`（来源／HTTP／Excel）、`volunteer-ui`（新页面／入口）、`volunteer-pack`（静态路由／来源包／备份）、`volunteer-person`（个人页最小摘要）、`volunteer-browser`（合成 Chromium）。root 整合 runtime、完整验证、文档与发布；新文件必须纳入准确来源白名单及完整备份。真实人员与邮件不用作测试，不重新导入名单，不购买服务或更改 IAM／DNS。

候选集成进度：后端、界面、个人页、完整历史备份及包闭包均已合并，当前分支已推送远端作恢复点。首轮完整 **937/937**（241.286 秒）无失败／跳过；之后的回执／身份／统计校验与清除筛选补修 **47/47** 针对检查通过。最终 09:29:38 UTC 静态构建十页；真实 Chromium 志愿者 **28** 组、六区导览 **9** 组、个人／设置 **23** 组，以及名单／内容保存既有流程通过，全部合成资料及零页面错误。源码检查、Astro（0 errors／warnings，1 既有 hint）与依赖审计已通过。正在补实际隔离 OSS 的新志愿者日志 CAS／完整备份恢复验收；准确候选 ZIP、最终 PR／main CI 与实际发布仍待执行，不能将此段当作已上线证据。

使用者随后明确：志愿者做好后，人員与邀约须进一步串连嘉宾／讲者及参与组织中的人，并能看总览与筛选。按顺序先完成并验证发布志愿者，再进入该阶段；已有稳定 contactId→guest 与报名来源关系继续使用，组织成员关系只明确选择 ID，不按文字猜测。接续不能遗漏这个已授权后续，也不能把志愿者上线当成两阶段全部完成。

## 已上线：人员步骤指引、设置中心与保存防呆（2026-10-21）

[PR #34](https://github.com/kunanli/artdicohost/pull/34) 已合并 main `ddf7a2ea0b9c81d9222aefbef3e5155d7432b8a4`；准确 PR head `12af0bb0550bd90fd1827296bed14b876ec7b430` 的 [39569950865](https://github.com/kunanli/artdicohost/actions/runs/39569950865) 检查成功：877/877、422 文件源码、314 文件 Astro（0 errors／warnings，1 既有 hint）、九页构建、依赖审计及两个 ZIP 离线启动全通过。个人／设置及保存防呆的合成 Chromium 已通过。

正式 [main run 39570671725](https://github.com/kunanli/artdicohost/actions/runs/39570671725) attempt 1 三个 job 已全部 **success**：check `119123737827` 再次 **877/877**；FC `119125663285` 的真实十阶段私有 OSS、两客户端／单 FC 通过，**16:44:51（UTC+08）**启用、16:44:52 核定政策／整场 **300 人**；public `119126927516` 于 **16:45:39** 完成 **26/26** 精确 HTTPS 对象 SHA／大小／MIME／HTML 回读，**16:45:43** 全流程成功。已再次只读核对远端 main 为同一完整 `ddf7a2e…`。[完整证据](staff-operations-release-2026-10-21.md)。

从人员名单打开「个人工作页」，依五步核对原意向、实际回复、身份、场次／展位及公开资料。内容页的「应用」仍只改本页；页首、展位旁或固定栏点击「保存到云端」，看到有效保存确认后才刷新。未应用输入与未保存修改均保护离页；未知结果先 GET 核对，确认仍为原版本后才明确重试原快照，409 不覆盖他人更新。保存成功与总览刷新失败分别提示。EmailJS 既有环境与开关保留；Wallet enrollment／正式证书／真机验收仍待完成，没有实际代登记、派发或测试寄信。

证据分支 `docs/staff-operations-release-evidence-2026-10-21` 从实际 main 建立，仅记录验证，不重启业务。接续先核对最新 main／Actions 与本节，不重复本次合并、部署或开发。原生任务附加 PR 工具两次未返回回执，PR #34 的真实网址与运行证据已在本文保存，不能因此重开 PR。

## 本轮实施范围与开发过程（以下候选状态为历史）

分支 `feat/staff-operations-workspace` 从正式图片编辑 main `4a9b49b` 与已保存设置文档接续。用户同意先做设置／通知与单人工作页，随后要求意向人员、嘉宾／讲者、场次与展位串联、直观沟通状态及步骤指引。本轮通过稳定内部 ID 只读整合既有资料，并以实际角色／回复／安排给出下一步；不按姓名邮箱合并，也不在浏览时自动代登记、发送或公开。[操作与契约](staff-operations-workspace.md)、[实施计划](implementation-plan.md)记录范围。

目前仍是开发候选，尚未宣称新页面正式上线。分工在独立 worktree；主 agent 整合 runtime、文档、完整测试、浏览器、精确 PR／CI／实际部署。用户已回报名单画面有 39 人及 EmailJS 可用，并自行配置 key；过去段落的「未导入／未配置」属于当时历史，不能当成当前实际状态。本轮不读取真实名单或密钥、不发送实际邮件。Apple Developer enrollment 进行中，Wallet 仍待真实证书与真机验收。

本轮新增优先修复：用户明确展位修改后没有按保存，刷新丢失本页输入，并同意重填但要求防呆。已确认代码的「应用」仅改浏览器内存，真正 PUT 在长页上端；未套用的展位／场次输入也缺少完整离页守卫。正在补可见云端保存状态、就近入口、输入即保护及 ACK／冲突提示。没有证据表明已保存 OSS 记录被清空，不读取真实内容或用旧快照恢复覆盖。

候选封版进度：代码与浏览器回归已整合到 `b1d16b31fe16e78a1285513defccf0bd2d8f58c5`，完整本机 **877/877** 无失败／跳过；源码与 Astro 通过（0 error／warning，1 既有 hint）、九页构建、依赖审计无已知漏洞。新保存 9 组、个人／设置 22 组，以及 staff／Excel／名单／导航／待办／图片／职责／组织等相关 Chromium 通过。独立来源候选含 **109** 个白名单文件；准确 PR CI 与实际发布仍待执行，此段不是上线证明。保存防呆已实现，早前「正在补」是问题接入时状态。不要重复开发，也不要把这些合成结果称为实际名单操作或邮件实寄。

## 当前：邮件正常回报与 Apple Wallet 开户指引（2026-10-21）

使用者回報 Email 已正常發送，此部分暫時 OK，轉問 Apple Wallet 是否需要 Apple Business。以使用者回報記錄郵件狀態；本開發工作沒有重新讀取 FC 配置或聲稱新的獨立實寄驗收。Wallet 需要 Apple Developer Program／Pass Type ID／簽章證書，Apple Business Manager 不是這項會員。已依官方資料補上會員選擇、99 USD 年費（依地區幣別）、組織 D-U-N-S／法人核驗及後續入口，見[Wallet 設定](apple-wallet-setup.md)。尚未實際申請帳號、購買會員、取得真實憑證或啟用 Wallet；先完成會員，再接現有受控簽章與 iPhone／Safari 真機驗收。

## 设置接续：support@artdico.co 自动报名确认信（2026-10-21）

最新：使用者已保存模板並提供 **`template_89mgpj9`**，使用者已確認 Test It 收件、寄件人與排版正常。已確認目前 provider 支援直接 FC 六欄＋寄件開關（完整環境仍須 ≤4096 bytes），初次可先保持 `false`，後台自動通知先停用；若超限使用原加密 bundle 流程。現有 GitHub workflow 不讀 EmailJS Secrets，加入 Secrets 本身不會配置；部署公開桶身分不寫私有配置。開發工作尚未取得 API key、改 FC 或實寄，勿把新 ID 記錄當作已啟用。實際步驟見下方連結。

用户已有 EmailJS `LoginPlan`／飞书 SSL SMTP，并要求参考 `artdico-deck`。已只读核对原仓库邮件参数，为本项目准备[独立模板、控制台字段及受控启用步骤](emailjs-registration-setup.md)。原 Deck 使用 welcome／notify，活动站使用独立 `EMAILJS_CONFIRMATION_TEMPLATE_ID` 和 `invitation_text`；不能直接套原 `message` 模板。本轮只有文档及模板材料，没有取得实际 API key、修改 EmailJS／FC、启用自动通知或发信；下一步保存独立模板并取得实际 Template ID，再按受控配置验收，不重部署已成功的图片功能。

用户随后要求带入正式活动介绍；[HTML 模板](templates/emailjs-registration-confirmation.html) 已加入「GGJ 中国交流聚会 × ARTDiCO HOST 2026」、12 月 5 日深圳前海、参与对象及计划活动内容，后接真实确认／候补正文。EmailJS 控制台仍须由现有账号保存新模板；本机文件更新不代表线上模板已更改或已寄信。

## 已上线：嘉宾／组织图片编辑与上传恢复（2026-10-21）

[PR #33](https://github.com/kunanli/artdicohost/pull/33) 已上线 main **`4a9b49bc8f285deb2551c9b0b55dab9454f3f970`**；本机／准确 PR／main **817/817**、12 组专用 Chromium、相关既有流程与独立透明公开页检查通过。[正式运行 39536595824](https://github.com/kunanli/artdicohost/actions/runs/39536595824) attempt 1 三个 job 全部成功：真实十阶段私有 OSS、11:12:06（UTC+08）启用、11:12:07 核定政策／300 人容量、11:12:53 的 **23/23** HTTPS 对象回读，11:12:56 完成；远端 main 已核对。

嘉宾／组织现有或新图片支持本地裁切、缩放、移动、取色去背与擦除／还原画笔，透明 PNG 保留，图片框贴合自然比例。503 保留原照片、公开同意和表单，明确原 payload 重试；待上传关闭确认、401 清理及旧回应隔离均重验。没有使用实际用户照片作夹具或修改真实组织资料。[操作、验证与回退](staff-image-editing.md)。

最终证据分支 `docs/image-editor-release-evidence-2026-10-21` 只保存结果，不重启业务。接续先核对工作区、main 与最新 Actions，不重复本次合并／部署。用户追问的邀请 PNG／ZIP、微信群码、实际 EmailJS 与旧预览面板区别见[操作状态](invitation-delivery-status-2026-10-21.md)；实际 39 人匯入／代登记／派发、有效群码与寄件设置仍由现有工作人员在私密后台核对，不能把本次代码发布当作这些业务已执行。

## 已上线：跨登录窗口隔离验收修复（2026-10-21）

[PR #32](https://github.com/kunanli/artdicohost/pull/32) 已上线 main **`b51dff2517ac7f765bc51129da0db6efcfea5b0e`**；本机／准确 PR／main 检查均 **808/808**，六个新回归及独立审阅通过。[正式运行 39533411247](https://github.com/kunanli/artdicohost/actions/runs/39533411247) attempt 1 三个 job 全部成功：真实十阶段私有 OSS、10:37:45（UTC+08）激活、10:37:46 核定政策／300 人容量、10:38:32 的 **23/23** HTTPS 回读；10:38:35 全流程结束。[完整证据](navigation-release-2026-10-21.md)。保留产品时钟、默认 10 次／15 分钟、1000 次／90 秒、十阶段与完整备份。不要重复实现、合并或重跑这次成功发布。

## 已上线：后台快捷导航（2026-10-21）

[PR #31](https://github.com/kunanli/artdicohost/pull/31) 已上线 main **`b8d6818bc6da2c4d298d9f04678f90b5e5b5ffc1`**，本机及正式检查 802 项、准确 PR 检查 39531005132 及导航浏览器回归通过。[正式运行 39531376320](https://github.com/kunanli/artdicohost/actions/runs/39531376320) attempt 2 已全部成功：十阶段真实私有 OSS，10:21:27（UTC+08）业务启用、10:21:29 核定政策／300 人容量及 10:22:19 的 23/23 公开 HTTPS 对象验证。attempt 1 因十五分钟窗口切换在最后阶段达到请求预算，已重现并记录，受控恢复没有复用旧证明。操作见[后台快捷导航](staff-navigation.md)，来源与证据见[发布记录](navigation-release-2026-10-21.md)。没有操作真实组织、报名、名单、邮件或 Wallet 凭证。

## 当前阶段：独立参与组织（2026-10-21，已上线）

[PR #30](https://github.com/kunanli/artdicohost/pull/30) 已上线 main **`a0a02e009d5c547e5683a6b5c37f1c3ff7ea99b2`**，本机／最终 PR／main CI 均为 **802/802**，十二组 Chromium 通过。[正式运行 39528912033](https://github.com/kunanli/artdicohost/actions/runs/39528912033) 三个 job 全部成功：十阶段真实私有 OSS，09:49:58（UTC+08）业务启用、09:49:59 核定政策／300 人容量及 09:50:51 的 23 个公开 HTTPS 对象全部验证。[完整证据](organization-release-2026-10-21.md)、[组织操作](participating-organizations.md)及[实施计划](implementation-plan.md)是接续入口，文档分支 `docs/organization-release-evidence-2026-10-21` 保存最终状态，不另触发部署。没有实际修改四个组织、导入名单或寄信；旧快照读取不迁移，明确编辑才保存新名录。下方 785 项与 PR #29 均为前轮证据；接续先核对最新 main／Actions，不重复实现、合并或部署。

## 当前接续：参会体验六项扩展（2026-10-21，已上线）

[PR #29](https://github.com/kunanli/artdicohost/pull/29) 已上线 main **`d66582e60a7cf3da3a4e2d851a633496bdb02ba4`**，最终 PR／main CI **785/785** 通过。[正式运行 39525987286](https://github.com/kunanli/artdicohost/actions/runs/39525987286) 三个 job 全部成功：十阶段真实私有 OSS、01:19:38 UTC 业务激活、01:19:40 UTC 核定政策／300 人容量，以及 01:20:25 UTC 的 23 个公开 HTTPS 对象全部验证。详见[本轮发布证据](attendee-release-2026-10-21.md)。文档分支 `docs/attendee-release-evidence-2026-10-21` 保存最终证据，不另触发业务部署；下方候选状态是历史，不重新实现、合并或导入。

| 本阶段能力 | 入口与当前行为 | 详细说明 |
| --- | --- | --- |
| 人物、组织与照片 | `/admin/` 编辑职称、简介、网站、公开职责及照片；浏览器自动旋转、缩小和压缩。公开卡片只使用独立确认与授权的人物及真实已排场次；组织复用已确认展位。停止公开保留人物与照片引用。 | [人物与媒体](profile-media.md) |
| 原有人员的职责调整 | `/admin/contacts/` 保留同一个联系人及原始回答，分别编辑全活动职责、逐场次职责与实际回复；讲者、组织者、主持可组合。角色改变不自动公开、不确认名额或住宿。 | [人员职责](participant-duties.md) |
| 真正 Excel 工作簿 | 报名后台导出当前筛选；人员后台独立导出全部已保存联系人。联络、完整原始回答、当前安排分别选择；首次保留原件与现况分列。 | [Excel 范围与审计](excel-export.md) |
| 报名确认与打印 | 公开报名保存后，若返回有效私人链接则跳转 `/registration/confirmation/`；重开读取当前 confirmed／waitlisted／withdrawn。打印隐藏私人链接和群码，取消后隐藏姓名／机构及 Wallet。 | [前端体验与 VI](attendee-experience-ui.md)、[确认服务](registration-confirmation.md) |
| 确认信设置 | superadmin 在报名后台查看缺项、开关及逐人结果。仅已保存的 public 报名可进入自动确认通知；读确认页不发信，意向代登记不自动群发。 | [受控配置](delivery-configuration.md) |
| Apple Wallet 设置 | 已实现签章准备与凭证校验边界、当前名额授权及下载接口。主办方明确尚无 Apple Developer 帐号／证书，本阶段先交付设置流程和操作指引，保持未就绪。 | [Apple 设置步骤](apple-wallet-setup.md) |

实际业务状态：原始问卷 **39 行、38 笔同意联系、1 笔拒绝、11 笔选填 URL 警告**；仍未在云端实际导入、转报名或发出邀请／确认信。实际群码没有因开发恢复。邮件服务及寄件凭证尚未提供或未核验，没有实际收件验收；不能以合成 provider 结果声称已寄出。Apple Developer／Pass Type ID／签章证书及 iPhone 验收均未完成。真实名单、照片和收件人不作测试资料。

接续顺序：

1. 核对主工作区 `git status`、main 及最新 Actions。上述正式运行已成功，不重跑已完成部署、不重复 cherry-pick。文档分支只记录实际证据，功能部署来源仍为 main d66582e。
2. owner 按[早晨验收](morning-acceptance.md)使用现有后台账号核对实际名单、名额及公开授权，再明确导入原始问卷、代登记和准备邀请。自动邮件和工作人员邀请是两套流程；启用自动确认设置不会补寄历史 39 人。
3. 根据实际用途核对照片、逐场职责、完整 Excel 及确认／打印页面；十组合成浏览器与正式云端证据已完成，使用者验收不需要向生产提交虚构报名。
4. 有真实寄件设置后，按[受控配置](delivery-configuration.md)先保存后台停用、配置并核对，再明确开启；保持 unknown 不盲重送。没有实际凭证就保留未设置，不猜测密钥或收件地址。
5. 主办方取得 Apple 帐号及签章链后按[设置指引](apple-wallet-setup.md)完成受控配置与真实 iPhone 验收，再开放票券。其他开发变更另按最新 main 建分支，不因补填文档重新关闭服务。

未知写入或发送 ACK 保留原 operationId／正文，先读取核对再明确重试，不换键盲发。通知 `unknown` 不重送，provider 接受不等于送达。升级后的回退必须兼容 `sessionRoles`、Excel 审计及通知预留历史；先暂停新写入／通知、完整私密备份，再修复，不能旧快照覆盖现有报名。Wallet 已存设备票券不会自动撤除或推送更新。

## 上一阶段正式验收（2026-10-21 00:18 UTC）

本轮五项改善已完成并上线 main **`37a679b7d3a8cfef8d7c2bfcca648756d095fc54`**，PR #28、[正式发布 39519803502](https://github.com/kunanli/artdicohost/actions/runs/39519803502) 的三个 job 全部成功。十项真实隔离 OSS、正式政策及 300 人容量、19 个公开 HTTPS 物件均通过；内容及正式报名已启用。[完整证据与实际资料接续](organizer-release-2026-10-21.md)。本节取代下方本轮候选「待 CI／发布」状态；原始 39 行仍未实际导入、代登记或发送邀请。

## 本轮最新接续（2026-10-21 UTC）

五项扩展已完整装配到 [PR #28](https://github.com/kunanli/artdicohost/pull/28)，分支 `feat/organizer-workflow`。完整本地回归 **681/681 通过**，Astro 零错误／警告、六页构建、314 文件源码检查与依赖稽核通过。六个独立 Chromium 脚本及生产运行时合成浏览器流程通过，包括五种公开表单情境、两种名额管理角色、五种晚到会话回应、手机待办、实际 PNG ZIP、直接展位编辑及时间表分配；零页面错误。全部使用合成资料。

旧群码撤回防护、候补邀请限制、新旧安排入口及完整 v2 历史备份已整合。新版固定十阶段的合成 OSS 检查在 **963 次请求／78 个触及对象**内通过；这不是实际云端请求数。请求 1000 次、90 秒上限保持不变。真实 OSS 的加密维护证明移到初次联系人保存后；完整 v2 历史的恢复另由专门回归覆盖，不把早期云端证明称为已验证 v2 备份。

**接下来只以 PR #28 最终来源的 CI、main 发布及实际 HTTPS／隔离 OSS 结果为准。此刻尚未宣称新版上线。** 若 session 中断，先查 PR 和最新 Actions，不重复已完成的本地实现。下方 PR #27 是此前的生产基准；本段取代下方本轮早期的「运行时／完整测试待收尾」描述。原始 39 行仍未实际导入或发出邀请。

## 最新已驗證的正式版本（2026-10-20 16:41 UTC）

網站、內容後台與正式報名均已啟用。正式功能基準為 main **`2d84d8b74ece04cc4cc9fa95e6847abf06de116c`**；[PR #27](https://github.com/kunanli/artdicohost/pull/27) 已合併，[正式執行 39458653245](https://github.com/kunanli/artdicohost/actions/runs/39458653245) 的三個 job 全部成功。以下歷史台帳的「待驗收／關閉」狀態已由本節取代。

- 最終 CI **589/589 測試通過**，型別檢查、五頁構建、依賴稽核、兩個部署 ZIP 的離線啟動通過。
- Chromium 整合流程 **13/13 通過**，只使用合成資料。
- 真實私有 OSS 的固定十項隔離驗收全部通過；兩個獨立客戶端、一個 FC 進程，請求在 1000 次上限內。成功日誌沒有列實際請求數，不將本地 965 次誤記為實際次數。
- 16:40:40 UTC 驗證內容及正式報名啟用；16:40:41 UTC 驗證實際 HTTPS 報名別名、完整核定政策與 300 人容量。
- 16:41:28 UTC 透過 **https://artdico.host** 逐檔核對 **18 個公開物件**的大小、SHA、MIME、有效 HTTPS 與可呈現 HTML，全部符合精確來源版本。
- 首次較大 JSON 讀回的壓縮阻塞已由全域 identity 協商修正，嚴格位元組／長度／雜湊與未知 ACK 保護保留；沒有 DNS、IAM 或 trigger 變更。

原始問卷 **39 筆已恢復、38 筆可轉、1 筆拒絕、11 筆選填 URL 警告**。**實際雲端匯入／轉報名及邀請發出尚未執行**：本工作環境沒有既有管理員登入會話，須使用現有管理員在私密後台上傳原 Excel、核對預覽並轉入。實際群碼尚需上傳，EmailJS 服務與寄件設定完成前不宣稱已寄信；物理保留／刪除仍按已記錄人工維護流程。操作見 [早晨驗收清單](morning-acceptance.md)。

本次後續提交只保存已完成的發布證據與操作文件，功能部署基準保持上述版本；避免為文件紀錄再次關閉及重啟已驗證服務。恢復時先核對 main 最新 Actions、此節和 PR #27 的最終證據，不重做已成功的部署。

## 集成歷史與詳細契約

本文件保存跨 session 的开发入口，功能完成情况以已提交代码和真实运行证据为准。原聊天 `01a153f8-c7f3-72ef-aff2-08d5e5cd20b5` 多次断线，本轮在新聊天接续。

## 2026-10-21 本轮五项扩展交接

本轮在 `feat/organizer-workflow` 集成，核心交接基准 **`2551c64`**（后续 `af58fdc` 优化撤回批次核对）。五项模块及界面已集成；runtime 装配、候选包、旧群码撤回防护与完整备份回归仍由主集成收尾。**本轮尚无完整套件、最终 CI 或正式发布通过的结论**。下面较早的 581／589 项、PR #26／#27 及发布记录属于历史阶段。

最近已验证的正式版本为 main `2d84d8b74ece04cc4cc9fa95e6847abf06de116c`：[PR #27](https://github.com/kunanli/artdicohost/pull/27)、[发布 39458653245](https://github.com/kunanli/artdicohost/actions/runs/39458653245)。当时 589 项 CI、13 组浏览器、十项真实隔离 OSS 和 18 个公开 HTTPS 对象已验证，内容及正式报名已启用；不能据此声称本轮扩展已上线。

| 已集成功能 | 新版入口 | 本轮接续验证 |
| --- | --- | --- |
| 每日待办与人员进度 | `/admin/tasks/`、`GET /api/admin/tasks` | 负责人／类型筛选、人工发出／服务商接受／实际回复分开，跨新旧日志按人去重；待最新包与会话回归 |
| 批量邀请 PNG ZIP | `/admin/contacts/` 的预检／批量准备 | 最多 100 人、64 MiB 私密 ZIP；只含有效 confirmed 报名、同意且未发出对象，未知 ACK 停止，不自动发信；见[批量邀请](batch-invitations.md) |
| 展位与场次直接编排 | `/admin/` 的 15 格总览、展位侧栏及时间轴 | 应用到草稿、保存、发布分别执行；未应用编辑阻挡导航／保存；关联报名新增安排须 confirmed，历史移除可清理；见[直接编排](direct-arrangements.md) |
| 精简一般报名 | 公开报名区 | 一般机构／职位／经历可选，讲者／展商条件必填；同一原 payload 重试，候补和确认收据分开；见[界面接续](registration-admissions-ui.md) |
| 逐人名额、候补与团队 | `/admin/registrations/` 的实际人数面板 | 共同 300 人、预留默认 0、FIFO、取消一次、逐人 staff_entry、团队只关联真实 ID；见[名额 v2](registration-admissions-v2.md)及[HTTP](admissions-http-contract.md) |

局部证据：名额／报名服务 30 项及邀请／批量／旧入口保护 30 项分别通过，不合计为完整套件。新增加密备份回归 `d287c93` 覆盖 v1 只读、完整 v2 九个索引历史快照／四份不可变记录、团队及 staff_entry 来源；27 项相关合成检查通过，待主集成。浏览器脚本说明见[浏览器验收](../tests/browser/README.md)，最新整合重跑与真实运行结果仍须记录。

发布前核对真实运行时候补设置、严格包白名单、受控来源 SHA、旧签名群码在名额撤回后拒绝读取，以及完整 v2 备份闭包。v2 一旦写入，**不能回滚到只认 v1 的索引写入者**：先停新写入、保存完整私密备份，再用兼容 v2 的修复版本；不能旧快照覆盖新报名。隔离恢复保持 `active:false`／`sessionsRestored:false`，实际擦除及保留期清理另走受控维护。

原始 39 行已恢复并准备私密请求，38 笔同意联系、1 笔拒绝、11 笔选填 URL 警告；**尚未云端导入、转报名或发出邀请**。本环境没有既有 owner 会话，部署验收后由 owner 登录上传原问卷、核对预览与名额，再只对 confirmed 对象准备邀请／安排；不将代登记成功称为确认名额。群码真实图片、可选 EmailJS 配置及后续人工派发仍由 owner 核对。实际步骤见[验收与接续](morning-acceptance.md)。

## 历史恢复记录

## 用户最新要求与确定事项

1. 完成当前受控账号配置，再补齐网站已规划功能，早晨验收。
2. 开发文档必须记录状态、分工、阻塞与下一步，避免再次从聊天猜测。
3. 活动 2026-12-05，报名截止为当日 **12:00（Asia/Taipei／Asia/Shanghai，UTC+08）**；整场容量 **300 人**。
4. 既有意向联系人可由后台选择后直接转为报名，发邀请并安排场次／展位；保持来源及审计，避免重复。不得伪造申请人新同意或未知的必填资料。
5. 用户委托决定其他报名政策。采用 ARTDiCO HOST 活动筹备团队作为活动资料处理者，沿用受控配置中的既有业务邮箱作为隐私联络，资料至 2027-03-05（活动后 90 天）保留；目的为报名、核对、联系与活动安排。存储中国香港，不自动向 Maria 或其他第三方发送全量资料，查阅／更正／撤回／删除由记录在案的人工流程处理。正式告知通过服务器配置投影，不把账号或秘密写入仓库。

## 已恢复与发布

- 前轮未发布四档修正从 GitHub tree `5c8337e6c0094575e4076ce453c5f1de4336bfdf` 恢复，内容与来源逐项核对。
- [PR #25](https://github.com/kunanli/artdicohost/pull/25) 已合并为 `03c766a2cbe32a90f42ec5f8c0e0bc464001920d`；[PR CI](https://github.com/kunanli/artdicohost/actions/runs/39448120552) 的 449 项测试全部通过，构建／依赖稽核／两个包的离线 smoke 通过。
- [main 发布 39448880855](https://github.com/kunanli/artdicohost/actions/runs/39448880855) 的检查、公开 OSS、FC 代码与受控账号配置均成功；FC 三次签名健康标记为同一完整提交。账号配置已确认，内容仍关闭，真实 OSS 的独立验收在下一批代码中接续。

## 当前已集成代码与验证

整站扩展已逐项集成到 `feat/full-site-completion`，当时的集成交接基准为 **`5e5ea84`**。完整 **581 项测试通过**，真实 Chromium 的核心报名流程检查通过；浏览器使用合成响应，不代表生产报名、真实联系人或邮件已执行。[PR #26](https://github.com/kunanli/artdicohost/pull/26) 已转可审阅，等待最终 CI、合并及 main 发布。上节 PR #25 的成功发布是历史生产基准，不能代替本批代码的云端验收。

| 工作 | 已集成内容 | 接续文档 |
| --- | --- | --- |
| 云端装配与合成验收 | 生产服务组合、精确公开路由、后台资源闭包、来源绑定候选包、十阶段隔离验收及受控启用 | [运行时](cloud-runtime-completion.md)、[云端验收](cloud-acceptance.md) |
| 正式报名 | 私有记录＋共享 CAS 索引、300 人容量、签名令牌、幂等、限流、工作人员部分资料及来源查询 | [报名服务](registration-service.md) |
| 后台与公开页 | 公开报名与隐私说明、审核／导出、人员管理、15 个展位位置、场次与人员安排 | [开发台账](development-status.md) |
| 审核与维护 | 独立角色、审核与住宿状态、受控导出／删除申请、加密备份、原子占位的隔离恢复 | [审核](registration-review.md)、[备份恢复](maintenance-backup.md)、[账号](staff-accounts.md) |
| 意向与邀请 | 严格原始资料导入、资格预览、来源幂等转报名、邀请准备／人工发出／明确邮件发送、撤回防护 | [开发台账及 API](development-status.md) |

原工作分支／worktree 是开发来源，不再表示待合并任务；恢复时先核对主集成分支与 GitHub 最新状态，避免重复 cherry-pick。

## 发布与剩余完成定义

1. 完成 PR #26 最终 CI，核对候选包及完整来源 SHA，再合并和发布 main；记录公开 OSS 哈希回读及 FC 三次签名 SHA。
2. 在业务关闭状态执行真实 OSS 十阶段隔离验收，读回受控政策、账号角色与开关；验收是两个独立客户端、一个 FC 进程，不宣称两个真实 FC 实例并发。通过后按受控生命周期启用并记录工作人员登录和公开读取。
3. 使用真实工作人员登录导入已恢复的 39 行原始问卷，明确跳过 1 笔拒绝对象，仅转换 38 笔合资格资料；核对来源、收据及私密安排。准备文件与本地校验均不表示已迁移。
4. 邀请准备、PNG 下载、人工发出和 provider 接受分别记录；真实邮件须明确确认和受控配置，未知 ACK 不盲重送，也不声称送达。
5. 记录最终 Actions、实际验收结果和剩余人工设置。当前角色无 Delete／List 权限，物理擦除与自动保留期清理仍须独立维护；删除申请不等于彻底擦除。

## 恢复时必须核对

- `git status`、各分支最新提交、GitHub main、最新 Actions、此文档与 [开发台账](development-status.md)。不要重做已成功的部署或读取 Secrets 来猜配置。
- 用户重新上传的原始 39 行 XLSX 已恢复；私密请求及逐行问题记录位于主工作区忽略目录 `.local-data/private-intent-import/`（目录 0700、文件 0600）。38 笔同意联系、1 笔明确拒绝；11 笔有选填 URL 投影警告，原答案不变。尚未云端导入、转换或发出邀请。旧 contacts.json 的跟进／回复／发送历史及原群码未因恢复问卷而恢复，不推断或重造。
- 不修改 IGDA 资源、不新增服务套餐、不扩大 IAM、不改主站 DNS 或健康 trigger；恢复与物理删除若需要不同运维权限，明确记录，不能用应用 tombstone 冒充彻底擦除。
- 本地沙盒 Node spawnSync 可能 EPERM；获准执行相关检查后通过。依赖用 `/tmp/artdico-pnpm-store`，不要改系统 HOME。

## 最终候选本地验收（2026-10-20 UTC）

- 完整回归 581/581 通过；其后部署安全诊断 12/12 定向检查通过。Astro 检查零错误／警告、五页构建成功。
- 集成运行时与纯合成私有 OSS 的真实 Chromium 端到端 **13/13 通过**：桌面／手机报名与收据群码、审核与住宿／私密 CSV、内容发布与 15 展位私隐投影、意向转换／安排／人工邀请、真实浏览器 XLSX 导入和重导幂等、账号及会话撤销、嘉宾肖像／关联场次／学生作品、加密备份／隔离恢复、手机布局及 Secure Cookie。零页面异常、零非预期控制台错误。合成验收不代表云端或真实名单已迁移。
- 最终候选修复未知结果后的原内容／幂等键重试、Chromium 恢复名称 pattern、离线候选包旧错误码断言；[PR #26](https://github.com/kunanli/artdicohost/pull/26) 已转可审阅。准确提交的 CI、main 生命周期及公开 OSS 读回仍须跟进；不得据本段宣称正式启用。

## 首次正式云端运行与修复接续

[PR #26](https://github.com/kunanli/artdicohost/pull/26) 已合并为 main `8d17a700b78f430a3b3a9b337134a18b7abbed48`。最终 PR CI 及 main 检查均通过（582 项测试、类型／构建／依赖稽核、两包离线 smoke）。[main 39455839350](https://github.com/kunanli/artdicohost/actions/runs/39455839350) 的实际私有 OSS 验收完成 object-readback、atomic-conflict、login-permissions，在 private-contacts 停止：108 次请求、19 个触及对象，第一笔较大 JSON blob 写入后的读回未获验证。内容和正式报名仍关闭，公开 OSS 发布被依赖门禁跳过；没有宣称扩展功能已正式开放。下一批针对 HTTP 压缩协商与严格字节读回修正，须经新 CI 和准确 main 的实际验收后才能启用。最新运行证据继续记于对应 PR，恢复时先查看 main 最新 Actions。
