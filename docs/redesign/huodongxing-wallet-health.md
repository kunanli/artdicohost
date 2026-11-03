# 活動行 → Wallet 體檢與接續

2026-11-03；程式基準main `b1f83a7d76578114d85e723f9d154a4f1f74858b`。本輪依使用者要求檢查報名、匯入、確認信、Wallet、微信群與工作人員手機核銷，已完成活動行專用匯入及正式發布，準確回執見文末。真人匯出僅沿先前已核對的19欄結構，不在回歸中讀原始個資。

## 體檢基準缺口與處理

本輪沿用既有票券與通知，補齊活動行來源與共同名額的轉接。以下記錄起始缺口及處理。

| 範圍 | 已核對結果 | 本輪處理 |
| --- | --- | --- |
| 官網一般報名／講者 | PR77正式產物：一般外連活動行、本站speaker_only；新講者待審不占席 | 保留 |
| 活動行Excel | 最新格式19欄，包含微信；既有問卷匯入不是活動行轉接 | 補專用預覽／明確匯入 |
| 每票來源／重匯 | 既有contact來源可去重，尚無活動行票狀態與主名額對照 | 固定來源活動＋TID；外部票私有帳本，不靠Email自動合併 |
| 容量 | generic代登記滿額可能寫成候補；不適合外部已出票 | 同一名額CAS內要求confirmed-only；不足列衝突 |
| 手機／微信 | 聯絡人可保存；舊staff映射會漏phone | 補私有phone投影及相容讀取；不作人物身份鍵 |
| 確認信／Wallet徽章 | 現有信件可帶官方CN/EN圖標、私人短鏈、入場碼及群碼 | 直接沿用，匯入不寄；選人預覽後明確寄送 |
| Wallet／手機核銷 | 同一purpose=entry資格，撤回／更正／canonical重驗，GET不寫入場 | 沿用本站核銷；不稱與活動行管家碼互通 |
| 取消／來源更動 | 通用source_changed不是取消對帳 | 未知、取消及變更列需核對；不自動撤回、缺行不取消 |
| 郵件實際投遞／真人裝置 | 配置就緒與模擬通過不代表已收件／入群／加入iPhone | 業務操作時另驗，不以真人名單測試 |

私人確認頁目前沒有直接呈現可掃入場QR，QR在確認信與Wallet中；非Wallet裝置可讀私人頁，但郵件圖片關閉時的網頁QR備援可另補。這不是手機核銷服務缺失，不改現行入場資格。

## 本輪接法與信任邊界

工作人員使用「匯入活動行」選檔，先看新增、已有、需核對及容量衝突。TID／報名／訂單ID保持文字，多人同訂單分票；微信選填。已確認同一人才能明確關聯既有主名額，未確認的相同姓名／Email只提示。

沿既有受控staff匯入方式：瀏覽器用`readSheet()`讀取Excel，再由服務端嚴格核對正規化票欄位、固定活動、TID、狀態、來源檔SHA與操作者確認。SHA是來源追溯與預覽綁定，不證明Excel沒被編輯，也不是活動行官方即時驗票；服務端不宣稱重讀OOXML。必要通知的聯絡依據須有獨立工作人員核對記錄，不從「有效票」假造本站privacy accepted。

同步只保存來源及核對名額。匯入後另預覽並明確寄送既有確認函，已發、撤回、收件人更正與unknown仍按原journal守門。部分完成、遺失回執或競態不能換新識別重試；原操作與每票來源可核對。關閉頁面或重上同檔也不能增加第二個名額。

## 已執行的隔離與發布體檢

