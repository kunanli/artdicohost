# 正式报名服务与既有联系人登记

本模块必须使用受控服务端配置、共享 OSS 对象与原子追加日志。没有内存或本机生产回退，不因浏览器开关而开放收集。真实云端验收及路由启用由部署流程分别记录。

## 组合契约

```js
const service = createRegistrationService({
  objects,
  journalFor: prefix => createObjectJournal({objects, prefix}),
  policy, capacity: policy.capacity,
  tokenSecret: protectedSharedSecret,
  allowedOrigins: ['https://artdico.host'],
  clock: () => Date.now(),
  groupInviteProvider: optionalTrustedProvider,
  isWithdrawn: async id => { const {review} = await reviewStore.detail(id); return review.status === 'withdrawn' || review.deletionRequested !== null; },
});
const handle = createRegistrationApi({
  allowedOrigins: ['https://artdico.host'],
  submissionService: service,
  allowedGroupInviteOrigins: explicitlyAllowedHttpsOrigins,
  clock: () => Date.now(),
});
```

运行层读取 `ARTDICO_REGISTRATION_POLICY_JSON`、`ARTDICO_REGISTRATION_CAPACITY`、独立的 `ARTDICO_REGISTRATION_TOKEN_SECRET` 及精确字符串开关 `ARTDICO_REGISTRATION_ENABLED`。容量值须与已核定 policy.capacity 一致，范围 1–1000；本站拟使用已核定 300。共享 Secret 至少 32 UTF-8 字节，由受控配置程序生成／保留，不复用密码、摘要或 FC 临时凭证。缺配置保持关闭；上面的变量说明不证明现场已配置或已验收。

公开接口：

| 路径 | 方法 | 结果 |
| --- | --- | --- |
| `/api/registration/config` | GET、OPTIONS | 开放时返回 eventId、开放／截止时间、容量与完整公开隐私告知；关闭时只有 enabled:false 及固定原因 |
| `/api/registration/token` | POST、OPTIONS | JSON `{eventId,idempotencyKey}`；返回 submissionToken、expiresAt、eventId |
| `/api/registrations` | POST、OPTIONS | 既有完整正式字段／隐私同意契约；请求头 Idempotency-Key、X-Registration-Token |

所有入口要求准确允许的 HTTPS Origin，无跨域凭据。Token 为十分钟 HMAC，绑定活动、来源及同一幂等键。保存失败后的明确重试须保留原正文和幂等键；服务先找已确认记录，所以截止或 Token 到期不遮断已保存收据。Token 获取在关闭后仅允许已有随机幂等键，不为新键重新开放报名。

限流采用**全部访客共用**的固定十五分钟额度：Token 120 次、新提交 60 次；不是按可信 IP 限流，也不是 CAPTCHA 或完整防滥用。额度存共享日志，未知写入结果拒绝继续，429 给出 Retry-After。成功收据重放不再消耗提交额度。

## 持久化、容量与重试

所有路径位于现有私有 `cms/v1/registrations/<eventId>/`，不要求扩充现有 `cms/v1/*` 的 GetObject／PutObject 权限。

- `records/<sha256>.json`：经过字段白名单的不可变报名资料，含服务端时间、同意和来源。
- `index/`：共享日志，索引只保存随机编号、幂等键／正文／记录 hash 和提交时间。一次 CAS 追加是正式受理及容量分配的唯一提交点。
- `limits/tokens/<window>/`、`limits/submissions/<window>/`：独立共享固定窗口额度。

同键同内容重放原收据，不重复占位；同键不同内容 409。不同键竞争最后名额时仅一个原子提交成功。慢速记录写入后、索引提交前再次检查窗口及 Token 有效期。只有明确 409 CAS 拒绝可在有界次数内重读；丢失 ACK／未知失败不盲重送或回成功，调用方以原键重试后可回读真正已提交的记录。记录缺失、hash 错误或日志损坏均失败，不能重置为空。容量是已受理记录上限，撤回不自动释放名额；若后续需要释放必须独立设计可审计的原子策略。

生产组合必须注入审核服务的 `isWithdrawn(id)`。已撤回或待删除的记录返回 withdrawn，不再重放公开收据／群码；审核读取失败或非布尔结果保持 unavailable。创建前不查询尚不存在的审核记录；已提交后才读取并决定响应。测试与未组合模块可省略此接口，但不能据此宣称生产撤回边界已接通。

`service.repository.list()` 返回 `{registrations,revision}`，每项含 id、referenceCode、eventId、submittedAt、fields、consent、provenance，供已授权审核服务注入。不能挂成匿名列表。列表最多八个并行对象读取，保留索引顺序且逐一验证 hash；任何一条损坏都不返回部分名单。整次读取默认十二秒期限，可传入更短的 timeoutMs 或 AbortSignal；停止后不继续排队，至多八个已发出的对象请求按底层客户端期限结束。每次重新读取，无跨请求个人资料缓存；超过一千条或不合法的恢复索引在启动对象请求前失败。审核、内部备注及通知状态使用独立日志，不覆盖原申请。

## 工作人员从既有联系人登记

