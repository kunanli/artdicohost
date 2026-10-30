# 2026-10-31 后台、确认通知与 Wallet 体检

本阶段接续已发布 `fa2df37`，公开报名原申请重试已由用户确认「已收到申请／等待审核」。本次重点是私有后台与凭证图稿，公开首页结构、报名 API、既有 ID、隐私来源与名额计算保持兼容。

## 结果

| 范围 | 处理与证据 |
| --- | --- |
| 人员与报名 | 新增同一入口下五个视图。只通过原联系人 ID 与 immutable provenance 连接报名；同名、同邮箱不自动合并。 |
| 参展商 | 公司／团队为主，明确联系人关系与展位；只有旧文字的展位保留待关联，不创建假公司。 |
| 讲者／嘉宾 | 保存的参与职责、逐场职责、人物关联共同投影；一人可有多角色，原问卷兴趣不授予职责。 |
| 权限与故障 | reviewer-only 不读取联系人源；outreach-only 不读取报名源。失败不当零，分页绑定来源版本，退出／换人不回填旧回应。 |
| 确认与通知 | 公开审核通过、明确新出席确认、工作人员直接登记 confirmed 后处理邮件。旧资料读取、导入与批次同步不补寄。历史补寄为有权限的逐笔动作。 |
| 通知边界 | 当前联络许可与地址再次核对。provider_accepted 只表示服务商接受；unknown 不重寄。原操作重放、版本冲突、邮件暂停与服务失败保持独立名额记录。 |
| Wallet | 海军蓝／钴蓝／铂金 PNG 实际进入 signed pass；manifest 与 detached CMS 使用合成根由 OpenSSL 独立验签。待审、候补、撤回不发 pass。 |
| 发布预算 | 暂存构建 40 个后台静态资源、7,459,529 bytes，仍在 8 MiB 限制内；未新增服务器源文件、依赖、环境变量、服务或 IAM。首轮 PR 检查的 exact merge-tree 包已通过 128 文件、40 资源与请求预算校验；最终提交仍按相同检查执行。 |

## 已完成的本地验证

- `node --test --test-concurrency=2 tests/*.test.mjs`：1,359 passed，0 failed（184.5 秒）。
- `pnpm check`：0 errors、0 warnings，保留原有 1 hint。
- `pnpm build`：23 页面；生产模式另显式设置 `PUBLIC_API_BASE` 与 `PUBLIC_CONTENT_API_ORIGIN` 检查。
- `pnpm audit --audit-level=moderate`：无已知漏洞。
- 新统一名单 Chromium：320 / 390 / 1440，来源去重、角色视图、公司与旧展位、逐笔确认信、read-only reviewer；无横向溢出、页面异常或真实外部请求。
- 原人员关系 Chromium：23 组，含已保存关系、来源权限、退出清理、未知联系人 ACK、300 共同名额边界与历史不补寄。
- 确认页 Chromium：8 组，含表单跳转、当前名额、撤回、未知链接、重新读取撤回、真实合成 signed pass 下载、切换私人链接。
- 报名审核与私人确认链接 Chromium：320 / 390 / 1440；Excel 三种权限导出案例通过，未读取通知配置或改变原数据。
- HTTP 特殊请求边界：14 项复验通过，包含真实 TCP/HTTP 代理头、64 / 65 头数、8 KiB 字节上限、framing、逐笔通知 16 KiB body 上限，以及同一公开申请 key 的恢复。

验证使用合成姓名、`example.invalid` 邮箱、内存 OSS、可丢失 ACK 的测试 provider 与隔离浏览器。没有对正式报名名单做导出、回填、自动核准或实际寄信。真实名单是否存在缺失组织／重复关系，应由有权限的工作人员在新视图逐笔核对；不把合成体检写成已清理正式数据。

## 发布与交付

发布前须确认 exact-commit PR checks、128 文件 / 40 资源 / 8 MiB 与既有 ZIP、48,000,000-byte JSON 请求上限。合并后记录 main push 的 FC、私有 OSS readback、公开 OSS 与实际 HTTPS 验证结果。准确提交、工作流与实际上线结果统一记录在 [PR #47](https://github.com/kunanli/artdicohost/pull/47)，未完成的检查不视为已经上线。

Apple Wallet 的 signed archive、浏览器下载、图稿预览与生产 readiness 均不是实机证明；需要 iPhone 打开本人确认页，检查新版海报／兼容样式、姓名日期与扫码。卡片暂未提供 APNs 更新，重新下载才能取得新图稿。

回退仅部署上一已验版本，不删除或回退任何联系人、原报名、名额与通知 journal；不清除 unknown 预留来绕过重寄保护。操作见 [人员工作区](unified-people-workspace.md)、[Wallet 图稿](wallet-artwork.md)、[备份恢复与删除](maintenance-backup.md)。
