# 人员角色与逐场次职责

本轮公开与保存操作以[默认公开](default-public-visibility.md)及[统一保存](admin-save-workflow.md)为准，准确来源和实际部署状态见[本轮验收／发布记录](admin-save-visibility-release-2026-10-22.md)。旧版公开前确认／授权门槛由新规则替代；本页的私有职责、名额及历史保留契约继续适用。

原始意向、实际出席回复、工作人员职责、报名名额及公开授权分别保存。修改角色不重建联系人或报名，不修改 `profile`／`source`／`sourceProfile`，不确认名额、住宿、公开姓名或肖像。日常取消仅改变状态与当前关联，完整 journal 继续保留历史。

全活动 `operations.participationForms` 可多选：`guest,speaker,panelist,host,organizer,booth,student_showcase,attendee`。新增 `organizer` 表示研讨会组织者，`host` 表示主持；不把原始问卷的意向改写成正式职责。

`operations.sessionRoles` 为可省略、最多 50 项的数组：

```json
[{"sessionId":"session-morning","roles":["speaker"]},{"sessionId":"session-afternoon","roles":["organizer","host"]}]
```

每项须对应已关联的 `sessionIds`，同一场次一项，职责非空且不重复，只接受 `speaker,panelist,host,organizer,guest,attendee`。场次时间冲突、已取消或不存在的安排沿用服务端校验。联系人详情按场次选择职责，列表和已保存总览显示本场职责，不把全活动标签套用到每一场。

旧记录只读时解释为空数组，不追加修订或覆写旧 bytes。旧客户端保存完整 operations 时省略 `sessionRoles`／`participationForms`，服务端保留已有值；明确移除场次才移除该场当前职责。明确传空数组才清空本次关联。未知字段、重复职责或未知角色不能进入持久快照。旧快照及迁移档案继续按原 bytes／digest 校验。

已有名额关联者，在旧联系人 PUT 或 `POST /api/admin/contacts/:id/assignments` 新增场次、展位、全活动职责或本场职责前，均核对最新 confirmed 名额。`assignments` 可额外传 `sessionRoles`；省略保留。候补／撤回／读取失败不得新增，移除或保留历史职责不需要重新分配名额，仍需原有 Origin、角色、CSRF 及 contacts CAS 修订。未转报名者只作私有筹备安排。

嘉宾预填只准备未保存草稿。`title,bio,website,publicRoles` 为可选建议；内部 host 映射为 moderator。过长简介／无效网址不截断或改原件，返回 `omittedFields` 供编辑者核对。嘉宾默认公开，明确设为「未公开」才排除新发布内容；确认、出席和照片授权不再作为公开门槛，也不因此授予 publicConsent 或确认名额。预填后须在实际表单「保存」并核对云端回执，再明确「发布到前台」；准备、保存或调整职责都不会自动发布。

## 全名单双向导出审计

云端及本机 contactsStore 提供 `recordExport(expectedRevision,actorId,{count,includeContact,includeAnswers,workbookSha256}) -> {revision}`。count 必须等于当前完整名单数量，范围与 hash 校验后以同一 contacts CAS 追加 `export_contacts` 审计。此全局事件不修改任何联系人的 updatedAt、原件或实际回复；旧快照解析器认识这一固定事件。导出 bytes 只能在已收到审计确认后交给浏览器；未知 ACK 不假称成功。联系人、未转换对象及拒绝者均可按明确导出范围保留，不把筛选结果当作完整名单。

代码验证使用合成资料，覆盖旧快照不写迁移、角色独立性、逐场职责校验、旧客户端保存、撤回后清理、两个入口的名额保护、CAS 与未知 ACK，以及导出全局审计不改个人原件。真实 39 行未作为夹具或写入生产。

## 界面与下载

人员页提供全活动职责多选及逐场次职责；保存后总览只展示该场实际标记，不把其变成公开讲者。直接编排只改变场次／展位 ID，保留仍关联场次的职责，移除所选场次时一并移除当前职责链接，不改原始来源。

完整人员 Excel 面板独立于搜索筛选，必须由服务端广告 `features.contactXlsxExport:true` 后启用。联络资料和完整原问卷均默认不勾选；客户端只在精确 MIME、大小、SHA 与审计修订验证完成后下载，更新到已确认的 audit revision，不重置当前未保存编辑。登出清理 Blob URL 和导出选择；会话在载入可选日志期间失效，不会把旧私有名单重新填回页面。

可选浏览器验证：先用正式 API origins 构建，再执行 `tests/browser/contact-roles-smoke.mjs`（设置 `ARTDICO_PLAYWRIGHT_MODULE` 与 `ARTDICO_CHROMIUM_BINARY`）。真实 Chromium 使用合成拦截接口验证手机角色选择、两场不同职责、原件保留、筛选无结果仍导出完整名单、实际 OOXML 读回，以及 ledger 401 不重开私人工作区。没有访问正式 API。

升级后回退须采用认识 `sessionRoles` 及 `export_contacts` 的兼容版本。不能让旧本机写入者重新规范化并覆盖新职责；先暂停新写入、保存完整私密 journal，再用兼容版本修复。公开授权及名额撤回仍须分别核对。
