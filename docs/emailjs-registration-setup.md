# support@artdico.co 報名確認信設定

## 2026-11-03：收到的信缺少 Wallet 圖標

先分開核對三層：官方PNG是否仍在、服務端實際`confirmation_actions`是否包含`<img>`、EmailJS目前Content是否用`{{{confirmation_actions}}}`輸出原HTML。Repo範本存在、API接受及版型預覽都不能證明實際收件已含圖標。官方圖片網址為`https://artdico.host/wallet/add-to-apple-wallet-cn.png`及`https://artdico.host/wallet/add-to-apple-wallet-en.png`；無需重新上傳或繪製。

已知程式缺口為Wallet完整可用性只等250ms，OSS冷讀取稍慢便成功寄出缺圖的確認函。本輪改為沿原通知總期限核對；正常的慢回覆仍附官方圖標，整體準備超時不呼叫EmailJS、記錄已知未開始寄送，可由既有明確重寄流程處理。明確未配置或無效憑證仍不顯示可用Wallet，已確認／待審資格保持原規則。

## 2026-11-03：確認信語言、Wallet 徽章與二維碼

本階段新增三個固定參數 `email_subject`、`email_language`、`confirmation_actions`，原八個參數保留。新一般報名保存明確 `locale`（`zh-CN`／`en`），缺省舊記錄仍用簡體中文，不由 Email 地址或姓名猜語言。只有新送出的信使用新內容；讀取、部署與舊發信紀錄不補寄。

**需在既有 EmailJS 模板貼上新的 [完整 HTML](templates/emailjs-registration-confirmation.html)，並把 Subject 改成 `{{email_subject}}`。** 網站後端無 EmailJS 模板管理權限，部署程式無法替你修改控制台模板；原模板未更新時仍會寄出原文字，不能宣稱圖標／二維碼已顯示。保留同一 Template ID、收件人與寄件設定，不新增 Auto-Reply。實際 EmailJS 403 還需核對 Account → Security 的 non-browser API 權限與服務商失敗原因，本階段模板不會解除帳戶限制。

- `invitation_text` 維持雙大括號跳脫姓名和活動文字；只有 `confirmation_actions` 用三大括號。這個片段由服務端固定程式生成，僅含驗證過的本站短連結、同源私密 QR 圖片 URL、官方圖標 URL與固定語系文案，不接受自由 HTML、任意外部 URL 或參加者文字。
- Wallet 圖標使用主辦方上傳的原始 CN／US-UK SVG，等比例 rasterize 成郵件較相容的 PNG，不重繪或改色。CN：`/wallet/add-to-apple-wallet-cn.png`；EN：`/wallet/add-to-apple-wallet-en.png`。郵件以44px高呈現並保留圖標原比例；點擊打開短參會頁，在 iPhone Safari 取得票券，並不把一般頁面連結冒稱直接加入 Wallet。
- 正式確認／行前提醒由明確寄送流程建立 `/r/#<隨機22字元>` 私人短連結及專用入場 QR。只在可核對當前名額、權限和短連結建立成功後呼叫 EmailJS；不能建立時記錄已知未開始傳送，可人工重寄。一般申請待審回執不附正式入場碼或 Wallet 徽章。
- 入場 QR 由本站產生，不把能力碼送到第三方圖片服務；工作人員掃碼仍須登入並明確確認，圖片載入不簽到。
- 入群圖片使用同源、參會能力綁定的穩定圖片端點，每次取圖重查當前群碼與資格，**不在信中放十分鐘到期的臨時群碼圖片 URL**。未設定／已到期就不顯示圖片；有設定時顯示實際到期時間，並提供參會頁取得最新碼。郵件代理可能快取圖片，信中靜態圖不能保證永遠為最新；失效以參會頁為準。
- 模板預覽／合成測試不等於真實收件、微信入群或 iPhone Wallet 加入；需獨立核對收件匣與裝置結果。

官方徽章派生記錄（原始SVG另行保留）：CN SVG SHA-256 `4b832d82c1fe7cf51a9821706566c411234dbdefc54b4ce3487c366f67650d7e` → PNG488×176、15114 bytes、SHA `359b17cea9d2f249026388f9c3f625c163f2d872c02e0353363a301cdf6928d5`；EN SVG SHA `052b3b446860fd2f9b49c2f0336038947623a5a9433ee3583585b8552ff6f506` → PNG557×176、14952 bytes、SHA `5c81903d7e9c789fc8b25f5db02a3ecf47746c7e99d967cc651e4ff29703a8e1`。使用既有 Sharp0.35.5，SVGdensity288、目標高176px、保留透明與長寬比。

以下為歷史配置記錄，與上段新模板規則衝突時以上段為準。


2026-11-01 P4：沿用下方已正常運作的服務、模板及憑據。新增申請回執與行前提醒共用原 `invitation_text`，八個模板參數及中性 Subject 不變，無須新增模板、Auto-Reply 或重新設定。原政策版本不遷移；表單說明必要通知與 EmailJS 最小傳送欄位。三類獨立去重、人工提醒預覽與未知結果核對見 [最新通知流程](registration-confirmation.md)。真實收件、SPF／DKIM／DMARC 仍須按實際郵件獨立記錄，不把開發合成測試當作新實寄證據。

