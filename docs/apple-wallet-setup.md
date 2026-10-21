# Apple Wallet 设置步骤

当前尚未取得本活动可用的 Apple Developer 身份、Pass Type ID 或签章凭证。后台会显示缺项及未启用；公开确认页不会出现可用票券按钮。以下是后续由主办方／受控运维完成的流程，不表示已经开户、付费、取得证书或通过 iPhone 验收。

## 先选对 Apple 服务

2026-10-21 已重新核对官方说明。活动普通二维码票券使用 **Apple Developer Program** 的 Pass Type ID 与证书。[Apple Business Manager](https://support.apple.com/en-gb/guide/apple-business-manager/axm3a8bb0ab8/1/web/1) 用于组织设备、账号及 App／书籍部署，不是本次签发票券所需的会员。

Apple 当前列 [Developer Program](https://developer.apple.com/programs/enroll/) 年费为 **99 USD**，实际按注册地显示币别／价格；现有有效会员可直接使用自己的团队创建本站票券标识。可选个人或组织会员，ARTDiCO 若需长期由公司持有与维护，建议按真实法人主体申请组织会员。组织申请需要法人身份、具有签约权限的申请人、D-U-N-S（政府组织除外）、组织域名邮箱与公开可用的网站；个人会员按本人法定身份申请。加入 Apple Business 不会代替这项会员资格。

普通票券可以从网站或邮件分发，**不用先开发或上架 iOS App**，见 [Apple Wallet 入门](https://developer.apple.com/wallet/get-started/)。本项目采用报名私人确认页下载签章 `.pkpass`，仅确认名额可下载；现有基础实现不是 NFC 或推送更新服务。

开通会员后，到 **Certificates, Identifiers & Profiles → Identifiers → ＋ → Pass Type IDs**，填写描述及本站专用标识（例如建议值 `pass.co.artdico.host`，尚未建立）。再按下节生成 CSR 并申请 **Pass Type ID Certificate**。Apple 要求 Account Holder 或 Admin 操作，见 [官方步骤](https://developer.apple.com/help/account/capabilities/create-wallet-identifiers-and-certificates/)。记录真实 Team ID 和实际注册的 Pass Type ID，证书及匹配私钥使用受控渠道配置，不贴聊天。

## 主办方先准备

1. 按 [Apple Developer 的注册说明](https://developer.apple.com/programs/enroll/)选择合适的主办主体并自行完成加入计划；此工程不代申请账号或购买会员。
2. 依 [创建 Wallet identifiers 与 certificates](https://developer.apple.com/help/account/capabilities/create-wallet-identifiers-and-certificates/)建立本站专用 Pass Type ID，记录真实 Team ID。不要拿支付商户 ID、普通 App ID、APNs 证书或其他活动身份代用。
3. 使用 Apple 官方 [CSR 步骤](https://developer.apple.com/help/account/certificates/create-a-certificate-signing-request/)在受控电脑生成私钥与 CSR，提交 Pass Type ID 证书申请。保留对应私钥及加密备份；下载的 `.cer` 不包含私钥。
4. 从 [Apple PKI](https://www.apple.com/certificateauthority/)下载当前 Pass Type ID 对应的 WWDR 中间证书与签发它的 Apple Root。Apple 的 [WWDR 用途表](https://developer.apple.com/help/account/certificates/wwdr-intermediate-certificates/)目前列 G4 用于 Pass Type ID，实际仍须核对自己证书的 issuer。运行验证会检查完整链及官方 Root 指纹，不能用名字相似的自签名证书替代。

## 本机证书转换与保护

证书、私钥、P12、密码及应用 Secret 不放进 Git、公开目录、聊天或普通日志。推荐使用受限临时目录，`umask 077`；私钥／密码文件为 0600，目录为 0700。输入密码时使用 OpenSSL 的交互提示，不把密码写在命令行。

若已从 Keychain 导出加密 P12，可在受控电脑转换：

```sh
umask 077
openssl pkcs12 -in signer.p12 -clcerts -nokeys -out signer-cert.pem
openssl pkcs12 -in signer.p12 -nocerts -out signer-key.pem
```

第二条保留 PEM 私钥加密，另外通过受控方式准备 0600 的 key-passphrase 文件。公开 DER 证书可转换为 PEM，或直接交给准备工具：

```sh
openssl x509 -inform DER -in AppleWWDRCAG4.cer -out wwdr.pem
openssl x509 -inform DER -in AppleRootCA-G3.cer -out root.pem
openssl x509 -in root.pem -noout -fingerprint -sha256
```

不要仅凭示例文件名选择 Root；使用实际 issuer 链。指纹与 [Apple 官方列表](https://support.apple.com/en-us/126047)核对。服务会拒绝错误链、过期或未生效证书、错误 Team／Pass Type ID、不匹配私钥及非 Pass Signing 用途。

## 制作加密签章资料包

FC 的环境变量总量硬上限仍为 4096 字节，不能把整套证书塞入环境变量。准备工具只离线生成 AES-GCM 加密资料包，不上传、不修改云端、不自动启用。受控运维须通过原有安全流程提供本站当前注册 Secret 的 0600 文件；不要从浏览器或聊天索取，也不要为了此步骤把 Secret 打印出来。

```sh
node scripts/prepare-wallet-signing.mjs \
  --cert /secure/wallet/signer-cert.pem \
  --key /secure/wallet/signer-key.pem \
  --wwdr /secure/wallet/wwdr.pem \
  --root /secure/wallet/root.pem \
  --team-id REALTEAMID \
  --pass-type-id pass.example.real-event \
  --organization '真实主办方名称' \
  --event-id ggj-cn-2026 \
  --secret-file /secure/runtime/registration-secret \
  --key-passphrase-file /secure/wallet/key-passphrase \
  --out .local-data/wallet-signing/signing-bundle.encrypted.json
```

示例 Team／Pass Type ID 必须替换为 Apple 发放的实际值。输出文件仅为密文、0600，工具拒绝覆盖原文件或输出到仓库其他目录。输出摘要只有 `bundleId,objectKey,encryptedBytes,certificateExpiresAt` 等非秘密信息；没有原 PEM、私钥或密码。工具的成功不表示已经上传、启用或通过 Apple 真机验收。

## 受控上传与启用

由现有受控运维在本站独立私有桶按输出 `objectKey` 写入密文（`cms/v1/wallet-signing/<event>/<SHA-256>.json`），读回验证实际 bytes／SHA／私有对象类型。沿用现有写入及未知 ACK 保护，不新增公开下载、IAM 或 DNS。若上传结果不明，先读回核对，不盲重写。

将验证过的 digest 写入受控 `APPLE_WALLET_BUNDLE_ID`，初期保持 `APPLE_WALLET_ENABLED=false`。管理员状态页应显示证书链通过及有效期；缺失／损坏／错误 Secret／配置读取失败都保持未就绪。签章资料包的 feature flag 无效，只有受控环境中的启用开关生效。

按既有发布流程检查准确来源、环境总量与读回结果。用户无 Apple 帐号的当前阶段到设置指引为止；取得真实凭证后，须使用本人或明确授权的合格报名做一次实际 iPhone／Safari 添加验证，再明确启用。不要把合成 CA 测试通过当成真实 Apple 证书通过。

## 真机验收与日后轮替

- 只有 confirmed 登记显示加入 Wallet；候补、取消或资格读取失败不能下载。公开 API 只使用收据 capability，不依赖工作人员 Cookie。微信内无法直接添加时，可使用 Safari 打开确认页。
- 在 iPhone 检查真实 `.pkpass` 的活动、姓名、日期／时间、地点与报名编号，确认显示 Apple 的添加界面并实际加入。下载格式验证不能替代这一步。
- 使用专属有效性二维码核对当前 confirmed 状态；它不返回个人资料、不记录签到或检查是否重复入场。取消后二维码与新下载拒绝；已存设备票券不会自动远端更新或删除。
- 此版本没有设备注册、APNs 推送或 Wallet web service；不宣称自动刷新。证书到期前在 Apple 侧续发，生成新密文、受控切换 digest、读回并重新做真机验收。Apple 侧证书吊销亦须人工核对，服务没有在线 OCSP／CRL 查询。
- 停用新签发使用 `APPLE_WALLET_ENABLED=false`，保留用户、名额及审核资料。密钥泄漏应在 Apple 侧撤销并轮替；应用 Secret 轮替需要同时重建加密资料包，并评估收据／二维码用途密钥失效。隔离恢复不会自动激活旧签章配置。

开发验证与接口见 [签章服务契约](apple-wallet-service.md)。不会提供无法验证的演示票券给真实参加者。
