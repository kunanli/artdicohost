# 人员名额与候补 HTTP 契约

本阶段在既有私有报名 index 中记录每个人的参会／工作人员类别、已确认／候补／撤回状态和团队关联。既有不可变报名原件不重写；团队预估人数不当作已经登记的人数，工作人员代录也不伪造申请人的网站同意。部署及实际云端验证结果另记，本文件不是上线证明。

`createAdmissionsApi({enabled,auth,service})` 默认关闭，共用生产 auth；所有路径限定准确 `https://api.artdico.host`、不接受查询参数。读取允许 reviewer／superadmin，editor 或仅 outreach 不能读取人员、团队或私密数量。所有修改要求准确 Origin、会话、CSRF、32–128 字符 base64url `operationId` 和非负整数 `expectedRevision`。未知 ACK 不自动重试，工作人员保留同一个 operationId 核查／重放，409 保留编辑内容并重新载入。

| 路径 | 方法 | 额外请求字段 | 权限 |
| --- | --- | --- | --- |
| `/api/admin/admissions` | GET | 无 | reviewer／superadmin |
| `/api/admin/admissions/settings` | PUT | `settings:{staffReserve,waitlistEnabled}` | superadmin |
| `/api/admin/admissions/kind` | POST | `registrationId,kind` | superadmin |
| `/api/admin/admissions/withdraw` | POST | `registrationId` | reviewer／superadmin |
| `/api/admin/admissions/promote` | POST | 无 | reviewer／superadmin |
| `/api/admin/admissions/teams` | POST | `team:{id?,name,memberIds}` | reviewer／superadmin |
| `/api/admin/admissions/teams/remove` | POST | `teamId` | reviewer／superadmin |
| `/api/admin/admissions/staff` | POST | `input:{fields,permissionReference,kind}` | superadmin |

修改请求均另含 expectedRevision／operationId。服务端校验嵌套资料及容量，并用同一个 index journal CAS 提交；HTTP 不接受访客指定 actor。读取回传 `{revision,settings:{capacity,staffReserve,waitlistEnabled},summary,people,teams,auditCount}`。修改成功 HTTP 200，outcome 为 updated／replayed，附相同快照和 promotedIds，必要时附 registrationId／teamId；invalid 400、conflict／capacity_conflict 409、forbidden 403、not_found 404、未知结果或储存错误 503，响应不包含提供者正文或原因链。

公开报名仍用原有精确 alias 与 201／200，但成功状态必须区分 registered／waitlisted；候补没有群码、正式邀请或「已确认名额」宣称。私有审核撤回与名额释出依序确认，不在审核保存结果不明时自动释放或补位。生产候补由受控设置明确启用，工作人员预留默认 0，后续以已提交的私有设置为准。

运行时把独立模块接到同一 auth／私有 index：群码读取包含最新名额和审核撤回检查；旧 contacts PUT 只在新增场次／展位／参与形式时核对确认状态，保留旧安排的备注修改及删除仍可进行。旧邀请 generated／sent 记录也不能绕过名额。任务列表允许 superadmin，或同时具有 outreach＋reviewer 的账号；只在授权后加载来源，合并一次名额快照及一次审核撤回集合，不逐人扫描整份报名。

已获邀约权限的 conversion 列表只新增各自的 admissionStatus，不公开完整人员／团队／容量快照。后台静态包增加准确 `/admin/tasks/` 路径与引用闭包；公开 OSS 上仅放同路径的后台入口说明，不放私密任务或后台脚本。

十项隔离验收仍保持 90 秒／1000 次对象请求。加密维护证明移到最早的联系人快照，以留出新名额流程的请求预算；该实际验收中的恢复只证明该联系人快照，不能称为 v2 名额全历史恢复。另用 `registration-admissions-backup.test.mjs` 合成全历史测试覆盖 v1 只读解释、v2 设置／团队／工作人员来源及所有不可变原件的加密备份／隔离恢复。当前开发测试通过不代表这些改进已经上线，正式源码及云端证明由主流程另记。
