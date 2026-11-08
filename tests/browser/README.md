# 2026-11-08：B 中央大圖

使用者選擇B中央大圖；`homepage-gallery-smoke.mjs`沿用4案，改驗Embla置中／雙側預覽、滑鼠／真實CDP觸控、橫向wheel、鍵盤循環、拖曳不誤開大圖、側圖首次點按置中、刷新重排依穩定ID保位置、零／單件／缺圖、無重複DOM與中途減少動態。320／390／1440／1920皆保留圖片下方透明資訊、單球13組織及中英文站點說明等前輪要求。手勢前等待圖片及字型穩定；合成藍圖不冒充正式作品素材。預設不自動播放，無箭頭。正式素材捕獲／13案仍為CI必要守門。

# 2026-11-07：單頁組織與原生作品圖廊

`homepage-gallery-smoke.mjs` 為本輪四寬度（320／390／1440／1920）驗收：13個組織全數同球呈現、矩形不重疊且在球內；作品原生觸控／橫向wheel／鍵盤捲動、圖片下方透明資訊、大圖與焦點、公開刷新保位置、日程刪除指定文字／時段選單、中英文現場站點審核及舊FAQ適配。全部網路攔截只允許GET，僅合成資料，不能替代正式素材／真機。成功prefix為`Homepage gallery browser verified:`，報告包含4案、來源／HTML／script SHA與零pageErrors，已加入CI。

本輪需求取代舊`p5-collections-smoke.mjs`中的翻頁、單件隱藏輪播／篩選與日程時段選單斷言；舊腳本保留作歷史，不作本輪驗收入口。實際公開Logo與照片仍由`bubbles-logo-bounds-smoke.mjs`以同份匿名捕獲驗證，組織改為一次檢查全數而不逐頁切換，邊界、原圖與非重疊斷言維持。

# 浏览器回归验收

2026-11-03嘉賓最新規則：沿原圓形，文字僅姓名／公開company組織／ggjRole；不顯示title及方形介紹浮框。hover、手機點按與原生鍵盤在同一圓內切換本人照片，失敗／缺圖維持文字。這覆蓋下方歷史版本的職稱及展開面板說明。實際素材擷取的manifest.media包含公開Logo及本人照片，兩者分開計數；同源／雜湊／格式／bytes限制保持。當輪案例與證據以[圓內照片紀錄](../../docs/redesign/guest-circle-portrait-release.md)及實際報告為準。


置顶导览与捲动动效入口为 `home-scroll-motion-smoke.mjs`，在最终编译完成、来源与dist冻结后执行：

```sh
ARTDICO_PLAYWRIGHT_MODULE=playwright-core ARTDICO_CHROMIUM_BINARY=/usr/bin/google-chrome ARTDICO_SCROLL_EVIDENCE_DIRECTORY=/absolute/repository/.local-data/browser-evidence/home-scroll-motion node tests/browser/home-scroll-motion-smoke.mjs
```

预期6案：320／390／1440／1920，以及无JS／无IntersectionObserver。所有请求预先拦截，仅合成公开内容与本地编译资源，无业务POST或寄信。核对header在首中尾持续置顶、原生wheel、细进度线、实际装饰视差与进场WAAPI、焦点立即稳定、手机原生选单及Escape、平滑锚点完成后不遮标题、公开刷新保阅读位置及延迟嘉宾hash。简报式进场需实采早／中／完成的opacity与帧，确认标题先淡入、内容延后、结束全文可见；手机原生touch pan不能把尚未出现的内容提前标为seen。2026-11-02用户要求Hero球体退入全页背景、星点覆盖中央并持续；因此改验单一全宽ambient canvas、原球与背景球的原生滚动衔接、球体实际缩放／透明度、Hero与阅读中段的可见微粒像素／自然位置变化，以及文字／球体排除和轻微游标影响，不只检查canvas或timer。桌面实际paint至多30fps、手机至多16fps，画布bitmap有界；1px真实viewport仍无页面错误。新全页ambient允许Hero离屏后运行，替代旧edge-only／离屏idle0规则；初始／途中reduced-motion与明示合成hidden信号仍必须停止canvas及进场；HTML预设可见，强淡入只发生在进入视窗后的短动画。粒子canvas须aria-hidden、pointer-events:none，不遮实际点击目标。成功摘要唯一前缀为 `Public scroll motion browser verified: `，独立于排版4案与实际素材13案，三份报告分别核对来源／HTML SHA和完整数量。合成触控、可见性与callback计数不代表真实手机、OS背景或物理电量量测。

公开表单可读性的独立入口为 `public-typography-smoke.mjs`，不替代或改变下方 actual13。同样使用 playwright-core 1.64.1 与已安装的 Chrome，在最终构建后执行，不需要正式资料捕获或凭证：

