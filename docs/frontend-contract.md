# 前端体验版契约

本阶段将已选「创作聚场」视觉实现为桌面 / 手机页面。表单是明确标识的本地演示，**没有真实报名接口、OSS 持久化、管理员后台或正式受理编号**。不得将通过前端校验等同于提交成功。

2026-10-18 最新产品决策见 [产品更新](product-update-2026-10-18.md)：普通活动报名在正式资料成功保存后即可参加，无普通参会邀请审核。讲者主题提案、赞助合作、展位及住宿分别处理；当前仍是不会提交资料的演示。原 10 份规范与原实施计划保留为基线，其冲突条款由该更新明确替代。

## 配置与模块

- `src/config/event.mjs` 导出 `eventConfig`、`agenda`、`zones`、`highlights`、`faqItems`、`recruitment`。日期、讲者、署名、场地细节保持待确认；地图和联系地址为 `null`。日程保留原 15 个时段，讲座文案明确改为「讲者待定」；`recruitment.speakers/sponsors` 提供独立招募文案，不含虚构人名、赞助方、价格或权益。`eventConfig.siteRegistration` 显式区分现有 SO/RO 与新站点筹备报名。
- `shared/registration-schema.mjs` 仅包含无 I/O 的表单元数据、白名单规范化、交互验证和演示结束结果，可供后续 API 重新审阅使用；当前不是生产 API 的安全边界。
- `registrationSchema.baseFields` 是 18 项基础问题。`branches` 是按名称索引的 `{label,fields}`；字段元数据含 `name/label/type/required` 和适用的长度、枚举、提示。

## 字段与触发映射

基础名称：`name`、`city`、`organization`、`position`、`email`、`wechat`、`website`、`categories[]`、`participationInterests[]`、`background`、`caseLinks`、`attendance`、`accommodationChoice`、`departureCity`、`topics`、`cooperationInterest`、`cooperationForms[]`、`consentAccepted`。

| 分支 | 条件 | 局部字段 |
| --- | --- | --- |
| `soRo` | categories 包含 `so` 或 `ro` | siteName、city、firstYear、role、history（选填）、shareCase |
| `newSite` | categories 包含 `new_site` | city、organization、venueReady、teamReady、participating2027、supportNeeded |
| `speaker` | participationInterests 包含 `talk` | topic、summary、language、caseLinks |
| `exhibitor` | participationInterests 包含 `exhibition` | projectType、summary、links、attendeeCount、equipment |
| `partner` | categories 含 `partner` / `sponsor`，或 participationInterests 含 `partnership` / `sponsorship` | direction、resources、background |
| `accommodation` | accommodationChoice 为 `needed` | 顶层 departureCity，规范化 nights 恒为 1 |

身份枚举：`so/ro/new_site/industry/education/partner/sponsor/other`。参与方式：`roundtable/talk/workshop/exhibition/site_support/partnership/sponsorship/student_exchange/attend`。出席安排：`expected/uncertain/unavailable`。住宿：`needed/not_needed/uncertain`。机构合作兴趣：`interested/learn_more/none`。现有负责人和新站点可同时选择，仍是一份活动报名；不自动核准 GGJ 站点或服务年资。

`accommodation` 元数据复用顶层 `departureCity`；不要在基础资料与住宿分支重复渲染。其余分支使用嵌套对象或点路径表单名，如 `speaker.topic`。多选题传数组；同意必须明确转换为布尔 `true`，字符串 `"on"` / `"true"` 不被契约当作主动同意。

## 函数

- `createEmptyRegistration()`：空选择、空资料、未勾选同意；每次创建独立值。
- `getActiveBranches(input)`：返回当前身份 / 意向对应的分支名数组。
- `normalizeRegistration(input)`：只保留已知字段，去除未激活分支、旧出发城市及任意审核/权限字段；合并多类别为一个对象。数字表单值保留为字符串以便回显；生成 `accommodationNights` 为 1 或 0，固定演示同意版本。
- `validateRegistration(input)`：返回 `{valid, errors, value}`；错误键与表单名一致，如 `speaker.topic`。
- `completeMockRegistration(input)`：返回校验、提示及固定的 `mode: "mock"` / `submissionStatus: "not_submitted"`，不返回个人资料、编号或成功受理状态。
- 契约元数据 `attendanceAcceptance: "after_successful_persistence"`、`attendeeReviewRequired: false` 记录正式系统未来行为，不会启动任何真实提交。

## 演示规则与后续确认

- 姓名 2–80 字；邮箱必填，未填微信时暂用有效格式邮箱作替代联络方式。邮箱格式校验不声称已验证邮箱所有权。
- 简介必填，30 字只是建议，不设硬下限。其余字段硬上限、分支必填项及整数范围是当前前端提案，需在正式 schema 定稿时确认；不表示活动方已经批准全部规则。
- 网站只允许 http/https，不接受带用户名 / 密码的 URL。链接列表每行一项，暂限 5 项。
- 住宿限定一晚，无证件、酒店订单或付款信息；不产生审批状态，不按申请顺序自动分房。
- 同意不预选，不因“填入示例”而自动勾选。此处仅确认演示说明，不替代正式个人信息处理授权，也不记录正式 consent 时间。
- 页面不能使用 localStorage、sessionStorage、IndexedDB、远端服务或日志保存表单值；点击完成仅在当前页面内展示未提交提示。刷新 / 重置清空。示例邮箱使用保留域名 `example.invalid`。
- 隐藏分支在 DOM 中应禁用并清空；规范化还会再次去除隐藏值，防止切换角色后泄漏过期资料。
- 无公开查询接口；不得将示例编号或完成动画伪装成 OSS 已写入。API、鉴权、分布式限流、幂等、真实隐私告知与云端验证另阶段实施。

## 验证

`node --test tests/form-schema.test.mjs` 使用 Node 内置测试，无外部库、无网络、仅合成资料。覆盖多身份合并、各分支触发/隐藏清理、主动同意、替代联络、URL 与枚举验证、住宿一晚、mock 绝不受理、公开配置与完整连续日程。构建、类型检查、桌面 / 手机与微信真机检查由项目层另行记录。
