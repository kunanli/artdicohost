# ARTDiCO HOST · artdico.host

项目：GGJ 中国交流聚会 × ARTDiCO HOST 2026。域名 `artdico.host`。本文档包供新 GitHub 仓库及 Codex 使用，**不是已完成的网站**。

## 目标
一页式简体中文活动落地页；展示日程和参与方式；收集 GGJ SO/RO、新站点、行业嘉宾、机构及生态合作伙伴意向；管理审核并导出供 Maria 确认的候选名单。2026-12-05 为暂定活动日，不能把待邀嘉宾、协办署名或审核结果称作已确认。

## 技术决策
参考私有仓库 `kunanli/igda_shenzhen`（2026-10-18 检查）：Astro、Function Compute、GitHub Actions、静态 OSS 公共站点、私有 OSS JSON 报名。新建独立仓库和独立 OSS/FC 资源；**不要复制旧密钥、成员数据或直接改 IGDA 正式站**。

## 文档入口
- `AGENTS.md`：Codex 行为边界与开发顺序
- `docs/01-product-prd.md`：需求、角色、功能与验收
- `docs/02-page-copy.md`：可上站的简体中文文案
- `docs/03-agenda.md`：三场地日程
- `docs/04-form.md`：报名字段、分支与提示语
- `docs/05-admin.md`：后台审核与 Maria 导出
- `docs/06-architecture-data.md`：存储结构及 API 契约
- `docs/07-security-privacy.md`：隐私和安全红线
- `docs/08-deployment.md`：部署环境和上线清单

## 第一版范围
前端、一页内容、表单持久化、独立管理员登录、筛选/备注/导出、隐私告知、基础测试与部署方案。电子票、二维码签到、邮件批量营销、支付、自动奖项评定均不在首版范围。
