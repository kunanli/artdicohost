import { INVITATION_POSTER_FACTS } from '../../shared/organizer-progress.mjs';

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
  exhibition: { status: 'tentative', description: '现场展示游戏、技术工具及高校或社群项目，具体展位安排陆续公布。' },
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
  { id: 'registration-status', question: '现在可以报名吗？', answer: '参会申请须由主办方人工审核。请在本页申请区核对当前开放状态；申请收到不等于确认参会名额。' },
  { id: 'audience', question: '不是 GGJ 组织者也能参加吗？', answer: '可以，欢迎学生、开发者、高校、行业与生态伙伴参加。' },
  { id: 'site-role', question: '已经是站点负责人，或想建立新站点，怎么登记？', answer: '在申请表选择对应身份。详细经历及站点筹备情况由筹备同事后续联系。' },
  { id: 'site-official', question: '新站点现场咨询代表已通过申请吗？', answer: '不代表。请准备本地负责人、团队与场地，再通过 GGJ 官网 Start a Jam Site 申请。本次聚会和现场咨询不替代官方申请，开放时间与结果以 GGJ 官方信息为准。' },
  { id: 'lodging-support', question: '外地来宾有住宿支持吗？', answer: '本次活动提供少量外地来宾住宿支持。有需要的朋友，欢迎提前通过 support@artdico.co 联系主办方了解安排；名额有限，住宿安排将另行确认。' },
  { id: 'data-rights', question: '如何修改或撤回资料？', answer: '如需查阅、更正、撤回或删除资料，请联系主办方核对本人后处理；正式告知与联络方式以本页资料与隐私说明为准。' },
];

const factLine = (value, maximum = 1000) => typeof value === 'string' && value.length > 0 && value.length <= maximum
  && value.isWellFormed() && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
const factObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const factTitle = value => typeof value === 'string'
  ? value.replace(/^(\d{4}) GGJ 中国交流聚会 × ARTDiCO HOST 学生嘉年华$/u, '$1 GlobalGameJam 中国交流聚会 × ARTDiCO HOST 学生嘉年华') : value;
const factFailure = (reason, revision = null) => ({ ready: false, reason, revision, key: null });

/** Only public event facts cross this boundary. An explicit null publication
 * means the initial static site; an unreadable source must never become null.
 * Short venue names and the existing poster label refer to the same known venue.
 * Unrelated publication revisions deliberately do not change the semantic key. */
export function assessPublishedEventFacts(published, event = eventConfig) {
  let revision = null;
  try {
    const schedule = event?.time?.label || event?.time?.opening + '–' + event?.time?.end;
    const parts = typeof schedule === 'string' ? schedule.split(/\s*[-–]\s*/u) : [];
    const validTime = value => /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value ?? '');
    const expected = { id: event?.id, title: factTitle(event?.title), date: event?.date?.value,
      timezone: event?.time?.timezone, venue: event?.venue?.address || event?.venue?.name,
      opening: parts[0], end: parts[1], checkIn: event?.time?.start };
    if (event?.status !== 'confirmed' || event?.date?.status !== 'confirmed' || event?.venue?.confirmed !== true
      || Object.values(expected).some(value => !factLine(value)) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(expected.id)
      || !/^\d{4}-\d\d-\d\d$/u.test(expected.date) || new Date(expected.date + 'T00:00:00Z').toISOString().slice(0, 10) !== expected.date
      || parts.length !== 2 || ![expected.opening, expected.end, expected.checkIn].every(validTime)
      || expected.end <= expected.opening || expected.checkIn > expected.opening
      || event.time.opening !== undefined && event.time.opening !== expected.opening
      || event.time.end !== undefined && event.time.end !== expected.end) return factFailure('EVENT_FACTS_UNAVAILABLE');
    new Intl.DateTimeFormat('en', { timeZone: expected.timezone });
    const key = JSON.stringify(expected);
    if (published === null) return { ready: true, reason: 'EVENT_FACTS_VERIFIED', revision: null, key };
    if (!factObject(published) || !Number.isSafeInteger(published.revision) || published.revision < 0
      || !factObject(published.content) || !factObject(published.content.event)) return factFailure('EVENT_FACTS_UNAVAILABLE');
    revision = published.revision;
    const content = published.content, actual = content.event;
    const venues = [event.venue.name, event.venue.address].filter(value => factLine(value));
    if (event.venue.address === INVITATION_POSTER_FACTS.canonicalAddress) venues.push(INVITATION_POSTER_FACTS.venue);
    let matches = content.eventId === expected.id && factTitle(actual.title) === expected.title
      && actual.date === expected.date && actual.timezone === expected.timezone && venues.includes(actual.venue)
      && actual.status === 'confirmed' && actual.dateStatus === 'confirmed' && actual.venueStatus === 'confirmed';
    if (Object.hasOwn(actual, 'presentation')) {
      const display = actual.presentation;
      matches = matches && factObject(display) && display.openingTime === expected.opening
        && display.endTime === expected.end && display.checkInTime === expected.checkIn;
    }
    return matches ? { ready: true, reason: 'EVENT_FACTS_VERIFIED', revision, key } : factFailure('EVENT_FACTS_MISMATCH', revision);
  } catch { return factFailure('EVENT_FACTS_UNAVAILABLE', revision); }
}

/** Optional only for independently constructed legacy services. Production
 * composition always supplies its explicit, read-only publication dependency. */
export async function readEventFactsReadiness(readiness) {
  if (readiness === undefined) return { ready: true, reason: 'EVENT_FACTS_VERIFIED', revision: null, key: null };
  try {
    const value = await readiness(), revision = Number.isSafeInteger(value?.revision) && value.revision >= 0 ? value.revision : null;
    if (value?.ready !== true) return factFailure(value?.reason === 'EVENT_FACTS_MISMATCH' ? value.reason : 'EVENT_FACTS_UNAVAILABLE', revision);
    if (value.key !== undefined && value.key !== null && !factLine(value.key, 12000)) return factFailure('EVENT_FACTS_UNAVAILABLE', revision);
    return { ready: true, reason: 'EVENT_FACTS_VERIFIED', revision, key: value.key ?? null };
  } catch { return factFailure('EVENT_FACTS_UNAVAILABLE'); }
}

export const unchangedEventFacts = (before, after) => before?.ready === true && after?.ready === true && before.key === after.key;
