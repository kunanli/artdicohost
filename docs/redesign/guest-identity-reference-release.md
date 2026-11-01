# 嘉賓單位／職位與原稿逐區對照

2026-11-02（Asia/Taipei），本輪已由 [PR #60](https://github.com/kunanli/artdicohost/pull/60) 正式發布 main `e6e6d3f61d113b1831c06883c096db8c4a3df456`。單位／職位、原稿逐區對照與首頁 CSS 管理全部交付，PR／main 排版4、實際素材13、1612項測試及FC／OSS／HTTPS核驗通過。實作分支 `fix/guest-company-and-title` 從 main `bd49a745` 與文件回執 `2b2a117` 接續；下方保留前版驗證資格，日誌時間使用 UTC。

單位獨立使用已公開 `company`；職位依 `title → ggjRole → 空`，不再用 company 當職位 fallback。姓名、單位、職位各自呈現並納入 ARIA，不猜內容、不改出席、名額、公開資格或業務資料。

**首頁 CSS 修改入口：[字體與樣式規範](../frontend-typography.md)。** `home-typography.css` 最後匯入，集中閱讀／展示字角色；正文／輸入／同意16px、標籤／按鈕16px／700、輔助14px、功能標題20px，display token保留hero／section／guest／footer比例。告知／恢復面板採深surface＋light字、draft>span直接設色；獨立四寬字體／對比 hard CI gate 已通過，不沿用先前HTML認列。

字體階段已完成首次本地 4／4（HTML `00a917eb60c75633a58358e9222afdc199a7ab91079614725007f28dfddf7727`），告知／恢復區最低實算對比 11.033:1，原先約 1.76／1.01:1；標籤、輸入、同意與按鈕 16px、提示／草稿 14px，鍵盤與未知原請求保留、零業務 POST。相同版本的原稿關聯回歸 9／9 通過；其後只把嘉賓介紹正文統一到 16px、工具提示／展位說明補至 14px，最後版本已由 CI 另驗。

初版 [PR CI 41326680851](https://github.com/kunanli/artdicohost/actions/runs/41326680851) 實際為 12／13，並未發布：四寬真實資料單位36／職稱32／介紹36先通過，角色-only合成分支卻用過長字要求手機一行不省略。該分支改為四字「合成角色」專驗fallback；長姓名120／單位160／職稱200、ARIA與展開全文及無捲軸檢查仍保留。失敗紀錄不改寫，最後PR／main的13案已另核對全過，不以整體綠燈代替。

| 區域 | 已知差異 | 本輪目標／保留界線 |
| --- | --- | --- |
| 嘉賓資訊 | company 被字幕 fallback 吃掉，單位與職位無法同時看到 | 分成獨立單位／職位欄；缺值留空，長字仍完整可展開，不恢復內層捲軸 |
| 嘉賓圓陣 | 三層資訊需要更多空間 | 1920／1440px 視口圓徑採 260／224px，明記較原稿約 220／165px 放大；保留原中心距約 370、行距約 371 的構圖比例，不藉放大改掉圓陣節奏 |
| 嘉賓標題與細節 | 分隔線實測約 RGB 70–99，原稿約 195；標題下留白少約 13／18px；亮邊／霧光偏暗 | 補亮分隔線、留白與柔和光邊，再核對實際像素與排版；不以裝飾遮住文字 |
| 組織星球 | 下緣亮帶過硬 | 調柔過渡，保留真實 Logo、digest 換圖回退與有界框，不改上傳原件 |
| Hero | 介紹較原稿低約 89px，倒數偏小 | 對齊介紹位置及倒數尺度；保留真日期、文字可讀、申請／日程功能與 reduced motion |
| 活動介紹／嘉賓接縫 | 星球顆粒消失，右下霧光偏暗；分區背景另畫會形成硬切 | 沿用原始顆粒 PNG，從無文字／Logo／分隔線的原稿背景裁取同一片霧光跨界、四周羽化；不把 UI 文字或資料烘焙進背景 |
| 作品 | 原稿約 1768×885、2:1，現 16:9 cover 使左右各裁約 97px | 改完整 2:1 呈現，核對不裁作品內容，保留輪播、篩選、預覽與焦點 |
| 日程 | B／C legend 被 filter 擠左 | 恢復全寬配置，保留真日程、區域切換、色票與鍵盤操作 |
| 頁尾 | 英文標語起點比原稿 OST 高約 286px，寬約 449px、原稿約 518px | 對齊並放大，手機另驗不與 HOST、聯絡或工作連結重疊 |

上述數字保留為最初差異量測與設計目標，已完成量測及各版證據範圍見下方；不把目標值當作最後產物的整頁逐像素一致證明。真實日期與實際內容沿用，20+／10K+、未核實數字及已移除的申請入口不恢復。

| 驗證 | 本輪狀態 |
| --- | --- |
| company／title／role、空值、ARIA、私人隔離 | 1612項與實際13案通過；捕捉company9／empty0，職位title8／role0／company0／empty1，不再複製company當職位 |
| 字級／對比與原功能 | PR／main各4／4，syntheticOnly true，最低contrast11.033071382528277、errors0／POST0／mail0；keyboard與IDB原pending保護保留 |
| 實際公開資料與邊界 | PR／main各13／13，actual true、raw7／reference7／guest9／org7／errors0，company36／title32／role0／detail36；portrait／work stub計數9、visibility為模擬訊號，不冒稱OS真分頁或未測的白色設計檔載入失敗案例 |
| 完整檢查與候選 | 正式main1612通過，來源729、Astro479零錯誤／警告與1既有hint、23頁、audit0；契約109通過，FC128與public61候選／邊界檢查通過，不套用本地c8 ZIP為main SHA |
| 正式發布 | main四jobs成功；FC／私有OSS、13後台、匿名CORS與61公開HTTPS準確來源回執齊全，見下表 |

未新增主辦方人工流程、業務寫入或實寄；四項真人／真實資料驗收仍獨立。前輪證據保留在 [氣泡與 Logo 紀錄](bubbles-logo-release.md)。

## 先前本地驗證與版本資格

早期本地 Node 1612／1612、來源726、Astro478、23頁、audit0與契約109通過，與最後729／479來源分開。初版合成21／21的舊姓名居中斷言改為三層整組居中±1.5px，保留各欄包含／有序不重疊；原失敗保留，未放寬裁切容差。

背景／堆疊版的原稿9／9及三層四寬4／4綁HTML `c09391f7df0253e6d73db004990200a59f30a24933bb0084d85239f2d3f98ae7`，更前21案綁 `c77e1d0ee554372ba8105f58f1c147c2710224bf8020c4efd89d4e88aff34395`；字體4／4與reference9／9另綁 `00a917eb60c75633a58358e9222afdc199a7ab91079614725007f28dfddf7727`，對比11.033。其後detail正文16、tooltip／caption14的三條CSS另由最後CI驗證，不把這些本地結果假標為最終HTML同版。

原稿逐區人工檢視確認：Hero 介紹白字回到原稿 y797；作品 1768×885 圖完整顯示；B／C 色塊 x858／1304 對原 x859／1303；頁尾英文寬約 518px 並恢復 OST 相對位置。霧光初版硬切已保留證據，修正後 1920／390 接縫相鄰列最大 RGB 跳變由 118／158 降到 1／2，沒有矩形邊或遮蓋標題。數值證明各自檢查範圍，不宣稱整頁逐像素一致或已人工看過無法下載的 CI 真實圖片。

## PR／main 與正式回執（UTC）

[PR CI 41328516989](https://github.com/kunanli/artdicohost/actions/runs/41328516989) 的排版4於16:54:44.5047103、實際13於16:55:27.2066055獨立核對；source／captureSource為 `cce235ba7f34f4594cf7399c78e8a23af6e4060d`。[main CI 41329241815](https://github.com/kunanli/artdicohost/actions/runs/41329241815) 四jobs completed／success（[check](https://github.com/kunanli/artdicohost/actions/runs/41329241815/job/124915643484)、[FC](https://github.com/kunanli/artdicohost/actions/runs/41329241815/job/124917246827)、[OSS](https://github.com/kunanli/artdicohost/actions/runs/41329241815/job/124918284936)）；main排版4於17:03:45.4986356、實際13於17:04:29.7437512再核對，source／captureSource皆為 `e6e6d3f61d113b1831c06883c096db8c4a3df456`。

兩報最後HTML同為 `c48c7da23b440d4b0106463b55af42e9ed4a5eb6c7a7766e1423c5575c7dbad7`，snapshot同為 `4b5486d90eed56ed762e40227b35866a07ec4cd451e16b32a67374d5a7ed79af`。排版4為hard CI gate，actual13雖保留observational設定，本輪已讀固定摘要／來源並獨立核對全過，不只依整體綠燈。

| 正式核驗時間 | 實際結果 |
| --- | --- |
| 17:10:33.9824681 | FC lifecycle準確來源e6e6d3f6，內容／報名啟用；私有OSS通過，2獨立客戶端／1FC，acceptanceRunId `r41329241815-a1-164c534496651c34-e6e6d3f61d113b1831c06883c096db8c4a3df456` |
| 17:10:38.7833882 | 13個準確後台HTTPS通過 |
| 17:10:39.9032458 | 匿名HTTPS／CORS通過；仍R43、`publishedAt:2026-10-22T08:41:00.034Z`、公開計數9／7／1／16／43、guestAttendance缺省／confirmed0／displayed9，不代表九人已確認出席 |
| 17:12:22.9098963 | `artdico.host`來源e6e6d3f6的61個準確公開物件HTTPS通過 |

`docs/guest-identity-typography-release-proof`自已部署main建立，只補文件，不另建PR或重複部署；無新業務寫入、實寄或主辦方人工流程。
