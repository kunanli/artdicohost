import { createXlsxWorkbook } from '../../shared/xlsx-workbook.mjs';
import { RegistrationAdminError } from './errors.mjs';

const ID = /^[A-Za-z0-9_-]{43}$/u;
const CONTACT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;
const validRevision = value => Number.isSafeInteger(value) && value >= 0;
const fail = code => { throw new RegistrationAdminError(code); };
const value = input => input === undefined || input === null ? '' : typeof input === 'string' ? input : typeof input === 'number' || typeof input === 'boolean' ? String(input) : JSON.stringify(input);
const contactKeys = new Set(['email', 'wechat', 'phone', 'contactMethods']);
const roles = { guest: '嘉宾', speaker: '讲者', panelist: '圆桌嘉宾', host: '主持', organizer: '研讨会组织者', booth: '展位', student_showcase: '学生展示', attendee: '参与者' };
const response = { pending: '待回复', attending: '实际回复参加', declined: '实际回复婉拒' };
const list = input => Array.isArray(input) ? input : [];

function flatten(input, includeContact, prefix = '', output = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length > 100 || prefix.split('.').length > 5) fail('STORAGE_UNAVAILABLE');
  for (const [name, item] of Object.entries(input)) {
    if (!includeContact && contactKeys.has(name)) continue;
    const path = prefix ? prefix + '.' + name : name;
    if (item && typeof item === 'object' && !Array.isArray(item)) flatten(item, includeContact, path, output);
    else output[path] = value(item);
  }
  return output;
}
function answerSheet(name, records, includeContact, getFields, getReference) {
  const flattened = records.map(record => flatten(getFields(record), includeContact));
  const fields = [...new Set(flattened.flatMap(record => Object.keys(record)))].sort();
  return { name, headers: ['稳定编号', ...fields], rows: records.map((record, index) => [getReference(record), ...fields.map(field => flattened[index][field] ?? '')]) };
}
function validateAdmissions(admissions, applicationRevision, registrations) {
  if (!admissions || !validRevision(admissions.revision) || admissions.revision !== applicationRevision) fail('REVISION_CONFLICT');
  if (!Array.isArray(admissions.people) || admissions.people.length > 1000 || !Array.isArray(admissions.teams) || admissions.teams.length > 100) fail('STORAGE_UNAVAILABLE');
  const people = new Map(), teams = new Map(), members = new Map();
  for (const person of admissions.people) {
    if (!ID.test(person.registrationId ?? '') || people.has(person.registrationId) || !['confirmed', 'waitlisted', 'withdrawn'].includes(person.status)
      || !['attendee', 'crew'].includes(person.kind) || typeof person.teamId !== 'string') fail('STORAGE_UNAVAILABLE');
    people.set(person.registrationId, person);
  }
  for (const team of admissions.teams) {
    if (typeof team.id !== 'string' || teams.has(team.id) || typeof team.name !== 'string' || !Array.isArray(team.memberIds) || team.memberIds.length > 50) fail('STORAGE_UNAVAILABLE');
    teams.set(team.id, team.name);
    for (const id of team.memberIds) { if (!people.has(id) || members.has(id)) fail('STORAGE_UNAVAILABLE'); members.set(id, team.id); }
  }
  if (admissions.people.some(person => person.teamId !== (members.get(person.registrationId) ?? '')) || registrations.some(record => !people.has(record.id))) fail('STORAGE_UNAVAILABLE');
  return { people, teams };
}
function validateArrangements(source) {
  if (!source || !validRevision(source.contactRevision) || !validRevision(source.contentRevision) || !Array.isArray(source.contacts) || source.contacts.length > 5000
    || !source.content || !Array.isArray(source.content.sessions) || !Array.isArray(source.content.booths) || !Array.isArray(source.conversions) || source.conversions.length > 1000) fail('STORAGE_UNAVAILABLE');
  const contacts = new Map(), registrations = new Map();
  for (const contact of source.contacts) {
    if (!CONTACT_ID.test(contact.id ?? '') || contacts.has(contact.id) || !contact.operations || !contact.profile) fail('STORAGE_UNAVAILABLE');
    contacts.set(contact.id, contact);
  }
  for (const conversion of source.conversions) {
    if (!ID.test(conversion.registrationId ?? '') || registrations.has(conversion.registrationId) || !contacts.has(conversion.sourceContactId)) fail('STORAGE_UNAVAILABLE');
    registrations.set(conversion.registrationId, contacts.get(conversion.sourceContactId));
  }
  return registrations;
}
function arrangementValues(contact, content) {
  if (!contact) return ['', '', '', '', '', ''];
  const operations = contact.operations;
  const sessions = new Map(content.sessions.map(item => [item.id, item])), booths = new Map(content.booths.map(item => [item.id, item]));
  const sessionLabel = id => { const session = sessions.get(id); return session ? [id, session.start + '–' + session.end, session.title, session.status === 'cancelled' ? '已取消' : ''].filter(Boolean).join(' · ') : id + ' · 历史场次已不存在'; };
  const allocations = list(operations.sessionIds).map(sessionLabel).join('\n');
  const duties = list(operations.sessionRoles).map(entry => sessionLabel(entry.sessionId) + '：' + list(entry.roles).map(role => roles[role] ?? role).join(' / ')).join('\n');
  const places = list(operations.boothIds).map(id => { const booth = booths.get(id); return booth ? [id, booth.code, booth.organization, booth.status === 'cancelled' ? '已取消' : ''].filter(Boolean).join(' · ') : id + ' · 历史展位已不存在'; }).join('\n');
  return [list(operations.participationForms).map(role => roles[role] ?? role).join(' / '), response[operations.responseStatus] ?? value(operations.responseStatus), value(operations.owner), allocations, duties, places];
}

