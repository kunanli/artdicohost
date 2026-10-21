# 志愿者与分工发布证据

[PR #35](https://github.com/kunanli/artdicohost/pull/35) 已合并，实际 main 为 `19b0d105b4a61ebc76f3395d7c389cb5fc4b5194`。截至 2026-10-21 09:44 UTC，正式检查已成功，真实云端部署仍在运行，尚不能称已上线。

## 准确来源与检查

- PR head `25378f279b06d3c5815bebb9986ae9411b0bcf38`；[PR run 39578023585](https://github.com/kunanli/artdicohost/actions/runs/39578023585) check `119148310387` 成功。CI 测试实际合并树 `7d340379e83994b047c8170987c913e2d618f70a`，942/942，0 失败／取消／跳过，57.664743640 秒。
- [main run 39578553571](https://github.com/kunanli/artdicohost/actions/runs/39578553571) check `119150121963` 成功，942/942，0 失败／取消／跳过，87.088529703 秒；443 文件源码扫描、332 文件 Astro（0 errors／warnings，1 既有 hint）、十页构建与依赖审计通过。
- main 准确候选 118 白名单文件、34 静态资源；Node v24.19.0，SHA-256 `bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12`；离线只读／无网络启动 14.811 秒。128 文件／40 静态资源边界未变。
- 本机首轮完整 937/937；补修 47/47 与云端／历史恢复 19/19；最终真实 Chromium 志愿者 28 组、导航 9 组、人员／设置 23 组及既有内容保存／名单流程通过，零页面错误。全部使用合成资料及网络拦截。
- 本机准确 PR head 来源包 118 文件／34 静态资源，离线启动 13.405 秒；实际云端证明仍须以下正式工作流完成，不能用离线启动冒充私有 OSS 就绪。

## 实际部署（待工作流完成后填入）

FC job `119152097572` 正在运行，公开 HTTPS 发布与读回尚待执行。需核对十阶段真实私有 OSS（包括志愿者 CAS、完整备份与隔离恢复）、核定政策／共同 300 人容量和精确公开资源；失败时保留实际错误，不以候选成功替代。

## 数据与后续范围

志愿者使用 `cms/v1/volunteers/ggj-cn-2026` 私有 journal；没有重新导入真实 39 人、创建正式报名、发送邮件或公开人物。EmailJS 原有设置保留；Wallet enrollment／正式证书及真机验收独立待完成。[志愿者操作](volunteer-operations.md)。

已授权接续：先完成本次实际发布；再做人员／嘉宾讲者／组织关系总览和筛选，并优先修复「确认参加」接入共同 300 人正式名额。之后按用户新提供的空白姓名邀请函版式及 Noto Sans SC Regular／Medium 更新逐人 PNG 和批量 ZIP。邀请函参考两张图保留于聊天；字体下载在 `/workspace/attachments/782f8aef-8efd-4fcb-a969-835e17897a65/NotoSansSC-Regular.ttf`（10559284 bytes）和 `/workspace/attachments/4d5b4580-cca7-4e7a-9969-28eb79ebdced/NotoSansSC-Medium.ttf`（10552448 bytes），尚未提交或部署字体。不能跳过这两个已授权阶段或称其已完成。
