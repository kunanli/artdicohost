# 技术架构、OSS 数据契约与 API

## 正式架构（2026-11-26）

| 入口或资源 | 用途 |
| --- | --- |
| `https://artdico.host` | Astro 静态站点，由香港公开 OSS `artdicohost-web-hk` 提供。纪念卡领取页的 HTML 仅提供界面。 |
| `https://api.artdico.host` | 香港 `artdicohost-api` FC，使用 Node 24.19.0 自定义运行时。提供公开 API 与同源工作人员后台 `/admin/`。 |
| `artdicohost-data-hk` | 私有 OSS，保存业务日志、不可变原始记录、私有素材及受控加密配置。FC 以运行角色的临时凭据访问。 |

正式报名、验票和签到以活动行为准。正式 FC 仅开放新的纪念卡申请，普通网站报名和讲者申请已关闭。既有人员与名额可由授权后台查阅，受保护的活动行名册导入继续维护内部来源和人员对照。旧入场短链显示活动行指引。历史网站票券、现场核销及手工名额写入路由已停用。 [活动行执行路径](redesign/external-registration-wallet.md) · [正式运行配置](../functions/cloud-content/runtime.mjs)

## 当前数据与修订边界

| 私有 OSS 前缀 | 持久内容 |
| --- | --- |
| `cms/v1/content` | 编辑草稿与独立的公开快照。发布按预期修订核对，公开活动 API 和前端只读取脱敏的已发布版本。 |
| `cms/v1/registrations/{eventId}/records` 与 `/index` | 按内容哈希保存的申请原件，以及提交键、名额历史与人员主记录关系的日志。 |
| `cms/v1/registration-reviews/{eventId}` | 工作人员审核、卡面身分和个人资料更正。 |
| `cms/v1/commemorative-cards/{eventId}/management` | 独立纪念卡核准、测试卡与移除标记。核准以主记录关联所选申请和操作凭据。重核原操作可读取既有结果。 |
| `cms/v1/commemorative-cards/{eventId}/community` | 已确认的 GGJ 站点／社群、参与经历和可选卡面资料。明确保存的空白优先于申请内容。 |
| `cms/v1/commemorative-cards/{eventId}` | 纪念卡邮件预留、寄送结果与审计。历史参会通知另存于 `cms/v1/registration-confirmations/{eventId}`。 |

OSS 日志以不可变的哈希内容及原子追加提交保存。预期修订或追加位置冲突时，以当前状态重新核对。纪念卡核准与移除共用管理日志的条件写入。核准只产生纪念卡资格，既有名额、票证和签到记录保留。首次写入独立核准后，回退版本须能读取新增记录并维持活动行模式。 [日志实现](../functions/cloud-content/object-journal.mjs) · [纪念卡持久化](../functions/registration-confirmation/repository.mjs) · [发布与回退](08-deployment.md)

## 当前入口与授权

| 路径 | 用途 |
| --- | --- |
| `GET /api/public/content` | 已发布的公开内容。 |
| `GET /api/registration/config`、`POST /api/registration/token`、`POST /api/registrations` | 获取开放状态和提交凭据，按 `wallet-v1` 保存纪念卡申请。服务器校验同意、开放时间、提交键和表单数据。 |
| `POST /api/admin/login`、`GET /api/admin/session` | 持久化工作人员会话和 CSRF 凭据。 |
| `GET /api/admin/admissions`、`GET /api/admin/registrations`、`GET /api/admin/registrations/:id` | 授权查询保留的站内名额和人员资料。 |
| `/api/admin/registration-confirmation/cards` | 工作人员查看、核准、编辑、测试、发送、重寄与移除纪念卡。 |
| `POST /api/registration/confirmation`、`POST /api/registration/wallet` | 使用私人 `receiptToken` 读取纪念卡资格与资料、下载签章卡。旧前端使用的对应 `/api/admin/registration/*` 路径仍有兼容入口。 |

