import { parsePersonSelection, personWorkspacePath, personWorkspaceView, personWorkspaceActions, personWorkspaceSteps, personAvailabilityText } from '../lib/person-workspace.mjs';
import { SESSION_ROLE_LABELS } from '../../shared/contacts-schema.mjs';
import { sourceLabels } from '../../shared/contact-import.mjs';
import { identityOptions, participationOptions } from '../../shared/registration-schema.mjs';

const $ = selector => document.querySelector(selector);
const profileFields = ['[data-person-profile]', '[data-person-registration]', '[data-person-admission]', '[data-person-arrangements]', '[data-person-communications]', '[data-person-actions]', '[data-person-steps]'];
const categoryLabels = new Map(sourceLabels.categories.map(item => [item.value, item.label]));
const interestLabels = new Map(sourceLabels.interests.map(item => [item.value, item.label]));
const registrationIdentityLabels = new Map(identityOptions.map(item => [item.value, item.label]));
const registrationInterestLabels = new Map(participationOptions.map(item => [item.value, item.label]));
const participationLabels = { guest: '嘉宾', speaker: '讲者', panelist: '圆桌嘉宾', host: '主持', organizer: '研讨会组织者', booth: '展位', student_showcase: '学生作品展示', attendee: '现场参与' };
const responseLabels = { pending: '尚未确认', attending: '已确认出席', declined: '不出席' };
const admissionLabels = { confirmed: '已确认参会名额', waitlisted: '候补，名额尚未确认', withdrawn: '已取消／撤回' };
const reviewLabels = { new: '新报名', in_review: '核查中', awaiting_maria: '待 Maria 审阅', approved: '审核已确认', discussion: '待讨论', not_this_time: '本次不邀请', withdrawn: '已撤回' };
const accommodationLabels = { not_requested: '未申请', requested: '已申请', pending: '待核对', approved: '已批准', declined: '未批准' };
const channelLabels = { manual: '人工邀请', email: '邮件', wechat: '微信', other: '其他' };
const noticeLabels = { prepared: '已准备，未记录发出', manually_sent: '已记录人工发出', provider_accepted: '服务商已接受，未证明送达', unknown: '结果待核对，不重复发送', reserved: '结果待核对，不重复发送', rejected: '明确未发出', generated: '已生成，未记录发出', sent: '已记录人工发出', disabled: '通知已停用', not_configured: '寄件尚未配置' };
let user = null, csrfToken = '', generation = 0, sequence = 0, authSequence = 0, authBusy = false, reading = false, personController = null, authController = null;

