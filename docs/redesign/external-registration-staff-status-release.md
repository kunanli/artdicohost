# 活動行報名、講者提案與客服出席分類

使用者於2026-11-03改為活動行一般報名，官網保留講者申請；客服主列表改為三個可判斷的出席階段。基準為PR76合併 `a8ec877271ceddf5cdece0ff0655024755d1e7fe`。本頁先記本輪決策與驗證範圍，正式回執完成後補記，未完成項目不稱已上線。

## 公開報名路徑

官網的普通報名連到使用者指定的[活動行頁](https://9525102647817.huodongxing.com/event/8884819113200)。網站內容、日程及嘉賓仍可閱讀；不將整個官網無條件跳離。本站表單只提交講者提案，姓名／Email／主題／簡介與隱私同意保留，電話與微信選填。提案存入私有後台等待審選，不自動確認講者、占用入場名額或寄正式參會確認函。一般入場依活動行報名辦理。

舊本站已提交的申請與恢復紀錄仍按原正文、原識別查回結果，不改造成新提案、不另建名額、不因部署補寄。API保留舊格式相容；隱藏一般表單不是刪除舊紀錄。回退須保留可讀取本輪講者欄位分支與PR76電話欄位的驗證器，不能用不識別新資料的舊讀取器覆蓋私有資料。

正式受控政策由既有`approvedRegistrationPolicy()`配置為`publicRegistrationMode: speaker_only`，缺省僅供獨立舊服務相容。新一般申請即使由舊頁面或講者token送出，也不建立新名額；已保存原識別仍可查回。講者`['talk']`與原`['attend']`、`['attend','talk']`分開校驗，服務端強制新講者待審；滿額不阻擋仍在開放日期內的提案，但全局關閉、日期、隱私與申請總數上限仍有效。講者可收到申請收件回執，正文不承諾參會，沒有正式入場確認函、Wallet、入場碼或群碼。

## 客服三段分類

主狀態為待確認是否出席、已確認出席、已確認出席並發送邀請函。分類來自已保存的回覆、申請來源與當前有效寄送證明，沒有新增可手填覆蓋的持久化狀態。本人完成本站一般報名且已確認名額可作出席確認；僅有工作人員預留名額不能當作本人答應。聯絡人沿實際保存的出席回覆。

已準備或下載邀請圖不等於發出；當前有效人工發出紀錄或正式Email服務接受才可標示發送。服務接受不是實際送達證明。寄送結果不明、未整合、候補、資料讀取失敗與權限限制仍如實提示，未知發送保留核對入口與防重寄。取消、不出席與已撤回不塞進已確認分類。原稽核、回覆、名額、原問卷與通知journal不刪除。

## 活動行匯出欄位及 Wallet 接續

使用者提供兩版Excel，最新表頭共19欄，新增「微信」。只檢查檔案結構、表頭與必要狀態，不將真人內容複製到Git或測試。最新樣本微信為空，按選填處理，不影響後續Wallet資格。

| 匯出欄位 | 未來轉接用途 |
| --- | --- |
| TID＋已配置來源活動 | 每人票的穩定來源鍵；重匯辨識同一票 |
| `报名编号`／`订单编号` | 報名對照及多人訂單關聯；不以整張訂單代表一人 |
| `姓名`／`电子邮箱`／`手机号码`／`微信` | 私有聯絡資料；不靠相同姓名或Email自動合併人物 |
| `报名时间` | 外部原始錄入時間；與本站匯入時間分開保留 |
| `状态` | 已觀察「有效票」；取消、退款、未知狀態須預覽核對，缺行不推斷取消 |
| `最后验票` | 外部核銷資訊；空白不能清除本站已有入場紀錄 |

本輪報名出口切換由使用者明確要求，**尚未實作活動行Excel轉接器或即時同步**。後續採匯出→預覽新增／已存在／衝突／取消→明確同步→同一份有效入場紀錄→明確寄出Wallet／入場碼與入群資訊。相同票重匯不新增人物、名額或自動重寄；已出票者與本站舊名額／預留共用容量，衝突不能靜默改為候補。活動行匯入不能偽造本人本站同意。

既有手機掃碼入場與防重複紀錄可沿用本站入場碼；本站QR與活動行管家碼未互通。若要管家掃Wallet，須另取得官方原始票碼並核對，不猜測TID可直接生成可用管家碼。批次匯入不是即時出票，活動行完成頁不應承諾即時收到本站Wallet。

## 核對與發布

將記錄講者驗證／保存／滿額／重播、後台三段分類／例外／權限／未知寄信及手機瀏覽器證據，再以準確PR、main產物核對FC、公開OSS及HTTPS。沒有讀取正式後台名單、匯入真人記錄、發送真信、修改活動行設定或驗證真人Wallet添加。

候選版來源檢查802檔；Astro521檔、0errors／0warnings／2hints。全Node1855／1855通過、fail／cancelled／skipped／todo皆0；其後僅修正名單篩選的焦點恢復，另跑對應7項client／navigation測試通過，最終準確提交仍由CI全套再驗。獨立審查核對token／政策／原識別重播、滿額講者不占名額、歷史unknown及目前收件人範圍，未發現剩餘重大問題。

凍結公開HTML SHA `00d99b669056d389209717f9c8079b59c0f5fed3c49b831f5eb37725172e005c` 的本機隔離瀏覽器：首頁7案（含7個一般外連入口與無JS點擊）、字體4、講者／舊申請10、申請審核15、FAQ旅程12均通過、pageErrors0、真實寄信／業務寫入／網路0。這些是候選dirty tree產物而不是舊base提交的正式來源；最終CI另綁準確sourceCommit及HTML。焦點修正後公開HTML不變，後台contacts HTML為 `572c82c802381c59fa19d62acc6def048f701d21d14308a154e853d5e89c0c57`、person為 `2e0b7642e68b58436391053f2c7a54d1d61c358055d235e4fc5f6d6e8f7c37bf`。

原67案CI保留，新增7案出席目錄瀏覽器作必要gate與一天證據工件，最終共74案。候選包仍沿137檔／42資源的既有限制及原bytes上限，不新增執行來源檔或放寬預算。正式發布以唯讀匿名GET／OPTIONS另核對`speaker_only`與講者開放，不向正式端點提交講者或一般報名。

出席目錄候選7案已於相同最終後台HTML通過；320／390／1440包含三階段、有效人工／Email證據、已寄未回覆、歷史未知旁警示、只核對不重寄、手機無溢出及已知結果返回焦點。原有未決結果導覽鎖仍保留。新測試先抓到篩選停用造成focus掉到body，產品僅同請求且仍body時恢復原篩選焦點；不搶使用者新焦點。初次失敗與後續harness失敗log保留於本機忽略目錄，沒有放寬業務守門。

最終相同後台產物的既有UX2單人旅程12／12亦通過，保留未知回執／權限／mock寄送與精確原操作守門。出席目錄7案腳本SHA `43afc7534b70b0010944b2ca423df2bd3ee57bce1c91ee869c62fb7d8f943525`；人工已看320／390／1440共15張三段列表及未知結果工作頁。持久化契約22與固定服務／客戶端旅程130另通過，fail／cancelled／skipped／todo均0。真人Email、入群及iPhone添加仍獨立未驗。

首輪PR77流程41591916945的1855項Node、捲動6／字體4／講者10／出席目錄7／寄信恢復8／入場6均成功，但舊排序刪除harness直接操作已收合的進階篩選而停止後續gate。測試改為核對預設all及保持收合，排序、刪除、遺失回執只核對與0mail守門不減；相同最終contacts產物本機2／2成功。固定人員整合旅程相同一處也更新並完整3／3通過。郵件預覽6與短鏈4在相同公開HTML另通過。首輪失敗保留於CI，不把部分通過當成整輪成功。

發布前唯讀觀測應報現行政策，不能要求尚未發布的speaker_only；已將模式期望與一般觀測分開。正式FC啟用後由`verify-public-registration.mjs --expect-approved-mode`強制比對審核的speaker_only與講者可用，cloud-lifecycle本身亦保留完整政策比對。18項readiness/lifecycle測試通過，含舊政策觀測成功及發布後錯模式／關閉提案必敗；所有路徑仍僅GET＋OPTIONS，零token或業務POST。

## PR77 正式發布回執

[PR77](https://github.com/kunanli/artdicohost/pull/77)最終head `90f414bb552966e0da5c3b7ed12e75f6d34940ed`；[PR流程41593098866](https://github.com/kunanli/artdicohost/actions/runs/41593098866)的準確synthetic merge為`c323b5512d8928184bf1af0d38bb6a16f542ee8b`，所有必要工作成功。合併main `b1f83a7d76578114d85e723f9d154a4f1f74858b`，[正式流程41594339072](https://github.com/kunanli/artdicohost/actions/runs/41594339072)五工作均completed／success。

PR及main各1856／1856 Node測試，fail／cancelled／skipped／todo皆0；來源802、Astro521、0errors／0warnings／2hints，依賴審計無已知漏洞。兩次瀏覽器回執皆為捲動6、字體4、講者／舊申請10、排序8、出席目錄7、寄信恢復8、入場6、名單排序刪除2、郵件預覽6、短鏈4、正式素材13，共74案；頁面錯誤0。各sourceCommit及當次captureSourceCommit皆等於該PR synthetic merge或main，不以舊base或本機dirty產物當正式證據。

公開HTML兩次皆為`00d99b669056d389209717f9c8079b59c0f5fed3c49b831f5eb37725172e005c`；contacts為`572c82c802381c59fa19d62acc6def048f701d21d14308a154e853d5e89c0c57`，person為`2e0b7642e68b58436391053f2c7a54d1d61c358055d235e4fc5f6d6e8f7c37bf`。正式公開輸入snapshot SHA `71037be9782b05af1da404fd6ab667b538fbb5e4f4356fdbec943787d241c8d7`，9嘉賓／8組織，實際漢字ink300次、blank／missing均0及90負控制。未捕獲媒體仍以明示404替身處理。

準確候選ZIP仍137檔、136release索引、42資產，未放寬任何限制。PR與main的實際ZIP離線啟動、closedMode、syntheticConfigurationOnly皆passed；main於07:17:13 UTC以network=none、code=read-only完成。主程式及簽章runtime沿已核對版本，不新增服務、來源檔、DNS或憑據。

2026-11-03 07:20:48 UTC，FC準確main驗證contentEnabled／registrationEnabled=true、privateOssAcceptance=passed、2獨立clients／1FCprocess；07:20:54核對14個準確後台HTTPS頁。07:20:57匿名GET／OPTIONS核對enabled=true、publicRegistrationMode=speaker_only、speakerApplicationsEnabled=true及兩個preflight=true。attendeeReviewRequired=false保留舊一般申請相容名額政策；新公開提案由speaker_only及talk-only服務端規則強制待審，不能以此舊flag推定本站仍開放一般出票。

07:20:50唯讀郵件readiness verified=true、automaticEnabled=true、Email enabled／ready=true、missing／invalid空、walletReady=true；mailRequests／businessWrites均0。僅配置就緒，不表示實際EmailJS接受、真人收件、入群或iPhone添加已驗證。

07:22:57 UTC，68個準確公開物件逐一HTTPS通過；07:22:59入場路徑publicEntry／invalidEntry／cors皆true，共3請求，commit同上述main。一般報名外連及講者表單的正式產物已發布；活動行Excel轉接器／即時Wallet同步仍未實作。最新真人匯出僅核對格式，沒有匯入、合併、改正式名額、發送真信或更新業務內容草稿。

本補記保存在獨立docs分支，不另建PR或重複觸發main部署。程式回退須保留本輪talk-only／phone-aware讀取器及speaker_only入口守門；私有備份／刪除仍沿既有受控流程，不用程式回退覆蓋最新真人資料。
