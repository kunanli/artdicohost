# Hero完整品牌與單次標題

2026-11-02。使用者指出重複實心／描邊字牆太亂，並要求GlobalGameJam保持在一起。本輪以新要求取代前版複行呈現：`GlobalGameJam`與`ARTDiCO HOST`各只出現一次、各自保持完整單行，移除獨立GLOBAL及輪廓複行。兩個中文副標保留，拉開品牌間距；僅第一個標題留一道淡紫色斜切，第二個維持純紫。

延用原版Barlow800／OFL、原紫色系、球體與單一星空迴圈；沒有新增字型、依賴或業務寫入。字型角色仍集中於`home-typography.css`，兩品牌共用字級：桌面clamp(64px,9vw,172px)，手機依可用寬度縮放。字形不再橫向加寬；手機文字、事實與操作保持自然流，不以圖片或裁切取得表面效果。

唯一h1保留真實活動accessible name；裝飾字組不重複讀屏，自訂發布名稱、失敗刷新、字型404、無JS及forced colors降級保留。移除overline的過時Range selector，標題與副標四個真文字目標繼續以原生Range遮罩和真字型error／done驗證；所有粒子可見性、球體／文字alpha0、FPS與滑鼠守門不放寬。頁尾沿用前版，非Hero幾何、公開嘉賓／獨立出席證明、Logo與零作品隱藏不改。

設計基準仍為原1921×19362 PNG，SHA `ff5b62dfadc80e31a6af0eb3b08d23a28e4dbfdd047c0d65f1953da2b6366485`；Hero按這次明確單次標題要求驗收，其他原稿守門不變。320／390／1440／1920編譯預覽先人工看圖，再凍結建置跑reference9／首頁7／捲動6／排版4與CI同份匿名公開素材13案；合成資料與未捕獲媒體明確分開，不冒稱真機或正式照片驗收。

本地、PR／main及正式HTTPS的準確來源與回執在實際完成後補記；原型圖不表示已上線。回退沿既有準確FC／OSS流程回到已驗PR69 main `9f5dbdcf7cc1d03e46ade5e6c7dce32f10525722`，不改名額、通知、原始資料或發布業務草稿。

## 最終候選與PR驗收

候選head `5f1a06c636e21071a68029ecb2157e6478379b1d`、首頁HTML `8e638b1404dfc1bad2d83af17fc1533e5ad05090c92b426ade4c008f7b7c0019`。第一候選的1440px字型Range上緣75.4375px貼近76px置頂header，無法由原生wheel完整移入canvas；產品桌面加4px上留白，手機28px保持，沒有放寬遮罩或粒子守門。最終四寬reference9／首頁7／捲動6／排版4／Q&A12及真runtime報名10均通過，page errors0；四寬預覽及最終自動模式表單／Hero已人工看圖。私人頁29在相同私人HTML及完整依賴閉包通過；留白修正僅變更首頁HTML／CSS。

[PR70](https://github.com/kunanli/artdicohost/pull/70)／[流程41456809734](https://github.com/kunanli/artdicohost/actions/runs/41456809734) check `125315522938` 成功。合成來源 `c2d44dad5502e21fbb19a2d030bbbd2671a719ce` 的同HTML捲動6／排版4／自動報名10／實際素材13逐份核對，Node1661／1661、source755、Astro485（零錯誤／警告）、23頁與audit0通過。實際R44快照SHA `71037be9782b05af1da404fd6ab667b538fbb5e4f4356fdbec943787d241c8d7`；9公開嘉賓、獨立出席3／6、8原Logo／7變體。其餘9條照片／作品media path共42次請求明示404替身，不冒稱真圖片已驗。

PR70已合併並正式發布main **`124180a0dc862d4e93cf79c5a3cf1c9278c83991`**。[main流程41458276411](https://github.com/kunanli/artdicohost/actions/runs/41458276411)已completed／success；check `125320465525`、transport、FC `125324011886`及OSS `125325767713`四工作皆成功。同HTML的6／4／10／實際13、1661 Node與各自source／captureSource已核對。**14:14:45.8060159 UTC** 已驗`https://artdico.host`的60個準確公開物件與來源124180一致，包含新首頁及字級CSS。14:13:06匿名報名GET／OPTIONS亦證實正式`attendeeReviewRequired:false`，範圍與[自動入場名額回執](onsite-auto-registration-release.md)一致。本分支只補證據，不為文件重複部署。
