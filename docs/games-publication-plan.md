# 下一阶段：公开可见性与游戏／作品

本文件是已授权下一阶段计划。先完成[后台独立页面与直接保存](admin-independent-pages.md)的实际发布，再实施本阶段，不在前一阶段混入数据契约变更。

## 实际诊断

公开页读取 `/api/public/content` 已发布快照，不读取工作人员draft；保存不等于发布。当前首次加载读取一次、no-store、不带cookie。404／旧快照缺organizations沿用初始四组织；200明确空数组才清空。用户先前截图的嘉宾pending／consentfalse、两院校consentfalse不具当时公开条件，不代为确认／授权。后续截图中多位嘉宾已confirmed但consent仍false，组织则已核实授权；须按实际最新草稿与发布快照诊断，不继续沿用旧截图状态。现有嘉宾「停止公开」动作仅凭confirmed或consent任一成立即出现，不能证明前台已公开，须改为准确状态与明确动作。

既有CI的`probe-content-endpoint.mjs`实际只GET `/admin/`，不能当匿名公开快照或前端CORS证明。下一阶段部署后须固定Origin `https://artdico.host`、不带cookie／认证、限时限量读取`https://api.artdico.host/api/public/content`，只记录revision／发布时间／各类数量或明确无publication，验证CORS和公开投影；不得输出姓名／原正文或自动发布真实草稿。404是尚未发布，不能称数据已同步；503／无效快照不能通过实际可见性检查。

## 公开进度

复用已鉴权content GET同次draft＋published，按稳定ID比较实际sanitize后的public projection，不按private JSON或全局revision猜测。展示「待确认／待授权／资料待补／可发布／变更待发布／已同步／待撤下」及对应编辑入口。公布快照仍有、草稿已撤下的记录须明确前台仍显示旧版，下一次发布才撤下；旧publication缺字段／无publication明确标初始内容。未知或无法验证来源不称同步。

独立发布页集中草稿／发布版本、时间、各类新增／更新／撤下数和完整原因，publisher明确发布；保存和路由不自动公开。前台在重新回到可见页面／恢复页面时有界、去重重读最新发布，处理取消／慢回应／较旧版本及失败，不让旧请求覆盖新显示，不定时频繁轮询。

最新用户要求：公开状态用绿色「已公开」与红色「未公开」，邀约出席用绿色「已确认出席」与红色「未确认出席」。颜色必须同时有文字，不仅靠颜色；出席拒绝显示红色「不出席」，不能误写成仍待回复。公开颜色依据实际published投影，草稿可公开但尚未发布仍红色并标「待发布」，草稿撤下但前台旧版仍存在应保留绿色已公开与「待撤下」提示，未能读取发布状态不能谎报已公开。确认出席与正式名额、公开授权分别显示，不能用绿色回复暗示300名额已获确认。各列表、个人工作页、筛选和发布概况使用一致语义。

嘉宾照片改为选填：本人资料已确认并核实公开授权后，可先以姓名首字展示；不放宽确认或授权。空图ID不请求图片端点，非空图仍严格验证／公开引用校验。姓名／职责／机构等授权范围与照片变更后重新核对保留；公开职责是可选，不能在个人页另加与实际public projection不同的阻挡。头像与职责待补应显示为建议完善，不冒称无法公开。

照片选填须同时覆盖`shared/content-schema.mjs`、`shared/guest-display.mjs`、`functions/person-workspace/projection.mjs`的publicGuestValue／publishedMatchesDraft，以及个人步骤指引和前台图片构造；不能只修嘉宾列表而留下另一套必填判定。沿用已包装模块，不增加FC runtime源码条目。

## 统一作品

前后台统一「游戏与作品」，分类学生作品／独立游戏／团队作品，复用现有`showcases[]`稳定ID、原件、历史与备份。每件作品关联单一boothId即可同一展位多作品，不增加反向booth.workIds或新journal，不将作品数／填报组员总数当去重参会人数，不改变共同300名额。

新增own-property选填 `kind:student|indie|team` 与 `organizationId:''|稳定ID`。旧字段缺省保持缺省，只在显示层视为学生；编辑其他字段不自动回填分类。新分类选择明确，旧记录可用「学生作品（原记录）」空选项保持原bytes；明确改选才写。明确空organizationId解除关系，缺省由两store保留原已保存的已知新字段，拒绝不合法新关系，历史未改变失效关系保留警告，不按名称／邮箱匹配。

组织与作品创作者关联、展位占用组织分别维护，不强制相同；公开只显示同一快照内独立已确认／授权组织的关联，不能因此公开其私密成员或联系方式。现有作品公开条件保留：核准、实际参加回复、作品授权、有效封面及至少一项已确认展位／已安排分享；资料待补时直接列原因。作品卡按work.id去重，学生／独立／团队筛选与展位／组织入口共用同一份资料。

## 相容与验证

- schemaVersion／storageVersion不提高；可选字段不改旧canonical JSON/hash／未知提交正文。两store按ID保留已知新增字段，原完整数组保护保留；不盲目保留任意未知key。
- public projection保持幂等及旧golden bytes；私人contactName/email/wechat/materialLinks/internalNotes不上网。空／未知关系、未授权组织、不合法枚举／显式null／getter不旁路。
- 本机草稿whitelist保留旧rawforms与原pending；分类显示默认不渗入历史unknown body/revision。新公开字段变更重新核对consent。
- arrangements里的旧studentTeams字段为兼容可留；文案按作品／填报成员总数说明，不重复声称学生或真实人数。既有报名／人员／志愿者Excel与名额独立，不推断用户身份。
- 完整加密备份／历史恢复证明新metadata和旧快照bytes均保留，无新blob引用类型或journal。写入新字段后修复须相容，不用旧写入者覆盖。
- 单元及真实合成运行时覆盖旧client漏字段／明确清除／失效新旧关系／多作品一展位／公開投影幂等与隐私、缺图嘉宾、readiness与投影一致、前台返回刷新及晚回失败；原生桌面／手机验证保存→发布→前台显示／撤下链路。

继续沿用Node24／Astro／既有FC和OSS及128files／40assets／原容量预算，不增依赖、权限、DNS或服务。发布只验证合成隔离资料；真实人物状态、授权、名单与寄信不由开发测试代填。准确源码／完整测试／构建／审计／ZIP／受限启动与PR通过后，保持main稳定核对真实私有OSS、300政策及HTTPS再交付。

附带UX：前阶段unknown组织弹窗已有可达核对／重试／复制，但API持续不可用时没有直接退出入口。可在原proof区复用既有显式logout确认与actor清理，不能以关闭弹窗／新autosave覆盖原pending或rawforms；不更动写入协议。

## 完成主功能后的跟进人标记

用户最后追加：前述功能完成后，「人员与邀约」跟进人名称改彩色姓名标签。同一位跟进人固定同色，保留原姓名文字与筛选；未分配用中性标记，不能与红绿出席／公开状态混淆。不改负责人数据、权限或联系记录；主流程完成后补此项并验证桌面／手机辨识与对比。