```sh
ARTDICO_PLAYWRIGHT_MODULE=playwright-core ARTDICO_CHROMIUM_BINARY=/usr/bin/google-chrome ARTDICO_TYPOGRAPHY_EVIDENCE_DIRECTORY=/absolute/repository/.local-data/browser-evidence/public-typography node tests/browser/public-typography-smoke.mjs
```

预期四案覆盖 320／390／1440／1920。使用隔离 runtime 的实际公开配置 GET、空合成公开内容及 native IndexedDB 草稿；全部网络预先拦截，只允许 GET。核对选填、分享提案、键盘焦点与同意框；表单没有两块详细告知，单一隐私链接可打开默认收合的页尾说明，完整保留当前告知且不会代为勾选。缺必填项只触发前端错误，不提交。未知恢复由合成原请求写入浏览器本机草稿后重新加载，核对原正文保持不变，不按恢复发送按钮。

同四案还核对GGJ指南只在Q&A `site-role`出现、正文至少16px，现场体验气泡辅助字桌面16px／手机14px且无裁切。对外邮箱以活动配置的 `PUBLIC_CONTACT_EMAIL`（当前 `kunan@globalgamejam.org`）为准，旧政策与内容中的联络邮箱不能覆盖它；其余完整告知仍取当前权威配置。Q&A更新、关闭／不可用、复制及旧待提交恢复另由 `p5-faq-application-smoke.mjs` 的12案验证。

按语义检查标签、输入、同意文字及按钮至少 16px，辅助说明／状态／错误至少 14px，表单 h3／h4 至少 20px，解释段落行高至少 1.6；同类标签、输入与按钮保持一致，艺术展示字不强制同值。检查实际布局无裁切／横向溢出，按需展开的页尾说明与恢复区域为深色表面，依据实际计算样式叠合前景／背景算出至少 4.5:1 对比。输出每案申请／恢复两张区块图、HTML／资产／脚本 SHA 及计数；成功标记为 `Public typography browser verified: `。源码存在不代表已执行，完成数量与退出码以本轮报告为准。

气泡与组织图标的正式图片回归入口为 `bubbles-logo-bounds-smoke.mjs`。使用开发工具 **playwright-core 1.64.1** 与 CI 已安装的 Chrome；不增加生产依赖。批准的 CI 先匿名捕获公开内容及同份快照全部原始组织图（有界捕获），再于同一工作目录构建、执行：

```sh
ARTDICO_PLAYWRIGHT_MODULE=playwright-core ARTDICO_CHROMIUM_BINARY=/usr/bin/google-chrome ARTDICO_PUBLIC_VISUAL_FIXTURE_DIRECTORY=/absolute/repository/.local-data/public-visual-fixture ARTDICO_BUBBLES_EVIDENCE_DIRECTORY=/absolute/repository/.local-data/browser-evidence/bubbles-logo-bounds node tests/browser/bubbles-logo-bounds-smoke.mjs
```

该目录必须已有捕获器生成的 `manifest.json`、原始 `snapshot.json` 与 `media/`，并通过来源、匿名状态、字节数及 SHA 校验。脚本分别核对同份捕获的原始公开人物数量与原出席证明允许显示的实际名片，只对真正显示者逐项验证姓名、单位、职称和DOM ID；同份捕获全部实际上传组织图像都验证；没有捕获数据就失败，不能悄悄换成示例图片。原始 JSON、图片、含公开姓名的截图及详细报告只留忽略目录／短期 CI artifact，不提交到 Git；日志只输出计数、摘要、固定错误码及几何数值。

预期十三个场景：1920／1440／390／320 的四个原始公开快照场景；四个保留同份捕获全部实际上传字节、仅将组织身份明确改为合成值的普通布局兼容场景；四个不透明方图、极高／极宽、留白画布及未来图片 hash 更换场景；一个长文介绍与初始 reduced-motion 场景。核对整个图片、卡片、独立图框的包含关系及两两不重叠，不能只比较可见白色像素。原七份已核对图像才使用绑定的白色原稿版本；2026-11-02用户要求其他上图也呈白色，更换hash使用新上传来源的有界白色呈现，保留透明背景／字洞，不能显示旧图或白矩形。原上传bytes与前台白色输出分别验证。实际原图数量取捕获manifest，不强制为七张；原稿已知变体仍单独核对七份。

嘉宾圆泡依序同时显示姓名、独立单位栏、职称栏；单位只取 `company`，职称只取实际 `title`，缺省时用真实 `ggjRole`，两者都缺则保留空白，不能把公司冒充职位。核对每位全部非空字段、完整 ARIA 顺序与三层矩形互不重叠／无内部滚动；Maria／PingYao若在实际显示名单，姓名与职称保持严格字体裁切检查；未显示时只在明示合成文本边界保留同样检查，不计为实际人物覆盖。较长单位至少有一完整行，四种宽度对原证明确实显示的全部人物展开逐字核对单位及职位全文，手机展开会让后续内容让位。合成长文场景保留 160 字单位、200 字职称，并在同案另验真实角色回退、只有单位及全空字段，场景总数仍为十三。完整介绍在主页面阅读。

