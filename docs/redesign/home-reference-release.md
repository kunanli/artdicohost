# 首頁原稿對齊與嘉賓相容修復

2026-11-01，本輪已由 [PR #58](https://github.com/kunanli/artdicohost/pull/58) 正式發布於 main `30e184fde2f8f3be065c09afa6a9219383f5bc60`，PR／main CI、實際 FC／私有 OSS、13 個後台頁面與 53 個準確公開物件 HTTPS 均通過，最新首頁程式已部署。本輪修復已錄入嘉賓未顯示、組織只需名稱，並依原效果圖對齊構圖；實作分支為 `fix/home-reference-restore`、計畫提交 `b76d885`，最終本地產品 `4de3d8566e13f422fb670356404d81f2d55d960b` 的套件與瀏覽器證據仍獨立保留。四項真人與業務資料驗收未以程式上線代替。

## 視覺與內容依據

以 [1921×19362 原效果圖](../../FrontEnd_Resource/落地页.png) 及 `FrontEnd_Resource` 的原始交互說明逐區核對導航、首屏、雙星球介紹、氣泡、嘉賓圓陣、組織星球、作品、日程、申請、Q&A 和頁尾。手機沿同一構圖合理重排，重要資訊維持 HTML、鍵盤操作與 reduced motion。

原圖 SHA-256 為 `ff5b62dfadc80e31a6af0eb3b08d23a28e4dbfdd047c0d65f1953da2b6366485`。後續幾何及截圖須對應同一原圖；局部尺度檢查不單獨宣稱整頁逐像素一致。

C 區依 `FrontEnd_Resource/活动日程_C区.png` 實際像素核對為 `#41b6e6`／`rgb(65, 182, 230)`：1921×4800 原圖中出現 136,787 像素；初次候選的 `#3db5df` 與更早的 `#54c7ef` 均為 0 像素。最終回歸同時核對三區色票與實際畫出的色塊，不把初次候選通過當作原稿色彩已正確。

原稿的樣本嘉賓、作品、合作署名與未核實數字不是可發布事實。沿用已核定日期、地點及申請範圍，不恢復固定展位數、20+／10K+／600㎡、展位申請或送作品入口。

首屏主按鈕依原稿開啟活動日程；申請保留獨立文字入口與原開放狀態。桌面位置依原稿比例核對，不沿用上一版「申請按鈕必須在 900px 首屏內」的構圖；手機合理重排，申請仍須可聚焦、熱區至少 44px，活動資訊與長介紹不得重疊。

| 觸發 | 本輪顯示契約 | 保留的界線 |
| --- | --- | --- |
| 舊公開快照缺少根 `guestAttendance` | 安全且已公開的嘉賓資料卡恢復，逐卡標「出席待确认」 | 不虛構本人回覆、正式名額或證明，不改寫凍結快照，不自動發布 |
| 明確出席證明，包括空名單 | 沿用原證明名單，空名單仍是零卡；錯誤證明不放寬 | 私人／無效資料不恢復，來源失敗不冒充新成功 |
| 嘉賓圓陣 | 圓內顯示姓名，原照片及介紹保留於可展開詳情 | 保留原生 disclosure、觸控／鍵盤、場次關聯及刷新焦點 |
| 參與組織 | 大型星球內只顯示已公開 Logo／名稱及既有安全外連，已知品牌按原稿順序與比例排列 | 只調整顯示副本；精確已知 ID／名稱供視覺排序，未知與重複項目保留正常網格，不合併 ID 或推定身份，不刪後台安排及提升合作身份 |

後台與前台共用嘉賓顯示契約；只有缺少出席證明的舊公開資料適用相容顯示，草稿仍須依既有權限與明確發布流程處理。場次的講者／主持人安排與嘉賓卡資格分開。

## 本輪驗證

| 檢查 | 本輪狀態 |
| --- | --- |
| 共用 helper、公開 envelope／驗證器及後台預覽 | 已由本輪完整 Node 涵蓋；缺證明相容、明確空／錯誤證明與私人資料界線保留 |
| 原稿逐區與各寬度幾何、legacy／空證明／錯誤來源 | 最後 `4de3d856` 的 [獨立原稿瀏覽器](../../tests/browser/home-reference-smoke.mjs) 9 案實際退出 0、無頁面錯誤；9 位舊公開嘉賓與 3 個非人員裝飾圓、空證明／錯誤來源／失敗讀取及未知／重複組織網格均核對。1920／390px 圖片解碼後的實際畫面完成視覺複核，18 個載入資產均綁定最後產物 SHA；七枚 Logo 彩色像素寬對原稿目標 350／290／236／173／110／136／276px 的差異各小於 1px |
| 既有首頁回歸 `p5-homepage-smoke.mjs` | 最終 7 案實際退出 0、無頁面錯誤；保留原稿按鈕比例、標題圖／canonical H1、44px／聚焦、無 JS、reduced motion、缺裝飾、長介紹及只讀保護 |
| 集合回歸 `p5-collections-smoke.mjs` | `6018dbc8` 凍結產物 9 案實際退出 0、無頁面錯誤，按下方單一首屏規則差異沿用。C 區原圖 `#41b6e6` 的 token／實際色塊與 A／B 區精確色票通過；明確證明、私人欄位、失敗讀取、原生 AX、觸控／鍵盤、刷新焦點、輪播／預覽／遲到錨點及無 JS 斷言均保留 |
| 出席發布 `p1b-attendance-smoke.mjs` | `6018dbc8` 凍結產物 3 案實際退出 0、無頁面錯誤，按下方單一首屏規則差異沿用。每寬 legacy 4 卡逐卡可見待確認、新證明 1 卡、撤回後 0 卡，私人隔離、凍結 bytes、原場次、名額不變與零寄信通過 |
| 完整 Node | 本地 `6018dbc8adf9a69a4c3a077b8e295c9d49947bcc` 為 1593／1593，fail／cancelled／skipped／todo 全為 0，實際退出 0；耗時約 106.77 秒。PR CI 的合成 checkout `43769eee844dbefdbf624379283870aa8dc999a7` 及正式 main `30e184fd` 也各為 1593 項全通過、其他狀態全為 0，最後單一首屏 CSS 修正已由 main 完整檢查涵蓋 |
| 來源／Astro／建置／審計 | 來源 709、Astro 473 檔零錯誤／警告、1 項既有 hint，最後 10:51:51 UTC 建置 23 頁；依賴審計無已知漏洞 |
| 專案契約 Skill | 本輪契約 109 項實際通過 |
| 準確 FC／公開包 | `4de3d856` prepare／verify 通過：128 檔、40 資產、7,585,849 靜態 bytes；ZIP 35,714,983 bytes，SHA-256 `ab03381d16acb3bb41ba96a1e28cca353600787692650d62830b5432664b88df`。公開 prepare 為 53 檔，未放寬既有上限 |
| 準確產物來源 | FC 的 33 個非 HTML 資源與 root dist 位元組相同，7 個 canonical HTML 僅有既定公開內容 meta 差異；記錄保存在 `.local-data/browser-evidence/home-reference-exact-provenance/package.json` |
| PR CI／合併 | PR #58 的 CI 41299739239 completed／success，已合併至 main `30e184fd`；實際 checkout 及測試內容見下方紀錄 |
| main CI、實際 FC／私有 OSS／13 後台／公開 HTTPS | main 流程 41300103311 completed／success，四項工作全成功；準確來源 `30e184fd` 的私有 OSS、13 個後台頁面、公開內容／CORS 與 53 個公開物件核對通過，見下方正式回執 |

- [x] 舊公開資料相容、明確證明／私人隔離與原場次／名額界線。
- [x] 本輪完整 Node、來源／Astro／建置、審計與契約 Skill，保留最後單一 CSS 修正的版本區別。
- [x] 原稿九案、最後首頁七案、集合九案及出席三案的編譯證據與視覺複核。
- [x] 最終準確 FC／公開套件、來源與容量上限。
- [x] PR CI 與合併。
- [x] main CI 與實際 FC／私有 OSS／HTTPS。

瀏覽器使用全攔截、合成公開資料及隔離記憶體服務，不讀 `.env`、正式私有來源或聯絡真實服務商。可用 `ARTDICO_HOME_EVIDENCE_DIRECTORY`、`ARTDICO_COLLECTIONS_EVIDENCE_DIRECTORY`、`ARTDICO_ATTENDANCE_EVIDENCE_DIRECTORY` 各自保存新證據，避免覆蓋歷史報告。最終產品／HTML／資產來源須綁定實際候選，腳本存在不等於已通過。

`4de3d856` 編譯首頁 SHA-256 為 `ac8aa508607624b19d2c0bc3af498bc1edd2bc6314cddd92803630670bf1ea31`；上次 `6018dbc8` 為 `e86669ecb048aab1b4041bec622b3afc0cac99776b01202d51168463f022b76a`。差異只有首屏場地文字寬度從 47% 改為 60% 的 CSS 與首頁對應資源引用，其餘 72 個 `dist` 檔案逐 SHA 相同；後台 HTML `fa96d48797c07e893ad7e4a58dba44a997aa033569588451475dde7a9196339c` 不變。集合與出席的資料、互動及相關規則未改，沿用上次 9／3 案；首頁 7 案在最後產物重跑並實際退出 0。

最後首頁報告、實際退出碼、前後 74 檔來源與 `compared-with-6018.json` 保存在忽略的 `.local-data/browser-evidence/home-reference-homepage-last-20261101T105344Z/`。上次三套完整 logs 與來源位於 `.local-data/browser-evidence/home-reference-baselines-final-20261101T104650Z/`，各報告為 `home-reference-homepage-final`、`home-reference-collections-final`、`home-reference-attendance-final`；兩次實跑期間各自的 74 檔均未變動。分組案例不與完整 Node 測試數加總。

最後獨立原稿結果與實際畫面複核為 `.local-data/browser-evidence/home-reference-final/report.json`、`visual-review.json`，均對應 `4de3d856`／10:51:51 UTC／首頁 `ac8aa508…`；已處理已發現的場地孤字、介紹排版、裝飾白線與手機頁尾重疊，不把未解碼截圖當作已見到最終圖片。

初次 10:32:21 UTC 結果及色票預期不符的退出 1 紀錄，仍保存在 `.local-data/browser-evidence/home-reference-baselines-20261101T103345Z/`；當時候選 `#3db5df` 的回歸通過不列為原稿色彩證據，不以舊截圖代替最後 CSS 修正的產物。

## PR 與實際發布

- [PR #58](https://github.com/kunanli/artdicohost/pull/58) head `47927d54` 的 [CI 41299739239](https://github.com/kunanli/artdicohost/actions/runs/41299739239) completed／success。實際合成 checkout `43769eee844dbefdbf624379283870aa8dc999a7` 通過 1593 項測試且其他狀態全為 0、709 個來源檔、Astro 473 檔零錯誤／警告與 1 項既有 hint、準確 FC 128 檔／40 資產／13 別名離線啟動及公開 53 檔核對。
- 已部署 main `30e184fde2f8f3be065c09afa6a9219383f5bc60` 的 [流程 41300103311](https://github.com/kunanli/artdicohost/actions/runs/41300103311) completed／success，四項工作均成功：[transport](https://github.com/kunanli/artdicohost/actions/runs/41300103311/job/124829083118)、[check](https://github.com/kunanli/artdicohost/actions/runs/41300103311/job/124829083440)、[FC](https://github.com/kunanli/artdicohost/actions/runs/41300103311/job/124830129389) 及 [OSS](https://github.com/kunanli/artdicohost/actions/runs/41300103311/job/124830976804)。實際 main 為 1593 項測試全通過、其他狀態全為 0，709 個來源檔、Astro 473 檔零錯誤／警告與 1 項既有 hint，準確 FC 128 檔／40 資產／13 別名離線啟動及公開 53 檔核對通過。
- 本次 `docs/home-reference-release-proof` 自上述已部署 main 建立，只補證據、push 文件，不另建 main PR 或為文件重複部署。
- 2026-11-01 10:58:00.6509476 UTC 的正式公開唯讀診斷：已發布修訂仍為 43、`publishedAt` 為 10 月 22 日，公開嘉賓 9、組織 7、作品 1、展位 16、場次 43；`guestAttendance` 診斷為 `{present:false,confirmed:0,displayed:9}`。這證明九筆嘉賓資料保留、缺少的是新版出席證明根欄位，沒有為修復改寫公開快照。

| 正式核驗（2026-11-01 UTC） | 實際結果 |
| --- | --- |
| 11:10:57.1840471 | FC 核對準確來源 `30e184fd`，內容／報名均啟用；私有 OSS 驗收通過，兩個獨立客戶端／一個 FC 程序 |
| 11:11:01.9842672 | 13 個準確後台頁面的 HTTPS 核對通過 |
| 11:11:03.0730019 | 公開 HTTPS／CORS 核對通過，仍為修訂 43／10 月 22 日發布、計數 9／7／1／16／43，`guestAttendance:{present:false,confirmed:0,displayed:9}` |
| 11:12:55.6598272 | `artdico.host` 來源 `30e184fd` 的 53 個準確公開物件 HTTPS 核對通過，包含最後首頁程式與樣式 |

正式回執摘要保存在忽略的 `.local-data/browser-evidence/home-reference-live-publication/proof.json`，記錄已部署 main、四項成功工作及線上核驗，與本地 `4de3d856` 套件／瀏覽器證據分開。

`confirmed:0` 是缺少證明時的計數，不是本人回覆或實際出席人數；`displayed:9` 是相容投影的可顯示計數，不表示自動確認九人到場。發布前診斷證實資料與根因，53 個準確公開物件的 HTTPS 回執另證實新首頁 bytes 已部署；兩種證據分開。其他公開項目數量也不代表私有人員或已確認到場數。

真實收件、微信／iPhone、同事操作及真實資料核對仍沿用 [UX2 的四項真人清單](ux-workflow-release.md#人工只需記錄這幾項)，獨立待人工記錄，不阻擋本輪前端軟體交付完成。本輪不代做正式名單、名額、通知、群碼或內容發布；既有 API、受控設定、服務與容量上限保留，回退也不得改寫凍結公開內容或以舊證明覆蓋當前回覆。
