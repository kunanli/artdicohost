# 阿里云部署与上线步骤

## 推荐环境
域名 `artdico.host`（DNS/ICP备案状况未验证）；`api.artdico.host` 仅建议使用。静态网站部署至**独立**阿里云 OSS 公开站点桶，可按需加 CDN 和 TLS；FC 与私有 OSS 数据桶另建。参考 IGDA 香港节点，不代表本项目一定免除适用的域名、合规或备案义务，应先核对实际服务地区及接入类型。

## 环境变量示例（只列名称）
PUBLIC_API_BASE, ALLOW_ORIGIN, FC_REGION, OSS_REGION, OSS_SITE_BUCKET, OSS_DATA_BUCKET, OSS_MEDIA_BUCKET, JWT_SECRET, GITHUB_REPO, GITHUB_BRANCH, GITHUB_TOKEN（仅后台内容发布确实需要时使用）, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET。

## CI/CD
PR：安装锁定依赖、类型/内容校验、单元测试、Astro build、安全检查；不部署。
main：构建、更新/验证后端（如有改动）、发布网站到 OSS、校验线上文件、仅清理已知旧站点构建物，不清理媒体和私有数据。要有 rollback 说明和独立 staging 环境。

## 上线前人工检查
1. GGJ/ARTDiCO 署名权限、日期与 Maria 可出席安排最终确认。
2. 域名所有权、DNS、HTTPS、Aliyun 地域、备案/经营合规依实际情况确认。
3. 官网所有联系方式及地图链接有效；隐私政策及资料处理人已核实。
4. 私有 OSS 桶权限、备份与 RAM 最小权限已验收。
5. 无真实个人数据出现在静态站构建、Git 历史、CI 日志。
6. 测试各种身份的动态分支、重复提交、断网、限流、无法写入、管理员越权与导出 CSV 注入。
7. 后台可审阅、编辑内部备注并记录审计；Maria 接收流程得到授权。
8. 住宿只有一晚，预计 20 间仅内部容量；没有自动承诺。
9. 不经用户授权不得购买云资源或执行生产部署。

## 回滚
保留上版静态构建产物/可恢复对象版本和后端上一版发布包。回滚只操作网站代码和部署资源，不覆盖、清空个人信息。表单 schema 变更必须兼容旧记录或提供可回滚迁移。
