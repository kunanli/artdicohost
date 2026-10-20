# 开发接续与验收计划

本文件保存跨 session 的开发入口，功能完成情况以已提交代码和真实运行证据为准。原聊天 `01a153f8-c7f3-72ef-aff2-08d5e5cd20b5` 多次断线，本轮在新聊天接续。

## 用户最新要求与确定事项

1. 完成当前受控账号配置，再补齐网站已规划功能，早晨验收。
2. 开发文档必须记录状态、分工、阻塞与下一步，避免再次从聊天猜测。
3. 活动 2026-12-05，报名截止为当日 **12:00（Asia/Taipei／Asia/Shanghai，UTC+08）**；整场容量 **300 人**。
4. 既有意向联系人可由后台选择后直接转为报名，发邀请并安排场次／展位；保持来源及审计，避免重复。不得伪造申请人新同意或未知的必填资料。
5. 用户委托决定其他报名政策。采用 ARTDiCO HOST 活动筹备团队作为活动资料处理者，沿用受控配置中的既有业务邮箱作为隐私联络，资料至 2027-03-05（活动后 90 天）保留；目的为报名、核对、联系与活动安排。存储中国香港，不自动向 Maria 或其他第三方发送全量资料，查阅／更正／撤回／删除由记录在案的人工流程处理。正式告知通过服务器配置投影，不把账号或秘密写入仓库。

## 已恢复与发布

- 前轮未发布四档修正从 GitHub tree `5c8337e6c0094575e4076ce453c5f1de4336bfdf` 恢复，内容与来源逐项核对。
- [PR #25](https://github.com/kunanli/artdicohost/pull/25) 已合并为 `03c766a2cbe32a90f42ec5f8c0e0bc464001920d`；[PR CI](https://github.com/kunanli/artdicohost/actions/runs/39448120552) 的 449 项测试全部通过，构建／依赖稽核／两个包的离线 smoke 通过。
- [main 发布 39448880855](https://github.com/kunanli/artdicohost/actions/runs/39448880855) 的检查、公开 OSS、FC 代码与受控账号配置均成功；FC 三次签名健康标记为同一完整提交。账号配置已确认，内容仍关闭，真实 OSS 的独立验收在下一批代码中接续。

## 进行中的代码分工

所有分支起点均为 PR #25 内容，集成分支为 `feat/full-site-completion`。各 agent 在独立 worktree 提交，由主 agent逐个 cherry-pick、审阅、整合和真实部署。

| 工作 | 分支／目录 | 内容与接续边界 |
| --- | --- | --- |
| 云端合成验收 | `feat/cloud-acceptance`／`/workspace/artdico-worktrees/cloud-acceptance` | FC 内部临时身份，全部测试对象隔离在 `cms/v1/acceptance/`；仅签名健康入口回固定结果；业务仍关闭 |
| 正式报名 | `feat/registration-service`／`/workspace/artdico-worktrees/registration-service` | 私有不可变记录＋共享 CAS 索引、300 人容量、签名令牌、幂等、限流、明确回读收据 |
| 后台与公开页 | `feat/admin-completion`／`/workspace/artdico-worktrees/admin-completion` | 活动基础／文案编辑、真实报名传输、隐私说明、审核筛选统计及导出界面 |
| 审核与维护 | `feat/registration-review`／`/workspace/artdico-worktrees/registration-review` | 独立 reviewer／superadmin、审核与住宿状态、最小导出审计、受控删除申请、加密备份及隔离恢复验证 |
| 意向与邀请 | `feat/intent-invitations`／`/workspace/artdico-worktrees/intent-invitations` | 联系人转报名、来源与唯一键、邀请准备／人工发出／明确邮件发送、场次展位分配 |
| 主集成 | `feat/full-site-completion`／`/workspace/artdicohost` | schema、运行时装配、固定包白名单、受控配置／启用／回退、CI 与最终验收 |

## 集成顺序与完成定义

1. 当前 main 的 OSS、FC 与账号配置分别取证。
2. 各模块完成安全失败、并发／权限与有意义的测试，提交后集成；首先完成关闭状态的真实 OSS 合成验收，再启用工作人员内容后台。
3. 衔接报名／审核／意向／邀请及前台读取；普通报名与住宿／讲者／展位确认分开。未配置寄信渠道时下载和人工发出可用，不能假称邮件送达。
4. 明确生产政策、角色迁移、API 路由和容量，执行完整 CI、包核对、浏览器及云端端到端检查；失败继续修复，未知写入结果不盲重送。
5. 写入早晨验收清单、真实运行链接及剩余人工设置；已通过并发布与仅有代码的能力分别记录。

## 恢复时必须核对

- `git status`、各分支最新提交、GitHub main、最新 Actions、此文档与 `docs/development-status.md`（如已生成）。不要重做已成功的部署或读取 Secrets 来猜配置。
- 旧 session 的 39 笔私有联系人与群码在忽略目录；当前新工作区尚未确认恢复。以取回原始文件为准，不生成占位人、不宣称已迁移或删除。用户已授权联系人转报名，仍须保留原始来源及最小披露。
- 不修改 IGDA 资源、不新增服务套餐、不扩大 IAM、不改主站 DNS 或健康 trigger；恢复与物理删除若需要不同运维权限，明确记录，不能用应用 tombstone 冒充彻底擦除。
- 本地沙盒 Node spawnSync 可能 EPERM；获准执行相关检查后通过。依赖用 `/tmp/artdico-pnpm-store`，不要改系统 HOME。
