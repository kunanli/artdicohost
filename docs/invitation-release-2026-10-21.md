# 新版邀请函：实际发布与验证

新版邀请函 [PR #39](https://github.com/kunanli/artdicohost/pull/39) 与接续文档 [PR #40](https://github.com/kunanli/artdicohost/pull/40) 已合并，正式 main **`9b9c418ca32a5c93b5c0260732dc5630bc5793c7`** 已成功发布。**2026-10-21 22:00:20（UTC+08）**完成，内容与报名已恢复启用。[操作](invitation-poster-v2.md)、[验收](morning-acceptance.md)。

## 正式发布证据

[main run39611733126](https://github.com/kunanli/artdicohost/actions/runs/39611733126)，push／attempt1，三个job全部success；远端main再次核对同一完整SHA。

| 验证 | 实际结果 |
| --- | --- |
| check119262059603 | **1194/1194**，0失败，**62.058392723秒**；515文件源码边界、382文件Astro（0errors／0warnings／1既有hint）、10页建置与依赖审计通过 |
| 准确发布包 | 128 allowlisted files／40静态资源，准确main来源验证；预检与内容两份实际ZIP均通过无网络、只读、非root、512MiB／0.35CPU受限启动 |
| FC119263914746 | 13:55:56.0840705 UTC quiesced；13:58:48.5912822 acceptance-armed；**13:59:08.6727580 activated** |
| 真实私有OSS | 固定十阶段通过，两个独立客户端／一个FC进程；1000请求／90秒预算保持，不虚构实际请求数 |
| 报名政策与名额 | **13:59:10.0583066 UTC** 实际alias与核定政策、共同300验证；source为9b9c418，contentEnabled／registrationEnabled均true |
| public119265823486 | **33/33 HTTPS**逐档大小／SHA／MIME及可呈现HTML符合准确main；**14:00:17.4400904 UTC**总结成功，包含新WebP、四份字体及确认页 |

额外从本工作区对API origin读取五件新静态资源，直接连接与正常代理均在收到HTTP前受环境egress政策阻挡；**该额外检查不算5/5成功，也不是内容hash失败**。没有停用TLS或绕过策略。正式部署流程已独立验证artdico.host的全部33件，含这五件同字节资产；API静态闭包另由准确来源实际ZIP的40件离线启动验证覆盖，不把本地连接失败冒充线上成功。

## 产品与原生验证

- 用户空名版式另存V2背景，旧PNG模板保留。日期／时段／地点／完整姓名按实际保存事实绘制；120字姓名与300字地点有界完整排版，不截断。字体或字形失败不假成功。
- 上传Medium全**30890**codepoints保留，三包Medium＋一包Regular合计**4,607,936B**；派生改名、每包完整OFL及原版权。[覆盖与SHA](invitation-font-manifest.json)、[许可](licenses/invitation-fonts-OFL.txt)。实际WOFF2解码／cmap／权重／授权合同通过。
- 旧五键JSON/hash、旧邀请图与发出历史保留；新版manual ID含内容digest。邮件ID／outbox／unknown去重不变，新图不补寄、不重置已联系事实。
- 只有immutable public且fresh confirmed（含crew）提供私人PNG，旧v1/v2 confirmed不补审。生成前后核对本人事实与资格；其他人的globalrevision不阻挡本人下载。hash／pagehide／换人／晚回Blob取消，旧图及URL清除；skiplink保留私人能力码。下载不写staff已生成／已发出，不发邮件。
- 本机最终产品回归**1182/1182**、84.139525025秒；另12项新包装边界通过。产品来源**f9e5ea8**／13:06:38 UTC冻结十页构建；随后只有构建工具、测试和文档，官方PR与main复验包含最终1194项。
- 原生Chromium最终**24/24**个人／实际字体／真实PNG，**11/11**手动／批次，既有contacts含XLSX／明确代登记通过，零页面错误。320／390／1440px与完整120字PNG已目视核对；字体失败／慢载／缺字、资格变更、旧版本、toBlob晚回、pagehide预检零新POST及首-/_合法编号覆盖。
- 所有业务测试均合成人员、拦截HTTP或隔离OSS；未导入／代登记真实人、未实寄邮件，现有EmailJS设置保留。

## 容量修复与准确本地候选

初次候选d02c573有128files／40assets／7,326,049静态bytes，但旧preset6 stored ZIP为37,769,494B、code JSON50,359,351B，超过原预算，builder正确拒绝；没有将失败包发布。

采用**X86 BCJ6＋仅现有白名单文字的ZIP deflate6**，不删字形／旧图，不放宽原35,999,982B ZIP／48,000,000B上传、静态单件2MiB／合计8MiB、XZ96MiB decoder／192MiB输出限制。文字额外4MiB总解压预算，逐件有界输出、完整输入消耗、实际CRC32／SHA、local／central／顺序／权限／无gap核对；旧stored仍接受，二进位不deflate。官方Node24.19.0与原SHA保持。

精确head **`58f8ae9f87c4d84f29a1b4664af5d0235a1a20ee`** 本地候选：128files／40assets／7,326,049staticB；ZIP **35,642,099B**、code JSON **47,522,823B**，strict source与官方Node SHA通过。同一ZIP受限Docker **14.97秒**通过bootstrap／closedMode／syntheticConfigurationOnly及40资源。120秒是producer限制，inspect30秒；不宣称launcher另有内部120秒计时器。

## PR与延迟触发历史

- PR #39 head58f8ae9；[run39608895601](https://github.com/kunanli/artdicohost/actions/runs/39608895601)，check119252233490：1194项、85.556636539秒全过；测试merge树f71fe011。13:37:31 UTC合并main29c9bd3。
- push记录曾查不到run／suite；旧main的[run39610687104](https://github.com/kunanli/artdicohost/actions/runs/39610687104)实际created13:44:52，比合并晚7分21秒。不能由当时缺记录推断根因。workflow与所有push门禁未改。
- 接续文档PR #40 head49ec88f，经[run39610554211](https://github.com/kunanli/artdicohost/actions/runs/39610554211) check119257980541：1194项、79.599853463秒全过；515源码／382Astro／十页／审计／两份实际ZIP离线启动通过。正常no-ff合并、核对tree与已检查head完全相同，再普通非force push main9b9c418；PR #40确认merged。
- 旧main29c的check119258443970通过1194项、56.401007186秒；FC119260083807于13:48:29完成quiesced，13:50:35以CODE_DEPLOYMENT_NOT_VERIFIED停止，public skipped。底层原因未证实，不称已上传或已通过。最新main保持稳定后，run39611733126完成上述正式恢复；**不重跑旧失败运行**。

## 留给主办方

两个账号**zhouyufei／wangying尚未实际建立**：现有管理员按[账号步骤](staff-accounts.md)明确保存并私下交付初始密码。没有既有管理员会话，不以预填／测试／部署冒充创建。Wallet继续等真实Apple签章与iPhone验收。真实名单、群码与内容由工作人员核对，不因发布自动导入或群发。

此发布后证据仅保存在 `docs/invitation-final-release-proof-2026-10-21` 分支；功能部署来源仍为上述main。不要为了补文档再次启停已验证服务。
