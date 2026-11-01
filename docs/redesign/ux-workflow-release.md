# UX2 具名寄送與連續處理

2026-11-01，UX2 已由 [PR #57](https://github.com/kunanli/artdicohost/pull/57) 正式發布於 main `5ec4581531c31ad7c950d8c58234792fb7b1d37d`，PR／main CI、實際 FC／私有 OSS 與公開 HTTPS 核驗均通過；[UX1](ux-clarity-release.md) 與 UX2 軟體交付完成。實作分支為 `feat/ux-workflow`、計畫提交 `38f4432`，最終本地產品 `1af25152f70cac1963ba2ae48a11439fa4b9c756` 的準確包及瀏覽器證據在下方獨立保留，不以其本地 ZIP 代替實際部署 main 的證據。四項真人與真實資料驗收仍待記錄。

## 操作目標

| 任務 | 操作 | 真實結果與保護 |
| --- | --- | --- |
| 寄送正式確認信 | 看姓名、機構與資格，選人後明確寄送；內容預覽按需展開 | 不預設全選；接受或未知不能再選，新寄送前重新核對名額、許可、地址及開關 |
| 核對上次寄送 | 用原操作只讀取得已保存的結果與最後核對時間 | 查詢不寄信；結果仍不明、查不到或來源失敗不顯示未寄，也不解鎖新寄 |
| 重新整理後接續 | 先保存原請求，取得本機持久回執後才送出；回來只核對原操作 | 原正文、版本與身份不變，不保存姓名、信箱、私人連結或能力 token |
| 回到原名單 | 保留同分頁搜尋、篩選、頁碼、位置與焦點，先重讀目前資料 | 過期游標重新核對；搜尋可能含私人資料，使用可清除的短期 session snapshot，不放人員網址或 IDB |
| 繼續處理下一位 | 本人資料已保存／回讀確認後，提供可選「下一位」 | 不自動跳人；dirty、busy 或 unknown 時不能用跳轉繞過當前結果 |

同一人的出席、名額、通知與公開狀態仍分開保存。姓名／信箱不自動合併，既有別名以已保存來源為準；正式確認信、申請回執、行前提醒各自去重。服務商接受不等於送達。

## 原操作與舊記錄

- 正式具名預覽 `POST /registration-confirmation/preview` 及原操作 `GET /registration-confirmation/operation/<operationId>` 均位於 `/api/admin/`，沿用既有通知服務。每頁最多 100 人，只回姓名／機構及資格，不含信箱或私人連結；正式游標綁種類、來源、選取範圍及通知修訂。原操作查詢只允許原 actor 的 dispatch，不讀 provider／readiness；準確 DTO 見 [通知流程](../registration-confirmation.md#新增只读管理接口)。
- 原 dispatch 正文、requestHash、通知種類及 journal 不遷移。舊 parsed pending 保留原件，只取原 operationId 查詢，不重建正文後 POST；新操作保存原始 JSON bytes。
- 新單人 pending 綁 actor／roles／event／person。重新整理或 401 後，僅相同且仍有權限的作用範圍可恢復；明確登出沿用既有 `clearActor` 全清政策，重新登入改看雲端通知及歷史，不承諾恢復已刻意清除的本機原件。
- legacy 邀約的 unknown 保留原歷史核對；自動正式信沒有 operationId 時只讀既有 delivery／history，不虛構原操作。started dispatch 尚未留下 notice 時也保守待核對，不呈現為尚未寄送。
- started 尚無 notice 的來源窗口以可選 `unresolvedConfirmations:true` 摘要交給單人投影，通知歷史及數量不新增假紀錄。目錄僅在存在未完成正式批次時額外讀一次報名 index，按已保存別名產生有界狀態摘要，不用姓名或信箱猜人。
- 名單 session snapshot 在登出、401、角色或 view 不符時清除；回來仍先核對目前來源與權限，不從本機快照回填舊人員資料。

個人頁將已驗證原操作 GET 的伺服器 `checkedAt` 顯示為上次核對時間，並綁當前人員；恢復的 pending 明確顯示核對入口，不因服務區原先收合而藏起來。已保存／回讀確認且無未決結果時，可明確一按下一位；完成切人即清除核對中提示，切人或讀取失敗仍清除前人的畫面，不建立另一份「已完成」業務狀態。

### 已證明未執行的首次拒絕

只有全新操作的原正文首次 POST、從未 restore 或 unknown，收到後端在開始業務寫入前的明確 400／403／404／409，才可清除此筆本機 pending 並重新讀取來源。使用者重新選人後才能新寄；不改寫／重 POST 原正文、不刪 journal，也不提供通用手動解除。預覽後正常修訂競態的 409 可走這個已知未執行結果，不必逼同事登出。

lookup 的任何 4xx（包括 404／401）、已 restore／先前 unknown、503／timeout 或無法證明的回覆仍保鎖；401 清畫面後同作用範圍可重新授權恢復，明確登出則按原 `clearActor` 全清。完整原操作結果驗證及上述首次拒絕是不同處理，不互相冒用。

## 本輪驗證

最終公開建置於 09:45:06 UTC 產生 23 頁。與 09:38:55 的初次完整建置相比，僅個人頁 HTML 及其 JS 變更，其餘 70 個檔案位元組相同；首頁 SHA-256 仍為 `f5a188f45103591b6433e8059a47252b28290feed3be95c8d1f30720736dc9d5`，私人頁仍為 `be2e58607d90a9b2fa7a77fada3837164b86ae83f5df32958bc4325e5c02fd9e`。下表分開記錄最終產物與初次實跑後逐檔核對一致的證據，各分組不互相疊加為測試總數。

| 檢查 | 已核對結果 |
| --- | --- |
| 完整 Node | 最終 `1af25152` 為 1586／1586，fail／cancelled／skipped／todo 全為 0，程序實際退出 0；耗時約 108.25 秒。定向分組不再加總為額外測試數 |
| 來源／Astro／建置 | 704 個來源檔通過；Astro 472 檔零錯誤／警告，保留 1 項既有 hint；公開建置 23 頁 |
| 專案 Skill 與依賴 | 本輪契約 109、服務／客戶端旅程 108 項均實際退出 0；依賴審計無已知漏洞 |
| 獨立審查 | 41 項聚焦案例通過；已處理審查阻塞並對 `924d427` 完成最後簽核，包含 started 投影、原操作／核對時間與下一位 |
| 準確 FC 來源包 | 最終 `1af25152` prepare／verify 通過：128 個允許檔案（含 release）、40 個後台資產、7,585,723 靜態 bytes；ZIP 35,714,952 bytes，SHA-256 `fc904205bb77d2be162acd9bd06ff10ba84ebe244b086a245c86a1a939ec9fa4`，未放寬上限 |
| 產物來源 | 最終公開 prepare 得到 51 檔。準確 FC 的非 HTML 資源與 root dist 位元組核對，7 個 canonical HTML 僅有既定公開內容 meta 差異；組合驗收頁與 13 個別名均為準確 FC bytes。40 個後台資產中 38 個與初次候選相同；正式 picker 及 P4 各實際載入的 10 個資產全部與最終候選相同，據此沿用已通過證據 |
| 準確 FC 選人／恢復 | [正式選人](../../tests/browser/ux2-formal-picker-smoke.mjs) 10 案、[單人／名單](../../tests/browser/ux2-person-workflow-smoke.mjs) 12 案及既有 P4 通知 10 案均實際退出 0、無頁面錯誤；使用準確 canonical HTML／資產。單人 12 案已在最終版本重跑，三種寬度均斷言切人完成後清除核對提示；最終個人 HTML SHA-256 為 `d86f9c10f85a3f2b467381b7fd1861d64a4388488739b8d11999f1e2b9e0ac82`。包含姓名選取、原正文先持久保存、GET 原操作、首次已知拒絕、401／登出差異、返回位置及明確下一位 |
| 公開頁與跨入口 | 最後公開建置的首頁 7 案、私人聚焦 8 案及 A14 活動事實 4 案均實際退出 0；A14 使用可丟棄合成簽章與 mock 通知，不表示真機添加或收件完成 |
| 固定旅程 | 申請／審核 15、重複核對 3、既有報名工作流 3、群設定 7 個情境，四個腳本均實際退出 0 |
| 既有後台 | P2 個人頁 5、目錄 4、統一名單 6 個情境在最終產品均重跑並實際退出 0，保留恢復、權限及不自動寫入等原斷言 |

- [x] 服務／客戶端定向涵蓋具名預覽、來源／種類／別名與權限，以及原正文、恢復、首次明確拒絕和未知保護。
- [x] 全套 Node、來源／Astro／建置／審計、專案 Skill 及獨立審查。
- [x] 準確 FC／公開產物及既有容量上限。
- [x] 名單往返、可選下一位、焦點／位置與切人清理的實際編譯瀏覽器。
- [x] 正式選人／原操作恢復及必要既有回歸的實際編譯瀏覽器。
- [x] PR CI 與合併。
- [x] main CI 與實際 FC／OSS／HTTPS。

本地功能測試僅使用合成物件、收件人、provider 與全攔截瀏覽器；正式核驗另記如下。沿用既有架構及受控 EmailJS／Apple 設定，不新增 journal、伺服器 runtime 來源檔、依賴、服務或排程；保留 128 檔／40 個後台資產／8 MiB 及 48,000,000-byte 上傳限制。

新增實際編譯瀏覽器入口為 `ux2-formal-picker-smoke.mjs` 與 `ux2-person-workflow-smoke.mjs`，執行方式見 [瀏覽器說明](../../tests/browser/README.md)。本輪報告分別保存在忽略的 `.local-data/browser-evidence/ux2-formal-picker`、`ux2-person-workflow`、`ux2-notifications` 等目錄，包含結果、來源及比較摘要。最終包為 `.local-data/ux2-cloud-content-final`，公開檔為 `.local-data/ux2-oss-publish-final`；`.local-data/browser-evidence/ux2-exact-fc-provenance-final/` 的 `package.json`、`combined.json` 與 `unchanged-browser-bindings.json` 保存最終來源及沿用證據。未來維護仍須綁定當次產物，不能因腳本存在而算通過。

## PR 與實際發布

- [PR #57](https://github.com/kunanli/artdicohost/pull/57) head `babd0a38970062bab24acab20559ec3cdaa62449` 的 [CI 41294783416](https://github.com/kunanli/artdicohost/actions/runs/41294783416) completed／success。CI 實際測試的是合成合併 checkout `ee893ca60e8660595298bbacbad0edbb57bd5dee`：1586 項測試、704 個來源檔、Astro 472 檔通過；準確 FC 128 檔／40 資產／13 個別名離線啟動及 51 個公開檔案核對通過。
- 已部署 main `5ec4581531c31ad7c950d8c58234792fb7b1d37d` 的 [流程 41295125988](https://github.com/kunanli/artdicohost/actions/runs/41295125988) completed／success，四項工作均成功：[check](https://github.com/kunanli/artdicohost/actions/runs/41295125988/job/124814256554)、[transport](https://github.com/kunanli/artdicohost/actions/runs/41295125988/job/124814256792)、[FC](https://github.com/kunanli/artdicohost/actions/runs/41295125988/job/124815215280) 及 [OSS](https://github.com/kunanli/artdicohost/actions/runs/41295125988/job/124815943654)。實際 main 檢查為 1586 項測試全通過、fail／cancelled／skipped／todo 全為 0，704 個來源檔及 Astro 472 檔零錯誤／警告、保留 1 項既有 hint；來源 `5ec45815` 的準確 FC 128 檔／40 資產／13 別名離線啟動與公開 51 檔核對通過。
- 本次補證據分支為 `docs/ux-final-release-proof`，自上述 main 建立，只保存實際結果；不改產品，不為文件重複觸發 main 程式部署。

| 正式核驗（2026-11-01 UTC） | 實際結果 |
| --- | --- |
| 10:02:15.9171031 | Cloud lifecycle 核對準確來源 `5ec45815`，內容與報名均啟用；私有 OSS 驗收通過，兩個獨立客戶端／一個 FC 程序 |
| 10:02:19.8550837 | 13 個準確後台頁面的 HTTPS 核對通過 |
| 10:02:20.698741 | 匿名公開內容／CORS 核對通過；既有已發布快照仍為修訂 43、`publishedAt` 為 10 月 22 日。公開項目為嘉賓 9、組織 7、作品 1、展位 16、場次 43；這些是已公開內容數量，不是已確認出席或私有人員總數 |
| 10:03:49.5000904 | `artdico.host` 的 51 個準確公開物件 HTTPS 核對通過，來源 `5ec45815`，含既有快取防護 |

本輪只發布已授權軟體並核對既有服務，沒有新增服務或代做業務資料整合、核准、實寄通知、群碼更新及內容發布。

本次正式證據摘要保存在忽略的 `.local-data/browser-evidence/ux2-live-publication/proof.json`，記錄已部署 main、四項成功工作與線上核驗；不取代上方獨立的本地候選產物證據。

## 人工只需記錄這幾項

- [ ] **同事試操作：**用合成人員完成找人、保存、返回原名單及下一位；在測試情境核對未知寄送，記錄停頓或誤解，不在正式名單製造故障。
- [ ] **新增通知實收：**由有權限主辦方與授權測試收件者確認內容、寄件／回覆地址及收件匣／垃圾郵件結果；provider 接受不代替本項。
- [ ] **真微信／iPhone：**查私人頁、複製保存、實際辨識群碼入群，在 Safari 看到 Wallet 添加畫面並加入；不公開私人連結、群碼或憑證。
- [ ] **真實資料：**操作人員另核對來源、名額、出席、素材及群碼，再執行相應業務操作；程式部署不代為整合、核准、寄信或發布。

回退與修復沿用 [備份／隔離恢復](../maintenance-backup.md) 及 [發布清單](03-release-and-acceptance.md)。通知 journal 與名單不回寫舊快照；相容修復須保留原操作查詢、新 pending 的作用範圍及 started／unknown 保護，不能清除通知預留來重寄。
