# GitHub 自动更新香港 OSS

用户已创建独立网站桶 `artdicohost-web-hk`，地域为中国香港，并于 2026-10-19 确认 AccessKey 已保存于 GitHub Actions Secrets，由部署流程使用。日常发布通过 GitHub 自动更新，不再手动上传 ZIP。此流程的发布范围仅含静态前台及图片邀请函生成器；本机 39 笔真实联系人、真实报名、工作人员数据 API、Wallet 签名和邮件投递不随本流程上线。开发和验证只使用示范资料。

用户已建立香港 `artdicohost-api` 并要求参照 `artdico-deck` 自动更新 FC，沿用[独立 FC 自动更新](automatic-fc-deployment.md)的只读 PR 检查与 main 发布分离模式。运行时、精确 RAM 权限及 GitHub Variables 已配置；最近完整验收基线为 `e82762e2f86ea3663a4e3e78d0a10d0a608ef541`，[Actions 39362633747](https://github.com/kunanli/artdicohost/actions/runs/39362633747) 的公开 OSS 与 FC 两项实际发布均成功。FC 使用紧凑六文件启动包、现行 ACS3 trigger 签名及单次 native HTTPS 代码上传；GET / health、上传和总体期限及来源 / 配置门槛不放宽。云端仍是业务关闭的启动包，未接通工作人员登录、嘉宾管理、真实报名或私有 OSS / 统计。本轮嘉宾编辑及图片保存仅在独立本地内容 API 验证，不打入公开站点或 FC 启动包。

用户已授权后续正常发布：完成检查和审阅后可合并到 main 并执行自动部署，无需逐次再申请发布确认。公开稿件核准、真实资料迁移与个人信息公开 / 分享授权仍按各自要求办理；正式隐私告知及 39 笔真实联系人保留本机的边界不变。

## 本次核对结果

核对日期：2026-10-20（Asia/Taipei）。本节以最新 main 的实际日志更新历史快照；后续提交仍须以对应 Actions 结果为准。

| 项目 | 已取得的证据 |
| --- | --- |
| 公开发布基线 | 包含 `GlobalGameJam` 更名与报名准备；后台登录与寄件仍未作为云端业务开放 |
| 已验收的公开 OSS / FC 来源提交 | `e82762e2f86ea3663a4e3e78d0a10d0a608ef541` |
| [Actions 39362633747](https://github.com/kunanli/artdicohost/actions/runs/39362633747) | `push` / `main`；check `118432075926` 的 224 项测试、构建与依赖审计通过；FC `118432690825` 单次更新后连续三次签名 `/healthz` 匹配该完整提交；生命周期字段为 null，未推论 Active / Successful |
| 公开文件 | 12 个公开文件已部署至 `artdicohost-web-hk`，含最后上传的 `release.json`，全部通过 SHA-256 回读 |
| OSS 回读记录 | job `118432690875`；11:09:58–11:10:10（Asia/Taipei；日志 03:09:58–03:10:10 UTC）完成 12 次回读 |
| AccessKey | 已在 GitHub Secrets，由成功部署使用；无需重新提供，不读取或复制到本机 |
| 自定义域名 / DNS | 用户截图显示阿里云 DNS 正确、初次查看为 0 条记录；后续 `artdico.host` 的 OSS 绑定已生效，根域名 `@` CNAME 已启用，TTL 为 10 分钟；未开启 CDN |
| HTTPS | 用户回报证书已配置，`https://artdico.host/` 可正常显示；尚未运行独立线上检查，证书签发者、覆盖范围和到期日待记录 |

当前状态是「静态公开文件已部署并回读通过，域名已绑定，用户回报 HTTPS 页面可显示」。不需要再次合并 PR #3、重建 bucket 或重填 Secrets。该回报不代表版本、全部资源、证书链或所有浏览器已通过独立验收。

上述线上版本并列呈现「2026 GGJ 中国交流聚会」与「ARTDiCO HOST 学生嘉年华」，采用深灰 / 白字、少量蓝橙点缀与按需展开的精简内容。首屏 `GlobalGameJam` 更名与无公网接入的正式报名准备已随上述提交发布；内建表单仍不发送或保存资料。FC 的独立首次验收状态见[实际结果](automatic-fc-deployment.md)。

## 更新流程

修改源码并建立 PR → 安装冻结依赖、源码检查、类型检查、测试、构建及依赖审计 → 合并到 `main` → GitHub Actions 自动上传和校验。

PR 不取得部署金钥，也不上传 OSS。部署目标固定为本项目网站桶，更新公开文件，不执行全桶同步删除。构建结果经 `prepare-oss-site.mjs` 选取公开页面和可达素材，移除仅适用于本机服务的后台登录界面，改为明确的后台尚未上线说明。不能直接上传完整 `dist/` 代替这个步骤。

先上传素材，再更新子页面，最后更新首页并写入公开版本凭证 `release.json`；全部上传与公开 SHA-256 读取验证完成后，工作流才报告发布成功。它不是整站原子切换，失败时部分页面可能已更新，需根据失败步骤重试或回退。main 运行共用串行队列，在首次写入前核对当前 main；过时或无法核对的运行拒绝上传。手动 `workflow_dispatch` 仅执行检查，不会部署；对 PR 重新运行检查也不会触发部署。

## 一次性授权

用户已完成 Secrets 设置，且上述 main 部署成功，不需要重新提供金钥。下列仅保留为维护和轮换说明，不是本阶段待办。当前开发环境没有阿里云或 DNS 控制台身份，GitHub 连接也不提供读取 Secret 值的能力。

1. 在阿里云 RAM 创建本项目专用用户，例如 `artdicohost-github-deploy`，并为其建立 AccessKey。
2. 创建自定义权限策略，使用仓库中的 [`deploy/oss-upload-policy.json`](../deploy/oss-upload-policy.json)，只授权本网站桶对象的 `oss:PutObject`。将策略授予这个专用用户。当前用户另已回报向同一身份授予[单一 FC 更新与验收权限](automatic-fc-deployment.md)；不授予其他项目、私有资料桶、IAM、DNS 或删除对象权限。
3. 打开 [本仓库 Actions Secrets](https://github.com/kunanli/artdicohost/settings/secrets/actions)，新增以下两个 **Repository secrets**：

| 名称 | 内容 |
| --- | --- |
| `ARTDICO_OSS_ACCESS_KEY_ID` | 上述专用 RAM 用户的 AccessKey ID |
| `ARTDICO_OSS_ACCESS_KEY_SECRET` | 对应的 AccessKey Secret |

4. 按已授予的日常发布授权完成检查和审阅，合并到 `main` 后查看该次 **push** 运行中的部署 job，不能只看 workflow 总结为绿色。成功记录必须包含目标提交、实际上传及公开回读结果。今后合并更新自动重复同一流程，无需逐次再申请发布确认。

金钥必须成对配置。不要复用 IGDA 正式环境身份或授予 `AliyunOSSFullAccess`。权限依据单文件 [PutObject 官方说明](https://help.aliyun.com/zh/oss/developer-reference/put-object)，GitHub 的保存方式见 [Actions Secrets 官方说明](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)。

## 目标及上线状态

| 项目 | 配置 |
| --- | --- |
| 仓库 / 默认分支 | `kunanli/artdicohost` / `main` |
| 网站桶 | `artdicohost-web-hk` |
| 地域 | `cn-hongkong` |
| Endpoint | `https://oss-cn-hongkong.aliyuncs.com` |
| 对象读取 | 网站桶公共读；部署程序继承现有 ACL，不修改权限 |
| 静态页面 | `index.html`；子目录首页开启；文件 404 规则 `Index`；错误页面 `404.html`、状态码 `404` |

以上桶和静态托管配置由用户提供的截图确认，实际部署证据见本次核对结果。今后 Secrets 缺失、RAM 无权限、上传失败或读取内容校验失败均应明确失败；先核对 job 的安全错误说明与受控控制台，不输出完整 CLI 原始诊断或 Secret 值。

OSS 原生桶域名可能让浏览器下载 HTML；目前 `artdico.host` 已绑定 OSS，用户回报配置证书后 HTTPS 可正常显示。DNS 与证书属于首次接入，后续修改网页不用重复设置；独立验收与证书续期仍须记录。见 [OSS 自定义域名官方说明](https://www.alibabacloud.com/help/en/oss/user-guide/access-buckets-via-custom-domain-names)及 [域名和 HTTPS 操作单](domain-https.md)。

## 发布成功后的独立验证

公开 `release.json` 仅记录发布提交和公开文件校验值，不包含环境变量或私密资料。发布完成后在可访问目标域名的环境使用 `scripts/check-live-site.mjs` 核对 HTTPS、HTML 响应类型、发布提交及资源校验；准确命令见 [域名和 HTTPS 操作单](domain-https.md)。GitHub 上传回读通过和浏览器自定义域名可用是两项独立结果，须分别记录。

若 main 当前提交的**公开 OSS job** 部署失败，可在修正 Secrets / RAM 后重新运行同一 **push** 的该失败 job；若 main 已有更新，旧运行会被拒绝，应检查最新 push 的结果。代码问题用修复 PR 合并产生新的 push，不修改工作流绕过分支限制。FC 的上传超时属于变更结果不明，须先只读核对，再按当前 main 的修复提交正常发布，不套用这项 OSS 重跑说明去重送同一次 PUT。

## 回退和数据边界

网站更新出现问题时，回退有问题的源码提交，再合并到 `main`，由相同流程重新构建与上传。发布不删除未知旧对象；若曾公开过需要撤回的独立页面，应另行按准确对象清单处理，不能以一次源码回退代替内容撤回。

静态包不包含原始 Excel、联系人、联系方式、私人邀请图片、环境文件、账号摘要、日志或备份。数据备份和删除仍按 [本地联系人说明](local-contacts.md)执行。未来正式接入 FC 时，另行实现云端身份、校验和私有 OSS 持久化，不把本机文件服务直接公开。
