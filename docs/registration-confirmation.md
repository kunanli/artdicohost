# 报名确认页与自动确认信

## 2026-11-01 具名寄送与原操作核对（UX2）

UX2 的产品契约、完整回归、准确产物及编译后浏览器已核对，PR／main 与正式发布仍以 [本轮记录](redesign/ux-workflow-release.md) 为准。沿用同一通知服务、journal、正式信身份和原发送引擎；不迁移旧记录、不补寄历史。下方 P4 为既有分型通知基准，10 月初版接口仅供历史参考。

### 新增只读管理接口

两项入口先验证工作人员会话与完整活动管理权限（superadmin，或同时具备 outreach／reviewer）。带 Origin 时必须为准确后台来源；POST 必须带该 Origin、CSRF、UTF-8 JSON 与不超过 16 KiB 的正文。它们不发送邮件，也不写通知或业务 journal。

| 接口 | 请求与返回 |
| --- | --- |
| `POST /api/admin/registration-confirmation/preview` | 可选 `{registrationIds,cursor}`，明确 ID 为 1–100 个唯一登记 ID。返回 `{revision,kind:'registration',sourceRevision,rows,total,nextCursor,message}`；`revision` 是通知修订，`sourceRevision` 是绑定正式种类、来源与选取范围的 64 字符摘要。每页最多 100 人，不返回邮箱或私人链接 |
| `GET /api/admin/registration-confirmation/operation/<operationId>` | 仅原 actor 的 `dispatch` 操作可读；其他人的操作、设置或提醒操作不能冒充正式寄送。返回 `{outcome:'replayed',revision,operationId,status,results,kind:'registration',checkedAt}`。`checkedAt` 是本次服务器核对时间，不是送达时间；查询不读取 provider／readiness |

预览的 `rows[]` 为 `{registrationId,name,organization,status,eligible,reason,retryRejected}`，状态保留 `not_sent`、`provider_accepted`、`rejected`、`unknown`。资格由当前主身份、名额、许可、地址、开关和活动事实核对；正式 `registration`／`promotion` 历史一起判断，申请回执或提醒不占用正式信身份。正式预览不套用提醒的签到前时间窗口。`message` 只有活动事实及 `[私人参会页链接]` 等占位内容，不生成实际 capability。

正式分页游标绑定种类、来源／选取范围及通知修订；变化时返回 409，先重读预览再由使用者选择。原提醒游标格式保持相容。新具名 UI 仍调用原 `POST /dispatch` 的 `{expectedRevision,operationId,registrationIds,retryRejected?}`，单人仍调用原 `POST /send/<registrationId>` 的 `{expectedRevision,operationId,retryRejected?}`；字段、requestHash 与持久身份不改。一旦保存原正文，不再重排字段或 ID 顺序。

### 原操作恢复与明确拒绝

新单人／具名批次先取得原 JSON bytes 的本机持久回执，再作唯一首次 POST。重新整理或恢复后的核对只 GET 原 operationId；旧 parsed pending 保留原件，只衍生已保存的原操作信息，不重建原 JSON 后再 POST。完成结果须通过原 operationId、种类、完整 ID／状态的校验，不能把部分或无关回执当成功；started 尚无 notice 时仍对整份原 ID 保守显示 unknown。

仅有一项「已证明未开始」例外：全新操作的原正文只送过这一次、从未恢复或进入 unknown，且后端在开始业务写入前明确返回 400／403／404／409，客户端可清除此笔本机 pending 并重读当前来源。使用者须重新选人后才建立新操作；它不是改写／重 POST 原正文、删除 journal 或通用手动解锁。预览后发生正常修订竞态的 409 不需要用登出来解除。

查原操作时的任何 4xx（包括 404／401）、已恢复或先前 unknown 的请求、503／逾时及无法证明的回应均保留原记录与锁。401 先清除私密画面，重新授权后只在同 actor／roles／event／person 范围恢复；明确登出仍沿用 `clearActor` 全清政策，不承诺恢复主动清除的本机正文。

