# 本站報名自動取得入場名額

2026-11-02。使用者確認採「直接在本站填表，自動取得入場券」，取代活動行作唯一正式一般報名入口的早先決策。本站保持主要入口；活動行既有資料不由此次部署匯入、撤回或修改。

先前本站提交仍強制pending_review，畫面亦硬寫人工審核；自動寄送確認信設定只控制通知，不能替代名額分配。本輪同時調整新公開報名的政策、原有容量帳本及前端說明，避免文案與實際回執不一致。

新公開報名僅在後端明確設定`attendeeReviewRequired:false`時直接按共同容量確認或候補；缺省／舊政策保留人工流程。沿用原v3帳本與同一CAS，不在提交後另加核准操作。新報名的主題分享仍是獨立提案，沒有自動發布講者、展位或場次。現有待審記錄不因讀取、重播或部署而自動批准；原正文、冪等鍵、同意版本、通知去重及資料歷史保留。

已確認的新公開報名提供既有私人參會入口，Email及Wallet各依現有設定與資格；候補不顯示已獲入場券。新操作觸發的候補轉正沿原規則通知，GET與重播不補寄。所有服務／瀏覽器驗收使用合成資料與隔離provider，不實寄或提交正式報名。

表單與首頁、Q&A依已驗證的後端模式顯示一般報名、結果與參會通知文案；未知／未開放不顯示假成功。分享checkbox在新空白表單不勾；使用者主動選演講入口或恢復自己草稿仍保留意圖，已提交且結果未知的草稿必須保留完整原文並只核對原結果。

本輪來源、實際測試／編譯／PR／main及正式HTTPS與政策核對回執在完成後追加。回退時須保留已寫v3名額事實與通知journal，不將既有confirmed降成pending；按既有準確FC／OSS流程部署相容reader，必要的正式政策變更另記。此次部署不回填舊名單、不批次寄信或改動活動行頁面。

## 已執行的候選與PR證據

候選head `5f1a06c636e21071a68029ecb2157e6478379b1d`／首頁HTML `8e638b1404dfc1bad2d83af17fc1533e5ad05090c92b426ade4c008f7b7c0019`。後端core63、部署52、通知與history66合計181案；資料契約persistence22及服務／客戶端旅程124案皆通過。涵蓋最後名額並發、crew預留、候補先後、既有pending／rejected不遷移、原鍵失ACK後過期／關閉／政策切換、proposal獨立、通知created-only／未知不重寄及共同5秒預算。

新增required CI瀏覽器10案使用真隔離runtime／CAS、IndexedDB及私人票券頁，四寬新表單不預勾、主動分享與editing恢復、manual／缺flag／錯型fallback、真滿額候補、舊manual未知ACK後換新政策／同意版本仍僅重播原body／key；不是用stub admission冒充出票。最終同HTML本機及[PR70流程41456809734](https://github.com/kunanli/artdicohost/actions/runs/41456809734)均10／10、errors0、真實業務寫入／寄信／網路0。私人頁29保護歷史名額、通知分型、Wallet／群碼及換人；不是實際收件或iPhone加入驗收。

CI合成來源 `c2d44dad5502e21fbb19a2d030bbbd2671a719ce` 的1661 Node、source755、Astro485、23頁、audit0及同版6／4／10／實際13全部通過。雲端acceptance仍10stage／1000 requests／90s、兩client／一FC與四筆合成人員；去除重複全量讀取後，下一受保護listing仍實讀全部四筆，特殊窗口999 requests，沒有放寬原上限。

PR70已合併並正式發布main **`124180a0dc862d4e93cf79c5a3cf1c9278c83991`**；[main流程41458276411](https://github.com/kunanli/artdicohost/actions/runs/41458276411)四工作completed／success，main同HTML的6／4／10／實際13、1661 Node均已核對。

**14:13:00.0937700 UTC** cloud lifecycle核對來源124180、private OSS acceptance passed、兩client／一FC；14:13:04.0843368核對13個準確後台HTTPS頁。**14:13:06.1752611 UTC**匿名報名GET／OPTIONS回執為`verified:true, enabled:true, attendeeReviewRequired:false`，token／submit兩個preflight通過；lifecycle亦完整核對與批准政策及容量相符。這是正式後端已啟用新模式的證據；不是用合成metadata或部署前的舊true模式冒稱完成。

**14:14:45.8060159 UTC** 已核對`https://artdico.host`的60個準確公開物件與來源124180，網站與後端皆交付完成。公開內容仍R44／9嘉賓／8組織／1作品，原出席證明3／前台9；沒有發布業務草稿、回填舊名單或實寄。既有寄信故障與排序是後續獨立階段，這次合成確認信驗證不代表真實EmailJS送達。證據分支只補文件，不重複部署。
