# 公开报名 HTTP 400：转送标头数量

2026-10-31，从 main `4511e0a` 接续。用户浏览器配置和 token 正常，submit 返回 HTTP 400、Content-Length 0、application/octet-stream。原申请继续保存在原浏览器，不能为排错清除原正文、换幂等键或重新填一份。

## 原因与修正

云端 HTTP adapter 将 Node 的 `maxHeadersCount` 限制为 40。FC 转送／调用标头加上浏览器请求与两个提交证明，会超过这个数量。Node v24.19.0 在进入应用处理前触发 `HPE_HEADER_OVERFLOW`，现有不回显原文的解析错误处理因此返回空白 400；字段校验、报名持久化和 JSON 错误处理尚未执行。

线上拒绝诊断证实：同一路径 GET 带 512／4096 字符虚构证明均返回正常 JSON 405；POST 不带或只带一个提交标头返回正常 JSON 415，两个标头同时出现则重现空白 400，ASCII／UTF-8／正文大小不改变结果。没有为诊断签发真实 Token、提交报名、读取私有名单或发送邮件。

实际 loopback HTTP 复现了相同边界：模拟 34 个网关标头时配置正常、token 成功、submit 超过 40 后在解析层被拒。将数量上限改为 64 后，同一个原始幂等键／正文能够完整持久化；提交后丢失回执再恢复重试只返回原记录，不增加第二份申请。

只提高字段数量上限 40 → 64。标头总字节仍为 8192，正文上限、严格 HTTP framing、Origin、Token 签名及用途绑定、主动同意、人工审核、存储回执和限流继续执行。65 个标头、超过 8 KiB、非法标头及 Content-Length／Transfer-Encoding 冲突仍拒绝。没有新增服务、依赖、环境变量、IAM 或 DNS，Wallet／EmailJS 配置沿用。

## 验证与发布

`tests/registration-http-proxy.test.mjs` 以真实 Node HTTP、正式装配服务及隔离 memory OSS 验证旧限制复现、UTF-8 原请求恢复、201 丢 ACK 后 200 重放、仅一份记录和零邮件。`cloud-http-server.test.mjs` 验证 64／65 数量边界、8 KiB 字节界限与严格 framing；原客户端恢复测试继续运行。

`scripts/observe-registration-transport.mjs` 只访问固定 HTTPS 端点，使用虚构证明。GET 应拒绝为 JSON 405；text/plain POST 应在正文／Token／存储处理前拒绝为 JSON 415；无有效 Token 语法的空 JSON POST 应在读取正文前拒绝为 JSON 400。所有 POST 没有 eventId、fields、consent 或个人资料。真实 HTTP 测试证明诊断不进入 metadata／issueToken／submit 服务。输出仅状态、响应格式、大小及白名单错误码，不输出正文、请求标头或提供者错误细节；这些诊断不能替代本人实际申请核对。

PR 的独立观察任务记录部署前行为；主分支原有完整检查、香港 FC／OSS 发布完成后严格执行相同拒绝诊断。正式 HTTPS 结果以 PR #46 的实际发布记录为准，尚未发布时不把开发验证写成线上成功。

## 操作、回退与资料保留

主办方确认发布完成后，在原浏览器刷新并点「再次确认申请结果」，沿用原申请。若成功后待人工审核，在统一名额审核流程中处理；测试不会代本人操作正式申请。

回退沿用原发布流程及兼容代码，不回滚 OSS 资料或删除原申请。旧版 40 个标头的代码仍可能阻挡提交，只有不得不回退时才用于诊断，不能宣称已恢复服务。配置参考 `.env.example`；备份、隔离恢复、到期删除沿用 [维护流程](maintenance-backup.md)。
