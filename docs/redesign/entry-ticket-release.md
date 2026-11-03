# 報名、確認信與手機入場

本階段接續 main `765a7bc`；改用最初 Hero 原始標題素材，並將報名、郵件與工作人員入場接成同一份名額。PR73功能與PR74驗證修正均已正式發布，最終main為 `321940c4a13c5174eac4378d291dd42b6c980f3a`，精確回執見下方。EmailJS託管範本套用、先前403與實際收件仍獨立待核對。

## 參加者與工作人員

1. 本站填表，自動確認或依容量候補；分享主題預設不勾。一般畫面沒有暫存工具／狀態或報名開放徽章。待核對的提交仍保留原結果恢復，成功留原頁只顯示「报名成功」。
2. 確認信使用 `https://artdico.host/r/#<22字元>` 私人短連結。收件人可取得官方 Wallet 徽章、獨立入場 QR 及目前有效的活動微信群 QR。簡體頁報名保存 `locale: zh-CN`，英文來源為 `en`；歷史缺省仍為簡體。
3. 工作人員用手機系統／微信掃碼，開啟 `https://api.artdico.host/admin/checkin/#ticket=<22字元>`。用現有 reviewer 或 superadmin 帳號登入，核對姓名後按「确认入场」。掃碼和讀取本身不簽到。重掃顯示已入場；未知回執只核對原操作。
4. 新 Wallet pass 使用同一個入場核銷入口；舊 pass 的有效性查詢維持可讀，不能將舊 GET 驗證當作已簽到。
5. 人員名單按實際建立時間新至舊並顯示「录入」時間（UTC+8），修改不重排，歷史缺時間顯示未記錄。「更多 → 删除」限管理員：報名沿用刪除標記並釋放名額、撤銷票券；聯絡人可恢復歸檔，不能藉刪聯絡人偷偷取消已有報名。原資料和歷史仍保留。純公開內容人物由原內容編輯／發布流程處理。

## 郵件控制台的必要設定

伺服器無法透過目前 EmailJS 寄送 API 修改其託管範本。正式啟用圖片前，將 [確認信 HTML](../templates/emailjs-registration-confirmation.html) 貼入現用 EmailJS template，Subject 設為 `{{email_subject}}`。原八個純文字變數保留，新增三個受限制的展示變數；只有程式產生且只含本站 URL／固定文案的 `confirmation_actions` 使用三大括號，個人資料保持跳脫。

先前 HTTP 403 是服務商拒絕，與靜態範本分開。需在 EmailJS Account → Security 核對非瀏覽器 API 權限；設定格式完整不表示服務商接受／實際送達。本階段不實寄真實郵件。

官方簡體與英文 SVG 保留原上傳 bytes；郵件使用同一官方向量渲染的 PNG（176px 高，顯示44px），完整比例及黑底白字不改。群碼圖片每次請求重新檢查目前群設定／有效期／名額；缺少或過期不生成假圖，提供私人頁取得目前群碼。郵件用戶端可能快取已顯示的圖片，不能遠端收回已下載的碼。

## 契約、資料與回退

- 短碼由活動密鑰分離用途產生，128位以上不可猜測，私人頁與入場碼不能互用。QR 在本機編碼，不呼叫第三方圖片服務。公開圖片與解析器只走既有 `/api/admin/*` FC 網域路由下精確的匿名能力端點 `/api/admin/registration/entry-links/<code>`，不擴充 DNS 或全站路由。
- 每次讀取檢查目前主報名、accessRevision、名額與期限；撤回／刪除／資料更正可使舊碼失效。主報名合併後檢查全部相關簽到，包含合併發生在簽到提交途中，不允許第二次成功。
- 私有儲存增加 `cms/v1/entry-tickets/<event>/links/l-<code>/mapping.jsonl`（一次原子 append，HMAC 對應、精確核對）；簽到使用同前綴 `checkins/r-<registrationId>/{commits.jsonl,blobs/<sha>.json}`。GET 不鑄碼、不寫紀錄。既有私有備份接受這些 key，明確 inventory 必須包含上述 mapping 與簽到 journal／引用 blobs，不能只備份舊報名 prefix。到期後仍依活動保留期限處理；不自動掃描／刪除正式物件。
- contact 新增可選 `archivedAt` 與歸檔／恢復審計；舊資料無欄位照讀，不在 GET 補寫。寫入新審計後回退必須保留新版 contact reader，或先經隔離恢復驗證，不能部署拒讀新欄位的舊版本。
- 新 entry journal 保存相關報名 ID、操作、工作人員與時間；都是私有資料，不能提交 Git 或放公開快照。所有寫入仍需 API 驗權、同源、CSRF 與原子版本檢查；未知結果不能重複點寄信或入場。
- FC 固定打包清單新增 entry service／handler／QR、附 MIT 授權的 `qrcode-generator 2.0.4` 原始單一 ESM、展示模組及獨立核驗頁。保留原體積、解壓、Node SHA、來源白名單與請求上限。