legacy 邀约 unknown 继续核对原邀请历史；自动正式信可能只有 notice 而没有 operationId，此时只读既有 delivery／history，不能用 notice ID 猜原操作。核对一类通知不会解除另一类未知结果。界面用「邮件服务已接收」表示 provider 接受，始终不宣称送达或本人已答应出席。

`staffHistory` 对 started 但尚无 notice 的窗口可返回 `unresolvedConfirmations:true`，只补保守摘要，不伪造 notice、时间轴或历史数量；原未知 notice 仍由真实历史表达。单人 communications 投影合并该摘要，目录则仅在有未完成正式批次时额外只读一次报名 index，按保存的别名生成有界状态摘要。个人页的上次核对时间来自已验证原操作 GET 的服务器 `checkedAt`，绑定当前人员，不能把本机时间当送达证明或带到下一人。

## 2026-11-01 分型通知流程（P4 既有基准）

沿用已配置的 EmailJS 服务、中性「报名状态通知」模板与八个原参数，不重新配置账号或 Apple 签章。下方初版「没有凭据」「工作人员不自动发信」等状态只作历史参考；当前证据见 [P4 记录](redesign/p4-release.md)。

| 种类 | 触发与身份 |
| --- | --- |
| `application_received` | 只对真正新建、已持久化的公开待审申请尝试一次回执；不是正式邀请，没有群码或 Wallet。重放、读取、导入、整合及部署不补发 |
| `registration`／`promotion` | 核准、转正及新确认受托登记沿用原名额提交及正式信去重；原 `email` 和人员页历史仍只代表正式信 |
| `pre_event_reminder` | 管理者先看姓名／状态／内容，勾选后明确发送，最多 100 人一批，报到开始前可用。不建排程，邮件不附固定群码 |

「启用报名通知」沿用原持久开关，暂停会阻止尚未开始的三类请求；不撤销名额或擦除历史。服务商接受不是送达。`reserved` 与未知 ACK 对外为待核对；已保存别名中的同种接受／未知／预留阻止新寄，姓名或共享邮箱不自动构成人员关联。

新增管理接口先核验完整活动管理权限；POST 还要求准确 Origin、CSRF 与 16 KiB 正文：

| 接口 | 用途 |
| --- | --- |
| `POST /api/admin/registration-confirmation/reminder-preview` | 可选 `{registrationIds,cursor}`；默认分页返回当前主身份姓名、机构、状态、理由、最多 100 人及内容占位预览，不返回邮箱或私人链接 |
| `POST /api/admin/registration-confirmation/reminder-dispatch` | `{expectedRevision,operationId,registrationIds,retryRejected?}`；固定提醒种类，逐人重新核对名额、许可、地址、开关、活动事实及期限 |
| `GET /api/admin/registration-confirmation/reminder-operation/<operationId>` | 只读核对原操作，不创建预留或重寄。未知保留原正文与锁，未尝试者才另行选择 |

私人页可选 `notifications.applicationReceived.status`、`notifications.preEventReminder.status`，旧响应继续可读；坏子项只显示该种结果待核对，不抹除名额、正式信或另一类历史。读取不调用 provider、不写日志。

原八个模板参数保持 `to_name`、`to_email`、`event_title`、`event_date`、`event_time`、`event_venue`、`reference_code`、`invitation_text`。实际 EmailJS Subject 保持现有中性文字，不冒称后端 subject 已改外部模板。仅传收件所需姓名、邮箱、活动事实、编号与私人入口，不发送原问卷、住宿或内部备注。表单补充必要用途与服务商说明；原政策版本、环境值、不可变同意不迁移，旧 pending 正文仍可恢复。

同一私有 journal 仍限 2000 身份、4000 稽核、1 MiB 与 100 人批次。储存／容量故障不撤销已保存申请。预览绑定来源及通知修订，来源变化先重读；真正 fetch 前再次核对，仍不宣称跨报名、联系人、通知日志与外部服务原子提交。

