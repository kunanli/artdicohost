# 明顯粒子與簡報式捲動淡入

2026-11-02（Asia/Taipei）。承接使用者「只有小動效、看不到粒子」的實際回報；前版 [PR #62](scroll-motion-release.md) 的 `.8→1` 進場及微小粒子不足以滿足可感知效果。本輪 [PR #63](https://github.com/kunanli/artdicohost/pull/63) 已正式發布 main `80895d8d4f64e7d9806f1f2c6c0606d3a33215de`；[正式流程 41379869399](https://github.com/kunanli/artdicohost/actions/runs/41379869399) 四工作 completed／success，準確 6／4／13 報告及 FC／OSS／HTTPS 回執均已核對。以下日誌時間均為 UTC。

## 實際改動

- 區塊標題先以 `0→1`、36px 上移、840ms 進場；內容延後 160ms，並排卡片每欄再錯開 80ms，最多延遲 400ms。嘉賓、組織、作品、日程逐行、展位與 Q&A 使用 opacity-only，保留卡片幾何與嘉賓原有漂浮。
- HTML 預設可見，只有觀察器確認進入視窗後才建立短 WAAPI；沒有永久隱藏等待的 CSS。焦點、互動、直接導覽及減少動態立即恢復可讀。進場每項一次，已進場穩定 ID 的公開卡片刷新後不重新淡出。
- 修正非互動背景的觸控 `pointerdown` 提前把整段標為已進場：手機原生拖動會保留後續動畫；直接跳區塊只立即穩定標題，後續卡片仍正常進場。沒有捲動劫持或強制分頁。
- Hero 手機 16／桌面 32 點，主點約 2px／2.2–2.9px，加上亮核、柔光與 11／22px 短尾流；明確置於原球體圖片之上，整體仍在穩定標題之後。原游標最多 6px／5px、1.2°及 passive 觸控保持。
- 頁緣手機 24／桌面 56 點、1.2–2.2px；加強亮度但保留柔化邊界，中央閱讀區不蓋粒子。Hero bitmap 最大 1000px、DPR 1.25、約 30fps 繪製；離屏／背景／減少動態停止，頁緣捲動後 700ms 閒置停繪。
- 沿用 [原稿、資產及比例證據](guest-identity-reference-release.md) 與集中 typography CSS；原圖未改，不新增依賴、雲資源、字級或業務操作。

## 可感知效果與本機證據

最終編譯 HTML SHA `fa1b8175ddc894fd175a1e1f5019a3f0768aaad1620e148a971e589bf795aab6`，捲動腳本 SHA `f8726670e742289186ab087591061173755ca95d69a7ea54da0d89e1254ce428`。獨立六案 exit 0：320／390／1440／1920、無 JS／無 IO；錯誤／業務 POST／寄信／真實網路均 0。

| 寬度 | 嘉賓區標題／卡片早期 opacity | 中途 opacity | 自然完成 | Hero 兩幀亮像素 |
| --- | --- | --- | --- | --- |
| 320 | 0／0 | .537／.077 | 1／1 | 300／295 |
| 390 | 0／0 | .537／.077 | 1／1 | 298／295 |
| 1440 | 0／0 | .537／.077 | 1／1 | 842／841 |
| 1920 | 0／0 | .573／.131 | 1／1 | 720／720 |

本機卡片使用合成公開輸入，量測的是實際渲染的可操作元素；空裝飾圈不計作人物。亮像素直接讀取 origin-clean canvas，要求至少 100，兩幀位置 signature 亦改變；不只檢查 canvas／RAF／計數屬性。組織同樣量到早／中／完成階段，聚焦標題即恢復 1；fresh 日程行在尚未 hash 導覽前驗證 `0→.077–.185→1`、延後 160ms、無 transform。

手機 CDP 原生 touch pan 實際移動 65px，未進視窗卡片仍 pending。原置頂 top0、native wheel、嚴格錨點留白 ≤64px、公開刷新位移 ≤2px、全新 Document 延遲嘉賓 hash、選單／Escape、canvas 真 hit-test、reduced 初始／中途及離屏閒置 RAF0 全部保留。觸控與 hidden 訊號為明示合成，不代表真機／OS／電量量測。

已人工看 `.local-data/browser-evidence/presentation-fades-final/` 的 1920px `guest-fade-early/middle/final` 三幀及桌面／手機 Hero：可辨別標題先顯、內容稍後出現及最後完整姓名／單位／職位，球緣亮核／拖尾清楚，header／標題清楚。這些合成截圖只留忽略目錄，不冒稱已下載並人工看過 CI 的實際公開圖。

本機 source 欄為提交前基線 `9b0b25d1da6f836574182d950a8158e2516c836e`，已凍結的同份產品／測試 bytes 隨後提交為 `308e3d7b2a94fd329601519adcaae80b3df0c4d4`；腳本 SHA 與該 commit 逐字相符。準確來源資格另由下方 PR／main 補齊。

保留兩次部分失敗：`presentation-fades-first/second` 均 exit1、完成 0／6，先前捲動／置中相鄰區塊已消耗真正首次淡入，錯過 early 取樣窗。最終 helper 改標題位於 header+24px，移後大 wheel 並改用量測拖動，沒有重播已 seen 動畫、改 currentTime、降低 opacity／錨點／刷新門檻。加上日程／展位 selector 後才作最後建置與完整六案，不把中途產物列通過。

## 準確 PR CI

實作 head `308e3d7b2a94fd329601519adcaae80b3df0c4d4`；[PR 流程 41379192062](https://github.com/kunanli/artdicohost/actions/runs/41379192062) completed／success，check `125066033562`，實際合成 merge source `719b5ce59b5dddbed424d70c6aeaaa62d3b003ed`。

| UTC 時間 | 結果 |
| --- | --- |
| 02:43:35／02:43:48 | 737 來源、Astro482：0 錯誤／0 警告／1 既有 hint |
| 02:45:16／02:45:18 | 1612 測試全過、23 頁建置；02:47:25 audit0 |
| 02:46:14.8856025 | 捲動6／6，錯誤0／POST0／mail0 |
| 02:46:26.8015102 | 排版4／4，最低對比11.033，錯誤0／POST0／mail0 |
| 02:47:23.1715313 | 實際素材13／13，原圖7／變體7，單位36／職位32／完整介紹36，錯誤0 |
| 02:49:14／02:49:37 | 準確 FC 候選128檔及公開61檔，受限離線啟動與原容量邊界通過 |

三報 source／HTML SHA 相同，actual captureSource 亦相同；不是借整個 CI 綠色代替 actual13。公開仍 R43，snapshot SHA `4b5486d90eed56ed762e40227b35866a07ec4cd451e16b32a67374d5a7ed79af`，七張組織原圖493851bytes。九個未捕獲的人像／作品請求沿用明示404替身，不擴稱全媒體驗收。

## 正式發布回執

[main 流程 41379869399](https://github.com/kunanli/artdicohost/actions/runs/41379869399) 四工作 completed／success，check `125068092374`、FC `125069884423`、公開 OSS `125070738315`。三份瀏覽器報告 source 均為準確 main `80895d8`，HTML／腳本／snapshot SHA 與 PR 相同。

| main UTC 時間 | 核對 |
| --- | --- |
| 02:51:22／02:51:36 | 737來源、Astro482：0錯誤／0警告／1既有hint |
| 02:53:11／02:53:14／02:55:18 | 1612測試、23頁、audit0 |
| 02:54:01.9643085 | 捲動6／6，errors0／POST0／mail0 |
| 02:54:13.6563242 | 排版4／4，最低對比11.033，errors0／POST0／mail0 |
| 02:55:15.7761321 | actual13／13，原圖7／變體7／company36／title32／detail36，errors0／明示替身9 |
| 02:57:05／02:57:31 | 準確FC128檔及公開61檔，原邊界未提高 |

FC 工作 `125069884423` 已 completed／success：

| main UTC 時間 | 正式回執 |
| --- | --- |
| 03:00:42.0775870 | 正式報名別名逐欄符合批准政策與容量 |
| 03:00:42.0783613 | 準確來源80895d8、內容／報名啟用、私有OSS兩客戶端／一FC通過；runId `r41379869399-a1-ab46101955e907cb-80895d8d4f64e7d9806f1f2c6c0606d3a33215de` |
| 03:00:45.7963704 | 13個準確後台頁面HTTPS通過 |
| 03:00:46.6600865 | 匿名公開內容HTTPS／CORS通過，仍R43、9嘉賓／7組織／1作品／16展位／43場次；出席根證明缺省、confirmed0／displayed9，不推論真人確認 |

03:02:38.8113161 UTC，公開 OSS 工作 completed／success，`https://artdico.host` 的 **61 個準確公開物件**逐項 HTTPS 通過，來源為 main `80895d8d4f64e7d9806f1f2c6c0606d3a33215de`。已核對包含新版淡入／粒子程式的實際發布集合，不以先前版本或測試建置代替上線。

如需回退效果，以前版 main `941d6f6` 的三個產品檔與對應測試建立正常回退 PR，再經檢查／部署；不回滾業務資料、既有通知或凍結公開快照。

`docs/presentation-motion-release-proof` 從已合併 main 建立，只補實際核驗，不為紀錄再開 PR／重複部署。對外郵箱保持 `kunan@globalgamejam.org`；真人收件、微信／iPhone與同事操作觀察仍分開記錄。
