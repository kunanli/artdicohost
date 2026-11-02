# 首頁字體規範與 CSS 管理

`src/styles/home-typography.css` 是首頁閱讀文字的唯一規範入口，由 `src/pages/index.astro` 在 `home.css` 之後匯入。只作用於 `.ah-cosmos`，不改後台或私人參會頁的樣式依賴。

| 角色 | 變數 | 字級／字重 | 用途 |
| --- | --- | --- | --- |
| 正文 | `--ah-type-body` | 16px／400 | 表單說明、同意、政策、恢復資訊、場地、問答正文 |
| 標籤 | `--ah-type-label` | 16px／700 | 欄位、選項群組、可展開小標題 |
| 輸入 | `--ah-type-control` | 16px／400 | input／select／textarea，手機不縮小 |
| 操作 | `--ah-type-action` | 16px／700 | 按鈕與功能連結，至少 44px 操作高度 |
| 輔助 | `--ah-type-meta` | 14px／400 | hint、optional、狀態、時區、次要資訊 |
| 功能標題 | `--ah-type-panel-title` | 20px／700 | 表單、告知與恢復面板的小標題 |
| 卡片標題 | `--ah-type-card-title` | 20–24px／700 | 作品、議程、問答標題 |

正文行高 1.75，輸入／操作 1.5。閱讀文字固定使用現有 ARTDiCO Home SC 與系統中文後備，只使用既有 400／700 字重；Hero 與頁尾的英文海報字另用下述 display family／800，不改閱讀角色。

現場體驗氣泡的 `<small>` 是獨立展示輔助角色：桌面使用正文16px、820px以下使用輔助14px，不回到舊12px。GGJ參與說明放在既有Q&A `site-role`，正文16px；補充說明的段落／展開標題也使用角色變數，不能再讓舊 `.ah-highlights-detail p` 的13px覆蓋。

主視覺、區塊大標題、嘉賓三層資訊與頁尾品牌字使用同檔的 `--ah-display-*` 角色，按原稿與響應式需求調整，不以功能正文尺寸覆蓋它們。元件 CSS 管理布局、光效與尺寸，新增功能文字須套角色變數，避免再寫獨立 11／12／13px 小字。

政策與未知結果恢復面板將表面、主文字、次文字、連結一併設定；草稿狀態直接設定子元素，避免舊顏色蓋過父層。功能文字對實際合成背景至少 4.5:1，不能用放大字體掩蓋淺字白底問題。

報名表只顯示同意文字及單一隱私連結；完整說明在預設收合的既有頁尾按需展開。連結須同時定位並保留鍵盤焦點，不代勾同意。對外信箱統一取 `src/config/event.mjs` 的 `PUBLIC_CONTACT_EMAIL`，不由管理員身份或舊公開內容覆蓋。

驗證入口為 `tests/browser/public-typography-smoke.mjs`：320／390／1440／1920，檢查最終 computed 字級／行高、對比、展開、鍵盤與原有未知申請恢復。使用隔離合成資料、零業務 POST；實際執行結果另記本輪發布紀錄，不以文件存在認列通過。

捲動效果另由 `home-scroll.mjs`／`hero-interaction.mjs`與各自CSS管理，不在動效檔新增字級。Header保留原高度並以實測高度作錨點留白。依使用者最新簡報式淡入需求，只有確認進入視窗後的短動畫可0→1，標題先行、內容延後；HTML與等待IO的節點預設可見，無JS／無IO不隱藏。focus、操作、減少動態立即取消並顯示全文，觸控捲動不消耗後續內容動畫；表單與品牌標題不持續位移。置頂／粒子／無JS降級的6案與本檔排版4案各自驗收，並實採早／中／完成畫面及粒子亮像素，不能相互替代。

Hero 與全頁共用一層自由星點背景，球體隨原生捲動退遠；球體輪廓及文字／操作範圍明確排除，不畫球緣軌道或尾巴。作品缺封面或載入失敗採緊湊文字版，不保留海報高度；成功圖片仍依原稿2:1完整顯示。缺圖短句使用集中meta角色，不另加微小文字；公開資料與參加待確認欄不再顯示，實際拒絕或已安排事實仍保留。

## 2026-11-02 Hero 與頁尾海報字

此階段在 PR #66 的前台、Wallet 與報名更正已發布後開始，依使用者提供的 JOEL CORRY／LONELY／THE REMIXES 參考改英文展示字。原始兩張標題 PNG 保留作歷史素材，正式 Hero 改為 HTML 真字；GGJ 左上、HOST 右下 wrapper 與球體構圖不改。英文使用粗窄字、實心／描邊交錯，僅 `GAME JAM` 有靜態紫色切片；中文另行使用 SC 700。頁尾只改既有英文 slogan 的兩行，保留 giant HOST 圖與其餘排版。標題沒有持續字母動畫。

| 展示角色 | 集中變數 | 規則 |
| --- | --- | --- |
| 英文 family／字重 | `--ah-font-display`／`--ah-weight-display` | 原版 Barlow Condensed ExtraBold，800；SC／Arial 後備 |
| Hero 英文 | `--ah-display-hero-latin`／`--ah-display-hero-host` | 桌面基準最高128px／其1.05倍；手機按可用寬度調整，HOST為1.1倍 |
| Hero 中文 | `--ah-display-hero-cjk` | SC 700，桌面30–71px、手機22–44px，正常換行 |
| 行高／字距 | `--ah-leading-poster`／`--ah-tracking-poster` | 1.18／−.015em；字組之間可換行，不剪裁或內捲 |
| 描邊／配色 | `--ah-poster-*` | 紫／藍紫為主、淡紫描邊及少量亮色切片；實心字有深色細邊，避免跨亮球時輪廓消失 |
| 頁尾英文 | `--ah-display-footer-poster` | 沿用原展示尺寸；手機除以1.4抵銷字型度量放大，保留原窄欄 |

`@font-face` 放在本檔，使用本地原廠 WOFF2、`font-display:swap`、CSS `size-adjust:140%`。這只調整 CSS 字型度量，沒有修改字型 bytes。原字型的 `GLOBAL GAME JAM` advance 為6.637em，SC後備為9.307em；放大1.4倍後兩者字寬接近，因此無JS或字型失敗仍能在原wrapper閱讀。不支援 `size-adjust` 的瀏覽器仍顯示較小的真字，不依賴載入成功才解除隱藏。

填色真字是基線，透明填色只在支援 `-webkit-text-stroke` 或文字裁切的 `@supports` 內啟用；forced-colors 回到完整 `CanvasText`。沒有背景圖、字型或JS時也有同一份文字。可存取語意維持唯一h1的權威活動名；裝飾字組不重複朗讀。公開活動名變更顯示真實新文字，恢復已知品牌活動時才還原初始字組，不用固定品牌覆蓋任意新標題。

原廠版本與完整 OFL、SHA／Git blob、字重及526個實際cmap由 `home-asset-manifest.json` 的獨立 `displayFonts` 記錄；原SC `fonts` 400／700規則不變。三檔首頁字型合計434,056 bytes，仍低於600KB；頁尾「字体许可」提供兩套完整OFL。`invitation-font-assets.test.mjs` 的5案已通過；正式編譯頁的四寬度、字型404後備、晚到字型真重排／遮罩、更新長標題及頁尾截圖由本輪統一建置後驗收，尚不以源碼或字型表通過冒稱畫面已通過。
