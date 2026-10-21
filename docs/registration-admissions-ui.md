# 报名精简与实际名额管理接续说明

本轮只改变资料必填规则与工作人员操作界面，不改写既有原始报名。一般参会的机构、职位、经历可选；实际申请讲者、展位或合作分支时才必填。`shared/registration-schema.mjs` 的 `isRegistrationFieldRequired` 同时供浏览器与正式服务端使用。原来已填写的有效资料仍保留，非空的选填资料仍须通过格式及长度校验。

正式收据以 `status: registered / waitlisted` 及 `admissionStatus: confirmed / waitlisted` 区分结果。两者矛盾时不显示成功，保留原提交以便确认。候补保存后显示登记编号及「尚未确认参会」，不会显示或读取群码。旧版合法的 `registered` 收据仍可识别。公开配置只显示经过校验的汇总人数，不包含逐人或团队编号。

工作人员从 `/admin/registrations/` 的「实际人数、候补与团队」操作：

- 共同总上限、一般与工作人员已确认人数、普通剩余人数、候补及工作人员预留分开显示；预留预设为 0，由管理权限账号调整。
- 审核权限可读取逐人名额、取消并释放、按顺序补位、维护团队关联。只有管理权限可调整预留与候补开关、改变人员类别、受托逐人登记。
- 团队关联只选取已保存的实际报名，一人最多属于一队、每队最多 50 人。团队名称或预估人数不会增加名额。取消团队关联保留逐人登记与名额。
- 受托登记只有一人的姓名、邮箱或微信及核定许可依据；以 `staff_entry` 保留来源，不能假造本人网站隐私同意。未填写的资料仍然缺省。
- 名额审核意见、住宿审核与实际名额独立。候补转正和取消结果不代表工作人员已发出通知。

全部写入沿用同源登录、CSRF 与服务端角色校验；界面使用 `/api/admin/admissions` 的固定子路由。每次修改附 `expectedRevision` 和随机 `operationId`。网络失败、503 或不完整回执后只允许明确重试同一份原始 body，不能把后续编辑混入。409 等明确拒绝保留表单输入，可刷新版本后重新提交。操作未确认时离页与退出会提示；原操作与个人资料只在本页内存，不写入浏览器持久存储。

会话中断后先读取已保存名额及审计，不凭旧页面或截图猜测是否已写入，再决定是否开展新操作。后台刷新只读取资料，不会代为取消、补位、发信或重新登记。review journal 的 `inactiveRegistrationIds()` 可一次取得已验证的撤回／删除申请编号，供任务及邀请前置检查使用，不加载所有原始报名。

验证命令（全部使用合成资料；浏览器请求均被本地拦截）：

```sh
node --test --test-isolation=none tests/registration-requirements.test.mjs tests/registration-server-contract.test.mjs tests/registration-client.test.mjs tests/admission-view.test.mjs tests/admission-admin.test.mjs tests/registration-admin.test.mjs
PUBLIC_API_BASE=https://api.artdico.host pnpm build
pnpm check
ARTDICO_PLAYWRIGHT_MODULE=/absolute/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/usr/bin/chromium node tests/browser/registration-smoke.mjs
ARTDICO_PLAYWRIGHT_MODULE=/absolute/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/usr/bin/chromium node tests/browser/admissions-smoke.mjs
ARTDICO_PLAYWRIGHT_MODULE=/absolute/playwright-core/index.mjs ARTDICO_CHROMIUM_BINARY=/usr/bin/chromium node tests/browser/admissions-session-race.mjs
```

公开浏览器回归覆盖关闭报名、一般参会不填经历、同一请求重试、候补无群码、讲者条件必填；工作人员回归覆盖角色、预留、逐人登记、团队、取消补位及未知回执重试。实际容量并发、幂等与 FIFO 保证由名额服务测试及合成运行时验收负责；本界面不会把浏览器显示当作容量承诺。

会话清除回归使用真实组件与模块、受控延迟的合成请求，覆盖晚到的 GET、修改回执、错误与 onChange。退出或账号／角色改变会立即清空 DOM、姓名缓存、表单及原操作；旧回调不能重填资料、解锁新操作或清除新会话的待确认请求。同一会话内并发读取以最后发起的读取为准；已保存修改后的旧读取也不会覆盖新状态。
