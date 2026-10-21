/**
 * Frontend-only contract. No export here writes, sends, or accepts a real registration.
 * Proposed hard limits and conditional required fields still need product confirmation.
 * @typedef {{value:string,label:string}} Option
 * @typedef {{name:string,label:string,type:string,required:boolean,requiredFor?:string[],minLength?:number,maxLength?:number,min?:number,max?:number,options?:Option[],hint?:string,conditional?:string}} Field
 * @typedef {{label:string,fields:Field[]}} Branch
 */

export const CONSENT_VERSION = 'frontend-demo-v1';

/** @type {Option[]} */
export const identityOptions = [
  { value: 'so', label: 'GGJ SO（现任 / 曾任站点负责人）' },
  { value: 'ro', label: 'GGJ RO（现任 / 曾任地区负责人）' },
  { value: 'new_site', label: '有意成为 GGJ 站点 / 新站点筹备' },
  { value: 'industry', label: '游戏行业嘉宾或开发者' },
  { value: 'education', label: '高校 / 教育机构' },
  { value: 'partner', label: '生态合作伙伴' },
  { value: 'sponsor', label: '潜在赞助方' },
  { value: 'other', label: '其他来宾' },
  { value: 'student', label: '学生' },
];

/** @type {Option[]} */
export const participationOptions = [
  { value: 'roundtable', label: '站点圆桌' },
  { value: 'talk', label: '讲者报名 / 主题提案' },
  { value: 'workshop', label: '专题研讨' },
  { value: 'exhibition', label: '展位展示' },
  { value: 'site_support', label: '站点支持' },
  { value: 'partnership', label: '生态合作' },
  { value: 'sponsorship', label: '赞助合作咨询' },
  { value: 'student_exchange', label: '学员作品交流' },
  { value: 'attend', label: '仅出席' },
];

/** @type {Option[]} */
const yesNoUncertain = [
  { value: 'yes', label: '是' },
  { value: 'no', label: '否' },
  { value: 'uncertain', label: '尚不确定' },
];

/** @type {Field[]} */
const baseFields = [
  { name: 'name', label: '姓名', type: 'text', required: true, minLength: 2, maxLength: 80 },
  { name: 'city', label: '所在城市', type: 'text', required: true, maxLength: 100 },
  { name: 'organization', label: '所属机构 / 团队', type: 'text', required: false, requiredFor: ['speaker', 'exhibitor', 'partner'], maxLength: 160, hint: '普通参会选填；独立个人可填「独立开发者」。' },
  { name: 'position', label: '职位 / 身份', type: 'text', required: false, requiredFor: ['speaker', 'exhibitor', 'partner'], maxLength: 120, hint: '普通参会选填；讲者、展商与合作交流时填写。' },
  { name: 'email', label: '邮箱', type: 'email', required: true, maxLength: 254, hint: '未填写微信时，邮箱作为替代联络方式。演示请使用示例邮箱。' },
  { name: 'wechat', label: '微信号', type: 'text', required: false, maxLength: 100, hint: '建议填写；未填写时使用邮箱联系。' },
  { name: 'website', label: '个人 / 机构网站', type: 'url', required: false, maxLength: 2048 },
  { name: 'categories', label: '目前的参与身份', type: 'checkbox-group', required: true, options: identityOptions, hint: '可以多选，最终只是一份申请。' },
  { name: 'participationInterests', label: '参与方式与可选合作咨询', type: 'checkbox-group', required: true, options: participationOptions, hint: '普通参会可选「仅出席」。讲者、展位及赞助合作另行沟通，不影响普通报名。' },
  { name: 'background', label: '相关经历或机构简介', type: 'textarea', required: false, requiredFor: ['speaker', 'exhibitor', 'partner'], maxLength: 1000, hint: '普通参会选填；讲者、展商与合作交流时简要介绍，无需重复填写完整履历。' },
  { name: 'caseLinks', label: '相关站点 / 案例 / 作品链接', type: 'url-list', required: false, maxLength: 8192, hint: '选填，每行一个 http/https 链接，最多 5 个。' },
  { name: 'attendance', label: '12 月 5 日到场安排', type: 'select', required: true, options: [
    { value: 'expected', label: '预计可到场' }, { value: 'uncertain', label: '尚待确定' }, { value: 'unavailable', label: '暂无法出席' },
  ] },
  { name: 'accommodationChoice', label: '是否申请一晚住宿支持', type: 'select', required: true, options: [
    { value: 'needed', label: '需要（需单独审核）' }, { value: 'not_needed', label: '不需要' }, { value: 'uncertain', label: '尚不确定' },
  ], hint: '住宿单独审核；不影响普通参会报名，申请不代表获房。' },
  { name: 'departureCity', label: '出发城市', type: 'text', required: true, maxLength: 100, conditional: 'accommodation', hint: '仅申请一晚；入住 / 离店暂定为 12 月 5–6 日，不收证件。' },
  { name: 'topics', label: '希望交流的议题、可提供的资源或合作机会', type: 'textarea', required: false, maxLength: 2000 },
  { name: 'cooperationInterest', label: '所属机构是否有兴趣与 GGJ 探索未来合作', type: 'select', required: true, options: [
    { value: 'interested', label: '有兴趣' }, { value: 'learn_more', label: '希望了解更多' }, { value: 'none', label: '暂无计划' },
  ] },
  { name: 'cooperationForms', label: '潜在合作形式', type: 'checkbox-group', required: false, options: [
    { value: 'promotion', label: '活动联合推广' }, { value: 'tools', label: '技术与工具资源' }, { value: 'funding', label: '资金或物资支持' },
    { value: 'mentoring', label: '专业导师' }, { value: 'community', label: '社群交流' }, { value: 'education', label: '教育合作' }, { value: 'other', label: '其他' },
  ], hint: '选填；表达意向不代表承诺赞助。' },
  { name: 'consentAccepted', label: '我已阅读演示说明，并了解不会提交真实报名', type: 'checkbox', required: true, hint: '正式报名须另行展示经核定的个人信息处理告知并由你主动同意。此处不是正式隐私授权。' },
];

