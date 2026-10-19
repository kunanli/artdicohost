# 本地工作人员内容后台

此阶段提供可实际登录、保存草稿及发布的本地 Node.js API，用于安排场次和参展展位。它绑定 `127.0.0.1`，拒绝 `NODE_ENV=production` 或非 `local` 模式，不连接 FC、OSS、IGDA 身份或云资源。活动报名表继续为未提交资料的演示；新增的[私密意向名单模块](local-contacts.md)在独立文件和权限下管理既有联系人，不是正式报名受理接口。静态预览发布不会同时上线此本地 API，部署边界见 [OSS 部署步骤](oss-deployment.md)。

## 账号和启动

使用 Node.js `24.19.0`、pnpm `11.25.0`，先按 [前端开发](frontend-development.md) 完成冻结安装及 `pnpm build`。后台从 `dist/` 提供前台和 `/admin/`，Astro 开发服务器本身不包含此 API。

没有默认账号或密码。使用至少 12 字节的独立本地密码，通过标准输入生成 scrypt 摘要；不要把密码写入命令参数、历史、源文件或真实环境示例。PowerShell 7 可使用：

```powershell
Read-Host '本地账号密码' -MaskInput | node functions/content-api/hash-password.mjs
```

复制 `.env.example` 为已忽略的 `.env.local`，在 `ADMIN_USERS_JSON` 中配置 1–20 个账号。格式如下，`passwordHash` 必须替换为上一步生成的完整摘要；示例占位值不能登录。

```json
[{"id":"your-stable-id","username":"your-login","label":"工作人员名称","roles":["editor","publisher"],"passwordHash":"粘贴完整的 scrypt 摘要"}]
```

在环境文件中用单引号包住整个 JSON 数组。ID、用户名不能重复；只接受 `editor`、`publisher`、`outreach` 角色和 `scrypt$16384$8$1$…` 格式摘要，不接受明文 `password` 字段。`editor` 可读取和保存草稿；`publisher` 可读取和发布，只有同时具有 `editor` 时才可保存。`outreach` 专门授权私密联系人操作，内容编辑 / 发布角色不会自动继承名单权限。不要在前端 `PUBLIC_` 配置中设置这些账号。

```sh
pnpm admin:local
```

默认地址为 `http://127.0.0.1:8787/admin/`。`CONTENT_API_PORT` 可更改本地端口，`CONTENT_DATA_DIR` 默认为 `.local-data/content`，必须位于 `dist/` 之外。该目录和 `.env.local` 已被 Git 忽略。始终使用启动时显示的 `127.0.0.1` 地址；服务拒绝其他 Host 和 Origin。不要通过代理、隧道或公网转发此本地服务。

## 保存、安排和发布

首次读取草稿从 `createInitialContent()` 获得 43 个暂定场次和空展位表，修订号为 0。日期、场地、讲者及署名的确认状态继续适用。工作人员可维护场次时间、区域、标题、讲者状态及展位资料；schema 校验同区已排场次时间冲突、ID / 展位编号重复、时间范围和字段长度。

保存只更新私有草稿。发布必须由 `publisher` 明确操作，使用服务端公开投影：隐藏 draft 场次、清空待确认讲者姓名、只公开 confirmed 展位，删除全部内部备注。正式讲者姓名和展位信息须由有权限人员确认后发布，不由系统自动授予资格。

每次保存和发布都带 `expectedRevision`；旧版本返回 409，工作人员重新载入后自行决定修改，不能静默覆盖其他人的更新。新的草稿不会替换已发布内容；未首次发布时公开接口返回 404，前台保留原静态内容。重复发布同一修订返回原发布结果。

`content.json` 同时保存草稿、脱敏发布快照及操作者 ID / 操作 / 时间 / 修订号审计元数据。文件写入使用临时文件、同步、原子 rename；同一进程按文件串行处理并检查版本。只支持一个本地服务进程，不提供跨进程、FC 多实例锁或分布式一致性。文件损坏或保存失败时拒绝操作，不静默重置数据。

## HTTP 契约

所有接口同源，JSON 响应 `Cache-Control: no-store`。写请求必须带准确的 `Origin`；登录以外的管理写操作还须带 `x-csrf-token`。JSON 请求体上限 1 MiB。错误为 `{error:{code,message,fields?}}`，字段校验用 422、冲突用 409、未登录用 401、权限 / 来源 / CSRF 拒绝用 403。

| 接口 | 请求 / 响应 |
| --- | --- |
| `POST /api/admin/login` | `{username,password}` → `{user:{id,label,roles},csrfToken}` |
| `GET /api/admin/session` | → `{user,csrfToken}` |
| `POST /api/admin/logout` | 撤销当前会话并清除 cookie → `{ok:true}` |
| `GET /api/admin/content` | → `{draft:{revision,content},published:{revision,publishedAt,content}\|null}` |
| `PUT /api/admin/content` | `{expectedRevision,content}` → `{draft:{revision,content}}` |
| `POST /api/admin/content/publish` | `{expectedRevision}` → `{published:{revision,publishedAt,content}}` |
| `GET /api/public/content` | → 已脱敏的 `{revision,publishedAt,content}`；未发布时 404 `NOT_PUBLISHED` |

会话为随机令牌，内存保存，8 小时到期，服务重启即撤销。cookie 为 `HttpOnly; SameSite=Strict; Path=/api/admin`；本地 HTTP 环境不设 `Secure`，不能用于公网鉴权。登录按真实连接地址限制为每 15 分钟最多 10 次尝试，不信任 `X-Forwarded-For`。这些会话和限流均为单进程本地实现，生产鉴权仍须另行设计和验证。

静态服务器只允许读取 `dist/`，拒绝隐藏路径、目录穿越及越界链接，注入 `artdico-content-api` meta 供前台读取发布内容。CSP 仅允许同源脚本及当前静态 HTML 内脚本的精确 SHA-256，不开放 `unsafe-inline` 脚本。

## 本地恢复和删除

停止服务后，可将 `.local-data/content/content.json` 复制到 `dist/` 之外的受限备份位置；备份仍可能包含内部备注，不能公开或提交 Git。恢复时先保留损坏文件供核查，再在停服状态恢复已知有效的完整快照，启动后检查草稿和发布修订。代码回退不应覆盖内容数据。

清除演示内容时先停服，再仅删除指定 `.local-data/content/content.json` 文件；下次读取将从静态种子重新开始。删除 `.env.local` 可清除本地账号摘要；进程关闭会清除内存会话。此流程仅覆盖本地场次 / 展位演示，不能替代未来真实报名资料的删除、备份保留和恢复后再删除机制。

## 验证和后续阶段

`tests/content-api.test.mjs` 用合成账号及隔离文件测试鉴权、Origin / CSRF、角色、版本冲突、重启持久化、公开字段剥离、失败关闭、静态边界和生产模式拒绝。运行 `node --test tests/content-api.test.mjs` 或完整 `pnpm test`。当前执行结果见 [前端验证记录](frontend-validation.md) 及 PR 最新 CI；环境限制导致的跳过必须记录，不能宣称已完成本机 HTTP 验收。

FC / OSS、共享生产账号、真实报名、生产 HTTPS、跨实例限流与并发、云端备份删除仍未接通。原实施计划的云资源预检、费用和发布授权门槛不变；此本地后台不触发云端发布。
