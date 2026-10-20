# GitHub 自动更新香港 FC

日期：2026-10-20（Asia/Taipei）。香港 `artdicohost-api` 已按用户要求参照 `kunanli/artdico-deck` 自动更新；运行时、RAM 与 Variables 配置完成。最近完整验收基线 `e82762e2f86ea3663a4e3e78d0a10d0a608ef541` 的 [Actions 39362633747](https://github.com/kunanli/artdicohost/actions/runs/39362633747) 已取得公开 OSS 12 个对象 SHA-256 回读，以及 FC 单次更新后的三次连续签名完整源码标记。私有 OSS 已创建仍不代表正式 API、后台登录或嘉宾管理已接通。后续提交以各自最新 main push 的实际日志为准。

用户同时授权后续正常发布：完成检查和审阅后，可合并到 main 并执行自动部署，无需逐次再申请发布确认。此授权不替代公开稿件核准、真实资料迁移及个人信息公开 / 分享授权，也不改变正式隐私告知与当前业务关闭边界。

## 已完成的启动验收基线

- PR #14 合并为 `81f410b115fc4a77fcece4980014663aebce1bc9`，[39362148646](https://github.com/kunanli/artdicohost/actions/runs/39362148646) 首次完成两项实际发布。
- PR #15 合并为 `e82762e2f86ea3663a4e3e78d0a10d0a608ef541`，[Actions 39362633747](https://github.com/kunanli/artdicohost/actions/runs/39362633747) 的 check `118432075926` 完成 224 项测试及构建 / 审计；OSS `118432690875` 完成 12 次公开 SHA-256 回读。
- FC `118432690825` 取得 UpdateFunction 成功确认；11:11:34、11:11:36、11:11:39（Asia/Taipei）连续三次签名 health 全部匹配该完整提交。前后配置 / 触发器守卫通过，最终 main 仍为该提交。
- GetFunction 的两个生命周期字段为 null；成功依据相同的三次真实签名来源检查，未从缺字段推论 Active / Successful。FC codeChecksum 是 CRC64；日志中的 ZIP SHA-256 只核对本地上传包，不能称为云端 SHA-256 回读。
- 验收证据已记录，发布追踪已暂停，原群码提醒不变。云端业务仍关闭。

## 首次接入历史（保留失败与略过结果）

- PR #7 记录：`73a1e5479721e0381e2a3150dc00d65bd3aba8b2`（PR #6 合并为 `bdec4fbc95014a42a65c93d1769736116d081643`）。
- [Actions 39279414370](https://github.com/kunanli/artdicohost/actions/runs/39279414370) 已完成，整体结论 success。检查 job `118150738016` 成功，包含 165 项测试、FC 打包与 Debian 11 启动验收。
- OSS job `118154224656` 成功，日志有 12 条 `Verified`，公开对象上传和 SHA-256 回读通过。
- FC job `118164111489` 为 **skipped**。检查日志实际出现 `FC automatic deployment is disabled.`，对应工作流判断 `vars.ARTDICO_FC_DEPLOY_ENABLED != 'true'`；它仅证明该次运行未读到精确启用值，不代表现在的 Variable 值，也不是 FC API 权限失败。
- PR #9 记录：`2e90103f7756acdb49cc5433a5dd6ab22500a6f2`。[Actions 39349541751](https://github.com/kunanli/artdicohost/actions/runs/39349541751) 的 check job `118390207507` 有 175 项测试及 Debian 11 ZIP smoke 成功；OSS job `118390479876` 有 12 条 `Verified`，公开 SHA-256 回读通过；FC job `118390481472` 仍为 skipped，disabled 提示实际执行。
- 用户确认启用开关此前放在 **Repository secrets**。工作流读取的是 `vars.ARTDICO_FC_DEPLOY_ENABLED`，所以对应 Repository Variable 不存在时即使 Secret 同名也会略过。用户随后回报已在 **Variables → Repository variables** 保存启用值及账号 ID；实际是否读到须由新运行验证，不读取或取回 Secret 值。
- 修正设置不会补跑已完成的 job；下一次正常 main push 才会重新求值。手动 workflow_dispatch 仍只检查，不绕过 main 门禁；若 main 前进，以当前 main 最新 push 验收。

首次实际更新重试：[Actions 39350373144 / attempt 2](https://github.com/kunanli/artdicohost/actions/runs/39350373144/attempts/2)，来源 `94d7791fe738e3b1167a831aae156dc4ef48b93d`。check job `118401813150` 的 175 项检查与 Debian 11 ZIP 启动验证成功，disabled 提示略过，已确认启用值被读取；OSS job `118402041101` 实际完成 12 个公开对象上传与 SHA-256 回读。FC job `118402041213` 实际执行，在代码更新步骤失败，固定错误为 `FC code update failed; deployment was not verified.`。这不是开关再次略过，亦尚无三次签名健康检查成功结果；不能由更新请求报错推断云端未改变。

413 历史基线为 `9ea9482ce54f8fb30a34d8ecc928ec4fc9a76966`。[Actions 39354134071](https://github.com/kunanli/artdicohost/actions/runs/39354134071) 的 181 项检查通过，OSS 12 个公开对象 SHA-256 回读通过；FC job `118405168647` 明确记录 `operation=UpdateFunction phase=response_type status=413`，响应类型不是 JSON。该上传路径拒绝过大的请求体；这不是 IAM 失败，不以增加权限处理。

PR #12 历史基线为 `8c6398d8cf337e8d7d5f12d0634aa71a9c8a1a7b`。[Actions 39355862651](https://github.com/kunanli/artdicohost/actions/runs/39355862651) 的 check job `118410359292` 完成 195 项测试、构建、依赖审计及紧凑 ZIP 检查；该次 ZIP 为 29,507,159 bytes，Python 离线夹具启动为 5.506 秒。OSS job `118411101002` 于 09:55:44–09:55:56（Asia/Taipei；日志为 01:55:44–01:55:56 UTC）完成 12 个公开对象 SHA-256 回读。FC job `118411100920` 报告 `operation=UpdateFunction phase=timeout`，达到原 20 秒请求期限后失败，代码更新结果不明。

上传超时阶段的 main 为 `dff3c897bdadfbe555459366183ccab1fbca0195`。[Actions 39357108387](https://github.com/kunanli/artdicohost/actions/runs/39357108387) 的 check job `118414315427` 完成 203 项测试及离线 ZIP smoke（6.395 秒）；OSS job `118414977033` 于 02:08:57–02:09:10 UTC 完成 12 个公开对象 SHA-256 回读。FC job `118414977011` 的更新前观察记录 state / update `unknown`，签名健康检查为 `operation=CheckHealth phase=http status=400 code=InvalidArgument`；之后 UpdateFunction 等待 120 秒，于 02:10:56 UTC 超时。此时仍无法判断代码是否已更新，也没有三次签名健康检查成功证据。

失败诊断只允许固定操作 / 阶段、HTTP 状态与白名单服务错误码；UpdateFunction 可额外投影可信 transport 私有 WeakMap 中的 `uploadBodyWritten` / `responseStarted` 两个布林。不记录远端正文、任意 Message、headers、环境、角色、凭证或原始 cause，未知服务码仅作未分类错误处理。针对 413 已完成紧凑包准备及离线验收；该次上传超时保留当时请求结果不明的失败记录，不自动重送该次或更旧提交的 PUT，不放宽成功校验或扩大 IAM。

每次后续运行仍须分别取得公开 OSS 回读及 FC 实际更新、连续三次签名 `/healthz` 返回该次完整提交标记的证据；artifact 存在或整体绿色不能代替。部署仍为业务关闭的启动包，没有管理员云端登录、真实报名、私有 OSS 读写或统计能力。

## 采用的模式

只读参考 [artdico-deck@5154ad2 的工作流](https://github.com/kunanli/artdico-deck/blob/5154ad2aa1c568e6f3c08bd67681557d5a7bf6b9/.github/workflows/build-backend-zip.yml)与[部署说明](https://github.com/kunanli/artdico-deck/blob/5154ad2aa1c568e6f3c08bd67681557d5a7bf6b9/docs/guides/BACKEND-DEPLOY.md)：main 更新既有函数代码，之后核对线上版本。没有复制参考项目的源码、身份、函数、私有资料或 Node 20 运行时。

本项目保留当前 main 检查和 artifact 发布模式：PR 只有检查，主分支发布不重新打包已验收的 ZIP。FC 包绑定该完整提交，保留 `fc-publication-<SHA>` artifact 14 天。发布任务重新核对六文件 ZIP、Node XZ 内容及解压后的官方原始二进制校验值、源码提交与 manifest，上传内存中已核对的同一份 ZIP bytes。大二进制不写回 Git。

紧凑包保留 `/code/bootstrap` 外部设置，调用 `custom.debian11` 内置 Python 3.12，在私有 `/tmp` 目录离线解压并核对 Node 后执行；原始 Node bytes 未修改。不会在运行时下载二进制、把包放到公开 OSS、创建私有 artifact 桶或增加 layer。当前 CI 夹具采用固定 Python `3.12.4` / Debian bullseye 模拟文档中的解释器路径，以非 root、无网络、只读 `/code`、可执行 `/tmp` tmpfs 192 MiB、512 MB 内存及 0.35 CPU 验证实际 ZIP；它不是阿里云实际 FC 镜像，仍须真实账号验收。

上传前固定检查完整 Base64 JSON 请求体不超过 **48,000,000 bytes**。这是针对观察到的 413 所设工程预算，不是阿里云精确上限；官方[限制文档](https://help.aliyun.com/zh/functioncompute/limits-of-usage)当前写为 Base64 及其他 body 总量小于 100 MB，但原约 59.1 MB 请求已被拒绝。紧凑 Node XZ 为 29,494,612 bytes，PR #12 ZIP 为 29,507,159 bytes，完整 JSON 请求为 39,342,903 bytes；预算通过不能代替云端上传和健康验证。

网站 OSS 与 FC 是独立 job、独立验收，不是联合原子部署；一方失败不代表另一方已回退。原网站部署保持既有目标与权限。PR、手动 `workflow_dispatch`、错误仓库 / 分支、缺少开关或过时 main 运行都不能执行 FC 更新。

## 一次性控制台设置

用户已回报以下运行时、RAM 与 Variables 设置完成；本节保留为核对和维护说明，不要求重复设置。实际配置及权限由首次发布任务验证。

1. 在香港 `artdicohost-api → 弹性配置` 将最小实例数设为 `0`，其他当前资源规格可先沿用。缩至零允许冷启动，不代表完全无费用。
2. 在 **配置 → 运行时配置** 保留自定义运行时 Debian 11，启动命令使用命令模式 `/code/bootstrap`，监听端口 `9000`，执行超时 `60` 秒；启动参数留空。触发器仍为 `defaultTrigger`、`LATEST`、HTTP 签名认证，允许 `GET`。不新增环境变量或改为匿名认证。启动命令保存后，在首次本项目 ZIP 部署前原 Python 示例无法按新命令启动，这是首次接入的暂态；当前函数尚未承接正式业务。
3. 在阿里云 RAM 找到**与 GitHub 现有部署 Secrets 对应的专用部署用户**。不要凭名字猜测身份或取回 AccessKey 值。建立自定义策略，例如 `artdicohost-fc-update`，从[权限模板](../deploy/fc-update-policy.template.json)替换所有 `<ALIYUN_ACCOUNT_ID>` 为本账号 UID，核对地域与函数后授予该用户。不要给其他项目身份、`AliyunFCFullAccess` 或私有资料桶权限。
4. 在 [GitHub Actions Variables](https://github.com/kunanli/artdicohost/settings/variables/actions) 建立以下 **Repository variables**；它们不是 Secret；同名 Repository secret 不能替代。账号 ID 是函数 ARN 中的账号 UID，启用值为不含引号或空白的 `true`：

| 名称 | 值 |
| --- | --- |
| `ARTDICO_FC_ACCOUNT_ID` | 与 RAM 策略及函数 ARN 一致的本账号 UID，纯数字 |
| `ARTDICO_FC_DEPLOY_ENABLED` | `true` |

现有 Secrets `ARTDICO_OSS_ACCESS_KEY_ID` / `ARTDICO_OSS_ACCESS_KEY_SECRET` 只在发布 job 内映射为 `FC_ACCESS_KEY_ID` / `FC_ACCESS_KEY_SECRET`，无需重新提供。此举扩充同一 GitHub 部署身份对**一个函数**的代码更新与验收权限；FC 运行角色和私有 OSS 权限仍独立设置。不要把部署密钥放进 FC 环境变量、网页或聊天。

控制台可通过函数详情的 **复制 ARN** 核对 UID。它与 RAM 用户 ID、AccessKey ID 不同。模板不可原样粘贴未替换的 UID。官方[权限示例](https://help.aliyun.com/zh/functioncompute/policies-and-sample-policies)列有函数及触发器 ARN，但部分单项 API 自动生成权限表列为 `*`；本项目先采用精确资源，实际授权结果须验证。若被拒绝，保留固定错误并核对对应 action / ARN，不自动扩大为通配资源。

## 首次与日常发布验收

本次首次发布已获用户授权，后续正常发布不另设逐次确认门槛。完成检查和审阅后合并到 main，由 main push 自动重复发布流程；不需要每次手传 ZIP。工作流不会创建函数、变更启动命令、环境变量、角色、DNS、触发器或别名；它先读取并核对这些前置条件，只提交 `UpdateFunction({code:{zipFile}})`。

管理请求使用固定香港端点 `https://fcv3.cn-hongkong.aliyuncs.com`、FC `2023-03-30` API 和 ACS3 签名。读取到的完整函数环境设置仅留在内存中比较，不输出到日志、artifact 或摘要。函数 ARN 必须精确匹配配置 UID、地域与 `artdicohost-api`，并在写入前检查当前 main 仍为本运行提交。

签名健康检查采用[现行 fcapp.run HTTP trigger 契约](https://help.aliyun.com/zh/functioncompute/configure-signature-authentication-for-http-triggers)：ACS3、`x-acs-date`、选用 `x-acs-security-token`，payload 参数为空字串；按官方示例仅签这些头，不添加管理 API 的 action / version / nonce、MD5、content-type 或 SHA256(empty)。现有客户端仍绑定认证 GetTrigger 回传的精确香港 HTTPS origin，再请求 `GET /healthz`。旧 `FC ...` / Date / x-fc-* 实作来自 `2016-08-15` / proxy 范围文档，与现行契约不一致。独立官方 SDK `@alicloud/openapi-util@0.3.3` 的 AK / STS 固定向量已纳入测试，没有增加项目依赖；旧算法测试不能证明当前服务规格，后续成功基线已实测现行签名，不将契约不一致写成所有 400 的唯一原因。

上传前先读取 GetFunction，并对既有签名 `/healthz` 进行一次有界的只读观察；仅投影枚举状态、通过完整格式校验的旧 `sourceCommit` 或固定诊断，不输出 URL、环境、角色、凭证或原始回应。状态字段 presence 只可为 `absent`、`null`、`recognized`、`unrecognized`，任意未知值不回显。官方 function state 的处理中值为 `Pending`，`Creating` 属 reason code；本轮补上 `Pending` 阻挡，并保守保留对旧 `Creating` 值的阻挡，`InProgress` 更新也拒绝新上传。观察不代表前次已完整验收，也不计入新版本成功。随后重新核对当前 main，为该次新提交上传一次已验收包，禁止自动重试 PUT。

UpdateFunction 的请求期限固定为 **180 秒**；GetFunction、GetTrigger 与签名 health 保持 **20 秒**，总部署期限固定为 **240 秒**。最慢上传完成后仅剩约 60 秒供检查，仍受总部署硬上限约束，不续延或放宽验收。这些是客户端等待期限，不改变 FC 函数执行超时或其他控制台设置。延长上传等待不放宽成功状态、配置保持与源码一致条件，也不增加调用权限。

2026-10-20：[发布 39385459715](https://github.com/kunanli/artdicohost/actions/runs/39385459715) 的 `61ffff501b87271ce5e1e5df5f6374078865b1ab` 已通过 305 项检查与 15 个公开 OSS SHA-256 回读，但约 39.3 MB 更新在旧 120 秒期限失败，`uploadBodyWritten:false / responseStarted:false`。随后[只读运行 39386185017](https://github.com/kunanli/artdicohost/actions/runs/39386185017)三次签名均为上一提交 `9900c15a9c0dbae0187661b71006ff7362e5a15e`，CRC64 前后相同，因此该次 FC 验收明确失败。`false` 不代表零字节送出，也没有证明 FC 端根因。新版本使用 64 KiB 固定分段和 writable 背压，保留签名字节、Content-Length 与单一 PUT，配合上述固定等待预算改善大型上传；中止或提前完整响应后停止继续排队。后续必须由正常新 main 运行实测，不能将本机测试称为修复已经在线生效，也不盲重跑该旧运行。

本轮仅将代码 PUT 的默认传输改为 native HTTPS，端点、method 与已签名的 JSON bytes 保持一致，继续验证 TLS，并明确设置按 UTF-8 bytes 计算的 `Content-Length`；不跟随 redirect、不重试、不增加第二次 PUT。仅对该 transport 自建 Promise 的私有 WeakMap 记录两个布林：`uploadBodyWritten` 表示本机 `finish` 已发生，`responseStarted` 表示响应已开始；前者不是 FC 接收或确认。没有证据显示原 fetch 的 Content-Length 错误，后续基线已取得单次 native PUT 成功确认及签名健康结果；这不改变本机写完与服务端确认的区别。

更新必须取得本次 UpdateFunction HTTP 200 确认。生命周期字段存在时仍须 FC `state:Active` / `lastUpdateStatus:Successful`；仅当两个 own 字段各自均为 absent/null 时可进入同样的实际健康核验，不能从缺失推定状态。该路径成功明确标记 `functionMetadata:not-reported`，未知值、单字段缺失、显式失败及处理中均不允许采用此路径。通过原签名认证触发器检查 `GET /healthz`，连续三次确认 HTTP 200、`status:ok`、`scope:process-only` 和准确 `sourceCommit`；每次符合时输出固定的 `match N/3` 日志与本次完整提交，不匹配即重置连续计数。签名错误、权限不足、旧实例、错误状态或配置改变均不能报告发布成功。模板中的 `InvokeFunction` 供签名 HTTP 健康检查使用。FC 的 `codeChecksum` 是 CRC64，本流程不把它称为 SHA-256 回读；实际 ZIP 在本机及 artifact 核对 SHA-256，线上验证为签名请求返回的进程源码标记。

开关未启用时，发布 job 跳过，摘要明确写为未更新 FC；不能仅凭工作流整体绿色就说 API 已部署。启用后查看 **Update the isolated Hong Kong FC startup code** job 及其摘要，不以网站 OSS job 成功替代。当前尚无该 job 的实际云端成功证据。

自动更新的仍是[FC 启动验收包](fc-startup-preflight.md)：`/api/health`、报名及后台写入保持 503。它没有 OSS 读写、正式报名、名单迁移、公开资料审核、报名统计、Wallet 签名或 EmailJS 投递能力。

## 本地验证记录

- 初版历史记录：165 项测试、源码检查、Astro 检查及四页静态构建通过，依赖审计无已知漏洞；不作为紧凑包当前测试结果。
- 初版历史 ZIP 的源码提交为 `56f22f4b47720e2ba128d34c014b8c24e55734dc`，大小 44,329,599 bytes，SHA-256 `945bca020392863bece7c1cd5c88ebd585dff9d7d5dd2b3dabc6f73b3311c67e`。该版直接携带未压缩 Node，在固定 Debian 11 镜像 `debian@sha256:e5b6442dd2e9684cf5e87d8338b5968f3b348636fc0be6d7850a381e3731a2bd` 中启动成功；它不是本轮六文件 XZ 包，也不是 FC 云端验收证据。
- PR #12 前阶段本机来源 `d52ef96a40fe5a10538f92ad0d2911f813d449fa`：195 项测试、源码与 Astro 检查、四页构建及依赖审计通过。准确 ZIP 为 29,507,159 bytes，JSON 请求为 39,342,903 bytes，本机 ZIP SHA-256 为 `723953ef90b0f3bbff98cd769b518f3f96006b31d79935a63071bbf84d25f972`，Python 离线夹具为 10.999 秒。这个 hash 只描述该本机来源的包，不能当作合并提交包的 hash、远端 SHA-256 回读或 FC CRC64。
- PR #12 合并提交的 CI 为 195 项检查及实际 ZIP smoke 通过，夹具为 5.506 秒；其后期限 / 只读观察阶段本机 203 项测试、源码 / Astro 检查、四页构建及依赖审计通过。最新 main `dff3c897bdadfbe555459366183ccab1fbca0195` 的 CI 为 203 项测试及 6.395 秒 smoke 通过，FC 仍在 120 秒后超时。本轮签名 / 上传诊断的本机 221 项测试、源码 / Astro 检查、四页构建及依赖审计通过，独立安全审阅无阻挡问题；其中健康签名 client 测试 19 项及独立官方 SDK 向量已通过。
- 夹具仅模拟 FC 文档中的解释器路径，允许仅在私有 `/tmp` 写入解压后的 Node，不能替代实际 FC 签名验收；本轮没有改变 runtime 源码、IAM、后台 / 报名、私有 OSS / 统计或群码 / 提醒，正式业务路由继续 503。
- 本节记录的本地验证未使用阿里云凭据、执行 FC 更新或验证实际账号的签名 / RAM 相容性。用户已授权首次发布，线上结果须另行记录，不以本机或合成测试替代。

## 失败、并发与回退

工作流串行执行 main 运行，首次写入前再次拒绝过时 main。它不能对控制台或其他部署工具提供原子互斥；此阶段不宣称已取得 FC 2023 的 If-Match 更新保证。发布期间避免手改函数配置；检测到设置变化会失败，保留现场，不用自动还原去覆盖可能合法的新设置。

改错代码时，以 revert PR 合并到**当前 main**，让正常流程为新提交生成、验收并部署回退包；不能重跑旧 SHA 绕过当前 main 检查。artifact 只保留 14 天，需长期回退时在受控位置保留已验收 ZIP / manifest，或从已审核源码重新构建。首次接入前没有已验收的本站版本，启动失败时继续保持签名认证、不开正式表单，按固定错误检查；必要时禁用尚未投入使用的函数。

关闭 `ARTDICO_FC_DEPLOY_ENABLED` 可停止后续自动更新，不会撤回已上传代码、禁用函数或撤销角色。取消 / 失败发生在 PUT 之后，FC 可能已更新；须核对实际健康标记，不能把失败的流水线等同于未变更。

本阶段无真实报名数据写入，无需从本包迁移或删除报名记录；39 笔原始联系人继续本机保留。未来正式资料服务另设独立备份 / 删除与受控恢复流程，不将业务数据放入 GitHub artifacts。

## 官方核对来源

- [FC 管理端点](https://help.aliyun.com/en/functioncompute/api-fc-2023-03-30-endpoint)、[GetFunction](https://help.aliyun.com/en/functioncompute/api-fc-2023-03-30-getfunction)、[GetTrigger](https://help.aliyun.com/zh/functioncompute/api-fc-2023-03-30-gettrigger)
- [管理 API ACS3 签名](https://help.aliyun.com/zh/functioncompute/signature-mechanism)、[现行 HTTP trigger 签名](https://help.aliyun.com/zh/functioncompute/configure-signature-authentication-for-http-triggers)、[官方 OpenAPI util](https://github.com/aliyun/darabonba-openapi-util/blob/master/ts/src/client.ts#L459)
- [旧 2016-08-15 / proxy 签名（历史范围）](https://help.aliyun.com/zh/functioncompute/signature-authentication)、[HTTPTriggerConfig](https://help.aliyun.com/zh/functioncompute/api-fc-2023-03-30-struct-httptriggerconfig)
- [代码包限制](https://help.aliyun.com/zh/functioncompute/limits-of-usage)、[Function 更新状态与 checksum](https://help.aliyun.com/zh/functioncompute/api-fc-2023-03-30-struct-function)
