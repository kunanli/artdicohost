# Hero 海報字體交付

2026-11-02。依使用者新參考圖，Hero 採粗窄英文、實心與描邊交替及靜態字內色塊，保持紫／藍紫色系。前置的手機圈內組織、白色 Logo、全頁星空、Wallet 徽章與後台資料更正已先由 PR66／main `c5166922` 發布，本階段不代做任何正式資料操作。

## 呈現與相容

Hero 兩個原錨點及原球體保持，兩張標題 PNG 改為真正 HTML：GLOBAL 描邊、GAME JAM 實心紫色切片；ARTDiCO 實心、HOST 描邊。中文獨立使用原閱讀字體 700。頁尾只有兩行英文標語呼應，原大型 HOST 圖保留；正文、導覽、表單、嘉賓與手機組織布局不改。

字級、行高、字距及描邊顏色集中於 `home-typography.css` 的 display tokens。自託管原版 Barlow Condensed ExtraBold 800，CSS 調整度量，原 WOFF2／名稱與完整 OFL 不改。無 JS、字型 404 或不支援文字描邊時仍有真文字；forced colors 使用 CanvasText。唯一 h1 保留實際活動 accessible name，自訂公開標題顯示真實全文，刷新回原標題可還原品牌字組，失敗刷新保留最後有效內容。

星點遮罩保留新字組／中文／頁尾的原生 Text Range。FontFaceSet 的 ready、loadingdone、loadingerror 共用既有幾何失效入口；沒有新增動畫迴圈、逐幀讀全頁布局或監聽全部 style 變化。

## 字型來源

- 上游：`https://github.com/jpt/barlow`，固定提交 `dc2940e2e04ef4ec96c07e23e0f02aefbddd343b`。
- 原 WOFF2：61,692 bytes；SHA-256 `312b96f47eaba789835020d95a2d1f6b6205f38a44781b6e86d5a8256356b5ac`，Git blob `1f20fa0e6284b3f20156b66990d7470030ffb2c2`。
- 完整 OFL：4,377 bytes；SHA-256 `186d750eb496a4c17a76385f82be6aea2ac1cf2de074a811d63786cf374ea73f`；保留 Copyright 2017 The Barlow Project Authors。
- 二進位實際 OS/2 weight800、cmap526；首頁閱讀及展示字型共434,056 bytes，既有600,000上限與SC400／700獨立斷言不變。

## 候選驗收

候選首頁 HTML `3010c2e1f3c144e95e7ac3a481340219c8c229d2210c6306d402d33299713d88`。本地 Node1635／1635、source748、Astro482（0錯誤／0警告、1既有hint）、23頁建置與 production audit0 已通過。reference9／9、P5首頁7／7、排版4／4同HTML通過，最低閱讀對比11.03、頁面錯誤／業務POST／寄信0。reference保留原稿與手機8圈／11筆分頁守門，四寬另驗真字型404可讀；P5含無JS、reduced motion、長介紹及原頁尾大圖。捲動6／6亦通過，含真正FontFace初始404、晚失敗及晚成功；字形Range確實改變，兩次事件後首幅遮罩涵蓋新文字，文字／球體alpha皆0，原微粒門檻與效能預算保留。四寬正常／備用字型及手機頁尾已人工看圖，長自訂標題與介紹最小距離12.06px。PR與正式發布結果在實際完成後追加；此段本身不代表已上線。

私人參會頁HTML `ac8cb7aee7af4c953ca44383f75ffbb6554a2ac5fb9cabfbad7ed771d63325d3` 與 Person HTML `bc0b71c0fa593b44fe8d3905ec7bb0310cd629336a4e66927387d8de4e10f696`，各完整11項依賴閉包對已發布c516逐bytes相同；UX2原實際請求15項亦全同。因此按明確資產資格沿用先前P3 29／P2 8／UX2 12，並非本輪重新執行或真機驗收。

## 操作與回退

沿既有 PR、main 檢查及準確 FC／OSS／HTTPS 發布流程，分開核對捲動6案、排版4案、同份匿名公開輸入的實際素材13案，不以整體綠色替代觀測步驟成功。手機組織仍在圈內，超過8個原生分頁；不改正式公開的出席證明、報名政策、名額、通知或原圖。

視覺需回退時可回已驗證c516相容版本；若已存在資料更正journal，不能降回更舊reader／UI。活動行轉接仍待完全匿名的匯出表頭，正式一般報名入口尚未切換；真iPhone加入、微信群、收件及同事操作繼續另記。