普通浮动、悬停／焦点／展开暂停、移出视窗、reduced-motion 与恢复均检查实际 WAAPI 对象、时间和位置。headless Playwright 强制页面可见，因此 `document.hidden` 分支使用**明示的合成 visibility 信号**驱动实际动画，不冒称真实操作系统遮挡或切换背景标签已验。捕获范围只有公开资料与组织图；未捕获的嘉宾照片／作品图片请求会在拦截器返回 404，并记录数量，不能宣称全站正式图片均已验证。

全部十三案通过后才输出唯一的 `Actual public visual browser verified: ` 安全 JSON。CI 验收还需匹配捕获快照 SHA、源码提交及 `actualRawLogosTested`／`defaultReferenceLogosRendered`／页面错误数，不能只凭 workflow 绿色或截图存在判断成功。实际执行数以本轮报告为准；下方 reference 九案仍是合成版型回归，不能替代这份正式上传图片证据。

首页原稿还原的新增聚焦入口为 `home-reference-smoke.mjs`。必须等本轮最终 `dist` 完成后再执行；它不负责构建，也不会读取正式公开 API 或私人名单：

```sh
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium ARTDICO_DIST_DIRECTORY=/absolute/path/to/final/dist ARTDICO_REFERENCE_EVIDENCE_DIRECTORY=/absolute/path/to/reference-evidence node tests/browser/home-reference-smoke.mjs
```

这支脚本在载入前拦截全部网络，使用九份无 `guestAttendance` 的合成旧版公开人物、七份合成组织及本地参考图标。组织仅借用参考图已经公开的名称和 logo，固定合成 ID，以打乱的输入次序验证已知品牌排序；不读取正式名单，也不从名称推定出席。它验证 320／390／1440／1920 四种宽度、原生展开／键盘／Escape／悬停间隔／触控、缺图保留姓名与首字、组织只显示名称和图片，以及真实作品筛选、日程标签和 Q&A。额外区分首次明确空出席证明、坏证明、读取失败，及刷新时保留最后核对版本；缺旧证明不等于已确认出席，气泡副标题只显示真实资料字段。1440 场景还验证未知及重复品牌记录仍保留在普通布局。共九个场景，实际完成数与退出结果以本轮报告为准，脚本存在不代表已通过。

桌面几何来自原始 `FrontEnd_Resource/落地页.png`（1921×19362）：原嘉宾圈直径 220、首列中心约 392、列中心间距 370、行距约 371；组织星球直径约 1408；标题白色字形高约 65、水平起点约 281，分隔线起点约 140。姓名、单位、职位必须同时显示的新要求采用独立且明确的圈径：1920 宽 260px、1440 宽 224px；手机用两列可用宽度（扣左右 20／24px 页面留白和 20px 列隙）并以 220px 封顶，390／320 因而分别为 161／130px。尺寸断言容差为 1.5px，不放宽旧原稿尺寸容差来掩盖差异。报告同时保留原稿量值与这项内容适配规则；桌面四列中心、列距及行距继续依原稿独立核对，容差收至 1.5px。

脚本记录原图 SHA、测量方法及明确容差，按视窗宽度缩放后核对四列九位人物、七组织 2／4／1、标题／分隔线和圆形比例。姓名、单位、职位整体居中，各栏有序且不重叠，不再用旧版姓名单独居中判断三层布局。组织中排原本有 24px 的错落，列辨识会保留它；参考图像的白色绘制范围只作诊断元数据，安全边界改验整个图片／卡片矩形，不以扩大透明画布取得表面像素相似。装饰空圈另验透明包装与相同直径。另核对实际解码的 1768×885 原作品图采用 2:1 完整显示、下一作品预览等高，以及日程三色图例的原稿横坐标、独立时段筛选行和手机三等栏。手机单独检查两列适配，不把它称为原图等比像素匹配。

证据包含最终 HTML SHA、建置时间、实际加载资产 SHA、1920／390 全页及各区截图、原图裁段和各场景结果。截图仍需并排人工查看；文件存在或几何断言通过都不能宣称整页逐像素一致。所有请求均停留在拦截器，不寄信、不提交申请、不更改出席或发布内容，也不增加生产依赖。

[UX2 具名寄送与连续处理](../../docs/redesign/ux-workflow-release.md) 新增以下两个入口。先用当前准确配置建立本地 `dist`，再分别执行；本轮最终通过数量以阶段记录为准：

```sh
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium ARTDICO_EVIDENCE_DIRECTORY=/absolute/path/to/formal-evidence node tests/browser/ux2-formal-picker-smoke.mjs
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium ARTDICO_EVIDENCE_DIRECTORY=/absolute/path/to/person-evidence node tests/browser/ux2-person-workflow-smoke.mjs
```

