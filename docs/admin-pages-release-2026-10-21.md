# 后台独立页阶段：开发与发布记录

当前feature分支 `feat/admin-independent-pages`，[草稿PR41](https://github.com/kunanli/artdicohost/pull/41)，来源为已正式发布main9b9c418与最终证据9de61c6。**本阶段尚未发布，不将代码／合成验收当已上线。**[契约](admin-independent-pages.md)；用户追加的公开同步、红绿状态与统一作品另在[下一阶段计划](games-publication-plan.md)，须本阶段实际发布后继续。

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

root完整suite **1234/1234**通过（82.249933344秒），依赖审计无已知漏洞，源码边界 **530文件**通过。Astro **393文件、0errors／0warnings／1既有hint**通过。路由／草稿／保存状态／设置定向 **35/35**、新别名HTTPS verifier **10/10**、原子暂存owner **45/45**、controller owner **51/51**通过。原始路由owner **67/67**与Python语法通过；未以此替代准确来源ZIP或云端证据。

原生验收已找出并修正：取消编辑时尚未执行的暂存timer留下空恢复记录；FC共用HTML需运行时同步tab标题；核对成功后继续前往不能再多写一次；展位编辑须保留表单外已有website，否则兼容store补回字段造成严格ACK拒绝。另将已证明的写入与其后UI／本机清理错误分别处理，不能把已保存状态退为未知写入。保留严格ACK与原稳定ID。

最新产品冻结rootb2997ad／dist **15:07:51 UTC**、23页；原生脚本以FC实际canonical HTML别名而非各自生成页测试，**39/39核心、组织4组、人员关系23组、图片编辑12组、planner组件9组全部通过，零pageerror**。展位网站可修改及清空，刷新后核对；旧raw缺website仍相容，原未知正文不变。root另核对可编辑字段与暂存白名单，仅原图file输入刻意排除；20项保存／草稿定向通过。320／390／1440保存按钮实际hit-test与截图通过，无整页横向溢出。证据在browser工作树`.local-data/browser-evidence/admin-independent-pages/`，provenance记录冻结来源与canonical HTML SHA；planner9于root执行。图片测试仅修正先填原姓名、再打开会锁定表单的图片编辑器顺序，保留图像／晚回断言。

构建初次42资产超限已用三个无启动副作用的草稿helper共用chunk解决；已测闭包 **40资产／7,342,238字节／最大1,661,625字节**（网站最后修补前，最终以准确ZIP为准），无放宽限制或删除旧图／字体。PR41初版09dae51的run39622289096／job119298631755全绿：1234单元、Astro394文件、两个实际ZIP离线启动、128files云候选及46公开入口均通过，候选绑定PR merge b69dee3d3e92fb3d0849f82e584f3beef14918c5；该证据不冒称最后website修补版或已部署。最终准确head CI／ZIP／本机受限启动仍须完成。

## 接续顺序

1. 控制器及原子helper已整合。UI／设置／路由／草稿／浏览器工作树为 `/workspace/admin-pages-{ui,settings,routes,drafts,browser}`，controller为`/workspace/admin-pages-controller`，已集成提交不重复cherry-pick；只接实际回归发现的修正。
2. 完整检查／源码／Astro／测试／构建／审计，冻结root/dist并执行真实Chromium，修复后只针对新变化重验。不要并行资源密集XZ测试与浏览器。
3. 实测128files／40assets／8MiB及原上传限制；共享routehelper并入既有纯合约chunk，不能因为多页面放宽限额。准确head候选ZIP／受限Docker后才开PR／准确CI／merge。
4. main保持稳定，考虑此前push索引可延迟7分以上；等待准确SHA的run，不因一次查无run而前进main。核对真实OSS／共同300／全部HTTPS后补本记录及恢复入口，再进入下一阶段。

所有业务测试均合成隔离，不实际建用户、替真实人确认授权、导入名单或发送邮件。不改现有EmailJS密钥／开关、IAM、DNS或云资源。