## 驗證範圍

本機已實際核對原稿 Hero 四寬度與6案動效、4案功能字體、10案自動報名、6案手機核驗、2案名單刪除與排序、6案中英文郵件預覽。QR PNG 經獨立 zxing-cpp 解碼，22／120字元合成 URL 均精確還原。以上全部使用隔離來源，不操作正式名單、不寄真實郵件；iPhone 加入 Wallet、實際微信入群與現場同事掃碼仍需實機核對。

正式 CI 必須驗證同一提交／HTML 的原六份回執與新增三份旅程回執，實際公開圖片13案成功另行核對，不能只看 workflow 綠色。合併後再查 main 的 FC／OSS／HTTPS 精確發布結果與核驗頁。

## 發布前發現與修正

PR73 第一輪 run41555491464 的1801項Node及10份瀏覽器回執通過，但人工查看實際畫面發現GitHub原生中文後備字型缺少，部分動態人物字元空白；該輪不能當中文視覺驗收。CI改以原稿既有OFL完整NotoSC字型（SHA固定）作系統後備，不增加前端字型流量，並加入真正字形像素檢查。相同R44／HTML在本機正例13案、300個漢字／字體檢查全通過；隔離只有拉丁字型的反例明確檢出25／75個空白，按預期失敗。

同輪準確ZIP的離線啟動被阻擋，原因為runtime仍沿用舊128筆release索引上限。新包137檔包含自身release.json，索引應為136筆；已統一生產者137、runtime索引136、靜態資產42並加入邊界測試（接受136、拒絕137索引），其他位元組、SHA與白名單規則不放寬。該失敗發生在合併／部署前，沒有切換正式服務。後續以新的精確來源再驗，不把前輪局部通過冒充發布通過。

## 正式路徑核對的閘道差異

main a3f9411 的FC／14後台／68公開HTTPS回執已成功，但新增路徑驗證器因要求ACAC標頭完全缺省而失敗。PR74獨立只讀觀察確認：/r/200且SHA／bytes與已發布r/index.html相同、無效入場路徑404 ENTRY_NOT_FOUND、預檢204且固定本站Origin／唯讀方法／空內容／私有不快取皆正確；FC閘道另回ACAC=true。公開端點在登入處理之前以短碼授權，忽略Cookie；用戶端及驗證器固定credentials:omit，實測無Set-Cookie。修正驗證器接受缺省或明確true／false，拒絕未知／合併值，保留Origin、方法、禁止Set-Cookie、時限／體積與不跟隨重新導向的檢查；未修改閘道、DNS、IAM或業務程式。前輪路徑失敗回執保留，修正後正式成功結果如下。

## 最終來源與正式發布回執

