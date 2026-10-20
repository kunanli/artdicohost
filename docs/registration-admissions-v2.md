# 實際參會人數、候補與團隊關聯

本文件是工作中斷後的接續契約。正式容量仍由受控活動政策固定為 300；測試使用合成小容量。所有已確認人員，包括工作人員，一人一筆，共同受此上限限制。團隊只是既有個人報名 ID 的關聯，不接受匿名人數，也不替未登記的同行者建立網站同意。

## 狀態與額度

`confirmed` 佔一個實際名額；`waitlisted` 有持久收據，但不佔正式名額、不取得群組 QR 或正式邀請；`withdrawn` 終止，不可藉更改工作人員標籤、設定或團隊使其復活。候補依不可變的登記順序挑選最早且符合額度者。取消已確認人員只釋出一次，取消候補不釋出正式名額。

`staffReserve` 預設 0，由 superadmin 設定，範圍為 0 至總容量。一般參會已確認數不得超過 `capacity - staffReserve`；工作人員可使用尚餘的共同總額，並非額外擴充容量。若只剩預留工作人員名額，較早的一般候補會保留候補，較後且符合資格的工作人員可以轉正。提高預留額度或將工作人員改為一般參會，若會使既有已確認人員超限，回傳 `capacity_conflict`，不自動降級任何人。

`waitlistEnabled` 建構預設為 false，以保留舊整合行為；正式 runtime 必須以受控環境設定明確啟用 true，這是本階段的正式配置。索引首次 v2 提交保存設定後，持久設定優先於下一次執行個體的初始值。關閉候補只拒絕新的滿額登記；既有候補仍保留收據並可在釋出後轉正。

## 唯一提交點與相容性

沿用私密 `cms/v1/registrations/<eventId>/index` journal，沒有新增 IAM 或公開物件。不可變 `records/<hash>.json` 維持 v1 格式，舊檔不覆寫。v1 索引只讀時將既有個人保守視為已確認一般參會；初始預留額度最多採用仍空出的總額，不能排擠歷史席位。第一次新操作把索引升級為 v2，保存舊 `baseRevision`；後續提高額度仍須經過明確審計並拒絕超額。

v2 索引的 `admissions` 包含 `settings`、以 registration ID 為鍵的個人狀態、團隊連結及有界 audit。每一個新登記、設定變更、標籤、取消、轉正或團隊變更都在同一次 CAS 內更新狀態與 audit。journal revision 等於 CAS 次數，不再等於報名筆數。已確認總額及一般參會額度在讀入和提交前都驗證；損壞、超限或不認識的狀態皆拒絕。

索引最多 1000 筆個人紀錄（含候補與撤回），最多 100 個團隊，每隊 1–50 個既有個人，個人最多屬於一隊；新增個人只可透過真實登記流程。最多 2000 個新增 v2 操作及 1 MiB 索引，達界限時停止寫入，不能裁掉幂等或撤回歷史來騰空間。journal 自身繼續沿用原有大小界限。

只有可證明的 CAS 409 可讓一般提交重新競爭；管理操作遇 CAS 衝突回傳 `conflict`。未知 ACK 一律回傳 `unavailable`，不自行重送。管理介面保存 `operationId` 和原始內容，明確重試同一操作可以從 audit 證明既有結果，不能再釋出或再次轉正。換內容沿用 operationId 回傳衝突。

## 服務契約

建構新增 `waitlistEnabled=false`、`staffReserve=0`。公開收據既有欄位保留，增加 `admissionStatus`、`admissionKind`、`admissionRevision`。相同原始 payload 的安全重播回傳同一不可變收據身份及最新名額狀態；候補轉正後可取得已確認回覆。已撤回仍回傳既有 `withdrawn` 結果，不能取得 QR。公開回覆不提供內部 queueNumber。

`metadata().admissions` 是無個資總數：`capacity,staffReserve,waitlistEnabled,confirmedCount,attendeeConfirmedCount,crewConfirmedCount,waitlistCount,withdrawnCount,totalRegistered,teamCount,remainingTotal,remainingPublic`。期間內仍有一般空位或候補已啟用時表單開啟；截止及維護關閉仍拒絕新寫入，且繼續提供經驗證的隱私聯絡資料。已保存的原鍵可以在截止或滿額後取得 token 及重播。

