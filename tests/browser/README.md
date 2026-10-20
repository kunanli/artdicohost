# 浏览器回归验收

这组可选检查使用真实 Chromium 运行构建后的页面，但拦截全部页面请求并提供纯合成 API。它不连接正式 API、不写真实报名、不读取原始名单，也不能代替真实 FC／OSS 端到端验收。

先安装与当前环境相容的 Playwright Core 和 Chromium，或使用环境已提供的二者。项目不因这项手工检查增加生产依赖。指定 Playwright 的模块绝对路径与 Chromium 可执行文件：

```sh
PUBLIC_API_BASE=https://api.artdico.host pnpm build
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/registration-smoke.mjs
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/staff-smoke.mjs
ARTDICO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/absolute/path/to/chromium node tests/browser/contacts-smoke.mjs
```

`registration-smoke.mjs` 在手机宽度检查：正式报名关闭时不提交且可读隐私告知；完整填写后只接受已确认收据；保存结果不明时冻结原资料，明确重试使用相同内容和幂等键。另置入合成工作人员 Cookie，验证公开 API 与入群图片均不发送该 Cookie。

`staff-smoke.mjs` 检查独立住宿审核、工作人员账号保存、群码替换、加密备份下载入口，以及补齐十五个待确认展位、填写机构／展示／负责人／联系方式、保存与发布。公开投影不得包含负责人联络方式。

`contacts-smoke.mjs` 检查拒绝联络对象不可被批量选择，代登记必须先经过预览，以及真实浏览器解析生成的纯合成 XLSX。预览与确认均绑定原始文件 SHA-256；未勾选来源核对前不能导入。测试工作簿由 `synthetic-workbook.mjs` 在内存生成，不提交任何 `.xlsx` 文件或真实名单。

输出只包含固定验收项目与路由名称。截图写入忽略的 `.local-data/browser-evidence/`，只含合成资料。三组脚本均拒绝未拦截的页面来源，并检查页面执行错误。它们不在默认 `pnpm test` 中；默认测试仍覆盖纯函数与服务端边界，实际浏览器操作应在有 Chromium 的环境单独执行。
