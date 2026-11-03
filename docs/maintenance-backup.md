# 后台加密备份与隔离恢复

## 浏览器操作

仅明确配置的 superadmin 可使用维护入口。与其他管理操作相同，每次写入要求准确的 HTTPS Origin、共享有效会话及 CSRF；普通内容编辑、邀约及审核角色没有导出备份的权限。接口不会从 URL、日志或固定配置读取备份密钥。

浏览器先用安全随机数生成 32 字节密钥，转换为 43 字符 base64url。用户须将密钥单独保存；它只在当前浏览器内存和该次 HTTPS 请求正文中使用，不写日志、localStorage、公开配置或备份文件。不能把备份和密钥一起放在公开位置，丢失密钥无法解密。

| 路由 | 方法 | 用途 |
| --- | --- | --- |
| `/api/admin/maintenance` | GET | 能力、大小限制、审计次数及最近完成时间，不含名单或对象名 |
| `/api/admin/maintenance/backup` | POST | `{encryptionKey,confirmation:'CREATE_ENCRYPTED_BACKUP'}`；返回加密二进制下载 |
| `/api/admin/maintenance/restore` | POST | `{encryptionKey,bundleBase64,restoreId,confirmation:'RESTORE_TO_ISOLATED_NAMESPACE'}`；只写新的隔离恢复位置 |

备份成功返回 `application/octet-stream` 附件及 `X-Backup-SHA256`、`X-Backup-Manifest-SHA256`、`X-Backup-Object-Count` 标头。审计必须先持久化，才会返回加密附件；审计失败或未知 ACK 不返回备份成功。下载后仍须将附件放在权限隔离的位置并核对摘要，下载本身不代表已经完成独立备份与保存。

浏览器加密附件上限为 1,500,000 字节，恢复 JSON 上限 2 MiB。超过上限明确返回 `MAINTENANCE_TOO_LARGE`，应使用 `registration-admin/maintenance.mjs` 的受控离线工具流程；不会截断资料或跳过对象。正式空库返回 `NO_BACKUP_DATA`，不会伪造空备份。

## 备份范围

活动行专用私有账本 `cms/v1/external-registrations/8884819113200` 已纳入受控维护：快照／提交日志、TID对照、操作者与来源／必要通知依据均随加密备份保存，恢复后必须用 `validateHuodongxingLedger` 校验。恢复不会继续未完成导入或寄信。原始XLSX文件不存入对象或备份；已筛出的正規化票资料仍属私有个资，不能以“只有票号”为由公开。权利请求及保留删除范围同时涵盖账本、联系人、名额、通知与审计，不删账本来解除去重；现有删除请求 `erased:false` 不代表已物理抹除全部历史。

P4 三类通知共用原 `cms/v1/registration-confirmations/<eventId>`，运行时维护清单已包含它，无新前缀。申请回执 `application_received`、正式信 `registration`／`promotion`、提醒 `pre_event_reminder` 的预留、未知、尝试次数与原批次操作必须全部保留。隔离恢复后用兼容 P4 的 repository／service 逐类试读，核对当前名额及原同意，验证只读、零重寄；恢复字节本身不等于领域验证。合成端到端恢复见 `tests/application-runtime-history.test.mjs`。

回退仅用认识新种类和提醒操作的兼容版本。旧写入者无法验证扩充后的审计，不可直接部署旧版、删新记录或清空 reserved／unknown；先暂停发送，保留原正文／操作，再用兼容修复。代码回退与业务恢复分开，不以旧快照覆盖当前名额、撤回或通知事实。保留、权利请求及受控删除继续涵盖同一前缀，不额外复制收件人名单。

生产装配显式指定本站内容、私密联系人、报名 index、审核、意向邀请、群码状态和维护日志的前缀。工具核验日志哈希链，收集全部历史快照及其引用的报名记录、头像和历史群码图片；不列举 bucket，也不接受浏览器提供的对象路径。

浏览器维护明确排除工作人员凭据目录、所有会话、登录额度和已有恢复命名空间。账号恢复须使用独立受控配置及必要的密码重置流程；备份不能复活已撤销会话，也不能借恢复重启旧账号。密钥、密码或摘要不进入维护审计和状态响应。

## 恢复与失败处理

恢复前先校验密钥、认证标签、完整对象哈希和引用闭包，并检查只含允许范围。操作明确确认后先写维护审计，再写 `cms/v1/restores/<restoreId>/` 下全新的隔离对象：先不可变资料，再追加日志，逐项回读。目标已有资料时拒绝，不覆盖现行前缀、不自动切换业务、不删除任何在线资料。

每个恢复标识在写入资料前，须先以 position 0 原子追加取得命名空间 claim，包含本次备份摘要与随机操作 nonce，并回读完全一致。整个恢复点只允许一个备份拥有；两个物件清单不重叠的备份也不能重用同一标识，并发 claim 只允许一方成功。claim ACK 丢失时停止、不重送、不写后续资料；该标识留待核对并改用新的隔离标识，不能自动抢占。

成功响应准确标记 `active:false`、`sessionsRestored:false`。这证明隔离对象字节恢复，不能代替领域 schema 验证、真实业务试读、撤回／删除要求核对及人工切换。恢复过程或完成审计失败时不返回成功，不盲目重送；可能留下部分隔离对象或未完成审计。状态中的 `incompleteRestoreCount` 提示需要核对，不能据此自动重试或清理。

密钥与正文不记日志；维护审计仅包含固定操作／阶段、操作者 ID、时间、对象数、来源摘要及恢复标识。在线日志最多 1000 次维护审计，达到上限停止新操作。此接口没有 Delete、彻底擦除、过期自动删除或自动生产切换功能。

## 实现与测试

`maintenance-handler.mjs` 导出 `createMaintenanceAuditStore({journal,clock})` 与 `createMaintenanceApi({enabled,auth,objects,journalPrefixes,additionalKeys,audit,clock})`。生产使用独立 `cms/v1/maintenance` 日志；默认关闭，依赖缺失拒绝装配。完整对象处理工具说明见 [报名审核与运维](registration-review.md)。

合成测试覆盖认证加密下载和审计、隔离恢复、角色／Origin／CSRF、恶意密钥和文件、请求上限与取消、凭据目录排除、审计竞争与未知 ACK、当前及历史群码引用。29 项维护／审核／账号相关测试、213 文件源码扫描及 Astro 检查通过（0 错误／警告，1 项既有提示）。真实云端结果须在集成流程另外验证。
