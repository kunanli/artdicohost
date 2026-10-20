# Apple Wallet 与 EmailJS 接入准备

日期：2026-10-19，Asia/Taipei。用户明确要求先完成界面与接入准备，目前尚未设置 Apple Wallet 或 EmailJS 账号。本阶段只生成工作人员可查看的预览，不发送邮件，不签发或下载 `.pkpass`，也不把预览称为可用的电子票。

## 当前可用行为

本地私密联系人后台复用 outreach 权限、会话、同源与 CSRF 校验。预览不改变联系人修订、邀请发出记录或出席回复；所有响应均为 `Cache-Control: no-store`。普通 editor / publisher 角色不能查看这些个人资料。

Apple Wallet 预览展示受邀称呼、日期、时段、场地与暂定状态。它不包含二维码、条码、验票令牌、签名或 `.pkpass` 下载地址，不能添加到 Wallet。邀请可以先于出席回复准备，但来源联系同意必须明确为 consented。

EmailJS 预览展示收件邮箱、主题、纯文字内容和模板变量。它只适用于工作人员另行记录 `operations.responseStatus:attending` 的实际回复。原问卷的「预计可以到场」属于历史意向，不足以生成出席确认邮件；联系同意 declined / unknown 或没有有效邮箱时也会阻止预览。邮件说明参会确认不代表讲者、展位、赞助、住宿或官方 GGJ 站点资格已确认。

日期、时段及楼层仍须按筹备实际进度确认。默认 `confirmed:false`，预览明确保留暂定提示；工作人员正式输出前应逐项核对。

## HTTP 契约

| 接口 | 请求 | 响应 |
| --- | --- | --- |
| GET /api/admin/communications | 无 | `{mode:'preview',wallet:{ready:false,reason},email:{ready:false,reason}}` |
| POST /api/admin/contacts/:id/wallet/preview | `{settings}` | `{mode:'preview',status:'unsigned_preview',kind:'eventTicket',title,name,date,time,location,confirmed,notice}` |
| POST /api/admin/contacts/:id/email/preview | `{settings}` | `{kind:'attendance_confirmation',mode:'preview',status:'not_sent',toEmail,subject,text,variables}` |

settings 为 `{recipientName,date:'YYYY-MM-DD',time:'HH:mm–HH:mm',venue,confirmed:false}`，使用与图片邀请函一致的服务端字段校验。邮件 variables 固定为 `to_name,event_title,event_date,event_time,event_venue,event_status`，不包含内部备注、住宿需求或其他问卷内容。

预览路由要求登录和 outreach；两个 POST 还要求准确 Origin、会话 cookie 与 `x-csrf-token`。未登录返回 401，无权限 / CSRF / Origin 拒绝返回 403，不存在联系人返回 404，缺少同意、实际出席确认、有效邮箱或活动字段错误返回 422。没有 `/email/send` 或 `/wallet/issue` 接口。

`createPreviewCommunications` 是明确禁止投递的适配层。即使填写所有配置，ready 仍保持 false，`sendEmail` / `issueWalletPass` 也会失败；`COMMUNICATIONS_MODE` 只接受 preview。就绪检查不读取证书文件或验证服务账号，不返回任何配置值。

## Apple Wallet 后续设置

按 [Apple Wallet 官方接入说明](https://developer.apple.com/wallet/get-started/)准备开发者团队、Pass Type ID、对应签名证书及私钥和 WWDR 中间证书。真正的 pass 需要构造清单并签名；单纯更改扩展名或输出未签名 ZIP 不能作为可添加的钱包邀请函，见 [Apple 创建 pass 文档](https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/PassKit_PG/Creating.html)。

`.env.example` 提供 server-only 占位：`APPLE_WALLET_TEAM_ID`、`APPLE_WALLET_PASS_TYPE_ID`、`APPLE_WALLET_ORGANIZATION_NAME`、`APPLE_WALLET_CERT_PATH`、`APPLE_WALLET_KEY_PATH`、`APPLE_WALLET_WWDR_CERT_PATH` 和可选 `APPLE_WALLET_KEY_PASSPHRASE`。证书 / 私钥文件放在源码仓库、dist 和公开静态目录外的受限位置。不要把私钥、证书密码或实际凭证贴进聊天、Git、日志或前端 `PUBLIC_` 配置。

未来签发还需独立服务端签名、受限下载、事件信息核验、授权 / 保留 / 删除设计及真机添加验证。当前不生成验票码，也没有假定入场凭证验证协议。启用前应另行提交可审查的实现与验证记录。

## EmailJS 后续设置

先在 EmailJS 建立发件服务和出席确认模板，核对发件人、回复地址、模板变量和已验证域名。用户指定发件网域为 `artdico.co`；server-only 的 `EMAIL_FROM_ADDRESS` 必须为该网域的单一合法地址，`EMAIL_FROM_NAME` 为发件显示名称。就绪说明只指出缺少或无效的固定字段，不回传这些配置值。填入地址不代表邮箱已经存在、域名发信验证或 EmailJS 已完成配置；仍须在邮件服务核对 SPF / DKIM / DMARC 及实际服务要求，不改现有 DNS。服务端占位为 `EMAILJS_SERVICE_ID`、`EMAILJS_TEMPLATE_ID`、`EMAILJS_PUBLIC_KEY`，可选未来服务端授权的 `EMAILJS_PRIVATE_KEY`。当前未安装 EmailJS SDK，没有调用其发送 API。

后续实现应依照 [EmailJS 官方 send API](https://www.emailjs.com/docs/rest-api/send/)配置服务与模板；只有具备实际出席确认及联系许可的对象进入发送队列。投递还需人工确认收件人 / 内容、同一确认事件幂等、速率限制、结果记录、失败重试和退订 / 撤回处理。不要以浏览器按钮点击、预览生成或 HTTP 超时推断已发送 / 已送达。

真实发送入口启用前须先以合成收件人或经授权的测试邮箱验证模板与投递结果，再记录部署及回滚步骤。当前「记录已发送」仍表示工作人员通过站外渠道实际联系后的手动记录，与 EmailJS 自动投递完全分开。

## 验证与回滚

`tests/communications.test.mjs` 使用纯合成联系人覆盖：配置不泄露 / 不解锁、未签名预览、同意门槛、实际出席回复门槛、字段校验、缺失邮箱、权限 / 同源 / CSRF、私密不缓存、没有发送路由和预览不改记录。它不读取真实工作簿、不联网、不发送邮件、不签发 pass。

保持 `COMMUNICATIONS_MODE=preview` 即保留当前能力边界。回滚预览界面或适配层不应删除联系人、手动发出记录或实际回复；本阶段未创建外部邮件或 Wallet 资源，没有外部消息需要撤回。日后启用真实投递时须另外补齐凭证轮换、队列停发和已签发 pass 的生命周期方案。
