# 批量准备私密邀请图片

本模块在既有工作人员会话、联系人、报名／名额及邀请日志上运行，不增加云资源、IAM 权限、依赖或公开文件。报名成功、名额确认、邀请准备、人工发出和邮件接受仍分别记录；本模块没有批量发送邮件功能。

## 预检与明确准备

两条接口均位于 `https://api.artdico.host`，需要 outreach／superadmin 真实会话、准确 Origin 和 CSRF，返回 `Cache-Control: no-store`。沿用 32 KiB JSON 正文上限，拒绝额外字段。选择必须为 1–100 个不重复的稳定 contact ID。

- `POST /api/admin/contacts/invitations/preview`：正文 `{contactIds,expectedContactRevision}`。零写入；返回 `{contactRevision,previewToken,entries,summary:{selected,eligible,skipped}}`，逐人条目为 `{contactId,eligible,reason,registrationId?,referenceCode?}`，不增加姓名或联系方式。
- `POST /api/admin/contacts/invitations/prepare-batch`：相同正文再加 `previewToken` 和 `confirmPrepare:true`。返回 `{contactRevision,status,results,summary}`；每个所选 ID 恰有一个结果，状态为 `prepared`、`replayed`、`skipped`、`failed` 或 `unknown`。已确认准备者附私密 `invitation`，供原有 PNG renderer 使用。没有 channel／email／batchId 等客户端字段。

预检逐人核对当前名单修订、稳定来源摘要／行号／key、转换 ledger 的报名关联、真实审核有效状态、报名索引中的已确认名额、已确认活动事实及邀请内容。明确拒绝／婉拒、未知联系同意、未转换、候补、撤回／删除请求、已有发送记录或不明派发状态均跳过；读取失败关闭整次预检。已准备但未发出的同内容 manual 邀请可重用。已发送或邮件 ACK 不明者不能借此批次自动重新准备派发。

`previewToken` 是 SHA-256 状态绑定，包含操作者、选择顺序、名单修订、来源、报名、名额修订和内容摘要，不是授权凭据。准备时重新计算并验证；状态改变返回 409，必须重新预检。无需进程内 Map、额外 token 储存或新秘密。

每人复用现有 `issueInvitation` 的稳定 manual ID；新准备的 `prepare_invitation` 审计附严格 `b_<SHA256>` batchId。旧审计没有该字段仍可读取。重复准备不新增邀请或审计，也不发信。保存逐人独立，不承诺全批原子事务；名单／审核／名额与邀请分别位于独立 journal，写入前再次核对，无法声称跨日志原子快照。

未知写入 ACK、修订冲突或权限丢失后停止后续写入；未尝试对象返回 `failed/BATCH_NOT_ATTEMPTED`。已确认成功的对象保留。未知者返回 `unknown`，不得自动重送；工作人员明确重新预检后可从既有稳定 ledger 回读已提交的准备。已知单人错误返回固定码，可继续其他对象，不回显底层错误或原始个人答案。

## 名额依赖

`createIntentInvitationService` 接受 `getAdmissionStatus(registrationId)`，默认绑定同一真实 registrationService 的方法。结果必须含已知 `status` 和整数 `revision`；只有 `confirmed` 可准备邀请或明确登记人工发送。`waitlisted`／`withdrawn` 拒绝；缺方法、损坏结果和储存失败均关闭操作，不能因旧转换 receipt 缺字段而默认为正式名额。既有单人邀请和人工发出同样核对该状态；审核 guard 继续独立执行。

## 浏览器 ZIP

`src/lib/invitation-batch.mjs` 导出 `previewBatchInvitations` 和 `prepareBatchInvitations`。调用者提供返回已解析 JSON 的 `request(path,options)`，并在展示预检、明确确认后提供 `renderInvitation(invitation)`；该 callback 使用既有真实画布 renderer，返回 PNG Blob。模块只请求一次准备，不自动重试、下载、持久化或更改发送状态。

PNG 按选择顺序逐张生成，校验 PNG MIME 和签名。文件名清除路径／控制符，保留序号与稳定 ID，UTF-8 basename 有界，避免同名覆盖。ZIP 采用 dependency-free store／CRC32／UTF-8，最多 100 张 PNG 加两份私密结果文件，完整归档含 headers 不超过 64 MiB；在读取 Blob bytes 前核对容量。64 MiB 是归档上限，不是浏览器峰值内存承诺。超限停止后续 PNG 渲染，单张 renderer 失败在清单显示，已有成功图片仍可取得。

ZIP 包含 `results-private.json` 及公式转义的 `dispatch-checklist-private.csv`，记录每个人的准备／PNG 结果并留空实际派发栏；不纳入联系方式或原问卷答案。文件仅在当前工作人员浏览器创建，由页面提供本机下载并释放 object URL，不公开托管、不进入 Git、日志或 Actions artifacts。下载不等于已发出，provider_accepted 也不等于已送达；工作人员须逐人核对并在后台另行明确登记真实人工发送。

## 验证与发布

合成测试覆盖同意／拒绝／候补、来源和修订变化、角色、缺失名额查询、明确准备、重建重放、逐人审计、部分失败与未知 ACK 停止、精确 HTTP 字段、CRC／ZIP 结构、UTF-8／恶意文件名、容量、顺序 PNG 和单张失败。实际联系人、私有 OSS、邀请发送不在这些测试中执行。主集成仍需完整测试、来源扫描、构建／候选包检查和真实受控发布验收；新增 `functions/intent-invitations/batch.mjs` 必须进入生产源码白名单。

本批本机验证：11 项批量后端、11 项 ZIP／客户端、14 项既有意向邀请回归，共 **36 项通过，零失败／跳过**；280 文件源码扫描与 diff 检查通过。另以 Python 标准 zipfile 对合成 UTF-8 ZIP 独立回读／CRC 验证。完整集成构建及真实受控云端结果待主分支记录。