功能[PR73](https://github.com/kunanli/artdicohost/pull/73)來源 `3e603411b4aaebd027613d654b49f40cd7187eae`，PR測試來源 `5a272a8dc598f04c04b5921c88bd31aaf8613986`，run41557744637／check125660645838。首次main `a3f9411cc003d6e1c9a2deede759691f6772f0a1` 的run41559080033取得私有OSS、14後台及68公開HTTPS回執，但最後的路徑誤判失敗，該次workflow不記為全成功。

驗證修正[PR74](https://github.com/kunanli/artdicohost/pull/74)來源 `6f92212c79b930e126dcd32e99df928a8fc5b2ac`，PR測試來源 `7489ec929cb65340943d30df6f4783dc8bb0941b`，run41562400558／check125675969814全通過。最終main **`321940c4a13c5174eac4378d291dd42b6c980f3a`** 的[run41563515292](https://github.com/kunanli/artdicohost/actions/runs/41563515292)五工作均completed／success，已逐項讀取實際回執：

| 正式核對 | 工作與結果 |
| --- | --- |
| 原始來源與完整測試 | check125679412164；795來源、Astro516檔，0錯誤／0警告／2提示；1809測試全通過，fail／cancelled／skipped／todo皆0；套件審計0已知漏洞 |
| 同來源瀏覽器 | 十份回執共67案：捲動6、字體4、自動報名10、後台排序8、確認信重寄8、手機入場6、名單排序／刪除2、郵件6、短連結4、實際公開素材13；各自sourceCommit綁最終main，頁面錯誤0 |
| 精確後端封包 | 137檔、136筆release索引、42靜態資產；準確ZIP在無網路、唯讀code、無真人帳號的Docker通過closed／synthetic兩模式，15.066秒；未把離線測試當私有OSS驗證 |
| 正式FC與私有OSS | job125682732514；02:14:16 UTC精確sourceCommit、content／registration啟用、私有OSS passed、2獨立客戶端／1FC程序；02:14:22核對14個精確後台HTTPS頁面 |
| 自動名額與寄信設定 | 02:14:24公開GET／兩種OPTIONS成功，attendeeReviewRequired=false；02:14:18自動寄信、email.enabled／ready皆true，missing／invalid空。mailRequests=0、businessWrites=0，reason仍為CONFIGURED_PROVIDER_NOT_DELIVERY_PROOF |
| 公開靜態網站 | job125683842820；**2026-11-03 02:16:41 UTC**，68個準確公開物件HTTPS核對成功，包含/r/index.html及官方四個Wallet資產 |
| 正式短網址及入場路徑 | **02:16:44 UTC**，Entry surfaces release verification verified／publicEntry／invalidEntry／cors皆true，3 requests，commit為最終main；核對目錄/r/實際bytes／SHA、固定無效入場碼404及預檢204，不使用真票券 |

公開首頁SHA `fdc57538b5e2be588e19db835c4ea79cdd3d11dbea940521129560cf8f17d302`；/r/頁SHA `e1a7aa2232bd688745b7d47f077296bf3b19619b8992bc556b778747236e5e23`。這兩份產物已由最終公開HTTPS清單核對。後台瀏覽器回執使用公開設定dist中的私人頁HTML；FC候選另建，其14頁由候選自身manifest與HTTPS核對，不把兩種建置的HTML摘要混用。

實際公開素材回歸同為R44，snapshot SHA `71037be9782b05af1da404fd6ab667b538fbb5e4f4356fdbec943787d241c8d7`；8原始上傳Logo／7原稿白色匹配、9公開嘉賓，4寬共36卡（公司36、職稱32、空字幕4）。實際素材腳本SHA `07a05a439c6f1af94a92a980cfb1fe605929f0c7d1924d9fdf2e7c2040594905`；300個漢字／字體像素檢查、空白／缺字0、90控制檢查。42次／9路徑未捕獲頭像或作品媒體以明示404替身處理，不冒稱驗過圖片內容。既有原稿完整OFL字體只作CI系統後備，未增加前端字體流量。

官方CN／EN原始SVG bytes保持不變；郵件PNG由同份向量渲染，CN SHA `359b17cea9d2f249026388f9c3f625c163f2d872c02e0353363a301cdf6928d5`、EN SHA `5c81903d7e9c789fc8b25f5db02a3ecf47746c7e99d967cc651e4ff29703a8e1`；郵件範本SHA `551b4687af3d859a61b5a44bca1619dd7eef24dbded2ba89d24b477df9c86b7a`。QR本機編碼，獨立zxing-cpp對22／120字元合成URL精確解碼。原137檔本機候選ZIP摘要 `608a95acc420686547df38d8c446898a2eaab621a4809270333f90d970688c69` 只綁3e603來源，並非最終正式ZIP摘要。

本輪沒有建立／修改／刪除正式報名、核銷真實入場或發真實郵件。伺服器能力與版型已上線；**EmailJS託管範本仍須套用上方HTML與Subject，403未以真實接受／收件證明解除**。有效群碼須由後台現行設定提供；iPhone加入Wallet、實際微信入群及現場同事操作保持獨立驗收。
