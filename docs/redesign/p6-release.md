# P6 整合驗收與操作交接

2026-11-01，分支 `feat/redesign-p6`，產品提交 `4a07f1457bf9d99c0fc882edb03e726eeea99667`，從已發布 main `239e05f13fe8eb8b8bd3dec79dd7bd9cde167706` 接續。P6 的新增整合、1535 項完整回歸、公開快取定向、獨立審查及準確來源包核對已完成；PR CI 與實際發布仍待核對，不沿用 P5 的產物作為本輪發布證明。

## 本輪只補最後缺口

- A14：把首頁、私人頁、正式確認信、行前提醒與新 Wallet 五種產物的活動事實放進同一合成旅程核對；衝突、來源不可讀及歷史通知／票券分別驗證。
- 發布驗證：由 `scripts/verify-public-domain.mjs` 核對公開 OSS 網域全部公開物件的快取標頭，涵蓋首頁、私人靜態頁、資產及公開後台導向提示。實際 FC 後台沿用另一套 private／no-store 政策；操作文件另對應當前介面。
- 對照 A01–A23 的現有證據，保留真實收件、微信、iPhone 與同事觀察的獨立待辦。

沿用現有服務、部署、權限及簽章設定；不新增服務、依賴、SLA、負責人或排程，不操作正式名單、寄信或發布業務草稿。公開業務快照在 P5 發布後仍為修訂 43。

## A01–A23 證據對照