function organizationMembershipValue(contact, content) {
  const memberships = contact?.operations?.organizationMemberships;
  if (memberships === undefined) return '';
  if (!Array.isArray(memberships) || memberships.length > 20
    || content.organizations !== undefined && !Array.isArray(content.organizations)) fail('STORAGE_UNAVAILABLE');
  const organizations = new Map((content.organizations ?? []).map(item => [item.id, item])), seen = new Set();
  return memberships.map(item => {
    if (!item || !CONTACT_ID.test(item.organizationId ?? '') || seen.has(item.organizationId)
      || !['lead', 'member'].includes(item.role) || typeof item.title !== 'string' || [...item.title].length > 120
      || /[\u0000-\u001f\u007f]/u.test(item.title)) fail('STORAGE_UNAVAILABLE');
    seen.add(item.organizationId);
    const organization = organizations.get(item.organizationId);
    return [organization ? organization.name : item.organizationId + ' · 历史组织已不存在',
      item.role === 'lead' ? '负责人' : '成员', item.title, organization?.status === 'withdrawn' ? '组织已退出' : ''].filter(Boolean).join(' · ');
  }).join('\n');
}

export function registrationWorkbook({ registrations, admissions, arrangements = null, includeContact = false, includeAnswers = false, includeArrangements = false, applicationRevision, reviewRevision, exportedAt }) {
  if (!Array.isArray(registrations) || registrations.length > 1000 || !validRevision(applicationRevision) || !validRevision(reviewRevision)
    || [includeContact, includeAnswers, includeArrangements].some(flag => typeof flag !== 'boolean')) fail('INVALID_REQUEST');
  const { people, teams } = validateAdmissions(admissions, applicationRevision, registrations);
  const linkedContacts = includeArrangements ? validateArrangements(arrangements) : null;
  const sourceRevisions = { applications: applicationRevision, admissions: admissions.revision, contacts: includeArrangements ? arrangements.contactRevision : null, content: includeArrangements ? arrangements.contentRevision : null };
  const sheets = [{ name: '报名与参会', headers: ['报名编号', '姓名', '机构', '职位', '城市', '原填写身份', '原参与意向', '原到场意向', '有效参会状态', '名额索引状态', '人员类别', '团队', '审核状态', '住宿审核', '实际通知记录', '资料来源', '本人网站同意', '保存时间 UTC', ...(includeContact ? ['邮箱', '微信'] : [])],
    rows: registrations.map(record => {
      const person = people.get(record.id), review = record.review;
      const effective = review.status === 'withdrawn' || review.deletionRequested !== null ? 'withdrawn' : person.status;
      return [record.referenceCode, record.fields.name, record.fields.organization, record.fields.position, record.fields.city, list(record.fields.categories).join(' / '), list(record.fields.participationInterests).join(' / '), record.fields.attendance,
        effective, person.status, person.kind, teams.get(person.teamId), review.status, review.accommodationStatus, review.invitationStatus, record.provenance.kind, record.consent.accepted, record.submittedAt,
        ...(includeContact ? [record.fields.email, record.fields.wechat] : [])].map(value);
    }) }];
  if (includeArrangements) sheets.push({ name: '当前参与职责与安排', headers: ['报名编号', '姓名', '来源联系人编号', '实际参与角色', '本人实际回复', '筹备负责人', '场次与时间', '逐场次职责', '展位与组织', '已关联参与组织与成员职责'],
    rows: registrations.map(record => { const contact = linkedContacts.get(record.id); return [record.referenceCode, record.fields.name, contact?.id ?? '', ...arrangementValues(contact, arrangements.content), organizationMembershipValue(contact, arrangements.content)].map(value); }) });
  if (includeAnswers) sheets.push(answerSheet('已保存原始回答', registrations, includeContact, record => record.fields, record => record.referenceCode));
  sheets.push({ name: '资料说明', headers: ['项目', '说明'], rows: [
    ['导出范围', '仅当前明确筛选的已保存报名；包含撤回及取消状态，除非主动按状态筛选。'], ['导出记录数', registrations.length], ['导出时间 UTC', exportedAt],
    ['审核修订（审计后）', reviewRevision + 1], ['报名／名额修订', applicationRevision], ['联系人修订', sourceRevisions.contacts ?? '未读取'], ['内容修订', sourceRevisions.content ?? '未读取'],
    ['联络字段', includeContact ? '主动选择包含邮箱／微信。' : '未包含结构化邮箱／微信字段。'], ['完整回答', includeAnswers ? '主动选择已保存原始回答；自由文本可能包含联络信息，分享前仍须核对。' : '未包含完整回答和内部长备注。'],
    ['参会状态', 'confirmed=确认名额；waitlisted=候补未确认；withdrawn=撤回／取消。审核、住宿、实际回复及场次职责分别记录，不互相推断。'],
    ['名额索引状态', '保留名额日志的原状态；若审核已撤回而名额释放待协调，有效参会状态仍为 withdrawn。'],
    ['角色与原始答案', '实际角色来自独立筹备安排。原填写身份／意向不会因角色调整被改写；团队关联不代表额外人数。'],
    ['快照范围', '报名与名额修订须一致；联系人及内容修订独立记录，不宣称跨日志原子事务。'],
    ['安全使用', '所有单元格为文字，编号与公式样式原文保留且不作为公式执行。私密下载不自动分享或发送。'],
  ].map(row => row.map(value)) });
  try { return { workbook: createXlsxWorkbook(sheets), sourceRevisions }; } catch { fail('CAPACITY_REACHED'); }
}

