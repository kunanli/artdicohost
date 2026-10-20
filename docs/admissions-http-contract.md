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
