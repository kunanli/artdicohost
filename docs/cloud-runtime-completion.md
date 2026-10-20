# 生产后台、正式报名与维护装配

本阶段把分别测试的模块装配为同一个固定来源、同一私有桶和同一持久会话的生产应用。构造组件本身不写入、初始化或发布任何资料；业务仍由受控发布流程在真实合成验收后明确启用。程序构建／配置成功不是云端写读或登录成功的证据，实际运行结果由开发交接记录单独列示。

## 服务端配置

内容运行时继续要求 production、准确 `https://api.artdico.host`／`https://artdico.host`、香港本站私有桶、工作人员 bootstrap JSON 与平台临时角色的三项字段；没有部署金钥 fallback。缺项时所有业务保持 503。

正式报名另要求：

- `ARTDICO_REGISTRATION_ENABLED`：精确 true 或 false。
- `ARTDICO_REGISTRATION_POLICY_JSON`：服务端核定的完整隐私告知、活动 ID、明确时区的开放及截止时间、capacity；enabled 必须与独立开关一致。
- `ARTDICO_REGISTRATION_CAPACITY`：1–1000 的整数字符串，必须与 policy.capacity 完全相同。
- `ARTDICO_REGISTRATION_TOKEN_SECRET`：受控服务器生成、至少 32 字符的独立 base64url secret，不来自访客或公开构建。

活动 ID 固定为当前 `ggj-cn-2026`。运行时在配置的开放时刻验证完整政策语法，实际服务在每次新提交／token 申请及提交前重新核对当前时间、容量、幂等与正式同意。政策缺项或不一致只关闭正式报名，不把未知值当默认；内容后台仍可正常提供已配置的功能。关闭报名后，已确认保存的同键同内容收据可按原规则重放，撤回／删除待办阻断重放及群码。

报名收据、群码读取与邀请操作的撤回判断共用 `reviewStore.isWithdrawn(id)`，只核对审核 journal，验证修订、审计与删除待办后返回；不为每次公开请求加载整份私有报名名单。工作人员转换保留原本未提供的字段为空缺，不能因此使已经保存的报名返回失败或伪造出席／住宿答案。

## 精确路由与公开别名

现有自定义域名已允许 `/api/admin/*`。为避免另改云端路由配置，正式报名提供以下精确公开别名；`admin` 字样不构成权限，实际边界由对应处理函数执行。

| 公开别名 | 内部 canonical 路径 | 方法 |
| --- | --- | --- |
| `/api/admin/registration/config` | `/api/registration/config` | GET、OPTIONS |
| `/api/admin/registration/token` | `/api/registration/token` | POST、OPTIONS |
| `/api/admin/registration/submit` | `/api/registrations` | POST、OPTIONS |
| `/api/admin/registration/group-invite/<签名>` | `/api/registration/group-invite/<签名>` | GET、HEAD |

重映射只改变上述路径，保留真实 Origin、方法、请求头、正文及取消信号；不接受其他别名、任意代理目标或 wildcard。公开提交只允许准确主站 Origin、无跨域 Cookie，正式输入在解析前限制 128 KiB。群码仅允许有效收据的短效签名图片链接，不存在匿名「当前群码」接口。

复数 `/api/admin/registrations` 及其详情／review／export／deletion-request 仍是受保护审核 API。公开别名不改变它们的会话、reviewer／superadmin、Origin、CSRF 与最小导出要求。`/api/admin/users` 只允许 superadmin 管理额外账号，bootstrap 账号受保护；账号停用或角色／密码变化使旧会话立即失效。

联系人转换、邀请和分配先派发至精确的 intent-invitations 处理函数，再进入通用联系人处理函数；不重建原始来源、伪造申请人同意或把生成邀请当成已发送。EmailJS 默认关闭，外部提供者缺配置时仍可使用手动邀请流程；接受请求不等于实际送达。

原始联系人导入单独派发 `/api/admin/contacts/import/preview` 和 `/api/admin/contacts/import`，验证原始文件 hash、预览 token、版本及明确来源确认后一次 CAS 入库。只有这两个精确路径允许最大 3 MiB HTTP body，处理函数在角色／会话／Origin／CSRF 后再次执行自己的界限。`planning.features.protectedContactImport` 明确指示云端新契约，不借用邀请功能标记推断导入格式；本机旧契约保持独立。

## 后台静态文件与公开站点

FC 包只装配 `/admin/`、`/admin/contacts/`、`/admin/registrations/`、邀请底图及这三页引用闭包中的明确脚本／样式／字体。每个文件绑定完整源码提交与 SHA-256；新报名、审核、群码、账号和维护模块都进入精确源码白名单，没有全目录上传或外部 Node 依赖。

公开 OSS 的三个 `/admin/` 页面是前往 `https://api.artdico.host/admin/` 的入口说明，不包含工作人员表单、脚本、私有图片或账号资料。静态页面不声称服务已可用；以实际云端入口和后台结果为准。新增页面与 HTTP 重定向都精确列举，不读取其他文件或任意目录。

初次公开内容仍采用已有静态活动事实作为 fallback。生产构造器不自动发布草稿；工作人员可在后台核对并明确发布。若未来做自动初始快照，必须另设源提交绑定、空 journal 条件与 CAS 的受控阶段，不能覆盖任何既有草稿或已发布资料。

## 备份、恢复及维护

`/api/admin/maintenance`、`/backup`、`/restore` 共用同一生产 auth；只有 superadmin 可访问，写入要求准确 Origin 与 CSRF。操作审计持久化于独立 maintenance journal。浏览器加密备份只覆盖明确的内容／联系人／报名 index／审核／邀请／群码／维护 journal，并沿已验证历史快照追踪报名及图片；不包含工作人员摘要目录、会话或登录额度。

恢复只写入新的隔离前缀并核对所有引用与 hash，不切换线上状态、不复活旧会话。开始记录与完成记录分开，失败不能报告完成。浏览器备份上限 1.5 MB，恢复 JSON 上限 2 MiB；仅此精确恢复路由允许大于通常 1 MiB 的 HTTP body，处理函数仍执行自己的界限。

删除请求返回 erased:false、maintenanceRequired:true；这不是彻底擦除，运行角色没有新增 Delete／List 权限。独立备份保存、真实资料保留到期执行和受控维护身份仍须由交接与实测证据明确记录，不得把在线快照称为独立备份。

## 验证与回退

新增 `cloud-registration-runtime.test.mjs` 从真实应用装配调用合成 OSS HTTP 服务，验证 canonical／别名的正文与 CORS、幂等保存与重放、审核／账号／维护角色拒绝、配置缺项及容量不一致、群码回读、撤回后的旧链接拒绝，以及公开入口绝不列出报名资料。原 HTTP／生产入口／包白名单和公开 OSS 发布检查同步覆盖第三个后台页面。

真实 OSS 合成验收复用同一 `createCloudApplication` 组件装配，但将**所有**对象类别映射至私有 acceptance run 前缀，使用内存生成的合成账号及政策；不会消费正式容量、会话、登录额度或原群码。读健康证明不会触发写入。

失败时先保持或重新关闭内容业务，按现有受控生命周期流程核对精确环境和源码，再恢复已验收代码。源码回退不等于回退报名、内容、审计或撤回状态；不覆盖私有 journal、不改 IAM／DNS／签名 trigger，也不盲重试未知保存结果。