回退须认识 P4 新种类与提醒操作，保留未知记录及原身份，不部署只接受旧两种通知的写入者。备份、隔离恢复和受控删除见 [维护流程](maintenance-backup.md)。合成验收与真实收件／SPF／DKIM／DMARC、微信、iPhone 结果分开记录。

## 2026-10-21 初版接口与设计记录

2026-10-21。此模块为公开报名提供可重开的私人确认页，以及报名已持久化后的单次确认通知。原始报名／来源／本人同意保持不可变；页面、通知和 Wallet 都读取当前名额及撤回状态，不用历史成功回执替代当前资格。

## 运行组合

```js
const provider = createConfirmationEmailProvider({
  env, fetchFn,
  // 仅在已有小型受控 bundle locator 时提供，由运行时验证解密。
  loadConfiguration: optionalTrustedConfigurationLoader,
});
const service = createRegistrationConfirmationService({
  registrationService,
  journalFor: prefix => createObjectJournal({objects, prefix}),
  tokenSecret: protectedRegistrationSecret,
  emailProvider: provider,
  walletReadiness: () => walletService.readiness(),
  groupInviteProvider: input => groupService.forReceipt(input),
  clock: () => Date.now(),
});
const handle = createRegistrationConfirmationApi({service, auth});
```

公开报名服务只在已证明保存、当前名额已核对的 public 回执后调用 `service.forSavedReceipt({receipt,notify:true})`。返回 `{receiptToken,confirmationUrl,expiresAt,email:{status}}`，作为原成功正文的 `confirmation` 子对象。可选装饰失败不能撤销已保存报名；工作人员转换及后台逐人登记不自动发信。未配置邮件时装饰不读取／写入额外对象，仍能返回私人确认链接。

确认页为 `https://artdico.host/registration/confirmation/#r=<receiptToken>`。capability 只在 URL fragment 与明确 POST JSON 中使用，不放姓名、邮箱或 query 参数。签名由独立 HKDF 用途 `artdico-registration-confirmation-v1` 派生，不能用报名提交令牌或 Wallet 条码代替。编号本身不能授权读取。期限为活动日结束后 90 天，并限制到期前最多 180 天签发；链接到期不会删除报名、参会记录或工作人员审计。轮替主 Secret 会使旧链接失效，须按受控恢复步骤处理。

`authorize({receiptToken})` 和可信内部 `authorizedRegistration(registrationId)` 返回最小记录：registrationId／referenceCode、当前 admissionStatus／kind／revision、姓名／机构、事件事实、submittedAt、hasEmail；不返回邮箱、原始答案或 private 来源。Wallet 只可使用 confirmed。撤回／待删除时姓名与机构置空，确认页可显示取消状态，无群码或 Wallet；审核或不可变记录核对失败则返回固定不可用错误。

## API

| 接口 | 请求与结果 |
| --- | --- |
| `POST /api/registration/confirmation` 或 `/api/admin/registration/confirmation` | `{receiptToken}`；准确公开 Origin，无工作人员认证。返回 event、referenceCode、submittedAt、attendee、admission、email、wallet、可选当前 groupInvite。只读，不发送邮件。别名复用现有 FC 路由，不需改 trigger。 |
| `GET /api/admin/registration-confirmation/settings` | 既有 superadmin 会话；返回 revision、automaticEnabled、邮件 readiness／缺少的固定配置名、通知计数与安全 Wallet 设置摘要。无密钥或证书值。 |
| `PUT /api/admin/registration-confirmation/settings` | `{expectedRevision,operationId,enabled}`；superadmin、准确后台 Origin、CSRF。返回 outcome 加完整设置状态；同 operationId／相同正文只读重放。 |
| `POST /api/admin/registration-confirmation/dispatch` | `{expectedRevision,operationId,registrationIds,retryRejected?:false}`；相同后台权限。最多 100 个独立 public 报名，返回逐人结果及 revision／operationId。不会把意向转换记录当作公开本人报名自动派发。 |

