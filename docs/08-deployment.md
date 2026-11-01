# 阿里云部署、验证与回退

2026-11-01。本站已使用独立香港 FC／OSS 发布。当前阶段、准确提交与实际运行证据见 [改版总览](redesign/README.md) 及其发布记录；以下流程沿用现有资源与受控配置。

## 现行架构与配置

| 入口 | 用途 |
| --- | --- |
| `https://artdico.host` | Astro 静态网站，发布至香港公开桶 `artdicohost-web-hk`；包括没有个人资料的私人页 HTML 外壳 |
| `https://api.artdico.host` | 独立 FC API 与工作人员后台；使用已验证的 Node `24.19.0` 自定义运行时 |
| 私有桶 `artdicohost-data-hk` | 业务 journal、不可变报名／来源、图片及受控加密配置；FC 使用运行角色提供的临时凭据 |

前端仅使用准确的 `PUBLIC_API_BASE`、`PUBLIC_CONTENT_API_ORIGIN` HTTPS 来源。服务端沿用 `ARTDICO_CONTENT_*`、`ARTDICO_REGISTRATION_*`、既有通知／Wallet 开关与加密 bundle locator。完整名称及安全本机默认值见 [.env.example](../.env.example)；该文件的空值／false 不代表正式服务未启用，不能据此重新创建账号或轮替已有配置。

日常开发使用合成对象与拦截请求。正式账号、报名秘密、EmailJS 凭据、Apple 私钥及云凭据保留在受控环境，不复制到 `PUBLIC_`、仓库、本机示例或公开产物。现有 EmailJS 与 Apple 设置继续沿用；首次配置或轮替另按 [寄送配置](delivery-configuration.md) 与 [Wallet 指引](apple-wallet-setup.md) 执行。

## 发布顺序

现有 [.github/workflows/check.yml](../.github/workflows/check.yml) 按准确提交交付：

1. PR 安装锁定依赖，执行源码／Astro／完整测试、静态构建及依赖审计，验证 FC 启动包、内容候选包与公开发布清单。两种 ZIP 在有界、只读、无网络容器内启动；PR 不发布正式服务。
2. 检查成功后合并 main。正式流程重新检查，并使用同一准确提交的候选包更新 FC，完成隔离合成私有 OSS 验收、来源绑定、后台 HTTPS 与匿名 API／CORS 核对，再启用正常服务。
3. FC 成功后上传 OSS 公开清单。先上传依赖，再上传 HTML，首页及 `release.json` 收尾；逐个回读 hash，随后通过真实网站域名核对完整清单、准确 SHA、MIME、非附件 HTML 与 `public,no-cache` 快取政策。指令顺序、大小写及空白可正规化，额外或矛盾的快取指令不能冒充已核对政策。
4. 核对整个 main 运行的检查／FC／OSS 结果及实际 HTTPS 证据后才记为发布完成。数量来自该次 manifest 与日志，不沿用上阶段数字。工作人员重新载入已有分页面，以取得同版界面。

上传只处理本次明确清单，不进行 bucket-wide 删除。保留旧 hash 资源，避免已打开页面的引用立即失效。公开构建与 FC 后台的资源闭包分别核对；首页图像／字型与完整 OFL 必须进入公开产物，不能因此扩大后台依赖或放宽候选包上限。

本次任务已授权正常代码更新、检查通过后的 PR 合并与部署，按上述顺序继续，无需逐次确认。此授权不代做正式名额核准、人员合并、内容草稿发布、群码更新或实际寄信；新付费资源、DNS 与 IAM 变更也不属于日常发布。

## 发布证据与操作交接

记录 PR、head／merge SHA、Actions run、候选包摘要及大小、公开 manifest、后台与公开 HTTPS 核验。失败继续诊断或使用兼容回退，保留原日志；只有绿 PR 或本机构建不能证明正式服务已更新。

真实素材、人员关联与出席依据由有权限同事核对后保存，再在「预览与发布」确认全部待发布内容。旧快照缺少新版出席证明时嘉宾区可显示待公布，代码部署不会替真实人员确认或公开。住宿仅沿用 Q&A 的少量外地支持与 `support@artdico.co` 联系方式；旧需求继续跟进，不发布固定房量或住宿承诺。

真实 Email 收件／垃圾邮件与域名认证、微信扫码入群、iPhone 添加 Wallet、同事操作观察仍分别验收。合成 provider 接受、群码显示及 PKPASS 下载不代替这些结果。日常流程见 [操作手册](redesign/02-staff-and-attendee-runbook.md)，当前收件与未知结果规则见 [通知流程](registration-confirmation.md)。

## 兼容回退与数据恢复

保留上次已验证的公开清单与 FC 包，以及能读取当前资料的修复版本。回退前核对持久格式与未决操作：现行写入者须保留 `personGroups`／v3、动态展位、出席证明、可选 FAQ ID、三类通知及提醒操作，并继续识别原 pending 正文／键与 reserved／unknown。P4 新通知已写入后，不能直接切换只接受旧种类的写入者；P5 FAQ ID 也不能被旧界面保存时默默丢弃。

回退仅更新兼容代码及公开产物，保留现有受控配置与业务 journal。出现通知风险时由有权限同事暂停新发送，保留原操作核对；不清空预留或更换身份来重寄。旧 Email 和已保存 Wallet 不自动改写或从设备移除。

业务修复与代码回退分开。按 [加密备份与隔离恢复](maintenance-backup.md) 收集完整历史及引用，密钥单独保存；先恢复到全新隔离位置并用当前领域验证器试读，核对撤回／删除请求及通知历史，确认不会重发，再执行受控业务切换。不要用旧快照覆盖当前名额、来源、同意或通知。保留期限与受控删除边界见 [报名审核与维护](registration-review.md)。
