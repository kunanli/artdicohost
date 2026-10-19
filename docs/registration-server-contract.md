# 正式报名服务端契约准备

日期：2026-10-19（Asia/Taipei）。本阶段提供无 I/O 的配置 / 资料校验和未挂载的 HTTP 适配函数，供后续独立报名 API 使用。它不启动 HTTP 服务、不写 OSS、不发送邮件、不生成报名编号，也没有接入公开表单。网站仍为明确标识的报名预览，39 笔真实联系人保留本机。

## 模块与受理边界

- `functions/registration-api/policy.mjs`：`validateRegistrationPolicy(config, {now})` 检查服务器配置及报名时间窗口。
- `functions/registration-api/validation.mjs`：`validateRegistrationSubmission(payload, {policy, now})` 重新检查配置和完整请求，返回白名单业务资料与服务端生成的同意时间。
- 两个函数仅返回 `{valid, errors, value?}`。无效结果不返回资料；`valid:true` 只表示通过校验，不能显示「报名成功」或作为正式受理凭证。只有后续确认私有持久化成功的接口才可返回正式结果。
- `functions/registration-api/handler.mjs`：独立 HTTP 请求 / 回应适配函数；没有可信提交服务时拒绝处理，具体边界见下文。

服务器配置由受控服务端提供，不能从请求正文取得。完整配置只表示语法及约定字段满足要求，不证明所填资料已经核实、隐私文字已核定、云权限正确、限流可用或数据已保存。本阶段不会读取环境凭据或创建资源。

## 配置契约

以下均为合成示例，不能直接作为正式隐私说明或生产开放配置：

```js
const policy = {
  enabled: true,
  eventId: 'ggj-cn-2026',
  opensAt: '2026-10-20T00:00:00+08:00',
  closesAt: '2026-12-04T18:00:00+08:00',
  privacy: {
    version: 'synthetic-notice-v1',
    processor: '合成测试处理者',
    contactEmail: 'privacy@example.invalid',
    purpose: '合成测试的活动报名及联络',
    storageRegion: '合成测试存储地区',
    retention: '合成测试保留规则',
    rightsRequest: '通过合成测试邮箱申请查阅、更正、撤回及删除',
    sharing: '合成测试不对外分享',
  },
};
```

没有默认活动开关、开放 / 截止时间、正式隐私版本或处理者资料。未启用、缺项、错误时间、窗口未开放或已截止时拒绝校验。`opensAt` 为包含边界，`closesAt` 为不包含边界。时间必须是含 `Z` 或明确时差的真实 ISO 日期时间；不接受依赖机器时区的字符串。调用方必须提供受控的 `now`（带时差 ISO 时间或安全整数 epoch 毫秒），不能信任客户端时间。包含 `demo`、`frontend` 或 `mock` 标记的隐私版本不得用于正式契约。

## 请求契约

未来 `POST /api/registrations` 的候选正文如下；本阶段尚未实现该路由：

```js
const payload = {
  eventId: 'ggj-cn-2026',
  fields: {
    name: '合成来宾',
    city: '合成城市',
    organization: '合成团队',
    position: '合成角色',
    email: 'guest@example.invalid',
    categories: ['industry'],
    participationInterests: ['attend'],
    background: '仅用于合成测试。',
    attendance: 'expected',
    accommodationChoice: 'not_needed',
    cooperationInterest: 'none',
  },
  consent: {accepted: true, version: policy.privacy.version},
};
```

业务字段沿用现有身份、参与方式、长度及条件分支元数据，但正式验证独立执行，不调用演示的规范化或校验函数。字符串、数组、布尔值与数字须按原始 JSON 类型正确提供；混入非法成员的多选数组不会被静默当作有效选择。年份与参展人数须为 JSON 整数，前端适配阶段另行转换，不能把任意字符串当数字。

