---
name: artdico-journey-check
description: Verify ARTDiCO HOST attendee and staff journeys with existing synthetic service tests and optional intercepted Chromium checks. Use after registration, approval, legacy integration, confirmation email, private page, WeChat group or Wallet changes; distinguish baseline regressions from pending redesign and real-device evidence.
---

# ARTDiCO HOST 合成旅程驗收

用固定合成案例核對「申請 → 審核／名額 → 通知 → 私人參會頁 → 群碼／Wallet」，以及工作人員整合舊意向、核對未知操作的流程。重用既有 Node 與 Chromium 腳本，不讀取正式名單、不實寄、不調整正式名額。

## 執行前

1. 讀取倉庫 `AGENTS.md`、`docs/redesign/README.md`、`docs/redesign/03-release-and-acceptance.md`；確認本階段修改與使用者已定決策。
2. 核對工作區與變更範圍。套件、Node 版本與測試環境沿用 `package.json` 及 `tests/browser/README.md`，不要把目前 runtime 設定、憑證或私密資料複製到測試。
3. 先分清要證明的是「既有機制未退化」或「本輪新增功能」。P1a 的兩類作品與動態展位見 [P1a 紀錄](../../../docs/redesign/p1a-release.md)，P1b 的出席投影、多人場次及新通知／票券資訊核對見 [P1b 紀錄](../../../docs/redesign/p1b-release.md)，P2 的簡約人員入口、原位保存與唯讀核對見 [P2 紀錄](../../../docs/redesign/p2-release.md)。本 runner 固定案例未完整涵蓋新需求，須另行執行相應 `p1b-*.test.mjs`、`p2-*.test.mjs` 與聚焦瀏覽器案例；P4 新申請回執／提醒正按 [P4 紀錄](../../../docs/redesign/p4-release.md) 實作，不能以基準通過宣稱完成。

## 第一層 服務與客戶端

在任何工作目錄執行：

```sh
node /absolute/repository/.agents/skills/artdico-journey-check/scripts/run-journeys.mjs
```

實際使用時將 `/absolute/repository` 換成倉庫絕對路徑。腳本從自己的位置解析倉庫，不接受任意測試檔案或 API 網址；用固定清單呼叫既有測試，子行程不繼承業務憑據與 `NODE_OPTIONS`。

| 合成案例 | 主要既有證據 |
| --- | --- |
| 新申請待審、演講提案、批准、候補、拒絕及撤回 | `tests/application-domain.test.mjs`、`tests/application-runtime-history.test.mjs` |
| 舊意向已答應、來源關聯、共同名額與通知 | `tests/people-relationships-runtime.test.mjs`、`tests/person-confirmation-runtime.test.mjs` |
| 通知結果未知、去重與讀頁不發信 | `tests/registration-confirmation.test.mjs` |
| 群碼資格、替換及過期 | `tests/registration-group-invite.test.mjs` |
| 私人連結、當前名額、換人清理與下載 | `tests/confirmation-client.test.mjs` |
| 可丟棄合成簽章、票券與撤回後核驗 | `tests/apple-wallet.test.mjs` |

測試全部通過且沒有 cancelled／skipped／todo 才顯示該層通過。失敗保留測試輸出；中斷、超時或缺檔不能算成功。

## 第二層 隔離瀏覽器

需要已安裝的 Playwright Core、Chromium，以及以正式公開設定建立的**本地**產物。先依 `tests/browser/README.md` 建置；這是本地靜態建置，不向正式 API 提交資料：

```sh
PUBLIC_API_BASE=https://api.artdico.host PUBLIC_CONTENT_API_ORIGIN=https://api.artdico.host pnpm build
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node /absolute/repository/.agents/skills/artdico-journey-check/scripts/run-journeys.mjs --browser
```

`--browser` 只執行固定瀏覽器案例；`--all` 依序執行兩層。`--list` 列出清單，`--help` 顯示命令。未指定瀏覽器參數時明確標示瀏覽器待執行；明確要求瀏覽器而缺依賴或 `dist` 時以未完成狀態結束，不安裝套件或偷偷建置。

固定瀏覽器清單：

- `tests/browser/application-review-smoke.mjs`：新簡表、待審、明確核准、候補與通知未知回執。
- `tests/browser/people-resolution-smoke.mjs`：人工重複核對、主名額、待審保留及一次確認通知。
- `tests/browser/registration-workflow-smoke.mjs`：已確認舊來源的私人入口、零額外報名／寄信與換人清理。
- `tests/browser/settings-group-runtime-smoke.mjs`：群碼真實保存回執、到期限制及未知結果保護。

P2 另依 `tests/browser/README.md` 執行 `p2-directory-smoke.mjs` 與 `p2-person-smoke.mjs`，固定清單不自動包含它們。核對先篩選再分頁、未知來源不當零、保存後同一人／焦點／位置、遺失回執只核對原結果，以及私人連結僅明確取回且不快取。合成操作不代替實際同事的短操作觀察。

P3 另執行 `p3-private-page-smoke.mjs`，並使用更新後的固定 `settings-group-runtime-smoke.mjs`；實際證據見 [P3 紀錄](../../../docs/redesign/p3-release.md)。核對群碼缺少／過期／圖片失敗、重新取得、資格變更清理、微信內裝置指引及保存備援。圖片十分鐘期限、群碼七天上限及工作人員二十四小時內到期提示是不同邊界；模擬裝置不代表真實入群或已加入 Wallet。

P4 另核對新申請已持久化後的獨立回執、提醒預覽與明確選人、各種類的去重／未知原操作及私人頁分型；實際新增案例與結果以 P4 紀錄為準。舊查詢、重放、匯入與部署不補寄，服務商接受不等於送達；不使用真實收件人驗證。

這些腳本使用合成內存 OSS／provider，並在頁面載入前攔截所有瀏覽器請求；只讀取本地 `dist`。維護清單時重新檢查請求攔截，不能換成正式站瀏覽。截圖與結果由既有腳本寫入忽略的 `.local-data/browser-evidence/`。

腳本只檢查本地產物存在及 API 標記，並記錄 HTML 摘要；它不能證明產物必然來自目前提交。產品修改後先重新建置，發布驗收另外使用準確提交的產物與 manifest。

## 最後核對與回報

對照 A01–A23，說明本輪測到哪些行為、哪些仍待實作。工作人員介面另核對：一個主要下一步、短而明確的狀態、阻塞一句原因與去向、普通保存不彈確認且留在同一人。合併／撤回／發布保留必要影響預覽，未知結果優先核對，不以減少文字掩蓋不同事實。這些介面要求須由對應瀏覽器與實際操作觀察證明，既有 Node 基準不代表已完成。

回報至少包含：

1. 工作基準／修改範圍、執行命令與實際層級。
2. 服務測試的 tests／pass／fail／cancelled／skipped／todo，失敗或未執行原因。
3. 瀏覽器腳本與 HTML 摘要、截圖位置、是否重建目前產物。
4. 本輪新增需求的證據與尚未涵蓋之處。
5. 真實 SMTP 收件、微信實際入群、iPhone 加入 Wallet、正式 FC／OSS及現場簽到的獨立驗收狀態。

合成 provider 接受不等於真實送達，顯示群碼不等於入群，下載 PKPASS 不等於加入 Wallet。真實簽章設定沿用既有紀錄，這個 Skill 不申請憑證、不改寄信設定或建立提醒排程。當本輪只執行 Node 層，應寫「服務／客戶端合成旅程通過；瀏覽器與實機尚未執行」，不可寫整體驗收完成。
