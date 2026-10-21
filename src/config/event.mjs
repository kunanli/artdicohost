/** Public event content only; contains no private allocation or attendee data. */
export const eventConfig = {
  id: 'ggj-cn-2026',
  year: 2026,
  title: '2026 GlobalGameJam 中国交流聚会 × ARTDiCO HOST 学生嘉年华',
  subtitle: '组织者交流 · 学生作品 · 游戏体验',
  siteRegistration: {
    existing: { title: '我已是 GGJ 站点负责人', categories: ['so', 'ro'], description: '登记现任或曾任 SO / RO 的站点、城市、组织年份、当前 / 历史角色与交流经历。' },
    prospective: { title: '我想在城市组织 GGJ 站点', categories: ['new_site'], description: '了解本地负责人、团队与场地准备，并通过 GGJ 官网 Start a Jam Site 申请。' },
    notice: '现场咨询不替代 GGJ 官方申请，正式结果由 GGJ 官方确认。',
  },
  status: 'confirmed',
  language: 'zh-CN',
  design: 'creative-connections',
  hero: { title: '2026 GlobalGameJam 中国交流聚会 × ARTDiCO HOST 学生嘉年华', description: '组织者交流 · 学生作品 · 游戏体验' },
  date: { value: '2026-12-05', label: '2026 年 12 月 5 日', status: 'confirmed' },
  time: { start: '09:30', opening: '10:00', end: '18:00', label: '10:00–18:00', timezone: 'Asia/Shanghai' },
  venue: { name: '前海5号楼（Qianhai Block V）', city: '深圳', area: '前海', address: '深圳市前海合作区梦海大道5188号前海5号楼', addressEnglish: 'Qianhai Block V, No. 5188 Menhai Avenue, Qianhai, Shenzhen', addressStatus: '楼层、入口及交通资讯另行公布', mapUrl: null, confirmed: true },
  registration: {
    mode: 'mock', enabled: false, productionSubmissionEnabled: false,
    formTitle: '活动报名', ctaLabel: '报名参加', acceptancePolicy: 'after_successful_persistence', attendeeReviewRequired: false,
    notice: '活动报名已开放 · 本页表单仅供预览，不发送或保存资料',
    participationNotice: '欢迎报名参加。讲者、展位、站点咨询与住宿申请分别沟通。',
    completedNotice: '演示完成。没有发送或保存任何报名资料，尚未受理报名。',
  },
  accommodation: { nights: 1, checkIn: '2026-12-05', checkOut: '2026-12-06', status: 'tentative', notice: '一晚住宿支持须单独申请和审核；不影响普通参会报名，报名成功不代表获得住宿。' },
  exhibition: { plannedBooths: 15, status: 'tentative', description: '咖啡厅外围计划设置约 15 个展位，涵盖游戏、技术工具、高校或社群项目。展位名额及配置由筹备团队确认，申请不代表获得展位。' },
  guests: { status: 'recruiting', title: '讲者招募中 · 名单待公布', description: '场次讲座的讲者尚未确定，欢迎提交主题提案。讲者及主题确认后另行公布；只展示已确认资料和授权照片。', people: [] },
  attribution: { status: 'pending', notice: '活动相关署名待有关各方正式确认后展示。' },
  privacy: { status: 'pending', processor: null, contactEmail: null, storageRegion: null, retentionPeriod: null, notice: '本页表单仅供预览，不收集真实报名。本站正式表单启用前，将公布个人信息处理告知及查阅、更正、撤回、删除方式。' },
  links: { map: null, contact: null, artdico: null },
  seo: { title: '2026 GlobalGameJam 中国交流聚会 × ARTDiCO HOST 学生嘉年华', description: '2026 年 12 月 5 日，10:00–18:00，深圳前海5号楼。GlobalGameJam 组织者交流、学生作品分享与游戏体验。09:30 签到，报名已开放。' },
};

/** Recruitment requests are independent from ordinary event registration. */
export const recruitment = {
  speakers: {
    status: 'recruiting', title: '把你的经验带到现场',
    description: '场次讲座的讲者尚未确定。欢迎围绕游戏创作、站点运营、产业技术与教育实践提交主题提案；场次与安排另行沟通。',
    ctaLabel: '我想成为讲者', interestValue: 'talk',
    notice: '提交提案不等于确认讲者身份，也不影响普通参会报名。',
  },
  sites: {
    status: 'guidance', title: '想在您的城市组织 GGJ 站点？',
    description: '准备本地负责人、组织团队与场地，再通过 GGJ 官网的 Start a Jam Site 入口提交申请。',
    ctaLabel: '查看官方申请指引', interestValue: 'site_support', guideUrl: 'https://globalgamejam.org/running-jam',
    notice: '申请开放时间与要求以 GGJ 官网最新信息为准。本次聚会与现场咨询不替代官方申请，正式结果由 GGJ 官方确认。',
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
  { id: 'speaker-three', start: '14:30', end: '15:15', time: '14:30–15:15', A: '讲座分享（三）· 讲者待定', B: 'GGJ 新站点筹备咨询（上半场）', C: '展位体验', tentative: true },
  { id: 'transition', start: '15:15', end: '15:30', time: '15:15–15:30', A: '茶歇与转场', B: '新站点筹备咨询（下半场）', C: '展位体验', tentative: true },
  { id: 'student-showcase', start: '15:30', end: '16:30', time: '15:30–16:30', A: 'ARTDiCO HOST 学员作品分享', B: '自由交流', C: '保留必要值班', tentative: true },
  { id: 'student-feedback', start: '16:30', end: '17:00', time: '16:30–17:00', A: '嘉宾移步展区', B: '嘉宾及学员交流', C: '学生作品体验与反馈', tentative: true },
  { id: 'ecosystem', start: '17:00', end: '17:45', time: '17:00–17:45', A: 'GGJ 组织者及生态合作交流', B: '合作洽谈', C: '展位交流', tentative: true },
  { id: 'closing', start: '17:45', end: '18:00', time: '17:45–18:00', A: '闭幕总结及合影', B: '嘉宾集合', C: '展位结束', tentative: true },
];

export const highlights = [
  { title: '交换经验', description: 'GGJ 主题分享、组织者圆桌与新站点筹备咨询。现场咨询不替代 GGJ 官方申请；主题与嘉宾待确认。' },
  { title: '发现作品', description: 'ARTDiCO HOST 学员作品分享、游戏试玩与开放展示，让青年创作者的想法获得交流与反馈。' },
  { title: '连接彼此', description: '产业技术与专题交流，连接高校、工具生态与社群，分享创作经验。' },
];

export const faqItems = [
  { question: '现在可以报名吗？', answer: '可以，活动报名已开放。本页表单仅供预览，不发送或保存资料。' },
  { question: '不是 GGJ 组织者也能参加吗？', answer: '可以，欢迎学生、开发者、高校、行业与生态伙伴参加。' },
  { question: '已经是站点负责人，或想建立新站点，怎么登记？', answer: '在申请表选择对应身份。详细经历及站点筹备情况由筹备同事后续联系。' },
  { question: '新站点现场咨询代表已通过申请吗？', answer: '不代表。请准备本地负责人、团队与场地，再通过 GGJ 官网 Start a Jam Site 申请。本次聚会和现场咨询不替代官方申请，开放时间与结果以 GGJ 官方信息为准。' },
  { question: '报名成功就有住宿吗？', answer: '一晚住宿须单独申请、审核；报名成功不代表获得住宿。' },
  { question: '如何修改或撤回资料？', answer: '本页预览表单不保存资料。本站正式表单启用前，将公布相关联系方式与申请流程。' },
];