二者均在页面载入前拦截所有请求，使用实际隔离应用／内存 OSS 与 mock provider。UX2 本轮准确 FC 的正式 picker 10 案、person／directory 12 案均实际退出 0，逐项核对 canonical HTML 与资产，最终记录见阶段文档。正式 picker 核对姓名选人、原正文持久回执先于 POST、失 ACK 后 GET 原操作、旧 pending 及首次已知拒绝；person／directory 核对单人恢复、同 actor 重新授权、明确登出清除、搜索／位置返回及显式下一位。lookup 失败或先前 unknown 不会变成未寄；合法的新首次 pre-start 4xx 与它分开测试。原请求只留内存／受作用范围的测试 IDB，报告只保留合成截图、布尔值、计数与摘要；不联系正式 API 或真实收件人。

可用 `ARTDICO_DIST_DIRECTORY=/absolute/path/to/dist` 选另一准确静态目录；默认仍是仓库 `dist`。证据目录默认分别为 `.local-data/browser-evidence/ux2-formal-picker`、`.local-data/browser-evidence/ux2-person-workflow`，对公开构建与准确 FC 包分别指定目录，保留各次证据。这两个新入口不在固定旅程 Skill 的四个脚本清单内，真实收件／微信／iPhone／同事观察另验。

已发布 [UX1](../../docs/redesign/ux-clarity-release.md) 使用最终公开构建和准确 FC 组合核对按钮名称、手机层级及设备行为：

```sh
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium ARTDICO_EVIDENCE_DIRECTORY=/absolute/path/to/evidence node tests/browser/ux1-private-page-smoke.mjs
```

聚焦脚本 8 案；更新后的 `p3-private-page-smoke.mjs` 29 案保留原失败／换人／迟到回应／群码／通知安全情境，微信 iOS 改验证指引与复制不请求 Wallet。`p6-event-facts-smoke.mjs` 另核对同一事实来源的实际签章和客户端 Blob；模拟不表示真实添加。三者可用 `ARTDICO_EVIDENCE_DIRECTORY` 分别保留证据。

首页／集合分别用 `p5-homepage-smoke.mjs`、`p5-collections-smoke.mjs`；支持 `ARTDICO_HOME_EVIDENCE_DIRECTORY`、`ARTDICO_COLLECTIONS_EVIDENCE_DIRECTORY`。FAQ 的 `ARTDICO_FAQ_EVIDENCE_DIRECTORY` 及实际 FC 组合按下方既有说明。

`staff-operations-smoke.mjs` 是历史全部工具同页版型，不能作为当前独立设置页验收；原安全断言保留。本轮在旧版型假设处的尝试失败已记录，不算通过。现行替代为 `p2-person-smoke.mjs`、`p4-notifications-smoke.mjs` 与 `settings-group-runtime-smoke.mjs`。`unified-people-smoke.mjs` 与 `organizer-tasks-smoke.mjs` 已同步 P4 回执基准、现行收合入口及简短文案，原安全／写入断言保留。

`registration-workflow-smoke.mjs` 在 320／390／1440px 使用真实隔离 runtime 核对精简列表、默认收合工具、已确认导入人员的私人确认页、打开页面不新增报名或发信、原始问卷保留、保存后编辑区保持，以及换人／401 后的私密链接和摘要清理。全程拦截网络，仅合成资料，不替代真实 iPhone Wallet 验收。

这组可选检查使用真实 Chromium 运行构建后的页面，但拦截全部页面请求并提供纯合成 API。它不连接正式 API、不写真实报名、不读取原始名单，也不能代替真实 FC／OSS 端到端验收。

P6 的 [跨入口活动事实整合](../../docs/redesign/p6-release.md) 已核对同一合成申请的首页、私人页、正式信、提醒和签章 Wallet。320／390／1440px 与 390px 事实冲突共 4 个情境通过；读取／票券不增加业务写入或寄信。维护时执行：

```sh
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/p6-event-facts-smoke.mjs
```

可用 `ARTDICO_EVIDENCE_DIRECTORY=/absolute/path/to/evidence` 指定证据目录，默认 `.local-data/browser-evidence/p6-event-facts`。私人能力链接与 PKPASS 仅留在内存，清理成功才写报告；合成签章与浏览器 Blob 不代表真 iPhone 加入 Wallet。

P1–P6 软件已正式交付，最终部署及 A01–A23 证据见 [P6 记录](../../docs/redesign/p6-release.md)，P5 版型与准确产物见 [P5 记录](../../docs/redesign/p5-release.md)。不重复运行未受影响的已通过浏览器，也不以它们代替真微信／iPhone／同事观察。维护 P5 时三个入口使用当前候选构建执行：

