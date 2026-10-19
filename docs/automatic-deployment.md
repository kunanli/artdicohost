# GitHub 自动更新香港 OSS

用户已创建独立网站桶 `artdicohost-web-hk`，地域为中国香港，并于 2026-10-19 确认 AccessKey 已保存于 GitHub Actions Secrets，由部署流程使用。日常发布通过 GitHub 自动更新，不再手动上传 ZIP。本阶段只发布静态前台及图片邀请函生成器；本机 39 笔真实联系人、真实报名、工作人员数据 API、Wallet 签名和邮件投递不随本流程上线。开发和验证只使用示范资料。

## 本次核对结果

核对日期：2026-10-19（Asia/Taipei）。这是接续开发开始时的快照，后续提交须以对应 Actions 结果为准。

| 项目 | 已取得的证据 |
| --- | --- |
| [PR #3](https://github.com/kunanli/artdicohost/pull/3) | open、尚未合并；分支 `feat/creative-gathering-frontend` |
| 已核对的分支提交 | `35e85a0ed53b84b33100e55625eb659efb22babb` |
| [Actions 39212607866](https://github.com/kunanli/artdicohost/actions/runs/39212607866) | `check` 成功；`Publish public site to Hong Kong OSS` 为 `skipped` |
| main 自动发布记录 | 当时仓库 Actions 共 9 次，全部由 `pull_request` 触发，没有 main push 部署记录 |
| AccessKey | 用户确认已配置；不读取、不复制到本机，也不以 Secrets 存在推断 RAM 权限已验证 |
| OSS 对象上传 / 自定义域名 / HTTPS | 尚无本流程部署成功的证据；本环境的目标域名请求受出口代理限制，不能据此判定站点故障或可用 |

所以当前状态是「PR 检查通过、自动部署待合并触发」，不是部署失败，也不是已经上线。首次合并属于公开发布的最后决策；保持 PR 未合并，完成可审阅变更后再由用户决定。

## 更新流程

修改源码并建立 PR → 安装冻结依赖、源码检查、类型检查、测试、构建及依赖审计 → 合并到 `main` → GitHub Actions 自动上传和校验。

PR 不取得部署金钥，也不上传 OSS。部署目标固定为本项目网站桶，更新公开文件，不执行全桶同步删除。构建结果经 `prepare-oss-site.mjs` 选取公开页面和可达素材，移除仅适用于本机服务的后台登录界面，改为明确的后台尚未上线说明。不能直接上传完整 `dist/` 代替这个步骤。

先上传素材，再更新子页面，最后更新首页并写入公开版本凭证 `release.json`；全部上传与公开 SHA-256 读取验证完成后，工作流才报告发布成功。它不是整站原子切换，失败时部分页面可能已更新，需根据失败步骤重试或回退。main 运行共用串行队列，在首次写入前核对当前 main；过时或无法核对的运行拒绝上传。手动 `workflow_dispatch` 仅执行检查，不会部署；对 PR 重新运行检查也不会触发部署。

## 一次性授权

用户已完成 Secrets 设置，不需要重新提供金钥。下列保留为维护和轮换说明；部署是否有足够权限，应由首次获授权的 main 部署实际验证。当前开发环境没有阿里云或 DNS 控制台身份，GitHub 连接也不提供读取 Secret 值的能力。

1. 在阿里云 RAM 创建本项目专用用户，例如 `artdicohost-github-deploy`，并为其建立 AccessKey。
2. 创建自定义权限策略，使用仓库中的 [`deploy/oss-upload-policy.json`](../deploy/oss-upload-policy.json)，只授权本网站桶对象的 `oss:PutObject`。将策略授予这个专用用户。该身份没有其他项目、私有资料桶、IAM、DNS 或删除对象的权限。
3. 打开 [本仓库 Actions Secrets](https://github.com/kunanli/artdicohost/settings/secrets/actions)，新增以下两个 **Repository secrets**：

| 名称 | 内容 |
| --- | --- |
| `ARTDICO_OSS_ACCESS_KEY_ID` | 上述专用 RAM 用户的 AccessKey ID |
| `ARTDICO_OSS_ACCESS_KEY_SECRET` | 对应的 AccessKey Secret |

4. 用户决定将部署 PR 合并到 `main` 后，查看该次 **push** 运行中的部署 job，不能只看 workflow 总结为绿色。成功记录必须包含目标提交、实际上传及公开回读结果。今后合并更新自动重复同一流程。

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

以上桶和控制台状态由用户提供的截图确认，不表示首次自动部署已执行成功。Secrets 缺失、RAM 无权限、上传失败或读取内容校验失败均应明确失败，不能写成已上线。上传失败时先核对 job 的安全错误说明与受控控制台，不输出完整 CLI 原始诊断或 Secret 值。

OSS 原生桶域名可能让浏览器下载 HTML；上传成功后仍需将 `artdico.host` 绑定到 OSS 并配置 HTTPS，才能正常浏览。DNS 与证书属于首次接入，后续修改网页不用重复设置。见 [OSS 自定义域名官方说明](https://www.alibabacloud.com/help/en/oss/user-guide/access-buckets-via-custom-domain-names)及 [域名和 HTTPS 操作单](domain-https.md)。

## 发布成功后的独立验证

公开 `release.json` 仅记录发布提交和公开文件校验值，不包含环境变量或私密资料。发布完成后在可访问目标域名的环境使用 `scripts/check-live-site.mjs` 核对 HTTPS、HTML 响应类型、发布提交及资源校验；准确命令见 [域名和 HTTPS 操作单](domain-https.md)。GitHub 上传回读通过和浏览器自定义域名可用是两项独立结果，须分别记录。

若 main 的当前提交首次部署失败，可在修正 Secrets / RAM 后重新运行同一 **push** 的失败 job；若 main 已有更新，旧运行会被拒绝，应检查最新 push 的结果。代码问题用修复 PR 合并产生新的 push，不修改工作流绕过分支限制。

## 回退和数据边界

网站更新出现问题时，回退有问题的源码提交，再合并到 `main`，由相同流程重新构建与上传。发布不删除未知旧对象；若曾公开过需要撤回的独立页面，应另行按准确对象清单处理，不能以一次源码回退代替内容撤回。

静态包不包含原始 Excel、联系人、联系方式、私人邀请图片、环境文件、账号摘要、日志或备份。数据备份和删除仍按 [本地联系人说明](local-contacts.md)执行。未来正式接入 FC 时，另行实现云端身份、校验和私有 OSS 持久化，不把本机文件服务直接公开。
