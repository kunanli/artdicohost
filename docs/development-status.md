# 开发接续与验收台账

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

本文件是下一次聊天的开发入口。用户要求把整站功能持续完成，并将既有意向资料直接转为报名、发出邀请，再在后台安排对应活动场次。每项区分代码、实际资料、云端验收；不能把合成测试或页面可见当作业务完成。历史过程见 [session recovery](session-recovery.md)、[实施计划](implementation-plan.md)及 [云端接入](cloud-content-setup.md)。

## 已核定产品与运行边界

- 活动：2026-12-05；09:30 签到，10:00–18:00 正式活动；深圳前海5号楼。具体楼层、讲者、展位及住宿分别确认。
- 报名截止：**2026-12-05 12:00（UTC+08:00）**；整场容量 **300**，公开报名和工作人员转报名共用容量。
- 用户授权由维护人员决定其余运行政策；当前采用 ARTDiCO HOST 活动筹备团队为处理者，权利申请邮箱从受控业务设置提供，保留至 **2027-03-05**。受控邮箱尚未配置时不能虚构值或假称隐私告知已完整上线。
- 普通报名成功保存即可参加；讲者、展位、住宿、官方 GGJ 站点资格及作品公开授权相互独立。原始意向、实际回复和工作人员操作来源分别保存。
- 后台须按 **15 个展位位置** 记录对应团队／联络对象、参与人员、场次及展位安排；未分配位置仍为空位，不虚构已确认展商。私人联络资料与人员名单不因排位自动公开。此模型与界面已集成，复用稳定 booth／session IDs。
- 转报名由有名单权限且具有 reviewer／superadmin 的可信工作人员执行；不把浏览器自报角色当成权限。既有 owner 的受控角色升级由专用部署阶段验收，其他 outreach 身份不自动获得审核权限。
- 密钥、密码摘要、会话、真实报名和原始名单只在受控服务端；不进入 Git、公开产物、日志或 artifact。不使用 IGDA 生产身份或数据。

## 已集成交付与生产基准

