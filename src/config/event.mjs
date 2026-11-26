import { INVITATION_POSTER_FACTS } from '../../shared/organizer-progress.mjs';
// The organizer's public contact is independent of staff account identities.
export const PUBLIC_CONTACT_EMAIL = 'kunan@globalgamejam.org';
export const PUBLIC_REGISTRATION_URL = 'https://9525102647817.huodongxing.com/event/8884819113200';
export const PUBLIC_EVENT_DETAILS_URL = 'https://artdico.host/event/';
export const PUBLIC_MEETUP_TITLE = 'GGJ China Meetup 2026 x ARTDiCO HOST';
export const PUBLIC_AGENDA_URL = 'https://artdico.host/#agenda';
export const PUBLIC_SHOWCASE_URL = 'https://artdico.host/#students';

export function appleMapsDirectionsUrl(address) {
  return 'https://maps.apple.com/directions?destination=' + encodeURIComponent(address);
}

/** Public event content only; contains no private allocation or attendee data. */
export const eventConfig = {
  id: 'ggj-cn-2026',
  year: 2026,
  title: '2026 GlobalGameJam 中国交流聚会 × ARTDiCO HOST 学生嘉年华',
  subtitle: '组织者交流 · 学生作品 · 游戏体验',
  siteRegistration: {
    existing: { title: '我已是 GGJ 站点负责人', categories: ['so', 'ro'], description: '普通参会请前往活动行报名；站点交流与合作需求请联系筹备团队。' },
    prospective: { title: '我想在城市组织 GGJ 站点', categories: ['new_site'], description: '了解本地负责人、团队与场地准备，并通过 GGJ 官网 Start a Jam Site 申请。' },
    notice: '现场可进行 GGJ 站点审核，请提前准备本地负责人、组织团队与场地资料。',
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
    notice: '本站接收讲者分享提案，由筹备团队另行联系。普通参会请前往活动行报名。',
  },
  sites: {
    status: 'guidance', title: '想在您的城市组织 GGJ 站点？',
    description: '准备本地负责人、组织团队与场地，再通过 GGJ 官网的 Start a Jam Site 入口提交申请。',
    ctaLabel: '查看官方申请指引', interestValue: 'site_support', guideUrl: 'https://globalgamejam.org/running-jam',
    notice: '现场可进行 GGJ 站点审核。请准备本地负责人、组织团队与场地资料，申请要求请查看 GGJ 官方指引。',
  },
};

export const zones = [
  { id: 'A', name: '阶梯展示厅', description: '分享 / 作品 / 交流' },
  { id: 'B', name: '咖啡厅', description: '圆桌 / 专题 / 咨询' },
  { id: 'C', name: '外围展位区', description: '试玩 / 展示 / 反馈', summary: '09:30–18:00 展位体验。' },
];

const scheduleByZone = {
  A: [
    ['arrival', '09:30', '10:00', '签到入场'],
    ['ggj-talk', '10:15', '11:00', '主题演讲：At the Forefront of the Future: How Jammers Are Leading Innovation', 'talk'],
    ['speaker-one', '11:15', '12:00', '10年GGJ发展在中国，与中国独立游戏行业的联动与萌芽', 'talk'],
    ['recognition', '12:00', '12:30', 'GGJ表彰大会及合影'],
    ['speaker-two', '13:30', '14:30', 'AI × Houdini：从自然语言到 Unreal Engine 程序化构建', 'talk'],
    ['university-teesside', '14:35', '14:55', '提赛德大学宣讲', 'talk'],
    ['university-bournemouth', '15:00', '15:20', '伯恩茅斯大学宣讲', 'talk'],
    ['student-showcase', '15:30', '17:00', 'ARTDiCO 学生展示', 'showcase'],
    ['closing', '17:00', '17:10', '闭幕合影'],
  ],
  B: [
    ['speaker-two', '13:30', '14:00', '亚洲 Games for Change 与新一代创作者'],
    ['southeast-asia', '14:00', '14:30', '东南亚游戏生态、新平台与合作'],
    ['speaker-three', '14:30', '15:00', 'GGJ 站点咨询（北方站）'],
    ['transition', '15:00', '15:30', 'GGJ 站点咨询（南方站）'],
    ['speaker-one', '15:40', '16:40', '圆桌会议', 'roundtable'],
  ],
  C: [
    ['arrival', '09:30', '18:00', '展位体验'],
  ],
};

/** @typedef {{id:string,zone:'A'|'B'|'C',start:string,end:string,title:string,format:'talk'|'roundtable'|'showcase'|'other'}} AgendaSlot */
/** @returns {AgendaSlot[]} */
function zoneSessions(zone /** @type {keyof typeof scheduleByZone} */) {
  return scheduleByZone[zone].map(([id, start, end, title, format]) => ({
    id: `session-${id}-${zone.toLowerCase()}`, zone, start, end, title,
    format: format === 'talk' || format === 'roundtable' || format === 'showcase' ? format : 'other',
  }));
}