function node(tag, value, className) { const element = document.createElement(tag); if (value !== undefined) element.textContent = value; if (className) element.className = className; return element; }
function announce(message = '', error = false) {
  $('[data-person-status]').textContent = error ? '' : message;
  $('[data-person-error]').textContent = error ? message : '';
  $('[data-person-error]').hidden = !error;
  if (error) $('[data-person-error]').focus({ preventScroll: true });
}
const allowed = () => user?.roles.some(role => ['outreach', 'reviewer', 'superadmin'].includes(role));
function lock() {
  $('[data-person-login-submit]').disabled = authBusy || location.protocol === 'file:';
  $('[data-person-refresh]').disabled = authBusy || reading || !allowed();
  $('[data-person-logout]').disabled = authBusy || !user;
}
function clearRecord(message = '到人员或报名列表，选择「个人工作页」即可查看同一人的已保存记录。') {
  for (const selector of profileFields) $(selector).replaceChildren();
  $('[data-person-name]').textContent = '选择一位人员';
  $('[data-person-identity]').textContent = '';
  $('[data-person-linkage]').textContent = '';
  $('[data-person-meta]').textContent = '';
  $('[data-person-record]').hidden = true;
  $('[data-person-empty]').hidden = false;
  $('[data-person-empty-message]').textContent = message;
}
function clearPrivateState() {
  generation++; sequence++;
  personController?.abort(); authController?.abort(); personController = null; authController = null;
  user = null; csrfToken = ''; reading = false; authBusy = false;
  clearRecord(); $('[data-person-user]').textContent = '';
  $('[data-person-login]').reset();
  $('[data-person-login-panel]').hidden = false;
  $('[data-person-workspace]').hidden = true;
  lock();
}
function sessionValue(value) {
  if (!value || typeof value !== 'object' || !value.user || typeof value.user.id !== 'string' || !value.user.id
    || !Array.isArray(value.user.roles) || value.user.roles.length > 20 || value.user.roles.some(role => typeof role !== 'string' || role.length > 80)
    || typeof value.csrfToken !== 'string' || !value.csrfToken || value.csrfToken.length > 512) throw new Error('工作人员会话结果无效，请重新登录。');
  return { user: { id: value.user.id, label: typeof value.user.label === 'string' ? value.user.label : value.user.id, roles: [...value.user.roles] }, csrfToken: value.csrfToken };
}
async function readJson(response, controller) {
  if (!/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? '')) throw new Error('记录响应格式无效，请重新读取。');
  const maximum = 2 * 1024 * 1024, declared = response.headers.get('content-length');
  if (declared !== null && (!/^[0-9]+$/u.test(declared) || Number(declared) > maximum)) throw new Error('记录响应超出可核对范围。');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('记录响应暂时不可用，请重新读取。');
  const chunks = []; let size = 0;
  try {
    while (true) {
      if (controller.signal.aborted) throw new Error('读取已取消。');
      const part = await reader.read(); if (part.done) break;
      if (!(part.value instanceof Uint8Array) || (size += part.value.length) > maximum) throw new Error('记录响应超出可核对范围。');
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size); let offset = 0; for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { reader.cancel().catch(() => {}); reader.releaseLock(); }
}
async function request(path, { method = 'GET', body, controller = new AbortController(), epoch = generation } = {}) {
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 12_000);
  try {
    const response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (epoch !== generation || controller.signal.aborted) throw new Error('会话或读取对象已改变。');
    if (response.status === 401) { clearPrivateState(); const error = new Error(path === '/api/admin/login' ? '账号或密码未通过验证。' : '会话已结束，请重新登录。'); error.status = 401; announce(error.message, true); throw error; }
    if (!response.ok) {
      response.body?.cancel().catch(() => {});
      const message = { 403: '此账号没有读取这位人员记录的权限。', 404: '没有找到这条已保存记录，请返回名单核对。', 429: '请求较多，请稍后重新读取。', 503: '人员来源暂时无法核对，请稍后重新读取。' }[response.status] ?? '记录暂时无法读取，请稍后重试。';
      const error = new Error(message); error.status = response.status; throw error;
    }
    const value = await readJson(response, controller);
    if (epoch !== generation || controller.signal.aborted) throw new Error('会话或读取对象已改变。');
    return value;
  } catch (error) {
    if (timedOut) { const timeout = new Error('读取超过等待时间，请重新读取。'); timeout.timedOut = true; throw timeout; }
    throw error;
  } finally { clearTimeout(timer); }
}
function showSession(value) {
  const safe = sessionValue(value); generation++;
  personController?.abort(); personController = null;
  user = safe.user; csrfToken = safe.csrfToken;
  $('[data-person-user]').textContent = user.label;
  $('[data-person-login-panel]').hidden = true;
  $('[data-person-workspace]').hidden = false;
  clearRecord(); lock();
}
function fact(output, label, value) { if (value === '' || value === null || value === undefined) return; output.append(node('dt', label), node('dd', String(value))); }
function facts() { return node('dl', undefined, 'person-facts'); }
function stateMessage(output, state) { const paragraph = node('p', personAvailabilityText(state), 'person-state'); paragraph.dataset.state = state; output.append(paragraph); }
function dateLabel(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '时间未记录';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Taipei', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) + '（UTC+8）';
}
function badge(label, status) { const tag = node('span', label, 'person-badge'); if (status) tag.dataset.admission = status; return tag; }
function renderProfile(view) {
  const output = $('[data-person-profile]');
  if (view.availability.contact !== 'available') stateMessage(output, view.availability.contact);
  const profile = view.contact?.profile ?? view.registration?.fields;
  if (profile) {
    const list = facts();
    for (const [key, label] of [['name', '姓名'], ['displayName', '邀请称呼'], ['organization', '机构／团队'], ['position', '职务'], ['city', '城市'], ['email', '邮箱'], ['wechat', '微信'], ['phone', '电话']]) fact(list, label, profile[key]);
    output.append(list);
  }
  if (view.contact) {
    const follow = facts(), operations = view.contact.operations;
    fact(follow, '原始身份', view.contact.profile.categories.map(value => categoryLabels.get(value) ?? value).join('、'));
    fact(follow, '原始参与意向', view.contact.profile.interests.map(value => interestLabels.get(value) ?? value).join('、'));
    fact(follow, '联络同意', { consented: '已明确同意联络', declined: '不同意联络', unknown: '尚未核实' }[view.contact.profile.contactConsent] ?? '待核对');
    fact(follow, '负责同事', operations.owner || '尚未分配'); fact(follow, '优先级', operations.priority === 'high' ? '优先跟进' : '普通'); fact(follow, '下次跟进', operations.followUpAt || '尚未安排');
    output.append(node('h3', '当前跟进'), follow);
    if (operations.notes) { const notes = node('details'); notes.append(node('summary', '查看内部跟进备注'), node('p', operations.notes)); output.append(notes); }
  }
}
function renderAdmission(view) {
  const output = $('[data-person-admission]');
  if (view.availability.admission === 'available') { const group = node('p', undefined, 'person-badges'); group.append(badge(admissionLabels[view.admission.status], view.admission.status), badge(view.admission.kind === 'crew' ? '工作人员名额' : '一般参会名额')); output.append(group); }
  else stateMessage(output, view.availability.admission);
  if (view.contact) { const list = facts(); fact(list, '本人出席回复', responseLabels[view.contact.operations.responseStatus] ?? '待核对'); output.append(node('h3', '实际回复'), list); }
  else if (view.availability.contact === 'restricted') output.append(node('p', '本人回复及人员跟进资料需要人员邀约权限。', 'person-note'));
  output.append(node('p', '参会名额、本人回复、审核与住宿分别核对。', 'person-note'));
}
function renderRegistration(view) {
  const output = $('[data-person-registration]');
  if (view.availability.registration !== 'available') { stateMessage(output, view.availability.registration); return; }
  const item = view.registration, list = facts();
  fact(list, '报名编号', item.referenceCode); fact(list, '报名姓名', item.fields.name); fact(list, '保存时间', dateLabel(item.submittedAt));
  fact(list, '报名来源', { public: '本人公开报名', staff_assisted: '根据既有意向代登记', staff_entry: '工作人员受托逐人登记' }[item.provenance.kind] ?? '来源待核对');
  fact(list, '审核状态', reviewLabels[item.review.status] ?? '待核对'); fact(list, '住宿审核', accommodationLabels[item.review.accommodationStatus] ?? '待核对');
  fact(list, '审核负责人', item.review.assignedTo || '尚未分配'); fact(list, '核查下一步', item.review.nextStep || '尚未填写');
  fact(list, '报名身份', item.fields.categories.map(value => registrationIdentityLabels.get(value) ?? value).join('、'));
  fact(list, '报名参与意向', item.fields.participationInterests.map(value => registrationInterestLabels.get(value) ?? value).join('、'));
  fact(list, '原始出席意向', ({ expected: '预计可到场', uncertain: '尚待确定', unavailable: '暂无法出席' })[item.fields.attendance] || '待核对');
  fact(list, '原始住宿申请', ({ needed: '申请住宿，需单独审核', not_needed: '不需要', uncertain: '尚不确定' })[item.fields.accommodationChoice] || '待核对');
  if (item.review.deletionRequested) fact(list, '资料维护', '已登记删除申请，尚未宣称完成擦除');
  output.append(list);
  if (item.provenance.kind !== 'public') output.append(node('p', '工作人员代登记保留原始来源，不代表本人完成网站隐私同意。', 'person-note'));
}
function renderArrangements(view) {
  const output = $('[data-person-arrangements]');
  if (view.contact) {
    const labels = view.contact.operations.participationForms.map(value => participationLabels[value] ?? value), group = node('p', undefined, 'person-badges');
    for (const label of labels) group.append(badge(label));
    output.append(node('h3', '全活动职责'), labels.length ? group : node('p', '尚未标记活动职责。', 'person-muted'));
  }
  if (view.availability.arrangements !== 'available') { stateMessage(output, view.availability.arrangements); return; }
  output.append(node('h3', '参与场次'));
  const sessions = node('ul', undefined, 'person-list');
  for (const item of view.arrangements.sessions) { const row = node('li'); row.append(node('strong', item.missing ? '历史场次已不存在' : item.title || '场次待命名'), node('p', item.missing ? '保留原关联，需在人员安排中核对。' : [item.start + '–' + item.end, item.zone ? item.zone + ' 区' : '', item.status === 'cancelled' ? '已取消' : ''].filter(Boolean).join(' · '))); if (item.roles.length) row.append(node('p', '本场职责：' + item.roles.map(value => SESSION_ROLE_LABELS[value] ?? value).join('、'))); sessions.append(row); }
  output.append(sessions.childNodes.length ? sessions : node('p', '尚未关联活动场次。', 'person-muted'), node('h3', '出席展位'));
  const booths = node('ul', undefined, 'person-list');
  for (const item of view.arrangements.booths) { const row = node('li'); row.append(node('strong', item.missing ? '历史展位已不存在' : [item.code, item.organization || item.project || '资料待完善'].filter(Boolean).join(' · ')), node('p', item.missing ? '保留原关联，需在人员安排中核对。' : [item.position ? '位置 ' + item.position : '', item.project, item.status === 'cancelled' ? '已取消' : ''].filter(Boolean).join(' · '))); booths.append(row); }
  output.append(booths.childNodes.length ? booths : node('p', '尚未关联出席展位。', 'person-muted'));
  output.append(node('h3', '关联的公开人物资料'));
  if (view.publicProfile.state !== 'available') stateMessage(output, view.publicProfile.state);
  else {
    const profiles = node('ul', undefined, 'person-list');
    for (const item of view.publicProfile.profiles) {
      const row = node('li'); row.append(node('strong', item.name || '姓名待完善'), node('p', [item.company, item.title].filter(Boolean).join(' · ')));
      row.append(node('p', [item.status === 'confirmed' ? '草稿已确认' : '草稿待确认', item.publicConsent ? '已记录公开授权' : '未记录公开授权', item.hasPortrait ? '已有照片' : '尚未上传照片', item.published ? item.publishedMatchesDraft ? '已发布内容与当前人物草稿一致' : '旧版已发布，当前草稿变更待发布' : '尚未在已发布快照找到此人物'].join(' · ')));
      if (item.publicRoles.length) row.append(node('p', '公开职责：' + item.publicRoles.map(role => ({ speaker: '讲者', guest: '嘉宾', organizer: '研讨会组织者', moderator: '主持人' })[role] || role).join('、')));
      profiles.append(row);
    }
    output.append(profiles);
    if (view.publicProfile.publishedRevision !== null) output.append(node('p', '已发布内容版本 ' + view.publicProfile.publishedRevision + (view.publicProfile.publishedAt ? ' · ' + dateLabel(view.publicProfile.publishedAt) : ''), 'person-note'));
  }
}
function renderCommunications(view) {
  const output = $('[data-person-communications]');
  for (const [key, label] of [['invitations', '工作人员邀请'], ['confirmations', '公开报名确认邮件']]) if (view.availability[key] !== 'available') { output.append(node('h3', label)); stateMessage(output, view.availability[key]); }
  const timeline = node('ol', undefined, 'person-timeline');
  for (const entry of view.communications.timeline) {
    const row = node('li'), title = entry.source === 'confirmation' ? entry.kind === 'promotion' ? '候补转正确认邮件' : '公开报名确认邮件' : entry.source === 'legacy_invitation' ? '手工邀请函记录' : '报名邀请';
    row.append(node('strong', title + ' · ' + (noticeLabels[entry.status] ?? '状态待核对')));
    const time = node('time', dateLabel(entry.at)); if (entry.at) time.dateTime = entry.at; row.append(time);
    if (entry.channel) row.append(node('p', '渠道：' + (channelLabels[entry.channel] ?? '待核对'))); timeline.append(row);
  }
  if (timeline.childNodes.length) output.append(timeline);
  else if (['invitations', 'confirmations'].some(key => view.availability[key] === 'available')) output.append(node('p', '目前没有可显示的邀请或通知记录。', 'person-muted'));
  if (view.communications.historyTruncated) output.append(node('p', '仅显示最近 200 条记录，完整历史仍保留。', 'person-note'));
}
function render(view) {
  clearRecord();
  $('[data-person-name]').textContent = view.person.displayName || view.person.name || '未填写姓名';
  $('[data-person-identity]').textContent = [view.person.organization, view.person.position, view.person.city].filter(Boolean).join(' · ');
  $('[data-person-linkage]').textContent = ({ linked: '依据已保存的关联核对人员与报名，不按同名自动合并。', unlinked: '目前只有这一份记录，尚未关联另一份人员／报名资料。', restricted: '其他关联资料按账号权限显示，未读取受限记录。', unavailable: '关联来源暂时无法完整核对，下方分别显示可用范围。' })[view.linkage.state];
  for (const action of personWorkspaceActions(view, user.roles)) { const link = node('a', action.label, 'ah-admin-button'); link.href = action.href; link.dataset.personAction = action.key; $('[data-person-actions]').append(link); }
  for (const step of personWorkspaceSteps(view, user.roles)) {
    const row = node('li'); row.dataset.personStep = step.key; row.dataset.stepState = step.state;
    const heading = node('div', undefined, 'person-step-heading'); heading.append(node('strong', step.label), node('span', ({ complete: '已完成', pending: '待处理', review: '待核对', restricted: '无权限' })[step.state], 'person-badge'));
    row.append(heading, node('p', step.detail));
    if (step.action) { const link = node('a', step.action.label); link.href = step.action.href; link.dataset.personStepAction = step.key; row.append(link); }
    $('[data-person-steps]').append(row);
  }
  renderProfile(view); renderAdmission(view); renderRegistration(view); renderArrangements(view); renderCommunications(view);
  const revisions = Object.entries(view.revisions).filter(([, revision]) => revision !== null).map(([key, revision]) => ({ contacts: '人员', content: '活动', invitations: '邀请', registration: '核查', admission: '名额', confirmations: '确认通知' })[key] + '版本 ' + revision);
  $('[data-person-meta]').textContent = '本页仅呈现已保存记录，各来源独立更新。' + (revisions.length ? ' ' + revisions.join(' · ') : '');
  $('[data-person-empty]').hidden = true; $('[data-person-record]').hidden = false;
}
async function loadPerson({ focus = false } = {}) {
  const started = ++sequence, epoch = generation, selection = parsePersonSelection(location.hash);
  personController?.abort(); const controller = new AbortController(); personController = controller;
  clearRecord(); announce();
  if (!user) { lock(); return; }
  if (!allowed()) { clearRecord('此账号需要人员邀约或报名审核权限，才能读取个人工作页。'); announce('此账号没有读取个人工作页的权限。', true); reading = false; lock(); return; }
  if (!selection) { clearRecord(location.hash ? '人员链接无效，请从人员或报名列表重新打开。' : undefined); reading = false; lock(); return; }
  reading = true; lock(); announce('正在核对这位人员的已保存记录…');
  try {
    const value = await request(personWorkspacePath(selection), { controller, epoch });
    if (started !== sequence || epoch !== generation || controller.signal.aborted) return;
    const view = personWorkspaceView(value, selection); if (!view) throw new Error('人员记录结果未通过核对，请重新读取。');
    render(view); announce('已读取当前可核对的记录。');
    if (focus) $('[data-person-name]').focus({ preventScroll: true });
  } catch (error) {
    if (started !== sequence || epoch !== generation || (controller.signal.aborted && !error.timedOut)) return;
    clearRecord(error.message || '记录暂时无法读取，请重新打开。'); announce(error.message || '人员资料暂时无法读取。', true);
  } finally { if (started === sequence && epoch === generation) { reading = false; personController = null; lock(); } }
}
$('[data-person-login]').addEventListener('submit', async event => {
  event.preventDefault(); if (authBusy || !event.currentTarget.reportValidity()) return;
  const form = event.currentTarget, login = Object.fromEntries(new FormData(form));
  const operation = ++authSequence;
  authBusy = true; authController?.abort(); const controller = new AbortController(); authController = controller; lock();
  const epoch = generation;
  try { const value = await request('/api/admin/login', { method: 'POST', body: login, controller, epoch }); if (epoch !== generation || operation !== authSequence) return; showSession(value); if (authController === controller) authController = null; authBusy = false; lock(); await loadPerson({ focus: true }); }
  catch (error) { if (epoch === generation && operation === authSequence) announce(error.message || '登录暂时未完成，请重试。', true); }
  finally { login.password = ''; if (operation === authSequence) form.elements.namedItem('password').value = ''; if (authController === controller) authController = null; if (operation === authSequence) authBusy = false; lock(); }
});
$('[data-person-logout]').addEventListener('click', async () => {
  if (authBusy || !user) return; personController?.abort(); sequence++; reading = false; clearRecord();
  const operation = ++authSequence;
  authBusy = true; const epoch = generation, controller = new AbortController(); authController = controller; lock();
  try { await request('/api/admin/logout', { method: 'POST', controller, epoch }); if (epoch !== generation) return; clearPrivateState(); announce('已退出，当前页的人员资料已清空。'); }
  catch (error) { if (epoch === generation && operation === authSequence) { clearRecord(); announce(error.message || '退出结果尚未核对，请重试。', true); } }
  finally { if (authController === controller) authController = null; if (operation === authSequence) authBusy = false; lock(); }
});
$('[data-person-refresh]').addEventListener('click', () => { if (!authBusy && !reading) loadPerson(); });
window.addEventListener('hashchange', () => { if (user && !authBusy) loadPerson({ focus: true }); else { sequence++; personController?.abort(); clearRecord(); } });
clearPrivateState();
if (location.protocol === 'file:') announce('请通过工作人员后台打开此页；离线预览不含私有人员记录。');
else {
  const operation = ++authSequence;
  authBusy = true; lock(); const epoch = generation, controller = new AbortController(); authController = controller;
  request('/api/admin/session', { controller, epoch }).then(async value => { if (epoch !== generation || operation !== authSequence) return; showSession(value); if (authController === controller) authController = null; authBusy = false; lock(); await loadPerson(); })
    .catch(error => { if (error.status !== 401 && epoch === generation) announce(error.message || '工作人员会话暂时无法核对。', true); })
    .finally(() => { if (authController === controller) authController = null; if (operation === authSequence) authBusy = false; lock(); });
}