/** @type {Record<string,Branch>} */
const branches = {
  soRo: { label: '现有 / 历史 GGJ 站点负责人报名资料', fields: [
    { name: 'siteName', label: '站点名称', type: 'text', required: true, maxLength: 160 },
    { name: 'city', label: '站点城市', type: 'text', required: true, maxLength: 100 },
    { name: 'firstYear', label: '首次组织年份', type: 'number', required: true, min: 1900, max: 2026 },
    { name: 'role', label: '当前 / 历史角色', type: 'text', required: true, maxLength: 160 },
    { name: 'history', label: '站点组织经历 / 历史补充', type: 'textarea', required: false, maxLength: 2000, hint: '可补充服务年份与组织经历；不自动认定年资、表彰或官方资格。' },
    { name: 'shareCase', label: '是否愿意交流案例', type: 'select', required: true, options: yesNoUncertain },
  ] },
  newSite: { label: '有意成为 GGJ 站点（筹备资料）', fields: [
    { name: 'city', label: '申请城市', type: 'text', required: true, maxLength: 100 },
    { name: 'organization', label: '所属机构', type: 'text', required: true, maxLength: 160 },
    { name: 'venueReady', label: '场地是否具备', type: 'select', required: true, options: yesNoUncertain },
    { name: 'teamReady', label: '团队是否就绪', type: 'select', required: true, options: yesNoUncertain },
    { name: 'participating2027', label: '是否计划参加 2027 GGJ', type: 'select', required: true, options: yesNoUncertain },
    { name: 'supportNeeded', label: '希望获得的支持', type: 'textarea', required: true, maxLength: 1000 },
  ] },
  speaker: { label: '讲者报名与主题提案（另行沟通）', fields: [
    { name: 'topic', label: '拟分享主题', type: 'text', required: true, maxLength: 200 },
    { name: 'summary', label: '分享摘要', type: 'textarea', required: true, maxLength: 1500 },
    { name: 'language', label: '分享语言', type: 'text', required: true, maxLength: 100 },
    { name: 'caseLinks', label: '相关案例链接', type: 'url-list', required: false, maxLength: 8192, hint: '每行一个 http/https 链接，最多 5 个。照片和素材获邀后再收。' },
  ] },
  exhibitor: { label: '展位意向', fields: [
    { name: 'projectType', label: '展示项目类型', type: 'text', required: true, maxLength: 160 },
    { name: 'summary', label: '项目简介', type: 'textarea', required: true, maxLength: 1500 },
    { name: 'links', label: '项目链接', type: 'url-list', required: false, maxLength: 8192, hint: '每行一个 http/https 链接，最多 5 个。' },
    { name: 'attendeeCount', label: '参展人数估计', type: 'number', required: true, min: 1, max: 1000 },
    { name: 'equipment', label: '初步设备需求', type: 'textarea', required: false, maxLength: 1000 },
  ] },
  partner: { label: '赞助与生态合作咨询（另行沟通）', fields: [
    { name: 'direction', label: '合作方向', type: 'text', required: true, maxLength: 200 },
    { name: 'resources', label: '可提供的资源', type: 'textarea', required: false, maxLength: 1500, hint: '资金或物资支持为可选，不代表赞助承诺。' },
    { name: 'background', label: '机构背景', type: 'textarea', required: true, maxLength: 1500 },
  ] },
  accommodation: { label: '一晚住宿申请', fields: [baseFields[13]] },
};

