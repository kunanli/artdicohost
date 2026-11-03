# 確認郵件診斷與手動重寄

使用者另要求最少成功提示：新的已確認報名停留原頁，只顯示「报名成功」，不自動跳轉私人頁；後端仍在真實持久化後寄對應參會確認函。候補／待審等維持真實狀態；私人參會頁、Wallet及群碼繼續由郵件內的受控連結開啟。成功提示不宣稱EmailJS已送達，讀取／重播不補寄。

前置排序已由PR71／main c102d50正式發布。使用者回報單人頁的確認信達重試上限，寄信按鈕停用；該截圖只證明本地限制，無法證明EmailJS根因或五次實際SMTP失敗。舊journal未保存服務商拒絕原因，目前已詢問安全錯誤碼／訊息，尚未取得實際外部錯誤證據。

本輪沿原EmailJS、私有journal、管理者權限、單人寄送與原操作GET：新增固定安全原因及是否真正開始請求的證據，區分缺設定、格式錯誤、載入失敗、發送前guard、完整4xx拒絕及結果不明；原始回應、密鑰、設定值和內部設定身份都不進前端。已啟動但無法核實結果者維持unknown；可證明未呼叫服務商者使用明確未開始分類，且晚完成的guard不可在逾時後發信。

使用者台北2026-11-03補充「我要能夠再次重寄」。自動／普通重試五次限制及單調attempt保留，舊記錄不歸零或猜測退款；已耗盡的已知拒絕仍可由管理者明確手動重寄，每次以新操作／當前版本在同一CAS記錄原操作並保留下一attempt。再次已知拒絕後可再次手動執行，不設終身一次額度。相關accepted／unknown／reserved或未完成寄送先核對；同操作重播、並發及舊回執都不多發。內部HMAC只綁當前有效設定，不能證明SMTP重連、權限或外部服務已修好。

日常頁面只留一句原因、設定入口及「重寄确认信」。取消不發信；失去回執保留原IDB正文／身份，只GET原操作，不重送。新可選診斷及復原audit由新reader向後讀舊記錄；寫入新事件後的回退必須保留相容reader，不能直接回退舊journal解析器或刪除紀錄。

共用安全診斷模組加入明確FC清單，包檔案數上限由128精確增為129；原ZIP／文字展開／JSON／64KiB manifest／FC請求及來源白名單限制保持。以準確提交整包另行產生及驗證，不以較小合成包通過代替實際129檔案產物。

實作、合成服務／真編譯頁面、準確PR／main及HTTPS證據完成後追加。這些驗收不讀正式名單、不實寄；實際EmailJS設定修復與收件須由外部安全錯誤／修復或實際收件證據另行核對。

正式寄件觀測沿既有部署管理者憑據：固定API登入、GET通知設定、最後登出。回報只含來源、automaticEnabled及安全email ready／enabled／reason／固定缺項名，不輸出密鑰、cookie、session或原始回應，不碰名單或寄送路徑。觀測失敗會獨立揭露；即使readiness有效也不能推定服務商接受或真人收件。

## 已發布與驗證

[PR72](https://github.com/kunanli/artdicohost/pull/72) 已發布main `765a7bcc1a547b63b85fb90f9420a6cce2a1fe13`。最終候選 `18a9db48caaf2415a843d0ebf95605e23235f3a1` 經[PR流程41483651885](https://github.com/kunanli/artdicohost/actions/runs/41483651885)的合併測試來源 `055556dda0a9f2b7fd1f5bd0160f586c46c1c4e1` 驗證；[正式流程41485406856](https://github.com/kunanli/artdicohost/actions/runs/41485406856) 四工作及流程最終狀態全部成功。

PR與main均為1750項Node測試全部通過（零fail／cancelled／skipped／todo）、766檔來源掃描、494檔Astro零錯誤、23頁建置及audit零弱點。六份瀏覽器回執完整通過動效6／字體4／自動報名10／後台排序8／手動重寄8／正式素材13，綁定各自準確來源與同份首頁HTML SHA `e134166845fd4faa6d0e84fe1e05c9e6fc9549f0e3fe326649864c06ce895565`，零頁面錯誤。自動報名腳本SHA `cf6b227174dc233cc940e6ce3c6b94d1656aa526fac40786db83479cc206965b`；重寄腳本SHA `40f3e08fedce075cb62a77fa81f98fb1865f2db845bc2ac04b4729daa64e0881`。實際person路由為 `/admin/person/`，HTML SHA `19625e3c9fecf651d876350b8f81b2153f737cc9e0392756cea1ff73126f7cbc`。

自動報名10案核對四寬度原頁URL／hash保留、唯一「报名成功」及焦點、已完成form／preview／details隱藏、零自動私人頁讀取，以及真合成provider對應同一報名只接受一封，重播不加寄。候補、舊pending原bytes／key／隱私版本與IDB守門保留。重寄8案證明原五次後第六次明確拒絕仍可再次按鈕，以新operation／當前revision作第七次成功；前後重播第六次均不多寄，取消為零POST，原IDB先持久化及未知結果GET-only、權限／切人／收件修訂防錯寄都保留。瀏覽器provider及業務寫入均是隔離合成資料；真實郵件／名單寫入／未攔截外網請求皆零。本地另完成既有報名／私人頁流程15案（私人頁為測試明確導覽，非報名自動跳轉）、旅程124項及持久化契約22項。

正式公開素材仍為R44快照SHA `71037be9782b05af1da404fd6ab667b538fbb5e4f4356fdbec943787d241c8d7`，8份原始Logo、7份白色設計版本、9個公開嘉賓及3份出席證明。既有頭像／作品圖未擷取範圍維持明確404替身，不把Logo驗收延伸成已驗所有圖片。129檔案的實際候選包在PR／main均產生、驗證並離線啟動成功；本地完整候選另綁 `18a9db4`（35734275 ZIP bytes、SHA `f45b92b6ec53f7731c9053c04ee0454a8b73af4b3c9eab4417071cacbb57f050`），不把本地ZIP摘要當作正式包讀回摘要。

正式回執（台北2026-11-03）：01:02:40（17:02:40 UTC）私有OSS驗收通過，2個獨立client／1個FC，content／registration啟用；01:02:47核對13個準確API後台頁面；01:02:49匿名報名GET／兩個preflight通過且 `attendeeReviewRequired:false`；01:04:40（17:04:40 UTC）完整核對 `https://artdico.host` 的60個公開物件、來源、bytes與HTTPS。

**實際寄件設定觀測已通過**：01:02:42（17:02:42 UTC），`verified:true`、來源為上述main、`automaticEnabled:true`、`email.enabled:true`、`email.ready:true`、`missing:[]`、`invalid:[]`，reason為 `CONFIGURED_PROVIDER_NOT_DELIVERY_PROOF`。固定登入／讀設定／登出成功，mailRequests及businessWrites皆0。這證明開關已開啟、設定可讀且通過格式校驗；不證明EmailJS接受、SMTP成功或真人收件。舊失敗未保留服務商原因，仍需新的實際寄送結果／EmailJS安全錯誤或收件證據定位外部投遞問題；不宣稱已修復未觀測的外部故障。

回退保留新的journal reader及原通知／操作紀錄。可回退前端提示或暫停未來自動通知後修正，不能清空notice、把unknown改成rejected、重設attempt或部署補寄既有人員。
