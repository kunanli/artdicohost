# artdico.host 域名与 HTTPS 操作单

日期：2026-10-19（Asia/Taipei）。目标为已存在的香港 OSS 网站桶 `artdicohost-web-hk`，直接托管 `https://artdico.host/`。这份操作单提供可执行顺序；本环境没有阿里云 / DNS 控制台身份，尚未修改 DNS、绑定域名或部署证书。当前出口代理限制目标域名访问，不能把请求受阻解读为域名或 HTTPS 故障。

GitHub Actions Secrets 仅供上传工作流使用，不需要把 AccessKey 取回本机，也不能用现有 `oss:PutObject` 身份管理 DNS 或证书。上线顺序与准确部署证据见 [自动部署说明](automatic-deployment.md)。

## 1. 保留现有 DNS，确定权威服务商

先在 Namecheap 的 **Domain List → artdico.host → Manage** 查看 Nameservers，并保存当前网页及邮件记录。Namecheap 是注册商不代表一定是权威 DNS；只有当前使用其 BasicDNS / FreeDNS / PremiumDNS 时，才在 Namecheap **Advanced DNS** 新增下表记录。否则到实际权威服务商采用其支持的 apex 接入方式。

保留 MX、SPF、DKIM、DMARC、CAA 及无冲突 TXT。仅在核对之后处理相同 Host 的旧网页 A / AAAA / CNAME / URL Redirect；不更换整组 Nameservers，不清空整区 DNS，不硬编码 OSS 解析出的 IP。

## 2. 先在现有 OSS bucket 绑定域名

在 OSS 控制台打开 **artdicohost-web-hk → Bucket Settings → Domain Names**，添加 `artdico.host`。如要求验证所有权，复制控制台实际提供的 TXT Host 和值，到权威 DNS 保存，再回 OSS 验证；不要填写示例 token。验证通过后完成域名绑定。