export const registrationSchema = Object.freeze({
  version: CONSENT_VERSION,
  mode: 'mock',
  submissionEnabled: false,
  attendanceAcceptance: 'after_successful_persistence',
  attendeeReviewRequired: false,
  inquiryNotice: '普通参会在正式报名资料成功保存后即可参加；讲者、赞助、展位咨询和住宿申请分别处理。演示不会提交真实报名。',
  baseFields,
  branches,
  identityOptions,
  participationOptions,
  privacyNotice: '前端演示不发送或保存资料。正式表单须先核定处理者、联系方式、目的、存储地区、保留期及权利申请方式。',
});

/** @param {unknown} input @returns {Record<string,unknown>} */
function record(input) {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
    ? /** @type {Record<string,unknown>} */ (input) : {};
}

/** @param {unknown} input */
function text(input) { return typeof input === 'string' ? input.normalize('NFC').trim() : ''; }

/** @param {unknown} input */
function choices(input) {
  return Array.isArray(input) ? [...new Set(input.filter((value) => typeof value === 'string').map(text))] : [];
}

/** @param {Record<string,unknown>} source @param {Field} field */
function fieldValue(source, field) {
  if (field.type === 'checkbox') return source[field.name] === true;
  if (field.type === 'checkbox-group') return choices(source[field.name]);
  if (field.type === 'number') {
    const value = source[field.name];
    return typeof value === 'number' ? String(value) : text(value);
  }
  return text(source[field.name]);
}

/** @param {unknown} input @returns {string[]} */
export function getActiveBranches(input) {
  const source = record(input);
  const identities = choices(source.categories);
  const interests = choices(source.participationInterests);
  const active = [];
  if (identities.includes('so') || identities.includes('ro')) active.push('soRo');
  if (identities.includes('new_site')) active.push('newSite');
  if (interests.includes('talk')) active.push('speaker');
  if (interests.includes('exhibition')) active.push('exhibitor');
  if (identities.includes('partner') || identities.includes('sponsor') || interests.includes('partnership') || interests.includes('sponsorship')) active.push('partner');
  if (source.accommodationChoice === 'needed') active.push('accommodation');
  return active;
}

/** One required-field rule shared by browser UX and independent server validation.
 * @param {Field} field @param {unknown} input @param {string} [branch]
 */
export function isRegistrationFieldRequired(field, input, branch = '') {
  const active = getActiveBranches(input);
  if (branch && !active.includes(branch) || field.conditional && !active.includes(field.conditional)) return false;
  return field.required === true || Array.isArray(field.requiredFor) && field.requiredFor.some(name => active.includes(name));
}

/**
 * Whitelists input, drops inactive branch values, and never persists anything.
 * Accepts nested branch objects and exact dot-path names from a form adapter.
 * @param {unknown} [input]
 * @returns {Record<string,unknown>}
 */
