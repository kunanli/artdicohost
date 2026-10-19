# 私密意向名单、跟进安排与邀请函记录

日期：2026-10-19，Asia/Taipei。本文件追加当前用户要求，不覆盖原 10 份规范。它补充 [本地内容后台](local-content-backend.md)：工作人员现在可在**仅本机运行**的独立联系人模块导入已有意向资料、规划联系和安排场次 / 展位。普通活动报名表仍为前端演示，真实 FC / 私有 OSS 报名保存和生产后台尚未接通。

## 权限与存储边界

账号增加明确的 outreach 角色，专门授权私密联系人读取、导入、跟进和邀请函记录。editor、publisher 不自动获得此权限；只有需要维护私密名单的账号才添加 outreach。角色仍由 .env.local 中的 ADMIN_USERS_JSON 配置，全部账号使用 scrypt 密码摘要，没有默认账号。一个账号可按实际职责组合这些角色。

联系人使用独立的 contacts.json 和独立修订号，默认位置为 .local-data/content/contacts.json，与内容草稿 content.json 分开。该目录必须位于 dist/ 外，默认目录已忽略，不得把真实名单、原始工作簿、带姓名的图片、环境配置或备份提交到 Git、构建产物或公共静态目录。

当前仅限单个本地 Node 服务进程；持久化使用串行操作、临时文件、同步和原子 rename。修订号不能解决跨进程 / FC 多实例并发，不要把本地文件实现直接作为生产存储。真实部署仍须完成独立鉴权、私有 OSS、跨实例并发、HTTPS、个人信息告知、保留 / 删除和运维验证，再按原计划申请上线授权。

## 原始意向与正式结果分开

每条联系人的来源固定为 {key,rowId,digest,importedAt}。例如问卷来源使用 wjx-388636468，rowId 保留问卷序号。profile 是经过白名单映射的来源资料：

- 姓名、邀请称呼、城市、机构、职位、邮箱、微信和可选电话；
- 身份与参与方式标签、背景、支持需求、议题、提交时间、网站 / 案例原文；
- 站点名称、角色、年限仅在来源明确提供时填写，不从姓名、机构或标签推断；
- 原始到场、住宿、后续合作、联系授权代码保留在 attendanceIntentCode、accommodationIntentCode、futureCooperationCode、contactConsentCode。

没有选项字典时，数字 1、2 等只能显示为「原始代码，含义待核对」。系统不将代码自动转成同意、邀请许可、获房或确认参会。现有问卷意向不能自动升级为新网站的正式参会报名；普通正式参会仍按资料校验并真实保存后的直接报名规则执行。讲者、赞助、展位、住宿及官方 GGJ 站点资格分别沟通。

用户随后补充同一问卷的文字选项导出，已按来源序号逐行核对数值版与文字版身份字段，并据文字对照建立明确映射。现可同时保留原始代码、原始文字及规范值：contactConsent 为 consented / declined / unknown；attendanceIntent 为 expected / uncertain / unknown；accommodationIntent 为 needed / not_needed / uncertain / unknown；futureCooperation 为 interested / declined / unknown。对应原文为相同前缀加 Label 的字段。缺少已核对含义的旧资料仍归为 unknown，不能仅凭代码猜测。

生成与手动记录发送邀请函的两个 API 都要求 contactConsent 明确为 consented；declined 或 unknown 返回 422 CONTACT_NOT_CONSENTED。来源的预计到场只保留历史意向，operations.responseStatus 仍从 pending 开始，必须另外核对实际回复。旧私密文件没有这些字段时只补 unknown / 空 Label，不自动改跟进、发出或出席结果。

IP、设备 / 浏览器、来源网络地址等与当前邀请规划无关的元数据不进入联系人文件。未知字段在映射与后端校验中丢弃。原文网站 / 案例字段不可信，只作为文字存储；前端如提供可点击链接，必须另行验证 http / https，不能执行公式、HTML 或 javascript: 地址。

## 导入流程

浏览器读取用户主动选择的工作簿后，只将经字段映射的行发送到当前本地后台。每批 1–500 行，总量最多 5000 条；JSON 请求体继续限制 1 MiB，较大的来源须拆批。正式写入前必须预览：

1. 服务端归一文字、校验字段，并依据**来源标识 + 来源序号**判断新资料、完全相同或来源变更。
2. 完全相同的重复导入不新增联系人，不修改原有跟进、邀请记录或修订号。来源内容改变时整批拒绝提交，保留现有资料供人工核对，不静默 upsert。
3. 相同邮箱 / 微信只产生可能重复提示，不模糊匹配姓名、不自动合并。工作人员核对后明确选择「保留为不同联系人」才可继续。系统同时提示已有名单与同批新行的重复。
4. 同批重复序号、无效行、未知身份 / 参与标签和来源变更会阻止整批写入；没有部分成功。
5. 预览令牌只属于当前操作者，15 分钟有效，只保存在内存。提交须同时提供预览令牌与当前修订号；名单在预览后被其他人修改、服务重启或令牌过期，须重新预览。

预览不写文件。提交成功后才显示已保存的联系人；保存失败或结果未知时重新读取当前修订 / 来源序号确认，不能显示假成功。

## 跟进、排程与邀请函

工作人员维护独立的 operations：

    {"owner":"","priority":"normal","followUpAt":"","notes":"","responseStatus":"pending","sessionIds":[],"boothIds":[]}

priority 可为 normal / high，回复为 pending / attending / declined。日期采用 YYYY-MM-DD；负责人 / 跟进备注不自动公开。回复必须由工作人员根据实际联系明确更新，不从问卷原始意向、图片下载或「已发送」推断。

