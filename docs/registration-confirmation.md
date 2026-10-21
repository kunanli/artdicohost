# 报名确认页与自动确认信

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

在既有 EmailJS 服务建立**独立确认模板**。收件人设为 `{{to_email}}`，寄件人使用已核验的服务及受控寄件地址，模板显示 `{{to_name}}`、`{{event_title}}`、`{{event_date}}`、`{{event_time}}`、`{{event_venue}}`、`{{reference_code}}`，正文使用 `{{invitation_text}}`。最后一个变量复用既有已审计传输的正文槽，确认模板收到的是本模块生成的确认／候补文字及私人链接，不是工作人员邀请内容。寄件地址目前限定既有 `artdico.co` 域；服务端请求须按 EmailJS 控制台要求启用，不把 key 放进页面。

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