export function normalizeRegistration(input = {}) {
  const source = record(input);
  /** @type {Record<string,unknown>} */
  const value = {};
  for (const field of baseFields) value[field.name] = fieldValue(source, field);
  const active = getActiveBranches(value);
  for (const [name, branch] of Object.entries(branches)) {
    if (name === 'accommodation' || !active.includes(name)) continue;
    const nested = record(source[name]);
    /** @type {Record<string,unknown>} */
    const normalized = {};
    for (const field of branch.fields) {
      const dottedName = `${name}.${field.name}`;
      const rawValue = Object.hasOwn(source, dottedName) ? source[dottedName] : nested[field.name];
      normalized[field.name] = fieldValue({ [field.name]: rawValue }, field);
    }
    value[name] = normalized;
  }
  if (!active.includes('accommodation')) delete value.departureCity;
  value.accommodationNights = active.includes('accommodation') ? 1 : 0;
  value.consentVersion = CONSENT_VERSION;
  return value;
}

/** @returns {Record<string,unknown>} */
export function createEmptyRegistration() { return normalizeRegistration(); }

/** @param {string} input */
function isHttpUrl(input) {
  try {
    const parsed = new URL(input);
    return ['https:', 'http:'].includes(parsed.protocol) && Boolean(parsed.hostname) && !parsed.username && !parsed.password;
  } catch { return false; }
}

/** @param {Field} field @param {unknown} value @returns {string | undefined} */
function fieldError(field, value) {
  const empty = value === '' || value === false || value === undefined || (Array.isArray(value) && value.length === 0);
  if (empty) return field.required ? (field.type === 'checkbox' ? '请主动确认演示说明。' : `请填写或选择${field.label}。`) : undefined;
  if (field.options) {
    const allowed = field.options.map((option) => option.value);
    const selected = Array.isArray(value) ? value : [value];
    if (selected.some((item) => typeof item !== 'string' || !allowed.includes(item))) return '请选择列表中提供的选项。';
  }
  if (typeof value !== 'string') return undefined;
  const length = [...value].length;
  if (field.minLength && length < field.minLength) return `至少填写 ${field.minLength} 个字。`;
  if (field.maxLength && length > field.maxLength) return `请控制在 ${field.maxLength} 字以内。`;
  if (field.type === 'email' && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(value)) return '请填写格式正确的邮箱。';
  if (field.type === 'url' && !isHttpUrl(value)) return '请填写不含登录凭据的 http/https 链接。';
  if (field.type === 'url-list') {
    const urls = value.split(/\r?\n/u).map((url) => url.trim()).filter(Boolean);
    if (urls.length > 5 || urls.some((url) => !isHttpUrl(url))) return '最多填写 5 个 http/https 链接，每行一个。';
  }
  if (field.type === 'number') {
    const number = Number(value);
    if (!/^\d+$/u.test(value) || !Number.isSafeInteger(number) || (field.min !== undefined && number < field.min) || (field.max !== undefined && number > field.max)) {
      return `请填写 ${field.min}–${field.max} 之间的整数。`;
    }
  }
  return undefined;
}

/**
 * This is UX validation only. Future production APIs must independently validate.
 * @param {unknown} input
 * @returns {{valid:boolean,errors:Record<string,string>,value:Record<string,unknown>}}
 */
export function validateRegistration(input) {
  const value = normalizeRegistration(input);
  const active = getActiveBranches(value);
  /** @type {Record<string,string>} */
  const errors = {};
  for (const field of baseFields) {
    if (field.conditional && !active.includes(field.conditional)) continue;
    const error = fieldError({ ...field, required: isRegistrationFieldRequired(field, value) }, value[field.name]);
    if (error) errors[field.name] = error;
  }
  for (const name of active) {
    if (name === 'accommodation') continue;
    const nested = record(value[name]);
    for (const field of branches[name].fields) {
      const error = fieldError({ ...field, required: isRegistrationFieldRequired(field, value, name) }, nested[field.name]);
      if (error) errors[`${name}.${field.name}`] = error;
    }
  }
  return { valid: Object.keys(errors).length === 0, errors, value };
}

/**
 * Completes only a local walkthrough. Never returns a real success/reference code,
 * never includes entered personal data in its result, and performs no I/O.
 * @param {unknown} input
 */
export function completeMockRegistration(input) {
  const { valid, errors } = validateRegistration(input);
  return {
    valid,
    errors,
    mode: 'mock',
    submissionStatus: 'not_submitted',
    message: valid ? '演示完成。没有发送或保存任何报名资料，尚未受理报名。' : '请检查标记的演示字段；没有提交报名。',
  };
}
