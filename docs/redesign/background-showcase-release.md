# 自由背景微粒與作品缺圖版型

2026-11-02（Asia/Taipei）。[PR #64](https://github.com/kunanli/artdicohost/pull/64) 已正式發布 main `50bc3cd546f89ac622e8b12d1c80eeb34256fff6`；[正式流程41384857720](https://github.com/kunanli/artdicohost/actions/runs/41384857720) 四工作completed／success，6／4／13與FC／OSS／HTTPS均逐項核對。此輪承接使用者否定球內／球緣亮點的實際美感回饋，以及作品區大型空海報與原稿差異。前輪 [PR #63](presentation-motion-release.md) 的量值通過不等於造型符合使用者要求；本輪重新設計位置與動作，保留簡報式淡入。

## 改動與原稿資格

- Hero改成獨立stage背景canvas（z:-2），球體仍z:-1、標題在前景。手機10／桌面24個隨機分散圓點慢速漂移，附近滑鼠輕微帶動；沒有固定軌道、彗星尾流或球緣光點。球圖的最大6／5px、1.2°輕互動保留。
- 球體完整ellipse加18px、標題／說明／操作DOM矩形加10px採聯集destination-out，不依賴原圖透明度。球體任何部分在視窗內時，另一層全頁edge canvas隱藏；只畫一層背景微粒。
- 繪製約30fps、bitmap最大1000px、DPR1.25，離屏／隱藏／reduced／無IO降級保持。晚到品牌圖失敗會使fallback子盒增高，既有RO改觀察標題子元素；幾何改變立即清舊canvas，再畫新遮罩。
- 原稿 `FrontEnd_Resource/落地页.png` SHA `ff5b62dfadc80e31a6af0eb3b08d23a28e4dbfdd047c0d65f1953da2b6366485`、1921×19362；作品約1768×885完整2:1、底部半透明字幕、右側真下一張預覽。圖片／圈徑等前輪量測仍見 [原稿證據](guest-identity-reference-release.md)。本輪未改任何原始圖。
- 有封面作品保留原2:1／contain及等高peek；缺圖或真error轉自然文字版，不保留海報高度或紫色空板。單筆／單類隱藏無效導航，篩選與刷新可恢復；移除資料／參加待確認與未安排佔位，真實declined及已安排連結保持。缺圖輔助文字用集中14px角色。
- 只改顯示和安全診斷，不發通知、改名額或發布業務內容；不把原稿作品圖冒充無關的真實作品封面。Wallet徽章與活動行整合的 [接續方案](external-registration-wallet.md) 仍明確待原檔／來源條件，網站審核政策未在本PR改動。

## 最終本機結果

產品來源 `ade69bf96e5d9eadefe72454b4e547e33412c2f0`，後續 `9738c60c2ca130bdce0cec81b735f99307c6452b` 只改免二次審核的操作方案。最終03:32:11編譯HTML SHA `b5a7165c2b7948e088b38c1842dfbeb27fd2ad08a5ee6bb82fdbaf6edadee0b9`；捲動腳本 SHA `ad4fc7172575eea602ec0772911dbd985d0f1272a510f352bb4ca052f7d5b5eb`。

最終6／6、reference9／9、collections9／9各exit0、頁面錯誤0，三份同HTML；reference／collections的metadata保留ade建置與後續docs-only差異，不冒稱重建。先前03:19的a8d產物6／9／9／排版4也通過，但在發現晚到fallback遮罩陳舊後已由新建置與新增回歸取代；排版最終準確資格另由CI4案補齊。來源739、Astro482（0錯誤／警告、1既有hint）、Node1612（fail／cancel／skip／todo0）、audit0、23頁通過；兩行後補DOM防護的準確全套驗證以CI為準。

新稀疏風格判準先依獨立source-DOM診斷與人工看圖定義：視窗內至少15個alpha≥96／RGBmax≥150亮像素、至少6個分離component、至少3個背景區域、兩幀真實位置變化。這取代被否定的明亮環形風格，不為滿足舊100像素而再放大光點；球／前景排除則檢查所有非0 alpha（僅DOM邊1px內縮）。

| 寬度×900 | 兩幀亮像素 | 可見分離點 | 背景區域 | 球／文字alpha違例 |
| --- | --- | --- | --- | --- |
| 320 | 54／53 | 10／10 | 5／5 | 0／0 |
| 390 | 58／61 | 10／10 | 5／5 | 0／0 |
| 1440 | 67／58 | 24／24 | 6／6 | 0／0 |
| 1920 | 33／35 | 20／20 | 6／6 | 0／0 |

真native canvas arc只讀probe先取自然速度，再以真mouse比較額外朝游標位移：1440為6.69px／583ms，1920為6.57px／616ms，保持>1.5且<20px。未用自然漂移冒稱滑鼠作用。Late synthetic error令GGJ229→254px、HOST225.02→254px，stage956／h1748.80不變；24.8ms後實際destination-out fillRect高274px完整包含新盒，游標350ms後全alpha仍0。未重播動畫或降原守門。

兩手機native pan各65px、未進場卡片pending；header top0、錨點≤64px、刷新≤2px、原生選單／Escape、guest/organization/agenda淡入、fresh-document hash、reduced初始／中途、離屏idle RAF0、無JS／無IO皆通過。這些為合成瀏覽器與明示hidden訊號，不聲稱真機／OS／電量驗收。

作品原圖四寬度主圖248×124／314×157／1059.84×529.92／1414×707、contain、實際decode1768×885；peek等高門檻保持。缺圖poster自然高度桌面114.5／手機135.5，不再有650px以上空板；missing／404／單筆／空類別／恢復／安排聯動保留。已人工看桌面／手機Hero、late fallback、三幀淡入、reference作品及compact缺圖。全頁／locator截圖中的sticky header位置為截圖定位產物，viewport top0另有真幾何驗證，不冒稱整頁逐像素一致。

## 準確 PR CI 與公開輸入

[PR流程41384169295](https://github.com/kunanli/artdicohost/actions/runs/41384169295) completed／success，check `125081202644`；head9738c60，實際合成merge source `60f11fd43ef2e3668f24aed7de2168212b385b2d`。以下日誌時間為UTC。

| PR UTC時間 | 核對 |
| --- | --- |
| 03:38:42／03:38:57 | 739來源／Astro482，0錯誤／警告、1既有hint |
| 03:40:31／03:40:34／03:42:37 | Node1612、23頁、audit0 |
| 03:41:24.4165622 | 捲動6／6，errors0／POST0／mail0 |
| 03:41:36.1633499 | 排版4／4，最低對比11.033，errors0／POST0／mail0 |
| 03:42:35.6358083 | 實際13／13，actual true、原圖7／變體7、company36／title32／detail36、errors0 |
| 03:44:27／03:44:48 | 準確FC128檔／公開61檔及原受限離線啟動通過 |

三報source與HTML皆一致，actual captureSource相同；公開R43、snapshot SHA `4b5486d90eed56ed762e40227b35866a07ec4cd451e16b32a67374d5a7ed79af`，七組織圖493851bytes。新增匿名count證實 **showcases total1／withCoverId0／withoutCoverId1**：這次正式空白確實沒有封面參照，不只靠人造404猜原因。未擴大組織圖片捕獲範圍，九個未捕獲人像／作品請求沿用明示404替身，不宣稱未捕獲影像HTTP／解碼成功；原始公開資料及圖僅留忽略目錄／一天artifact。

## 正式發布

[main流程41384857720](https://github.com/kunanli/artdicohost/actions/runs/41384857720) 四工作completed／success，check `125083325939`、FC `125084720472`、公開OSS `125085625039`。三份報告source均為main `50bc3cd546f89ac622e8b12d1c80eeb34256fff6`，HTML／script／snapshot與PR相同；capture再次證實作品total1／withCoverId0／withoutCoverId1。

| main UTC時間 | 核對 |
| --- | --- |
| 03:46:37／03:46:48 | 739來源／Astro482，0錯誤／警告、1既有hint |
| 03:47:59／03:48:00／03:49:44 | Node1612、23頁、audit0 |
| 03:48:46.6575641 | 捲動6／6，errors0／POST0／mail0 |
| 03:48:56.7227112 | 排版4／4，最低對比11.033，errors0／POST0／mail0 |
| 03:49:42.8359066 | actual13／13，原圖7／變體7／company36／title32／detail36、errors0／明示替身9 |
| 03:51:08／03:51:24 | 準確FC128／公開61，原限制保持 |

03:56:39.1332389 UTC，`https://artdico.host` 的61個準確公開物件逐項HTTPS核對通過，source為main `50bc3cd546f89ac622e8b12d1c80eeb34256fff6`；不是只驗本地產物或前一版。

FC工作 `125084720472` 已completed／success：

| main UTC時間 | 正式回執 |
| --- | --- |
| 03:54:49.7197812 | 正式報名別名逐欄符合批准政策與容量，人工審核設定仍按既有值保留 |
| 03:54:49.7204582 | 準確來源50bc3cd、內容／報名啟用，私有OSS兩客戶端／一FC通過；runId `r41384857720-a1-7ce94bb0c8a86717-50bc3cd546f89ac622e8b12d1c80eeb34256fff6` |
| 03:54:54.0952822 | 13個準確後台頁面HTTPS通過 |
| 03:54:55.1440259 | 匿名公開HTTPS／CORS通過，仍R43與9嘉賓／7組織／1作品／16展位／43場次；出席根證明缺省、confirmed0／displayed9，不推論真人出席 |

如需回退，以前版main80895d8的相關產品檔／測試建立回退PR，重新驗證發布；不回滾名額、既有通知或凍結公開快照。`docs/background-particles-release-proof`只補回執與最新會員核對，不為紀錄再次建立部署PR。
