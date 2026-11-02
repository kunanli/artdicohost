import { parsePersonSelection, personWorkspacePath, personWorkspaceView, personWorkspaceActions, personWorkspaceSteps, personAvailabilityText, personNextAction, personSourceView } from '../lib/person-workspace.mjs';
import { ownerTagPresentation, attendancePresentation, profilePublicationPresentation, savedContactReceipt, conversionPreview, conversionReceipt } from '../lib/people-relationships.mjs';
import { createPeopleResolution } from '../lib/people-resolution.mjs';
import { createOperationsFormDraft, createOperationsSaveState, captureDraftFields, applyDraftFields, operationsDraftStore } from '../lib/operations-form-draft.mjs';
import { createPersonConfirmation } from '../lib/person-confirmation.mjs';
import {createPeopleNavigation,peopleSelectionKey,peopleSelectionHref,peopleReturnHref,peopleNextSelection,validatePeopleDirectory} from '../lib/people-directory.mjs';
import { reviewConfirmationLink } from '../lib/registration-review-selection.mjs';
import { SESSION_ROLE_LABELS, validateContactOperations } from '../../shared/contacts-schema.mjs';
import { sourceLabels } from '../../shared/contact-import.mjs';
import { identityOptions, participationOptions } from '../../shared/registration-schema.mjs';

const $ = selector => document.querySelector(selector);
const profileFields = ['[data-person-profile]', '[data-person-registration]', '[data-person-admission]', '[data-person-arrangements]', '[data-person-organizations]', '[data-person-volunteers]', '[data-person-communications]', '[data-person-actions]', '[data-person-steps]'];
const categoryLabels = new Map(sourceLabels.categories.map(item => [item.value, item.label]));
categoryLabels.set('student', '学生');
const interestLabels = new Map(sourceLabels.interests.map(item => [item.value, item.label]));
const registrationIdentityLabels = new Map(identityOptions.map(item => [item.value, item.label]));
const registrationInterestLabels = new Map(participationOptions.map(item => [item.value, item.label]));
const participationLabels = { guest: '嘉宾', speaker: '讲者', panelist: '圆桌嘉宾', host: '主持', organizer: '研讨会组织者', booth: '展位', student_showcase: '学生作品展示', attendee: '现场参与' };
const admissionLabels = { confirmed: '已确认参会名额', waitlisted: '已核准候补，名额尚未确认', pending_review: '申请待审核，尚无参会名额', rejected: '申请未通过，尚无参会名额', withdrawn: '已取消／撤回' };
const reviewLabels = { new: '新报名', in_review: '核查中', awaiting_maria: '待 Maria 审阅', approved: '审核已确认', discussion: '待讨论', not_this_time: '本次不邀请', withdrawn: '已撤回' };
const accommodationLabels = { not_requested: '未申请', requested: '已申请', pending: '待核对', approved: '已批准', declined: '未批准' };
const channelLabels = { manual: '人工邀请', email: '邮件', wechat: '微信', other: '其他' };
const noticeLabels = { prepared: '已准备，未记录发出', manually_sent: '已记录人工发出', provider_accepted: '邮件服务已接收，未证明送达', unknown: '结果待核对，不重复发送', reserved: '结果待核对，不重复发送', rejected: '明确未发出', generated: '已生成，未记录发出', sent: '已记录人工发出', disabled: '通知已停用', not_configured: '寄件尚未配置' };
let user = null, csrfToken = '', generation = 0, sequence = 0, authSequence = 0, authBusy = false, reading = false, personController = null, authController = null;
const quickNames = ['responseStatus', 'owner', 'followUpAt', 'notes'];
const registrationProfileLimits = {name:120,email:254,organization:300,position:200,city:160,wechat:150,phone:150};
const registrationProfileNames = Object.keys(registrationProfileLimits);
const registrationIdPattern = /^[A-Za-z0-9_-]{43}$/u;
const profileOperationPattern = /^[A-Za-z0-9_-]{32,128}$/u;
const operationNames = ['owner', 'priority', 'followUpAt', 'notes', 'responseStatus', 'participationForms', 'sessionIds', 'boothIds', 'sessionRoles'];
const peopleNavigation=createPeopleNavigation();
let navigationBusy=false,personFresh=false,navigationEnd=false,lastConfirmationCheck=null;
let selectedView = null, quickDraft = null, quickRevision = null, quickBase = null, quickDirty = false, quickBusy = false,
  quickPending = null, quickRetryReady = false, syncIssue = '', relatedRefresh = false, quickFocus = null, mutationController = null, credential = null, credentialBusy = false, sourceSequence = 0, transportBusy = 0;
const quickForm = $('[data-person-quick-form]');
const quickSaveState = createOperationsSaveState({form: quickForm, button: $('[data-person-quick-save]'), status: $('[data-person-quick-state]')});
const profileForm = $('[data-person-profile-form]');
const profileSaveState = createOperationsSaveState({form:profileForm,button:$('[data-person-profile-save]'),status:$('[data-person-profile-state]')});
let profileDraft=null,profileEditing=false,profileDirty=false,profileBusy=false,profilePending=null,profileRetryReady=false,
  profileBase=null,profileRevision=null,profileAccessRevision=null,profileController=null,profileFocus=null;
const personConfirmation = createPersonConfirmation({root: $('[data-person-confirmation]'), request, getUser: () => user,
  draftStore:operationsDraftStore(),onInvalidated:clearPrivateState,onLockChange:confirmationStateChanged,onChecked:checked=>{lastConfirmationCheck={...checked,key:currentKey()};renderConfirmationCheck();},
  isBlocked: () => reading || quickBusy || transportBusy > 0 || quickDirty || Boolean(quickPending) || profileLocked(),isSendBlocked:deliveryUnknown, onChanged: () => { if (!quickDirty && !quickPending && !profileLocked()) void loadPerson({preserve:true}); }});
const resolution = createPeopleResolution({root: $('[data-people-resolution]'), request, getUser: () => user,
  onChanged: () => loadPerson({preserve:true}), onIntegrate: integratePerson});

