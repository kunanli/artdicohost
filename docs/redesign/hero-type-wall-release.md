# Hero 緊密海報字組重做

2026-11-02。使用者指出前版 Hero 沒有其 LONELY／THE REMIXES 參考圖的感覺。前版把不同詞分成實心與描邊，寬字距及兩個獨立錨點削弱了海報的連續節奏。本次重新處理 Hero 構圖，保留紫／藍紫、黑色背景、原球體及全頁星點。

## 呈現

GLOBAL 改為小字；GAME JAM、ARTDiCO HOST 各有完整同詞的實心行與輪廓複行，兩組字面左右對齊。實心字內採兩道硬邊斜切紫／淡紫色面；中文退為小副標。主字保持緊密行距，組間8px，桌面字級上限210px；手機按可用寬度縮放。移除手機舊絕對錨點留下的175px偏移及固定最小高度，活動介紹、時間、地點及操作依文字高度自然往下排列。

原版 Barlow Condensed ExtraBold 800／完整 OFL／434,056 bytes 全首頁字型預算不變，沒有新增字型依賴。Hero display tokens 集中管理，頁尾、功能正文、表單、嘉賓及組織樣式不增加效果。唯一h1保留實際活動名稱；重複視覺字組不重複讀屏，自訂發布標題仍顯示真實全文。字型404、無JS、不支援文字效果及forced colors均保留可讀文字。

新增 GLOBAL 的真 Text Range 遮罩；沿用單一ambient迴圈及字型事件失效機制，不新增動畫循環或逐幀全頁布局。球體／可讀文字區的實際星點alpha仍要求0，其他背景區可見星點、原生滑鼠微力、捲動淡入與reduced-motion守門不放寬。緊密字組後320px實測只剩5個可見星點群，低於既有6群門檻；手機候選池由24調至有界32（桌面56不變），保留16／30FPS及原canvas／DPR上限，讓被文字排除後的背景仍有足夠星點，沒有改小字體或降低可見性驗收。

## 驗收與範圍

原稿 `FrontEnd_Resource/落地页.png`（1921×19362，SHA `ff5b62dfadc80e31a6af0eb3b08d23a28e4dbfdd047c0d65f1953da2b6366485`）仍約束嘉賓、組織、分隔線及其他區域。Hero明確採使用者後給的音樂海報方向，替換舊兩錨點與CTA固定y座標，驗證正常流的字組→介紹→事實→操作順序；不宣稱整頁逐像素相同。

本地四寬320／390／1440／1920的編譯預覽已人工對照，另有獨立視覺與程式唯讀審查。測試檢查真正載入字型、完整同詞雙行、精確比例／對齊、無橫向裁切、字型404、長自訂標題及恢復；捲動六案以原生wheel逐條把七個文字目標移入canvas，驗事件後首個完成paint及真Range遮罩。兩層gradient的computed clip為`text, text`；首次沿用單層字串斷言失敗後改為嚴驗恰兩層皆text，沒有修改產品或放寬裁切／粒子門檻。

最終本地編譯HTML為 `af375d83e7d360f4bf98a6ed2a5780d90063d8d8b24d94206e0490c596e7301d`，feature head `6321230b5f551b6f3432fb2dd466987bc80f3ada`。reference9／首頁7／捲動6／排版4均退出0，同版四寬正常／字型404預覽已人工看圖；頁面錯誤、業務寫入、實寄均0。source750、Astro482（0錯誤／0警告、1既有hint）、Node1638／1638、23頁建置及audit0通過。全靜態目錄對已驗PR68產物有79個物件逐bytes相同；僅首頁HTML、CSS及其script三個物件新增／變更，舊兩個首頁hash資產退出引用。私人參會頁與Person HTML分別保持 `ac8cb7aee7af4c953ca44383f75ffbb6554a2ac5fb9cabfbad7ed771d63325d3`／`1fb97a1439067c11206c83d7709c77c78fd28eaf19c99f873920f3f02d90a094`，未冒稱重新做實機旅程。

[PR69流程41439292027](https://github.com/kunanli/artdicohost/actions/runs/41439292027)／check `125256882413` 已成功；合成merge來源 `8ceb51fee25a912e9e92bdbec7b5aafa2e591175` 的捲動6／排版4／實際素材13，source／captureSource與同HTML皆相符。匿名捕獲R44／snapshot SHA `71037be9782b05af1da404fd6ab667b538fbb5e4f4356fdbec943787d241c8d7`；8張實際原Logo、7個已綁定原稿變體；公開9位、原證明3出席／6未記錄出席，四寬36張名片／單位36／職稱32／缺職稱4／完整介紹36。未捕獲的照片／作品9條media path共42請求明示404替身，不冒稱真圖片已驗。

[PR69](https://github.com/kunanli/artdicohost/pull/69) 已合併並正式發布main **`9f5dbdcf7cc1d03e46ade5e6c7dce32f10525722`**；[main流程41440261686](https://github.com/kunanli/artdicohost/actions/runs/41440261686) 已completed／success，check `125260055507`、transport、FC `125263202765`及OSS `125264696239`四工作皆成功。main同HTML的捲動6／排版4／實際13分別於11:56:51、11:57:07、11:57:57 UTC通過，source／captureSource均為9f5，公開輸入與上列R44同一SHA。

**12:03:36.2466035 UTC** Cloud lifecycle verified核對來源9f5、內容／報名啟用、private OSS acceptance passed、兩獨立client／一FC程序；12:03:40.2006399核對13個準確後台HTTPS頁。12:03:41匿名公開HTTPS／CORS仍R44、9嘉賓／8組織／1公開作品，出席證明3／displayed9，原批准報名政策及容量維持。

**12:05:45.4691114 UTC** 核對`https://artdico.host`的**60個準確公開物件**與來源9f5一致，包含最終首頁、Barlow字型、`index.BRBwjMJW.css`及`index.astro_astro_type_script_index_0_lang.xws_8Gh1.js`，正式軟體交付完成。本證據分支僅補文件，不為文件重複部署。正式素材證據範圍仍如上列，不用合成圖片冒稱正式素材。

本輪不發布業務草稿、不改報名政策／出席證明、不刪真人資料、不匯入名單或寄信。此前PR68的公開9位嘉賓與獨立出席證明、後台唯讀歷史、手機圈內Logo及零作品隱藏均保留。若需回退，沿既有準確發布流程回到已驗證main `3bf1b6956ebbe1f14af0ac50b5b6883f569de15a`，不得降回不支援既有資料journal的reader。
