/** Private outreach data. Nothing in this contract belongs in public content. */
export const CONTACT_SCHEMA_VERSION = 1;
export const MAX_IMPORT_ROWS = 500;
export const MAX_CONTACTS = 5000;
export const CONTACT_PRIORITIES = Object.freeze(['normal', 'high']);
export const RESPONSE_STATUSES = Object.freeze(['pending', 'attending', 'declined']);
export const PARTICIPATION_FORMS = Object.freeze(['guest', 'speaker', 'panelist', 'host', 'organizer', 'booth', 'student_showcase', 'attendee']);
export const SESSION_ROLES = Object.freeze(['speaker', 'panelist', 'host', 'organizer', 'guest', 'attendee']);
export const SESSION_ROLE_LABELS = Object.freeze({ speaker: '讲者', panelist: '圆桌嘉宾', host: '主持', organizer: '研讨会组织者', guest: '嘉宾', attendee: '参与者' });
export const INVITATION_CHANNELS = Object.freeze(['wechat', 'email', 'other']);
export const CONTACT_CATEGORIES = Object.freeze(['so', 'ro', 'prospective_site', 'industry', 'developer', 'university', 'education', 'partner', 'other']);
export const CONTACT_INTERESTS = Object.freeze(['site_experience', 'talk', 'technical_share', 'roundtable', 'industry_networking', 'exhibition', 'product_demo', 'site_resources', 'sponsorship_partnership', 'attend_only']);
export const CONTACT_SOURCE_CHOICES = Object.freeze({
  contactConsent: ['consented', 'declined', 'unknown'],
  attendanceIntent: ['expected', 'uncertain', 'unknown'],
  accommodationIntent: ['needed', 'not_needed', 'uncertain', 'unknown'],
  futureCooperation: ['interested', 'declined', 'unknown'],
});
export const PROFILE_FIELDS = Object.freeze({
  name: 120, displayName: 120, city: 160, organization: 300, position: 200,
  email: 254, wechat: 150, phone: 150, background: 10000, needs: 4000,
  siteName: 300, siteRole: 300, siteYears: 200, topics: 4000, submittedAt: 100,
  website: 2048, caseLinks: 8192, attendanceIntentCode: 100, accommodationIntentCode: 100,
  contactConsentCode: 100, futureCooperationCode: 100,
  contactConsentLabel: 300, attendanceIntentLabel: 300, accommodationIntentLabel: 300, futureCooperationLabel: 300,
});
export const EDITABLE_CONTACT_FIELDS = Object.freeze([
  'name', 'displayName', 'city', 'organization', 'position', 'email', 'wechat', 'phone',
  'website', 'siteName', 'siteRole', 'topics', 'background',
]);
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

function object(input) {
  return input !== null && typeof input === 'object' && !Array.isArray(input) ? input : {};
}
function text(input) { return typeof input === 'string' ? input.normalize('NFC').trim() : ''; }
function field(errors, key, value, max, required = false) {
  if (required && !value) errors[key] = '请填写此项。';
  else if ([...value].length > max || CONTROL.test(value)) errors[key] = '文字过长或包含无效控制字符。';
}
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function choiceList(input, errors, key, max = 30, itemMax = 160) {
  if (!Array.isArray(input)) { errors[key] = '请提供选项数组。'; return []; }
  const values = Array.from(input.slice(0, max + 1), text);
  if (input.length > max || values.some((value, index) => typeof input[index] !== 'string' || !value || [...value].length > itemMax || CONTROL.test(value)) || new Set(values).size !== values.length) {
    errors[key] = '选项数量、内容或重复值无效。';
  }
  return values;
}

/** Whitelists imported source data; no consent or confirmed attendance is inferred. */
export function validateImportedContact(input) {
  const source = object(input);
  const errors = {};
  const value = { sourceRowId: text(source.sourceRowId) };
  field(errors, 'sourceRowId', value.sourceRowId, 100, true);
  if (/[\r\n\t]/u.test(value.sourceRowId)) errors.sourceRowId = '来源序号必须为单行文字。';
  for (const [key, max] of Object.entries(PROFILE_FIELDS)) {
    value[key] = text(source[key]);
    if (source[key] !== undefined && typeof source[key] !== 'string') errors[key] = '请提供文字。';
    field(errors, key, value[key], max);
  }
  if (!value.displayName) value.displayName = value.name;
  if (!value.name) value.name = value.displayName;
  field(errors, 'name', value.name, 120, true);
  field(errors, 'displayName', value.displayName, 120, true);
  value.email = value.email.toLowerCase();
  if (value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value.email)) errors.email = '邮箱格式无效，请先核对来源资料。';
  for (const [key, allowed] of Object.entries(CONTACT_SOURCE_CHOICES)) {
    value[key] = source[key] === undefined || source[key] === '' ? 'unknown' : text(source[key]);
    if (!allowed.includes(value[key])) errors[key] = '来源选项含义无效；没有文字对照时须保留为 unknown。';
  }
  value.categories = choiceList(source.categories ?? [], errors, 'categories');
  value.interests = choiceList(source.interests ?? [], errors, 'interests');
  if (value.categories.some((item) => !CONTACT_CATEGORIES.includes(item))) errors.categories = '来源身份选项无效，请先核对字段映射。';
  if (value.interests.some((item) => !CONTACT_INTERESTS.includes(item))) errors.interests = '来源参与方式无效，请先核对字段映射。';
  return { valid: Object.keys(errors).length === 0, errors, value };
}