export function contactsWorkbook({ contacts, content, contactRevision, contentRevision, includeContact = false, includeAnswers = false, exportedAt }) {
  if (!Array.isArray(contacts) || contacts.length > 5000 || !validRevision(contactRevision) || !validRevision(contentRevision) || !content || !Array.isArray(content.sessions) || !Array.isArray(content.booths)
    || typeof includeContact !== 'boolean' || typeof includeAnswers !== 'boolean') fail('STORAGE_UNAVAILABLE');
  const ids = new Set();
  for (const contact of contacts) { if (!CONTACT_ID.test(contact.id ?? '') || ids.has(contact.id) || !contact.profile || !contact.operations || !contact.source) fail('STORAGE_UNAVAILABLE'); ids.add(contact.id); }
  const sheets = [{ name: '全部筹备人员', headers: ['联系人编号', '姓名', '显示姓名', '机构', '职位', '城市', '原身份', '原兴趣', '联络授权', '来源行号', '实际参与角色', '本人实际回复', '筹备负责人', '场次与时间', '逐场次职责', '展位与组织', ...(includeContact ? ['邮箱', '微信', '电话'] : []), ...(includeAnswers ? ['筹备备注'] : []), '已关联参与组织与成员职责'],
    rows: contacts.map(contact => [contact.id, contact.profile.name, contact.profile.displayName, contact.profile.organization, contact.profile.position, contact.profile.city, list(contact.profile.categories).join(' / '), list(contact.profile.interests).join(' / '), contact.profile.contactConsent, contact.source.rowId,
      ...arrangementValues(contact, content), ...(includeContact ? [contact.profile.email, contact.profile.wechat, contact.profile.phone] : []), ...(includeAnswers ? [contact.operations.notes] : []), organizationMembershipValue(contact, content)].map(value)) }];
  if (includeAnswers) {
    sheets.push(answerSheet('已保存意向回答', contacts, includeContact, contact => contact.profile, contact => contact.id));
    sheets.push(answerSheet('首次保存原件', contacts, includeContact, contact => ({ _原件状态: contact.sourceProfile ? '已保留首次保存原件' : '旧记录未附首次原件，未以现况冒充', ...(contact.sourceProfile ?? {}) }), contact => contact.id));
  }
  sheets.push({ name: '资料说明', headers: ['项目', '说明'], rows: [
    ['导出范围', '全部已保存联系人，包含尚未代登记、拒绝联络及婉拒者；不套用报名筛选。'], ['导出记录数', contacts.length], ['导出时间 UTC', exportedAt], ['联系人修订（导出前）', contactRevision], ['内容修订', contentRevision],
    ['联络字段', includeContact ? '主动选择包含结构化邮箱、微信及电话。' : '不包含结构化邮箱、微信及电话。'], ['完整回答', includeAnswers ? '主动选择已保存意向回答与筹备备注；自由文本可能含联络信息。' : '不包含完整回答及筹备备注。'],
    ['资料与状态保留', '角色、回复及分配改变不会删除原报名；本文件保留当前已保存资料，拒绝状态不等于已擦除，不能将导出用于向拒绝者发信。'],
    ['名额', '联系人不等于确认参会；实际名额须在报名与名额后台分别核对。'], ['安全使用', '所有单元格均为文字，公式样式原文不作为公式执行。导出审计成功后才返回下载；不创建公开链接。'],
    ['首次保存原件', '完整回答另列首次保存快照。旧记录缺少该快照时明确标记，不以可能已经更正的现况填成原件。'],
  ].map(row => row.map(value)) });
  try { return createXlsxWorkbook(sheets); } catch { fail('CAPACITY_REACHED'); }
}