```sh
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/p5-homepage-smoke.mjs
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/p5-faq-application-smoke.mjs
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/p5-collections-smoke.mjs
```

依次检查主页三尺寸／无 JS／reduced motion／缺装饰图与 OFL、FAQ／申请／旧 IndexedDB pending 恢复，以及嘉宾／组织／作品轮播／跨区日程／刷新焦点。新增脚本不在固定旅程 runner 中，最终成功范围以阶段记录为准；素材还需公开产物引用与 FC 依赖隔离校验。

FAQ 脚本可用 `ARTDICO_FAQ_EVIDENCE_DIRECTORY=/absolute/path/to/evidence` 指定证据目录；默认写入 `.local-data/browser-evidence/p5-faq-application`。比较公开构建与准确 FC 组合时分别指定目录，保留各次结果。

已发布 P4 的通知后端、私人页分型与提醒后台验收见 [P4 记录](../../docs/redesign/p4-release.md)。维护时使用当前候选构建执行：

```sh
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/p4-notifications-smoke.mjs
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/p3-private-page-smoke.mjs
```

前者核对提醒预览／选人／发送、未知结果及重新打开后的只读核对；后者新增申请回执／正式信／提醒的分型检查。待审可有独立申请回执，不发正式确认信、群码或 Wallet；全程使用合成 provider，不实寄。

2026-11-01 P3：`p3-private-page-smoke.mjs` 检查私人页的信息顺序、资格、群码过期／缺少／图片失败与重新取得、保存入口、装置指引及换人清理；`settings-group-runtime-smoke.mjs` 同步检查群码设置及二十四小时内到期提示。来源和实际结果见 [P3 记录](../../docs/redesign/p3-release.md)。使用当前候选构建后执行：

```sh
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/p3-private-page-smoke.mjs
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/settings-group-runtime-smoke.mjs
```

前者不在固定旅程 Skill 的四项浏览器清单内，需另行执行；装置／浏览器模拟不代表真实微信入群或 iPhone Wallet 已加入。

2026-11-01 P2：以下两项检查简约人员入口与单人工作页，来源及结果见 [P2 记录](../../docs/redesign/p2-release.md)。清单验证先筛选待处理再分页、短状态与一个下一步、按权限展开只读核对、来源失败及退出清理；个人页验证收合原件、原位保存、焦点／选字与视窗位置、未知保存只读核对、私人链接仅明确取回。使用当前候选构建后执行，不实寄、不修复正式名单：

```sh
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/p2-directory-smoke.mjs
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/p2-person-smoke.mjs
```

固定旅程 Skill 的四个浏览器案例不自动包含上述新增脚本；两项需单独执行。实际同事观察、真实 Email 收件、微信入群与 iPhone Wallet 加入另行记录。

2026-11-01 P1b：`p1b-attendance-smoke.mjs` 检查冻结旧发布、实际出席证据、多位场次参与者、编辑器切换、预览与前台一致、普通保存与明确发布。来源及结果见 [P1b 记录](../../docs/redesign/p1b-release.md)。使用当前候选构建后执行：

```sh
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/p1b-attendance-smoke.mjs
```

2026-11-01 P1a：两类作品与动态展位的聚焦验收入口为 `p1a-content-smoke.mjs`，须在当前候选版本构建后执行，结果见 [P1a 记录](../../docs/redesign/p1a-release.md)。`staff-smoke.mjs` 含固定十五格及补齐操作，保留作历史脚本，不能直接作为 P1a 当前验收。固定 Skill 清单未包含新脚本时，需另行执行，不能把旧 runner 通过等同新功能通过。

```sh
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/p1a-content-smoke.mjs
```

2026-10-22本轮采用[统一保存](../../docs/admin-save-workflow.md)及[默认公开](../../docs/default-public-visibility.md)。四类内容只因手动未公开而隐藏；保存后表单保留、主要保存禁用直至重新编辑，已载入草稿浮窗移除。下文旧公开条件／自动关闭的历史描述由本轮说明替代，不能继续当成产品要求。实际源码、建置与发布验收分别绑定，不把source模式脚本冒充准确bundle通过。

本轮新增主流程，先按下方方式生成一次最终构建，验收过程中不重建：

```sh
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/admin-save-visibility-smoke.mjs
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/people-save-state-smoke.mjs
```

前者用实际隔离runtime、真实IndexedDB及320／390／1440页面验证四类默认绿色开关、保存与发布分开、手动隐藏与重读、连续保存同一稳定ID、旧快照同版先保存、原请求未知结果精确重试；输出记录dist实际mtime及HTML摘要。后者覆盖人员表单原位保存、422、坏回执及未知结果只读核对。`settings-save-feedback-smoke.mjs`、`admissions-save-state-smoke.mjs`和`arrangement-planner-one-step-smoke.mjs`为明确的原生source-component验收，专门注入响应错误／时间窗口／跨表单冲突；准确建置的设置与名额流程另由既有collaborators／admissions／application-review脚本验收。