公开结果中 event 的 id、title、date、time、venue、timezone、checkIn 全为字符串；当前采用核定的 `eventConfig`。admission 为 `{status:'confirmed'|'waitlisted'|'withdrawn',kind:'attendee'|'crew',revision}`。attendee 为 `{name,organization}`；撤回时为空字符串。Wallet 公开只返回 ready／reason，后台另可显示缺项名、证书到期日及 deviceTestRequired。所有回应为 private,no-store、nosniff、no-referrer；公开 CORS 不允许凭据。JSON 上限 16 KiB、读取期限十秒，未知字段／来源／编码被拒绝。

## 邮件设置

自动确认信与既有「工作人员邀请函」分开。确认信使用 `ARTDICO_CONFIRMATION_EMAIL_ENABLED` 和独立 `EMAILJS_CONFIRMATION_TEMPLATE_ID`；服务、公开／私有 key、寄件邮箱及名称沿用明确受控配置。生产 FC 环境总字节受限，优先将以下六项放入运行时受控的加密私有配置 bundle，仅在环境保存小型 locator：

- `EMAILJS_SERVICE_ID`
- `EMAILJS_CONFIRMATION_TEMPLATE_ID`
- `EMAILJS_PUBLIC_KEY`
- `EMAILJS_PRIVATE_KEY`
- `EMAIL_FROM_ADDRESS`
- `EMAIL_FROM_NAME`

配置 loader 必须由运行时注入，只在通知开关启用时读取既定私有对象，验证 digest／AES-GCM 后返回上述白名单。bundle 不存在、损坏、解密失败或字段错误时保持未就绪；不尝试外部请求，不把原始错误回传。小型直接环境配置仍可用于受控本机／测试，不因聊天提供凭据或猜测设置值而开启。

新通知日志的业务设置初始 `enabled:true`，另受 FC 的明确寄件开关控制；当前没有凭证，FC 开关保持 false。首次配置须先在后台保存停用，再由受控运维打开 FC 寄件开关、核对 readiness，最后明确开启后台自动通知。否则单独开启 FC 开关便可能使之后的新公开报名立即进入自动通知。操作顺序见[受控配置](delivery-configuration.md)。

在既有 EmailJS 服务建立**独立确认模板**。收件人设为 `{{to_email}}`，寄件人使用已核验的服务及受控寄件地址，模板显示 `{{to_name}}`、`{{event_title}}`、`{{event_date}}`、`{{event_time}}`、`{{event_venue}}`、`{{reference_code}}`，正文使用 `{{invitation_text}}`。最后一个变量复用既有已审计传输的正文槽，确认模板收到的是本模块生成的确认／候补文字及私人链接，不是工作人员邀请内容。寄件地址目前限定既有 `artdico.co` 域；服务端请求须按 EmailJS 控制台要求启用，不把 key 放进页面。

启用寄件服务时，隐私说明应准确列明该服务用于必要的报名通知：只传递收件邮箱、称呼、活动事实、登记编号和私人确认链接，不传递问卷原件、住宿、内部备注或完整名单。确认链接可读取该人的最小确认资料，模板和服务端日志都不应公开该链接。

首次受控设置后先查看后台 readiness 和缺项，不用真实 39 行或真实收件人作自动测试。用户另行提供实际测试地址并授权后才能执行实寄验收；HTTP 200／`OK` 只记服务商接受，不是送达或收件人打开证明。Apple Developer／票券凭证目前未具备，Wallet 设置独立保持未就绪，不影响确认页及打印。

## 通知状态、幂等与修复