下表的「既有」指 [P1a](p1a-release.md)、[P1b](p1b-release.md)、[P2](p2-release.md)、[P3](p3-release.md)、[P4](p4-release.md)、[P5](p5-release.md) 已記錄的合成測試與瀏覽器證據，不表示 P6 已重新執行整張表。測試名可在 `tests/`、瀏覽器名可在 `tests/browser/` 找到；具體判準見 [驗收表](03-release-and-acceptance.md#步驟三-驗證資料及流程)。

| 編號 | 既有證據 | P6／真實條件 |
| --- | --- | --- |
| A01 | `general-application`、`p4-notification-runtime`；`application-review`、`p5-faq-application` 瀏覽器 | 合成申請／同份提案及待審回執已有證據 |
| A02 | `registration-service`、`application-draft`、`p4-notification-runtime`；P5 原生 IndexedDB 恢復 | 原正文、原鍵與只讀核對已有證據 |
| A03 | `registration-admissions`、`registration-confirmation`；`application-review` 瀏覽器 | 合成共同名額、候補、轉正與一次通知已有證據 |
| A04 | `registration-confirmation`、`p4-notifications`；提醒後台瀏覽器 | 合成失敗／接受／未知已有證據；真實收件另核對 |
| A05 | `people-operations`、`people-resolution`、`p2-next-policy`；重複核對瀏覽器 | 合成來源整合與保留待審已有證據 |
| A06 | `people-resolution`、`person-workspace`、`p4-notification-runtime` | 同信箱不自動合併、明確合併只留一席已有證據 |
| A07 | `intent-contact-import`、`people-resolution`、`p2-canonical-unknown` | 原同意、拒絕及規範來源的未知歷史已有證據 |
| A08 | `p2-health-directory`、`intent-contact-import`；`p2-person` 瀏覽器 | 原住宿／提案回答及按需展開已有證據 |
| A09 | `showcase-display-kinds`、`p1a-content-stores`；P1a／P5 集合瀏覽器 | 舊 team／缺省與凍結格式已有證據 |
| A10 | `booth-slots`、安排總覽／store／planner；`p1a-content` 瀏覽器 | 超過十五位置、稀疏及衝突已有證據 |
| A11 | `p1b-attendance-api`、`p1b-projections`、`p1b-guest-display`；P1b／P5 集合瀏覽器 | 出席證明與公開許可分離已有證據 |
| A12 | `p1b-projections`、`p1b-person-arrangements`、`p1b-guest-display` | 多人公開角色、完整日程及隱私已有證據 |
| A13 | `p1a-content-stores`、`p1b-projections`、`p1b-attendance-api` | 舊 bytes、不補寫快照及原操作核對已有證據 |
| A14 | `p1b-event-facts`、`confirmation-client`，新增 [P6 整合瀏覽器](../../tests/browser/p6-event-facts-smoke.mjs) | 本輪五種產物共 4／4 情境通過；不冒稱舊信／已存卡自動更新 |
| A15 | `registration-group-invite`、`group-invite-expiry`；P3 私人頁／群設定瀏覽器 | 合成失效／換碼已有證據；真微信保存、辨識及入群待觀察 |
| A16 | `apple-wallet`、`p1b-event-facts`；P3 裝置指引 | 合成簽章／撤回／核驗已有證據；真 iPhone 加入 Wallet 待觀察 |
| A17 | `confirmation-client`、`staff-settings-controller`；私人頁／P2 個人頁瀏覽器 | 換人、晚回應、登出與失敗清理已有證據 |
| A18 | `p4-notifications`、`p4-notification-runtime`、`application-runtime-history` | 三類通知與讀取不補寄已有證據；真實投遞另記 |
| A19 | `p5-faq-contract`、`public-registration-readiness`；`p5-faq-application` 瀏覽器 | 開放／關閉／不可讀及重新發布 FAQ 已有證據 |
| A20 | `staff-permissions`、`cloud-auth`、人員／P1b／P4 runtime 權限案例 | 權限、來源與 CSRF 先於私人 I/O 已有證據 |
| A21 | `p2-health-directory`；`p2-directory` 瀏覽器 | 唯讀、有界、來源修訂及未知不當零已有證據 |
| A22 | `p2-next-policy`、`p2-canonical-unknown`；P2 個人頁／目錄瀏覽器 | 保存事實產生建議、未知先核對已有證據 |
| A23 | P2 個人頁／目錄、重複核對及 P4 提醒瀏覽器 | 同人保存、焦點及簡短下一步已有合成證據；**真同事不讀手冊觀察待做** |

## 本輪進度

07:35:29 UTC 公開建置產生 23 頁，首頁 SHA-256 與 P5 最終建置相同。

| 檢查 | 已核對結果 |
| --- | --- |
| 完整 Node | 1535／1535，fail／cancelled／skipped／todo 均為 0，程序實際退出 0；含 2 項新增快取測試。A14 獨立整合案例不混入此數 |
| 最終來源／Astro | 693 個來源檔通過；Astro 463 檔零錯誤／警告，保留 1 項既有 hint |
| 專案 Skill 與依賴 | 契約 109、服務／客戶端旅程 107 項通過；依賴審計無已知漏洞 |
| 公開物件快取 | 7 項定向測試通過（2 項新增），獨立審查無阻塞；正式網域的實際發布核對仍待當輪結果 |
| A14 整合 | [p6-event-facts-smoke.mjs](../../tests/browser/p6-event-facts-smoke.mjs) 實際退出 0，320／390／1440px 與 390px 事實衝突共 4／4 情境，無頁面錯誤，清理完成才寫報告。沿同一合成申請及發布核對五種產物；實際編譯 Wallet 按鈕取得的 Blob 核對 CMS、manifest 與當前名額。3 封 mock 通知各一次，後續讀取／簽章／核驗無額外業務寫入或寄送，兩個 HTML 與 P5 相同 |
| 操作文件與環境說明 | 已對應現況，41 個啟用的環境值未變；未建立新設定或服務 |
| 獨立審查 | 公開快取、A14、部署文件與環境說明核對無剩餘阻塞；A14 最後證據清理調整後再跑相同 4 個情境，程序退出 0 |
| 公開產物相容 | OSS prepare 51 檔（含 release，manifest 50 筆）；50 筆公開路徑、bytes 與 SHA 均與 P5 準確 manifest 相同，僅來源回執提交不同，可沿用相同產物的 P5 瀏覽器證據。尚不代表本輪已部署 |
| 準確 FC 來源包 | `4a07f145` 的 prepare／verify 實際退出 0：127 檔（含 release）、39 個後台資產，共 7,558,358 bytes；ZIP 35,707,679 bytes，SHA-256 `b3cfb66426b3e9a6c51839ad1d6a8c42a3cf6b5915d16c83ba31991f3931dc27`。與 P5 準確包的 `release.files`、`release.assets` 兩份列表逐項完全相同，執行 payload 及資產 bytes／hash 未變，僅來源回執提交不同 |

A14 與定向分組不加總為完整 Node 測試數。最終來源／Astro 已在來源包準備時再次核對，程序均退出 0；本地公開依賴圖的大小不代替隔離 FC 包實際資產總量。

- [x] 公開 OSS 物件快取標頭的定向核對與審查。
- [x] A14 跨入口整合案例。
- [x] 本輪必要定向／完整檢查、獨立審查及準確來源包。
- [ ] PR CI、main 實際 FC／OSS 發布與 HTTPS 核驗。

PR 與正式發布完成後補實際回執；本地檢查已到齊，不重跑已通過且未受影響的瀏覽器作形式性計數。

## 操作交接只需這幾步

1. 重新載入後台，從「待处理」找人，核對目前狀態及唯一主要下一步。
2. 有新回覆就保存；原問卷或歷史需要時才展開。保存後留在同一人，結果未知先「核对结果」。
3. 需要公開或通知時，再核對預覽並明確發布，或預覽通知、選人、發送；不因程式上線重做名額、匯入或寄信。

真實收件、微信入群、iPhone Wallet 及同事觀察依 [驗收清單](03-release-and-acceptance.md#步驟四-驗證版型與實機) 分別記錄。既有 Apple／Email 設定不重建，正式素材、活動事實及群碼仍由有權限者核對。

回退沿用 [發布清單](03-release-and-acceptance.md#步驟七-回退與資料修復) 與 [備份／隔離恢復](../maintenance-backup.md)。相容版本須保留 FAQ ID、三類通知、規範來源／未知保護及原 pending 正文；程式回退不覆蓋現行名單或通知 journal。
