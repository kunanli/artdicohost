# 香港 FC 启动验收

日期：2026-10-20（Asia/Taipei）。香港函数 `artdicohost-api` 的运行时、精确 RAM 权限及 GitHub Variables 已配置，自动发布已获授权。最近完整验收基线为 `e82762e2f86ea3663a4e3e78d0a10d0a608ef541`；[Actions 39362633747](https://github.com/kunanli/artdicohost/actions/runs/39362633747) 的 224 项检查、OSS 12 次 SHA-256 回读及 FC 单次更新后连续三次签名 `/healthz` 全部通过，完整来源标记匹配。生命周期字段为 null，未推论 Active / Successful；FC 启动与云端业务是不同门槛。私有桶 `artdicohost-data-hk` 已创建且用户回报保存 SSE-OSS / AES256，函数身份及私有读写仍未验收。

本阶段只替换示例码并验证 Node.js 可以启动。`/healthz` 的 200 只表示进程存活；报名、后台与存储就绪均保持关闭。不要把本机 `functions/content-api/server.mjs` 上传为云端后台。

## 交付内容与来源

`scripts/prepare-fc-bootstrap.mjs` 只读取四个已提交的指定源文件与显式指定的 Node 可执行文件，以完整提交核对源文件内容，拒绝符号链接、错误架构 / 版本 / 校验值及非空输出目录；不会扫描真实名单或删除原输出。先核对官方 Node 原始 bytes，再压为 XZ；ZIP 白名单仅含六个文件：

```text
bootstrap
functions/fc-api/handler.mjs
functions/fc-api/server.mjs
functions/fc-api/launch.py
runtime/node/bin/node.xz
release.json
```

`bootstrap` 保留 `0755`，其余包内文件为 `0644`。固定的 `/code/bootstrap` 调用 `/var/fc/lang/python3.12/bin/python3 -I -S`，使用 `launch.py` 离线解压 Node 到新建的私有 `/tmp/artdicohost-node-*` 目录；原始 SHA-256 与 ELF x86_64 核对完成后才将临时 Node 设为 `0700` 并执行。损坏、截断、尾随数据、超出解压上限或 hash 不符均拒绝启动，失败清理仅限本次创建的私有临时目录。不会在冷启动下载运行时、安装依赖、配置 layer、挂载 OSS 或添加 AccessKey。

Python 3.12 是 [FC custom.debian11 官方列明的内置解释器](https://help.aliyun.com/zh/functioncompute/custom-runtime/)，当前外部启动命令、runtime、端口及触发器设置均不变。Node 仍由官方 Linux x64 发行包提取，使用 TLS 下载与官方校验清单核对，不关闭证书验证、不 strip 或更改原始二进制：

| 项目 | 值 |
| --- | --- |
| 版本 | `v24.19.0` |
| 官方目录 | [nodejs.org/dist/v24.19.0](https://nodejs.org/dist/v24.19.0/) |
| 官方 archive | `node-v24.19.0-linux-x64.tar.xz` |
| archive SHA-256 | `14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647` |
| 提取后 node SHA-256 | `bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12` |

打包脚本核对二进制校验值，不自行建立官方来源证明；来源校验须先完成。ZIP、输出目录及 `package-manifest.json` 保存在忽略的本机目录，不提交大二进制或私有资料。manifest 记录准确源码提交、每个文件及 ZIP 的校验值。准备命令（在已提交并检查过的源码上执行）：

```sh
node scripts/prepare-fc-bootstrap.mjs \
  --node-binary /absolute/path/to/verified/node \
  --node-sha256 bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12 \
  --source-commit <exact-reviewed-40-character-commit> \
  --out <new-empty-output-directory>
```

原始 Node 的已测 XZ 大小为 29,494,612 bytes，PR #12 实际 ZIP 为 29,507,159 bytes，完整 Base64 JSON 请求体为 39,342,903 bytes。打包、artifact 验证及上传端共同执行 **48,000,000 bytes 完整 JSON body** 的固定工程预算，按 Base64 膨胀与 JSON 包装精确计算，超出时不发请求。此预算是为处理已观察的 413 保留余量，不是阿里云精确上限或上传成功保证；不使用未验证的请求 gzip 编码绕过限制。

本轮修正独立客户端与部署观测，不改六文件 runtime 源码。健康检查按[现行 fcapp.run 官方契约](https://help.aliyun.com/zh/functioncompute/configure-signature-authentication-for-http-triggers)使用 ACS3、`x-acs-date`、选用 `x-acs-security-token`，payload 参数为空字串；旧 FC scheme 来自 2016 API / proxy 范围。隔离的官方 SDK `0.3.3` AK / STS 固定向量已纳入测试，没有新增项目依赖；不能把旧算法测试当成服务规格证明，也不能在实测前断言此为 400 唯一原因。

PUT 前仍以 GetFunction 和签名 health 观察旧状态，不把观察作为成功；枚举值未知时只投影 `unknown`，presence 仅区分 `absent` / `null` / `recognized` / `unrecognized`，不回显任意内容。官方 state 使用 `Pending`，`Creating` 属 reason code；补上 Pending 阻挡并保留旧 Creating 的保守阻挡，更新 `InProgress` 时也不上传。重新核对当前 main 后，native HTTPS 对同一固定香港端点发送一次同 method / JSON bytes 的代码 PUT，保留 TLS 验证，明确 UTF-8 `Content-Length`，无 redirect / retry。私有 WeakMap 只投影可信 Promise 的 `uploadBodyWritten` / `responseStarted` 两个布林；`finish` 只表示本机写完，不是 FC 已接收或确认。没有证据显示原 fetch 的 Content-Length 错误，后续基线已取得单次 native PUT 成功确认及三次签名健康证明，仍不把本机写完当服务端确认。

UpdateFunction 等待期限保持 120 秒，GET / health 为 20 秒，总期限 240 秒；不改变 FC 执行超时、IAM、`/code/bootstrap` 或签名触发器。更新后须 HTTP 200 更新确认、配置保持，以及三次连续匹配本次完整提交的签名 health；生命周期字段存在时要求 Active / Successful，仅两字段各为 own absent/null 时可依同样的三次实测来源验证并明确标记 metadata 未提供，绝不从字段缺失推定就绪；详细日志与失败处理见[自动更新说明](automatic-fc-deployment.md)。

## 控制台操作

用户要求像 `artdico-deck` 一样自动更新 FC，日常发布采用[GitHub 自动更新操作单](automatic-fc-deployment.md)。本次首次发布和后续正常发布均已获授权，检查及审阅完成后可合并到 main 并自动更新，无需逐次再申请发布确认。以下手动 ZIP 上传仅作离线验收 / 回退备选，不必先手动传包。

用户已回报运行时、RAM 与 Variables 设置完成；以下保留作核对与维护，实际配置仍由部署任务读取验证。界面文字如有差异，以实际配置页核对，不重建函数或改动其他项目。

1. 在 `artdicohost-api → 弹性配置` 将**最小实例数设为 0** 并保存，允许空闲时缩至零；0.35 vCPU / 0.5 GB 内存 / 512 MB 磁盘先沿用。缩至零会有冷启动，不表示所有 FC 费用都为零。
2. 在 **代码 → 上传代码 → 通过 ZIP 包上传** 选择已校验的 `artdicohost-fc-preflight.zip`。上传 ZIP 本身，里面的 bootstrap 位于根目录；不要再套一层目录或上传完整仓库 / `dist/`。
3. 在 **配置** 的运行时配置中保留自定义运行时 Debian 11，启动命令使用**命令模式** `/code/bootstrap`，监听端口 `9000`，执行超时 `60` 秒。将原 `python3 app.py` 替换掉。保存代码与配置，确认部署完成；不添加任何密钥环境变量。
4. **触发器** 保留当前签名认证。使用已登录控制台提供的 HTTP 测试，方法 `GET`、路径 `/healthz`，不填任何真实报名资料。若当前测试入口只接受事件 JSON，先核对 HTTP 测试入口，不随意填写签名或改成匿名认证。
5. 检查响应体 `status: "ok"`、`scope: "process-only"`，并与本次包 manifest 核对完整 `sourceCommit`。再测试 `GET /api/health`，响应应为 HTTP 503 与 `not_ready / closed / not_verified`；这是本包有意保留的状态。

控制台可能在外层展示一次调用状态；需核对 **HTTP 响应及正文**，不能仅凭绿色调用提示判定本项目代码已启动。FC 运行环境、身份、冷启动与目标端口仍须在实际账号测试后记录。不要把进程启动成功写成报名或后台上线。

## 路由与安全失败

| 请求 | 预期 |
| --- | --- |
| `GET /healthz` | 200，进程存活及源码提交；不显示环境变量或完整 manifest |
| `HEAD /healthz` | 200，无正文 |
| `GET /api/health` | 503，业务与存储未就绪 |
| `/api/registrations`、`/admin`、`/api/admin` 及各自子路径 | 所有方法均 503，不收集正文或执行写入 |
| 健康接口的其他方法 | 405，`Allow: GET, HEAD` |
| 未知路径 | 404，固定错误，不回显路径 / 查询 / 个人资料 |

响应禁止缓存及内容嗅探，每次关闭连接，不累计请求正文；标头大小、请求及 socket 超时均有上限，HTTP 解析错误也不回显原始内容。服务不连接 OSS，不向任何人发送资料，不记录正文或完整请求。

## 验证与后续

`tests/fc-runtime.test.mjs` 覆盖真实 loopback HTTP / HEAD、关闭的业务写入、未结束的流、畸形请求、标头上限、端口及版本投影；包测试覆盖来源绑定与六文件 ZIP 白名单、原始及压缩校验、损坏解压与执行权限，上传预算另有精确边界测试。本轮容器夹具由固定 Python `3.12.4` / Debian bullseye 镜像模拟官方列明的解释器路径，使用实际交付 ZIP，在无网络、只读 `/code`、可执行 `/tmp` tmpfs 192 MiB、512 MB 内存及 0.35 CPU 下检查冷启动和响应。该夹具不是阿里云实际 FC 镜像，本机或 CI 结果不能代替真实 FC 的解释器 / `_lzma` 可用性及三次签名健康检查。

前阶段本机来源 `d52ef96a40fe5a10538f92ad0d2911f813d449fa` 的实际 ZIP 离线夹具为 10.999 秒，PR #12 合并提交 CI 为 5.506 秒，最新 main 的 CI 为 6.395 秒，均只代表各自夹具结果。该前阶段本机 ZIP 的 SHA-256 为 `723953ef90b0f3bbff98cd769b518f3f96006b31d79935a63071bbf84d25f972`；这不是 FC 远端回读或 CRC64。前次期限 / 观测修复的本机与最新 main CI 均为 203 项测试通过；本轮签名 / 上传诊断的本机 221 项测试、源码 / Astro 检查、四页构建及依赖审计通过，独立安全审阅无阻挡问题；其中健康签名 client 测试 19 项及独立官方 SDK 向量已通过。云端验收仍需对应 main 运行的实际证据，不从本地通过推断上传、启动或业务已成功。

函数确认能启动后，下一阶段再建立专用运行角色与最小范围 OSS 临时凭据权限、合成资料读写验收及真实持久化服务。GitHub 部署身份沿用公开网站桶上传权限，并由用户回报已授予单一 FC 的更新与验收权限；它不作为 FC 运行角色，也没有因此获得私有数据访问权限。39 笔真实联系人继续本机保留；筛选 / 公开稿件 / 统计、真实报名、群码受限图片服务、Wallet 与邮件均未由此包接通。正常技术发布授权不替代公开稿件核准、真实资料迁移、个人信息公开 / 分享授权或正式隐私告知。

## 回退与数据生命周期

本包不收集或持久化业务资料，无云端报名数据需要备份 / 删除；启动仅在本实例的私有 `/tmp` 目录写入经验证的临时 Node，不写 OSS 或报名 / 后台资料。保留上一个已验收的启动 ZIP 与对应 manifest；上传或配置失败时可按正常回退流程恢复上一包及其启动命令 / 端口。尚无已验收本项目版本时保持签名认证；更新超时先只读核对现场，再按当前 main 的修复 PR 重新发布，不直接重送前次 PUT，也不切换公开表单来绕过失败。未使用的函数可在确认无其他用途后禁用；不要删除私有桶或原始联系人。

静态网站发布、回退及数据边界仍见[自动部署说明](automatic-deployment.md)。启动包可由独立 Actions 任务更新；它不会修改 DNS 或开启正式报名服务。