先安装与当前环境相容的 Playwright Core 和 Chromium，或使用环境已提供的二者。项目不因这项手工检查增加生产依赖。指定 Playwright 的模块绝对路径与 Chromium 可执行文件：

```sh
PUBLIC_API_BASE=https://api.artdico.host PUBLIC_CONTENT_API_ORIGIN=https://api.artdico.host pnpm build
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/registration-smoke.mjs
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/admissions-smoke.mjs
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/admissions-session-race.mjs
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/contacts-smoke.mjs
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/organizer-tasks-smoke.mjs
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/profile-media-smoke.mjs
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/contact-roles-smoke.mjs
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/exports-smoke.mjs
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/confirmation-smoke.mjs
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/organizations-admin-smoke.mjs
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/organizations-public-smoke.mjs
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/admin-navigation-smoke.mjs
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/profile-transparency-smoke.mjs
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/staff-image-editor-smoke.mjs
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/staff-operations-smoke.mjs
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/content-save-smoke.mjs
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/volunteer-smoke.mjs
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/people-relationships-smoke.mjs
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/application-review-smoke.mjs
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/settings-collaborators-smoke.mjs
```

`registration-smoke.mjs` 在手机宽度检查：正式报名关闭时不提交且可读隐私告知；一般机构／职位／经历可省略但讲者／展商按条件必填；收据明确区分已确认和候补，候补不显示或读取群码；保存结果不明时冻结原资料，明确重试使用相同内容和幂等键。另置入合成工作人员 Cookie，验证公开 API 与入群图片均不发送该 Cookie。

`admissions-smoke.mjs` 使用 superadmin／reviewer 两种合成身份核对实际人数、默认零预留、权限工具、逐人工作人员代登记、真实个人团队关联、取消与 FIFO 补位。首次工作人员回执模拟 503，明确重试必须完全保留原 body／operationId；刷新不得代为修改或丢失未保存设置。工作人员记录保留 staff_entry 来源且不伪造网站隐私同意。

历史 `staff-smoke.mjs` 曾检查住宿审核、账号、群码、备份与补齐十五个展位；其固定格数与补齐断言已不符合 P1a，不列入当前执行命令。保存与发布分开、公开投影不含联络方式、未应用修改阻挡保存等保护继续有效，由相应当前案例验证。

`admissions-session-race.mjs` 在真实 DOM 中延迟合成 GET、写入回执和 onChange，验证登出、换账号及角色后不重填旧私有资料，不解锁新操作，旧读取也不能覆盖较新结果。五种情境均检查页面错误。

`contacts-smoke.mjs` 检查拒绝联络对象不可被批量选择，代登记必须先经过预览，以及真实浏览器解析生成的纯合成 XLSX。预览与确认均绑定原始文件 SHA-256；未勾选来源核对前不能导入。测试工作簿由 `synthetic-workbook.mjs` 在内存生成，不提交任何 `.xlsx` 文件或真实名单。

`organizer-tasks-smoke.mjs` 检查手机待办页、负责人／类型筛选、editor 不读取私有来源、人工发出与服务商接受分开统计、新旧记录按人去重，以及真正生成合成 PNG ZIP。下载不写发出记录，登出后清空名单及私有 Blob 下载链接。

`profile-media-smoke.mjs` 检查大照片自动缩放、EXIF 方向、过大图片在调用 API 前拒绝、人物角色／简介／网站的公开授权、工作坊链接，以及停止公开后保留后台原件。`contact-roles-smoke.mjs` 检查同一人的多重参与身份与逐场次职责、保存后总览及待办、完整联系人 Excel 下载和退出清除。

`exports-smoke.mjs` 实际读回报名及原始联系人 XLSX，核对筛选／联络资料范围、权限、未知写入回执与登出清理；并确认报名审核不再读取已集中到设置页的通知资料。`confirmation-smoke.mjs` 覆盖真实报名跳转、手机确认页、A4 PDF 打印与临时隐藏私密 fragment、候补／撤回／失效链接、刷新失效后清除资料、同页换链接的晚到回应，以及使用一次性合成证书生成并下载真实签章 PKPASS。没有使用真实 Apple 凭证，也没有进行真实 iPhone 加入验收。

组织后台检查覆盖独立名录、旧草稿只读不迁移、真实图片缩放及保存／发布、一般参与不占用展位、停止公开保留原件与会话／晚到回应。`organizations-public-smoke.mjs` 核对 320／390／1440px 卡片、保留比例的匿名图片、安全链接、姓名可读回退，以及显式空名单、503 或坏回应不会重新显示旧四个名称。