- 已持久化的 public 报名，配置完整时自动准备「参会名额已确认」或「候补登记已保存」，只对原记录的邮箱发送。无邮箱记不适用；未配置、自动通知停用、待处理、服务商接受、明确拒绝及结果未知分别显示。
- 当前能力读取永不发信。公开重放读取同一通知，不重占名额；后台显式补发仅处理尚未尝试或已明确拒绝的 public 报名。同意／来源不被重写，工作人员受托登记需要原有邀请流程。
- 每封通知先在同一 CAS journal 预留，再执行唯一一次 provider 请求。外部请求前再次核对当前资格及持久自动通知开关；暂停后不继续发出新请求。预留 ACK 不明时不会请求 provider；provider 或结果 ACK 不明时不会盲重发。持久 `reserved` 对外视为 unknown。明确未发送或 4xx 拒绝可由管理员勾选 retryRejected 后再次尝试，最多五次；unknown 永远不能以普通重试再次发送。
- 后台批次先写入 operationId／正文 hash，再逐人执行。相同 operationId 改正文拒绝。未知批次启动回执重放会覆盖所有选定 ID 并逐一返回 unknown，不启动新的发送。批次期限从进入操作开始计算，包含配置、OSS 读取及预留；预留前与外部请求前都检查同一期限，异步配置加载后传输层仍会再次检查。遇到未知结果、存储问题或期限，后续条目标明 not_attempted；预留后已超时的已知未发送记录保留为 rejected，公开保存结果显示 pending。不能当作已处理或全部送达。工厂默认二十秒，生产运行时采用五秒并使用四秒 provider 超时。
- `notifyPromoted({registrationIds,timeoutMs?})` 是可信运行时可选钩子，timeoutMs 可缩小至同一公开请求的剩余通知预算。确认页读取不调用它；未配置时不会自动回填旧名单。已存在候补通知时，转正使用独立 promotion 身份，保留一次候补加一次确认。若转正在原通知钩子运行前发生，intake／promotion 在同一 CAS 内选择唯一 confirmed 身份；并发、逆序和未知 ACK 均不能产生第二封相同确认信。显式 rejected 重试只重用该身份。
- 结果不明时先核对服务商及已有通知审计，不更换 operationId 盲发。后台刷新不会把旧 unknown 改成未发送。必要的人工核对与后续安全派发须由已有管理员按实际证据处理，不能伪造 provider 接受或送达。

## 存储、备份与回退

通知 journal 位于 `cms/v1/registration-confirmations/<eventId>`，保持同一私有范围，不新增 IAM。仅存随机报名 ID、通知类型、名额状态／修订、操作人及时间／结果；不存收件地址、姓名、邮件正文、capability 或私钥。每次读取从最多 4000 条 audit 重建设置、通知与批次操作，验证当前快照一致性；最多 2000 个通知身份。损坏或超过既有 1 MiB journal 上限时失败关闭，不重置或假成功。

运行时维护清单必须包含该 journal 和另行受控的加密配置对象；备份／隔离恢复不激活服务、不恢复会话或重发邮件。应用回退保留这些事实，先关闭通知再用兼容版本修复，不能清空预留记录以「重试」。轮替配置遵循运行时 bundle 指南，不在公开 artifact 放凭据。

## 验证

30 项合成回归覆盖 capability 用途与期限、原始记录与撤回状态、未配置零 I/O、独立实例只发一次、跨 intake／promotion 的顺序／并发／未知 ACK 去重、预留／结果 ACK 丢失、预留后的停用竞态、未知 provider 输出、候补及转正、无邮箱／受托来源、CAS 设置与批次重放、同一 canonical 身份明确拒绝重试、包含慢读取及配置加载的批次期限、伪造快照、配置隔离，以及 HTTP Origin／角色／CSRF／大小／字段／错误隐私。只使用合成对象协议与注入 provider；不是实际投递、真实名单迁移或 Apple 设备验收。

```sh
node --test --test-isolation=none tests/registration-confirmation.test.mjs tests/registration-confirmation-http.test.mjs
```