export function createEmptyContactOperations() {
  return { owner: '', priority: 'normal', followUpAt: '', notes: '', responseStatus: 'pending', participationForms: [], sessionIds: [], boothIds: [], sessionRoles: [] };
}

/** Omitted new fields in an older client's full operations update do not erase
 * existing duties. Explicitly removing a session removes only its current link. */
export function preserveContactOperationDefaults(input, current) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return input;
  const value = { ...input };
  if (!Object.hasOwn(input, 'participationForms')) value.participationForms = current?.participationForms ?? [];
  if (!Object.hasOwn(input, 'sessionRoles')) value.sessionRoles = (current?.sessionRoles ?? [])
    .filter(entry => !Array.isArray(input.sessionIds) || input.sessionIds.includes(entry.sessionId));
  return value;
}

/** Adding a duty to an already linked session is also a new allocation. */
export function hasNewContactAllocations(next, current) {
  if (['sessionIds', 'boothIds', 'participationForms'].some(field => Array.isArray(next?.[field])
    && next[field].some(value => !(current?.[field] ?? []).includes(value)))) return true;
  return Array.isArray(next?.sessionRoles) && next.sessionRoles.some(entry => Array.isArray(entry?.roles)
    && entry.roles.some(role => !(current?.sessionRoles?.find(previous => previous.sessionId === entry.sessionId)?.roles ?? []).includes(role)));
}

function sessionRoleList(input, sessionIds, errors) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 50) { errors.sessionRoles = '请为最多 50 个已关联场次选择职责。'; return []; }
  const selected = new Set();
  return Array.from(input, (entry, index) => {
    const key = 'sessionRoles.' + index;
    const shape = entry !== null && typeof entry === 'object' && !Array.isArray(entry)
      && [Object.prototype, null].includes(Object.getPrototypeOf(entry)) && Reflect.ownKeys(entry).length === 2
      && ['sessionId', 'roles'].every(name => { const descriptor = Object.getOwnPropertyDescriptor(entry, name); return descriptor?.enumerable && Object.hasOwn(descriptor, 'value'); });
    const source = shape ? entry : {}, sessionId = text(source.sessionId);
    if (!shape
      || typeof source.sessionId !== 'string' || !ID.test(sessionId) || !sessionIds.includes(sessionId) || selected.has(sessionId)) {
      errors[key] = '职责须对应一个不重复且已关联的场次。';
    }
    selected.add(sessionId);
    const roles = choiceList(source.roles, errors, key + '.roles', SESSION_ROLES.length, 40);
    if (!roles.length || roles.some(role => !SESSION_ROLES.includes(role))) errors[key + '.roles'] = '请选择本场次的一项或多项有效职责。';
    return { sessionId, roles };
  });
}

/**
 * Saving assignments validates current content. Reading historic contacts must
 * not call this with current content: deleted references remain visible to staff.
 */
export function validateContactOperations(input, content) {
  const source = object(input);
  const errors = {};
  const value = {
    owner: text(source.owner), priority: text(source.priority), followUpAt: text(source.followUpAt),
    notes: text(source.notes), responseStatus: text(source.responseStatus),
    participationForms: choiceList(source.participationForms === undefined ? [] : source.participationForms, errors, 'participationForms', PARTICIPATION_FORMS.length, 40),
    sessionIds: choiceList(source.sessionIds, errors, 'sessionIds', 50, 80),
    boothIds: choiceList(source.boothIds, errors, 'boothIds', 50, 80),
  };
  value.sessionRoles = sessionRoleList(source.sessionRoles, value.sessionIds, errors);
  field(errors, 'owner', value.owner, 120);
  field(errors, 'notes', value.notes, 6000);
  if (!CONTACT_PRIORITIES.includes(value.priority)) errors.priority = '请选择正常或优先跟进。';
  if (!RESPONSE_STATUSES.includes(value.responseStatus)) errors.responseStatus = '请选择待回复、确认参加或婉拒。';
  if (value.participationForms.some(form => !PARTICIPATION_FORMS.includes(form))) errors.participationForms = '请选择本活动支持的参与形式。';
  if (value.followUpAt && !validDate(value.followUpAt)) errors.followUpAt = '请提供有效的 YYYY-MM-DD 日期。';
  const sessions = Array.isArray(content?.sessions) ? content.sessions : [];
  const booths = Array.isArray(content?.booths) ? content.booths : [];
  const selected = [];
  for (const id of value.sessionIds) {
    const session = sessions.find((item) => item.id === id);
    if (!ID.test(id) || content !== undefined && (!session || session.status === 'cancelled')) errors.sessionIds = '存在已删除、取消或无效的场次，请重新选择。';
    else if (session) selected.push(session);
  }
  for (const id of value.boothIds) {
    const booth = booths.find((item) => item.id === id);
    if (!ID.test(id) || content !== undefined && (!booth || booth.status === 'cancelled')) errors.boothIds = '存在已删除、取消或无效的展位，请重新选择。';
  }
  for (let left = 0; left < selected.length; left += 1) {
    for (let right = left + 1; right < selected.length; right += 1) {
      if (selected[left].status === 'scheduled' && selected[right].status === 'scheduled' && selected[left].start < selected[right].end && selected[right].start < selected[left].end) errors.sessionIds = '同一对象的已排场次时间重叠，请核对。';
    }
  }
  return { valid: Object.keys(errors).length === 0, errors, value };
}

