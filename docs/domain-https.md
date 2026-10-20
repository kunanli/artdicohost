# artdico.host 域名与 HTTPS 操作单

日期：2026-10-20（Asia/Taipei）。香港 OSS 网站桶 `artdicohost-web-hk` 直接托管 `https://artdico.host/`。最新已验公开部署为 PR #9 合并提交 `2e90103f7756acdb49cc5433a5dd6ab22500a6f2`，[Actions 39349541751](https://github.com/kunanli/artdicohost/actions/runs/39349541751) 完成 12 个公开文件上传及 SHA-256 回读。首次接入时的控制台截图显示阿里云 DNS 正确，初次查看为 0 条解析记录；现已完成 OSS 域名绑定，状态生效，未开启 CDN，根域名 `@` 的 CNAME 已启用，TTL 为 10 分钟。用户随后回报证书已配置，HTTPS 页面可正常显示。

以上浏览器成功为用户回报；独立线上脚本、版本与完整资源检查尚未执行，证书签发者、覆盖范围及到期日尚待记录。本环境没有阿里云 / DNS 控制台身份，控制台操作由用户完成；此前出口代理受限的结果不能用来判定站点故障或可用。蓝橙双活动版已完成部署；`GlobalGameJam` 首屏更名及报名准备已随上述公开提交部署；内建报名保持无传送预览，云端后台仍未开放。

GitHub Actions Secrets 仅供上传工作流使用，不需要把 AccessKey 取回本机，也不能用现有 `oss:PutObject` 身份管理 DNS 或证书。上线顺序与准确部署证据见 [自动部署说明](automatic-deployment.md)。

用户首次接入时要求一次一个步骤，后续在 FC 设置阶段已允许每次提供一组步骤。下文保留首次接入与后续维护操作单；已完成的绑定、解析和证书不重复设置。聊天指导按当前阶段分组，未取得实际结果的项保持待确认。

## 1. 保留现有 DNS，确定权威服务商