最新回報（2026-10-21）：使用者確認 Email 已正常發送、此部分暫時 OK，接續改為 Apple Wallet 設定。以下保留實際模板與操作流程；此回報不冒充開發端新取得的 FC 狀態或獨立實寄證據。

操作入口已移到 [設置與通知](https://api.artdico.host/admin/settings/) 的「报名确认与票券」（PR #34 已上線），原報名頁保留明確連結。既有可用配置不用重新設定；以下停用／啟用順序供首次配置或輪替使用。

2026-10-21。根據使用者提供的 EmailJS 畫面，已有 Service `LoginPlan`，SMTP `smtp.feishu.cn`／465／SSL，帳號 `support@artdico.co`。這證明已有設定，尚不代表本次活動已寄信或收件成功。

使用者已保存並提供實際 **Template ID `template_89mgpj9`**。使用者已確認 EmailJS Test It 收到信、寄件人與排版正常；目前沒有由本開發工作修改 FC 或啟用寄件。

只讀核對 `kunanli/artdico-deck` 的 `backend/lib/email-fallback.js`：使用相同服務，以服務端 REST 傳送；另有歡迎及通知模板。可沿用同一個 EmailJS SMTP 服務，新增活動專用模板，保留 Deck 原模板與設定。Deck 的 `message`／`subject` 參數與此專案的 `invitation_text` 不同。

## EmailJS 控制台

1. 在 Email Services 保留 `LoginPlan` 服務 ID、SMTP、SSL、帳號及 App Password。SMTP 密碼只留在 EmailJS，不放入活動站設定。此時不需要重新按 Update Service；畫面勾選的 Send test email 會發信，僅在要核驗服務時自行執行。
2. 活動確認模板已由使用者保存，實際 Template ID 為 `template_89mgpj9`；接續使用此 ID，不再以先前建議名稱重建。
3. 欄位如下。From Email 可保留使用服務預設地址，核對實際為 `support@artdico.co`；或在允許指定時固定填此地址。

| 欄位 | 值 |
| --- | --- |
| To Email | `{{to_email}}` |
| From Name | `ARTDiCO HOST` |
| From Email | `support@artdico.co`，或核實相同的服務預設地址 |
| Reply-To | `support@artdico.co` |
| Subject | `GGJ 中国交流聚会 × ARTDiCO HOST 2026｜报名状态通知` |
| CC／BCC | 留空 |

4. Content 的 HTML 原始碼使用 [可貼上的模板](templates/emailjs-registration-confirmation.html)。正文以 **`{{invitation_text}}`** 為主，保留雙大括號的 escaping。它已包含姓名、確認／候補狀態、活動事實、報名編號與私人確認／列印連結。不要改成 Deck 的 `{{message}}`，也不要固定寫「所有人報名成功」，避免候補被誤認為已取得名額。

   模板已按使用者指定加入「GGJ 中国交流聚会 × ARTDiCO HOST 2026」及正式活動介紹：2026 年 12 月 5 日深圳前海、SO／RO 與開發者等參與對象，以及 GGJ 分享、圓桌、技術講座、作品展示和合作交流。介紹在「本次报名信息」之前，後段仍以個人實際名額狀態為準；具體議程與嘉賓安排將陸續公布。
5. 這份模板由活動後端明確呼叫一次；不再串接 EmailJS 的額外 Auto-Reply 模板，以免一份報名收到重複通知。沒有新增附件或付費需求。
6. 在 Account 找到現有 Public Key／Private Key；依帳戶目前 Security 設定核對服務端 API 的授權。活動後端會傳 `accessToken`，目前程式要求兩種 key 都存在。不要因新增此站而輪替 Deck 共用 key，或直接改變可能影響原站的帳戶級限制。

官方參考：[模板欄位](https://www.emailjs.com/docs/tutorial/creating-email-template/)、[動態變數](https://www.emailjs.com/docs/user-guide/dynamic-variables-templates/)、[REST send](https://www.emailjs.com/docs/rest-api/send/)、[Public／Private Key](https://www.emailjs.com/docs/sdk/options/)。控制台 UI 以目前帳戶實際顯示為準。

## 活動站受控設定

目前確認信使用獨立 `EMAILJS_CONFIRMATION_TEMPLATE_ID`。SMTP App Password 不在這份設定；受控 JSON 只需六欄：

```json
{
  "EMAILJS_SERVICE_ID": "LoginPlan",
  "EMAILJS_CONFIRMATION_TEMPLATE_ID": "template_89mgpj9",
  "EMAILJS_PUBLIC_KEY": "REPLACE_IN_PROTECTED_FILE",
  "EMAILJS_PRIVATE_KEY": "REPLACE_IN_PROTECTED_FILE",
  "EMAIL_FROM_ADDRESS": "support@artdico.co",
  "EMAIL_FROM_NAME": "ARTDiCO HOST"
}
```

上例只有佔位值，不能直接啟用。實際 key 在受控機器的 0600 私密檔案提供，不貼聊天、不寫進 Git／`PUBLIC_` 或一般網頁表單。本機 `.env.local` 不會同步到正式 FC；Deck 的 GitHub Secrets 也不會自動成為此站設定。

### 現成的小型配置入口：FC 環境變數

`functions/cloud-content/runtime.mjs` 只在提供 `ARTDICO_CONFIRMATION_EMAIL_BUNDLE_ID` 時載入 bundle；沒有 locator 時，既有 provider 直接讀取上述六欄，無需新程式或重新部署。可由現有管理者在阿里雲 FC 的香港函數 `artdicohost-api` 配置頁受控新增。先在報名後台關閉自動通知並保存，保留 FC 全部原有環境值，不設定佔位 bundle ID。

| 新增／核對的環境變數 | 值 |
| --- | --- |
| `EMAILJS_SERVICE_ID` | `LoginPlan` |
| `EMAILJS_CONFIRMATION_TEMPLATE_ID` | `template_89mgpj9` |
| `EMAILJS_PUBLIC_KEY` | 從 EmailJS Account 複製到 FC 受控欄位 |
| `EMAILJS_PRIVATE_KEY` | 從 EmailJS 帳戶的 API／Security 設定複製到 FC 受控欄位 |
| `EMAIL_FROM_ADDRESS` | `support@artdico.co` |
| `EMAIL_FROM_NAME` | `ARTDiCO HOST` |
| `ARTDICO_CONFIRMATION_EMAIL_ENABLED` | 初次配置先 `false`；核驗後再明確開啟 |

直接方式的前提是**完整原環境與新增欄位的 JSON 不超過 4096 bytes**，目前未量測正式 map 大小，不能保證放得下。超限不要刪除原有設定來騰空間，改用下方 bundle；若原本已有非空 locator，須先核對原配置，直接環境不會覆蓋該 bundle。現有 `.github/workflows/check.yml` 沒有消費任何 EmailJS Secrets，只新增 GitHub Secrets 不會配置 FC。既有公開網站部署身分也不拿來讀寫私有配置物件。

完成初次停用配置後，先確認 EmailJS Test It 已正常收到信，再在後台自動通知仍關閉時把 FC 寄件開關改為 `true`。重新載入「报名确认与票券」核對缺項／readiness；最後才明確開啟後台自動通知。這個順序與 bundle 的通知閘門一致。

### 完整配置入口：加密 bundle

由既有運維依 [加密配置流程](delivery-configuration.md)使用現有報名簽章秘密產生 bundle，上傳同一私有桶的不可變物件；FC 只增加 `ARTDICO_CONFIRMATION_EMAIL_BUNDLE_ID` 和明確寄件開關。現有 FC 環境總量上限 4096 bytes，保留其餘環境、角色與正式資料；不用將多個 key 直接塞進既有環境。

啟用順序：

1. 首次配置或輪替時，在[設置與通知](https://api.artdico.host/admin/settings/)的「报名确认与票券」先取消自動確認信並保存。
2. 準備／上傳加密 bundle，核對 bytes／SHA，設置 locator 與 `ARTDICO_CONFIRMATION_EMAIL_ENABLED=true`。
3. 重新讀取後台，確認沒有缺項且自動通知仍關閉。此時就緒只代表配置完整。
4. 先在 EmailJS 新模板的 Test 選擇 `LoginPlan`，收件人填自己可驗收的郵箱，以明確標示「設定測試，非正式報名」的合成文字核對模板及 SMTP。這不建立正式報名、不含真實私人確認連結，也不證明網站流程已啟用。
5. 完成模板收件驗收後，在後台明確勾選並保存「自动发送新公开报名的确认邮件」。儲存後即作用於新公開報名，不會等待另一個部署動作。目前同一開關也控制後台補發，關閉時不能用補發測試。
6. 由真實業務的新公開報名核對整合結果，或明確選擇實際存在、已獲授權且尚未發出的公開報名補發一次；不建立虛構正式報名。核對本站通知結果、EmailJS Email History 與實際收件匣。服務商接受不是送達證明；發生問題先關閉自動通知，結果不明者不盲目重送。

原始 39 人的意向代登記與新公開報名分開；啟用不會自動群發歷史名單。EmailJS 結果不明時先核對，不盲目重送。完整通知與回退契約見 [報名確認服務](registration-confirmation.md)。

## 本輪實際狀態

已核對原倉庫的接法、目前活動站的參數與官方說明，準備好模板及操作指引。使用者已保存模板並提供 `template_89mgpj9`；尚未讀取實際 API key、修改 FC 配置或寄信。使用者已確認 Test It 收件、寄件人與排版正常；下一步透過 FC 受控欄位（容量允許時）或加密 bundle 加入 API 設定，再核對 readiness 與明確開啟通知。SMTP／模板測試通過不等於網站寄件已啟用。