export function validateInvitationSettings(input) {
  const source = object(input);
  const errors = {};
  const value = { recipientName: text(source.recipientName), date: text(source.date), time: text(source.time), venue: text(source.venue), confirmed: source.confirmed === true };
  field(errors, 'recipientName', value.recipientName, 120, true);
  field(errors, 'venue', value.venue, 300, true);
  if (!validDate(value.date)) errors.date = '请提供有效的 YYYY-MM-DD 日期。';
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d\s*[-–]\s*(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value.time)) errors.time = '请提供 HH:mm–HH:mm 时间段。';
  else {
    const [start, end] = value.time.split(/\s*[-–]\s*/u);
    if (end <= start) errors.time = '结束时间必须晚于开始时间。';
    value.time = start + '–' + end;
  }
  if (source.confirmed !== undefined && typeof source.confirmed !== 'boolean') errors.confirmed = '确认状态必须为布尔值。';
  return { valid: Object.keys(errors).length === 0, errors, value };
}

/** Validate stored shape without rejecting assignments removed from content later. */
export function validateStoredContact(input) {
  const source = object(input);
  const profileResult = validateImportedContact({ ...object(source.profile), sourceRowId: source.source?.rowId });
  if (!profileResult.valid || !ID.test(source.id ?? '') || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(source.source?.key ?? '') || !/^[a-f0-9]{64}$/u.test(source.source?.digest ?? '')) return false;
  if (Object.hasOwn(source, 'sourceProfile')) {
    const snapshot = source.sourceProfile;
    const fields = [...Object.keys(PROFILE_FIELDS), ...Object.keys(CONTACT_SOURCE_CHOICES), 'categories', 'interests'];
    if (typeof source.sourceProfileDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(source.sourceProfileDigest)
      || snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(snapshot)) || Object.getOwnPropertySymbols(snapshot).length
      || Object.getOwnPropertyNames(snapshot).length !== fields.length
      || fields.some(key => { const descriptor = Object.getOwnPropertyDescriptor(snapshot, key); return !descriptor || !('value' in descriptor) || !descriptor.enumerable; })) return false;
    const original = validateImportedContact({ ...snapshot, sourceRowId: source.source.rowId });
    if (!original.valid || fields.some(key => JSON.stringify(snapshot[key]) !== JSON.stringify(original.value[key]))) return false;
    // Corrections may change basic contact fields, never historic questionnaire
    // choices, original answer codes/labels or consent captured in the snapshot.
    if (fields.some(key => !EDITABLE_CONTACT_FIELDS.includes(key)
      && JSON.stringify(original.value[key]) !== JSON.stringify(profileResult.value[key]))) return false;
  } else if (Object.hasOwn(source, 'sourceProfileDigest')) return false;
  for (const date of [source.source?.importedAt, source.createdAt, source.updatedAt]) if (typeof date !== 'string' || !Number.isFinite(Date.parse(date))) return false;
  const operations = object(source.operations);
  if (!validateContactOperations(operations).valid) return false;
  const invitation = object(source.invitation);
  if (invitation.settings !== null && !validateInvitationSettings(invitation.settings).valid) return false;
  for (const key of ['generatedAt', 'sentAt', 'sentGenerationAt']) if (invitation[key] !== null && (typeof invitation[key] !== 'string' || !Number.isFinite(Date.parse(invitation[key])))) return false;
  if (invitation.channel !== null && !INVITATION_CHANNELS.includes(invitation.channel)) return false;
  if ((invitation.generatedAt === null) !== (invitation.settings === null)) return false;
  if (invitation.sentAt !== null && (!invitation.generatedAt || !invitation.sentGenerationAt || !invitation.channel)) return false;
  return true;
}
