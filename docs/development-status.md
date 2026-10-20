# 开发接续与验收台账

本文件是下一次聊天的开发入口。用户要求把整站功能持续完成，并将既有意向资料直接转为报名、发出邀请，再在后台安排对应活动场次。每项区分代码、实际资料、云端验收；不能把合成测试或页面可见当作业务完成。历史过程见 [session recovery](session-recovery.md)（若当前分支尚无该文件，合并主工作分支后读取）、[实施计划](implementation-plan.md)及 [云端接入](cloud-content-setup.md)。

## 已核定产品与运行边界

- 活动：2026-12-05；09:30 签到，10:00–18:00 正式活动；深圳前海5号楼。具体楼层、讲者、展位及住宿分别确认。
- 报名截止：**2026-12-05 12:00（UTC+08:00）**；整场容量 **300**，公开报名和工作人员转报名共用容量。
- 用户授权由维护人员决定其余运行政策；当前采用 ARTDiCO HOST 活动筹备团队为处理者，权利申请邮箱从受控业务设置提供，保留至 **2027-03-05**。受控邮箱尚未配置时不能虚构值或假称隐私告知已完整上线。
- 普通报名成功保存即可参加；讲者、展位、住宿、官方 GGJ 站点资格及作品公开授权相互独立。原始意向、实际回复和工作人员操作来源分别保存。
- 后台须按 **15 个展位位置** 记录对应团队／联络对象、参与人员、场次及展位安排；未分配位置仍为空位，不虚构已确认展商。私人联络资料与人员名单不因排位自动公开。此模型与界面由对应维护分支集成，本模块复用稳定 booth／session IDs。
- 转报名由有名单权限且具有 reviewer／superadmin 的可信工作人员执行；不把浏览器自报角色当成权限。既有 owner 的受控角色升级由专用部署阶段验收，其他 outreach 身份不自动获得审核权限。
- 密钥、密码摘要、会话、真实报名和原始名单只在受控服务端；不进入 Git、公开产物、日志或 artifact。不使用 IGDA 生产身份或数据。

## 工作分支与代码交付

| 工作 | 分支／已知提交 | 当前交付与下一步 |
| --- | --- | --- |
| 原聊天修复 | PR #25，main `03c766a`；来源 `f8b9afd` | [Actions 39448880855](https://github.com/kunanli/artdicohost/actions/runs/39448880855) 各任务成功，owner 配置保持关闭；这不代表扩展功能或真实私有储存已验收 |
| 报名服务 | `feat/registration-service`，`7894767` | 共享私有 OSS、Token、总容量、幂等提交、工作人员部分资料登记与来源查询；需合并、完整回归及真实云端验收 |
| 审核与生命周期 | `feat/registration-review`，`6c0365e` 起 | 私密审核、统计、受控导出、撤回和删除请求；当前详细状态以该分支后续提交为准 |
| 公开报名和后台界面 | `feat/admin-completion` | 公开传输、真实成功／失败、审核与意向转报名／邀请操作由界面维护者继续集成 |
| 云端装配与接入 | `feat/cloud-acceptance` | 报名、审核、邀请 runtime／handler 与候选包白名单集成；域名精确路由、合成验收及最终开关另行验证 |
| 受控配置及政策 | `feat/cloud-lifecycle`，`354bad6` 起 | 容量、截止、隐私、独立报名 Token Secret、owner 角色及开关的受控设置与读回；不取回 Secret 值 |
| 意向转报名／邀请 | `feat/intent-invitations` | 本文件及 `functions/intent-invitations/`、两组测试；接口和未知发送结果语义见下节；由主分支合并并完成 runtime／界面验证 |

## 意向转报名、邀请与人员安排

`createIntentInvitationService` 使用注入的报名服务、现有 contactsStore／contentStore、独立 journal repository、明确邮件 provider 和 `isRegistrationActive` 审核读取。邀请日志建议使用当前私有角色范围内的 `cms/v1/intent-invitations`；不扩充 RAM，不写公开对象。

