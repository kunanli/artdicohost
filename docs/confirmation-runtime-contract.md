# 报名确认与运行时边界

公开报名服务可注入 `onSaved({receipt,origin,provenance,outcome})`。它只在不可变公开报名记录及最新名额状态已核对后执行；工作人员代登记不自动通知他人。传入收据是独立副本，通知服务无法改写报名承诺。未知报名 ACK 不调用通知；明确重播验证已保存记录后可调用，由通知服务自己的持久日志去重。通知失败不逆转已保存报名。

可选返回值是 `confirmation:{receiptToken,confirmationUrl,expiresAt,email:{status}}`。HTTP 只投影有期限的三段用途令牌与精确 `https://artdico.host/registration/confirmation/#r=` 链接，不接受其他来源、查询参数或收件人／密钥。过期、格式错误及不支持的邮件状态只省略可选确认资料，报名收据仍成功。

确认页读接口不得触发发信。`not_configured`、`not_applicable`、`disabled`、`provider_accepted`、`rejected` 与 `unknown` 均不能称为已送达；保留状态只用于明确的后端演进兼容。正式寄件必须另有配置、开关、持久预留和唯一外部请求。

三项有意义的服务／HTTP 回归覆盖提交后通知故障、收据不可被改写、代登记不触发、未知报名 ACK、明确重播，以及精确链接和最小字段投影；与原有报名／HTTP 共 33 项通过。真实名单、真实邮件和 Apple 凭证不作验证资料。
