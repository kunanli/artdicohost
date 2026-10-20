# 云端内容后台：运行角色与接入准备

2026-10-20。用户确认 `artdicohost-api` 尚未配置执行角色。本文件提供可审阅的专用角色与接入步骤；本轮没有创建角色、授权、绑定函数、修改 DNS、证书、触发器或上传云端业务包。现有 GitHub 部署身份及其他项目的权限不变。

本阶段准备工作人员登录、嘉宾头像、场次／展位、私密人员邀约及工作人员登记学生展示的草稿和明确发布。学生基础资料与材料链接留在私有内容快照，公开只输出获授权作品字段；作品封面沿用同一内容定址图片前缀。使用既有香港 FC 与私有 OSS，不新增数据库。正式报名、学生自行申请／双审、报名统计、历史联系人云迁移、群码、邮件及 Wallet 没有因此接通；39 笔联系人仍留本机，原群码与更换提醒不变。

## 1. 由用户建立专用执行角色

GitHub Repository Secrets 是部署身份，不是 FC 执行角色，也不是工作人员登录账号。用户要求不扩大既有 IAM；以下方案建立独立的最小权限角色，**属于仍需用户在阿里云控制台执行的配置变更**，不是已经授权或已经完成的 IAM 操作。无需提供或新建 AccessKey。

1. 在当前账号 `1954121651395178` 打开 **RAM 访问控制 → 身份管理 → 角色 → 创建角色**。
2. 可信实体类型选择 **阿里云服务／云服务**，信任主体选择 **函数计算 FC**；角色名建议 `artdicohost-content-runtime`。
3. 在角色详情的信任策略中核对下面的 JSON。仅保留 FC 服务主体，不加入 RAM 用户、GitHub 身份、其他账号或其他云服务。

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Principal": {
        "Service": ["fc.aliyuncs.com"]
      }
    }
  ]
}
```

该服务主体使用当前账号的 FC 信任关系；这不是限制到单一函数 ARN 的信任条件。本次没有取得 FC 执行角色支持 `acs:SourceArn`／`acs:SourceAccount` 条件传值的官方契约，因此不加入未经验证的条件。只将新角色绑定到本站函数，并由现有账号管理员控制谁能绑定该角色。参考 [RAM 信任策略](https://help.aliyun.com/zh/ram/user-guide/edit-the-trust-policy-of-a-ram-role)及 [FC 函数角色设置](https://help.aliyun.com/zh/functioncompute/grant-function-compute-permissions-to-access-other-alibaba-cloud-services)。

4. 在 **RAM → 权限管理 → 权限策略 → 创建权限策略 → JSON／脚本编辑** 新建自定义策略，名称建议 `ArtDicoHostContentRuntimeObjects`，内容如下：

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "oss:GetObject",
        "oss:PutObject"
      ],
      "Resource": [
        "acs:oss:*:1954121651395178:artdicohost-data-hk/cms/v1/*"
      ]
    }
  ]
}
```

5. 返回新角色 **权限管理 → 新增授权**，只附加这份自定义策略。若界面要求资源范围，选择当前账号；实际允许的对象仍受 JSON 中唯一的 bucket／前缀限制。核对没有附加 `AliyunOSSFullAccess`、`AliyunFCFullAccess`、默认宽权限角色或其他策略。
6. 记录新角色 ARN，应为 `acs:ram::1954121651395178:role/artdicohost-content-runtime`。这是角色标识，可以回报给维护人员；不要回报任何临时凭据或账号配置。

上述对象权限覆盖 `cms/v1/content/` 的快照及提交日志、`cms/v1/contacts/` 的独立私密名单日志、`cms/v1/portraits/` 的内容定址头像、`cms/v1/sessions/` 的会话，以及 `cms/v1/limits/` 的共享登录额度。应用只按确定的对象 key 读写，不需要列举 bucket。

