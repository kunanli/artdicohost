# 用户与参会资料 Excel 导出

2026-10-21。日常角色、回复、名额与场次调整保留原始报名及历史，不以删除后重建实现。个人权利申请仍单独处理；取消／撤回不表示已物理擦除。

## 两个明确范围

1. 报名后台「导出 Excel 工作簿」只导出当前明确筛选的已保存报名，默认包含候补与撤回状态，除非主动筛选状态。报名原填写身份／意向、目前有效参会状态、名额索引状态、审核与住宿分别列出。可另选完整原始回答、结构化联络字段及实际职责／场次／展位。职责通过既有转换关联的稳定 ID 连接，不按姓名猜测。
2. 人员后台「导出全部联系人 Excel」明确导出全部已保存筹备人员，包括未代登记和拒绝者，不沿用报名筛选。可另选结构化联络字段及完整意向回答／筹备备注。拒绝者保留在资料中，不因能导出而取得发信或参会资格。

所有单元格以 OOXML `inlineStr` 写入，姓名 `=SUM(...)`、以零开头的编号与日期样式原文均作为文字。输出是真正 `.xlsx` ZIP／工作表，不是 CSV 改副档名。每张表固定表头、首行冻结、自动筛选；单文件最多 8 MiB，超限明确失败，不截断资料。CSV 仍作为简表选项，默认无联络方式。

## 受控 API

| 路径 | 方法与输入 | 权限 |
| --- | --- | --- |
| `/api/admin/registrations/export.xlsx` | POST `{expectedRevision,filters?,includeContact:false,includeAnswers:false,includeArrangements:false}` | reviewer／superadmin 后再核对 `canExport`；默认仅 superadmin，联络字段仅 superadmin。额外读取筹备安排需 reviewer+outreach 或 superadmin。 |
| `/api/admin/contacts/export.xlsx` | POST `{expectedRevision,includeContact:false,includeAnswers:false}` | outreach／superadmin。明确导出完整已保存联系人，不能夹带报名筛选。 |

准确 API Origin、会话、CSRF、固定路由与有界 JSON 先于所有资料读取。原始回答的自由文本可能自行含有联络信息，界面明确提醒管理员核对分享范围；结构化联络字段仍需主动选择。不生成公共 URL、不写公开 OSS、不自动发给 Maria 或其他人。

报名导出使用 review journal CAS，追加既有 `export` 事件的 XLSX 变体，包含格式、条数、字段范围、文件 SHA-256 与报名／名额／联系人／内容修订；原 CSV 审计仍可读取。报名和名额修订必须相同，避免新报名或名额变化时拼接不一致。审核已撤回或有删除请求时，有效参会状态为 withdrawn；仍保留名额索引原状态，诚实反映待协调的释放间隙。

联系人导出追加全局 `export_contacts` 审计，不改变个人 updatedAt、资料、来源或回复。先构造有界文件，再对同一联系人修订提交条数、选择范围与摘要；只有明确提交 ACK 后才返回文件。未知 ACK 不返回 Excel、不自动重试；重新读取状态后由工作人员明确决定再次导出。

联系人与内容来自独立日志，审计记录读取修订，不宣称跨日志原子事务。导出是当前资料快照，不能代替完整加密备份、历史审计及原始附件。XLSX 新审计需兼容版本读取，回退前应关闭写入并保留完整备份，不能用旧 schema 覆盖新历史。

## 代码与装配

- `shared/xlsx-workbook.mjs`：有界纯 OOXML／ZIP 文字工作簿，无运行期第三方依赖。
- `functions/registration-admin/xlsx-export.mjs`：明确范围的报名与全部联系人投影。
- `functions/registration-admin/xlsx-handler.mjs`：`createRegistrationXlsxApi`、`createContactsXlsxApi`，需在泛用后台路由之前装配。
- `reviewStore.exportXlsx`、`contactsStore.recordExport`：提交导出审计，原件不变。
- `src/lib/xlsx-download.mjs`：只接受固定 XLSX MIME、长度、摘要与 8 MiB 完整文件；跨会话回应丢弃，不重试；退出时撤销私密 Blob URL。

检查使用合成资料；`tests/xlsx-workbook.test.mjs` 用现有 `read-excel-file` 真正读回中文、编号、公式样式文字及多工作表。导出服务检查范围／权限、修订竞争、未知 ACK、旧审计相容、当前逐场次职责、拒绝／未代登记保留；下载检查摘要与会话变化。生产装配、完整 CI 与正式发布证据由主集成记录，不把本地合成检查称为真实名单已迁移。
