# Hero 海報字體與公開區域呈現交付

2026-11-02。依使用者新參考圖，Hero 採粗窄英文、實心與描邊交替及靜態字內色塊，保持紫／藍紫色系。前置的手機圈內組織、白色 Logo、全頁星空、Wallet 徽章與後台資料更正已先由 PR66／main `c5166922` 發布，本階段不代做任何正式資料操作。

## 已正式發布

[PR67](https://github.com/kunanli/artdicohost/pull/67) 已合併並發布 main **`30b4ca6d0891699093f63b9ec790621906f64391`**。[PR流程41414451982](https://github.com/kunanli/artdicohost/actions/runs/41414451982) 與 [main流程41415375940](https://github.com/kunanli/artdicohost/actions/runs/41415375940) 均 completed／success；main check、transport、FC及OSS四工作皆成功。下方3010與本地c4候選資料保留執行資格，正式結果以本節為準。

| 證據 | 準確結果 |
| --- | --- |
| 來源與首頁 | PR head57890742f624d21690259afdce8217d7dd6a9e7e，PR合成來源c3aa8052e6bb224f2bd111ddda6b832198a5c8e3；main30b4；同HTML `c4f4de59d658e3c34d87dad9b296310724991189b71b1b84db53f1524acb7c30` |
| PR／main瀏覽器 | 兩邊皆捲動6／6、排版4／4、實際素材13／13，source／captureSource與各自精確提交相符；page errors0，合成業務POST／寄信0，最低閱讀對比11.03 |
| main時間 | 捲動08:48:42.6622345、排版08:48:52.5323263、實際13於08:49:28.9133494 UTC通過 |
| 真實公開輸入 | R44，snapshot SHA `71037be9782b05af1da404fd6ab667b538fbb5e4f4356fdbec943787d241c8d7`；8原圖／7綁定原稿，raw9／有原出席證明visible3，實際名片12／單位12／職稱8／完整介紹12；其餘3個人物／作品media請求明示404替身 |
| 一般與準確包 | PR／main各1635／1635 Node，source748、Astro482（零錯誤／警告、1既有hint）、23頁、audit0；128檔／40後台資產及原資源上限維持 |
| 本地定向 | 同最終c4 HTML的reference9、首頁7、collections9、捲動6、排版4及兩支源DOM瀏覽器通過；四寬字型／空區／八圈與焦點人工查看範圍如後述 |

**08:55:04.0508832 UTC** 正式報名alias核對既有批准政策與容量；**08:55:04.0515769** `Cloud lifecycle verified` 確認來源30b4、內容及報名啟用、私有OSS acceptance通過、兩獨立client／一FC程序，run ID `r41415375940-a1-56efe4a037859b9d-30b4ca6d0891699093f63b9ec790621906f64391`。**08:55:08.7579593** 核對13個準確後台HTTPS頁；**08:55:09.8981642** 匿名公開HTTPS／CORS仍R44、計數9嘉賓／8組織／1作品／16筆保留展位投影／43場次，原出席證明confirmed3／displayed3。

**08:56:49.5000974 UTC** 已核對 `https://artdico.host` 的 **60個準確公開物件**，來源30b4相符，正式軟體交付完成。新增字型取代兩張不再使用的標題圖，最終數量以此準確清單為準，不沿用前版61。

目前正式資料仍有1筆公開作品；本輪按「沒有公開作品就隱藏」實作，未猜測或撤下該筆記錄。沒有更正真人資料、發布業務草稿、匯入名單、寄信或改名額。iPhone／微信群／收件與活動行匯出轉接不由本次視覺部署冒稱完成。此證據分支只補文件，不為文件重複部署。

## 呈現與相容

Hero 兩個原錨點及原球體保持，兩張標題 PNG 改為真正 HTML：GLOBAL 描邊、GAME JAM 實心紫色切片；ARTDiCO 實心、HOST 描邊。中文獨立使用原閱讀字體 700。頁尾只有兩行英文標語呼應，原大型 HOST 圖保留；正文、導覽、表單、嘉賓與手機組織布局不改。

字級、行高、字距及描邊顏色集中於 `home-typography.css` 的 display tokens。自託管原版 Barlow Condensed ExtraBold 800，CSS 調整度量，原 WOFF2／名稱與完整 OFL 不改。無 JS、字型 404 或不支援文字描邊時仍有真文字；forced colors 使用 CanvasText。唯一 h1 保留實際活動 accessible name，自訂公開標題顯示真實全文，刷新回原標題可還原品牌字組，失敗刷新保留最後有效內容。

星點遮罩保留新字組／中文／頁尾的原生 Text Range。FontFaceSet 的 ready、loadingdone、loadingerror 共用既有幾何失效入口；沒有新增動畫迴圈、逐幀讀全頁布局或監聽全部 style 變化。

## 字型來源

- 上游：`https://github.com/jpt/barlow`，固定提交 `dc2940e2e04ef4ec96c07e23e0f02aefbddd343b`。
- 原 WOFF2：61,692 bytes；SHA-256 `312b96f47eaba789835020d95a2d1f6b6205f38a44781b6e86d5a8256356b5ac`，Git blob `1f20fa0e6284b3f20156b66990d7470030ffb2c2`。
- 完整 OFL：4,377 bytes；SHA-256 `186d750eb496a4c17a76385f82be6aea2ac1cf2de074a811d63786cf374ea73f`；保留 Copyright 2017 The Barlow Project Authors。
- 二進位實際 OS/2 weight800、cmap526；首頁閱讀及展示字型共434,056 bytes，既有600,000上限與SC400／700獨立斷言不變。

## 前一候選驗收（未發布）

候選首頁 HTML `3010c2e1f3c144e95e7ac3a481340219c8c229d2210c6306d402d33299713d88`。本地 Node1635／1635、source748、Astro482（0錯誤／0警告、1既有hint）、23頁建置與 production audit0 已通過。reference9／9、P5首頁7／7、排版4／4同HTML通過，最低閱讀對比11.03、頁面錯誤／業務POST／寄信0。reference保留原稿與手機8圈／11筆分頁守門，四寬另驗真字型404可讀；P5含無JS、reduced motion、長介紹及原頁尾大圖。捲動6／6亦通過，含真正FontFace初始404、晚失敗及晚成功；字形Range確實改變，兩次事件後首幅遮罩涵蓋新文字，文字／球體alpha皆0，原微粒門檻與效能預算保留。四寬正常／備用字型及手機頁尾已人工看圖，長自訂標題與介紹最小距離12.06px。PR與正式發布結果在實際完成後追加；此段本身不代表已上線。

私人參會頁HTML `ac8cb7aee7af4c953ca44383f75ffbb6554a2ac5fb9cabfbad7ed771d63325d3` 與 Person HTML `bc0b71c0fa593b44fe8d3905ec7bb0310cd629336a4e66927387d8de4e10f696`，各完整11項依賴閉包對已發布c516逐bytes相同；UX2原實際請求15項亦全同。因此按明確資產資格沿用先前P3 29／P2 8／UX2 12，並非本輪重新執行或真機驗收。

## 追加的公開區域修正

HYPER3D 的同一張Logo與下方名稱不再重複呈現。所有有圖組織共用一個穩定圖框，載入中亦不擠出第二個名字；成功後僅顯示Logo，缺圖／失敗／無法安全白化時才顯示完整名稱。完整card accessible name與來源記錄保留；沒有依名稱猜合併組織或刪改後台原圖。手機未知Logo使用完整卡框，原八圈及分頁布局不改。

作品區SSG預設整段hidden；只有有效公開作品才顯示。零作品時不顯示標題、篩選器、空白舞台或「陸續公布」佔位；合法但缺封面作品仍是作品，不因缺圖刪除。已有作品、僅某分類為空時，保留分類控制及該分類空訊息。公開傳輸仍要求原envelope的showcases陣列，不為舊／壞payload放寬契約；首次失敗維持hidden，之後失敗保留最後有效資料。

刷新移除最後一件時先關閉大圖、清其圖片，整區收起；共用焦點helper轉往下一個可見區塊，後續restore亦不對hidden作品標題移焦。沒有新增listener、RAF、正式發布資料操作或通知。

新候選首頁HTML為 `c4f4de59d658e3c34d87dad9b296310724991189b71b1b84db53f1524acb7c30`。source748、Astro482與23頁建置通過；reference9、首頁7、collections9、捲動6、排版4及兩支源DOM瀏覽器皆通過，頁面錯誤0、無業務POST／寄信，私人頁／Person HTML未改。四寬normal／font404及八圈390已人工看；空區390／1440量得displaynone、高度0、可見控制0、前後區塊額外gap0。首頁新增缺欄→有效長文恢復phase曾因fixture固定Date.now未前移而timeout，保留原失敗log，僅在恢復前前移2秒滿足既有cooldown後完整7案通過，沒有加長timeout或改產品。PR／main發布回執完成後追加；前一3010候選尚未發布，不能混稱本次精確產物。

## 操作與回退

沿既有 PR、main 檢查及準確 FC／OSS／HTTPS 發布流程，分開核對捲動6案、排版4案、同份匿名公開輸入的實際素材13案，不以整體綠色替代觀測步驟成功。手機組織仍在圈內，超過8個原生分頁；不改正式公開的出席證明、報名政策、名額、通知或原圖。

視覺需回退時可回已驗證c516相容版本；若已存在資料更正journal，不能降回更舊reader／UI。活動行轉接仍待完全匿名的匯出表頭，正式一般報名入口尚未切換；真iPhone加入、微信群、收件及同事操作繼續另記。
