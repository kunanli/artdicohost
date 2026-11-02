# 報名資料原位更正

2026-11-02。使用者要求工作人員能手動修正填錯的報名資訊，操作保持簡約。從前台PR65的main `532d99ad813e585b2033b016226fb0fbb6615ca7` 接續，整合獨立提交 `a007673213671fdbf383b290d20e41708d1a0524`；本地整合為 `1aee4ce7750b33515d82aec57ff8fd0250f3b982`。已由 [PR66整合版](mobile-organizations-profile-release.md) 正式發布main c516，精確main／FC／OSS／HTTPS回執見該頁；沒有代改任何正式人員資料。

## 工作人員只需這樣做

1. 在「人员与报名」找人，開啟「联络资料 → 编辑」。
2. 修正姓名、Email、機構／團隊、職務、城市、微信或電話，按「保存」。完成後留在同一人及位置；原問卷與歷史不覆寫。
3. 更正Email後，按目前頁面的「核对通知」核對新收件人，確實有需要才明確寄信；保存本身不重寄、不調整名額。

一般保存不彈確認。回執不明時只核對原操作；只有能證明原操作尚未寫入，才提供原正文重試。另有人修改或主報名已改變時保留待處理資訊及核對入口，不把兩個人的變更混在一起。

## 資料、權限與相容

原始報名記錄／來源／同意／hash保持不可變，修正寫入既有review journal的可驗證欄位與審計，列表、單人頁、匯出、私人頁及後續通知共用當前投影。主報名可更正；次來源提供主報名入口，不能暗中轉寫另一記錄。修改只允許既有reviewer／superadmin，保留Origin、CSRF、修訂及操作回執邊界。

Email更正提升該人的存取修訂，使舊私人能力連結、入群圖片grant及Wallet線上核驗失效；不使用「撤回再核准」處理，不改名額或出席。合併後以全部來源的修訂總和防止舊能力因換主記錄而復活。既有撤回查詢仍可返回空姓名的withdrawn狀態，不宣稱所有次來源token必定404；不再提供有效資料／群碼／Wallet。

舊寄送紀錄完整保留，新地址的當前寄送狀態獨立；「原邮箱」歷史不誤標成新地址已寄。未知歷史不解鎖重寄，單人及批次操作綁當時的收件人修訂，晚到的舊provider回執只回寫原紀錄。不會收回已被看到的群碼、已下載的pass或已送出的郵件；後續線上存取及新寄送遵守當前修訂。

新增欄位仍由相容reader讀取，legacy c1 rev0 bytes及舊pending正文保持可讀。**第一次修正／新scope通知寫入後，回退只能使用理解新欄位的本版或更新reader及相容UI，不能降回舊嚴格reader或清除journal。** 先完成兩端部署才執行真人更正。加密備份、隔離恢復、刪除維護及其權限沿現有流程，見[工作區說明](../unified-people-workspace.md)。

## 已有合成證據

獨立工作樹最後1634／1634 Node測試，無failed／cancelled／skipped／todo；contract runner110、journey runner116通過。source740；Astro482／0 error／0 warning／1既有hint；23頁建置。P2 8／8、UX2 12／12、頁面錯誤0：320／390／1440七欄原位保存、原問卷／名額不變、normalize回原值不POST、首次明確409保稿、真正失ACK只GET、404原正文重播、換人清理，以及新地址未寄／原地址歷史分離均通過。只有攔截的合成provider，沒有實寄。

Person HTML為 `bc0b71c0fa593b44fe8d3905ec7bb0310cd629336a4e66927387d8de4e10f696`，凍結產品指紋 `bbf4b6e5071b1a765a6f3fa9540b5913d614222848cadffceed8fce337cea2f9`；整合後按實際HTML及請求資產逐bytes核對資格，不直接冒稱獨立樹就是新main。首次harness未允許新profile PATCH、既有收件人文字前綴不符的失敗保留，最終只調整精確合成路由／斷言，未放寬安全條件。

隔離runtime另驗過A1+B0換primary、A1+B1、再次改Email、舊c1／group grant／Wallet核驗、late provider ACK、當前與原始XLSX及備份恢復。cloud acceptance原1000-request硬上限保持；重用已驗證snapshot以移除重複IO，圖片後及Wallet發出前仍有fresh guard。選擇器本地128檔／40資產／7,604,312bytes，單檔最大1,661,625bytes；不放寬2MiB／8MiB／ZIP／CodeJSON限制，準確包仍待整合CI核驗。

## 整合後核對

05:57:36 UTC root建置23頁、source744、Astro482／0error／0warning／1既有hint、完整Node1634／1634再次通過，其餘狀態全0。Person HTML仍為`bc0b71c0…`；獨立QA逐項核對原UX2實際請求15項（13資產＋2HTML），全部bytes／SHA相同。P2原報告沒有獨立asset manifest，另核對Person完整11項依賴且皆被UX2實際清單涵蓋、沒有dynamic import；functions80／shared18／config4／helpers3也逐bytes相同。因此按這個範圍沿用P2 8及UX2 12，不假稱重跑新瀏覽器。

新版首頁HTML為`7d7711ce8a520fcd306c8ba89cdad378ad67387abe8908b11de822802c8fcef8`；私人頁HTML因共享編譯資產變為`ac8cb7aee7af4c953ca44383f75ffbb6554a2ac5fb9cabfbad7ed771d63325d3`，不沿用原`7ad…`的29案同版資格，將另外執行私人頁回歸。官方中文SVG仍原bytes不變。

## 正式交付

整合後執行準確來源／Astro／Node／建置與必要瀏覽器核對，PR及main另驗首頁6／4／實際13、準確FC包、私有OSS、13後台頁與公開物件HTTPS。正式資料更正、Email實收、iPhone添加、微信入群及同事操作觀察獨立記錄，程式部署不代做這些業務操作。