function node(tag, value, className) { const element = document.createElement(tag); if (value !== undefined) element.textContent = value; if (className) element.className = className; return element; }
function announce(message = '', error = false) {
  $('[data-person-status]').textContent = error ? '' : message;
  $('[data-person-error]').textContent = error ? message : '';
  $('[data-person-error]').hidden = !error;
  if (error) $('[data-person-error]').focus({ preventScroll: true });
}
const allowed = () => user?.roles.some(role => ['outreach', 'reviewer', 'superadmin'].includes(role));
function renderConfirmationCheck(){
  const output=$('[data-person-last-check]');output.replaceChildren();output.hidden=true;
  if(!lastConfirmationCheck||!user||lastConfirmationCheck.key!==currentKey()||lastConfirmationCheck.registrationId!==selectedView?.registration?.id)return;
  const time=node('time',new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Taipei',dateStyle:'medium',timeStyle:'medium'}).format(new Date(lastConfirmationCheck.checkedAt))+'（UTC+8）');time.dateTime=lastConfirmationCheck.checkedAt;
  output.append('上次核对：',time);output.hidden=false;
}
function confirmationStateChanged(){
  if(personConfirmation.pending&&selectedView){$('[data-person-service-panel]').hidden=false;$('[data-person-credential]').hidden=!credentialRegistration();}
  renderNavigation();
}
function navigationUnresolved(){
  const view=selectedView;if(!view)return true;
  return Boolean(deliveryUnknown()||view.communications.unresolvedConfirmations
    ||view.communications.confirmations.some(item=>['unknown','reserved','issuing'].includes(item.status))
    ||['invitations','confirmations'].some(key=>view.permissions[key]&&['unavailable','restricted'].includes(view.availability[key])));
}
function profileLocked(){return profileDirty||profileBusy||Boolean(profilePending)||Boolean(profileDraft?.blocked);}
function mayNavigate(){return Boolean(user&&selectedView&&personFresh&&!authBusy&&!reading&&!quickBusy&&!transportBusy&&!credentialBusy&&!quickDirty&&!quickPending&&!quickDraft?.blocked&&!profileLocked()&&!syncIssue&&!relatedRefresh&&!personConfirmation.blocked&&!navigationUnresolved());}
function renderNavigation(){
  const panel=$('[data-person-list-context]');if(!panel)return;
  const key=currentKey(),context=user&&key?peopleNavigation.read(user,{selection:key}):null;
  panel.hidden=!context;
  for(const control of document.querySelectorAll('[data-person-list-return]')){control.setAttribute('aria-disabled',String(Boolean(selectedView)&&(!mayNavigate()||navigationBusy)));if(control.tagName==='BUTTON')control.disabled=!mayNavigate()||navigationBusy;}
  $('[data-person-next]').disabled=!context||context.ids.length<2||!mayNavigate()||navigationBusy||navigationEnd;
}
async function nextPerson(){
  if(navigationBusy||!mayNavigate())return;const context=peopleNavigation.read(user,{selection:currentKey()});if(!context)return;
  const epoch=generation,key=currentKey(),actor=user.id;navigationBusy=true;lock();$('[data-person-navigation-status]').textContent='正在核对下一位…';
  const current=()=>epoch===generation&&user?.id===actor&&currentKey()===key;
  try{
    await loadPerson({preserve:true});if(!current())return;await personConfirmation.settled;if(!current())return;if(!mayNavigate()){$('[data-person-navigation-status]').textContent='当前记录仍需核对，请先处理后继续。';return;}
    const view=context.view==='registrations'?'all':context.view;
    const read=cursor=>request('/api/admin/people/directory?'+new URLSearchParams({view,work:context.work,limit:'50',...(context.query?{query:context.query}:{}),...(cursor?{cursor}:{})}),{epoch,current});
    let cursor=context.cursor,trail=[...context.trail],value;
    try{value=await read(cursor);}catch(error){if(error.status!==409||!cursor)throw error;cursor='';trail=[];value=await read('');}
    if(!current()||!mayNavigate())return;if(!validatePeopleDirectory(value,view))throw Error('名单结果暂时无法核对。');
    let ids=value.rows.filter(row=>row.kind==='person').map(peopleSelectionKey).filter(Boolean).slice(0,50),index=ids.indexOf(key),next=peopleNextSelection(context.ids,key,ids);
    if(index<0&&!next)throw Error('名单已更新，请返回名单核对。');
    if(index===ids.length-1&&value.nextCursor){const previous=value.revision,position=cursor;cursor=value.nextCursor;value=await read(cursor);if(!current()||!mayNavigate())return;if(!validatePeopleDirectory(value,view)||value.revision!==previous)throw Error('名单已更新，请返回名单核对。');trail=[...trail,position].slice(-20);ids=value.rows.filter(row=>row.kind==='person').map(peopleSelectionKey).filter(Boolean).slice(0,50);next=ids[0];}
    if(!next){navigationEnd=true;$('[data-person-navigation-status]').textContent='当前筛选已无下一位，可返回名单。';return;}
    if(!peopleNavigation.save(user,{view:context.view,query:context.query,work:context.work,cursor,trail,revision:value.revision,ids,selected:next,focus:next,scrollY:value.revision===context.revision?context.scrollY:0}))throw Error('名单位置暂时无法保留，请返回名单。');
    if(current()&&mayNavigate())location.hash=peopleSelectionHref(next).split('#')[1];
  }catch(error){if(current())$('[data-person-navigation-status]').textContent=error.message||'下一位暂时无法核对，请重试。';}
  finally{if(current()){navigationBusy=false;lock();}else navigationBusy=false;}
}
function lock() {
  $('[data-person-login-submit]').disabled = authBusy || location.protocol === 'file:';
  $('[data-person-refresh]').disabled = authBusy || reading || quickBusy || profileBusy || transportBusy > 0 || credentialBusy || !allowed();
  $('[data-person-logout]').disabled = authBusy || !user;
  const blocked = authBusy || reading || quickBusy || navigationBusy || transportBusy > 0 || !user;
  for (const field of quickForm.querySelectorAll('input,select,textarea')) field.disabled = blocked || profileLocked() || Boolean(quickPending) || Boolean(quickDraft?.blocked);
  $('[data-person-quick-save]').disabled = blocked || profileLocked() || !quickDirty || Boolean(quickPending) || !quickDraft || quickDraft.blocked;
  $('[data-person-quick-check]').disabled = blocked;
  $('[data-person-quick-retry]').disabled = blocked || !quickRetryReady;
  $('[data-person-primary]').disabled = blocked || profileBusy || !selectedView;
  $('[data-person-credential-prepare]').disabled = blocked || profileLocked() || credentialBusy || !credentialRegistration();
  $('[data-person-credential-copy]').disabled = blocked || profileLocked() || credentialBusy || !credential;
  const profileBlocked=blocked||profileBusy||quickDirty||Boolean(quickPending)||Boolean(quickDraft?.blocked)||personConfirmation.pending||credentialBusy;
  for(const field of profileForm.querySelectorAll('input'))field.disabled=profileBlocked||Boolean(profilePending)||Boolean(profileDraft?.blocked);
  $('[data-person-profile-edit]').disabled=profileBlocked||!profileEditable();
  $('[data-person-profile-save]').disabled=profileBlocked||!profileDirty||Boolean(profilePending)||!profileDraft||profileDraft.blocked;
  $('[data-person-profile-cancel]').disabled=profileBlocked||Boolean(profilePending);
  $('[data-person-profile-check]').disabled=profileBlocked;
  $('[data-person-profile-retry]').disabled=profileBlocked||!profileRetryReady;
  $('[data-person-service-open]').disabled=blocked||profileLocked();
  personConfirmation.lock();
  resolution.lock();
  if(profileLocked())for(const control of document.querySelectorAll('[data-people-resolution] button,[data-resolution-dialog] button,[data-resolution-dialog] input'))control.disabled=true;
  renderNavigation();
  if (transportBusy) for (const control of document.querySelectorAll('[data-resolution-dialog] button,[data-resolution-dialog] input')) control.disabled = true;
}
function clearCredential() {
  credential = null; credentialBusy = false;
  $('[data-person-credential-open]').removeAttribute('href');
  $('[data-person-credential-result]').hidden = true;
  $('[data-person-credential-fallback]').value = ''; $('[data-person-credential-fallback]').hidden = true;
  $('[data-person-credential-status]').textContent = '';
}
function clearQuick() {
  quickDraft?.close(); quickDraft = null; mutationController?.abort(); mutationController = null;
  quickRevision = null; quickBase = null; quickDirty = false; quickBusy = false; quickPending = null; quickRetryReady = false; syncIssue = ''; relatedRefresh = false; quickFocus = null;
  quickForm.reset(); for (const name of quickNames) quickForm.elements.namedItem(name).value = name === 'responseStatus' ? 'pending' : '';
  $('[data-person-quick-panel]').open = false; $('[data-person-quick-panel]').hidden = true;
  $('[data-person-quick-check]').hidden = true; $('[data-person-quick-retry]').hidden = true;
  $('[data-person-quick-outcome]').textContent = ''; $('[data-person-quick-outcome]').hidden = true; quickSaveState.set('idle');
}
function clearProfile() {
  profileDraft?.close();profileDraft=null;profileController?.abort();profileController=null;
  profileEditing=false;profileDirty=false;profileBusy=false;profilePending=null;profileRetryReady=false;
  profileBase=null;profileRevision=null;profileAccessRevision=null;profileFocus=null;profileForm.reset();profileForm.hidden=true;
  $('[data-person-profile-edit]').hidden=true;$('[data-person-profile-primary]').hidden=true;$('[data-person-profile-primary]').removeAttribute('href');
  $('[data-person-profile-check]').hidden=true;$('[data-person-profile-retry]').hidden=true;$('[data-person-profile-email-note]').hidden=true;
  $('[data-person-profile-outcome]').textContent='';$('[data-person-profile-outcome]').hidden=true;
  profileSaveState.set('idle');
}
function clearRecord(message = '到人员或报名列表，选择「个人工作页」即可查看同一人的已保存记录。') {
  personFresh=false;navigationEnd=false;
  $('[data-person-navigation-status]').textContent='';
  if(!user||lastConfirmationCheck?.key!==currentKey())lastConfirmationCheck=null;
  $('[data-person-last-check]').replaceChildren();$('[data-person-last-check]').hidden=true;
  clearQuick(); clearProfile(); clearCredential(); personConfirmation.clear(); resolution.clear(); selectedView = null; sourceSequence++;
  $('[data-person-summary]').replaceChildren(); $('[data-person-primary-reason]').textContent = '';
  $('[data-person-source]').replaceChildren(); $('[data-person-source-state]').textContent = '';
  $('[data-person-source-panel]').open = false; $('[data-person-more]').open = false; $('[data-person-service-panel]').hidden = true;
  for (const selector of profileFields) $(selector).replaceChildren();
  $('[data-person-name]').textContent = '选择一位人员';
  $('[data-person-identity]').textContent = '';
  $('[data-person-linkage]').textContent = '';
  $('[data-person-meta]').textContent = '';
  $('[data-person-record]').hidden = true;
  $('[data-person-empty]').hidden = false;
  $('[data-person-empty-message]').textContent = message;
}
function clearPrivateState({preserveNavigation=false}={}) {
  if(!preserveNavigation)peopleNavigation.clear();navigationBusy=false;
  generation++; sequence++;
  personController?.abort(); authController?.abort(); personController = null; authController = null;
  user = null; csrfToken = ''; reading = false; authBusy = false; transportBusy = 0;
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
async function request(path, { method = 'GET', body, controller = new AbortController(), epoch = generation, signal, current = () => true } = {}) {
  if (epoch !== generation || !current()) throw new Error('当前对象已改变。');
  let timedOut = false;
  const mutation = method !== 'GET' && !['/api/admin/login','/api/admin/logout'].includes(path);
  if (mutation) { transportBusy++; lock(); }
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 12_000);
  try {
    if (!current()) throw new Error('当前对象已改变。');
    const activeSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
    const response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: activeSignal,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) }, ...(body ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
    if (epoch !== generation || activeSignal.aborted || !current()) throw new Error('会话或读取对象已改变。');
    if (response.status === 401) { clearPrivateState(); const error = new Error(path === '/api/admin/login' ? '账号或密码未通过验证。' : '会话已结束，请重新登录。'); error.status = 401; announce(error.message, true); throw error; }
    if (!response.ok) {
      response.body?.cancel().catch(() => {});
      const message = { 400: '请核对填写内容。', 403: '此账号没有处理这位人员记录的权限。', 404: '没有找到这条已保存记录，请返回名单核对。', 409: '资料已变化，请先核对当前记录。', 422: '填写内容未通过核对，请检查后再保存。', 429: '请求较多，请稍后重新读取。', 503: '人员来源暂时无法核对，请稍后重新读取。' }[response.status] ?? '记录暂时无法读取，请稍后重试。';
      const error = new Error(message); error.status = response.status; throw error;
    }
    const value = await readJson(response, {signal: activeSignal});
    if (epoch !== generation || activeSignal.aborted || !current()) throw new Error('会话或读取对象已改变。');
    return value;
  } catch (error) {
    if (timedOut) { const timeout = new Error('读取超过等待时间，请重新读取。'); timeout.timedOut = true; throw timeout; }
    throw error;
  } finally { clearTimeout(timer); if (mutation && epoch === generation) { transportBusy = Math.max(0, transportBusy - 1); lock(); } }
}
function showSession(value) {
  const safe = sessionValue(value); generation++;
  personController?.abort(); personController = null;
  user = safe.user; csrfToken = safe.csrfToken; transportBusy = 0;
  $('[data-person-user]').textContent = user.label;
  $('[data-person-login-panel]').hidden = true;
  $('[data-person-workspace]').hidden = false;
  clearRecord(); lock();
}
function fact(output, label, value) { if (value === '' || value === null || value === undefined) return; output.append(node('dt', label), node('dd', String(value))); }
function facts() { return node('dl', undefined, 'person-facts'); }
function statusBadge(label,tone) { const badge=node('span',label,'ah-status');badge.dataset.statusTone=tone;return badge; }
function stateMessage(output, state) { const paragraph = node('p', personAvailabilityText(state), 'person-state'); paragraph.dataset.state = state; output.append(paragraph); }
function dateLabel(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '时间未记录';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Taipei', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) + '（UTC+8）';
}
function badge(label, status) { const tag = node('span', label, 'person-badge'); if (status) tag.dataset.admission = status; return tag; }
function renderProfile(view) {
  const output = $('[data-person-profile]');
  if (view.availability.contact !== 'available' && !view.registration) stateMessage(output, view.availability.contact);
  const profile = view.registration?.profileCorrection ? {...view.contact?.profile,...view.registration.fields,displayName:view.registration.fields.name} : view.contact?.profile ?? view.registration?.fields;
  if (profile) {
    const list = facts();
    for (const [key, label] of [['name', '姓名'], ['displayName', '邀请称呼'], ['organization', '机构／团队'], ['position', '职务'], ['city', '城市'], ['email', '邮箱'], ['wechat', '微信'], ['phone', '电话']]) fact(list, label, profile[key]);
    output.append(list);
  }
  if (view.contact) {
    const follow = facts(), operations = view.contact.operations;
    fact(follow, '当前身份', view.contact.profile.categories.map(value => categoryLabels.get(value) ?? value).join('、'));
    fact(follow, '原始身份／意向', view.contact.sourceCategories.map(value => categoryLabels.get(value) ?? value).join('、'));
    fact(follow, '原始参与意向', view.contact.profile.interests.map(value => interestLabels.get(value) ?? value).join('、'));
    fact(follow, '联络同意', { consented: '已明确同意联络', declined: '不同意联络', unknown: '尚未核实' }[view.contact.profile.contactConsent] ?? '待核对');
    const owner=ownerTagPresentation(operations.owner),ownerValue=node('dd'),ownerBadge=node('span',owner.label,'ah-owner-tag');ownerBadge.dataset.ownerTone=owner.tone;ownerBadge.dataset.personOwner='';ownerValue.append(ownerBadge);follow.append(node('dt','负责同事'),ownerValue); fact(follow, '优先级', operations.priority === 'high' ? '优先跟进' : '普通'); fact(follow, '下次跟进', operations.followUpAt || '尚未安排');
    output.append(node('h3', '当前跟进'), follow);
    if (operations.notes) { const notes = node('details'); notes.append(node('summary', '查看内部跟进备注'), node('p', operations.notes)); output.append(notes); }
  }
}
function renderAdmission(view) {
  const output = $('[data-person-admission]');
  if (view.availability.admission === 'available') { const group = node('p', undefined, 'person-badges'); group.append(badge(admissionLabels[view.admission.status], view.admission.status), badge(view.admission.kind === 'crew' ? '工作人员名额' : '一般参会名额')); output.append(group); }
  else stateMessage(output, view.availability.admission);
  if (view.contact) { const list = facts(),status=attendancePresentation(view.contact.operations.responseStatus),value=node('dd'),badge=statusBadge(status.label,status.tone);badge.dataset.attendanceStatus=view.contact.operations.responseStatus;value.append(badge);list.append(node('dt','本人出席回复'),value);output.append(node('h3', '实际回复'), list); }
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
  if (view.publicProfile.state !== 'available') {const badge=statusBadge(view.publicProfile.state==='unlinked'?'尚未关联人物资料':'公开状态待核对','neutral');badge.dataset.profilePublication='';badge.dataset.publicationState='unknown';output.append(badge);stateMessage(output, view.publicProfile.state);}
  else {
    const profiles = node('ul', undefined, 'person-list');
    for (const item of view.publicProfile.profiles) {
      const row = node('li'); row.append(node('strong', item.name || '姓名待完善'), node('p', [item.company, item.title].filter(Boolean).join(' · ')));
      const status=profilePublicationPresentation(item),badge=statusBadge(status.label,status.tone),change=statusBadge(status.changeLabel,status.change==='unchanged'?'neutral':'warning');
      badge.dataset.profilePublication=item.id;badge.dataset.publicationState=item.published?'published':'unpublished';change.dataset.profilePublicationChange=item.id;
      row.append(badge,change,node('p',status.detail),node('p',[...status.reasons,...status.suggestions].join(' · ')));
      if (item.publicRoles.length) row.append(node('p', '公开职责：' + item.publicRoles.map(role => ({ speaker: '讲者', guest: '嘉宾', organizer: '研讨会组织者', moderator: '主持人' })[role] || role).join('、')));
      profiles.append(row);
    }
    output.append(profiles);
    if (view.publicProfile.publishedRevision !== null) output.append(node('p', '已发布内容版本 ' + view.publicProfile.publishedRevision + (view.publicProfile.publishedAt ? ' · ' + dateLabel(view.publicProfile.publishedAt) : ''), 'person-note'));
  }
}
function renderCommunications(view) {
  const output = $('[data-person-communications]');
  for (const [key, label] of [['invitations', '工作人员邀请'], ['confirmations', '参会确认邮件']]) if (view.availability[key] !== 'available') { output.append(node('h3', label)); stateMessage(output, view.availability[key]); }
  const timeline = node('ol', undefined, 'person-timeline');
  for (const entry of view.communications.timeline) {
    const row = node('li'), title = entry.source === 'confirmation' ? entry.kind === 'promotion' ? '候补转正确认邮件' : '参会确认邮件' : entry.source === 'legacy_invitation' ? '手工邀请函记录' : '报名邀请';
    if(entry.source==='confirmation'&&typeof entry.currentRecipient==='boolean')row.dataset.personCurrentRecipient=String(entry.currentRecipient);
    row.append(node('strong', (entry.currentRecipient===false?'原邮箱 · ':'') + title + ' · ' + (noticeLabels[entry.status] ?? '状态待核对')));
    const time = node('time', dateLabel(entry.at)); if (entry.at) time.dateTime = entry.at; row.append(time);
    if (entry.channel) row.append(node('p', '渠道：' + (channelLabels[entry.channel] ?? '待核对'))); timeline.append(row);
  }
  if (timeline.childNodes.length) output.append(timeline);
  else if (['invitations', 'confirmations'].some(key => view.availability[key] === 'available')) output.append(node('p', '目前没有可显示的邀请或通知记录。', 'person-muted'));
  if (view.communications.historyTruncated) output.append(node('p', '仅显示最近 200 条记录，完整历史仍保留。', 'person-note'));
}
function renderOrganizations(view) {
  const output = $('[data-person-organizations]');
  if (view.organizations.state !== 'available') { stateMessage(output, view.organizations.state); return; }
  const list = node('ul', undefined, 'person-list');
  for (const membership of view.organizations.memberships) {
    const item = node('li'); item.append(node('strong', membership.name || '历史组织关联待核对'));
    item.append(node('p', [membership.role === 'lead' ? '组织负责人' : '组织成员', membership.title].filter(Boolean).join(' · ')));
    if (membership.missing) item.append(node('p', '保存的组织编号已无法对应目前资料。请核对原关联，未按名称重新匹配。', 'person-state'));
    else {
      item.append(node('p', ({ pending: '组织待确认', confirmed: '组织已确认', withdrawn: '组织已撤回' })[membership.organizationStatus] + ' · '
        + ({ undecided: '参与形式待定', exhibitor: '组织参展', attendee: '组织参加交流' })[membership.participation]));
      if (user.roles.includes('outreach')) { const link = node('a', '查看此组织人员'); link.href = '/admin/contacts/#organization=' + encodeURIComponent(membership.organizationId); link.dataset.personOrganization = membership.organizationId; item.append(link); }
    }
    list.append(item);
  }
  output.append(list);
}
function renderVolunteers(view) {
  const output = $('[data-person-volunteers]');
  if (view.availability.volunteers !== 'available') { stateMessage(output, view.availability.volunteers); return; }
  const list = node('ul', undefined, 'person-list');
  for (const entry of view.volunteers.entries) {
    const item = node('li');
    item.append(node('strong', '志愿协作 · ' + ({ pending: '待核对', invited: '已记录邀约，待本人回复', confirmed: '本人已答应志愿协作', declined: '本人已婉拒', inactive: '已停止安排' })[entry.workflowStatus]));
    item.append(node('p', '可服务时间：' + (entry.availability.length ? entry.availability.map(window => window.start + '–' + window.end).join('、') : '尚未填写')));
    if (!entry.assignments.length) item.append(node('p', '尚未保存班次安排。', 'person-muted'));
    for (const assignment of entry.assignments) {
      const status = ({ proposed: '排班提案', confirmed: '已记录逐班确认', cancelled: '安排已取消' })[assignment.status];
      const label = [assignment.positionName || '岗位待命名', assignment.start + '–' + assignment.end,
        assignment.zone === 'other' ? '' : assignment.zone + ' 区', assignment.location].filter(Boolean).join(' · ');
      item.append(node('h3', label), node('p', status + (assignment.shiftStatus === 'cancelled' ? ' · 班次已取消' : '')));
      if (assignment.issues.length || assignment.status === 'confirmed' && !assignment.eligible) item.append(node('p', '此安排仍需核对，不计入已确认覆盖；请到志愿者工作区查看原因。', 'person-state'));
    }
    list.append(item);
  }
  output.append(list);
}
function currentKey() { const item = parsePersonSelection(location.hash); return item ? item.kind + ':' + item.id : ''; }
function viewKey(view = selectedView) { return view ? view.selected.kind + ':' + view.selected.id : ''; }
function credentialRegistration() {
  return selectedView?.permissions.registration && selectedView.availability.registration === 'available'
    && selectedView.admission?.status === 'confirmed' ? selectedView.registration?.id ?? null : null;
}
function legacyDeliveryUnknown() {
  return Boolean(selectedView?.communications.unresolvedInvitations
    || selectedView?.communications.historyTruncated && (!Object.hasOwn(selectedView.communications, 'unresolvedInvitations') || !Object.hasOwn(selectedView.communications, 'unresolvedConfirmations'))
    || selectedView?.communications.invitations.some(item => ['unknown','reserved','issuing'].includes(item.status))
    || selectedView?.communications.timeline.some(item => item.source !== 'confirmation' && ['unknown','reserved','issuing'].includes(item.status)));
}
function deliveryUnknown() {
  return legacyDeliveryUnknown() || Boolean(selectedView?.communications.unresolvedConfirmations
    || selectedView?.communications.timeline.some(item => ['unknown','reserved','issuing'].includes(item.status)));
}
function openNotificationHistory() {
  $('[data-person-more]').open = true; $('[data-person-communications]').closest('details').open = true;
  $('[data-person-primary-reason]').textContent = '原通知结果待核对，请勿重寄。';
  $('[data-person-communications]').closest('details').scrollIntoView({block:'nearest',behavior:'instant'});
}
function operationCopy(input) { return Object.fromEntries(operationNames.map(name => [name, structuredClone(input[name])])); }
function profileCopy(input) {return Object.fromEntries(registrationProfileNames.map(name=>[name,input?.[name]??'']));}
function validProfileFields(fields,complete=false){
  if(!fields||typeof fields!=='object'||Array.isArray(fields)||Object.keys(fields).length!==registrationProfileNames.length
    ||Object.keys(fields).some(key=>!registrationProfileNames.includes(key)))return false;
  for(const [name,maximum]of Object.entries(registrationProfileLimits)){
    const value=fields[name];if(typeof value!=='string'||[...value].length>maximum||/[\u0000-\u001f\u007f]/u.test(value)
      ||[...value].some(character=>{const point=character.codePointAt(0);return point>=0xd800&&point<=0xdfff;}))return false;
    if(complete&&value!==value.normalize('NFC').trim())return false;
  }
  return !complete||Boolean(fields.name)&&(!fields.email||/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(fields.email));
}
function profileEditable(){
  const view=selectedView,item=view?.registration;
  return Boolean(user?.roles.some(role=>['reviewer','superadmin'].includes(role))&&view?.permissions.registration
    &&view.availability.registration==='available'&&item&&(item.profileTargetId??item.id)===item.id
    &&Number.isSafeInteger(view.revisions.registration)&&view.revisions.registration>=0);
}
function profilePath(id){return '/api/admin/registrations/'+encodeURIComponent(id)+'/profile';}
function profileReceipt(value,pending){
  const required=['outcome','operationId','registrationId','revision','fields','accessRevision'];
  // Operation facts are immutable; a concurrent merge may add only this explicit warning.
  if(!value||typeof value!=='object'||Array.isArray(value)||required.some(key=>!Object.hasOwn(value,key))
    ||Object.keys(value).some(key=>![...required,'identityCheck'].includes(key))
    ||!['updated','replayed'].includes(value.outcome)||value.operationId!==pending.input.operationId
    ||value.registrationId!==pending.registrationId||value.revision!==pending.input.expectedRevision+1
    ||!Number.isSafeInteger(value.accessRevision)||value.accessRevision<0||!validProfileFields(value.fields,true)
    ||registrationProfileNames.some(name=>value.fields[name]!==pending.input.fields[name]))throw Error('原保存回执暂时无法核对。');
  if(Object.hasOwn(value,'identityCheck')){
    const identity=value.identityCheck;
    if(!identity||typeof identity!=='object'||Array.isArray(identity)||Object.keys(identity).sort().join(',')!=='profileTargetId,state'
      ||identity.state!=='changed'||!registrationIdPattern.test(identity.profileTargetId??'')||identity.profileTargetId===pending.registrationId)throw Error('主报名变化暂时无法核对。');
  }
  if(pending.accessRevision!==null&&value.accessRevision!==pending.accessRevision+Number(pending.emailChanged))throw Error('私人凭证修订暂时无法核对。');
  return value;
}
function openProfile(){
  if(!profileEditable()||profileBusy||quickBusy||quickDirty||quickPending||transportBusy||personConfirmation.pending||credentialBusy)return;
  profileEditing=true;profileForm.hidden=false;$('[data-person-profile-edit]').hidden=true;
  $('[data-person-more]').open=true;$('[data-person-profile-panel]').open=true;
  clearCredential();personConfirmation.clear();$('[data-person-service-panel]').hidden=true;
  renderNext();lock();
}
function markProfileDirty(){
  if(!profileEditable()||profilePending||profileBusy)return;
  profileEditing=true;profileDirty=registrationProfileNames.some(name=>profileForm.elements.namedItem(name).value.normalize('NFC').trim()!==(profileBase?.[name]??''));personFresh=!profileDirty&&!relatedRefresh&&!syncIssue;navigationEnd=false;
  clearCredential();personConfirmation.clear();$('[data-person-service-panel]').hidden=true;
  $('[data-person-profile-email-note]').hidden=profileForm.elements.namedItem('email').value.normalize('NFC').trim()===(profileBase?.email??'');
  profileSaveState.set(profileDirty?'dirty':'idle');renderNext();lock();
}
function setupProfile(view,{preserve=false}={}){
  const item=view.registration,target=item?.profileTargetId??item?.id,primary=$('[data-person-profile-primary]');
  primary.hidden=!item||target===item.id||!view.permissions.registration;
  if(!primary.hidden)primary.href='/admin/person/#registration='+encodeURIComponent(target);else primary.removeAttribute('href');
  $('[data-person-profile-edit]').hidden=!profileEditable()||profileEditing;
  if(!profileEditable()){if(profileDraft)clearProfile();primary.hidden=!item||target===item.id||!view.permissions.registration;if(!primary.hidden)primary.href='/admin/person/#registration='+encodeURIComponent(target);return;}
  if(preserve&&profileDraft){
    if(!profileDirty&&!profilePending){profileRevision=view.revisions.registration;profileBase=profileCopy(item.fields);profileAccessRevision=item.profileCorrection?.accessRevision??0;applyDraftFields(profileForm,profileBase,registrationProfileNames);}
    return;
  }
  profileRevision=view.revisions.registration;profileBase=profileCopy(item.fields);profileAccessRevision=item.profileCorrection?.accessRevision??0;
  applyDraftFields(profileForm,profileBase,registrationProfileNames);
  const id=item.id,actor=user.id,epoch=generation,current=()=>user?.id===actor&&epoch===generation&&selectedView?.registration?.id===id&&currentKey()===viewKey(view);
  profileDraft=createOperationsFormDraft({actorId:actor,roles:user.roles,page:'person',entity:'registration-profile:'+id,form:profileForm,
    baseRevision:()=>profileRevision,isCurrent:current,capture:()=>captureDraftFields(profileForm,registrationProfileNames),
    validate:fields=>validProfileFields(fields),apply:fields=>{applyDraftFields(profileForm,fields,registrationProfileNames);openProfile();markProfileDirty();},manualPending:true,
    onEdit:markProfileDirty,onPending:original=>{
      const input=JSON.parse(original.body);
      if(original.path!==profilePath(id)||original.method!=='PATCH'||Object.keys(input).sort().join(',')!=='expectedRevision,fields,operationId'
        ||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||!profileOperationPattern.test(input.operationId??'')||!validProfileFields(input.fields,true))throw Error('原保存内容无法核对。');
      profilePending={path:original.path,method:original.method,body:original.body,input,registrationId:id,accessRevision:null,emailChanged:false};
      profileDirty=true;profileRetryReady=false;if(original.fields)applyDraftFields(profileForm,original.fields,registrationProfileNames);
      openProfile();profileSaveState.set('unknown');$('[data-person-profile-check]').hidden=false;renderNext();lock();
    },onChange:event=>{
      if(event.error?.code==='STALE_ACTOR'){clearPrivateState();return;}
      if(event.status==='discarded'){profilePending=null;profileRetryReady=false;$('[data-person-profile-check]').hidden=true;$('[data-person-profile-retry]').hidden=true;}
      renderNext();lock();
    }});
  void profileDraft.load();
}
function restoreProfileFocus(){
  const saved=profileFocus;profileFocus=null;
  if(!saved||!saved.element.isConnected||saved.element.disabled||reading)return;
  const active=document.activeElement;
  if(active&&active!==document.body&&active!==saved.element&&!['person-profile-save','person-profile-check','person-profile-retry'].some(key=>active.hasAttribute('data-'+key)))return;
  saved.element.focus({preventScroll:true});
  if(Number.isInteger(saved.start)&&Number.isInteger(saved.end))try{saved.element.setSelectionRange(saved.start,saved.end);}catch{/* Email inputs have no caret API. */}
  const epoch=generation,key=currentKey(),align=()=>{if(epoch!==generation||key!==currentKey()||document.activeElement!==saved.element)return;const bounds=saved.element.getBoundingClientRect();window.scrollBy({left:bounds.left-saved.left,top:bounds.top-saved.top,behavior:'instant'});};
  align();requestAnimationFrame(align);
}
async function acknowledgeProfile(receipt,pending,draft,epoch,key){
  if(epoch!==generation||currentKey()!==key||profilePending!==pending)return;
  profilePending=null;profileDirty=false;profileRetryReady=false;profileBase=structuredClone(receipt.fields);profileRevision=receipt.revision;profileAccessRevision=receipt.accessRevision;
  $('[data-person-profile-check]').hidden=true;$('[data-person-profile-retry]').hidden=true;$('[data-person-profile-email-note]').hidden=true;
  clearCredential();personConfirmation.clear();lastConfirmationCheck=null;renderConfirmationCheck();
  profileSaveState.set('saved',receipt.identityCheck?'已保存原报名，请核对主报名。':'');
  try{await draft.acknowledge();}catch{if(epoch===generation&&currentKey()===key)profileSaveState.set('saved','本机恢复记录待整理。');}
  if(epoch!==generation||currentKey()!==key)return;
  await loadPerson({preserve:true});
  if(epoch===generation&&currentKey()===key&&selectedView){
    profileSaveState.set('saved',receipt.identityCheck?'已保存原报名，请核对主报名。':'');
    if(receipt.identityCheck){$('[data-person-profile-outcome]').textContent='已保存原报名，请核对主报名。';$('[data-person-profile-outcome]').hidden=false;}
  }
}
async function saveProfile(replay=false){
  if(profileBusy||!profileEditable()||!profileDraft||!profileForm.reportValidity()||(!replay&&(!profileDirty||profilePending||profileDraft.blocked))||replay&&!profileRetryReady)return;
  const id=selectedView.registration.id,key=viewKey(),epoch=generation,draft=profileDraft,still=()=>epoch===generation&&currentKey()===key&&selectedView?.registration?.id===id;
  let pending=profilePending,requested=false,proven=false;
  if(!replay){const active=document.activeElement,bounds=active&&profileForm.contains(active)?active.getBoundingClientRect():null;profileFocus=bounds?{element:active,start:active.selectionStart,end:active.selectionEnd,left:bounds.left,top:bounds.top}:null;}
  profileBusy=true;profileRetryReady=false;profileSaveState.set('saving');lock();
  try{
    if(!replay){
      const fields=Object.fromEntries(registrationProfileNames.map(name=>[name,profileForm.elements.namedItem(name).value.normalize('NFC').trim()]));
      if(!validProfileFields(fields,true))throw Error('请核对姓名与联络资料。');
      const input={expectedRevision:profileRevision,operationId:crypto.randomUUID().replaceAll('-',''),fields};
      pending={path:profilePath(id),method:'PATCH',body:JSON.stringify(input),input,registrationId:id,accessRevision:profileAccessRevision,emailChanged:fields.email!==profileBase.email};
      await draft.markPending(pending);if(!still())return;profilePending=pending;
    }
    if(!pending||!still())return;
    profileController=new AbortController();requested=true;
    const receipt=profileReceipt(await request(pending.path,{method:pending.method,body:pending.body,controller:profileController,epoch,current:still}),pending);
    proven=true;await acknowledgeProfile(receipt,pending,draft,epoch,key);
  }catch(error){
    if(!still())return;if(proven){profileSaveState.set('saved','相关记录待重新核对。');return;}
    if(!requested){profilePending=null;profileSaveState.set('error',error.message||'原保存尚未准备好，尚未发送。');}
    else if(!replay&&[400,403,404,409,422].includes(error.status)){try{await draft.rejectPending();profilePending=null;profileSaveState.set(error.status===409?'conflict':'error',error.status===409?'版本已更新，请取消编辑并重新读取。':error.message);}catch{profileSaveState.set('unknown');await draft.markUnknown().catch(()=>{});}}
    else{profileSaveState.set(error.status===409?'conflict':'unknown');await draft.markUnknown().catch(()=>{});}
    profileDirty=true;$('[data-person-profile-check]').hidden=!profilePending;renderNext();
  }finally{if(still()){profileBusy=false;profileController=null;renderNext();lock();if(!profilePending)restoreProfileFocus();}}
}
async function checkProfile(){
  if(!profilePending||profileBusy||!selectedView)return;
  const pending=profilePending,key=viewKey(),epoch=generation,draft=profileDraft,still=()=>epoch===generation&&currentKey()===key&&profilePending===pending;
  profileBusy=true;profileRetryReady=false;profileSaveState.set('unknown','正在核对原保存…');lock();
  try{
    const value=await request('/api/admin/registrations/'+encodeURIComponent(pending.registrationId)+'/profile-operations/'+encodeURIComponent(pending.input.operationId),{epoch,current:still});
    if(!still())return;const receipt=profileReceipt(value,pending);await acknowledgeProfile(receipt,pending,draft,epoch,key);
  }catch(error){
    if(!still())return;
    profileRetryReady=error.status===404;
    profileSaveState.set('unknown',profileRetryReady?'尚未找到本次保存，可重试原保存。':'暂时无法核对，原保存仍保留。');
    $('[data-person-profile-retry]').hidden=!profileRetryReady;
  }finally{if(epoch===generation&&currentKey()===key){profileBusy=false;renderNext();lock();if(!profilePending)restoreProfileFocus();}}
}
async function cancelProfile(){
  if(profileBusy||profilePending||!profileDraft)return;
  const draft=profileDraft,epoch=generation,key=currentKey();
  profileBusy=true;lock();
  try{await draft.acknowledge();if(epoch!==generation||currentKey()!==key)return;applyDraftFields(profileForm,profileBase,registrationProfileNames);profileDirty=false;profileEditing=false;profileForm.hidden=true;$('[data-person-profile-email-note]').hidden=true;$('[data-person-profile-edit]').hidden=!profileEditable();profileSaveState.set('idle');personFresh=true;}
  catch{if(epoch===generation&&currentKey()===key)profileSaveState.set('error','本机填写暂时无法清除，请保留页面。');}
  finally{if(epoch===generation&&currentKey()===key){profileBusy=false;renderNext();lock();if(!profileEditing)$('[data-person-profile-edit]').focus({preventScroll:true});}}
}
function renderSummary(view) {
  const output = $('[data-person-summary]'); output.replaceChildren();
  const reply = view.contact?.operations.responseStatus;
  if (reply) { const status = attendancePresentation(reply); output.append(statusBadge(status.label, status.tone)); }
  else output.append(badge(view.availability.contact === 'restricted' ? '回复按权限核对' : '本人申请'));
  const admission = syncIssue ? '名额待核对' : view.admission ? ({confirmed:'名额已确认',waitlisted:'候补',pending_review:'申请待审',rejected:'申请未通过',withdrawn:'已撤回'})[view.admission.status]
    : view.availability.admission === 'restricted' ? '名额由审核人核对' : view.availability.admission === 'unavailable' ? '名额待核对' : '尚未整合名额';
  output.append(badge(admission, syncIssue ? undefined : view.admission?.status));
  const notice = view.communications.timeline.find(item => item.source === 'confirmation' && item.currentRecipient !== false);
  if (view.communications.unresolvedConfirmations) output.append(badge('寄送待核对'));
  else if (notice) output.append(badge(({provider_accepted:'邮件服务已接收',unknown:'寄送待核对',reserved:'寄送待核对',rejected:'确认信未发出'})[notice.status] ?? '通知待核对'));
  else if (view.availability.confirmations === 'unavailable') output.append(badge('通知待核对'));
  else if (view.admission?.status === 'confirmed' && view.availability.confirmations === 'available') output.append(badge('确认信未寄送'));
  if (view.publicProfile.profiles.some(item => item.published && !item.publishedMatchesDraft)) output.append(badge('前台待更新'));
  if (view.contact?.operations.owner) { const owner = ownerTagPresentation(view.contact.operations.owner), tag = node('span', owner.label, 'ah-owner-tag'); tag.dataset.ownerTone = owner.tone; output.append(tag); }
}
function renderNext() {
  if (!selectedView) return;
  let action;
  try { action = personNextAction(selectedView, user.roles, Boolean(quickPending)); } catch { action = {key:'check',label:'重新核对',reason:'记录暂时无法核对。',kind:'refresh'}; }
  if (quickDirty && !quickPending) action = {key:'reply', label:'继续填写', reason:'', kind:'refresh'};
  if (syncIssue && !quickDirty && !quickPending) action = {key:'check', label:'核对名额', reason:syncIssue, kind:'refresh'};
  else if (relatedRefresh && !quickDirty && !quickPending) action = {key:'check', label:'核对相关记录', reason:'回复已保存。', kind:'refresh'};
  if (quickDraft?.blocked && !quickPending) action = {key:'draft', label:'核对本机填写', reason:'', kind:'refresh'};
  if(profileLocked())action={key:'profile',label:profilePending?'核对保存':profileDraft?.blocked?'核对本机填写':'继续编辑',reason:'',kind:'refresh'};
  if (action.key === 'details' && credentialRegistration()) action = {...action, label:'查看凭证'};
  if (action.kind === 'handoff') action = {...action, label:'复制转交链接'};
  const button = $('[data-person-primary]'); button.textContent = action.label; button.dataset.action = action.key; button.dataset.kind = action.kind;
  if (action.href) button.dataset.href = action.href; else delete button.dataset.href;
  const editing = $('[data-person-quick-panel]').open && quickDirty && !quickPending;
  const editingProfile=profileEditing&&profileDirty&&!profilePending;
  button.classList.toggle('ah-admin-primary', $('[data-person-service-panel]').hidden && !editing && !editingProfile);
  $('[data-person-quick-save]').classList.toggle('ah-admin-primary', editing);
  $('[data-person-profile-save]').classList.toggle('ah-admin-primary',editingProfile);
  $('[data-person-primary-reason]').textContent = action.reason || '';
}
function setupQuick(view) {
  const permitted = view.availability.contact === 'available' && view.permissions.contact && user.roles.some(role => ['outreach','superadmin'].includes(role));
  $('[data-person-quick-panel]').hidden = !permitted;
  if (!permitted) return;
  const id = view.contact.id, actor = user.id, epoch = generation;
  quickRevision = view.revisions.contacts; quickBase = operationCopy(view.contact.operations);
  for (const name of quickNames) quickForm.elements.namedItem(name).value = quickBase[name];
  const current = () => user?.id === actor && generation === epoch && selectedView?.contact?.id === id;
  quickDraft = createOperationsFormDraft({actorId: actor, roles: user.roles, page: 'person', entity: 'contact:' + id, form: quickForm,
    baseRevision: () => quickRevision, isCurrent: current, capture: () => captureDraftFields(quickForm, quickNames),
    apply: fields => { applyDraftFields(quickForm, fields, quickNames); markQuickDirty(); }, manualPending: true,
    onEdit: markQuickDirty,
    onPending: original => {
      const input = JSON.parse(original.body);
      if (original.path !== '/api/admin/contacts/' + encodeURIComponent(id) || original.method !== 'PUT'
        || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || !validateContactOperations(input.operations).valid
        || Object.keys(input).some(key => !['expectedRevision','operations'].includes(key))) throw new Error('原保存内容无法核对。');
      quickPending = {path: original.path, method: original.method, body: original.body, input}; quickDirty = true; quickRetryReady = false;
      if (original.fields) applyDraftFields(quickForm, original.fields, quickNames);
      quickSaveState.set('unknown'); $('[data-person-quick-check]').hidden = false; $('[data-person-quick-panel]').open = true; renderNext(); lock();
    },
    onChange: event => { if (event.error?.code === 'STALE_ACTOR') { clearPrivateState(); return; } if (event.status === 'discarded') { quickPending = null; quickRetryReady = false; $('[data-person-quick-check]').hidden = true; $('[data-person-quick-retry]').hidden = true; } renderNext(); lock(); },
  });
  void quickDraft.load();
}
function markQuickDirty() {
  personFresh=false;navigationEnd=false;
  if (!selectedView?.contact || quickPending || quickBusy) return;
  quickDirty = true; clearCredential(); personConfirmation.clear(); $('[data-person-service-panel]').hidden = true; quickSaveState.set('dirty'); renderNext(); lock();
}
function showSyncOutcome(receipt) {
  const output = $('[data-person-quick-outcome]'), admission = receipt.admission;
  syncIssue = '';
  let message = '';
  if (admission?.status === 'requiresReviewer') syncIssue = '回复已保存，名额交由审核人核对。';
  else if (admission?.status === 'unavailable') syncIssue = '回复已保存，名额结果待核对。';
  else if (admission) {
    message = ({confirmed:'名额已确认。',waitlisted:'已登记候补。',pending_review:'申请仍待审核。'})[admission.status] ?? '';
    if (selectedView.registration?.id === admission.registrationId && selectedView.admission) {
      selectedView.admission = {...selectedView.admission, status: admission.status, revision: admission.revision};
      selectedView.revisions.admission = admission.revision;
    } else syncIssue = '回复已保存，请核对当前名额。';
    const mail = admission.confirmationEmail?.status;
    if (mail) message += ({completed:'通知已处理。',pending:'通知待核对。',not_configured:'通知尚未配置。',not_applicable:'通知条件待核对。'})[mail] ?? '';
  }
  output.textContent = syncIssue || message; output.hidden = !output.textContent;
}
async function acknowledgeQuick(receipt, draft, epoch, key) {
  if (epoch !== generation || currentKey() !== key || !selectedView?.contact) return;
  relatedRefresh = quickBase?.responseStatus !== receipt.contact.operations.responseStatus;
  quickRevision = receipt.revision; quickBase = operationCopy(receipt.contact.operations);
  selectedView.contact.operations = structuredClone(quickBase); selectedView.revisions.contacts = receipt.revision;
  quickPending = null; quickRetryReady = false; quickDirty = false;
  // The cloud receipt is authoritative even if local cleanup or another source fails.
  quickSaveState.set('saved'); $('[data-person-quick-check]').hidden = true; $('[data-person-quick-retry]').hidden = true;
  showSyncOutcome(receipt);personFresh=!relatedRefresh&&!syncIssue;navigationEnd=false; clearCredential(); personConfirmation.clear(); renderSummary(selectedView); renderNext();
  try { await draft.acknowledge(); } catch { if (epoch === generation && currentKey() === key) quickSaveState.set('saved', '本机恢复记录待整理。'); }
}
async function saveQuick(replay = false) {
  if (quickBusy || profileLocked() || !selectedView?.contact || !quickDraft || !quickForm.reportValidity() || (!replay && (!quickDirty || quickPending || quickDraft.blocked))) return null;
  const id = selectedView.contact.id, key = viewKey(), epoch = generation, draft = quickDraft;
  const still = () => epoch === generation && currentKey() === key && selectedView?.contact?.id === id;
  let pending = quickPending, requested = false, proven = null;
  if (!replay) {
    const active = document.activeElement;
    const bounds = active && quickForm.contains(active) ? active.getBoundingClientRect() : null;
    quickFocus = bounds ? {element: active, start: active.selectionStart, end: active.selectionEnd, top: bounds.top, left: bounds.left} : null;
  }
  quickBusy = true; quickRetryReady = false; quickSaveState.set('saving'); lock();
  try {
    if (!replay) {
      const fields = captureDraftFields(quickForm, quickNames), operations = {...structuredClone(quickBase)};
      for (const name of quickNames) operations[name] = fields[name].normalize('NFC').trim();
      const input = {expectedRevision: quickRevision, operations};
      if (!validateContactOperations(operations).valid) throw new Error('请核对回复与跟进资料。');
      pending = {path: '/api/admin/contacts/' + encodeURIComponent(id), method: 'PUT', body: JSON.stringify(input), input};
      await draft.markPending(pending);
      if (!still()) return null;
      quickPending = pending;
    }
    if (!pending || !still()) return null;
    mutationController = new AbortController(); requested = true;
    const value = await request(pending.path, {method: pending.method, body: pending.body, controller: mutationController, epoch, current: still});
    if (!still()) return null;
    proven = savedContactReceipt(value, {contactId: id, expectedRevision: pending.input.expectedRevision, operations: pending.input.operations});
    await acknowledgeQuick(proven, draft, epoch, key); return proven;
  } catch (error) {
    if (!still()) return null;
    if (proven) { quickSaveState.set('saved', '其他记录待重新核对。'); return proven; }
    if (!requested) { quickPending = null; quickSaveState.set('error', '本机原保存未准备好，尚未发送。'); }
    else if (!replay && [400,403,404,422].includes(error.status)) {
      try { await draft.rejectPending(); quickPending = null; quickSaveState.set('error', error.message); }
      catch { quickSaveState.set('unknown'); await draft.markUnknown().catch(() => {}); }
    } else { quickSaveState.set(error.status === 409 ? 'conflict' : 'unknown'); await draft.markUnknown().catch(() => {}); }
    quickDirty = true; $('[data-person-quick-check]').hidden = !quickPending;
    if (quickPending) $('[data-person-quick-outcome]').textContent = '先核对原保存结果。';
    else $('[data-person-quick-outcome]').textContent = error.message || '保存未完成。';
    $('[data-person-quick-outcome]').hidden = false; renderNext(); return null;
  } finally { if (still()) { quickBusy = false; mutationController = null; lock(); if (!quickPending) restoreQuickFocus(); } }
}
function restoreQuickFocus() {
  const focus = quickFocus;
  if (!focus || !quickForm.contains(focus.element) || focus.element.disabled || reading) return;
  const active = document.activeElement;
  if (active && active !== document.body && active !== focus.element && !['person-quick-save','person-quick-check','person-quick-retry'].some(key => active.hasAttribute('data-' + key))) return;
  focus.element.focus({preventScroll:true});
  if (Number.isInteger(focus.start) && Number.isInteger(focus.end)) { try { focus.element.setSelectionRange(focus.start, focus.end); } catch { /* Non-text controls have no caret. */ } }
  const epoch = generation, key = currentKey();
  const align = () => {
    if (epoch !== generation || currentKey() !== key || !focus.element.isConnected || document.activeElement !== focus.element) return;
    const bounds = focus.element.getBoundingClientRect();
    window.scrollBy({left:bounds.left - focus.left, top:bounds.top - focus.top, behavior:'instant'});
  };
  align(); requestAnimationFrame(align); quickFocus = null;
}
async function checkQuick() {
  if (!quickPending || quickBusy || !selectedView) return;
  const pending = quickPending, key = viewKey(), epoch = generation, draft = quickDraft;
  quickBusy = true; quickRetryReady = false; lock();
  try {
    const value = await request(personWorkspacePath(selectedView.selected), {epoch, current: () => epoch === generation && currentKey() === key});
    if (epoch !== generation || currentKey() !== key || quickPending !== pending) return;
    const view = personWorkspaceView(value, selectedView.selected);
    if (!view?.contact || view.contact.id !== selectedView.contact.id || !Number.isSafeInteger(view.revisions.contacts)) throw new Error('原保存结果暂时无法核对。');
    const matches = Object.entries(pending.input.operations).every(([name, expected]) => JSON.stringify(view.contact.operations[name]) === JSON.stringify(expected));
    if (view.revisions.contacts > pending.input.expectedRevision && matches) {
      quickRevision = view.revisions.contacts; quickBase = operationCopy(view.contact.operations); selectedView = view;
      quickPending = null; quickDirty = false; quickRetryReady = false; syncIssue = ''; relatedRefresh = false;personFresh=true;navigationEnd=false;
      quickSaveState.set('saved', '已核对云端记录。'); $('[data-person-quick-check]').hidden = true; $('[data-person-quick-retry]').hidden = true;
      renderSummary(view); renderNext();
      try { await draft.acknowledge(); } catch { quickSaveState.set('saved', '本机恢复记录待整理。'); }
    } else {
      quickRetryReady = view.revisions.contacts === pending.input.expectedRevision;
      quickSaveState.set(quickRetryReady ? 'unknown' : 'conflict', quickRetryReady ? '云端尚无本次修改，可明确重试原保存。' : '云端已有其他修改，请保留填写并核对。');
      $('[data-person-quick-retry]').hidden = !quickRetryReady;
    }
  } catch { if (epoch === generation && currentKey() === key) quickSaveState.set('unknown', '暂时无法核对，原保存仍保留。'); }
  finally { if (epoch === generation && currentKey() === key) { quickBusy = false; renderNext(); lock(); if (!quickPending) restoreQuickFocus(); } }
}
async function prepareCredential() {
  const id = credentialRegistration(), epoch = generation, key = viewKey();
  if (!id || credentialBusy || quickBusy || quickDirty || quickPending || profileLocked()) return;
  clearCredential(); credentialBusy = true; lock();
  try {
    const value = await request('/api/admin/registration-confirmation/link/' + encodeURIComponent(id), {epoch, current: () => epoch === generation && currentKey() === key});
    if (epoch !== generation || currentKey() !== key) return;
    const valid = reviewConfirmationLink(value, id); if (!valid) throw new Error('私人参会页暂时无法核对。');
    credential = valid; $('[data-person-credential-open]').href = valid.confirmationUrl;
    $('[data-person-credential-result]').hidden = false; $('[data-person-credential-status]').textContent = '请仅私下交付本人。';
  } catch (error) { if (epoch === generation && currentKey() === key) { clearCredential(); $('[data-person-credential-status]').textContent = error.message || '私人参会页暂时无法核对。'; } }
  finally { if (epoch === generation && currentKey() === key) { credentialBusy = false; lock(); } }
}
function openServices() {
  if(profileLocked())return;
  $('[data-person-service-panel]').hidden = false;
  const id = credentialRegistration(); $('[data-person-credential]').hidden = !id;
  personConfirmation.select(id,{suppress:deliveryUnknown()}); renderNext(); lock();
  if (deliveryUnknown()) $('[data-person-primary-reason]').textContent = '原通知结果待核对，暂不准备新邮件。';
}
async function integratePerson(id, expectedRevision) {
  if (quickDirty || quickPending || quickBusy || profileLocked() || selectedView?.contact?.id !== id || quickRevision !== expectedRevision) throw new Error('请先核对并保存当前人员资料。');
  if (selectedView.contact.operations.responseStatus !== 'attending') {
    quickForm.elements.namedItem('responseStatus').value = 'attending'; quickDirty = true;
    const receipt = await saveQuick();
    if (!receipt?.admission?.registrationId) throw new Error('回复已保存，请核对名额结果。');
    return '出席回复已保存，请核对名额与通知。';
  }
  const ids = [id], preview = conversionPreview(await request('/api/admin/contacts/convert/preview', {method:'POST',body:{contactIds:ids,expectedContactRevision:expectedRevision}}), ids, expectedRevision);
  if (preview.eligibleIds.length !== 1) throw new Error('当前来源已有报名或仍需核对。');
  const result = conversionReceipt(await request('/api/admin/contacts/convert', {method:'POST',body:{contactIds:ids,expectedContactRevision:expectedRevision}}), preview);
  if (result.status !== 'completed' || result.registrations.length !== 1 || result.failureCount) throw new Error('整合结果待核对，请保留当前来源。');
  return '已沿用原来源整合，请核对名额。';
}
async function loadSource() {
  const view = selectedView, epoch = generation, key = viewKey(), started = ++sourceSequence;
  const output = $('[data-person-source]'), status = $('[data-person-source-state]'); output.replaceChildren();
  if (!view || !$('[data-person-source-panel]').open) return;
  if (!view.contact) { status.textContent = view.availability.contact === 'restricted' ? '原问卷由跟进同事核对。' : '未关联旧问卷；报名原始资料见「报名与核查」。'; return; }
  status.textContent = '正在核对原问卷…';
  try {
    const value = personSourceView(await request('/api/admin/people/contacts/' + encodeURIComponent(view.contact.id) + '/source', {epoch,
      current: () => epoch === generation && currentKey() === key && started === sourceSequence}), view.contact.id);
    if (epoch !== generation || currentKey() !== key || started !== sourceSequence || !$('[data-person-source-panel]').open) return;
    if (!value) throw new Error();
    for (const field of value.fields) fact(output, field.label, field.value);
    status.textContent = value.snapshot === 'legacy' ? '旧记录尚无独立原件，请核对。' : '保留的原问卷资料。';
  } catch { if (epoch === generation && currentKey() === key && started === sourceSequence) { output.replaceChildren(); status.textContent = '原问卷暂时无法核对，请稍后重新打开。'; } }
}
function render(view, {preserveQuick = false} = {}) {
  if (!preserveQuick) clearRecord(); else for (const selector of profileFields) $(selector).replaceChildren();
  selectedView = view;
  relatedRefresh = false;
  $('[data-person-name]').textContent = view.person.displayName || view.person.name || '未填写姓名';
  $('[data-person-identity]').textContent = [view.person.organization, view.person.position, view.person.city].filter(Boolean).join(' · ');
  if(view.registration?.profileCorrection){$('[data-person-name]').textContent=view.registration.fields.name;$('[data-person-identity]').textContent=[view.registration.fields.organization,view.registration.fields.position,view.registration.fields.city].filter(Boolean).join(' · ');}
  $('[data-person-linkage]').textContent = ({ linked: '依据已保存的关联核对人员与报名，不按同名自动合并。', unlinked: '目前只有这一份记录，尚未关联另一份人员／报名资料。', restricted: '其他关联资料按账号权限显示，未读取受限记录。', unavailable: '关联来源暂时无法完整核对，下方分别显示可用范围。' })[view.linkage.state];
  for (const action of personWorkspaceActions(view, user.roles)) { const link = node('a', action.label, 'ah-admin-button'); link.href = action.href; link.dataset.personAction = action.key; $('[data-person-actions]').append(link); }
  for (const step of personWorkspaceSteps(view, user.roles)) {
    const row = node('li'); row.dataset.personStep = step.key; row.dataset.stepState = step.state;
    const heading = node('div', undefined, 'person-step-heading'); heading.append(node('strong', step.label), node('span', ({ complete: '已完成', pending: '待处理', review: '待核对', restricted: '无权限' })[step.state], 'person-badge'));
    row.append(heading, node('p', step.detail));
    if (step.action) { const link = node('a', step.action.label); link.href = step.action.href; link.dataset.personStepAction = step.key; row.append(link); }
    $('[data-person-steps]').append(row);
  }
  personFresh=true;navigationEnd=false;
  personConfirmation.select(view.registration?.id??null,{activate:false,suppress:deliveryUnknown()});
  renderConfirmationCheck();
  renderProfile(view); renderAdmission(view); renderRegistration(view); renderArrangements(view); renderOrganizations(view); renderVolunteers(view); renderCommunications(view);
  const revisions = Object.entries(view.revisions).filter(([, revision]) => revision !== null).map(([key, revision]) => ({ contacts: '人员', content: '活动', invitations: '邀请', registration: '核查', admission: '名额', confirmations: '确认通知', volunteers: '志愿分工' })[key] + '版本 ' + revision);
  $('[data-person-meta]').textContent = '本页仅呈现已保存记录，各来源独立更新。' + (revisions.length ? ' ' + revisions.join(' · ') : '');
  $('[data-person-empty]').hidden = true; $('[data-person-record]').hidden = false;
  renderSummary(view);
  if (!preserveQuick) setupQuick(view);
  else if (!quickDirty && !quickPending && !quickBusy && view.contact) { quickRevision = view.revisions.contacts; quickBase = operationCopy(view.contact.operations); }
  setupProfile(view,{preserve:preserveQuick});
  renderNext(); lock();
}
async function loadPerson({ focus = false, preserve = false } = {}) {
  const started = ++sequence, epoch = generation, selection = parsePersonSelection(location.hash);
  personController?.abort(); const controller = new AbortController(); personController = controller;
  const preserveQuick = preserve && selectedView && viewKey() === currentKey() && !quickDirty && !quickPending;
  if (!preserveQuick) clearRecord(); announce();
  if (!user) { lock(); return; }
  if (!allowed()) { clearRecord('此账号需要人员邀约或报名审核权限，才能读取个人工作页。'); announce('此账号没有读取个人工作页的权限。', true); reading = false; lock(); return; }
  if (!selection) { clearRecord(location.hash ? '人员链接无效，请从人员或报名列表重新打开。' : undefined); reading = false; lock(); return; }
  reading = true; lock(); announce('正在核对这位人员的已保存记录…');
  try {
    const value = await request(personWorkspacePath(selection), { controller, epoch });
    if (started !== sequence || epoch !== generation || controller.signal.aborted) return;
    const view = personWorkspaceView(value, selection); if (!view) throw new Error('人员记录结果未通过核对，请重新读取。');
    render(view, {preserveQuick}); announce('已读取。');
    if (focus) $('[data-person-name]').focus({ preventScroll: true });
  } catch (error) {
    if (started !== sequence || epoch !== generation || (controller.signal.aborted && !error.timedOut)) return;
    clearRecord(error.message || '记录暂时无法读取，请重新打开。'); announce(error.message || '人员资料暂时无法读取。', true);
  } finally { if (started === sequence && epoch === generation) { reading = false; personController = null; lock(); } }
}
$('[data-person-next]').addEventListener('click',()=>void nextPerson());
for(const control of document.querySelectorAll('[data-person-list-return]'))control.addEventListener('click',event=>{
  if(selectedView&&(!mayNavigate()||navigationBusy)){event.preventDefault();announce('请先保存或核对当前记录。',true);return;}
  const context=user?peopleNavigation.read(user,{selection:currentKey()}):null;
  if(context){event.preventDefault();location.assign(peopleReturnHref(context.view));}
});
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
  if (authBusy || !user) return;
  if ((quickDirty || quickPending || quickBusy || profileDirty || profilePending || profileBusy || personConfirmation.pending) && !confirm('退出并清除本机填写？原保存结果仍需核对。')) return;
  const actorId = user.id;peopleNavigation.clear();personConfirmation.clear(); quickDraft?.close(); quickDraft = null;
  let localCleared = false; try { await operationsDraftStore().clearActor(actorId); localCleared = true; } catch { /* The private page is still cleared below. */ }
  personController?.abort(); sequence++; reading = false; clearRecord();
  const operation = ++authSequence;
  authBusy = true; const epoch = generation, controller = new AbortController(); authController = controller; lock();
  try { await request('/api/admin/logout', { method: 'POST', controller, epoch }); if (epoch !== generation) return; clearPrivateState(); announce(localCleared ? '已退出，页面资料与本机填写已清空。' : '已退出，页面资料已清空；本机恢复记录待核对。'); }
  catch (error) { if (epoch === generation && operation === authSequence) { clearRecord(); announce(error.message || '退出结果尚未核对，请重试。', true); } }
  finally { if (authController === controller) authController = null; if (operation === authSequence) authBusy = false; lock(); }
});
$('[data-person-refresh]').addEventListener('click', () => { if (authBusy || reading || quickBusy || profileBusy) return; if(profilePending)void checkProfile();else if (quickPending) void checkQuick(); else if (quickDirty||profileLocked()) announce('请先保存或核对当前填写。'); else void loadPerson(); });
profileForm.addEventListener('submit',event=>{event.preventDefault();void saveProfile();});
$('[data-person-profile-edit]').addEventListener('click',()=>{openProfile();if(profileEditing)profileForm.elements.namedItem('name').focus({preventScroll:true});});
$('[data-person-profile-cancel]').addEventListener('click',()=>void cancelProfile());
$('[data-person-profile-check]').addEventListener('click',()=>void checkProfile());
$('[data-person-profile-retry]').addEventListener('click',()=>{if(profileRetryReady)void saveProfile(true);});
$('[data-person-profile-primary]').addEventListener('click',event=>{if(profileLocked()||quickDirty||quickPending||quickBusy){event.preventDefault();announce('请先保存或核对当前记录。',true);}});
quickForm.addEventListener('submit', event => { event.preventDefault(); void saveQuick(); });
$('[data-person-quick-panel]').addEventListener('toggle', renderNext);
$('[data-person-quick-check]').addEventListener('click', () => void checkQuick());
$('[data-person-quick-retry]').addEventListener('click', () => { if (quickRetryReady) void saveQuick(true); });
$('[data-person-credential-prepare]').addEventListener('click', () => void prepareCredential());
$('[data-person-service-open]').addEventListener('click', () => { if (!reading && !quickBusy && !quickDirty && !quickPending && !profileLocked()) openServices(); });
$('[data-person-credential-copy]').addEventListener('click', async () => {
  if (!credential || quickBusy || credentialBusy) return;
  const link = credential.confirmationUrl, key = viewKey(), epoch = generation;
  try { await navigator.clipboard.writeText(link); if (epoch === generation && currentKey() === key && credential?.confirmationUrl === link) $('[data-person-credential-status]').textContent = '已复制，请仅私下交付本人。'; }
  catch { if (epoch !== generation || currentKey() !== key || credential?.confirmationUrl !== link) return; const field = $('[data-person-credential-fallback]'); field.value = link; field.hidden = false; field.focus(); field.select(); $('[data-person-credential-status]').textContent = '请复制所选链接。'; }
});
$('[data-person-source-panel]').addEventListener('toggle', () => {
  if ($('[data-person-source-panel]').open) void loadSource();
  else { sourceSequence++; $('[data-person-source]').replaceChildren(); $('[data-person-source-state]').textContent = ''; }
});
$('[data-person-primary]').addEventListener('click', async () => {
  if (!selectedView || authBusy || reading || quickBusy || profileBusy) return;
  const button = $('[data-person-primary]'), action = button.dataset.action;
  if(profilePending)return void checkProfile();
  if(action==='profile'){openProfile();return;}
  if (quickPending) return void checkQuick();
  if (action === 'reply' || action === 'draft') { const panel = $('[data-person-quick-panel]'); if (!panel.hidden) { panel.open = true; quickForm.elements.namedItem('responseStatus').focus({preventScroll:true}); panel.scrollIntoView({block:'nearest',behavior:'instant'}); } return; }
  if (action === 'source') { $('[data-person-more]').open = true; $('[data-person-source-panel]').open = true; $('[data-person-source-panel]').scrollIntoView({block:'nearest',behavior:'instant'}); return; }
  if (action === 'notification') { openServices(); $('[data-person-service-panel]').scrollIntoView({block:'nearest',behavior:'instant'}); return; }
  if (action === 'integration' || action === 'duplicate') { if (quickDirty) return; const key = selectedView.contact ? 'contact:' + selectedView.contact.id : selectedView.registration ? 'registration:' + selectedView.registration.id : null; if (key) await resolution.open(key); return; }
  if (action === 'check') {
    if (!syncIssue && deliveryUnknown()) { openNotificationHistory(); return; }
    await loadPerson(); return;
  }
  if (button.dataset.kind === 'handoff') {
    try { await navigator.clipboard.writeText(location.origin + location.pathname + location.hash); $('[data-person-primary-reason]').textContent = '转交链接已复制，请发给有权限同事核对。'; }
    catch { $('[data-person-primary-reason]').textContent = '复制未完成，请复制当前页面链接，发给有权限同事核对。'; }
    return;
  }
  if (action === 'details' && credentialRegistration()) { openServices(); await prepareCredential(); return; }
  if (action === 'details' || action === 'arrangement') { $('[data-person-more]').open = true; if (action === 'arrangement') $('[data-person-arrangements]').closest('details').open = true; return; }
  const href = button.dataset.href;
  if (href) { const url = new URL(href, location.origin); if (url.origin === location.origin && url.pathname.startsWith('/admin/') && url.href !== location.href) location.assign(url.href); }
});
window.addEventListener('hashchange', async () => {
  if (quickDraft && quickDirty && !quickPending && !quickBusy) await quickDraft.flush().catch(() => {});
  if(profileDraft&&profileDirty&&!profilePending&&!profileBusy)await profileDraft.flush().catch(()=>{});
  if (user && !authBusy) void loadPerson({focus:true}); else { sequence++; personController?.abort(); clearRecord(); }
});
window.addEventListener('beforeunload',event=>{if(profileDirty||profileBusy||profilePending){event.preventDefault();event.returnValue='';}});
clearPrivateState({preserveNavigation:true});
if (location.protocol === 'file:') announce('请通过工作人员后台打开此页；离线预览不含私有人员记录。');
else {
  const operation = ++authSequence;
  authBusy = true; lock(); const epoch = generation, controller = new AbortController(); authController = controller;
  request('/api/admin/session', { controller, epoch }).then(async value => { if (epoch !== generation || operation !== authSequence) return; showSession(value); if (authController === controller) authController = null; authBusy = false; lock(); await loadPerson(); })
    .catch(error => { if (error.status !== 401 && epoch === generation) announce(error.message || '工作人员会话暂时无法核对。', true); })
    .finally(() => { if (authController === controller) authController = null; if (operation === authSequence) authBusy = false; lock(); });
}
