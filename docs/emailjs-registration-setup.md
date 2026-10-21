# support@artdico.co 報名確認信設定

2026-10-21。根據使用者提供的 EmailJS 畫面，已有 Service `LoginPlan`，SMTP `smtp.feishu.cn`／465／SSL，帳號 `support@artdico.co`。這證明已有設定，尚不代表本次活動已寄信或收件成功。

只讀核對 `kunanli/artdico-deck` 的 `backend/lib/email-fallback.js`：使用相同服務，以服務端 REST 傳送；另有歡迎及通知模板。可沿用同一個 EmailJS SMTP 服務，新增活動專用模板，保留 Deck 原模板與設定。Deck 的 `message`／`subject` 參數與此專案的 `invitation_text` 不同。

## EmailJS 控制台

1. 在 Email Services 保留 `LoginPlan` 服務 ID、SMTP、SSL、帳號及 App Password。SMTP 密碼只留在 EmailJS，不放入活動站設定。此時不需要重新按 Update Service；畫面勾選的 Send test email 會發信，僅在要核驗服務時自行執行。
2. 在 Email Templates 新建一份活動確認模板。可命名「ARTDiCO HOST 报名确认」，Template ID 建議 `host_registration_confirmation`；若控制台產生不同 ID，以實際保存的 ID 為準。
3. 欄位如下。From Email 可保留使用服務預設地址，核對實際為 `support@artdico.co`；或在允許指定時固定填此地址。

| 欄位 | 值 |
| --- | --- |
| To Email | `{{to_email}}` |
| From Name | `ARTDiCO HOST` |
| From Email | `support@artdico.co`，或核實相同的服務預設地址 |
| Reply-To | `support@artdico.co` |
| Subject | `{{event_title}}｜报名状态通知` |
| CC／BCC | 留空 |

4. Content 的 HTML 原始碼使用 [可貼上的模板](templates/emailjs-registration-confirmation.html)。正文以 **`{{invitation_text}}`** 為主，保留雙大括號的 escaping。它已包含姓名、確認／候補狀態、活動事實、報名編號與私人確認／列印連結。不要改成 Deck 的 `{{message}}`，也不要固定寫「所有人報名成功」，避免候補被誤認為已取得名額。
5. 這份模板由活動後端明確呼叫一次；不再串接 EmailJS 的額外 Auto-Reply 模板，以免一份報名收到重複通知。沒有新增附件或付費需求。
6. 在 Account 找到現有 Public Key／Private Key；依帳戶目前 Security 設定核對服務端 API 的授權。活動後端會傳 `accessToken`，目前程式要求兩種 key 都存在。不要因新增此站而輪替 Deck 共用 key，或直接改變可能影響原站的帳戶級限制。

官方參考：[模板欄位](https://www.emailjs.com/docs/tutorial/creating-email-template/)、[動態變數](https://www.emailjs.com/docs/user-guide/dynamic-variables-templates/)、[REST send](https://www.emailjs.com/docs/rest-api/send/)、[Public／Private Key](https://www.emailjs.com/docs/sdk/options/)。控制台 UI 以目前帳戶實際顯示為準。

## 活動站受控設定

目前確認信使用獨立 `EMAILJS_CONFIRMATION_TEMPLATE_ID`。SMTP App Password 不在這份設定；受控 JSON 只需六欄：

```json
{
  "EMAILJS_SERVICE_ID": "LoginPlan",
  "EMAILJS_CONFIRMATION_TEMPLATE_ID": "REPLACE_WITH_SAVED_TEMPLATE_ID",
  "EMAILJS_PUBLIC_KEY": "REPLACE_IN_PROTECTED_FILE",
  "EMAILJS_PRIVATE_KEY": "REPLACE_IN_PROTECTED_FILE",
  "EMAIL_FROM_ADDRESS": "support@artdico.co",
  "EMAIL_FROM_NAME": "ARTDiCO HOST"
}
```

上例只有佔位值，不能直接啟用。實際 key 在受控機器的 0600 私密檔案提供，不貼聊天、不寫進 Git／`PUBLIC_` 或一般網頁表單。本機 `.env.local` 不會同步到正式 FC；Deck 的 GitHub Secrets 也不會自動成為此站設定。

由既有運維依 [加密配置流程](delivery-configuration.md)使用現有報名簽章秘密產生 bundle，上傳同一私有桶的不可變物件；FC 只增加 `ARTDICO_CONFIRMATION_EMAIL_BUNDLE_ID` 和明確寄件開關。現有 FC 環境總量上限 4096 bytes，保留其餘環境、角色與正式資料；不用將多個 key 直接塞進既有環境。

啟用順序：

1. 在[報名後台](https://api.artdico.host/admin/registrations/)的「报名确认与票券」先取消自動確認信並保存。
2. 準備／上傳加密 bundle，核對 bytes／SHA，設置 locator 與 `ARTDICO_CONFIRMATION_EMAIL_ENABLED=true`。
3. 重新讀取後台，確認沒有缺項且自動通知仍關閉。此時就緒只代表配置完整。
4. 先在 EmailJS 新模板的 Test 選擇 `LoginPlan`，收件人填自己可驗收的郵箱，以明確標示「設定測試，非正式報名」的合成文字核對模板及 SMTP。這不建立正式報名、不含真實私人確認連結，也不證明網站流程已啟用。
5. 完成模板收件驗收後，在後台明確勾選並保存「自动发送新公开报名的确认邮件」。儲存後即作用於新公開報名，不會等待另一個部署動作。目前同一開關也控制後台補發，關閉時不能用補發測試。
6. 由真實業務的新公開報名核對整合結果，或明確選擇實際存在、已獲授權且尚未發出的公開報名補發一次；不建立虛構正式報名。核對本站通知結果、EmailJS Email History 與實際收件匣。服務商接受不是送達證明；發生問題先關閉自動通知，結果不明者不盲目重送。

原始 39 人的意向代登記與新公開報名分開；啟用不會自動群發歷史名單。EmailJS 結果不明時先核對，不盲目重送。完整通知與回退契約見 [報名確認服務](registration-confirmation.md)。

## 本輪實際狀態

已核對原倉庫的接法、目前活動站的參數與官方說明，準備好模板及操作指引。尚未在使用者的 EmailJS 控制台建立模板、讀取實際 API key、修改 FC 配置或寄信。下一步是保存新模板並取得實際 Template ID（此 ID 不是密鑰），再由受控配置接上並驗收。