仅保留已知业务字段和当前激活的嵌套分支。无关的旧分支、未知字段、审核 / 管理 / 住宿批准字段均不进入结果；住宿晚数由服务端按选择生成 `0` 或 `1`。链接仅允许不含登录凭据的 `http/https`；邮件格式、枚举、Unicode 字数、链接数量及请求大小均受检查。请求上限约 128 KiB；HTTP 层后续还必须在 JSON 解析之前设置字节上限。

正式同意须在独立 `consent` 对象中主动提供布尔 `true` 及当前版本。演示的 `consentAccepted` 或 `frontend-demo-v1` 不构成正式同意。结果中的 `acceptedAt` 来自受控服务器时钟，客户端伪造的时间及内部状态被剔除；这份时间记录仍需与报名资料一并成功持久化后才能作为受理证据。

## 下一阶段必须接通的能力

后续 HTTP / FC 适配器须独立完成以下能力后才能开放真实报名：

1. 核定真实处理者、公开联系邮箱、目的、数据地区、保留 / 删除规则、分享范围及权利申请流程，并展示对应隐私版本。
2. 核定报名截止时间与容量；普通参会成功保存即可参加，讲者、赞助、展位和住宿独立确认，不自动授予 GGJ 资格或奖项。
3. 使用独立 FC 与独立私有 OSS，核对实际受支持运行时；仅公开桶 `oss:PutObject` 的现有 CI 身份不授予报名 API 权限。
4. 实现并验证请求体限制、可信来源 / CORS、跨实例限流、签名提交令牌、幂等与有条件创建。已成功的相同请求重试返回原结果，内容冲突不得覆盖；关闭 / 截止、撤回 / 删除及恢复窗口须按原计划验证。
5. 真实存储成功才返回不可连续猜测的编号；故障、超时或写入未知结果不能假成功。列表、导出、后台授权、审计、备份恢复及删除另行验收，不公开个人资料。

本阶段没有内存版「生产存储」、伪造 OSS 成功或可被配置值解锁的报名入口。不得把本机工作人员 API 直接暴露到公网。

## HTTP 适配层准备

`functions/registration-api/handler.mjs` 导出 `createRegistrationApi({allowedOrigins, submissionService})`，返回独立的 `Request → Promise<Response>` 处理函数。本模块不监听端口，不挂到本机内容服务、公开表单或 FC。`allowedOrigins` 是明确的 HTTPS 来源列表，逐个精确匹配，不接受通配、子域后缀或带路径的来源。没有可信提交服务时返回 `503`，没有生产默认实现。

适配层只接收 `/api/registrations` 的 `POST` 与相应 `OPTIONS`。请求须为 JSON，在解析前按实际串流限制 128 KiB，拒绝损坏 UTF-8、无效 JSON、错误来源、方法与路由。提交使用以下请求头：

| 请求头 | 格式及边界 |
| --- | --- |
| `Origin` | 与受控 HTTPS 来源完全一致 |
| `Content-Type` | `application/json`；可用 UTF-8 字符集 |
| `Idempotency-Key` | 32–128 个 base64url 字元；格式通过不证明随机强度 |
| `X-Registration-Token` | 三段 base64url，最长 4096 字元；此层只检格式，签名、事件绑定与有效期由可信服务核验 |

通过传输检查后调用 `submissionService.submit({payload, idempotencyKey, submissionToken, origin})`。这不是由客户端提供的函数，也不接受客户端提交的「已保存」字段。后续独立服务必须完成可信限流 / 令牌校验、既有提交查验、新申请字段和正式同意校验、条件创建及持久化确认；不能仅因为返回值符合格式就宣称生产能力已完成。

已成功持久化的同键同内容重试必须先核对原结果，即使当前已截止，也可返回原收据；只有新写入或尚未保存的补写才重新检查开放窗口及正式同意。适配层不提前调用包含时间窗口的校验器，避免遮断已成功的重试，也不以单进程 Map 实现生产幂等。

可信服务的结果为以下白名单之一：

