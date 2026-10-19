# 阿里云 OSS 静态预览发布

记录日期：2026-10-19（Asia/Taipei）。用户已在中国香港创建 `artdicohost-web-hk`，并确认 AccessKey 已存在 GitHub Actions Secrets。日常发布使用 [自动部署说明](automatic-deployment.md)，域名和证书按 [域名与 HTTPS 操作单](domain-https.md) 处理。无需再创建 bucket、索取金钥或手动上传旧 ZIP。

最新状态：PR #3 已合并，main 提交为 `074826f1d9a218df1371b6bd0cf3ac74776ec2eb`。[Actions 39239493108](https://github.com/kunanli/artdicohost/actions/runs/39239493108) 的检查、部署及公开回读步骤均成功；用户确认 11 个公开文件通过 SHA-256 回读。后续截图显示阿里云 `@` CNAME 已启用、TTL 10 分钟，`artdico.host` 的 OSS 绑定生效且未开启 CDN；用户回报证书已配置，HTTPS 页面可正常显示。独立线上脚本、全部资源及跨浏览器验收尚未完成，证书签发者与到期日待记录。

当前用户授权的双活动白蓝视觉升级仍在本地，不属于上述已发布版本；本轮没有触发新部署。

## 当前资源与发布范围

| 资源 | 用途与状态 |
| --- | --- |
| `artdicohost-web-hk` / `cn-hongkong` | 用户已建立的独立公开静态桶；固定部署目标 |
| 公开前台与 `/invitation/` | Astro 静态内容及浏览器图片预览；本地改版采用已确认日期、时段与场地，楼层及个别安排仍待确认；线上仍为上述已部署提交 |
| `/admin/`、`/admin/contacts/` | 发布包替换为云端后台尚未开放说明，不包含本机登录表单 |
| 本机内容 API / 39 笔真实联系人 | 保留本机；开发使用示范资料，不进入 Git、CI、公开对象或本次部署 |
| 正式报名、云端工作人员后台 | 尚未接通；普通报名是明确标识的未提交演示 |
| Apple Wallet / EmailJS | 接入准备与预览；没有签发 `.pkpass` 或实际投递 |

静态桶不会运行本机 Node 服务，见 [OSS 静态网站说明](https://www.alibabacloud.com/help/en/oss/user-guide/hosting-static-websites)。未来真实报名和异地后台仍须使用独立 FC 与独立私有 OSS 数据桶，不能将公开桶的 `private/` 前缀当作数据隔离，也不能直接公开转发本机后台。

## 已有 bucket 的核对单

以下是配置核对，不是再次创建资源或自动修改控制台：

1. 核对当前 bucket 确为 `artdicohost-web-hk`、地域 `cn-hongkong`，与 IGDA 正式站完全独立。
2. 仅公开静态桶允许匿名读，不允许匿名写。部署程序继承现有 ACL，不修改桶权限；私有数据桶绝不套用公共读。
3. 静态首页为 `index.html`，启用子目录首页支持。错误页为实际发布的 `404.html`，错误响应保持 HTTP 404；不使用 SPA 的 200 回退。核对 `/invitation/` 能读取对应 `index.html`。
4. 只更新本项目发布清单中的文件，不执行全桶同步删除。发现未知对象时先核实归属，不将其当成可清理的旧构建。
5. 部署 RAM 身份仅获该网站桶对象的 `oss:PutObject`，策略见 [oss-upload-policy.json](../deploy/oss-upload-policy.json)。DNS、证书和私有数据不由这套上传凭据管理。

香港 OSS 域名绑定的接入条件见 [官方说明](https://www.alibabacloud.com/help/en/oss/user-guide/access-buckets-via-custom-domain-names)；本次纯静态预览不包含个人资料上云，未来数据地区和个人资料处理须独立核定。

## 准备可审阅的公开产物

源码检查、类型检查、测试、构建和依赖审计全部通过后，CI 执行 `scripts/prepare-oss-site.mjs`：

- 仅选取活动前台、邀请函页面及它们引用的公开素材。
- 替换本机管理路由；拒绝意外路径、符号链接及部分可识别的秘密格式。
- 生成文件清单和 SHA-256；部署时再次检查提交、目标桶、路径、大小及校验值。

部署任务下载本次运行的 `oss-publication-<完整提交 SHA>` artifact；不会重新安装构建依赖或上传仓库根目录。`frontend-check-output` 中的完整 `dist/` 仅供开发检查，不能直接当公开发布包。

需要本地查看公开包时，在目标提交成功完成构建后，为每次检查选择一个新的空输出目录：

```sh
GITHUB_SHA="$(git rev-parse HEAD)" node scripts/prepare-oss-site.mjs .local-data/oss-review
```

该命令只在本机准备文件，不上传 OSS。目标目录已包含文件时程序会拒绝覆盖，应另选空目录；不要递归删除不明路径。审阅 `publication-manifest.json` 与公开页面后再决定发布。旧的 `artdico-oss-preview.zip` 只代表历史视觉快照，不能用于本次发布或证明新提交已上线。

## 已完成发布与后续独立验收

PR #3 合并和上述 main push 发布已完成，无需重建桶、重填 Secrets 或重跑部署。后续源码更新仍由 main push 自动检查、发布和回读；手动 workflow_dispatch 只检查。

阿里云 DNS、OSS 绑定与证书配置已有截图或用户回报，不重复执行首次接入。后续依 [域名与 HTTPS 操作单](domain-https.md) 补齐证书详情，再使用无密钥的线上检查脚本核对域名、版本、路由和资源，分别记录桌面、手机与微信真机体验检查；窄屏桌面浏览器不能代替微信真机验收。若需要继续控制台操作，仍每次只指导一个步骤，等待用户完成后继续。

原生 OSS endpoint 的公开读取校验只证明文件内容可读；浏览器可能下载 HTML，不能作为自定义域名已正常打开网页的证据。环境出口受限时记录「未能验证」，不推断网站故障。

## 回滚与私密数据

网站回滚通过修复 / 回退 PR 合并到 main，由同一流程重新构建、上传和验证；旧提交的运行不能在 main 已更新后重新覆盖当前版本。发布不删除未知旧对象，若曾公开了必须撤回的独立文件，另按准确清单处理，不清空整个桶。

DNS 回退只恢复本次修改的网页 / 验证项，保留邮件及其他记录，重新检查解析与证书。代码回滚不覆盖本机数据。联系人受限备份、删除和恢复按 [本地联系人](local-contacts.md#备份删除和恢复) 执行，内容恢复见 [本地内容后台](local-content-backend.md#本地恢复和删除)；恢复旧数据后仍须重放后续已确认的撤回 / 删除要求。

未来私有桶和 FC 接通后，另行验收鉴权、服务端校验、幂等、防覆盖、跨实例并发、备份与删除。Wallet 签名和 EmailJS 实际发信分别验收，不随静态站上线而改变准备状态。
