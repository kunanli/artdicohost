# GitHub 自动更新香港 OSS

用户已创建独立网站桶 `artdicohost-web-hk`，地域为中国香港。最新要求是通过 GitHub 自动更新网站，日常发布不再手动上传 ZIP。本阶段只发布静态前台及图片邀请函生成器；私有联系人、真实报名、工作人员数据 API、Wallet 签名和邮件投递不随本流程上线。

## 更新流程

修改源码并建立 PR → 安装冻结依赖、源码检查、类型检查、测试、构建及依赖审计 → 合并到 `main` → GitHub Actions 自动上传和校验。

PR 不取得部署金钥，也不上传 OSS。部署目标固定为本项目网站桶，更新公开文件，不执行全桶同步删除。构建结果会移除仅适用于本机服务的后台登录界面，改为明确的后台尚未上线说明。先上传素材，再更新子页面，最后更新首页；上传与公开读取验证完成后，工作流才报告发布成功。它不是整站原子切换，失败时子页面可能已更新，需根据失败步骤重试或回退。旧 main 运行会在写入前拒绝发布，避免覆盖较新的版本。

## 一次性授权

首次需要让 GitHub 获得这个网站桶的上传权限。当前 GitHub 连接可修改源码和 PR，但没有管理 Actions Secrets 的工具；目前也尚未取得可用于本网站桶的部署身份。用户应在阿里云和 GitHub 的受保护页面完成以下一次性设置，金钥不经过聊天、源码或公开文件。

1. 在阿里云 RAM 创建本项目专用用户，例如 `artdicohost-github-deploy`，并为其建立 AccessKey。
2. 创建自定义权限策略，使用仓库中的 [`deploy/oss-upload-policy.json`](../deploy/oss-upload-policy.json)，只授权本网站桶对象的 `oss:PutObject`。将策略授予这个专用用户。该身份没有其他项目、私有资料桶、IAM、DNS 或删除对象的权限。
3. 打开 [本仓库 Actions Secrets](https://github.com/kunanli/artdicohost/settings/secrets/actions)，新增以下两个 **Repository secrets**：

| 名称 | 内容 |
| --- | --- |
| `ARTDICO_OSS_ACCESS_KEY_ID` | 上述专用 RAM 用户的 AccessKey ID |
| `ARTDICO_OSS_ACCESS_KEY_SECRET` | 对应的 AccessKey Secret |

4. 将部署 PR 合并到 `main` 后，查看仓库 Actions 中本次运行。今后合并更新会自动重复检查、构建、上传及验证，不需要再进入 OSS 控制台上传文件。

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

以上桶和控制台状态由用户提供的截图确认，不表示首次自动部署已执行成功。实际运行的提交、构建和部署结果以 GitHub Actions 为准。Secrets 未配置、上传失败或读取内容校验失败均应明确失败，不能写成已上线。

OSS 原生桶域名可能让浏览器下载 HTML；上传成功后仍需将 `artdico.host` 或预览子域名绑定到 OSS 并配置 HTTPS，才能正常浏览。DNS 与证书属于首次接入，后续修改网页不用重复设置。见 [OSS 自定义域名官方说明](https://www.alibabacloud.com/help/en/oss/user-guide/access-buckets-via-custom-domain-names)及 [域名和 HTTPS 步骤](oss-deployment.md)。

## 回退和数据边界

网站更新出现问题时，回退有问题的源码提交，再合并到 `main`，由相同流程重新构建与上传。发布不删除未知旧对象；若曾公开过需要撤回的独立页面，应另行按准确对象清单处理，不能以一次源码回退代替内容撤回。

静态包不包含原始 Excel、联系人、联系方式、私人邀请图片、环境文件、账号摘要、日志或备份。数据备份和删除仍按 [本地联系人说明](local-contacts.md)执行。未来正式接入 FC 时，另行实现云端身份、校验和私有 OSS 持久化，不把本机文件服务直接公开。