export const approvedMeetupAgenda = [...zoneSessions('A'), ...zoneSessions('B'), ...zoneSessions('C')];
export const approvedMeetupAgendaEnglish = new Map([
  ['签到入场', 'Check-in'],
  ['主题演讲：At the Forefront of the Future: How Jammers Are Leading Innovation', 'Keynote: At the Forefront of the Future: How Jammers Are Leading Innovation'],
  ['10年GGJ发展在中国，与中国独立游戏行业的联动与萌芽', 'Ten Years of GGJ in China: Roots and Connections in the Chinese Indie Game Scene'],
  ['GGJ表彰大会及合影', 'GGJ recognition ceremony & group photo'],
  ['AI × Houdini：从自然语言到 Unreal Engine 程序化构建', 'AI × Houdini: From Natural Language to Procedural Creation in Unreal Engine'],
  ['提赛德大学宣讲', 'Teesside University presentation'],
  ['伯恩茅斯大学宣讲', 'Bournemouth University presentation'],
  ['ARTDiCO 学生展示', 'ARTDiCO student showcase'],
  ['闭幕合影', 'Closing group photo'],
  ['亚洲 Games for Change 与新一代创作者', 'Games for Change in Asia and the Next Generation of Creators'],
  ['东南亚游戏生态、新平台与合作', 'Southeast Asia’s Games Ecosystem: New Platforms and Collaboration'],
  ['GGJ 站点咨询（北方站）', 'GGJ jam-site guidance (northern sites)'],
  ['GGJ 站点咨询（南方站）', 'GGJ jam-site guidance (southern sites)'],
  ['圆桌会议', 'Roundtable'],
  ['展位体验', 'Exhibition demos'],
]);
export const agenda = [...approvedMeetupAgenda]
  .sort((left, right) => left.start.localeCompare(right.start) || left.zone.localeCompare(right.zone));

export const highlights = [
  { title: '交换经验', description: 'GGJ 主题分享、组织者圆桌与现场站点审核。' },
  { title: '发现作品', description: 'ARTDiCO HOST 学员作品分享、游戏试玩与开放展示，让青年创作者的想法获得交流与反馈。' },
  { title: '连接彼此', description: '产业技术与专题交流，连接高校、工具生态与社群，分享创作经验。' },
];

export const faqItems = [
  {id:'wallet-card',question:'如何申请电子纪念卡？',answer:'完成活动行报名后，在本页填写报名编号、姓名、邮箱与微信号。工作人员核对报名并确认卡面身份后，会寄出领取链接。打开即可下载 JPEG，也可在 iPhone 上加入 Apple Wallet 长期收藏。现场签到请使用活动行原电子票。'},
  { id: 'registration-status', question: '现在可以报名吗？', answer: '普通参会请前往活动行报名，开放状态、报名结果与参会凭证以活动行页面为准。' },
  { id: 'audience', question: '不是 GGJ 组织者也能参加吗？', answer: '可以，欢迎学生、开发者、高校、行业与生态伙伴参加。' },
  { id: 'site-role', question: '已经是站点负责人，或想建立新站点，怎么登记？', answer: '现任或曾任 GGJ 站点负责人（SO / RO），以及筹备新站点的朋友，均可通过活动行报名参会。新站点筹备或站点交流需求，可通过 '+PUBLIC_CONTACT_EMAIL+' 留言，筹备团队会联系了解支持需求。\n'+eventConfig.siteRegistration.notice+'请准备本地负责人、组织团队与场地，再通过 GGJ 官网 Start a Jam Site 申请，开放时间以官方信息为准。' },
  { id: 'site-official', question: '现场可以进行 GGJ 站点审核吗？', answer: '可以。现场可进行 GGJ 站点审核，请准备本地负责人、组织团队与场地资料，并提前联系筹备团队了解安排。' },
  { id: 'lodging-support', question: '外地来宾有住宿支持吗？', answer: '本次活动提供少量外地来宾住宿支持。有需要的朋友，欢迎提前通过 '+PUBLIC_CONTACT_EMAIL+' 联系主办方了解安排；名额有限，住宿安排将另行确认。' },
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

/** Display only: an explicit server flag selects automatic admission copy.
 * Missing or malformed metadata retains the legacy review journey. This does
 * not determine any person's receipt, admission, ticket or delivery result. */
export function registrationUiCopy(metadata) {
  const automatic = metadata?.attendeeReviewRequired === false;
  const waitlist = metadata?.admissions?.waitlistEnabled === true;
  return {
    automatic,
    title: automatic ? '报名参加。' : '申请参加。',
    homeLabel: automatic ? '报名参加' : '申请参加',
    openLabel: automatic ? '活动报名' : '参会申请',
    modeLabel: automatic ? '报名开放' : '人工审核',
    notice: automatic ? '填写资料 → 确认名额 → 领取入场券' : '提交申请 → 主办方审核 → 确认名额与邀请',
    disclaimer: automatic ? waitlist ? '名额用完将登记候补；分享提案另行审选。' : '报名结果以完成页为准；分享提案另行审选。' : '本机暂存不等于提交；提交后等待审核。',
    submitLabel: automatic ? '提交报名' : '提交参会申请',
    availability: automatic ? waitlist ? '报名开放 · 满额候补' : '报名开放' : '参会申请开放，须人工审核',
    emailHint: automatic ? '用于接收报名结果及参会通知。' : '用于查询申请及接收审核后的通知。',
    faq: automatic
      ? '可以直接在本站报名。系统会按剩余名额确认报名结果；'+(waitlist?'名额用完将登记候补。':'')+'名额确认后可领取入场券。分享提案另行审选，不影响一般参会报名。'
      : '可以提交参会申请。申请收到后需由主办方人工审核；待审核不占参会名额。审核通过并确认名额后再发送正式邀请。',
  };
}