- 既有匯入／代登記／共同名額／通知72項、票券／私人頁／群碼／核銷86項、外部來源／通知49項均通過，fail／cancelled／skipped／todo皆0；測試有重疊，不將數字相加冒稱不同案例。這些是基準鏈路證據，不證明新活動行adapter已完成。
- 07:41:58 UTC核對遠端main仍b1f83a7；[正式流程41594339072](https://github.com/kunanli/artdicohost/actions/runs/41594339072)五工作成功。1856項Node及74案同來源瀏覽器、137檔準確候選與離線啟動、14後台及68公開HTTPS物件回執均核對。
- 07:20:57 UTC正式GET／OPTIONS驗得speaker_only、講者開放及兩個preflight；07:20:50配置觀測Email／Wallet ready、missing／invalid空且0mail／0businessWrites。這不表示舊403已透過真人收件證明解除。
- 開發環境政策不允許正式域名，因此不繞路做即時正式探測；以上公開服務狀態引用07:20–07:23 UTC的正式CI時點。main工作樹殘留dist不作新功能來源，將由獨立工作樹重建。
- 現有FC來源93／靜態資產42／總檔137已達既有檔數上限，本輪優先擴充既有module，仍需準確新包／離線驗證，不放寬限制。

本輪新功能的契約／測試／瀏覽器及正式發布結果完成後補記；不以此基準體檢代替新增功能驗收。沒有讀取真人名單作測試、匯入、合併、改名額、實寄、修改群碼或新增雲端服務。

## 客服操作

1. 活动行匯出這場活動的XLSX（包含「微信」），到「人员与报名」按「导入活动行」。需要同時具有邀約及審核權限；一般reviewer不可操作。
2. 選檔後先預覽，預設不選任何人。只勾本批要處理的有效票；同Email會提示，確認同一人後明確關聯既有名額，確定是不同人才選「独立参与者」。不按姓名或Email自動合併。
3. 工作人員分別核對來源檔，以及這批資料可用於必要參會通知的依據，再按「导入N人」。每批最多100票；XLSX最多2MiB／500資料列。容量不足、取消／未知票、既有來源變更列入需核對，不假稱已取得名額或靜默候補。
4. 看本批每票結果，再按「预览本批确认函」，核對收件人及狀態後明確「寄送」。匯入本身零寄信。使用既有郵件範本中的官方Wallet徽章、私人短鏈、入場QR與有效群碼；缺少／過期群碼先到通知設置更新，不能用失效圖承諾入群。
5. 後續匯出同場新檔重複以上流程，已存在的票不新增名額或自動重寄。若匯入部分完成，先「核对原导入」，需續作時按「继续原导入」；刷新後須重選同檔以核對原正文。寄信結果未知只核對，不能用新操作重寄；明確未開始才可「重新核对收件人」。

活動行報名成功與本站Wallet發送之間有批次處理時間。本站入場碼由本站工作人員登入掃描、查看並明確確認入場；不聲稱活動行管家可掃。活動行後台設定與名額仍由主辦人維護，本系統不讀活動行登入狀態或自動回寫驗票。

## 契約、部署與維護

API沿既有contacts/import入口，以`kind:huodongxing`分流；一般問卷匯入不可使用活動行保留來源鍵，也不能從通用snapshot匯入冒充；需要帶完整帳本的復原走加密維護流程。正規化保留TID、報名／訂單號、姓名、Email、手機、微信、原報名／驗票時間及狀態，不保留付款／備註／行銷答案。票號、手機及微信必須為文字；數字儲存造成前導0或精度已遺失時拒絕，不猜回原值。日期保留外部牆鐘字串，不補造時區。

瀏覽器讀檔沿現有read-excel-file，並非完整OOXML可信來源驗證，不能辨識所有快取公式或把壓縮檔大小當解壓記憶體上限；只使用客服可信的活動行匯出，不開放匿名檔案匯入。伺服器驗證正規化列、正文大小與來源SHA，並在同一容量寫入前重新核對。通知權限來自私有帳本中的獨立staff確認，不把原contactConsent unknown或本站consent false改為同意。

依現有[部署步驟](../08-deployment.md)與[FC流程](../automatic-fc-deployment.md)先完整測試／同來源瀏覽器／準確包離線啟動，再部署FC及公開資產；無新環境變數、依賴、外部API key、雲資源或DNS。`.env.example`只加操作說明，寄信／Wallet沿既有受控配置。

回退前暫停明確寄信，保留外部來源帳本、原操作、共同名額與通知journal；只部署能讀取新帳本、phone、derived externalAttendance及confirmed-only政策的相容修正版。回退程式不能清除來源、取消真名額或覆蓋為匯入前快照。加密備份／隔離恢復／保留及刪除沿[維護流程](../maintenance-backup.md)，包含新ledger前綴及其全部提交歷史。未完操作只核對，不因恢復自動續匯／重寄。

## 候選體檢發現與修復追蹤

首輪全套1932案例中1924通過、8個cloud-acceptance失敗，都停止在加密備份的新增帳本讀取；查明隔離驗收的固定來源白名單漏列新活動前綴。修正保留同一隔離命名空間及原1000請求上限，不改為讀正式位置。重跑結果以本輪最終準確來源CI為準。

早期建置43資產／138檔超出原42／137限制；將無頂層副作用的既有delivery-settings helper併入既有registration-domain chunk，保持93runtime來源、42資產／137總檔及原bytes限制，不提高預算。08:16候選閉包7,673,703 bytes；後續UI修復仍須重建。

新手機瀏覽器首次檢查找出外層busy解除後動態選單仍disabled；獨立審查再找出合法capacity_conflict／needs_review的registrationId:null被前端拒絕。兩者均作產品修復並保留原操作斷言，不放寬timeout或把partial當成功。合併人物的次要來源拒絕／來源讀取失敗與稀疏證明陣列也新增回歸，所有明確拒絕優先於活動行正向來源。

隔離驗收加入新固定帳本後，最極端登入時窗案例曾碰到1000請求邊界；僅移除原本未核對撤銷結果的第三個editor重複登出，保留兩個獨立owner會話跨client登出→401與持久revoked驗證，全部十階段及原1000請求／90秒上限不變。16項cloud-acceptance及4項維護回歸重跑通過。

匯入復原資料只在同actor／roles／event的sessionStorage保留原操作識別、摘要及選擇，不保存原檔、姓名、Email、手機、微信或自由填寫的依據。未決結果不因時間經過自動刪除或換新操作；已知完成及登出清理，未知寄信只GET核對。

300既有記錄／100新票的批次回歸驗得immutable reads399、current profile map1次、revision102次、inactive2次、status100次、最高並行8；更正後Email用受控profileScopes比對，原始記錄不改寫，同次請求才快取不可變recordHash，重播／新請求重讀。該測試首次找出逐票importContacts會耗盡原20筆migrationArchives的問題，改每個明確來源操作一次staging缺少的聯絡人，再逐票CAS名額與寫入結果；不提高20上限或宣稱預先存聯絡人等於入場成功。修正後該合成300／100案通過，零通知。

活動行的售票上限須與本站共同容量及嘉賓／講者既有名額協調；兩邊沒有即時共享名額服務，不能各自再開滿300。本站匯入遇不足會列衝突，後續由工作人員核對安排。

最後本機手機／桌面七案涵蓋390／1440、真合成XLSX選檔、同Email明確分人／既有主名額、滿額部分完成、跨journal遺失回執續同正文、未知郵件只讀、角色拒絕及Escape清理，全部通過、pageErrors0、realMail／realBusinessWrites／uninterceptedNetwork均0。這份dirty tree報告公開HTML為8c938bb2…83256、contacts5a2cd44b…6847d，後續僅短原因文案更新及批次來源保存修正；最終CI須以準確提交、HTML及腳本重新跑七案，不能沿用舊base SHA冒充發布證明。

## 凍結候選驗收

最終本機全Node1941／1941通過，fail／cancelled／skipped／todo皆0；來源811檔、Astro529檔0errors／0warnings／2hints，pnpm audit無已知漏洞。固定契約publication40／persistence22／provenance44／media-event4及固定服務旅程130亦通過；與全Node有重疊，不相加。新專用HUI檔27案、所有新parser／controller24案加短原因回歸1案及原delivery client30均通過。新attendance12、既有相容47與cloud-acceptance16／maintenance4各自通過。

最終靜態HTML SHA：公開`e9c0d5d84d4446b346162c3167c090869dd39460647ee36ab7d7f8ea98548ebd`、contacts`34b6f8c6a6c2040890eb9d2e05b180cc99f53effc2158833251e0236cd5da5dd`、person`2b800611ba79aa58d7f07e88da889e236f196801f437a9fb5d111606d88063a6`；新七案腳本SHA`3a3c11779e39da9190b47dd51b543dbe6133297fe2644df8d507931a9bac69c5`。最終閉包仍93來源／42資產／137總檔、資產7,675,002 bytes，不放寬任何限制。

這是凍結dirty候選的本機驗收，不把base b1f83a7稱新提交。PR／main的準確來源CI、七案新旅程與原74案、離線包及正式FC／OSS／HTTPS回執另行核對；任何步驟失敗不能宣稱發布完成。

## 操作邊界與後續小項

目前來源封存沿既有migrationArchives總上限20（含舊問卷匯入）；每個有新增聯絡人的活動行批次只用一份，已存在票重匯不再新增。建議合併處理本批新票，避免每人各建一批。本輪不刪來源封存來解除上限；到限需依維護流程核對相容處理，不盲重試。

具名寄送完成後，下方結果為準；同次較早的預覽列可能仍寫「可发送」。重新預覽可讀當前狀態，服務端去重及版本核對會阻止重複寄信。這是次要顯示改進，未列為投遞成功證明。明確失敗者可從「查看报名」使用既有單人確認函重寄；結果未知先核對原寄送。

私人確認頁尚無直接入場QR備援；目前確認信與Wallet提供QR。實際EmailJS接受／收件、群碼有效與真實入群、iPhone加入及現場人員操作仍分開驗證，沒有用本輪合成或配置readiness代替。

## PR78 準確提交驗收

[PR78](https://github.com/kunanli/artdicohost/pull/78)head為`60628c79a186038c6f336d0c2f6a1e42f202f778`；[PR流程41605530306](https://github.com/kunanli/artdicohost/actions/runs/41605530306)checkout的準確synthetic merge為`3a561f0e87f8d9ea8126482f80e72997798ec609`，三個必要工作成功，兩個僅main發布工作如預期skipped。不是把PR的skipped部署當正式發布。

1941／1941 Node、811來源與529 Astro（0errors／0warnings／2hints）通過，依賴審計無已知漏洞。12份準確瀏覽器回執共81案：捲動6、字體4、講者10、展示排序8、出席目錄7、重寄恢復8、入場6、排序刪除2、郵件預覽6、短鏈4、新匯入7、正式素材13；sourceCommit均等於上述synthetic merge，所有適用公開HTML都等於e9c0d5d…948ebd，contacts／person及新腳本均與凍結hash一致。

新七案sourceTreeClean=true、realMail／realBusinessWrites／uninterceptedNetwork=0、pageErrors空。正式公開輸入snapshot仍`71037be9782b05af1da404fd6ab667b538fbb5e4f4356fdbec943787d241c8d7`，9嘉賓／8組織、300次漢字ink檢查、blank／missing0及90負控制；未捕獲媒體仍使用明示404替身。

準確候選137檔，network=none、code=read-only的實際ZIP離線啟動、closedMode及syntheticConfigurationOnly皆passed，42靜態資產，沒有提高bytes或檔數上限。正式main為`3c13de91b8da04a2232b4ad6916cd1cfdffacbd5`，tree與head均為`e073744c12914a150ec38e6a569f0d1b23483775`；main工作樹乾淨。正式main回執如下。

## PR78 正式發布回執

[main流程41606971922](https://github.com/kunanli/artdicohost/actions/runs/41606971922)五工作均completed／success；來源main `3c13de91b8da04a2232b4ad6916cd1cfdffacbd5`，程式tree仍為`e073744c12914a150ec38e6a569f0d1b23483775`，與PR head完全一致。

main再次1941／1941通過、fail／cancelled／skipped／todo皆0；811來源、529 Astro0errors／0warnings／2hints，無已知依賴漏洞。12份瀏覽器回執共81案及所有適用公開HTML、contacts／person、新匯入腳本均與前述凍結hash吻合；每份sourceCommit及正式素材captureSourceCommit都為此main，沒有用dirty base代替。新七案仍clean checkout、pageErrors空、realMail／realBusinessWrites／uninterceptedNetwork0。正式素材snapshot、9位／8Logo、300漢字與90負控制亦吻合。

實際ZIP的network=none／code=read-only離線啟動、closedMode與syntheticConfigurationOnly全部passed；cloud candidate離線12.606秒、42資產／137檔，不增加來源檔、預算、服務或DNS。

2026-11-03 09:08:48 UTC，準確main FC驗證contentEnabled／registrationEnabled=true、privateOssAcceptance=passed、2獨立clients／1FCprocess。09:08:56核對14個準確後台HTTPS頁。09:08:58匿名GET／OPTIONS核對enabled=true、publicRegistrationMode=speaker_only、speakerApplicationsEnabled=true及兩preflight=true；舊attendeeReviewRequired=false只作歷史相容，新一般報名仍由官網外連活動行。

09:08:51 UTC郵件readiness verified=true、automaticEnabled=true、Email enabled／ready=true、missing／invalid空、walletReady=true，mailRequests／businessWrites0。這是配置就緒，**先前EmailJS403是否已解除仍未透過真人寄達證明**，本輪沒有實寄。

09:11:17 UTC，68個準確公開物件逐一HTTPS及hash／來源核對通過，包含官方CN／EN Wallet PNG與SVG；09:11:20入場路徑publicEntry／invalidEntry／cors皆true，共3請求且commit同此main。新「导入活动行」前端與後端程式已發布；沒有匯入真人名單、改真人名額／同意、實寄、改群碼或驗證真實iPhone添加。

本發布補記存於獨立docs分支的不可變提交，不另建PR或重複觸發main部署。main工作樹保持乾淨；受控相容回退及備份／刪除範圍見上文，不能刪原操作或來源以解除去重。
