---
name: artdico-visual-check
description: Verify ARTDiCO homepage changes against the supplied design and the actual anonymous publication/media that reproduced the reported issue. Check readable guest bubbles, bounded logos, motion and responsive screenshots without changing business data.
---

# ARTDiCO 首頁視覺驗收

用於首頁版型、嘉賓氣泡、組織標誌及動態修正。先讀 `AGENTS.md`、[目前決策](../../../docs/redesign/README.md) 和 [瀏覽器入口](../../../tests/browser/README.md)。沿用會話已有的修復／發布授權，不新增確認流程；本技能本身不授權寫正式資料、寄信、發布業務草稿或部署。

## 先保留兩種不同證據

1. **設計依據：**記錄 `FrontEnd_Resource/落地页.png`、相關原始組件的 SHA、尺寸及本次量測位置。說明容差與動態資料造成的差異，不把整頁截圖存在稱作逐像素一致。
2. **問題輸入：**用 `scripts/capture-public-visual-fixture.mjs` 擷取同一個實際公開快照及受影響標誌 bytes。保留公開修訂、時間、snapshot SHA、媒體 path／SHA／bytes。核對與回報問題的版本是否一致；只有原稿白色 PNG 或合成姓名的測試，不能當作正式站問題已重現或修復。

擷取只走腳本固定的匿名公開端點及經驗證的同源內容雜湊圖片，限制體積／時間，拒絕重新導向與認證。不得讀 `.env`、私有物件、報名／聯絡名單或登入資料。原始公開快照及圖片只留忽略的 `.local-data`／短期 CI artifact，不提交 repository、不把姓名或原始內容印進日誌。

本機網路若不允許該網域，在已允許的既有 CI 執行固定擷取及瀏覽器驗證，下載報告／截圖；不得建立代理、base64 中繼或繞過網路限制。可逆修復、合成回歸及原稿比對可繼續，但取得實際素材驗證前，不宣稱正式問題已驗收。

## 使用實際編譯頁面

依既有流程先建置，凍結來源與 `dist`，再執行：

```sh
# 固定公開來源可連線的 CI；新工作目錄保留一次完整擷取。
node scripts/capture-public-visual-fixture.mjs

# 以同一份完整擷取攔截全部瀏覽器請求，無業務寫入。
ARTDICO_PUBLIC_VISUAL_FIXTURE_DIRECTORY=/absolute/path/.local-data/public-visual-fixture \
ARTDICO_DIST_DIRECTORY=/absolute/path/dist \
ARTDICO_BUBBLES_EVIDENCE_DIRECTORY=/absolute/path/.local-data/browser-evidence/bubbles-logo-bounds \
node tests/browser/bubbles-logo-bounds-smoke.mjs
```

Playwright／Chromium 路徑依瀏覽器說明設定。腳本缺失或尚未執行時明記待驗，不以檔名存在當作通過。執行中不重建 `dist`；改產品後，按實際變更與資產 SHA 決定必要重驗，保留先前失敗及版本資格。

## 必驗畫面與操作

| 範圍 | 驗收要求 |
| --- | --- |
| 320／390／1440／1920 | 實際公開資料與圖片皆有測試，無橫向溢出。正常捲動並 decode 圖片後，人工看桌面／手機整頁及嘉賓、組織、頁尾截圖。 |
| 嘉賓文字 | 姓名、職稱可讀且無內部捲動條／捲動容器；檢查 computed overflow 與布局，不只看某作業系統是否畫出 scrollbar。長字可合理換行／省略，但展開處保留真實全文。 |
| 單位與職稱 | 圓泡依序顯示姓名、實際公開 `company`、實際公開 `title`；職稱缺省時僅用既有 `ggjRole` 或留空，單位不得取代職稱。有值的兩欄須同時可見且不重疊；長欄位在展開處保留全文。不由姓名、照片或參考卡片猜職稱，出席與名額仍分開。 |
| 字體與對比 | 首頁功能文字依 `home-typography.css` 的角色管理，正文／輸入至少 16px、輔助至少 14px；展示字另用 display token。以最終 computed style 檢查標籤、同意、提示、告知框與未知結果恢復面板，文字和實際合成背景對比至少 4.5:1，不能只改父元素或只加大淺字白底的字級。 |
| 標誌邊界 | 每張實際 IMG／卡片矩形都在自己的固定框內，任兩框不重疊；完整標誌保比例。另驗白底方圖、直式、橫式、大透明留白、缺圖及未知／重複組織。不能只量白色 ink 或只驗原稿透明圖。 |
| 原稿變體 | 已知白色變體綁明確原始圖 digest；透明裁邊記錄來源、裁切框及像素相等證據。未匹配或日後更換 hash 的上傳圖使用新上傳來源，不讓舊變體遮住更新。2026-11-02使用者明確要求前台統一白色：原檔及後台不改，白色呈現另驗透明度、封閉字洞及矩形邊界；不能把不透明白底變成整張白板或猜造Logo。 |
| 氣泡動態 | 驗實際 WAAPI／動畫位置有輕微錯開漂浮；hover、focus、展開時穩定，離開視口／頁面隱藏時暫停，返回可恢復；reduced motion 初始及中途切換均停止。鍵盤／觸控展開、Escape 與焦點不受漂浮干擾。 |
| 置頂與長頁捲動 | 使用 `home-scroll-motion-smoke.mjs` 的獨立6案核對四寬度、無JS／無IO、viewport header top0、native wheel、嚴格錨點留白、目前段落／進度線、選單鍵盤與刷新位置。不可用隱藏文字等候觀察器，也不能讓頁緣canvas攔點擊。平滑捲動須等真實穩定位置；無JS不可依賴頁內RAF作測試等待。 |
| Hero與顆粒 | 驗真實可見ambient RAF、桌面pointer姿態、減量手機顆粒、初始／途中reduced motion及背景頁停止；球體可動、標題穩定，畫布／DPR有界。2026-11-02使用者要求Hero球體退入全頁背景及全畫面星點持續，覆蓋舊頁緣閒置停繪／Hero離屏idle0規則；改驗單一ambient迴圈、實際繪圖FPS預算、手機減量、球體退遠與內容後方分層，無JS／無IO靜態降級；不把合成visibility或RAF probe冒稱OS／電量量測。新6案、排版4案與實際素材13案分別核對完整報告與相同來源／HTML SHA。 |

合成的空證明、錯誤讀取、長文字及極端圖片案例標明是邊界測試，不能冒充實際 OS、真機或正式輸入。不要為了通過而放寬量值，先查實際素材與繼承樣式。

## 完成證據

記錄來源 commit、CI run、擷取修訂／SHA、建置 HTML／已請求資產 SHA、案例數與實際 exit code、頁面錯誤及截圖人工結論。日誌只輸出固定錯誤代碼／案例與數量，避免 assertion 差異洩出原始姓名或內容。**只有 CI 實際擷取與實際素材瀏覽器步驟成功、報告摘要核對完成，才標視覺修復驗收通過。** 正式上線另核對既有 FC／OSS／HTTPS 發布回執；測試與發布各自如實記錄。
