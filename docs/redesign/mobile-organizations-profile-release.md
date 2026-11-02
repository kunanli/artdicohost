# 手機圈內組織與報名更正整合交付

2026-11-02。使用者追加手機所有組織留在圈內，並要求先完成既有工作，再做Hero海報字體。本階段合併已分別驗證的前台與後台修正，使用同一準確版本完成驗收及發布；不省略任一部分的來源、瀏覽器或雲端檢查。

## 正式交付完成

已由 [PR66](https://github.com/kunanli/artdicohost/pull/66) 發布main **`c516692245b23e59387b71d73ff1c0911f32fce5`**。[PR流程41401348141](https://github.com/kunanli/artdicohost/actions/runs/41401348141) 與 [main流程41402494805](https://github.com/kunanli/artdicohost/actions/runs/41402494805) 均completed／success；main的check、transport、FC與OSS四工作皆成功。以下候選與首次失敗保留歷史，現況以本節為準。

| 證據 | 準確結果 |
| --- | --- |
| PR／main首頁 | 同HTML `006d2635785c69c50f1323e33fbe3aef4dee3f029d20ed0c5fb8258922812d50`；PR合成來源b70edc0128b319fd3e98ef235f91b0f3052919be，main來源c516692245b23e59387b71d73ff1c0911f32fce5 |
| 三份獨立瀏覽器 | 兩邊皆捲動6／6、排版4／4、實際素材13／13，page errors／業務POST／寄信0；main時間06:54:38、06:54:50、06:55:33 UTC，最低閱讀對比11.03 |
| 實際公開輸入 | R44／SHA `71037be9782b05af1da404fd6ab667b538fbb5e4f4356fdbec943787d241c8d7`，8張原圖529471bytes、7款綁定白色原稿；raw9／原證明顯示3、四寬實際名片12、單位12／職稱8／完整介紹12，未捕獲人物／作品media3請求用明示404替身 |
| 私人與工作頁 | 新ac8私人頁29／29；Person bc0b與完整資產逐bytes沿用P2 8／UX2 12；沒有把合成證據稱真收件、真iPhone或真人操作 |
| 原稿／手機 | reference9／組織7退出0；320／390真viewport合成8圖人工查看，整個圓及八卡可見；已驗11筆分頁、hash、鍵盤、刷新，實際上傳8圖的圓周與邊界另由CI13案核對 |
| 一般與準確包 | Node1634全過，source745，Astro482／0error／0warning／1既有hint，23頁、audit0；準確128檔／40資產及兩種ZIP受限離線啟動保持既有上限 |

07:01:36.9612502 UTC正式報名alias核對批准政策／容量；07:01:36.9620487 UTC `Cloud lifecycle verified`確認來源c516、內容／報名啟用，私有OSS acceptance通過，兩獨立client／一FC程序，run ID `r41402494805-a1-361b219aa80b37e1-c516692245b23e59387b71d73ff1c0911f32fce5`。07:01:41.8044579核對13個準確後台HTTPS頁；07:01:42.9506183匿名公開HTTPS／CORS仍R44、公開計數9／8／1／16／43、原證明confirmed3／displayed3。

**07:03:49.3808629 UTC核對 `https://artdico.host` 的61個準確公開物件，來源c516相符，軟體正式交付完成。** 正式資料更正、匯入、寄信、名額／出席操作與內容草稿發布均未代做。c516是新profile journal的最低相容reader／UI；之後若已有修正資料，不能回退到更舊reader。Hero海報字體接續另開階段，不把此版先稱有新字體。

## 歷史候選與首次未發布

[PR65](https://github.com/kunanli/artdicohost/pull/65) 已合併為main `532d99ad813e585b2033b016226fb0fbb6615ca7`，但[首次main流程41396638122](https://github.com/kunanli/artdicohost/actions/runs/41396638122) 在捲動六案的滑鼠觀測失敗，FC／OSS部署皆略過；不能稱532版本已上線。該次失敗時最後已驗發布基準為`50bc3cd`。PR的6／4／實際13成功與main失敗分開保留，詳見[前台紀錄](space-wallet-organizations-release.md)。

失敗的550.8ms觀測把進入文字遮罩而消失的原微粒，錯配到159px外另一點。觀測器改以真canvas座標、原生mask安全距、唯一radius與逐實paint近距軌跡確認同一點；缺失不換點。原額外位移`>1.5px`且`<20px`門檻保持，未改產品力道、速度或seed。observer-only建置仍為b239首頁，獨立6／6及四個身份追蹤資料回歸通過；合併後另取新建置資格。

## 手機組織圓形

手機使用正圓與當頁專用座標；目前八個採1–2–2–2–1，完整卡片／圖片四角留在圓周內，不用裁切掩蓋溢出。所有可點框至少44px，圖片保比例contain、原檔不改、前台白色處理保留。單列及雙列依圓弧可用寬度調整，桌面仍用原稿七款位置及額外組織布局。

超過一頁時保留所有來源節點與穩定ID，使用原生前後頁及簡短頁碼，單頁不顯示控制列；沒有自訂觸控劫持。hash可揭開所在頁，刷新保留當頁及可證明的焦點。無圖／複雜底保留16px名稱與完整ARIA，無內層捲動。功能字級沿既有CSS token。

數學先驗涵蓋D280／342及1–8個配置的72個slot，最小圓周安全距4.438px；這只代表座標計算，實際CSS、字型、圖片與互動另由320／390／1440／1920編譯頁核對。reference9、組織7與實際13保持原案例總數，追加真圓周、11筆分頁、hash／鍵盤／刷新檢查。

## 報名資料更正

整合原獨立提交a007的兩個提交，前台及後台檔案不衝突。工作人員在「联络资料 → 编辑 → 保存」修正七欄，留在同一人／位置，原問卷及歷史保留。Email修正使舊私人能力／群圖grant／Wallet線上資格失效，當前與原地址寄送歷史分開，保存不重寄、不改名額；[完整操作及回退限制](registration-corrections-release.md)。第一次更正後不得降回不理解新journal欄位的舊reader／UI。

整合root已1634／1634 Node、source744、Astro482零錯誤／警告（1既有hint）、23頁。原P2 8／UX2 12的Person HTML、完整請求資產與後端／shared／config／fixture逐bytes一致，按明確閉包沿用；原P2未保存獨立asset manifest的缺口及補核對範圍詳見對應紀錄。

新版私人頁ac8的完整P3已另跑29／29、退出0、page errors0，官方SVG原bytes保持；已人工查看Safari／忙碌／缺圖／手機確認頁。不是拿原7ad頁面的29案冒充新版，也不代表真iPhone已加入。全程攔截合成，無正式資料更正、實寄、名額操作或群碼更新。

## 整合驗收與發布

產品凍結後單次建置，記錄新首頁／私人頁／Person及請求資產SHA；按實際差異核對Node、source、Astro、reference9／組織7／捲動6／排版4，正式CI再匿名捕獲最新快照驗實際13。PR及main分別確認同來源／HTML與完整報告；main最後核對準確128檔包／40資產等既有上限、私有OSS、13後台頁及公開物件HTTPS，不以CI綠色代替觀測步驟通過。

軟體交付完成後才進入[Hero字體接續](../implementation-plan.md)。活動行匯出轉接仍待匿名表頭，正式入口／審核政策未切換；iPhone／微信、實際收件及同事操作維持獨立紀錄。
