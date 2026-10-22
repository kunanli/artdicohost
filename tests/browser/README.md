# 浏览器回归验收

这组可选检查使用真实 Chromium 运行构建后的页面，但拦截全部页面请求并提供纯合成 API。它不连接正式 API、不写真实报名、不读取原始名单，也不能代替真实 FC／OSS 端到端验收。

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
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/staff-smoke.mjs
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

`staff-smoke.mjs` 检查独立住宿审核、工作人员账号保存、群码替换、加密备份下载入口，以及补齐十五个待确认展位、填写机构／展示／负责人／联系方式、保存与发布。公开投影不得包含负责人联络方式。另检查总览侧栏直接编辑、未应用修改阻挡保存，以及应用并保存后仍须另行发布。

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

`application-review-smoke.mjs` 是人工审核阶段的公开申请／后台联动验收，使用实际 runtime、鉴权、v3 名额账本、确认通知和内存 OSS，全部 HTTP 请求拦截。覆盖 320／390／1440px 单页简表、学生身份、未问字段省略、同一申请的选填分享主题、重复点击、公开保存未知回执的原正文／幂等键重试、私人待审收据与 A4 打印。待审不占名额、不寄信、不读取已设置群码或提供 Wallet；内部 `approved` 核查意见不能取得名额。分别从详情与逐人表格明确核准／拒绝，验证保存失回执时零通知、GET 核对不代为执行、明确重播同一审核操作只寄一次。另验证已核准候补转正、未审者不自动递补、当前学生身份与原始身份同时保留／可筛选、reviewer 与 superadmin 工具差异、权限先于读取及会话失效清理。

该脚本与本阶段调整后的 `people-relationships-smoke.mjs` 才采用「新公开申请先待审」语义；后者在真实 300 人场景明确核准新申请后再验证候补，不能直接把提交当成占位。较早 `registration-smoke.mjs`／`confirmation-smoke.mjs` 的三步骤表单部分是旧流程验收，不能作为新版简表的通过证据。邮件只由合成 provider stub 记录，不代表真实 EmailJS 寄送或收件；没有真实报名、群码、Apple 凭证或名单输入。

`settings-collaborators-smoke.mjs` 使用真实 runtime、账号服务与内存 OSS，覆盖 320／390／1440px 管理员账号入口、两位协作者的明确建立及真实登录、独立密码与四项活动权限。完整协作者读取群码和通知设置，完全不请求账号或维护 API；部分角色不读取私有设置。检查真实账号保存失回执和坏回执、目录 GET 不能证明密码、刷新后保持待核对且不重送；本机草稿仅保存非敏感填写，明确恢复不创建账号，密码／密钥／图片不进入 IndexedDB。另核对登出清除本机资料、401 清空私有 DOM 和密码后仍能重新登录，以及同一账号验证后恢复填写。全部账号、密码与通知均是隔离内存合成资料，不创建或联络正式工作人员；输出不包含密码。
`public-drafts-smoke.mjs` 使用真实 Chromium IndexedDB、实际隔离 runtime 和内存 OSS，拦截全部 HTTP。覆盖 320／390／1440px、本机草稿刷新恢复且不恢复隐私勾选、尚未落盘的立即刷新提醒、已落盘刷新免提醒、容量失败不假报保存、两个页签的 CAS 与明确恢复。提交回执丢失后刷新，仍保留原正文及幂等键；即使申请关闭或告知版本改变，也只在明确操作时取得新令牌并核对原申请。另验证未知结果后的 422 不清原记录、首次明确 422 的原子恢复／失败保留，以及跨页签提示碰上延迟本机 ACK 或飞行中的提交时不会假报已同步或提前解锁。运行方式：

```sh
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/public-drafts-smoke.mjs
```

本机自动暂存仍有短暂写入时间；浏览器关闭、进程崩溃或存储配额中断时无法承诺最后一个字符已落盘。页面只在 IndexedDB 完成回执后显示已暂存；离页提醒用于尚未完成的本机写入与结果未明的原申请。该脚本不使用内存存储替身，也不连接正式服务或发送真实邮件。
