# 確認函官方 Wallet 圖標修復

2026-11-03，臺北11:11:50完成正式發布核對。原始CN／EN SVG與郵件PNG均保留；本輪沒有重繪、改色或重新上傳素材。使用者提供的確認信文字含新版短網址及舊版介紹文；它不是HTML原始內容，不能單憑貼文判定實際範本是否已輸出圖片區塊。本輪沒有保存該封信的姓名、報名編號或私人能力碼。

## 程式缺口與修正

前版將完整Wallet可用性查詢限於250ms；查詢包含活動資料、OSS簽章包讀取與憑證驗證，稍慢就仍以provider_accepted寄出缺少圖標的確認函。改為沿用原通知總期限，250ms以上且期限內的正常回覆仍附官方圖標；整體準備超時記錄rejected／DELIVERY_WINDOW_EXPIRED／transportStarted=false並返回未開始，沿既有明確重寄流程處理。遲到的狀態回覆不能繼續發信或改寫結果。明確未配置、待審資格、權限、去重、重播及未知回執規則保持原有行為。

新增3個服務回歸在舊來源重現1通過／2失敗，修正後全通過，涵蓋CN／EN350ms、明確不可用、總期限、遲到回覆、同通知重寄與操作重播。相關135項測試通過。另新增2個觀測測試；既有login／settings GET／logout三請求只多投影本來已回傳的walletReady boolean，缺欄位相容、錯型別明確失敗，憑證與設定內容不輸出；觀測10項測試通過。

## 準確來源與回執

- 基準main：`321940c4a13c5174eac4378d291dd42b6c980f3a`；[PR75](https://github.com/kunanli/artdicohost/pull/75)最終來源`085ee5f380ba58b5d9dc86a550bd72e089d3b9f5`，PR測試合併來源`a887bfeb772557d200c2796f720089d91c29f1b3`；run41568255603／check125694982253成功。前一候選94e143的回歸不冒充最終來源。
- 正式main：**`ae5cee86270b3de5875a4bdba1024957d99ada69`**；[run41569299507](https://github.com/kunanli/artdicohost/actions/runs/41569299507)五工作completed／success。
- check125698217124：795來源掃描；Astro516檔、0error／0warning／2hint；1814測試全通過，fail／cancelled／skipped／todo皆0，套件審計0已知漏洞。
- 十份同來源瀏覽器回執共67案（6／4／10／8／8／6／2／6／4／13），各自綁正式main，頁面錯誤0。首頁SHA仍為`fdc57538b5e2be588e19db835c4ea79cdd3d11dbea940521129560cf8f17d302`；實際素材R44與300漢字／字體檢查、空白／缺字0的回執保留。郵件範本SHA仍為`551b4687af3d859a61b5a44bca1619dd7eef24dbded2ba89d24b477df9c86b7a`。
- 137檔精確候選、42資產，離線無網路／唯讀code的兩模式啟動通過，14.7秒；不拿離線結果冒充私有OSS。
- FC job125701013003：臺北11:09:54來源、content／registration啟用、私有OSS passed、2客戶端／1FC程序；11:10:00取得14後台精確HTTPS回執。
- **11:09:56正式設定觀測：walletReady=true、automaticEnabled=true、email.enabled／ready=true，missing／invalid空。mailRequests=0、businessWrites=0；CONFIGURED_PROVIDER_NOT_DELIVERY_PROOF仍不代表本輪實寄或收件。**
- OSS job125702180992：11:11:48核對68公開HTTPS物件；11:11:50短網址／無效入場路徑／CORS三請求回執全部verified，commit為正式main。兩個獨立只讀觀測工作125698216996／125698217212也成功。

## EmailJS 圖片區塊仍需在實際範本接上

後端提供圖標HTML不會自行修改EmailJS託管Content。在報名確認信專用範本的HTML正文，於`{{invitation_text}}`下方加入：

```html
{{{confirmation_actions}}}
```

三層括號輸出受限制的原HTML，包含已就緒官方Wallet圖標、入場QR及有效入群QR；個人文字仍用雙括號跳脫。也可直接套用[完整範本](../templates/emailjs-registration-confirmation.html)，Subject為`{{email_subject}}`。實際控制台範本尚未由本工具讀寫，不宣稱已套用；保存後須明確重寄核對，已收到的舊信不會改變。原始圖標網址見[設定說明](../emailjs-registration-setup.md)。

本輪不實寄、不更改正式人物或名額、不實際核銷入場；真實郵件圖片、iPhone加入及微信入群仍與程式／設定回執分開驗收。
