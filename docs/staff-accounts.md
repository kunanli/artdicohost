# 工作人员账号管理

受控配置中的 owner 保留为恢复账号，用户名／密码摘要由 GitHub 配置流程管理，不能从后台覆盖。其他工作人员由 superadmin 在 `/api/admin/users` 创建、修改角色、重设密码或停用，最多合计 20 位；邮箱必须是明确填写的 `@artdico.co` 身份，域名本身不授予任何权限。

新增账号目录使用独立私有日志 `cms/v1/users`，只保存 scrypt 摘要和最小审计；接口不返回摘要或明文密码。写入采用预期修订号，冲突须重载；未知写入结果不自动重送。owner 不会因为目录失败回退到一个绕过验证的缓存，储存故障时登录与会话核验保持失败。

`createCloudAuth` 可使用明确的 `usersProvider`。每次登录和会话验证读取当前目录，账号停用、密码摘要或角色变化通过凭据指纹立即使既有会话失效，不需等候八小时到期。角色独立：editor 编辑公开稿件、publisher 发布、outreach 私密意向名单、reviewer 报名审核、superadmin 账号与完整受控运维；不会自动把编辑角色升级为报名读取权限。

管理 API 的 GET／POST 均需要已登录 superadmin，POST 另需准确 Origin 与 CSRF。该模块默认关闭，生产运行时装配、包白名单和实际云端验收由本轮发布流程记录。

验证：`node --test tests/cloud-users.test.mjs tests/cloud-auth.test.mjs tests/registration-admin.test.mjs` 共 28 项通过，覆盖目录重建、并发冲突、保护 owner、重复身份拒绝、停用和角色变更跨实例撤销、储存失败及最小响应。