当时的集成交接基准为主集成分支 `feat/full-site-completion` 的 **`5e5ea84`**。所有本阶段模块已合并，完整 **581 项测试通过**，真实 Chromium 核心报名流程检查通过；其合成网络响应不代表真实云端业务已执行。[PR #26](https://github.com/kunanli/artdicohost/pull/26) 已转可审阅，待最终 CI、合并和 main 发布。下列模块无需再次从原工作分支合并。

| 工作 | 集成记录／文档 | 当前状态 |
| --- | --- | --- |
| 历史生产基准 | PR #25，main `03c766a`；[Actions 39448880855](https://github.com/kunanli/artdicohost/actions/runs/39448880855) | 当时各任务成功，受控 owner 配置完成、业务关闭；不代表本批扩展已部署 |
| 报名服务 | [报名服务](registration-service.md)；`86a48fc` 等 | 共享私有 OSS、Token、容量、幂等、部分资料工作人员登记、journal 撤回检查均已集成 |
| 审核、账号与维护 | [审核](registration-review.md)、[账号](staff-accounts.md)、[备份恢复](maintenance-backup.md)；`af789cf`、`85fb5cb` 等 | 审核／导出／撤回／删除申请、独立角色、加密备份及原子隔离恢复已集成；物理擦除和自动到期清理另行维护 |
| 公开与后台界面 | `451fa34`、`9083a77`、`1eb1367` 等 | 公开报名、关闭后隐私告知、审核／人员／QR／备份操作、15 展位及私密联络对象已集成 |
| 云端装配、配置与验收 | [运行时](cloud-runtime-completion.md)、[云端验收](cloud-acceptance.md)；`5c5fa4a`、`5e5ea84` 等 | 精确路由、包闭包、受控政策与 owner 角色、十阶段隔离验收已集成；真实执行及启用待本次发布 |
| 意向转报名／邀请／导入 | `7aee294`、`d6da95d`、`5f7a562` | runtime、接口及界面均已集成；严格导入、38 笔资格预览和链接警告语义见下文，真实迁移与发出仍待工作人员登录操作 |

## 意向转报名、邀请与人员安排

`createIntentInvitationService` 使用注入的报名服务、现有 contactsStore／contentStore、独立 journal repository、明确邮件 provider 和 `isRegistrationActive` 审核读取。邀请日志建议使用当前私有角色范围内的 `cms/v1/intent-invitations`；不扩充 RAM，不写公开对象。

1. 工作人员选择稳定 contact ID，并携带当前名单修订号。服务先核对整组来源存在，再明确跳过已拒绝联系或婉拒者，逐条调用 `submitStaffRegistration`，共享报名容量。批量结果明确列出完成、skipped 和失败项，不声称跨报名／名单／邀请日志具有原子事务。预览只回传资格、固定警告字段名及计数，不输出额外个人资料。
2. 相同活动和 contact ID 只登记一次；已保存收据可通过 `getStaffRegistrationBySource` 恢复。转换 ledger 保留 `sourceContactId`、原 source key／row ID／digest、操作者、时间和授权引用。原联系资料、原始问卷答案及回复不被改写；不会伪造新申请人勾选的隐私同意。
3. 邀请默认生成确定活动事实、报名编号及现有 PNG 所需 settings；状态为 `prepared`，不等于已发出。明确的另一操作才记 `manually_sent`，渠道为微信、邮件或其他；图片下载不自动记送达。
4. 真正 EmailJS 发送仅接受本次明确确认、已同意联系且仍有效的报名，以及受控 sender／template／服务配置。`ARTDICO_INVITATION_EMAIL_ENABLED` 默认关闭，另需 `EMAILJS_SERVICE_ID`、`EMAILJS_TEMPLATE_ID`、`EMAILJS_PUBLIC_KEY`、`EMAILJS_PRIVATE_KEY`、`EMAIL_FROM_ADDRESS`、`EMAIL_FROM_NAME`。寄件地址限单一 `@artdico.co` 邮箱；配置值不返回前端。
5. 发信前先在共享 journal 确认 `issuing` 预留，再最多调用 provider 一次。HTTP 200 仅记 `provider_accepted`，不记 delivered。网络或 ACK 不明记 `unknown`；中断遗留的 `issuing` 对工作人员显示为 unknown，重复请求不自动再发。EmailJS 没有在此声称支持服务端幂等键；防重依靠本站 durable ledger。
6. 关联场次／展位继续使用现有稳定 ID。写入前读取当前内容，拒绝已取消、删除或同一人员时间重叠的安排；只保存私密 operations，不自动公开个人资料、不改实际出席回复。
7. `isRegistrationActive` 必须读取真实审核状态；`withdrawn` 或存在删除请求时拒绝新的邀请、手动发出和安排。审核读取失败时关闭操作。

工作人员登记投影只接收符合当前 HTTP／HTTPS URL 契约的选填 website／caseLinks。原问卷中的「无」等自由文字或混合无效链接不复制到报名 URL 字段；原联系人原文和来源 digest 完整保留，不造网址、不覆盖答案。转换预览、返回值及私密 audit 只记录 `website`／`caseLinks` 哪些字段未投影，不把原文放进一般日志。

HTTP 路由均在 `https://api.artdico.host`，需要可信会话、服务端角色；POST 另需准确 Origin 与 CSRF。响应为 no-store：

| 路径 | 方法／正文 |
| --- | --- |
| `/api/admin/contacts/convert` | POST `{contactIds,expectedContactRevision}`；授权引用由服务器提供 |
| `/api/admin/contacts/convert/preview` | POST 同上；资格、跳过原因及选填链接未投影警告，零写入 |
| `/api/admin/intent-invitations` | GET；私密转换关联、邀请状态及不含配置值的 email readiness |
| `/api/admin/contacts/:id/invitation` | POST `{expectedContactRevision,channel:'manual'或'email',expectedRegistrationId,confirmEmail}` |
| `/api/admin/intent-invitations/:id/manual-sent` | POST `{channel:'wechat'或'email'或'other'}` |
| `/api/admin/contacts/:id/assignments` | POST `{expectedContactRevision,sessionIds,boothIds}`；可继续使用现有安排界面 |

`issueInvitation` 返回 `{invitation,contactRevision,replayed}`；PNG 使用 `invitation.content.settings`。转换返回 `{status,contactRevision,registrations,failures,skipped,warnings}`，失败仅含固定错误码及必要字段名，不含原始 provider 诊断。

## 真实 39 笔资料的恢复与迁移

用户已重新提供原始 **39 行文字选项 XLSX**。已用既有 `readSheet`／`parseContactImport` 映射原来源序号和答案，并由新增导入 schema 验证恰为 39 行；准确原文件 SHA-256、受控请求及准备元信息仅保存于主工作区忽略目录 `.local-data/private-intent-import/`（目录 0700、文件 0600）。未打印姓名／联络方式，不将真实资料作测试夹具。**云端迁移、转报名和邀请发送仍待真正执行**，准备文件不等于已完成操作。

已对实际 39 行执行无写入的工作人员登记投影检查：**38 笔明确同意联系且可转换，1 笔明确拒绝须跳过；没有缺少姓名／联络方式等核心字段问题，也没有疑似重复联络行**。11 笔含不符合 URL 契约的选填文字（website 8、caseLinks 5，部分重叠），只在报名投影省略这些字段，原答案不变；投影后 39 笔 schema 均可表达，拒绝对象仍不转换或邀请。逐行警告仅在已忽略、0600 的 issues.json，公开台账仅记录计数。

旧聊天的本机 contacts.json 尚未恢复，因此其历史跟进、实际回复和人工发出记录不能从重新上传的原问卷推断或重建。问卷行保留历史意向；新私密 operations 从 pending、未安排和未发出开始。若之后取得原 contacts.json，可按下一段的严格快照路径核对；不得覆盖已合法编辑的新记录。

`prepareIntentContactImport` 解析明确提供的原 contacts.json 字串，依据原 `CONTACT_SCHEMA_VERSION`、精确字段、稳定 source key／row ID／hash 与完整已知历史 audit 校验，保留原始资料、安排及邀请历史。未知 audit action／字段、伪造创建、被改动的来源 hash 或不一致的邀请历史均拒绝。相同来源记录 unchanged，并保留导入后合法编辑；来源 digest 冲突整批阻挡，邮箱／微信疑似重复须明确核对，不模糊合并姓名。

`createIntentContactImporter` 与 cloud contactsStore 的 `importContacts` 已实现单一 journal CAS 导入。快照在独立 migrationArchives 中逐字保留原审计，并有原文件／payload／snapshot SHA-256、实际导入者、时间和明确 contact IDs；云端新增真实 import_contacts 事件，不伪造 create_contact 历史。后续每次读取重新校验档案及状态关系；日志仍遵守 1 MiB 单状态与 1000 条审计上限，超限拒绝写入。

原问卷 XLSX 可由现有浏览器解析器读成规范 rows；请求同时提供原文件 bytes 的 base64 与 SHA-256。服务器验证实际上传 bytes 的 hash、原来源行号、逐字段 schema 及规范 rows digest，再由工作人员明确确认原件和映射。这里的「行与 XLSX 对照」是工作人员审阅的浏览器规范化，不宣称服务器另行解析过 Excel；原文件 bytes 经 hash 后不重复保存在云端。unknown／declined 的联系同意不会因导入被改成 consented，历史预计到场不会自动变成 confirmed。

`POST /api/admin/contacts/import/preview` 接受 `{kind:'snapshot',snapshot,originalSha256}` 或 `{kind:'rows',sourceKey,rows,sourceFileBase64,originalSha256}`；返回与来源 digest、当前 revision 和操作者绑定的 previewToken、expectedRevision、固定 counts，rows 为空。`POST /api/admin/contacts/import` 重送同一来源，并提供 expectedRevision、previewToken、confirmSource:true、allowPossibleDuplicates。两者需要 outreach／superadmin、准确 Origin、会话及 CSRF。没有仅存在单实例的 Map token；来源变更和过期修订不会静默写入。未知 ACK 不自动重送，明确重试可只读确认同一已提交迁移。源文件上限 2 MiB，传输正文上限 3 MiB，最终私密日志容量仍独立核对。

## 本阶段验证与剩余验收

当前集成基准 `5e5ea84` 的完整 **581 项测试全部通过**；真实 Chromium 核心报名流程检查通过，包括关闭状态、提交回执及相同键／payload 的失败重试，使用合成响应，不读取真实名单或发信。模块开发期间的 39 项意向／导入／cloud contacts 测试、215 文件源码扫描及 diff 检查为历史局部验证；最终 CI 仍须以本次 PR 的完整来源提交为准。

覆盖行为包括来源转换与重建幂等、权限／修订／拒绝对象、选填链接警告且原文不变、人工发出分离、明确邮件意图、竞争仅一调用、未知 ACK 不重发、收据恢复、撤回／删除、防时间冲突安排、严格原文件 hash／快照归档、导入后编辑、重放不覆盖、原始同意保留及迁移竞争。报名／审核／维护／运行时的组合检查使用合成资料和注入 provider；真实 39 行仅用于用户授权的私密准备及无写入校验，没有真实发信或云端迁移。

剩余交付按实际证据逐项关闭：

1. PR #26 最终 CI 与候选包核对、合并、main 发布，记录公开 OSS 哈希回读、FC 三次签名完整 SHA 和受控配置读回。
2. 业务关闭下完成真实 OSS 十阶段隔离验收，记录会话、并发 CAS、发布撤回和报名／审核／维护结果；两个独立客户端共用一个 FC 进程。按受控生命周期启用后核对工作人员登录、公开页面 API 读取及开关状态。
3. 工作人员真实登录后上传原 39 行问卷，确认来源映射，转换 38 笔合资格资料并保留 1 笔拒绝对象不转换／邀请；核对实际收据和场次／15 展位安排。当前 `cloudImported`、`registrationsConverted`、`invitationsSent` 均为 false。
4. 按需准备 PNG、明确登记人工发出；若启用邮件，核对受控 sender／template／provider 配置与本次确认，只记录实际接受结果。未知状态人工处理，不以重跑 job 自动再发或假称送达。
5. 加密备份与隔离恢复是已集成能力，仍需真实受控验收；物理删除、自动保留期清理和独立备份的运行周期仍待维护方案。现有删除申请准确返回未物理擦除，旧 contacts.json／原群码的历史不可从新问卷重建。

回退按当前 main 的修复／revert 发布，先关闭对应报名／邮件／内容开关并保留私有日志。旧代码不得覆盖新报名、转换或邀请 ledger；没有 Delete 权限时不能声称物理清除完成。原群码及既有更新提醒保持独立，不在本模块读取或更改。

## 最终候选本地验收（2026-10-20 UTC）

- 完整回归 581/581 通过；其后部署安全诊断 12/12 定向检查通过。Astro 检查零错误／警告、五页构建成功。
- 集成运行时与纯合成私有 OSS 的真实 Chromium 端到端 **13/13 通过**：桌面／手机报名与收据群码、审核与住宿／私密 CSV、内容发布与 15 展位私隐投影、意向转换／安排／人工邀请、真实浏览器 XLSX 导入和重导幂等、账号及会话撤销、嘉宾肖像／关联场次／学生作品、加密备份／隔离恢复、手机布局及 Secure Cookie。零页面异常、零非预期控制台错误。合成验收不代表云端或真实名单已迁移。
- 最终候选修复未知结果后的原内容／幂等键重试、Chromium 恢复名称 pattern、离线候选包旧错误码断言；[PR #26](https://github.com/kunanli/artdicohost/pull/26) 已转可审阅。准确提交的 CI、main 生命周期及公开 OSS 读回仍须跟进；不得据本段宣称正式启用。

## 首次正式云端运行与修复接续

[PR #26](https://github.com/kunanli/artdicohost/pull/26) 已合并为 main `8d17a700b78f430a3b3a9b337134a18b7abbed48`。最终 PR CI 及 main 检查均通过（582 项测试、类型／构建／依赖稽核、两包离线 smoke）。[main 39455839350](https://github.com/kunanli/artdicohost/actions/runs/39455839350) 的实际私有 OSS 验收完成 object-readback、atomic-conflict、login-permissions，在 private-contacts 停止：108 次请求、19 个触及对象，第一笔较大 JSON blob 写入后的读回未获验证。内容和正式报名仍关闭，公开 OSS 发布被依赖门禁跳过；没有宣称扩展功能已正式开放。下一批针对 HTTP 压缩协商与严格字节读回修正，须经新 CI 和准确 main 的实际验收后才能启用。最新运行证据继续记于对应 PR，恢复时先查看 main 最新 Actions。
