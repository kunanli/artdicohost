# 确认信与 Wallet 的受控配置

实际 FC 环境变量总量上限仍为 **4096 字节**；不要提高部署工具限制来放入证书或多个寄件密钥。运行时支持在既有私有 OSS `cms/v1` 下保存加密配置，只在 FC 放置对应 SHA-256 标识及明确开关。没有新增服务、IAM、DNS 或收费账号。

配置以 AES-256-GCM 加密，密钥从现有报名签章秘密通过 HKDF、用途及 event ID 隔离派生；AAD 再绑定用途／活动。对象名绑定实际 bytes 的 SHA-256，每次使用都作有界读取并重新验证。Wallet 与确认信不能交换配置，载荷也不能覆盖开启开关或指定外部网络端点。私钥、口令、EmailJS 密钥及解密结果不进入前端、普通日志、普通人员 Excel 或 Git。

## 确认信

需要实际已验证的寄件邮箱／服务、独立 `EMAILJS_CONFIRMATION_TEMPLATE_ID`、EmailJS 服务／公钥／服务端私钥及发件人名称。邀请函模板与自动确认模板分别配置。开启只代表服务可接受发送请求；`provider_accepted` 不能称为已送达。

1. 在受控机器准备 **0600** JSON 文件，字段仅为 `EMAILJS_SERVICE_ID`、`EMAILJS_CONFIRMATION_TEMPLATE_ID`、`EMAILJS_PUBLIC_KEY`、`EMAILJS_PRIVATE_KEY`、`EMAIL_FROM_ADDRESS`、`EMAIL_FROM_NAME`。不要在聊天、命令行字面量、公开工件或仓库中写实际值。
2. 由已有授权运维在保护文件中提供当前报名签章秘密；不要改用另一个随机秘密，否则 FC 无法解密，也不要把部署 AccessKey 当作这个秘密。没有取得现有值时，先完成受控设置，不猜测或重建生产秘密。
3. 明确指定本机保护文件后执行，例如：

   ```sh
   node scripts/prepare-confirmation-mail.mjs --config-file /private/mail-config.json --secret-file /private/registration-secret.txt --event ggj-cn-2026 --out /private/mail-bundle.json
   ```

   脚本只输出配置对象的安全路径和 SHA，输出文件为加密 bytes、0600，不自动联网或启用发送。
4. 在 FC 寄件开关仍为 false 时，先在后台取消勾选「自动发送新公开报名的确认邮件」并保存。全新通知日志的业务开关初始为开启，不能误以为配置服务后还会等待另一次确认。使用已有受控 OSS 角色把加密文件按脚本返回的固定 `cms/v1/confirmation-mail/<event>/<sha>.json` 路径作不可变上传，类型 `application/json`。核对 bytes/SHA；不用公开桶、不做公开链接、不覆盖已有对象。FC 放入 `ARTDICO_CONFIRMATION_EMAIL_BUNDLE_ID=<sha>` 和 `ARTDICO_CONFIRMATION_EMAIL_ENABLED=true`，保留原有环境变量、角色和严格总量限制。
5. 后台核对配置状态及业务开关仍为关闭，再明确开启自动确认信。新公开报名在持久化后才通知；代登记和历史资料不会被设置页读取自动补寄。明确补寄只选实际已知未发出的记录；未知外部结果不自动重送。正式收件人测试需真实业务操作授权，CI 只使用注入的合成 provider。

没有邮箱的报名显示不适用，配置不完整显示未设置；两者都不阻止已保存报名及确认页使用。普通重新打开确认页不能发信。

## Wallet

用户当前没有 Apple Developer／票券证书，先完成后台缺项状态及[Apple Wallet 操作指引](apple-wallet-setup.md)；不显示虚假的可用票券。已有 `APPLE_WALLET_*_PATH` 为历史准备字段，FC 只使用新的明确配置，不能任意读取本机路径。

FC 首选 `APPLE_WALLET_BUNDLE_ID`、`APPLE_WALLET_ENABLED=true`。加密对象位于 `cms/v1/wallet-signing/<event>/<sha>.json`，包含 Team ID、Pass Type ID、组织名称、签章证书／匹配私钥、WWDR、受信 Apple 根及可选私钥口令。直接 base64 环境配置只适用于符合总量限制的小型本机设置；完整 Apple 链通常不能放入 FC 环境。证书校验、签章与真实设备验收见专门指引；没有凭证时不宣称已经加入 Apple Wallet。

## 备份与轮替

运行时维护清单包括确认通知日志及当前配置的两个加密对象，恢复只进入隔离命名空间，不启用发送、不恢复会话或自动替换当前 FC locator。解密依赖原报名签章秘密，**备份文件不包含该秘密**；保护秘密的轮替与保管必须单独完成。轮替该秘密前重新加密两个配置、核对新对象及 locator，然后验证；不能删掉旧配置备份或把历史报名覆盖为旧快照。证书／寄件配置轮替只更新有明示的 locator，不扩大任意对象读取范围。
