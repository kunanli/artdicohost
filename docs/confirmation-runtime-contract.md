# 报名确认与运行时边界

公开报名服务可注入 `onSaved({receipt,origin,provenance,outcome,promotedIds})`。它只在不可变公开报名记录及最新名额状态已核对后执行；工作人员代登记不自动通知他人。传入收据与当次已证明的晋级名单都是独立副本，通知服务无法改写报名承诺。未知报名 ACK 不调用通知；明确重播验证已保存记录后可调用，由通知服务自己的持久日志去重。通知失败不逆转已保存报名。

可选返回值是 `confirmation:{receiptToken,confirmationUrl,expiresAt,email:{status}}`。HTTP 只投影有期限的三段用途令牌与精确 `https://artdico.host/registration/confirmation/#r=` 链接，不接受其他来源、查询参数或收件人／密钥。过期、格式错误及不支持的邮件状态只省略可选确认资料，报名收据仍成功。

确认页读接口不得触发发信。`not_configured`、`not_applicable`、`disabled`、`provider_accepted`、`rejected` 与 `unknown` 均不能称为已送达；保留状态只用于明确的后端演进兼容。正式寄件必须另有配置、开关、持久预留和唯一外部请求。

云端运行时连接独立确认模板、邮件 outbox、Apple Wallet、真实 XLSX 和管理设置。公开页面只在 OSS 发布空壳；确认与票券通过现有 `/api/admin/registration/confirmation`、`/api/admin/registration/wallet` 路由读取自己的能力令牌，标准路径也可用。读确认页不触发发信。缺少 Apple 账号和证书时保持未就绪，管理页仅显示固定缺项名称；凭证只存放于受控加密私有对象。

名额管理和审核退出仅在名额 CAS 已保存且返回 `promotedIds` 后调用晋级通知。自动路径只处理公开报名、有邮箱且目前正式入场的人员，不为旧意向名单或工作人员登记补发。可选通知故障保留名额／审核成功；私有响应的 `promotionEmail` 说明尝试数和待核对数。未尝试的人保持待通知，管理员可明确补寄；未知外部 ACK 不自动重寄。一次运行时通知批次启动窗口为 5 秒，单次邮件传输最多 4 秒，公开提交初次通知与晋级共用启动窗口。外部发信已经开始后不会假定取消成功。

备份包括确认日志全部历史快照，以及当前设置指向的加密邮件和 Wallet 配置对象；不包括解密私钥或环境主密钥。受控配置仍保持 FC 环境总计 4096 字节上限。真实名单、真实邮件和 Apple 凭证不作验证资料。
