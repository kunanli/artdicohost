/** Public, proposed event content only; contains no private allocation or attendee data. */
export const eventConfig = {
  id: 'ggj-cn-2026',
  year: 2026,
  title: 'GGJ 中国交流聚会 × ARTDiCO HOST 2026',
  subtitle: '连接游戏创作者、站点组织者与产业生态伙伴',
  siteRegistration: {
    existing: { title: '我已是 GGJ 站点负责人', categories: ['so', 'ro'], description: '登记现任或曾任 SO / RO 的站点、城市、组织年份、当前 / 历史角色与交流经历。' },
    prospective: { title: '我有意成为 GGJ 站点', categories: ['new_site'], description: '登记筹备城市、机构、场地与团队准备、2027 GGJ 计划和支持需求。' },
    notice: '两种身份可以同时选择；活动报名成功不代表 GGJ 官方站点资格获批，也不自动认定服务年资。',
  },
  status: 'tentative',
  language: 'zh-CN',
  design: 'creative-connections',
  hero: { title: '让创作相遇。让连接发生。', description: '从一座站点，到下一个创作现场。与游戏创作者、组织者和生态伙伴，一起聊聊未来。' },
  date: { value: '2026-12-05', label: '2026 年 12 月 5 日（暂定）', status: 'tentative' },
  time: { start: '09:30', end: '18:00', label: '09:30–18:00', timezone: 'Asia/Shanghai' },
  venue: { name: '前海5号楼（Qianhai Block V）', city: '深圳', area: '前海', address: '深圳市前海合作区梦海大道5188号前海5号楼', addressEnglish: 'Qianhai Block V, No. 5188 Menhai Avenue, Qianhai, Shenzhen', addressStatus: '3F 楼层安排暂定，入口、交通及停车资讯确认后公布', mapUrl: null, confirmed: false },
  registration: {
    mode: 'mock', enabled: false, productionSubmissionEnabled: false,
    formTitle: '活动报名', ctaLabel: '报名参加', acceptancePolicy: 'after_successful_persistence', attendeeReviewRequired: false,
    notice: '前端体验版 · 活动信息待确认 · 不提交或保存真实资料',
    participationNotice: '正式报名资料成功保存后即可报名参加。讲者、赞助合作及一晚住宿分别沟通或审核。当前仅为体验版，不受理真实报名。',
    completedNotice: '演示完成。没有发送或保存任何报名资料，尚未受理报名。',
  },
  accommodation: { nights: 1, checkIn: '2026-12-05', checkOut: '2026-12-06', status: 'tentative', notice: '一晚住宿支持须单独申请和审核；不影响普通参会报名，报名成功不代表获得住宿。' },
  exhibition: { plannedBooths: 15, status: 'tentative', description: '咖啡厅外围计划设置约 15 个展位，涵盖游戏、技术工具、高校或社群项目。展位名额及配置由筹备团队确认，申请不代表获得展位。' },
  guests: { status: 'recruiting', title: '讲者招募中 · 名单待公布', description: '场次讲座的讲者尚未确定，欢迎提交主题提案。讲者及主题确认后另行公布；只展示已确认资料和授权照片。', people: [] },
  attribution: { status: 'pending', notice: '主办、承办、协办、赞助等署名待有关各方正式确认后展示。' },
  privacy: { status: 'pending', processor: null, contactEmail: null, storageRegion: null, retentionPeriod: null, notice: '正式报名开放前，将核定个人信息处理者、联系方式、收集目的、字段类别、存储地区、保留期限、分享对象及查阅、更正、撤回、删除方式。当前不收集真实报名。' },
  links: { map: null, contact: null, artdico: null },
  seo: { title: 'GGJ 中国交流聚会 × ARTDiCO HOST 2026｜活动报名与讲者、赞助招募', description: '2026 年 12 月 5 日（暂定），深圳前海。活动报名、讲者主题提案与赞助合作招募。当前为前端体验版，不提交真实报名。' },
};

/** Recruitment requests are independent from ordinary event registration. */
export const recruitment = {
  speakers: {
    status: 'recruiting', title: '把你的经验带到现场',
    description: '场次讲座的讲者尚未确定。欢迎围绕游戏创作、站点运营、产业技术与教育实践提交主题提案；场次与安排另行沟通。',
    ctaLabel: '我想成为讲者', interestValue: 'talk',
    notice: '提交提案不等于确认讲者身份，也不影响普通参会报名。',
  },
  sponsors: {
    status: 'recruiting', title: '一起支持创作与交流',
    description: '面向企业、机构与生态伙伴招募赞助合作。欢迎沟通技术工具、物资、资金、导师或社群资源；形式与安排须双方另行确认。',
    ctaLabel: '洽谈赞助合作', interestValue: 'sponsorship',
    notice: '当前未确定赞助方、价格或权益方案；提交咨询不构成赞助承诺。',
  },
};

export const zones = [
  { id: 'A', name: '阶梯展示厅', description: '分享 / 作品 / 交流' },
  { id: 'B', name: '咖啡厅', description: '圆桌 / 专题 / 咨询' },
  { id: 'C', name: '外围展位区', description: '试玩 / 展示 / 反馈', summary: '全天开放（按活动时段）；15:30–16:30 保留必要值班，16:30–17:00 学生作品体验与反馈。' },
];

