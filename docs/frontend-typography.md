# 公開活動網站字體規範與 CSS 管理

2026-11-08依使用者要求重新建立全頁主標／副標／正文層級。`src/styles/home-typography.css`是公開活動首頁的唯一字級入口；`home.css`、`home-guests.css`、`program.css`、`students-showcase.css`與`language.css`只管理布局／裝飾，不再各寫font-size。以下最新規則取代舊原稿比例與下方歷史字級；後台與私人參會頁的共享樣式依賴不受影響。

| 角色 | 集中變數 | 手機至桌面 | 用途 |
| --- | --- | --- | --- |
| 區塊主標 | `--ah-display-section` | 32–56px／700 | 亮點、嘉賓、組織、作品、日程、講者申請、場地、Q&A，同一寬度同級 |
| 內容副標 | `--ah-type-subtitle` | 24–32px／700 | 活動介紹、參與卡片、日期與時段分組 |
| 內容標題 | `--ah-type-card-title` | 20–24px／700 | 作品名稱、問答問題、場次名稱 |
| 功能面板標題 | `--ah-type-panel-title` | 20px／700 | 表單／政策／恢復與大圖面板 |
| 正文 | `--ah-type-body` | 16–18px／400 | 活動介紹、參與方式、場地、問答、表單說明，行高1.75 |
| 標籤／輸入／操作 | `--ah-type-label/control/action` | 16px | 欄位、選項、按鈕、導覽，輸入不因手機縮小，操作區至少44px |
| 輔助 | `--ah-type-meta` | 14px／400 | 說明、分類、短標、頁尾輔助，與正文有一致層級 |
| 嘉賓姓名 | `--ah-display-person` | 手機18–22／桌面24–32px | 700字重；組織／GGJ身分14／16px，統一1.5行高避免真字型glyph超出clamp |
| 體驗球標題 | `--ah-display-fact` | 手機22–28／桌面28–52px | 四顆球同級；英文有集中適配角色與合理換行，輔助14px |

只使用現有SC閱讀字型400／700與原OFL英文展示字，沒有新字型請求。Hero品牌原圖、英文fallback與頁尾海報字是獨立品牌展示角色，不當作閱讀正文的基準。主要標題行高1.35、內文1.75、控制／嘉賓文字1.5；字級在一個檔案中按角色調整，不堆疊散落的手機／桌面硬編碼。

政策／恢復表面、主文字、次文字與連結成對設定，對實際合成背景至少4.5:1。完整姓名、組織／社群與GGJ身分保留於可存取名稱；長文可合理換行／省略，無內層捲動條。照片只有成功decode才可替換文字，缺圖保持可讀。

嘉賓照片自動展示約65%可見成功照片，無開關及本機開關依賴；操作時保護目標並保留／補足周圍照片，離屏／背景與減少動態停止自動切換。嘉賓及四顆現場球皆可拖曳、慣性回彈；手機直向pan仍捲頁，橫向起手可拖球；方向鍵推動、Escape歸位，拖曳不誤觸照片click。物理位移與原漂浮分層，共用原背景時鐘。

驗收以`public-typography-smoke.mjs`四寬計算全頁h2／副標／正文／操作字級一致性及表單、告知／恢復對比與焦點；`homepage-gallery-smoke.mjs`四寬驗原生滑鼠／觸控拖曳、慣性回位、click抑制、鍵盤、手機直向pan及自動照片；捲動6案與實際公開素材13案分別維持。全部網路攔截只讀，不能把合成資料或事件視為真實寄信、真機或OS電量測量。

以下為歷史字體階段，與本頁最新規則衝突時以2026-11-08角色表及使用者最新要求優先。

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