[OSS AppendObject 官方权限表](https://help.aliyun.com/zh/oss/developer-reference/appendobject/)明确将追加写入映射为 `oss:PutObject`；只有带对象标签或相应加密模式时才涉及其他权限。本实现不带标签，采用 SSE-OSS／AES256，不使用 KMS。因此不增加 List、Delete、ACL、标签、KMS、其他 bucket 或 FC 管理权限。

权限策略中没有 Delete 不等于不可破坏：`oss:PutObject` 本身允许写入该前缀内的对象。不可变快照的 hash／防覆盖校验与 AppendObject position 并发控制由应用实现，不应把它们称为 RAM 强制的不可修改存储。桶应继续保持私有、阻止公共访问及现有 AES256 设置；不要为后台修改成公共读写，也不要挂载 OSS 文件系统。

## 2. 函数绑定及临时身份

角色创建后，绑定仍由用户操作：**FC → 中国香港 → artdicohost-api → 配置 → 高级配置／权限 → 函数角色**，选择上面的专用角色。保存前核对函数完整 ARN 为 `acs:fc:cn-hongkong:1954121651395178:functions/artdicohost-api`，只改这一个函数；保存后记录角色 ARN，保留原自定义运行时、启动命令、9000 端口与签名健康触发器。

如果控制台要求新增 `ram:PassRole`、其他系统策略或一键宽授权，先由现有 RAM 管理员核对，不给 GitHub 部署用户或其他项目扩大权限。角色绑定可能造成实例更新；下一次自动发布还须核对并保留该现场配置，不能让旧的启动配置假设覆盖角色。

FC 平台应在 Debian 11 自定义运行时提供以下三项临时角色环境变量：

- `ALIBABA_CLOUD_ACCESS_KEY_ID`
- `ALIBABA_CLOUD_ACCESS_KEY_SECRET`
- `ALIBABA_CLOUD_SECURITY_TOKEN`

这些值由平台根据函数角色提供，不从 GitHub Secrets 复制，不手工设置永久 AccessKey，也不接受访客传入的 `x-fc-*` 请求头作为身份。任一项缺失或请求失败时，内容后台保持关闭／返回失败；只记录配置是否存在和固定错误码，不打印值、请求签名或完整环境。依据 [Debian 11 上下文说明](https://help.aliyun.com/zh/functioncompute/context-and-log-format-1)及 [FC 系统环境变量](https://help.aliyun.com/zh/functioncompute/environment-variables)。

实际运行还须使用受控服务端的明确工作人员账号及 scrypt 摘要；没有默认账号、自助注册或“拥有公司邮箱即可登录”。真实用户名、邮箱、密码及摘要不放仓库或合成夹具。用户名和明确配置的 `@artdico.co` 邮箱使用同一账号；寄件身份仍是另一项尚未启用的配置。角色范围在 API 侧执行，只有 `editor` 可保存及上传，`publisher` 可发布。

会话存放于共享私有日志，8 小时到期，退出持久撤销；账号移除或密码摘要／角色变化使旧会话失效。默认采用**所有工作人员共用每 15 分钟 10 次登录尝试**的固定窗口额度；成功、错误密码和未知标识均消耗同一额度。返回 429 时遵循 `Retry-After`。此保守额度会让一个来源耗尽所有人的当窗额度，当前没有可信 IP 级限流或独立 WAF 防护，不能宣传为完整抗滥用能力。

## 3. 固定 HTTPS 入口及路由计划

内容内核固定接受 `https://api.artdico.host`。计划在同一域名承载 `/admin/` 页面与 `/api/admin/*`；会话 cookie 为 Secure、HttpOnly、SameSite=Strict，不设置 Domain，管理写入同时验证准确 Origin 与 CSRF。公开 `https://artdico.host` 只匿名读取已发布内容与当前已授权头像，不跨域发送密码或会话；公开 GET／HEAD 的 CORS 仅允许这个站点。

域名尚待独立设置与实测。用户后续在 **FC → 中国香港 → 域名管理** 添加 `api.artdico.host`，配置覆盖该子域名的证书、HTTPS 和强制 HTTPS，再在阿里云 DNS 增加 `api` 的 CNAME，记录值采用 FC 控制台实际给出的公网 CNAME。不得改写当前网站的 `@` 解析、绑定或证书。香港函数的自定义域名无需中国内地备案；具体操作见 [FC 自定义域名](https://help.aliyun.com/zh/functioncompute/configure-custom-domain-names)。本轮没有代做这些变更。

FC 3.0 的自定义域名独立于 HTTP Trigger；应保留当前 `defaultTrigger` 的签名认证及原有 GET／HEAD 健康验收，不为了后台把它改成匿名。参考 [FC 3.0 差异说明](https://help.aliyun.com/zh/functioncompute/feature-updates-in-function-compute-3)。待生产 HTTP／静态装配明确后，按 [PathConfig 的 methods](https://help.aliyun.com/zh/functioncompute/api-fc-2023-03-30-struct-pathconfig)设置以下最小路由，不使用 `/*`：

| 路径 | 方法 | 用途 |
| --- | --- | --- |
| `/admin`、`/admin/*` | GET、HEAD | 后台页面；静态页面入口仍须由最终装配核定 |
| `/_astro/*` | GET、HEAD | 最终后台构建实际需要的静态资源 |
| `/api/admin/environment`、`/api/admin/session`、`/api/admin/content` | GET | 模式／会话／草稿读取；模式不等于储存已验收 |
| `/api/admin/portraits/*` | GET | 已登录、有内容权限的私有头像读取 |
| `/api/admin/login`、`/api/admin/logout`、`/api/admin/portraits`、`/api/admin/content/publish` | POST | 登录、退出、上传、明确发布 |
| `/api/admin/content` | PUT | 带预期修订号保存草稿 |
| `/api/admin/planning`、`/api/admin/communications` | GET | outreach 的最小排程／功能标记及准备状态 |
| `/api/admin/arrangements` | GET | editor + outreach 的已保存十五位展位／活动人员总览，不公开名单 |
| `/api/admin/contacts` | GET、POST | 私密名单读取与手动新增，仅 outreach |
| `/api/admin/contacts/*` | GET、PUT、POST | 应用精确匹配的修正、跟进、生成／人工发出与双角色最小预填；不提供匿名名单 |
| `/api/public/content`、`/api/public/portraits/*` | GET、HEAD、OPTIONS | 只读公开发布内容与当前授权头像 |

不为 `/healthz`、`/api/registrations`、匿名联系人、实际消息发送或 Wallet 签发添加自定义域名路由。私密名单及原有邮件／Wallet 内容预览只接受名单角色；后者仅预览，不发送。域名的基础入口无需云端签名才能到达登录页面，实际管理访问由应用账号、会话和权限控制。任何平台鉴权／路由选项都须在独立自定义域名上核对，不能改变原签名触发器来绕过验证。

## 4. 发布与验收尚未完成的部分

目前新增的是可测试的云端内容内核，现行六文件 FC 启动包尚未包含它。尚须完成生产 Node HTTP 边界与后台静态资源装配、包白名单／来源绑定、明确服务器配置、账号安全设置、域名路由及公开页面只读 API 对接，然后才有可交付的生产包。不要上传本机 `functions/content-api/server.mjs`，也不要仅因角色建立便把开关设为 `true`。

运行配置缺项时拒绝开放；`configured: true` 只表示通过配置检查，`storageVerified: false` 保持准确；`/api/admin/environment` 返回的 `mode: cloud` 也不证明真实 OSS 权限、持久化或账号已验收。未来交付须分别记录：

1. 当前 main 的检查、完整源码提交和实际发布运行；公开 OSS 的上传与 SHA-256 回读，及 FC 三次连续签名 `/healthz` 的同一完整源码标记。FC `codeChecksum` 是 CRC64，不能替代 SHA-256 回读。
2. 专用角色生效、私有前缀内合成对象的真实写入／读取／hash、缺权限与未知储存错误关闭操作。日志仅记固定结果，不输出对象内容、账号摘要、令牌或请求签名。
3. 两个独立实例的保存／发布／审计竞争、冲突 409、重载后正确版本，以及超时／丢失 ACK 不回成功、不盲重送。
4. 纯合成账号的用户名和邮箱登录、错误密码、共享限流、权限拒绝、退出和跨实例撤销；纯合成照片的上传、保存、重启读取、发布及撤回后旧公开 URL 拒绝。
5. 从实际 `api.artdico.host/admin/` 登录编辑，从 `artdico.host` 匿名读取公开版本；确认草稿、未同意头像、会话、账号摘要及内部备注不出现在公开响应或静态包。

本机测试或角色／bucket 存在不能替代这些云端结果；不以真实报名、联系人或原群码完成测试。失败或结果不明时保持业务关闭，先只读核对现场，再按正常修复／回退流程处理。

## 5. 备份、容量、恢复与删除限制

内容单状态最多 1 MiB、审计最多 1000 条，提交日志也有上限；达到上限拒绝新操作，不无声删历史。会话及登录窗口会产生独立私有对象，当前没有自动清理、压缩、轮替或保留期限执行器。正式长期使用前仍须完成维护工具及保留方案，不能承诺已自动归档。

快照／头像按内容 hash 保存，提交日志决定当前状态；它们属于在线主存储，**不是独立备份**，开启桶版本控制也不能代替 Appendable 提交日志的备份。[AppendObject 官方说明](https://help.aliyun.com/zh/oss/developer-reference/appendobject/)指出，追加不会为当前 Appendable 对象产生历史版本。本项目不因此修改现有桶的版本控制、保留锁或生命周期策略。

备份与恢复工具尚未交付和实测。后续应在停写或受控一致性点，由独立的人工运维身份将提交日志、其引用快照及所需头像保存到加密且权限隔离的备份；记录 hash、时间和恢复点。恢复先在隔离位置验证 hash 链、引用、内容 schema 与头像，再明确执行切换、撤销旧会话并补做已要求的撤回。不得把旧备份直接覆盖生产提交日志，不能借恢复重新公开已撤回资料。该维护身份与所需权限另行核定，不能附加到 FC 运行角色或当前部署身份。

公开撤回只阻断后续公开响应，私有头像、历史快照／审计和备份仍可能保留原资料，也不能删除访客已保存的副本。现有运行角色没有删除权限，没有“彻底删除成功”接口；数据擦除、失效会话／窗口清理、历史引用与备份到期删除须由受控维护流程覆盖并实测。仅删除当前头像或日志会破坏引用，不能当作完整删除流程，也不得删除整个 bucket、其他前缀或本机原始联系人。

回退时先关闭内容开关并停止新写入，恢复上一个已验收的代码及对应配置，保留私有数据和原签名健康入口；代码回退不自动回退内容日志。真实数据启用前，备份／恢复／删除与维护容量的缺口仍须解决并记录验收证据。当前没有云端业务数据已成功备份、恢复或删除的声明。
