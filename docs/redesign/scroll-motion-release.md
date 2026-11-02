# 置頂導覽、捲動光流與 Hero 互動

2026-11-02（Asia/Taipei）。[PR #62](https://github.com/kunanli/artdicohost/pull/62) 已正式發布 main `941d6f661b3740da85a475c8d9ed561b8bce6114`；[正式流程 41374978628](https://github.com/kunanli/artdicohost/actions/runs/41374978628) 四個工作completed／success，捲動6／排版4／實際13及FC／OSS／HTTPS均逐項核驗通過。日誌時間以下均為UTC。

## 實作與邊界

- Header使用viewport sticky，保留76px／手機72px的原佔位，避免fixed被原有size container限制。半透明色帶、閱讀進度線及目前段落標記；ResizeObserver實測高度供html scroll-padding，錨點另留24px，沒有雙倍計算。原生選單與捲動沿用。
- 藍紫顆粒僅沿頁緣隨捲動緩移，水平alpha柔化至黑底；手機減量，停止捲動700ms後停繪。程序顆粒不讀圖片／個資、不做追蹤，canvas `aria-hidden`／`pointer-events:none`。
- 區塊標題／說明只做一次680ms進場，opacity最低.8，不先藏HTML；焦點／點擊／hash時立即穩定。視差只作用於About／頁尾裝飾圖，嘉賓原有漂浮保持獨立，移除舊整圈旋轉。
- Hero球緣手機10／桌面18點慢速環繞，約30fps繪圖，bitmap最大1000px、DPR上限1.25；游標最多6px／5px與1.2°偏轉，光暈及近端粒子回應。標題不動，觸控為passive短回應。離屏／背景／reduced-motion停RAF並清粒子／姿態；無觀察器保留靜態原圖。只在Hero可見時允許ambient循環，長頁其他區域閒置不維持RAF。
- `home-scroll.mjs`／`hero-interaction.mjs`及對應CSS只進首頁，字級仍由既有typography角色管理；沒有新增依賴、改寫公開稿件或正式業務資料。

## 已核對證據

實作head `31e54f78d49f90e5da9e45a7ee61c4dc6890e469`；[PR CI 41374328227](https://github.com/kunanli/artdicohost/actions/runs/41374328227) completed／success，check job `125051201038`，實際merge source `6729959e4652b13638ae65e7cc81cdbf975764fc`。

| PR UTC時間 | 核對結果 |
| --- | --- |
| 01:48:23／01:48:35 | 736來源、Astro482：0錯誤／0警告／1既有hint |
| 01:50:01 | 1612測試全過，23頁建置、audit0 |
| 01:50:44.2930864 | 新捲動6／6：320／390／1440／1920、無JS／無IO，錯誤0／業務POST0／寄信0 |
| 01:50:55.1924428 | 排版4／4，最低對比11.033071382528277，錯誤0／POST0／寄信0 |
| 01:51:51.7308943 | 實際公開素材13／13；原圖7／變體7／嘉賓9／組織7，錯誤0；單位36／職位32／完整介紹36 |
| 01:53:51／01:54:13 | 準確FC候選128檔及公開61檔完成，原包／請求／檔數上限保持 |

三份瀏覽器HTML SHA皆 `a47dc49b069c99910b032ed97f5d98a2eef74988d07ac1fd3343e71047a96871`，source一致；actual13的captureSource也相同。公開仍R43，snapshot SHA `4b5486d90eed56ed762e40227b35866a07ec4cd451e16b32a67374d5a7ed79af`，七圖493851bytes；原始資料／截圖僅留忽略目錄及一天artifact。九個未捕獲的人像／作品請求仍為明示404替身，不能擴稱全媒體人工驗收。

本機最終feather產物也6／6（source31e54f7、相同HTML），腳本SHA `347ba325f77b4250898daaecc996734875e05fb4cedb603d1edaf92afb576ec4`。真wheel、兩個桌面pointer姿態、Hero可見ambient、離屏idle RAF0、手機選單／Escape、嚴格錨點間隙、刷新位置≤2px與新Document延遲公開GET皆已驗證。header top=0；手機錨點96.33／header72、桌面99.61–99.73／header76。reduced初始／途中、合成hidden、無JS／無IO皆可讀，canvas不攔hit-test。

保留本機測試診斷：浮動嘉賓不能用Playwright靜止等待，改原生捲動及既有focus暫停；native smooth須等原嚴格範圍與100ms穩定，不在兩frame後過早量測；測試setup `.focus()`曾在API刷新前自行移動450px，改`preventScroll`，API本身前後位移0且原≤2px斷言未放寬；無JS不跑頁面RAF callback，改Node端幾何輪詢；初始hash必須新Document而非同頁跳轉。中途局部產物不列6／6，最終兩次完整六案與PR通過才計入。

人工已看1920與320 Hero：保留球體及標題比例，頁緣原硬邊經feather消失，微粒淡入黑底。既有本機排版4／原稿9也通過；實際素材證據以CI自動化與摘要核對為準，未聲稱本機下載並人工逐像素看過那些CI圖。RAF與visibility為明示合成觀察，不代替真機、OS背景或電量量測。

## 正式發布

main四工作全部completed／success，check `125053133445`、FC `125054834163`、公開OSS `125055787063`。三份報告source均為main `941d6f6`，HTML／snapshot與PR相同，沒有借用前輪結果。

| main UTC時間 | 正式核對 |
| --- | --- |
| 01:56:10／01:56:25／01:57:58 | 736來源、Astro482（0錯誤／0警告／1既有hint）、1612測試、23頁、audit0 |
| 01:58:35.9386541 | 捲動6／6，errors0／POST0／mail0 |
| 01:58:48.1682814 | 排版4／4，最低對比11.03，errors0／POST0／mail0 |
| 01:59:48.8990710 | 實際素材13／13，原圖7／變體7／company36／title32／detail36，errors0、明示替身9 |
| 02:01:38.2071845 | 準確FC候選128檔通過，未提高原限制 |
| 02:05:33.2159264 | 正式報名別名仍逐欄符合批准政策及容量，對外信箱維持kunan@globalgamejam.org |
| 02:05:33.2164885 | FC準確來源、內容／報名啟用、私有OSS2客戶端／1FC通過；runId `r41374978628-a1-41cfc557c1026944-941d6f661b3740da85a475c8d9ed561b8bce6114` |
| 02:05:37.5005070／02:05:38.4682103 | 13個準確後台頁面HTTPS及匿名公開內容HTTPS／CORS通過，仍R43，未發布業務草稿或改出席證明 |
| 02:07:23.5260558 | `https://artdico.host` 的61個準確公開物件逐項HTTPS通過 |

`docs/scroll-motion-release-proof`只補文件回執，不再建立PR／重複部署。既有真人收件、微信、iPhone與同事操作觀察仍分開記錄。