`service.submitStaffRegistration({sourceContactId,actor,input:{fields,permissionReference}})` 返回 created／replayed／invalid／conflict／closed／forbidden／unavailable 与可选 receipt。actor 必须来自可信会话且具有 reviewer 或 superadmin；外层同时核对联系人访问权、来源确实存在及原有授权。服务函数不是公开接口，也不能接受浏览器自行声明 actor。

此途径要求实际姓名及邮箱或微信至少一个。其他已知字段逐一校验，缺项保留缺失，不虚构机构、城市、出席、住宿或申请人回复。记录来源为 `{kind:'staff_assisted',sourceContactId,actorId,recordedAt,permissionReference}`；consent 明确为 `{accepted:false,version:null,acceptedAt:null}`，绝不假称申请人新勾选隐私说明。直接填表则 provenance.kind 为 public，保留正式同意版本及服务器时间。

同一活动／sourceContactId 只产生一份登记，所有途径共同计算容量。重复转换不会重复占位；输入改变时冲突，留给明确修正流程。`service.getStaffRegistrationBySource({sourceContactId,actor})` 可在重启后取回 found／not_found 与最小收据，不需伪造重新提交。receipt 含 committed、eventId、registrationId、referenceCode、committedAt。

## 运维与验证

匿名成功正文只返回随机 reference_code 与当次可信、未过期的入群图片资料；群码缺失不撤销已保存报名。此模块不读取真实群码、不主动发信、不签发 Wallet，也不自行删除记录。未知 ACK 或 CAS 失败可能留下未引用的私有 blob；现有在线角色无 Delete／List，维护身份、备份／恢复、删除与容量轮替另行交付，不能宣称自动清理。

合成测试使用独立 OSS HTTP 协议 fixture 与真实对象客户端／journal，覆盖两个独立客户端的竞争、最后名额、截止重放、Token 绑定、共享额度、未知 ACK、损坏记录、部分联系人资料和 HTTP 最小公开投影。该测试不是两台真实 FC 实例或真实 OSS 权限验收。

```sh
node --test tests/registration-service.test.mjs tests/registration-http.test.mjs tests/registration-server-contract.test.mjs
```

新增服务文件必须全部进入独立云端包白名单；公开静态包只包含浏览器传输代码，不含受控配置、Token Secret、报名或联系人资料。回退先关闭报名开关，再恢复已验收代码和配置，保留所有私有日志，不用旧索引覆盖新记录。

## 受限微信群码

`createGroupInviteService({objects,journalFor,eventId,tokenSecret,apiOrigin,clock,isWithdrawn})` 使用同一独立报名 Secret 派生用途专属的 HMAC key；报名 Token 不能冒充图片链接。群码保存在独立 `cms/v1/group-invites/<eventId>/images/<sha256>.<ext>` 与 `state/` 日志，不进入公开构建、活动配置或公开 OSS。

`service.forReceipt({receipt,origin})` 只供已核对持久收据的可信报名组合调用，返回当次 `{platform:'wechat',qrImageUrl,expiresAt}` 或 null。URL 绑定活动、报名随机编号、当前群码修订／image hash 和十分钟以内有效期；并受群码实际期限约束。当前 FC 域名已有 `/api/admin/*` 路由，因此默认图片 URL 使用精确别名 `/api/admin/registration/group-invite/<token>`；运行层可映射到标准 `/api/registration/group-invite/<token>`，两种精确路径均由独立图片 handler 验签，不走一般管理员读接口。除此之外没有匿名 current 群码入口。

`createGroupInviteApi({service,auth,apiOrigin,publicOrigins})` 提供：

| 路径 | 方法 | 边界 |
| --- | --- | --- |
| `/api/admin/group-invite` | GET | 登录且 superadmin，返回修订、是否配置／到期、大小、MIME、更新时间与私有预览路径 |
| `/api/admin/group-invite` | POST | 同一角色、准确后台 Origin 与 CSRF；JSON expectedRevision、contentType、dataBase64、expiresAt，替换当前图片 |
| `/api/admin/group-invite` | PUT | 同样授权；JSON expectedRevision、enabled:false，停用当前图片 |
| `/api/admin/group-invite/image` | GET、HEAD | 同一管理员会话才可预览，不签发匿名常驻 URL |
| `/api/registration/group-invite/<token>` 或其精确别名 | GET、HEAD | 有效签名、活动／修订／图片／时间一致且报名未撤回／待删除，才返回图片；无需登录 Cookie |

上传上限 512 KiB、2048×2048，只接受经实际结构／尺寸／压缩边界校验的静态 PNG、JPEG 或 WebP，去除非渲染元数据。这里不扫码加入群，也不验证微信服务端是否提前使二维码失效。到期时间必须是明确偏移的完整 ISO 时间，晚于当前且不超过七天；单独「有效至某日期」不能自动编造具体时刻。修改期限须重新明确上传，停用／替换立即令旧修订链接拒绝，不能用提醒自动延长旧码。

每次图片读取都核验当前日志、图片 hash、期限及撤回状态，读取后再次核对修订。审核／存储失败保持不可用，不输出 provider 错误。所有图片响应 private,no-store、nosniff、no-referrer。已保存报名在群码不可用时仍保留成功编号；未知上传 ACK 只允许重新读取现况，不自动再写。历史私有图片与日志未自动删除，仍纳入维护／删除方案。