| `outcome` | HTTP 行为 |
| --- | --- |
| `created` / `replayed` | 必须同时带 `receipt: {committed: true, eventId, referenceCode, committedAt}`；事件须匹配请求、编号及时间格式有效，分别返回 `201` / `200` |
| `invalid` | `422` 固定资料错误，不返回提交值或服务自带错误文字 |
| `conflict` / `closed` | `409` 内容冲突或报名关闭 |
| `forbidden` / `rate_limited` / `withdrawn` | 分别为 `403` / `429` / `410` |
| `unavailable`、未知、缺收据或抛错 | `503`，不显示报名成功 |

成功正文仅包含 `{status: 'registered', reference_code, groupInvite}`，不返回姓名、邮箱、存储键、堆栈或内部审核字段。所有结果使用 `Cache-Control: no-store`、`X-Content-Type-Options: nosniff`；CORS 仅响应已匹配的来源并设置 `Vary: Origin`，不开放跨域凭据。

收据是可信服务对「已确认保存」的约定，本 HTTP 层没有自行回读 OSS，也没有完成真实签名、跨实例限流、容量控制、幂等或私有存储验收。测试中的合成服务只为证明传输边界与失败行为，不能被配置为生产默认值。

## 报名成功后的微信群入口

用户指定「报名后提供微信群二维码」。活动报名状态的宣传文案依用户确认改为已开放；本站内建表单仍是明确标识的无传送预览，不能把演示完成当作真实报名。正式流程须先完成私有持久化，再返回成功收据与入群信息。

HTTP 适配器只在 `created/replayed` 的 committed 收据已核对后，读取可信服务当次结果的 `groupInvite`，不接受请求正文伪造。新增配置 `allowedGroupInviteOrigins` 为服务器控制的 HTTPS 精确来源白名单，`clock` 为读取当前服务器时间的函数；群码资料格式如下：

```js
groupInvite: {
  platform: 'wechat',
  qrImageUrl: 'https://受控图片来源/短效图片地址',
  expiresAt: '含时差的 ISO 到期时间',
}
```

仅投影上述三项。图片网址必须为允许来源的 HTTPS，不能包含帐号密码、fragment、空白、控制字元或反斜线；到期时间须晚于受控当前时间。来源配置、时钟、网址或有效期缺失 / 错误时返回 `groupInvite:null`，不撤销已经保存的报名，也不提示重新提交。截止后重放使用当前有效群码，不能以旧收据的提交时间判断群码是否过期。

真实群码待用户提供，不进入公开 `eventConfig`、Git 静态素材或演示完成页。将来图片服务须在登记成功后提供受限、短效图片访问，并核验实际 PNG / JPEG / WebP 内容；这一图片服务、保存及 FC 接入均未在本阶段实现，不能把 URL 白名单校验当成图片权限验证。

`RegistrationSuccess.astro` 是独立、初始隐藏的正式成功卡片。`registration-success.mjs` 只在未来传输层提供 `200/201`、`status:'registered'` 及有效编号后显示；当前 mock 不调用它。有效且未过期的群码才设置图片来源；缺失、过期或图片载入失败时保留报名编号，显示入群码暂时无法显示及无需重复报名，不承诺自动发送通知。所有说明以文字节点输出，预览不读取或请求真实群码。

## 验证与回退

`tests/registration-server-contract.test.mjs` 只使用合成配置及资料，覆盖配置拒绝、时间边界、正式同意、原始类型、条件分支、白名单、链接与长度等安全边界；不联网、不创建云资源、不处理真实名单。执行完整既有检查时也验证公开演示仍无传送或持久化。

`tests/registration-http.test.mjs` 直接传递标准 Request / Response，不启动公网服务。覆盖拒绝边界、超量串流、编码、固定错误和不明保存结果；成功路径在测试隔离目录完成合成资料实际写入与同步后才产生收据，重试不重复写入。此验证不替代 OSS 防覆盖、跨实例并发或 FC 联调。

本阶段模块未接入页面或运行中的 API，回退仅移除相应代码与文档，不涉及个人资料或云资源。后续生产适配器的回退与数据兼容须另行记录。
