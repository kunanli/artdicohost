# Apple Wallet 签章与访问契约

用户尚无 Apple Developer／Pass Type ID／签章凭证，本阶段正式环境保持未配置；先交付设置状态及操作指引，不声称已通过真实 iPhone 添加验证。

## 组合接口

`createAppleWalletService({env,loadSigningBundle,authorize,authorizedRegistration,tokenSecret,clock})` 位于 `functions/apple-wallet/service.mjs`。

- `readiness()` 是异步函数，仅返回 `ready,reason,missing,deviceTestRequired` 及可选 `certificateExpiresAt`。不回传 Team ID、Pass Type ID、证书、私钥、密码或配置值。
- `authorize({receiptToken})` 由可信确认服务提供；`authorizedRegistration(registrationId)` 同样重新核对不可变记录、名额与审核。两者返回 `registrationId,referenceCode,admissionStatus,name,organization,event`，event 含字符串 `id,title,date,time,venue,timezone,checkIn`。
- `download({receiptToken})` 返回 `{outcome:'issued',data,contentType:'application/vnd.apple.pkpass',filename}` 或固定 `invalid,inactive,not_ready,unavailable`。只有当前 confirmed 可签发，签完再核对当前资格；不存储新的用户原件，不发送消息。
- `verify({token})` 返回 `{valid:false}` 或 `{valid:true,eventId,admissionStatus:'confirmed',verifiedAt}`，不包含姓名、邮箱、编号或参会资料。每次读当前名额及审核，没有跨请求个人缓存。

可信构造函数的 `trustedRootFingerprints` 仅供离线临时证书测试；正式 runtime 不传此参数，环境变量不能扩展信任根。

## HTTP 与票券边界

`createAppleWalletApi({service,apiOrigin,publicOrigins})` 提供 POST `/api/admin/registration/wallet`（兼容标准 `/api/registration/wallet`），正文仅 `{receiptToken}`，8 KiB／5 秒读取上限。它使用收据 capability、不使用工作人员 Cookie，要求精确公开站 Origin 和无凭据 CORS。成功为私密 no-store `.pkpass`；未配置不回未签名 ZIP。

二维码是 GET `/api/admin/registration/wallet/verify/<token>` 的用途隔离 HMAC capability（同样有标准别名）。只证明当前资格，不能下载票券或打开报名确认资料；不包含姓名／邮箱，期限最多 180 天且不超过活动当天结束。链接可进入基础访问日志，但不携带长期收据 capability。取消／候补／读取失败即时拒绝核验；此接口不记录签到、不阻止重复入场。

Wallet 不包含 APNs 更新／设备注册或 webServiceURL。已下载票券不会自动从用户设备消失；取消后在线二维码核验失效，新下载也被拒绝。票面到活动日结束失效；重新下载可核对最新状态。不得把这些行为称为远端更新或自动删除。

## 签章与受控配置

生产 `APPLE_WALLET_ENABLED` 和 `APPLE_WALLET_BUNDLE_ID` 保存在既有受控 FC 设置；4096 字节环境变量上限不扩大。签章资料由 runtime 的 `loadSigningBundle({bundleId})` 从固定私有 OSS 路径读取并解密，缺失／损坏即关闭，不使用旧缓存。加密 bundle 包含下列 server-only 字段：

`APPLE_WALLET_TEAM_ID`、`APPLE_WALLET_PASS_TYPE_ID`、`APPLE_WALLET_ORGANIZATION_NAME`、`APPLE_WALLET_CERT_BASE64`、`APPLE_WALLET_KEY_BASE64`、`APPLE_WALLET_WWDR_CERT_BASE64`、`APPLE_WALLET_ROOT_CERT_BASE64`，可选 `APPLE_WALLET_KEY_PASSPHRASE`。本地可直接传这些字段；旧 `*_PATH` 占位不在生产 runtime 读取文件。

服务验证 Apple 官方发布的 Root CA／G2／G3 SHA-256、Root 自签名、WWDR 链、Pass 证书签名、三者期限、私钥匹配、Team ID 的 OU、Pass Type ID 的 UID，以及 Pass Signing marker／EKU。无效设置仅回固定原因。证书吊销的在线 OCSP／CRL 尚未实现，操作员须在 Apple 侧核对有效状态并在撤销时停用及轮替。

票券为真正的 ZIP、SHA-1 manifest（Apple 格式要求）和 SHA-256 detached CMS 签章，含 signing-time 与 WWDR；签章使用 Node 内建 crypto，不假设 FC 安装 OpenSSL。二维码与报名收据使用不同 HKDF purpose。不会把联系方法、内部备注或住宿需求放进票券。

## 验证与后续

`node --test --test-isolation=none tests/apple-wallet.test.mjs tests/wallet-signing-prepare.test.mjs tests/delivery-config-bundle.test.mjs` 使用临时生成的合成 CA／私钥；测试后清除，不在 Git 放私钥。RSA 与 ECDSA 的真实 ZIP／manifest 经独立 OpenSSL CMS 验证并确认篡改拒绝，同时覆盖错误信任根、UID／OU／私钥／期限／非 Pass 证书、候补／撤回、签章间撤回、二维码用途／过期、缺配置与 loader 失效、HTTP 同源／界限／超时／MIME，以及本机密文准备／私密文件权限。17 项检查通过，该测试不表示 Apple 接受合成证书。

设置步骤见后续 `apple-wallet-setup.md`。恢复时保留完整私有记录；备份 bundle 只在隔离恢复命名空间，不自动激活签章。停用 `APPLE_WALLET_ENABLED` 仅停止新签发，二维码仍核对已确认资格；如签章或应用 Secret 泄漏，应停用、在 Apple 撤销、轮替相关 Secret／bundle 并重新验收。

核对来源（2026-10-21）：[Apple 创建 pass](https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/PassKit_PG/Creating.html)、[Apple 当前构建说明](https://developer.apple.com/documentation/walletpasses/building-a-pass)、[WWDR 用途](https://developer.apple.com/help/account/certificates/wwdr-intermediate-certificates)、[Apple PKI 下载](https://www.apple.com/certificateauthority/)、[官方信任根指纹](https://support.apple.com/en-us/126047)、[Apple WWDR CPS 的 Pass 证书用途](https://images.apple.com/certificateauthority/pdf/Apple_WWDR_CPS_v1.32.pdf)。
