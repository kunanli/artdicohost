# 技术架构、OSS 数据契约与 API

## 十五个展位的组织与负责人

内容草稿的 booths 每条保留稳定 id、项目标题 project、组织 organization 与明确的 slotNumber（1–15，0 表示尚未分配）。有效 pending／confirmed 记录不可重复占用同一位置；cancelled 的历史记录可保留原位置，不阻止另行安排。初始 booths 仍为空，不自动编造参展组织；后台可明确建立十五条待安排空记录。

新增可选字段 contactName（负责人单行文字，最多 120 字）、contactMethods（联系方式，可多行，最多 500 字）、description（展位内容，可多行，最多 2000 字）。仅明确提供才规范化；旧快照不补空键。负责人姓名与联系方式始终留在私有草稿和 editor＋outreach 授权的安排总览，绝不进入公开快照。只有 confirmed 展位在明确发布后才可公开 description，原 project 标题继续保留。联系方式不得填进准备公开的 description。

本机与 OSS 保存都按同一稳定展位 id 保留旧客户端遗漏的新字段；清空须明确提交空字符串。原修订冲突与位置校验继续执行，不因填入负责人就自动确认展位、公开联系人或替代真实出席回复。

## 可复用基础
参考仓库 `kunanli/igda_shenzhen` 的 Astro 静态页面、阿里 FC API、私有 OSS 数据、管理员登录与角色、活动报名、GitHub Actions 部署。它的文档说明活动报名为 `registrations/{eventId}/{record}.json`，OSS 数据与站点内容分离。需要针对本项目独立复制架构和测试，不能共享生产凭据。

## 资源隔离
PublicBucket：只放 Astro 构建输出及授权发布的图片；PrivateDataBucket：仅服务端读写报名和后台账户；FC：独立域名及环境变量；GitHub：新私有仓库。不得直接从前端写 PrivateDataBucket。

## JSON 推荐结构
`registrations/ggj-cn-2026/{uuid}.json`：id、event_id、submitted_at、updated_at、schema_version、identity、contacts、categories[]、participation_interests[]、background、attendance、so_ro、new_site、speaker、exhibitor、partner、accommodation_request、consent{version,accepted_at}、submission_key_hash。
`reviews/ggj-cn-2026/{uuid}.json`：registration_id、review_status、priority、proposed_role、internal_notes、assigned_to、maria_decision、attendance_confirmation、accommodation_status、version、updated_at。
`audit/ggj-cn-2026/{date}/{uuid}.json`：actor、action、registration_id、timestamp、metadata_without_pii。
`admin/users.json`：单独权限和账户空间；不要使用可重复 username 当私有身份稳定键。

## 可靠性约束
每份报名用独立 UUID 对象；使用有条件创建防覆盖。重复提交用服务端 idempotency key；需要版本号 + OSS 条件写防止多人审核时后写覆盖先写。审核记录和报名两文件不是事务写入，需写失败恢复/重试方案。列表读取支持 OSS continuation token 全分页，不能只取前 1000 条。导出仅服务端按权限生成，短时有效，不公开读。定期备份与恢复演练。

## API 契约（提案，Codex 须检验实际设计）
- `GET /api/public/event`：不包含个人数据的活动公开配置
- `POST /api/registrations`：验证、限流、生成 id、写私有 OSS、返回 reference_code
- `POST /api/admin/login`：独立鉴权
- `GET /api/admin/registrations?status=&category=&cursor=`：鉴权分页
- `GET /api/admin/registrations/:id`：鉴权单条
- `PATCH /api/admin/registrations/:id/review`：版本条件更新，审计
- `GET /api/admin/export?event_id=`：权限校验、字段过滤、审计
- `GET /api/health`：不暴露秘密

## 表单约束
提交请求由 API 验证字段长度/枚举/链接协议/同意状态/活动开放状态/截止时区；拒绝草稿活动或关停报名。请求体限大小，IP 限流不能只依赖单实例内存；错误响应不包含 OSS 对象键或技术堆栈。原始联系人资料不可缓存到 CDN。前端源码和 `.env` 不得包含服务密钥。

## 未来迁移
若申请量、筛选条件、跨活动关联或多人频繁并发显著增长，可将接口下方存储实现替换为 RDS；页面及 API 契约尽量不变。第一期不必为小规模活动购买数据库。
