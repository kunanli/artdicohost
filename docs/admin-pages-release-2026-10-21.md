# 后台独立页阶段：开发与发布记录

当前feature分支 `feat/admin-independent-pages`，来源为已正式发布main9b9c418与最终证据9de61c6。**本阶段尚未发布，不将代码／合成验收当已上线。**[契约](admin-independent-pages.md)；用户追加的公开同步与统一作品另在[下一阶段计划](games-publication-plan.md)，须本阶段实际发布后继续。

## 已集成

- 内容九个独立URL／单主区块／真实路径侧栏，概况链接、独立预览发布、页底右侧保存与离页对话框；原DOM／业务钩子保留。UI来源0fc9d00，root4c43f17；JSDoc与客户端／FC／公开入口13路由一致性修正b2ec3e4，rootd839c7c。
- 四个设置页分别初始化对应controller，概况／邀请不读设置API，群码不读账号／恢复，账号仅管理员。原ACK／未知回执／本机草稿及退出清理保留。来源3cf2e81，rootdbf9314。
- FC固定13路径别名复用可信HTML，不添加manifest资产；Host／方法／query／未知路径及closed限制保留。公开OSS只加对应安全入口说明，实际表单和后台脚本不公开。来源c686fd0，rootaa91f04。
- 共同workspace草稿保留，新增有界section／uncertain可选metadata；旧值原样有效，旧整体／混合编辑须明确核对。分区快照只改本页字段，其他云端base保留；首次已知拒绝支持原子恢复，历史未知不降级。来源2de84b9，root5a7faec。
- 直接保存控制器已整合：组织root540a6b0／245be26、内容与安排roota04ea7b／f31984c。只用载入的云端base组成本页完整CAS；未知结果保留原正文与稳定ID，原生弹窗内提供可点击的核对／重试。舍弃pending前读取最新云端且同步base，避免旧内容覆盖其他页面更新。面包屑保留概况链接。
- 精确ACK后残余编辑采用原子pending→editing（rootf65e01c）；配额、版本冲突或账号变化不先删除原pending。planner人员安排仍为独立journal，不伪称与内容一次事务。
- 实际合成runtime的浏览器分组与组织／人员关系／图片编辑回归已准备，**尚未在冻结建置执行**，不提前宣称行为通过。
- root29f738d添加生命周期成功后固定13子页匿名HTTPS精确HTML／SHA／CSP核对；原生产触发条件、权限及资源上限不变。10项合成测试通过，未将此当实际云端通过。

## 当前验证

root语法边界 **529文件**通过。Astro初次7个implicit-any已用共用metadata JSDoc修正，重跑 **393文件、0errors／0warnings／1既有hint**通过。路由／草稿／保存状态／设置定向 **35/35**、新别名HTTPS verifier **10/10**通过。原子暂存owner **45/45**定向、controller owner **51/51**定向通过。路由owner **67/67** HTTP／production-entry／OSS／HTTPS-verifier边界通过，Python离线smoke语法通过；未以此替代准确来源ZIP或云端证据。完整suite正在执行，之后才冻结构建与原生浏览器。

## 接续顺序

1. 控制器及原子helper已整合。UI／设置／路由／草稿／浏览器工作树为 `/workspace/admin-pages-{ui,settings,routes,drafts,browser}`，controller为`/workspace/admin-pages-controller`，已集成提交不重复cherry-pick；只接实际回归发现的修正。
2. 完整检查／源码／Astro／测试／构建／审计，冻结root/dist并执行真实Chromium，修复后只针对新变化重验。不要并行资源密集XZ测试与浏览器。
3. 实测128files／40assets／8MiB及原上传限制；共享routehelper并入既有纯合约chunk，不能因为多页面放宽限额。准确head候选ZIP／受限Docker后才开PR／准确CI／merge。
4. main保持稳定，考虑此前push索引可延迟7分以上；等待准确SHA的run，不因一次查无run而前进main。核对真实OSS／共同300／全部HTTPS后补本记录及恢复入口，再进入下一阶段。

所有业务测试均合成隔离，不实际建用户、替真实人确认授权、导入名单或发送邮件。不改现有EmailJS密钥／开关、IAM、DNS或云资源。
