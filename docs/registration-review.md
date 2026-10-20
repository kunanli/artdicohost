# 正式报名审核与运维

## 审核模块

`functions/registration-admin/store.mjs` 提供独立审核日志，调用方注入报名 repository 的 `list()` 与本站事件 ID。原始已保存申请保持不可变，审核、住宿、内部推荐、Maria 意见与邀请状态在另一个 CAS 日志中保存。每次修改、导出与删除处理申请同时提交最小审计；并发冲突返回 409，未知写入结果返回失败且不自动重送。

`createRegistrationReviewStore({journal,loadRegistrations,eventId,clock})` 的方法为 `list`、`detail`、`saveReview`、`exportCsv` 与 `requestDeletion`。列表按服务器白名单过滤和分页，分类可多选但每人只计一条申请；分页游标绑定报名／审核修订，资料改变后需重载。列表不含邮箱／微信，单条详情仅供有审核权限的工作人员读取。

`functions/registration-admin/handler.mjs` 的 `createRegistrationAdminApi({enabled,auth,store,canExport})` 仅处理以下路由，由生产入口与现有共享会话实例接合：

| 路由 | 方法 | 权限与输入 |
| --- | --- | --- |
| `/api/admin/registrations` | GET | reviewer／superadmin；query、category、status、accommodation、city、attendance、cursor、limit |
| `/api/admin/registrations/:id` | GET | reviewer／superadmin；完整私有申请与独立审核资料 |
| `/api/admin/registrations/:id/review` | PATCH | 同上；`{expectedRevision,review}` |
| `/api/admin/registrations/export` | POST | 默认仅 superadmin；`{expectedRevision,filters,includeContact:false}` |
| `/api/admin/registrations/:id/deletion-request` | POST | 仅 superadmin；`{expectedRevision,reason}` |

所有管理写入要求准确 `https://api.artdico.host` Origin 和现有共享会话 CSRF。editor／publisher／outreach 不自动得到报名读取权。新增 reviewer、superadmin 仅为明确配置的角色，既有账号不会自动升级；受控 owner 迁移由独立配置流程负责。可额外注入 `canExport` 授予 reviewer 最小导出，但带联系方式的导出仍只允许 superadmin 主动选择。导出不自动发送 Maria，不产生公开链接，CSV 处理公式前缀并默认排除联系方式和内部长备注。

审核状态与住宿状态互不替代。未申请住宿的记录不能被标为获房；报名／参会审核不会自动分配房间或授予 GGJ 资格。工作人员从意向转入的记录保留 `staff_assisted` 来源及未取得申请人正式同意的准确状态，不能冒称公开表单同意。

## 删除与维护边界

删除接口只记录待执行请求，返回 `erased:false`、`maintenanceRequired:true`，不声称已擦除。当前在线日志、历史快照、备份、引用对象与会话撤销须由独立受控维护流程一致处理；仅删除当前 JSON 会破坏审计和哈希引用。此模块不增加 RAM List／Delete 权限，不执行 bucket 级删除。

审核日志最多 1000 次审计操作，达到上限拒绝新修改，不自动丢弃历史。该上限是需要维护的容量边界，并非长期归档方案。全部实现与验证使用合成资料，不读取旧本机联系人、不发送通知。

## 验证与接续

`node --test tests/registration-admin.test.mjs tests/admin-auth.test.mjs`：14 项通过，覆盖专用角色、过滤／分页、多分类计数、两个独立 store 的 CAS 竞争、住宿独立审核、原始资料不变、未知 ACK、CSV 审计／公式防护、删除请求准确说明、Origin／CSRF／权限与不回显错误。

这些是模块测试，不能代替真实 OSS、生产角色与 HTTPS 联调。生产入口装配、白名单打包、受控 owner 角色迁移及实际部署结果由本轮主流程继续验收；开关默认关闭。
