---
name: artdico-contract-check
description: Check ARTDiCO HOST data contracts before or after schema, public projection, identity, booth, media or event changes. Review legacy compatibility and run fixed synthetic contract regressions without reading production records or contacting services.
---

# ARTDiCO HOST 資料契約與相容檢查

在修改資料結構、公開投影、人物來源、作品分類、展位規則、活動資訊或持久化流程時使用。交付一份可追溯的契約差異與本機回歸結果；這個技能不授權正式名單整合、公開草稿、寄信或部署。

## 先讀目前規則

1. 閱讀倉庫 `AGENTS.md`、[改版決策](../../../docs/redesign/README.md)、[實作步驟](../../../docs/redesign/01-implementation-steps.md) 與受影響的既有契約。
2. 記錄當前提交、工作區未提交差異與本次要改的行為。對話中的新決策優先於過時文檔；不要用舊測試通過證明新需求已完成。
3. 檢查 `shared/content-schema.mjs`、`shared/contacts-schema.mjs`、相關 store／handler、公開讀取端及測試。參照[統一人員](../../../docs/unified-people-workspace.md)、[預設公開與凍結版本](../../../docs/default-public-visibility.md)和[備份恢復](../../../docs/maintenance-backup.md)。
4. 只讀合成夾具與程式。不要開 `.env`、原始 Excel、私有物件、真實收件人或憑證來完成本技能。

## 逐項檢查契約差異

| 範圍 | 必須核對的問題 |
| --- | --- |
| 舊記錄與快照 | 缺省欄位、舊 `team` 分類、凍結公開內容能否繼續讀取？GET 是否保持無寫入？新增投影是否會被整份 envelope 校驗拒絕？ |
| 更新與恢復 | 舊客戶端漏傳是否保留新欄位？明確空值能否清除？穩定 ID、原正文、expectedRevision、operationId 與未知 ACK 是否保留？ |
| 人員與來源 | 原問卷、provenance、同意與通知歷史是否不被覆寫？相同姓名／信箱是否僅作線索？主報名與別名是否仍只有一份有效名額？ |
| 出席與公開 | 資料確認、本人回覆、名額、公開設定是否分開？新版嘉賓出席證明的來源與修訂是否可核對？私人 contactId／聯絡方式不得進公開回應。 |
| 場次與展位 | 多人職責與舊 guestId 是否相容？嘉賓區篩選會否意外清空日程？展位擴充是否同步 schema、store、總覽 API、回應校驗、編排器及恢復？ |
| 圖片與活動資訊 | 圖片格式／像素／體積邊界及公開引用是否仍有效？首頁、私人頁、新 Email 與新 Wallet 是否使用一致的已核實活動事實？ |
| 權限與回退 | API 是否先授權再讀私人來源？跨來源衝突是否保留舊版本？回退版本是否能讀取已寫入的新欄位及既有 personGroups／v3？ |

對每項受影響契約寫出：原行為、新行為、舊資料如何讀、誰能改、失敗時保留什麼，以及哪個測試可以證明。未涉及的範圍標示不適用，避免產生與本次變更無關的待辦。

## 執行本機合成回歸

從倉庫根目錄使用固定 runner：

```sh
node .agents/skills/artdico-contract-check/scripts/check-contracts.mjs --list
node .agents/skills/artdico-contract-check/scripts/check-contracts.mjs
```

修改範圍很小時可先選一組；需要交付整體契約證據時執行全部：

```sh
node .agents/skills/artdico-contract-check/scripts/check-contracts.mjs --group publication
node .agents/skills/artdico-contract-check/scripts/check-contracts.mjs --group persistence
node .agents/skills/artdico-contract-check/scripts/check-contracts.mjs --group provenance
node .agents/skills/artdico-contract-check/scripts/check-contracts.mjs --group media-event
```

runner 只接受以上固定組名，不接受自訂測試路徑、遠端網址或帳號。它核對倉庫與測試檔，再使用目前 Node 執行既有合成測試；不安裝套件、不載入 `.env`，子程序不繼承雲端憑據。選定測試使用合成資料、內存物件或自行建立並清理的暫存目錄。runner 本身不建立網路連線，也不讀正式資料。

各組結果包含測試數、通過、失敗、取消、跳過及 todo；缺檔、逾時、非零退出、零測試或未完成項目都不算通過。失敗時保留捕捉到的合成測試 stdout／stderr，並提供固定重跑命令供修復後核對；不能修改斷言只為通過。

新增或改動被選測試時，先重新檢查它們仍使用隔離替身。需要新契約案例時把有意義的測試加入既有測試目錄，審閱後更新固定清單；不改成接收任意命令或任意測試路徑。

## 新需求與既有回歸分開

目前回歸保護所選資料格式與行為，包括舊分類可讀、預設公開及展位契約。P1a 已發布新編輯兩類、舊 `team`／缺省保留與動態展位，見 [P1a 紀錄](../../../docs/redesign/p1a-release.md)。固定展位格數是歷史規則，不應保留為現在的產品要求。

runner 固定清單未涵蓋全部新增案例，通過不能單獨證明 P1a／P1b 完整驗收。另核對兩類寫入限制、兩個 store 的舊資料保留、超過舊位置範圍的儲存與恢復、版本 2 總覽與編排，以及聚焦瀏覽器案例。P1b 的出席投影、多人場次、跨來源修訂及新通知／票券資訊核對已實作，當前證據見 [P1b 紀錄](../../../docs/redesign/p1b-release.md)；維護時另跑 `tests/p1b-*.test.mjs` 與 `tests/browser/p1b-attendance-smoke.mjs`。

實作各項新需求時，依[驗收 A09 至 A14](../../../docs/redesign/03-release-and-acceptance.md)補充或調整案例，保留舊 bytes、權限、併發與未知結果的保護。用合成資料驗證，不拿正式記錄做遷移測試。

P2 的簡約人員入口與唯讀核對已本地實作，證據及未完成交付見 [P2 紀錄](../../../docs/redesign/p2-release.md)。另核對 `tests/p2-*.test.mjs`：待處理先篩選後分頁、有界核對與未知來源、規範來源別名保留未知通知，以及歷史截斷前的最小狀態；不能靠同信箱聚合無關人員，也不能由讀取修復業務資料。固定 runner 清單不因此擴充，瀏覽器與正式發布另驗。

## 交付結果

回報以下內容即可：

1. 檢查的提交／工作區、契約差異及受影響模組。
2. 實際執行的組別、測試數、結果；沒有執行的項目明確列出。
3. 新需求的驗收案例與尚未證明的行為，不沿用歷史測試數量。
4. 需要先修復的相容性問題與下一個具體動作。

結果不含原問卷、私人連結、憑據、真實聯絡資料或完整物件內容。完整部署／iPhone／微信驗收按[發布清單](../../../docs/redesign/03-release-and-acceptance.md)另行執行，本技能通過不代替它們。