场次和展位关联使用现有内容草稿的稳定 ID，由工作人员手动选择。系统拒绝不存在、已取消或重复的 ID，并检查同一对象已排定场次的跨区时间冲突；相邻场次允许，草稿候选仍可内部规划。没有展位容量资料时不虚构限制，多个联系人可以同属一个展位。关联不自动把姓名写为公开讲者、不确认展位、不形成赞助权益，也不执行发布。

内容工作人员之后可能删除已关联的场次 / 展位。历史联系人仍可读取，界面应提示缺失引用；再次保存跟进时须移除或修正失效引用。这样既保留历史线索，也不会让新保存继续带无效安排。

邀请记录只保存当前设置与操作元数据，不把 PNG 内容放入公开数据：

    {"generatedAt":null,"settings":null,"sentAt":null,"channel":null,"sentGenerationAt":null}

生成器以用户提供的视觉模板预览及下载个人邀请图片；须在实际生成 / 下载成功后才请求记录生成。设置包含邀请称呼、日期、时段、场地及 confirmed。默认 confirmed:false，图片应明确标注暂定 / 待确认；不能因模板已有日期地点就自动声称所有事实已确认。

「记录已发送」只由工作人员在自己实际联系后手动操作，渠道为微信、邮箱或其他；接口不会发送邮件、微信或任何消息。图片生成、记录发送、对方回复相互独立。重新生成可保留上一次手动发送时间，sentGenerationAt 标明当时对应的生成版本，避免把新图片视为已经送达。

记录发送必须提供当时的 generatedAt 与完整 settings。服务器校验生成时间和归一后的设置均与已保存版本相符；修改称呼、日期、时段、场地或确认状态后，必须重新生成并核对实际发送的图片。版本 / 设置不符返回 409 INVITATION_GENERATION_MISMATCH，不产生发送记录。Wallet 与 EmailJS 当前只提供 [接入准备与预览](communications-setup.md)，没有实际发信或签发功能。

## HTTP 契约

所有接口都要求当前会话具有 outreach。所有写入同时要求准确的 Origin、会话 cookie 和 x-csrf-token，响应使用 Cache-Control: no-store。基础登录、退出、会话过期与限流沿用内容后台。

| 接口 | 请求与响应 |
| --- | --- |
| GET /api/admin/contacts | → {revision,contacts} |
| POST /api/admin/contacts/import/preview | {sourceKey,rows} → {previewToken,expiresAt,summary,rows,canCommit} |
| POST /api/admin/contacts/import | {expectedRevision,previewToken,allowPossibleDuplicates:false} → {revision,contacts,summary} |
| PUT /api/admin/contacts/:id | {expectedRevision,operations} → {revision,contact} |
| POST /api/admin/contacts/:id/invitation/generated | {expectedRevision,settings:{recipientName,date,time,venue,confirmed:false}} → {revision,contact} |
| POST /api/admin/contacts/:id/invitation/sent | {expectedRevision,channel,generatedAt,settings} → {revision,contact} |

预览行格式为 {sourceRowId,displayName,status,messages,duplicateContactIds}。status 为 new / unchanged / source_changed / invalid；汇总包含 total,new,unchanged,conflicts,invalid,possibleDuplicates，可能重复按涉及的新行计数。只有重复提示而无其他错误时 canCommit:true，提交仍必须显式 allowPossibleDuplicates:true。

联系人结构为 {id,source,profile,operations,invitation,createdAt,updatedAt}；profile 没有来源序号，序号位于 source.rowId。修订号属于整个私密名单，每次跟进或邀请记录写入均递增；旧修订返回 409。字段错误返回 422、未登录 401、无权限 / Origin / CSRF 拒绝 403、私密文件损坏 503，不自动重建覆盖文件。

公开 /api/public/content 继续只从内容存储投影场次与已确认展位。没有公开联系人接口，联系人、联络方式、问卷代码、负责人、回复、邀请设置及内部安排都不进入公开响应。审计只记录操作者、动作、修订、时间、数量及内部稳定 ID，不重复记录姓名、邮箱、原始问卷或邀请称呼。

## 备份、删除和恢复

停服后将 contacts.json 复制到 dist/ 和源码仓库外的受限位置；备份包含完整个人资料，应与原始工作簿和下载邀请图片同等限制访问，并设置明确保留期限。不要把备份作为测试 fixture 或发送给无名单职责的工作人员。

当前版本不提供批量导出或联网分发。需要更正来源资料、合并重复、单条删除 / 撤回时，先停服并保留受控备份，由维护人员按稳定 ID 在私密文件中核对处理；不能通过重新导入静默覆写。完整清空仅删除明确指定的 contacts.json，不会删除 content.json；下一次读取得到空名单。删除本机名单并不自动删除原始 Excel、已经下载或发送的图片、他人副本及备份，须按实际持有位置同步处理并登记删除要求。

损坏文件不自动重置。恢复时先保留损坏版本供核查，停服后恢复已知有效的完整快照；启动后检查修订、条数和近期跟进记录。恢复旧备份后必须重新执行其后已确认的删除 / 撤回请求。代码回滚不应覆盖私密名单或重置修订。

## 验证

tests/contacts-api.test.mjs 仅用合成资料测试：字段白名单及原始代码、outreach 权限、Origin / CSRF、预览不保存、来源幂等、来源变更整批拒绝、同批与已有重复复核、令牌操作者 / 期限 / 并发、独立修订、跨区时间冲突、删除引用后仍可读取、邀请生成 / 手动发送 / 回复分离、公开数据无联系人及损坏文件失败关闭。测试不读取用户工作簿、不联网、不发送消息。

新增负向测试覆盖拒绝、未知及旧版缺少联系同意字段的资料，均不能生成或记录发送邀请函；已核对同意的合成资料才进入邀请正向测试。
