# 开发接续与验收计划

## 当前发布：后台快捷导航（2026-10-21，部署中）

[PR #31](https://github.com/kunanli/artdicohost/pull/31) 已合并 main **`b8d6818bc6da2c4d298d9f04678f90b5e5b5ffc1`**，本机完整 802 项、准确 PR 检查 39531005132 及导航浏览器回归通过。[正式运行 39531376320](https://github.com/kunanli/artdicohost/actions/runs/39531376320) 尚在进行，继续核对三个 job 及实际 FC／私有 OSS／公开 HTTPS；不能在此阶段声称上线。文档分支 `docs/navigation-release-evidence-2026-10-21` 保存检查点，勿重新实现或合并。操作见[后台快捷导航](staff-navigation.md)，来源与证据见[发布记录](navigation-release-2026-10-21.md)。没有操作真实组织、报名、名单、邮件或 Wallet 凭证。

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
