# 氣泡職稱與正式 Logo 邊界修復

2026-11-01，本輪已由 [PR #59](https://github.com/kunanli/artdicohost/pull/59) 正式發布於 main `bd49a745cd420510db9d6432bfceff6414f10ce2`。PR／main 的實際素材 13／13、1611 項測試、準確候選與 FC／OSS／HTTPS 核驗均通過；實作分支 `fix/bubbles-and-logo-bounds`、計畫 `c196690` 從 main `30e184fd` 與文件回執 `15be586` 接續。本輪來源、前兩次失敗與各項驗收範圍分開記錄，真人四項仍獨立待驗。

使用者的正式截圖暴露前輪兩個缺口：嘉賓文字出現內層捲軸、職稱太小；組織標誌把原稿白色透明素材的尺寸套用到不同的正式上傳 PNG，造成巨大白底畫布與重疊。前輪 [1593 項測試與 53 個物件的發布](home-reference-release.md) 保留為真實歷史，不當作本輪已完成，也不再以不同圖片的通過推定正式素材安全。

## 本輪行為與操作

| 項目 | 目標行為 | 保留界線 |
| --- | --- | --- |
| 嘉賓小字 | 只用已公開 `title`，缺值依序用 `ggjRole`、`company`，都沒有就留空；圓泡不再用「出席待确认」充當字幕 | 不猜職稱、不從私人聯絡資料或場次角色推斷；出席證明、名額與公開資格不變 |
| 閱讀 | 字幕桌面 17–20px、手機 14–16px；姓名與詳情不使用內層捲軸，長內容在展開區完整可讀 | 限行排版不刪原文字，原生 disclosure、鍵盤、焦點與觸控保留；最終四寬探測與實際 13 案均通過 |
| 氣泡動態 | wrapper 小幅、不同週期漂浮；hover、focus、展開、離開畫面、背景頁及 reduced motion 時停止 | 文字不旋轉，不靠動畫才顯示內容；頁面恢復與資料刷新須清理舊動態 |
| 正式 Logo | 每張圖在有寬高上限的獨立框內 contain；涵蓋白底方圖、直圖、長橫圖及透明留白 | 不把任意新上傳畫布當成舊白色素材放大；圖片失敗仍保留組織名稱與安全外連 |
| 七張設計版 | 使用者提供的設計素材須記錄來源，並綁定實際捕捉到的公開上傳 digest 後才套用 | 後台換圖導致 digest 改變時退回新上傳圖的有界顯示；不改寫 Logo ID、名稱、上傳原件或業務關聯 |

操作人員沿用原「保存 → 核對全部待發布內容 → 發布」，不用額外選素材版本、填 digest 或重做出席確認。職稱只補已有且可公開的事實；職稱缺漏不是編造文字的理由。

## 用實際素材驗證

[GHA 41313505821](https://github.com/kunanli/artdicohost/actions/runs/41313505821) 的公開素材捕捉已成功，產物 ID `13086132412` 包含已驗證公開 JSON 與七張原始 Logo。本機原生產物下載受代理限制，沒有繞過；目前不能宣稱本機已下載或檢視這份正式圖片。

先前 [GHA 41315435075](https://github.com/kunanli/artdicohost/actions/runs/41315435075) 捕捉已驗證修訂 43、9 筆 profile／7 張原始 Logo、8 筆 `title`／1 筆 `company`。最終 PR／main 再各自核對捕捉與建置來源一致，snapshot SHA-256 均為 `4b5486d90eed56ed762e40227b35866a07ec4cd451e16b32a67374d5a7ed79af`；公開數量與職稱來源計數不是出席人數。

本輪 QA 在核准的 GHA check 建置後直接使用該次捕捉的 JSON、原始 Logo 與 manifest，再以全攔截瀏覽器驗證候選產物；不得改用原稿七張白色圖取代正式圖片。捕捉須記錄來源、時間、公開修訂及 JSON／媒體 digest；瀏覽器報告須綁定建置與載入資產，實際檢查圖框、內容、解碼後的畫面、無內層捲軸、焦點與動態停止。方形／直形／長橫形等合成邊界案例另列，不能替代正式素材案例。

已通過的 13 案分為：4 個寬度的實際公開資料、4 個寬度的實際原始 Logo 通用回退、4 個寬度的合成圖片邊界，以及 1 個合成長文字案例，寬度為 320／390／1440／1920px。通用回退保留七張捕捉圖 bytes，但改用合成組織識別以驗證未知品牌路徑；profile／七張 Logo 為實際捕捉，portrait／work media 為替身（報告計數 2），不認列為這些真圖的完整覆蓋。頁面可見性以模擬 `visibilitychange` 訊號檢查真實 WAAPI，不冒稱 OS 真分頁切換。

七張設計版以已捕捉的原上傳 digest 唯讀選圖；更換 digest 時回到新原始 source 與有界框，不回寫後台資料。13 案已驗匹配／future-hash 回退；沒有專門實跑「已核准白色設計圖檔本身載入失敗」案例。前版合成 21 案有一般缺圖情境，不能冒充這項特別案例。

公開捕捉與瀏覽器步驟為日後事故診斷保留 `continue-on-error`；**本輪合併門檻仍要求兩步各自實際成功，且實際素材 browser 報告通過**。工作流整體綠燈、步驟被略過、只有 artifact 或只有本地合成通過，都不能解除這項門檻。獨立 QA 完成審查後才認列，不為讓 CI 綠燈刪除資料、失敗讀取或鍵盤保護。

`playwright-core@1.64.1` 固定在開發工具與 lockfile，由既有 CI 環境執行；不加入網站前端或 FC runtime。公開夾具與截圖僅存短期忽略目錄／GHA artifact，工作流預計保留一天，不把正式公開人名、職稱全文、JSON 或原始媒體提交進倉庫文件。這不授權讀私人來源、寄信或修改名單。

## Skill 與分工

本輪以三個產品分工與獨立 QA 平行處理字幕／排版、動態、圖片邊界和驗收；文件只整理實際證據，不代跑未授權業務。既有資料契約 Skill 繼續保護出席、私人欄位與凍結快照；新增的 [首頁視覺驗收 Skill](../../.agents/skills/artdico-visual-check/SKILL.md) 已建立，固定「使用實際素材、先解碼、核對來源與範圍」的交付流程。文件建立與已閱讀不等於實際素材 QA 已通過。

## 本輪驗證台帳

| 檢查 | 實際狀態 |
| --- | --- |
| 公開原始素材與來源 | PR／main 捕捉與 build source 各自一致；相同 snapshot `4b5486d9…`、9 profiles／7 原始 Logo，8 title＋1 company；未繞過本機下載限制 |
| 實際素材與動態／閱讀回歸 | PR／main 各獨立核對 13／13、expected13、actualFixture true、raw7／reference7／guest9／org7、頁面錯誤 0；無內捲軸、完整展開、焦點、動態停止及 digest 回退按上述範圍通過 |
| 本地字形探測與人工檢視 | 最終四寬 4／4，姓名及兩行合成字幕各 scrollHeight＝clientHeight；已人工看 1920／390。line-height 1.45 依字型 `(1160＋288)／1000＝1.448`，padding desktop18／medium6，未放寬無捲動斷言 |
| 前版三支合成瀏覽器 | collections9／reference9／attendance3 均實際退出 0，但綁前一 glyph HTML `0ddf1cfa…`；最後僅字幕 line-height／padding CSS 改動，不假標 21 案在最後 HTML 重跑。最初 WAAPI stability 逾時保留，改真 pointer／正常 scroll driver 後通過，未 pause motion 掩蓋 |
| 新視覺 Skill | 已建立；本輪 capture／actual browser／獨立報告門檻已完成，仍保留來源與範圍限制 |
| 完整 Node | 正式 main 1611 項通過、0 fail；本地早先 1611／1611 其餘狀態全 0、約 103.42 秒的 log 為 `/tmp/artdico-bubbles-node-final.log`，不混作 main 耗時 |
| 來源／Astro／建置／審計及契約 | 來源 723，Astro 478 檔零錯誤／警告、1 項既有 hint，23 頁建置；同一未變 lockfile 的依賴審計 0 漏洞，契約 109 項通過 |
| 準確候選與正式發布 | main CI 的 FC 128 檔／公開 60 檔 prepare 與邊界檢查通過；FC、私有 OSS、13 後台與 60 個公開 HTTPS 均有準確 main 回執。舊 `8d3d29c` 本地 ZIP SHA 僅屬歷史，不當作 main ZIP |

最後 PR／main HTML SHA-256 為 `25860ed5cf289c0209754128e6ca303a069f4f45286463be6b24d42dfdb60f06`；早期 `17099051…` 及前版 21 案的 `0ddf1cfa…` 證據保留，沒有冒稱同版。

## CI 與正式發布回執

前兩次實際素材結果仍保留：[41316990856](https://github.com/kunanli/artdicohost/actions/runs/41316990856) 為 0／13，1920 姓名 client110／scroll115；[41317994840](https://github.com/kunanli/artdicohost/actions/runs/41317994840) 為 1／13，1920 含 WAAPI 通過後，1440 字幕 17px／client21／scroll23 失敗。當時整體 check 綠燈不認列 acceptance。

最後 [PR CI 41318637340](https://github.com/kunanli/artdicohost/actions/runs/41318637340) 於 15:00:01.9063253 UTC 獨立核對 13／13；source＝captureSource 為 `baa67f80ab52757f9261a82e2740a43262861a7d`。正式 [main CI 41319263419](https://github.com/kunanli/artdicohost/actions/runs/41319263419) 四項工作 completed／success（[check](https://github.com/kunanli/artdicohost/actions/runs/41319263419/job/124885793633)、[FC](https://github.com/kunanli/artdicohost/actions/runs/41319263419/job/124887133460)、[OSS](https://github.com/kunanli/artdicohost/actions/runs/41319263419/job/124887993406)）；main 15:04:00.0849245 UTC 捕捉、15:06:36.0174331 UTC 實際 13／13 再獨立核對，source＝captureSource＝`bd49a745cd420510db9d6432bfceff6414f10ce2`，同上述 HTML／snapshot，兩者均 errors0、stub2。

| 正式核驗（2026-11-01 UTC） | 實際結果 |
| --- | --- |
| 15:12:00.0631426 | FC Cloud lifecycle 準確來源 `bd49a745`，content／registration 啟用，私有 OSS 驗收通過，2 個獨立客戶端／1 個 FC 程序；acceptanceRunId `r41319263419-a1-b6dd153586edb518-bd49a745cd420510db9d6432bfceff6414f10ce2` |
| 15:12:03.9397484 | 13 個準確後台 HTTPS 核對通過 |
| 15:12:04.9563770 | 匿名 HTTPS／CORS 通過；修訂 43、`publishedAt:2026-10-22T08:41:00.034Z`，公開嘉賓／組織／作品／展位／場次為 9／7／1／16／43，guestAttendance 缺省／confirmed0／displayed9，不表示九人已答應出席 |
| 15:13:47.1345609 | `artdico.host` 來源 `bd49a745` 的 60 個準確公開物件 HTTPS 通過 |

`docs/bubbles-logo-release-proof` 自已部署 main 建立，只補文件回執，不另建 PR、不重複部署。未改寫公開快照、私人資料、名額或通知，未實寄。

未新增主辦方人工流程、服務或排程；既有通知、報名、出席、私人參會頁及受控設定保留。UX2 的 [四項真人／真實資料清單](ux-workflow-release.md#人工只需記錄這幾項) 繼續獨立記錄，不以本輪素材 QA 冒稱已收件、入群或加入 Wallet。