打开 [阿里云 DNS 控制台](https://dnsnext.console.aliyun.com/)，进入 **公网权威解析**，找到 `artdico.host` 并打开 **解析设置**。第一步只查看 DNS 生效提示与现有记录，等待用户回报；找不到域名或出现 DNS 未生效提示时，先核对登录账号及阿里云域名控制台中的 DNS 服务器。域名注册在阿里云不自动证明权威 DNS 已由当前账号托管，不能仅因注册商信息就更换 Nameservers。入口见 [阿里云域名解析说明](https://help.aliyun.com/zh/dws/getting-started/configure-domain-name-resolution)。

确认权威 DNS 后，在保存任何变更前备份现有网页、邮件及验证记录，记录当前 DNS 服务器。若权威 DNS 实际在其他服务商，则依据该服务商的根域名能力核对接入，不能在未生效的阿里云解析区直接新增记录并声称成功。

保留 MX、SPF、DKIM、DMARC、CAA 及无冲突 TXT。仅在核对之后处理相同 Host 的旧网页 A / AAAA / CNAME / URL Redirect；不更换整组 Nameservers，不清空整区 DNS，不硬编码 OSS 解析出的 IP。

## 2. 先在现有 OSS bucket 绑定域名

在 [OSS 控制台](https://oss.console.aliyun.com/)打开 **artdicohost-web-hk → Bucket 配置 → 域名管理 → 绑定域名**，输入 `artdico.host`。域名与 bucket 属于同一阿里云账号时可直接确认绑定；如要求验证所有权，复制控制台实际提供的 TXT Host 和值，到权威 DNS 保存，再回 OSS 验证并绑定，不填写示例 token。香港节点绑定域名不要求中国内地 ICP 备案。

在该 bucket 的 **概览 → 访问域名** 复制系统分配的 **CNAME 域名**（推荐），或已核对的 **外网访问域名**。使用控制台显示的准确完整值，不根据地域自行拼接，不将 API endpoint `oss-cn-hongkong.aliyuncs.com` 当作网站目标，也不复制 IGDA 地址。官方要求先绑定 bucket，之后才添加域名解析；详见 [OSS 自定义域名](https://help.aliyun.com/zh/oss/user-guide/access-buckets-via-custom-domain-names)与 [CNAME 专用域名说明](https://help.aliyun.com/zh/oss/user-guide/dedicated-cname-domain-best-practices)。

同账号控制台可能提供 **自动添加 CNAME 记录**；此选项会实际修改 DNS，须先完成现有记录与冲突核对，再在对应步骤指导用户操作，不能把它当作只读检查。

## 3. 根域名及可选子域名记录

以下区分已由截图确认的记录与按需验证项；CNAME 完整目标仍应从控制台复制留存，不能根据 bucket 名或地域自行拼接：

| 用途 | Host | 类型 | Target / Value | 当前状态 |
| --- | --- | --- | --- | --- |
| 根域名网站 | `@` | 阿里云 DNS `CNAME` | 控制台中的实际 CNAME 目标，完整值待复制留存 | 已启用；TTL 10 分钟；OSS 绑定生效 |
| OSS 所有权验证（如要求） | 控制台提供的准确 Host | `TXT` | 控制台提供的值 | 域名已绑定，不重复新增验证项 |
| 证书验证（如要求） | 证书服务提供的准确 Host | 服务指定类型 | 服务提供的值 | 用户回报证书已配置；保留实际验证记录 |
| 可选预览 | `preview` | `CNAME` | 与该 bucket 绑定匹配的准确目标 | 默认不新增 |
| 可选 www | `www` | `CNAME` | 与该 bucket 绑定匹配的准确目标 | 默认不新增 |

确认使用阿里云权威 DNS 后，在 **解析设置 → 添加记录** 选择 `CNAME`，主机记录填 `@`；记录值仅填上述主机名，不带 `https://` 或路径，TTL 按控制台实际值记录。阿里云官方支持根域名 `@` 的 CNAME；同名 A 等冲突记录须先核对用途再处理，不能并存或直接批量删除。若控制台提示邮件 / TXT 等记录冲突，先停下核对保留方案，不以删除邮件记录解决冲突。无需执行其他注册商的 ALIAS 操作。详见上述 OSS 官方说明中的「配置 CNAME 解析」。

若需要 `preview.artdico.host` 或 `www.artdico.host`，它们必须分别在 OSS 完成绑定并配置匹配证书；仅把它们 CNAME 到已绑定的根域名，不能代替 OSS 的 Host 绑定。DNS 解析不执行浏览器 301 转址。当前先完成用户要求的根域名，额外主机名按实际需要加入。

## 4. 在 OSS 托管匹配证书

用户截图显示未开启 CDN，当前直接访问 OSS。用户回报证书已配置并可通过 HTTPS 显示；下列步骤保留作续期或更换时的参考，不表示需要重新申请或购买：

1. 在阿里云数字证书管理服务的 **证书管理 → SSL证书管理 V2.0** 中先查看现有、有效且覆盖 `artdico.host` 的证书。若没有，可查看 **个人测试证书（原免费证书）** 的免费额度及当前条款，再完成实际域名验证；同账号 DNS 可支持自动验证。免费个人测试证书为单域名、有效期 90 天，续期与重新托管须跟进，不假定自动永久续期。是否可免费申请以当前账号页面为准；出现收费订单时不直接购买。见 [个人测试证书规则](https://help.aliyun.com/zh/ssl-certificate/purchase-an-individual-test-certificate)及 [申请步骤](https://help.aliyun.com/zh/ssl-certificate/application-for-individual-test-certificate)。证书私钥只在受控证书服务中处理，不放聊天、Git、CI artifact 或公开 bucket。
2. 证书签发后，在 OSS 的 **Bucket 配置 → 域名管理** 找到 `artdico.host`，打开 **证书托管**，选择有效的匹配证书并按控制台完成上传 / 托管。若列表不可选，核对证书账号、签发状态及覆盖域名。
3. 在有效期内验证完整证书链和域名匹配。若另有 www / preview，逐个检查，不把根域名证书默认当成覆盖全部子域名。
4. 记录签发者、覆盖域名、到期日和续期负责人；证书续期后须更新实际托管并重新验证，不能只完成证书签发。

若该域名实际已使用 CDN，证书应配置在 CDN 控制台；OSS 的证书托管不会替 CDN 节点提供证书。配置位置和验证方法见 [OSS HTTPS 官方说明](https://www.alibabacloud.com/help/en/oss/user-guide/access-oss-by-https-protocol)。

HTTPS 可用与 HTTP 自动跳转是两项不同配置。直接 OSS 不提供原生强制 HTTP→HTTPS 转址；官方支持用 bucket policy 拒绝 HTTP，或在 CDN 配置转址。先验证 HTTPS，再按实际需求核对已有桶策略或额外服务，不能用 DNS / HTML 假装完成传输层转址，也不因 HTTPS 接入自动购买 CDN。

## 5. 发布后验证

已确认本次 main **push** 的部署 job 成功，用户回报域名的 HTTPS 页面可显示。独立检查尚未运行；在可访问目标站点的环境使用本仓库无密钥检查脚本，核对此次已部署的完整 SHA；若期间有新的 main 部署，先更新为最新成功部署的 40 字符 SHA：

```sh
node scripts/check-live-site.mjs https://artdico.host 2e90103f7756acdb49cc5433a5dd6ab22500a6f2
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
| 公开部署提交 / Actions URL | `2e90103f7756acdb49cc5433a5dd6ab22500a6f2` / [39349541751](https://github.com/kunanli/artdicohost/actions/runs/39349541751)，12 个公开对象部署及回读成功 |
| 权威 DNS / 初始记录 | 用户截图显示阿里云 DNS 正确、初次查看 0 条记录；准确 Nameservers 与修改时间待留存 |
| 根域名实际 CNAME 目标 / TTL | `@` CNAME 已启用；TTL 10 分钟；目标完整值待从控制台复制留存 |
| OSS 域名绑定 / CDN | 用户截图显示 `artdico.host` 绑定生效；未开启 CDN |
| 证书签发者 / 覆盖 / 到期日 / 托管位置 | 用户回报已配置；准确证书详情与托管记录待核对 |
| HTTPS 页面 | 用户回报可正常显示；不等同于独立完整验收 |
| 独立 HTTPS、版本与公开资源检查 | 尚未执行线上检查脚本 |
| 桌面 / 手机 / 微信真机 | 未记录完整跨浏览器或真机验收，按实际检查分别补充 |

保存变更前的 DNS 记录与域名绑定状态。解析错误时只恢复本次网页 / 验证项；证书错误时恢复此前有效的证书配置。移除新建的 OSS 域名绑定时同时处理对应解析，避免悬空记录；不要解除与本次无关的域名或删除邮件记录。网页版本回退按 [自动部署说明](automatic-deployment.md#回退和数据边界) 走新的 main 发布，不覆盖任何私密数据。
