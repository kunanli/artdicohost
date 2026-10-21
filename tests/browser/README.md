# 浏览器回归验收

这组可选检查使用真实 Chromium 运行构建后的页面，但拦截全部页面请求并提供纯合成 API。它不连接正式 API、不写真实报名、不读取原始名单，也不能代替真实 FC／OSS 端到端验收。

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

输出只包含合成验收项目与路由名称。截图及打印 PDF 写入忽略的 `.local-data/browser-evidence/`，只含合成资料。十八组脚本均拒绝未拦截的页面来源，并检查页面执行错误。它们不在默认 `pnpm test` 中；默认测试仍覆盖纯函数与服务端边界，实际浏览器操作应在有 Chromium 的环境单独执行。
