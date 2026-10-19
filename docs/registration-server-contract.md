# 正式报名服务端契约准备

日期：2026-10-19（Asia/Taipei）。本阶段是无 I/O 的配置与资料校验模块，供后续独立报名 API 使用。它不提供 HTTP 路由，不写 OSS，不发送邮件，不生成报名编号，也没有接入公开表单。网站仍为明确标识的报名预览，39 笔真实联系人保留本机。

## 模块与受理边界

- `functions/registration-api/policy.mjs`：`validateRegistrationPolicy(config, {now})` 检查服务器配置及报名时间窗口。
- `functions/registration-api/validation.mjs`：`validateRegistrationSubmission(payload, {policy, now})` 重新检查配置和完整请求，返回白名单业务资料与服务端生成的同意时间。
- 两个函数仅返回 `{valid, errors, value?}`。无效结果不返回资料；`valid:true` 只表示通过校验，不能显示「报名成功」或作为正式受理凭证。只有后续确认私有持久化成功的接口才可返回正式结果。

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

## 验证与回退

`tests/registration-server-contract.test.mjs` 只使用合成配置及资料，覆盖配置拒绝、时间边界、正式同意、原始类型、条件分支、白名单、链接与长度等安全边界；不联网、不创建云资源、不处理真实名单。执行完整既有检查时也验证公开演示仍无传送或持久化。

本阶段模块未接入页面或运行中的 API，回退仅移除相应代码与文档，不涉及个人资料或云资源。后续生产适配器的回退与数据兼容须另行记录。