export const agenda = [
  { id: 'arrival', start: '09:30', end: '10:00', time: '09:30–10:00', A: '签到入场', B: '自由交流', C: '展位开放', tentative: true },
  { id: 'opening', start: '10:00', end: '10:15', time: '10:00–10:15', A: '开场介绍', B: '—', C: '展位体验', tentative: true },
  { id: 'ggj-talk', start: '10:15', end: '11:00', time: '10:15–11:00', A: 'GGJ 主题分享', B: '—', C: '展位体验', tentative: true },
  { id: 'morning-break', start: '11:00', end: '11:15', time: '11:00–11:15', A: '茶歇交流', B: '咖啡交流', C: '展位体验', tentative: true },
  { id: 'speaker-one', start: '11:15', end: '12:00', time: '11:15–12:00', A: '讲座分享（一）· 讲者待定', B: 'GGJ 站点经验圆桌会议', C: '展位体验', tentative: true },
  { id: 'recognition', start: '12:00', end: '12:30', time: '12:00–12:30', A: 'GGJ 服务表彰及合影', B: '暂停研讨', C: '展位体验', tentative: true },
  { id: 'lunch', start: '12:30', end: '13:30', time: '12:30–13:30', A: '午餐休息', B: '自由交流', C: '展位体验', tentative: true },
  { id: 'speaker-two', start: '13:30', end: '14:15', time: '13:30–14:15', A: '讲座分享（二）· 讲者待定', B: '专题研讨会 · 嘉宾待定', C: '展位体验', tentative: true },
  { id: 'afternoon-break', start: '14:15', end: '14:30', time: '14:15–14:30', A: '茶歇交流', B: '咖啡交流', C: '展位体验', tentative: true },
  { id: 'speaker-three', start: '14:30', end: '15:15', time: '14:30–15:15', A: '讲座分享（三）· 讲者待定', B: 'GGJ 新站点申请咨询与初步审核（上半场）', C: '展位体验', tentative: true },
  { id: 'transition', start: '15:15', end: '15:30', time: '15:15–15:30', A: '茶歇与转场', B: '新站点申请咨询与初步审核（下半场）', C: '展位体验', tentative: true },
  { id: 'student-showcase', start: '15:30', end: '16:30', time: '15:30–16:30', A: 'ARTDiCO HOST 学员作品分享', B: '自由交流', C: '保留必要值班', tentative: true },
  { id: 'student-feedback', start: '16:30', end: '17:00', time: '16:30–17:00', A: '嘉宾移步展区', B: '嘉宾及学员交流', C: '学生作品体验与反馈', tentative: true },
  { id: 'ecosystem', start: '17:00', end: '17:45', time: '17:00–17:45', A: 'GGJ 组织者及生态合作交流', B: '合作洽谈', C: '展位交流', tentative: true },
  { id: 'closing', start: '17:45', end: '18:00', time: '17:45–18:00', A: '闭幕总结及合影', B: '嘉宾集合', C: '展位结束', tentative: true },
];

export const highlights = [
  { title: '交换经验', description: 'GGJ 主题分享、组织者圆桌与新站点申请咨询。咨询与现场初步审核不代表取得正式资格；主题与嘉宾待确认。' },
  { title: '发现作品', description: 'ARTDiCO HOST 学员作品分享、游戏试玩与开放展示，让青年创作者的想法获得交流与反馈。' },
  { title: '连接彼此', description: '产业技术与专题交流，探索高校、工具生态、社群及资源合作的可能；不表示已达成赞助承诺。' },
];

export const faqItems = [
  { question: '填好报名表就可以参加吗？', answer: '可以。正式报名开放后，资料校验通过并成功保存即完成参会报名，无需等待普通参会邀请审核。当前仅为前端体验版，没有提交或保存报名。' },
  { question: '我不是 GGJ 组织者也可以报名吗？', answer: '可以。欢迎行业嘉宾、高校、开发者及生态伙伴报名参加，不需要先申请讲者或合作身份。' },
  { question: '已经是站点负责人和想建立新站点，都能登记吗？', answer: '可以。已有负责人请选择 GGJ SO 或 RO，填写站点与组织经历；有意成为 GGJ 站点请选择新站点筹备，填写城市、机构、场地、团队及支持需求。身份可多选，仍是一份活动报名。' },
  { question: '新站点现场咨询代表已通过申请吗？', answer: '不代表。现场仅为申请咨询与初步审核，正式资格以 GGJ 官方流程和审核结果为准。' },
  { question: '场次讲者确定了吗？可以报名分享吗？', answer: '讲者尚未确定，正在招募。你可以提交主题提案；讲者身份与具体场次另行沟通，不影响普通参会报名。' },
  { question: '如何成为赞助方？', answer: '欢迎提交赞助合作咨询，交流资金、物资、技术工具或其他支持方式。赞助方、价格与权益尚未确定，具体合作需双方另行确认。' },
  { question: '可以申请展位吗？', answer: '可以表达展示需求；名额、布展与具体安排另行确认。展位未获确认不影响普通参会报名。' },
  { question: '报名成功就有住宿吗？', answer: '不是。一晚住宿支持需要单独申请和审核，资源有限；报名成功不代表获得住宿。' },
  { question: '如何修改或撤回资料？', answer: '正式网站将提供筹备团队联系邮箱及隐私处理流程；相关信息核定后才开放报名。当前演示没有保存或发送资料。' },
];
