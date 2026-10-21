# 开发接续

## 当前发布状态

新版邀请函 [PR #39](https://github.com/kunanli/artdicohost/pull/39) 与文档 [PR #40](https://github.com/kunanli/artdicohost/pull/40) 已合并并实际发布，正式main **`9b9c418ca32a5c93b5c0260732dc5630bc5793c7`**。**2026-10-21 22:00:20（UTC+08）**完成；[run39611733126](https://github.com/kunanli/artdicohost/actions/runs/39611733126) attempt1三个job全success：1194项、真实私有OSS、共同300政策及**33/33 HTTPS**通过。内容与正式报名已启用，先前延迟触发／维护已恢复。[完整证据](invitation-release-2026-10-21.md)。

当前仅文档证据分支 **`docs/invitation-final-release-proof-2026-10-21`** 以该main为基准；不要为补证据重新部署或重跑旧失败运行。

本页是恢复入口；[历史记录](session-history-2026-10-21.md)只供追溯，不重做其中旧待办。

## 已完成能力

| 范围 | 入口／记录 |
| --- | --- |
| 志愿者名单、岗位、排班、缺额及 Excel | `/admin/volunteers/`；[PR #35 证据](volunteer-release-2026-10-21.md) |
| 人员、嘉宾／讲者、组织、场次、展位串联及筛选；确认参加同步共同 300 名额 | `/admin/contacts/` 与个人工作页；[PR #36 证据](people-release-2026-10-21.md) |
| 学生类别、精简单页申请、主题提案、先审核再确认／候补及通知 | [操作](public-application-review.md)、[PR #37 证据](application-release-2026-10-21.md) |
| 自动本机暂存、刷新恢复、就近云端保存、文字精简与全业务协作者 | [操作](usability-autosave-accounts.md)、[PR #38 证据](usability-release-2026-10-21.md) |
| 邀请函 V2、上传字体、完整姓名与已核准公开申请的私人 PNG | 已实际发布；[PR #39／#40证据](invitation-release-2026-10-21.md) |
| 组织图片／链接、嘉宾资料、图片裁切／缩放／拖动／取色去背、导航、Excel、确认打印、EmailJS 配置 | 已在此前版本上线；[验收入口](morning-acceptance.md) |

## 下一步，只做尚未完成的事项

1. 先按[验收清单](morning-acceptance.md)核对实际界面；正式run39611733126已全成功，远端main同一SHA。不重跑旧39610687104、不再因文件记录启停服务。
2. 现有管理员在 [用户管理](https://api.artdico.host/admin/settings/#staff-accounts-title) 分别按「准备 zhouyufei」「准备 wangying」，核对权限并按「保存工作人员账号」，成功后私下交付各自初始密码。**正式账号尚未建立**；快捷预填、合成测试、部署均不等于创建。本环境没有既有管理员会话，不绕过认证或读取凭证。[操作](staff-accounts.md)。
3. Apple Developer enrollment完成后，按[Wallet指引](apple-wallet-setup.md)加入真实Pass Type ID／签章链并做iPhone验收；目前不冒称票券可用。
4. 真实名册、组织／嘉宾公开授权、群码与现场安排由工作人员在私密后台核对；不因开发接续重复导入、代登记或发信。若继续新功能，以最新main建立独立阶段及验证。

## 当前阶段的准确来源与验证

正式main9b9c418，check119262059603 **1194/1194、62.058392723秒**，515源码／382Astro／10页／审计与准确两ZIP启动通过；FC119263914746于13:59:08.6727580 UTC激活，13:59:10.0583066政策／300验证，public119265823486于14:00:17.4400904完成33/33 HTTPS。真实OSS为2clients／1FC，保留1000次／90秒边界，不编造实际请求数。额外本机API五资产GET受egress限制未验证，正式流程已独立验证public五资产，详见发布证据。

- PR #39 head **`58f8ae9f87c4d84f29a1b4664af5d0235a1a20ee`**；[PR run 39608895601](https://github.com/kunanli/artdicohost/actions/runs/39608895601)，check **119252233490** 全 success，1194 项，85.556636539 秒。
- 产品来源 `f9e5ea8`，13:06:38 UTC 冻结构建；其后仅构建工具、测试及文档，不改前端。最终本机 **1182/1182**、新增压缩边界 **12/12**、原生个人／字体 **24/24**与手动／批次 **11/11**、零页面错误。
- 同一 head 候选：**128 files／40 assets／7,326,049 static bytes**；ZIP **35,642,099B**、code JSON **47,522,823B**；strict source、官方 Node SHA 与受限 Docker **14.97 秒**通过。源边界514files、Astro382files、10页及依赖审计通过。
- 旧 stored ZIP 超限已用 **BCJ6＋仅白名单文字 bounded deflate6**解决；不删字形／旧图，不放宽原48MB上传、35,999,982B ZIP、静态2MiB/8MiB、XZ96MiB decoder或192MiB输出限制。生产 runtime pin 不变。
- 四 WOFF2 合计4,607,936B，Medium30890cmap全保留，每包完整OFL／原版权及派生改名；旧邀请模板、JSON/hash、邮件/outbox/unknown与实际联系历史保留。新版生成／下载不补寄、不等于派发。

## 业务事实与边界

活动 2026-12-05，10:00–18:00，深圳前海5号楼3F；09:30 为签到，不写成正式活动开始。报名截止当日12:00（UTC+08），所有参会与工作人员共同300人。处理者为 ARTDiCO HOST 活动筹备团队，隐私联络沿用受控业务邮箱，保留至2027-03-05。

公开申请先人工审核；待审不占位、不发正式邀请。核准后由同一容量CAS确认或候补。旧 confirmed 不要求补审，代登记不冒充网站同意。人员／组织只按明确稳定ID串联，不按姓名或邮箱猜测合并。

原始问卷39行曾恢复到忽略目录，38行同意联系、1行拒绝、11项选填URL警告；云端最新真实名册与安排以用户私密后台为准。本开发未导入／代登记真实人员，不能据旧恢复记录推断用户之后的操作；不重复导入、安排或群发。用户已确认 EmailJS 正常；保留 LoginPlan／template_89mgpj9 及受控密钥，不为验证实寄。

本机草稿不是云端保存；明确恢复后仍须就近保存。密码、token、原图不缓存；未知写入保留原正文／operationId，不换键盲建；通知 unknown 不重送，provider accepted 不等于送达。退出清私密DOM／草稿，云端退出未知如实提示。

## 恢复方法

先读本页、`git status`、远端main及对应Actions，再读具体阶段证据。主工作区 `/workspace/artdicohost`，AGENTS.md要求逐阶段、测试／准确来源／实际发布；不修改IGDA资源、DNS、IAM，不购买服务、不读secret、不拿真实报名／收件人测试。所有子工作树共享Git对象，已经集成的提交不要再cherry-pick。

文档：[验收](morning-acceptance.md)、[实施计划](implementation-plan.md)、[部署](08-deployment.md)、[备份／恢复](maintenance-backup.md)、[账号](staff-accounts.md)、[旧接续历史](session-history-2026-10-21.md)。修复须兼容现有v2／v3及历史日志，不用旧快照覆盖新报名；真实物理删除另走受控维护。