`admin-navigation-smoke.mjs` 核对六个工作人员主工作区的左侧入口及当前页面标记、登录前／退出后的隐藏、桌面长页固定导览，以及 320／390／768／1099px 的手机收合、键盘开启／Escape、区块焦点与表格局部滚动。页内跳转保留未应用的修改，跨页仍触发既有未保存提示；直接重开区块链接恢复位置，既有嘉宾私密深链保持表单焦点。导览不得保存、发布或发送。可用 `ARTDICO_DIST_DIRECTORY` 指定另一个已构建目录，默认读取本项目 `dist`。

`profile-transparency-smoke.mjs` 直接加载源码并拦截全部网络，验证真实 PNG 透明像素、默认白底 JPEG、不透明 JPEG、EXIF 与大噪声图有界压缩。`staff-image-editor-smoke.mjs` 验证现有／新图片的真实裁切像素、缩放／拖动／触控、取色去背和画笔、明确应用／取消、晚到编码结果、503 原内容手动重试、401 清理、授权随新图关联重核，以及旧 401 不会清掉新帐号。

`staff-operations-smoke.mjs` 检查设置中心的真实就绪／过期状态、权限隔离、明确设置变更与未知回执原操作重试，以及单人工作页的名额／身份／安排、权限受限／未关联／暂不可用、私密资料清理和晚到回应。它不测试实际寄件，不调用真实账号或读取正式资料。

`content-save-smoke.mjs` 检查展位输入未应用时的离页保护、应用后仍需明确保存的提示、保存后刷新回读，以及冲突／未知回执保留本页草稿。明确保存不等于发布；手机底部保存入口不得遮住最后的表单操作。

`volunteer-smoke.mjs` 使用真实志愿者 API、服务与内存审计仓库，全部请求拦截且只含合成人员。它在 320／390／1440px 检查完整权限、现有人员明确关联、沟通与可服务时间、岗位班次与人次缺额、相邻／冲突排班、保存结果不明的原操作手动重试、未保存防呆、晚到回应及会话清理；实际读回 OOXML，核对最小导出、明确包含联络资料及审计与私密 Blob 清理。它不创建正式报名、发信或发布。单人工作页另检查志愿分工摘要及原人员深链。

`people-relationships-smoke.mjs` 将实际 runtime、鉴权、联系人、内容、转换及共同名额服务接到合成内存 OSS，拦截全部浏览器请求。覆盖稳定人员／组织 ID、多重公开角色、关系筛选与来源失败、成员明确保存、权限与未保存防呆，以及真实 300 人共同名额、最后一席／候补、重复保存、撤回关联、历史已答应者明确预览／同步、来源修订冲突和保存丢回执。公开人物先保存并发布撤回后才能换人，新人须另行保存公开授权并明确发布；测试仅对此合成流程逐次放行发布。为验证全局会话清理，故障注入使一笔已取消的候选读取仍送达旧回应，核对同一会话 401／403 与换帐号旧回应分别处理。测试信仅在内存 stub 中记录，不实际发送。

输出只包含合成验收项目与路由名称。截图及打印 PDF 写入忽略的 `.local-data/browser-evidence/`，只含合成资料。二十组脚本均拒绝未拦截的页面来源，并检查页面执行错误。它们不在默认 `pnpm test` 中；默认测试仍覆盖纯函数与服务端边界，实际浏览器操作应在有 Chromium 的环境单独执行。

`application-review-smoke.mjs` 是人工审核阶段的公开申请／后台联动验收，使用实际 runtime、鉴权、v3 名额账本、确认通知和内存 OSS，全部 HTTP 请求拦截。覆盖 320／390／1440px 单页简表、学生身份、未问字段省略、同一申请的选填分享主题、重复点击、公开保存未知回执的原正文／幂等键重试、私人待审收据与 A4 打印。待审不占名额，可有独立申请回执，不发正式确认信、不读取已设置群码或提供 Wallet；内部 `approved` 核查意见不能取得名额。分别从详情与逐人表格明确核准／拒绝，验证核查保存失回执时不发正式确认信、GET 核对不代为执行、明确重播同一审核操作只寄一次。另验证已核准候补转正、未审者不自动递补、当前学生身份与原始身份同时保留／可筛选、reviewer 与 superadmin 工具差异、权限先于读取及会话失效清理。

该脚本与本阶段调整后的 `people-relationships-smoke.mjs` 才采用「新公开申请先待审」语义；后者在真实 300 人场景明确核准新申请后再验证候补，不能直接把提交当成占位。较早 `registration-smoke.mjs`／`confirmation-smoke.mjs` 的三步骤表单部分是旧流程验收，不能作为新版简表的通过证据。邮件只由合成 provider stub 记录，不代表真实 EmailJS 寄送或收件；没有真实报名、群码、Apple 凭证或名单输入。

