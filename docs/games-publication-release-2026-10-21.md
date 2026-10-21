# 公开状态、游戏／作品与跟进人标签发布记录

当前 `feat/publication-games` 开发阶段，**尚未正式发布**。基准是已实际发布main `d504ecc` 与证据 `3d04822`；不把定向测试或旧dist当新功能上线。[计划](games-publication-plan.md)、[操作](publication-games-operations.md)。所有业务验证均合成隔离，不写真实联系人／报名／授权或发信。

## 已集成的最终行为

- 实际同次draft／published公开投影按稳定ID核对；绿色已公开、红色未公开、未知中性，待更新／撤下明确保留前台旧版事实。发布页集中原因与差异，只有已ACK云端base可发布；保存不自动公开。嘉宾停止公开只撤授权，不取消已确认事实。
- 嘉宾照片与公开职责选填，名单与个人页及publicprojection一致；空照片显示首字而且不请求空图片路径。姓名／机构及确认、公开授权仍校验，非空图片引用严格校验。
- 学生／独立／团队统一游戏与作品；new默认独立游戏，旧缺分类只显示为学生，不自动补字段。创作者组织与展位占用组织独立，一个展位可多作品，前台提供分类与双向链接；私密联系人／材料／备注不上网。
- 两store兼容旧client漏字段与明确解除，原ID／历史bytes／未知提交正文保持，新增失效组织关系拒绝而旧孤儿关系保留提醒。完整加密备份含旧新历史及图片，名额仍为共同300，不把作品数或填报成员数当去重人数。
- 前台返回／可见／焦点重读，限时、去重、迟到／低版本／同revision内容冲突保护；读失败保留最后已核对版本并提示，200明确空集合可撤下。reader／晚到response实际取消，不留持续未完成读取。
- 人员与个人页按实际回复显示出席红绿；未知不会列进未公开筛选。同一跟进人姓名固定色标，原姓名／筛选值／资料不改，未指派灰色，色盘与出席红绿分开，小字对比均达AA。
- 部署激活后新增固定匿名公开data／CORS HTTPS验证，无cookie／凭据／跳转，只记版本、发布时间及数量；404明确尚未发布，不假称同步。

## 来源与验证

定向结果：domain92项、person96项／owner彩标38项、公开刷新与display24项、controller34项、root匿名CORS与既有APIalias15项；不同分组有重叠，不加总冒充独立总数。UI Astro compiler-rs／PostCSS语法通过；source-native公开renderer8组、零pageerrors，尚不能替代冻结built+actualruntime原生验收。

原生harness准备30reports：两origin save→anonymous不变→explicitpublish→returnrender、三分类／多作品／同快照组织／私密字段、旧raw与unknown exactretry、unknownproof logout、空照片、红绿及owner固定色、320／390／1440。必须待root冻结最终dist后执行，再记实际结果。

待完整source／Astro／suite／build／audit、准确ZIP／受限启动与PR CI。main保持d504ecc，准确合并后保持main稳定，核对真实私有OSS／300政策／13API别名／公开对象HTTPS及匿名公开快照／CORS，才能标正式完成；各证据分别记录，不借用前阶段数值。原128files／40assets／8MiB及单资产、ZIP／CodeJSON预算不放宽，无新依赖或FC源码条目。