1. 工作人员选择稳定 contact ID，并携带当前名单修订号。服务先核对整组来源存在，再明确跳过已拒绝联系或婉拒者，逐条调用 `submitStaffRegistration`，共享报名容量。批量结果明确列出完成、skipped 和失败项，不声称跨报名／名单／邀请日志具有原子事务。预览只回传资格、固定警告字段名及计数，不输出额外个人资料。
2. 相同活动和 contact ID 只登记一次；已保存收据可通过 `getStaffRegistrationBySource` 恢复。转换 ledger 保留 `sourceContactId`、原 source key／row ID／digest、操作者、时间和授权引用。原联系资料、原始问卷答案及回复不被改写；不会伪造新申请人勾选的隐私同意。

工作人员登记投影只接收符合当前 HTTP／HTTPS URL 契约的选填 website／caseLinks。原问卷中的「无」等自由文字或混合无效链接不复制到报名 URL 字段；原联系人原文和来源 digest 完整保留，不造网址、不覆盖答案。转换预览、返回值及私密 audit 只记录 `website`／`caseLinks` 哪些字段未投影，不把原文放进一般日志。
3. 邀请默认生成确定活动事实、报名编号及现有 PNG 所需 settings；状态为 `prepared`，不等于已发出。明确的另一操作才记 `manually_sent`，渠道为微信、邮件或其他；图片下载不自动记送达。
4. 真正 EmailJS 发送仅接受本次明确确认、已同意联系且仍有效的报名，以及受控 sender／template／服务配置。`ARTDICO_INVITATION_EMAIL_ENABLED` 默认关闭，另需 `EMAILJS_SERVICE_ID`、`EMAILJS_TEMPLATE_ID`、`EMAILJS_PUBLIC_KEY`、`EMAILJS_PRIVATE_KEY`、`EMAIL_FROM_ADDRESS`、`EMAIL_FROM_NAME`。寄件地址限单一 `@artdico.co` 邮箱；配置值不返回前端。
5. 发信前先在共享 journal 确认 `issuing` 预留，再最多调用 provider 一次。HTTP 200 仅记 `provider_accepted`，不记 delivered。网络或 ACK 不明记 `unknown`；中断遗留的 `issuing` 对工作人员显示为 unknown，重复请求不自动再发。EmailJS 没有在此声称支持服务端幂等键；防重依靠本站 durable ledger。
6. 关联场次／展位继续使用现有稳定 ID。写入前读取当前内容，拒绝已取消、删除或同一人员时间重叠的安排；只保存私密 operations，不自动公开个人资料、不改实际出席回复。
7. `isRegistrationActive` 必须读取真实审核状态；`withdrawn` 或存在删除请求时拒绝新的邀请、手动发出和安排。审核读取失败时关闭操作。

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

意向／邀请及导入新增 27 项测试全部通过；连同既有 cloud contacts 12 项回归共 **39 项通过、零失败／跳过**，215 文件源码扫描与 diff 检查通过。覆盖来源转换与重建幂等、权限／修订／拒绝对象、链接投影警告且原文不变、确认活动邀请、人工发出分离、邮件明确意图、竞争仅一调用、未知 ACK 不重发、收据恢复、预留后复核、撤回／删除、场次分配，以及严格快照／原文件 hash／归档 audit、导入后编辑、重放不覆盖、原始同意保留、重复联络审阅和单一迁移竞争。组合完整检查由主维护者继续记录。另以真实新 registration service 与本模块组合验证了部分来源资料、保留 staff provenance／无申请人同意、持久关联和手动邀请。测试全部用合成资料及注入 provider；实际 39 行仅用于用户授权的私密准备和无写入 schema 校验，没有真实发信或真实 OSS 请求。

合并后仍须记录：完整套件、源码检查、Astro 检查／四页构建、依赖审计、实际候选包验证、浏览器端到端、准确 main 的公开 OSS 回读和 FC 三次签名 SHA、受控配置读回、隔离真实 OSS／会话／并发／发布撤回结果。真实邮件要取得已配置 provider 的可核对接受结果；未知发送状态需人工处理，不以重跑 job 自动再发。备份／恢复／删除／容量维护与源文件丢失仍是明确交付项，不能因本阶段通过而删除待办。

回退按当前 main 的修复／revert 发布，先关闭对应报名／邮件／内容开关并保留私有日志。旧代码不得覆盖新报名、转换或邀请 ledger；没有 Delete 权限时不能声称物理清除完成。原群码及既有更新提醒保持独立，不在本模块读取或更改。
