# 香港 FC 启动验收

日期：2026-10-19（Asia/Taipei）。用户已建立香港函数 `artdicohost-api`，截图显示自定义运行时 Debian 11 / Python 3.12 示例，以及签名认证的 HTTP `defaultTrigger`。私有桶 `artdicohost-data-hk` 已创建，用户回报已保存 SSE-OSS / AES256；尚未验证函数身份或私有对象读写。

本阶段只替换示例码并验证 Node.js 可以启动。`/healthz` 的 200 只表示进程存活；报名、后台与存储就绪均保持关闭。不要把本机 `functions/content-api/server.mjs` 上传为云端后台。

## 交付内容与来源

`scripts/prepare-fc-bootstrap.mjs` 只读取三个已提交的指定源文件与显式指定的 Node 可执行文件，以完整提交核对源文件内容，拒绝符号链接、错误架构 / 版本 / 校验值及非空输出目录；不会扫描真实名单或删除原输出。ZIP 根目录仅含五个文件：

```text
bootstrap
functions/fc-api/handler.mjs
functions/fc-api/server.mjs
runtime/node/bin/node
release.json
```

Node 与 bootstrap 保留 `0755` 权限；无需安装依赖、layer、挂载 OSS 或配置 AccessKey。Node 由官方 Linux x64 发行包提取，使用 TLS 下载与官方校验清单核对，不关闭证书验证：

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

## 控制台操作

以下是一组操作，界面文字如有差异，以实际配置页核对，不重建函数或改动其他项目。

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

`tests/fc-runtime.test.mjs` 覆盖真实 loopback HTTP / HEAD、关闭的写入、未结束的流、畸形请求、标头上限、端口及版本投影；`tests/fc-package.test.mjs` 覆盖来源绑定与实际 ZIP 白名单 / 校验 / 执行权限。独立 Debian 11 容器验收使用实际交付包、无外网、只读 `/code`，检查 bootstrap、版本及上述响应；本机结果不能代替 FC 控制台测试。

函数确认能启动后，下一阶段再建立专用运行角色与最小范围 OSS 临时凭据权限、合成资料读写验收及真实持久化服务。现有 GitHub 部署身份只授权公开网站桶，不扩大为私有数据访问身份。39 笔真实联系人继续本机保留；筛选 / 公开稿件 / 统计、真实报名、群码受限图片服务、Wallet 与邮件均未由此包接通。

## 回退与数据生命周期

本包没有写入或收集资料，无云端报名数据需要备份 / 删除。保留上一个已验收的启动 ZIP 与对应 manifest；上传或配置失败时可恢复上一包及其启动命令 / 端口。当前仅有 Python 示例且尚无已验收本项目版本时，保持签名认证并停止使用该函数，核对失败原因后重试；不要切换公开表单来绕过失败。未使用的函数可在确认无其他用途后禁用；不要删除私有桶或原始联系人。

静态网站发布、回退及数据边界仍见[自动部署说明](automatic-deployment.md)。此流程不会合并网站 PR、修改 DNS 或自动部署正式 API。
