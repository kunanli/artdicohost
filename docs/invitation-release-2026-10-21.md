# 新版邀请函与私人 PNG：验证记录

产品来源 `f9e5ea8`，在已上线 PR #38／main `19fe621` 后单独实施。**尚待准确候选 ZIP、PR／main／实际发布，不能称已上线。** [契约与操作](invitation-poster-v2.md)。

## 实施与验证

- 用户空名海报保留固定视觉，动态姓名／ISO日期显示斜线／时段／地点由保存事实绘制；新 V2 与旧模板分开，姓名120字、地点300字完整布局，不截断。四包真实上传字体合计4,607,936B，完整Medium30890cmap、派生改名、每包完整OFL。实际WOFF2 Brotli解码／cmap／SHA／权重／授权合同3项通过，不依原TTF或FontTools于CI。
- Legacy五键JSON/hash不默认添字段；新manual ID带contentdigest，旧邮件/outbox/unknown身份不变、不补寄。旧手动记录不冒充新版current，但历史contacted继续统计。两store对与旧派发时间碰撞的新设置零写入拒绝，稍后明确重试。
- 只有immutable public且fresh confirmed（含crew）获得私人descriptor；v1/v2不要求补审核，其他状态与工作人员代录 false。生成前／PNG完成后核对本人事实，忽略他人globalrevision，下载不写staff状态或发邮件。hash/pagehide/新读清图与URL；skiplink只focus不覆盖能力码。
- 本机完整第一轮 **1176/1176**、0失败，**86.740681932秒**；最终增补149定向、18file-store、42lifecycle/client/batch通过。最终产品来源 `f9e5ea8` 的完整复验 **1182/1182**、零失败／取消／跳过，**84.139525025秒**通过；不合并重复测试次数。
- 最终源码 **512 files**、Astro **380 files**（0errors、0warnings、1既有hint）、**10页**构建与依赖审计通过。冻结构建 **13:06:38 UTC**，来源f9e5ea8；随后仅文档／测试变更时不替换产品来源证据。
- 原生Chromium最终 **24/24**个人确认／实际字体／真实PNG、**11/11**手动／批次、既有contacts含XLSX/代登记通过，零页面错误。320／390／1440px实际截图与完整120字PNG已目视检查，无遮挡／横向溢出；覆盖字体404/慢载、缺字、身份/状态变更、toBlob晚回、撤销已生成Blob、历史版本、首-/_编号与pagehide预检零新POST。所有HTTP拦截、合成人员／内存OSS，零真实报名／邮件。
- 候选资产闭包已确认40件约7.33 MB（6.99 MiB），单件最大旧PNG1,661,625B，仍为128files／40assets／单件2MiB／合计8MiB原限额；准确ZIP与真实离线启动待执行，不能以闭包计数替代。

## 发布接续

准确包与离线成功后，提交PR并等待精确head完整CI；合并后核对main、真实私有OSS／300政策与exactHTTPS，另补实证。不使用真实人员、邮件、群码或凭证作测试，不创建正式协作者账号。两个账号需现有管理员登录用户管理保存，Wallet等待真实签章。

## 发布包容量阻挡（13:13 UTC，尚未 PR／部署）

准确候选来源 `d02c573dfdca4c72f9bc50fb6feb689169443e61`：128 files／40 assets／7,326,049 static bytes 符合原资源限额，但旧 Node XZ preset6 29,494,612B 令 stored ZIP 为 **37,769,494B**，对应 code-only JSON **50,359,351B**，超过既有 **48,000,000B** request／**35,999,982B** ZIP预算，builder正确拒绝，没有 manifest成功或任何实际部署。

不提高任何限额、不删旧模板或字形、不改官方 Node pin。正在/tmp比较 X86 BCJ＋LZMA2 无损压缩；preset6/7/8 已保持 CRC64、原官方 SHA、96MiB decoder 通过，但还不够小，继续验证。120秒是 producer压缩／打包子程序限制，INSPECT是30秒；launcher有限输入／输出和平台启动边界不变，不能宣称其另有120秒内部计时器。最终方案需通过同一官方 Node、准确候选ZIP和 Docker512MiB/.35CPU/no-network启动，才创建PR并继续发布。

### 已选择的容量修复（实现／验证中）

纯XZ的BCJ6/7/8/9及极端选项均不足；最佳28,218,632B runtime仍差约494KB。保留原全部字体与历史图，不采用删字／改水平字形／垂直功能裁剪。方案为 **BCJ6＋仅明确文字文件的ZIP deflate6**：/tmp实测文字从1,831,809B降至562,706B，省1,269,103B；加BCJ6预估ZIP35,642,219B，原35,999,982B cap不变。

新验包只对现有白名单文字允许method8；图片、字体和runtime仍stored；文字总解压预算额外限制4MiB，每件仍原1MiB/2MiB/64KiB限制。Node24 `inflateRawSync` 限output，严格检查engine.bytesWritten等于全部compressed bytes，拒绝尾随／串联；实际CRC32、原SHA、local/central、顺序／模式／无gap都核对。旧stored包继续接受。未改bootstrap/XZdecoder/官方pin/96MiB/192MiB/上传与静态上限。最终仍须准确来源实包及受限Docker冷启动，当前不视为发布完成。