公开配置沿用兼容字段 `publicRegistrationMode: 'speaker_only'`。现行开放状态由 `speakerApplicationsEnabled: false` 和 `walletApplicationsEnabled: true` 表示，后者仍受服务开放时间约束。服务端强制活动行模式。 [正式配置核对](https://github.com/kunanli/artdicohost/actions/runs/45776935655/job/139768424487)

工作人员操作在 API 核验角色、会话及写请求的 `Origin` 和 CSRF。审核角色可核准纪念卡，新增测试卡、寄送和移除另需活动操作权限。私人领取凭据经签署并设有有效期，由邮件链接的片段传入 POST 请求体。领取限定公开站来源，响应禁用缓存。取得卡面前核对活动资料、主记录、核准资格及权限。Wallet 签章后再次核对当前权限和卡面资料。 [HTTP 契约](../functions/registration-confirmation/handler.mjs) · [签署凭据](../functions/registration-confirmation/tokens.mjs) · [Wallet 签章](../functions/apple-wallet/service.mjs)

合并人员时，主记录的工作人员保存值优先，含明确清空。其余资料按仍有关联的核准申请、主记录自身的纪念卡申请、一致的关联纪念卡申请依次选用。 [领取与资料选择](../functions/registration-confirmation/service.mjs)

## 历史架构与初版提案

下文保留早期展位约定、候选对象结构和 API 提案。正式路径与实际存储以前述章节为准。

### 十五个展位的组织与负责人

内容草稿的 booths 每条保留稳定 id、项目标题 project、组织 organization 与明确的 slotNumber（1–15，0 表示尚未分配）。有效 pending／confirmed 记录不可重复占用同一位置；cancelled 的历史记录可保留原位置，不阻止另行安排。初始 booths 仍为空，不自动编造参展组织；后台可明确建立十五条待安排空记录。

新增可选字段 contactName（负责人单行文字，最多 120 字）、contactMethods（联系方式，可多行，最多 500 字）、description（展位内容，可多行，最多 2000 字）。仅明确提供才规范化；旧快照不补空键。负责人姓名与联系方式始终留在私有草稿和 editor＋outreach 授权的安排总览，绝不进入公开快照。只有 confirmed 展位在明确发布后才可公开 description，原 project 标题继续保留。联系方式不得填进准备公开的 description。

本机与 OSS 保存都按同一稳定展位 id 保留旧客户端遗漏的新字段；清空须明确提交空字符串。原修订冲突与位置校验继续执行，不因填入负责人就自动确认展位、公开联系人或替代真实出席回复。

### 可复用基础
参考仓库 `kunanli/igda_shenzhen` 的 Astro 静态页面、阿里 FC API、私有 OSS 数据、管理员登录与角色、活动报名、GitHub Actions 部署。它的文档说明活动报名为 `registrations/{eventId}/{record}.json`，OSS 数据与站点内容分离。需要针对本项目独立复制架构和测试，不能共享生产凭据。

### 资源隔离
PublicBucket：只放 Astro 构建输出及授权发布的图片；PrivateDataBucket：仅服务端读写报名和后台账户；FC：独立域名及环境变量；GitHub：新私有仓库。不得直接从前端写 PrivateDataBucket。

### JSON 推荐结构
`registrations/ggj-cn-2026/{uuid}.json`：id、event_id、submitted_at、updated_at、schema_version、identity、contacts、categories[]、participation_interests[]、background、attendance、so_ro、new_site、speaker、exhibitor、partner、accommodation_request、consent{version,accepted_at}、submission_key_hash。
`reviews/ggj-cn-2026/{uuid}.json`：registration_id、review_status、priority、proposed_role、internal_notes、assigned_to、maria_decision、attendance_confirmation、accommodation_status、version、updated_at。
`audit/ggj-cn-2026/{date}/{uuid}.json`：actor、action、registration_id、timestamp、metadata_without_pii。
`admin/users.json`：单独权限和账户空间；不要使用可重复 username 当私有身份稳定键。

### 可靠性约束
每份报名用独立 UUID 对象；使用有条件创建防覆盖。重复提交用服务端 idempotency key；需要版本号 + OSS 条件写防止多人审核时后写覆盖先写。审核记录和报名两文件不是事务写入，需写失败恢复/重试方案。列表读取支持 OSS continuation token 全分页，不能只取前 1000 条。导出仅服务端按权限生成，短时有效，不公开读。定期备份与恢复演练。

### API 契约（提案，Codex 须检验实际设计）
- `GET /api/public/event`：不包含个人数据的活动公开配置
- `POST /api/registrations`：验证、限流、生成 id、写私有 OSS、返回 reference_code
- `POST /api/admin/login`：独立鉴权
- `GET /api/admin/registrations?status=&category=&cursor=`：鉴权分页
- `GET /api/admin/registrations/:id`：鉴权单条
- `PATCH /api/admin/registrations/:id/review`：版本条件更新，审计
- `GET /api/admin/export?event_id=`：权限校验、字段过滤、审计
- `GET /api/health`：不暴露秘密

### 表单约束
提交请求由 API 验证字段长度/枚举/链接协议/同意状态/活动开放状态/截止时区；拒绝草稿活动或关停报名。请求体限大小，IP 限流不能只依赖单实例内存；错误响应不包含 OSS 对象键或技术堆栈。原始联系人资料不可缓存到 CDN。前端源码和 `.env` 不得包含服务密钥。

### 未来迁移
若申请量、筛选条件、跨活动关联或多人频繁并发显著增长，可将接口下方存储实现替换为 RDS；页面及 API 契约尽量不变。第一期不必为小规模活动购买数据库。
