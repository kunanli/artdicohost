# GitHub 自动更新香港 FC

日期：2026-10-19（Asia/Taipei）。用户已建立香港 `artdicohost-api`，要求参照 `kunanli/artdico-deck` 自动更新。本变更准备检查、打包、精确代码更新及签名健康检查；**尚未合并、授权 FC 权限或执行本项目的云端更新**。函数目前仍是 Python 示例。私有 OSS 已建不等于正式 API 可用。

## 采用的模式

只读参考 [artdico-deck@5154ad2 的工作流](https://github.com/kunanli/artdico-deck/blob/5154ad2aa1c568e6f3c08bd67681557d5a7bf6b9/.github/workflows/build-backend-zip.yml)与[部署说明](https://github.com/kunanli/artdico-deck/blob/5154ad2aa1c568e6f3c08bd67681557d5a7bf6b9/docs/guides/BACKEND-DEPLOY.md)：main 更新既有函数代码，之后核对线上版本。没有复制参考项目的源码、身份、函数、私有资料或 Node 20 运行时。

本项目保留当前 main 检查和 artifact 发布模式：PR 只有检查，主分支发布不重新打包已验收的 ZIP。所有 main push 先完成既有检查，再生成与该完整提交绑定的 FC 包，以无网络、只读、非 root 的 Debian 11 容器运行实际 ZIP；保留 `fc-publication-<SHA>` artifact 14 天。发布任务重新核对 ZIP 内容、官方 Node 二进制校验值、源码提交与 manifest，上传内存中已核对的同一份 ZIP bytes。大二进制不写回 Git。

网站 OSS 与 FC 是独立 job、独立验收，不是联合原子部署；一方失败不代表另一方已回退。原网站部署保持既有目标与权限。PR、手动 `workflow_dispatch`、错误仓库 / 分支、缺少开关或过时 main 运行都不能执行 FC 更新。

## 一次性控制台设置

1. 在香港 `artdicohost-api → 弹性配置` 将最小实例数设为 `0`，其他当前资源规格可先沿用。缩至零允许冷启动，不代表完全无费用。
2. 在 **配置 → 运行时配置** 保留自定义运行时 Debian 11，启动命令使用命令模式 `/code/bootstrap`，监听端口 `9000`，执行超时 `60` 秒；启动参数留空。触发器仍为 `defaultTrigger`、`LATEST`、HTTP 签名认证，允许 `GET`。不新增环境变量或改为匿名认证。启动命令保存后，在首次本项目 ZIP 部署前原 Python 示例无法按新命令启动，这是首次接入的暂态；当前函数尚未承接正式业务。
3. 在阿里云 RAM 找到**与 GitHub 现有部署 Secrets 对应的专用部署用户**。不要凭名字猜测身份或取回 AccessKey 值。建立自定义策略，例如 `artdicohost-fc-update`，从[权限模板](../deploy/fc-update-policy.template.json)替换所有 `<ALIYUN_ACCOUNT_ID>` 为本账号 UID，核对地域与函数后授予该用户。不要给其他项目身份、`AliyunFCFullAccess` 或私有资料桶权限。
4. 在 [GitHub Actions Variables](https://github.com/kunanli/artdicohost/settings/variables/actions) 建立以下 **Repository variables**；它们不是 Secret：

| 名称 | 值 |
| --- | --- |
| `ARTDICO_FC_ACCOUNT_ID` | 与 RAM 策略及函数 ARN 一致的本账号 UID，纯数字 |
| `ARTDICO_FC_DEPLOY_ENABLED` | `true` |

现有 Secrets `ARTDICO_OSS_ACCESS_KEY_ID` / `ARTDICO_OSS_ACCESS_KEY_SECRET` 只在发布 job 内映射为 `FC_ACCESS_KEY_ID` / `FC_ACCESS_KEY_SECRET`，无需重新提供。此举扩充同一 GitHub 部署身份对**一个函数**的代码更新与验收权限；FC 运行角色和私有 OSS 权限仍独立设置。不要把部署密钥放进 FC 环境变量、网页或聊天。

控制台可通过函数详情的 **复制 ARN** 核对 UID。它与 RAM 用户 ID、AccessKey ID 不同。模板不可原样粘贴未替换的 UID。官方[权限示例](https://help.aliyun.com/zh/functioncompute/policies-and-sample-policies)列有函数及触发器 ARN，但部分单项 API 自动生成权限表列为 `*`；本项目先采用精确资源，实际授权结果须验证。若被拒绝，保留固定错误并核对对应 action / ARN，不自动扩大为通配资源。

## 首次发布与验收

完成以上设置后，先取得本次可审阅变更的发布确认，再合并到 main。此后 main push 自动重复发布流程；不需要每次手传 ZIP。工作流不会创建函数、变更启动命令、环境变量、角色、DNS、触发器或别名；它先读取并核对这些前置条件，只提交 `UpdateFunction({code:{zipFile}})`。

管理请求使用固定香港端点 `https://fcv3.cn-hongkong.aliyuncs.com`、FC `2023-03-30` API 和 ACS3 签名。读取到的完整函数环境设置仅留在内存中比较，不输出到日志、artifact 或摘要。函数 ARN 必须精确匹配配置 UID、地域与 `artdicohost-api`，并在写入前检查当前 main 仍为本运行提交。

更新后等待 FC 完成，再用原签名认证触发器检查 `GET /healthz`，连续三次确认 HTTP 200、`status:ok`、`scope:process-only` 和准确 `sourceCommit`。签名错误、权限不足、旧实例、错误状态或配置改变均不能报告发布成功。模板中的 `InvokeFunction` 供签名 HTTP 健康检查使用。FC 的 `codeChecksum` 是 CRC64，本流程不把它称为 SHA-256 回读；实际 ZIP 在本机及 artifact 核对 SHA-256，线上验证为签名请求返回的进程源码标记。

开关未启用时，发布 job 跳过，摘要明确写为未更新 FC；不能仅凭工作流整体绿色就说 API 已部署。启用后查看 **Update the isolated Hong Kong FC startup code** job 及其摘要，不以网站 OSS job 成功替代。当前尚无该 job 的实际云端成功证据。

自动更新的仍是[FC 启动验收包](fc-startup-preflight.md)：`/api/health`、报名及后台写入保持 503。它没有 OSS 读写、正式报名、名单迁移、公开资料审核、报名统计、Wallet 签名或 EmailJS 投递能力。

## 本地验证记录

- 165 项测试通过，包含实际 ZIP 打包 / 解码、已提交来源绑定、独立签名向量、失效与取消、只更新代码、旧实例及触发器变化拒绝成功。
- 源码检查、Astro 检查与四页静态构建通过；依赖审计无已知漏洞。Astro 为 0 错误 / 0 警告，保留一项测试可改写为 async 的样式提示。
- 实际启动 ZIP 的源码提交为 `56f22f4b47720e2ba128d34c014b8c24e55734dc`，大小 44,329,599 bytes，SHA-256 `945bca020392863bece7c1cd5c88ebd585dff9d7d5dd2b3dabc6f73b3311c67e`。在固定 Debian 11 镜像 `debian@sha256:e5b6442dd2e9684cf5e87d8338b5968f3b348636fc0be6d7850a381e3731a2bd` 中以非 root、无网络及只读 `/code` 启动成功，源码健康标记准确，业务路由 503。此后自动化工具变更未修改这三个运行源文件；CI 会为每次准确提交重新打包并验收。
- 当前未使用阿里云凭据、执行 FC 更新或验证实际账号的签名 / RAM 相容性。线上成功结果必须由获授权的首次发布产生，不以本机或合成测试替代。

## 失败、并发与回退

工作流串行执行 main 运行，首次写入前再次拒绝过时 main。它不能对控制台或其他部署工具提供原子互斥；此阶段不宣称已取得 FC 2023 的 If-Match 更新保证。发布期间避免手改函数配置；检测到设置变化会失败，保留现场，不用自动还原去覆盖可能合法的新设置。

改错代码时，以 revert PR 合并到**当前 main**，让正常流程为新提交生成、验收并部署回退包；不能重跑旧 SHA 绕过当前 main 检查。artifact 只保留 14 天，需长期回退时在受控位置保留已验收 ZIP / manifest，或从已审核源码重新构建。首次接入前没有已验收的本站版本，启动失败时继续保持签名认证、不开正式表单，按固定错误检查；必要时禁用尚未投入使用的函数。

关闭 `ARTDICO_FC_DEPLOY_ENABLED` 可停止后续自动更新，不会撤回已上传代码、禁用函数或撤销角色。取消 / 失败发生在 PUT 之后，FC 可能已更新；须核对实际健康标记，不能把失败的流水线等同于未变更。

本阶段无真实报名数据写入，无需从本包迁移或删除报名记录；39 笔原始联系人继续本机保留。未来正式资料服务另设独立备份 / 删除与受控恢复流程，不将业务数据放入 GitHub artifacts。

## 官方核对来源

- [FC 管理端点](https://help.aliyun.com/en/functioncompute/api-fc-2023-03-30-endpoint)、[GetFunction](https://help.aliyun.com/en/functioncompute/api-fc-2023-03-30-getfunction)、[GetTrigger](https://help.aliyun.com/zh/functioncompute/api-fc-2023-03-30-gettrigger)
- [ACS3 签名](https://help.aliyun.com/zh/functioncompute/signature-mechanism)、[HTTP 触发器签名](https://help.aliyun.com/zh/functioncompute/signature-authentication)
- [代码包限制](https://help.aliyun.com/zh/functioncompute/limits-of-usage)、[Function 更新状态与 checksum](https://help.aliyun.com/zh/functioncompute/api-fc-2023-03-30-struct-function)