`getAdmissions({actor})` 供 reviewer / superadmin，回傳 `{revision,settings,summary,people,teams,auditCount}`。people 只有 `{registrationId,kind,status,queueNumber,changedAt,teamId}`，不載入姓名或聯絡資料。`changedAt` 是最近名額變更時間；`queueNumber` 是不變的登記先後序，不是即時候補排名。未組隊的 teamId 是空字串。

下列修改均帶 `{actor,expectedRevision,operationId}`。operationId 為 32–128 字元 base64url（64 位 hex 亦可）；成功 `{outcome:'updated'|'replayed',...snapshot,promotedIds,releasedIds,registrationId?,teamId?}`。安全失敗為 `invalid,conflict,forbidden,not_found,capacity_conflict,unavailable`；人工新登記在政策關閉時另有 `closed`。

| 方法 | 其他參數 | 角色 |
| --- | --- | --- |
| `setAdmissionSettings` | `settings:{staffReserve,waitlistEnabled}` | superadmin |
| `setAdmissionKind` | `registrationId,kind:'attendee'|'crew'` | superadmin |
| `withdrawAdmission` | `registrationId` | reviewer / superadmin |
| `promoteAdmissions` | 無 | reviewer / superadmin |
| `saveAdmissionTeam` | `team:{id?:既有團隊ID,name,memberIds}` | reviewer / superadmin |
| `removeAdmissionTeam` | `teamId` | reviewer / superadmin |
| `addStaffMember` | `input:{fields,permissionReference,kind}` | superadmin |

人工新增只需實際已知的姓名及 email / wechat 至少一種，其他資料留缺。來源為 `staff_entry`，保存 actorId、recordedAt、permissionReference、operationId；consent 明確為 `{accepted:false,version:null,acceptedAt:null}`。既有意向轉入仍使用 `staff_assisted` 及原來源鍵，不偽造網站同意。

`getAdmissionStatus(registrationId)` 是可信內部證明方法，驗證索引、該個人的不可變檔案及審核撤回 callback，回傳 `{status,kind,revision,queueNumber}`。缺資料、損壞、審核查詢失敗均丟出不含個資的 RegistrationStorageError。正式邀請與 QR 只在此方法確認 `confirmed` 後提供，不能把缺少欄位解釋成 confirmed。

## 審核協調與效能

審核及名額 journal 不假裝跨 journal 原子交易。先保存審核撤回或刪除待處置標記，`isWithdrawn` 即時拒絕原收據、邀請與 QR；再以已保存的審核 revision 衍生穩定 operationId，讀取當前名額 revision 後呼叫一次 withdrawAdmission。未知 ACK 留待相同操作明確恢復，不能自動盲重送。中途失敗保守保留佔用名額，不超賣；管理員重試後完成釋出與轉正。

getAdmissions 是單次非個資索引快照，暫存上述協調間隙的保守佔用數。每日待辦等批次畫面須合併已批次讀取的審核狀態，立即排除撤回者；不得為 300 列逐一呼叫個人證明方法。正式 runtime 應注入 `getWithdrawnIds:()=>reviewStore.inactiveRegistrationIds()`，每次候補／管理操作以一次審核 journal 讀取取得已驗證的撤回 ID，與候選者交集，沒有跨請求快取。未提供批次 hook 的測試整合才使用最多 8 個並行的個別審核查詢。兩者查詢失敗皆不提交任何局部變更；個人 getAdmissionStatus 仍使用個別 isWithdrawn 證明。原始個人資料列表仍有 8 並行及 12 秒上限。

## 接續與驗證

執行 `node tests/registration-admissions.test.mjs`，並跑原 registration-service 與 registration-repository-list 測試。新案例涵蓋跨執行個體最後一席競爭、候補持久收據及 QR 隔離、共同總額／預留、取消一次與 FIFO、操作 CAS 競爭、未知 ACK 恢復、審核撤回／查詢失敗、真實個人團隊連結、人工工作人員來源、設定跨實例恢復、v1 不可變相容、損壞索引／個人檔案拒絕、最多 8 個審核查詢。

HTTP、runtime、受控環境變數、前端及實際 OSS 發布驗收由主整合分工負責；本文件的單元測試不代表正式環境已開放候補。回滾只回滾程式與靜態資產；v2 索引不可交給只認 v1 的舊版寫入者，也不可用舊快照覆蓋正式報名。需要修復時先停止新寫入、保存私密備份、用支援 v2 的程式恢復及核對 audit，重新套用撤回標記後才開放。