在该 bucket 的 **Overview → Access Over Internet** 复制控制台提供的 **CNAME Domain Name** 或已核对的公开 Bucket Domain Name。使用控制台显示的准确值，不将 API endpoint `oss-cn-hongkong.aliyuncs.com` 当作网站目标，也不复制 IGDA 地址。官方要求先绑定 bucket，之后才添加域名解析；详见 [OSS 自定义域名](https://www.alibabacloud.com/help/en/oss/user-guide/access-buckets-via-custom-domain-names)。

## 3. 根域名及可选子域名记录

以下是待控制台核对的变更表，不表示已保存或生效：

| 用途 | Host | 类型 | Target / Value | 当前状态 |
| --- | --- | --- | --- | --- |
| 根域名网站 | `@` | Namecheap `ALIAS` | 从现有 bucket 控制台复制的准确 CNAME / 公开域名 | 待核对与设置 |
| OSS 所有权验证（如要求） | 控制台提供的准确 Host | `TXT` | 控制台提供的值 | 待控制台结果 |
| 证书验证（如要求） | 证书服务提供的准确 Host | 服务指定类型 | 服务提供的值 | 待证书申请 |
| 可选预览 | `preview` | `CNAME` | 与该 bucket 绑定匹配的准确目标 | 默认不新增 |
| 可选 www | `www` | `CNAME` | 与该 bucket 绑定匹配的准确目标 | 默认不新增 |

Namecheap 官方支持用 ALIAS 接入根域名，限其 BasicDNS / FreeDNS / PremiumDNS；`@` 不使用普通 CNAME。ALIAS 目标填主机名，不带 `https://` 或路径，并处理同 Host 的旧网页冲突记录；见 [Namecheap ALIAS](https://www.namecheap.com/support/knowledgebase/article.aspx/10128/2237/how-to-create-an-alias-record/)。

若需要 `preview.artdico.host` 或 `www.artdico.host`，它们必须分别在 OSS 完成绑定并配置匹配证书；仅把它们 CNAME 到已绑定的根域名，不能代替 OSS 的 Host 绑定。DNS 解析不执行浏览器 301 转址。当前先完成用户要求的根域名，额外主机名按实际需要加入。

## 4. 在 OSS 托管匹配证书

先核对域名是否已有 CDN 加速。本操作单默认直接访问 OSS，不开通额外 CDN 资源：

1. 在证书服务中使用已签发、有效且覆盖 `artdico.host` 的证书。若需申请，依实际服务的所有权验证完成签发；先核对免费 / 现有方案与费用，不擅自购买。证书私钥只在受控证书服务中处理，不放聊天、Git、CI artifact 或公开 bucket。
2. 在 OSS 的域名列表找到 `artdico.host`，打开 **Certificate Hosting**，选择有效的匹配证书并完成托管。若列表不可选，核对证书账号、签发状态及覆盖域名。
3. 在有效期内验证完整证书链和域名匹配。若另有 www / preview，逐个检查，不把根域名证书默认当成覆盖全部子域名。
4. 记录签发者、覆盖域名、到期日和续期负责人；证书续期后须更新实际托管并重新验证，不能只完成证书签发。

若该域名实际已使用 CDN，证书应配置在 CDN 控制台；OSS 的证书托管不会替 CDN 节点提供证书。配置位置和验证方法见 [OSS HTTPS 官方说明](https://www.alibabacloud.com/help/en/oss/user-guide/access-oss-by-https-protocol)。

HTTPS 可用与 HTTP 自动跳转是两项不同配置。直接 OSS 不提供原生强制 HTTP→HTTPS 转址；官方支持用 bucket policy 拒绝 HTTP，或在 CDN 配置转址。先验证 HTTPS，再按实际需求核对已有桶策略或额外服务，不能用 DNS / HTML 假装完成传输层转址，也不因 HTTPS 接入自动购买 CDN。

## 5. 发布后验证

先确认 main **push** 的部署 job 成功，再记录该次完整提交 SHA。在可访问目标站点的环境运行本仓库无密钥检查脚本，将下方 `DEPLOYED_COMMIT_SHA` 替换为实际成功部署的完整 40 字符 SHA：

```sh
node scripts/check-live-site.mjs https://artdico.host DEPLOYED_COMMIT_SHA
```

脚本严格验证 TLS，拒绝转址和 HTML 强制下载，核对 `release.json` 中的提交、白名单公开文件的 SHA-256 / MIME、子目录路由与随机不存在路径的 404；结束时再次确认版本凭证未改变。`release.json` 在首页更新后最后写入，只含提交和公开文件校验值。脚本不读取部署凭据。

如 www 仅用于转址，另查其响应与 Location，内容校验仍直接对预期正式主机 `artdico.host` 执行。遇到网络、证书、版本或路由错误时保留失败结果；出口代理拒绝访问仅记录为该环境无法验证，不写成已通过或已证明站点故障。

同时人工核对：

- `https://artdico.host/` 在浏览器渲染，HTML 响应为 `text/html`，不被 `Content-Disposition: attachment` 强制下载。
- `/invitation/`、公开图片、CSS / JavaScript 正常；`/admin/` 与 `/admin/contacts/` 仅显示后台未开放说明，不要求本机账号。
- 不存在的随机路径返回 HTTP 404，子目录首页规则有效。
- 桌面、手机宽度与实际微信浏览器的导航、日程、演示表单和邀请函下载交互；报名保持未提交，Wallet / EmailJS 保持准备状态。

原生 OSS endpoint 的 SHA-256 回读证明公开文件一致；自定义域名检查证明实际访问入口可用；手机 / 微信真机验收证明目标浏览器体验。三者分别记录，不能互相代替。

## 6. 完成记录与回退

| 项目 | 实际结果 |
| --- | --- |
| 公开部署提交 / Actions URL | 待首次获授权 main 发布 |
| 权威 Nameservers / DNS 修改时间 | 待控制台核对 |
| 根域名实际 ALIAS 目标 / TTL | 待控制台核对 |
| OSS 域名绑定 / 所有权验证 | 未在本环境执行 |
| 证书覆盖 / 到期日 / 托管位置 | 待控制台核对 |
| HTTPS、版本与公开资源检查 | 待可访问环境执行 |
| 桌面 / 手机 / 微信真机 | 按实际检查分别记录 |

保存变更前的 DNS 记录与域名绑定状态。解析错误时只恢复本次网页 / 验证项；证书错误时恢复此前有效的证书配置。移除新建的 OSS 域名绑定时同时处理对应解析，避免悬空记录；不要解除与本次无关的域名或删除邮件记录。网页版本回退按 [自动部署说明](automatic-deployment.md#回退和数据边界) 走新的 main 发布，不覆盖任何私密数据。