`settings-collaborators-smoke.mjs` 使用真实 runtime、账号服务与内存 OSS，覆盖 320／390／1440px 管理员账号入口、两位协作者的明确建立及真实登录、独立密码与四项活动权限。完整协作者读取群码和通知设置，完全不请求账号或维护 API；部分角色不读取私有设置。检查真实账号保存失回执和坏回执、目录 GET 不能证明密码、刷新后保持待核对且不重送；本机草稿仅保存非敏感填写，明确恢复不创建账号，密码／密钥／图片不进入 IndexedDB。另核对登出清除本机资料、401 清空私有 DOM 和密码后仍能重新登录，以及同一账号验证后恢复填写。全部账号、密码与通知均是隔离内存合成资料，不创建或联络正式工作人员；输出不包含密码。
`public-drafts-smoke.mjs` 使用真实 Chromium IndexedDB、实际隔离 runtime 和内存 OSS，拦截全部 HTTP。覆盖 320／390／1440px、本机草稿刷新恢复且不恢复隐私勾选、尚未落盘的立即刷新提醒、已落盘刷新免提醒、容量失败不假报保存、两个页签的 CAS 与明确恢复。提交回执丢失后刷新，仍保留原正文及幂等键；即使申请关闭或告知版本改变，也只在明确操作时取得新令牌并核对原申请。另验证未知结果后的 422 不清原记录、首次明确 422 的原子恢复／失败保留，以及跨页签提示碰上延迟本机 ACK 或飞行中的提交时不会假报已同步或提前解锁。运行方式：

```sh
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/public-drafts-smoke.mjs
```

本机自动暂存仍有短暂写入时间；浏览器关闭、进程崩溃或存储配额中断时无法承诺最后一个字符已落盘。页面只在 IndexedDB 完成回执后显示已暂存；离页提醒用于尚未完成的本机写入与结果未明的原申请。该脚本不使用内存存储替身，也不连接正式服务或发送真实邮件。
# 2026-11-03：活動行一般報名與講者申請

一般報名CTA固定前往活動行，不受本站講者API可用性影響；本站新表單只送`['talk']`，服務端待審、不占席。`registration-auto-ui-smoke.mjs`沿用10案與既有回執prefix，現在驗獨立講者及舊一般申請的精確恢復；不把舊測試檔名當成目前普通報名仍在本站的依據。

`p2-directory-smoke.mjs`保留原4案，增加320／390／1440三段出席及歷史未知寄送，共7案，CI新增必要gate。成功prefix為`People attendance directory browser verified:`，必須7案、0頁面錯誤、sourceCommit／公開與contacts／person HTML SHA及script SHA齊全。狀態篩選由後端先於分頁執行；同次已寄但未回覆、舊收件人unknown、當前accepted但歷史unknown、核對不重寄、返回同人焦點及手機無溢出都保留。

`p5-homepage-smoke.mjs`7案另外驗7個一般外連、講者錨點、無JS手機點擊及FAQ鍵盤焦點；`p5-faq-application-smoke.mjs`12案、`application-review-smoke.mjs`15案按新表單更新，保留原正文／key／審核／授權／未知結果守門。所有瀏覽器仍以本地產物與隔離服務全攔截，不讀正式名單或實寄。正式來源資格由最終CI產物另驗。


## 中英文介面

`ARTDICO_CHROMIUM_BINARY=/usr/bin/chromium node tests/browser/language-smoke.mjs`：10 案包含四寬度、瀏覽器語言、自訂偏好、重載、儲存封鎖、無 JS、切換保留表單值、動態狀態與本地錯誤翻譯。全部請求攔截，僅合成資料與 GET，不向正式平台提交。報告及截圖在 `.local-data/browser-evidence/language/`。

既有中文畫面斷言的 CI runner 明確設 `locale: 'zh-CN'`；新語言測試獨立使用 en-US／zh-TW／其他語言，不靠 Playwright 預設值。

2026-11-08追加：homepage-gallery四寬含2.5秒自動輪播、hover／focus／大圖／離屏／合成hidden／途中減少動態暫停、13作品拼貼與刷新焦點、嘉賓照片開關。正式素材13案另驗全部作品縮圖的實際封面bytes／decode／包含與不重疊；1920案開啟隨機照片後核對最多兩張成功decode照片、再關閉。原有逐人文字／手動操作／漂浮驗證先明確關閉自動照片，不弱化原斷言。擷取保留Logo／照片30張8MiB原上限，作品封面另30張24MiB上限；每張仍2MiB，全部共用60秒期限。

2026-11-08現場體驗四球：既有home-scroll-motion六案於四寬實測獨立時間漂浮、native wheel往返的額外位移、手機12px／桌面24px上限及不碰撞、動態圓內星點alpha為零；離屏／明示合成hidden停止，途中減少動態清零並可恢復，無IO沒有新增RAF。沿用既有背景30／16fps時鐘，不增加另一動畫迴圈。每案factBubbles欄與截圖獨立記錄。
