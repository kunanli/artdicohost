import { parseContactImport, WORKBOOK_SOURCE_KEY, sourceLabels } from '../../shared/contact-import.mjs';
import { renderInvitation, invitationPngBlob, invitationFilename } from '../lib/invitation-renderer.mjs';
import { EDITABLE_CONTACT_FIELDS } from '../../shared/contact-editor.mjs';
import { eventConfig } from '../config/event.mjs';
import { contactProgress, summarizeContactProgress, invitationProgressLabels, contactDeclined } from '../../shared/organizer-progress.mjs';

const $ = value => document.querySelector(value);
const responses = { pending: '尚未确认', attending: '已确认出席', declined: '不出席' };
const categoryLabels = new Map(sourceLabels.categories.map(item => [item.value, item.label]));
const interestLabels = new Map(sourceLabels.interests.map(item => [item.value, item.label]));
const participationLabels = new Map([...document.querySelectorAll('[data-contact-participation] input')].map(input => [input.value, input.dataset.participationLabel]));
let user = null, csrfToken = '', revision = 0, contacts = [], content = null;
let busy = false, importPreview = null, currentContactId = null, invitationContactId = null, renderedSettings = null;
let operationsDirty = false, communications = null;
let profileContactId = null, profileDirty = false;
let features = { contactImport: false, communicationsPreview: false };
let intentState = null;
let importSource = null;
const selectedContacts = new Set();
let visibleContactIds = [];
let pendingContactId=null,sessionGeneration=0;
let batchDownloadUrl = null;
if(location.hash.startsWith('#contact=')){try{const id=decodeURIComponent(location.hash.slice(9));if(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(id))pendingContactId=id;}catch{}history.replaceState(null,'',location.pathname+location.search);}
const consentLabels = { unknown: '尚未核实', consented: '已明确同意联络', declined: '不同意联络' };

function matchesSavedInvitation() {
  const invitation = contactById(invitationContactId)?.invitation;
  if (!invitation?.generatedAt || !invitation.settings) return false;
  const current = settingsFromForm();
  return ['recipientName','date','time','venue','confirmed'].every(key => current[key] === invitation.settings[key]);
}
function clearCommunicationPreviews() {
  $('[data-wallet-preview]').hidden = true;
  $('[data-email-preview]').hidden = true;
  for (const selector of ['[data-wallet-title]','[data-wallet-name]','[data-wallet-date]','[data-wallet-time]','[data-wallet-location]','[data-wallet-notice]','[data-email-to]','[data-email-subject]','[data-email-text]']) $(selector).textContent = '';
}
function renderCommunicationStatus() {
  const item = contactById(invitationContactId);
  $('[data-wallet-status]').textContent = communications?.wallet.reason || 'Apple Wallet 账号与签名凭证尚未配置，目前可查看未签名卡片预览。';
  $('[data-email-status]').textContent = communications?.email.reason || 'EmailJS 服务与邮件模板尚未配置，目前仅提供确认信预览。';
  $('[data-email-eligibility]').textContent = item?.operations.responseStatus === 'attending' ? '对象已确认出席，可核对确认信内容。预览不会发送邮件。' : '请先核实对方回复，并在「详情与安排」中保存「已确认出席」，才可预览确认信。历史报名意向不会自动作为出席确认。';
}

function node(tag, value, className) {
  const element = document.createElement(tag);
  if (value !== undefined) element.textContent = value;
  if (className) element.className = className;
  return element;
}
function announce(message, error = false) {
  $('[data-contacts-status]').textContent = error ? '' : message;
  $('[data-contacts-error]').textContent = error ? message : '';
  $('[data-contacts-error]').hidden = !error;
}
function contactById(id) { return contacts.find(item => item.id === id); }
function permitted() { return user?.roles.includes('outreach'); }
function mayInvite(item) { if(item?.profile.contactConsent!=='consented'||contactDeclined(item))return false;const progress=contactProgress(item,progressOptions());return !progress.conversion||progress.admissionStatus==='confirmed'; }
function invitationBlockReason(item) { if(contactDeclined(item))return '已拒绝联络或出席，不准备或发出邀请。';if(item?.profile.contactConsent!=='consented')return '联络授权尚未核实，暂不能准备邀请。';const progress=contactProgress(item,progressOptions());return progress.admissionStatus==='waitlisted'?'已登记候补，名额尚未确认，暂不准备正式邀请。':progress.inactive?'关联报名已停用，请先核对。':'名额状态尚未核对，确认前不准备正式邀请。'; }
function progressOptions() { return { intent: intentState, content, event: eventConfig }; }
function maySelect(item) { return Boolean(item) && permitted() && !contactDeclined(item) && (mayConvert(item) || mayInvite(item)); }
function clearBatchResult() { if(batchDownloadUrl)URL.revokeObjectURL(batchDownloadUrl);batchDownloadUrl=null;$('[data-batch-download]').hidden=true;$('[data-batch-download]').removeAttribute('href');$('[data-batch-results]').replaceChildren();$('[data-batch-summary]').textContent='';$('[data-batch-panel]').hidden=true; }
function mayConvert(item) { return Boolean(item)&&permitted()&&user.roles.some(role=>['reviewer','superadmin'].includes(role))&&item.profile.contactConsent!=='declined'&&item.operations.responseStatus!=='declined'; }
function requireInviteConsent() { if (!mayInvite(contactById(invitationContactId))) throw new Error(invitationBlockReason(contactById(invitationContactId))); }
function lock() {
  $('[data-contacts-login-submit]').disabled = busy || location.protocol === 'file:';
  for (const field of document.querySelectorAll('[data-contacts-workspace] button,[data-contacts-file]')) field.disabled = busy || !permitted() || field.hasAttribute('data-consent-blocked') || field.hasAttribute('data-role-blocked');
  $('[data-contacts-file]').disabled = busy || !permitted() || !features.contactImport;
  $('[data-profile-fields]').disabled = busy || !permitted();
  $('[data-profile-save]').disabled = busy || !permitted() || (!$('[data-profile-duplicates]').hidden && !$('[data-profile-duplicates-confirm]').checked);
  for (const button of document.querySelectorAll('[data-profile-close]')) button.disabled = busy;
  $('[data-contact-save]').disabled = busy || !permitted();
  $('[data-contact-fields]').disabled = busy || !permitted();
  for (const field of document.querySelectorAll('[data-invitation-form] input,[data-invitation-form] select')) field.disabled = busy || !permitted();
  $('[data-import-confirm]').disabled = busy || !permitted() || !features.contactImport || !importPreview?.canCommit || !$('[data-import-source-confirm]').checked || !!importPreview?.summary.possibleDuplicates && !$('[data-import-duplicates]').checked;
  $('[data-invitation-download]').disabled = busy || !renderedSettings || !mayInvite(contactById(invitationContactId));
  $('[data-invitation-record-sent]').disabled = busy || !$('[data-invitation-sent-confirm]').checked || !matchesSavedInvitation() || !mayInvite(contactById(invitationContactId));
  $('[data-wallet-preview-button]').disabled = busy || !permitted() || !features.communicationsPreview || !mayInvite(contactById(invitationContactId));
  $('[data-email-preview-button]').disabled = busy || !permitted() || !features.communicationsPreview || !mayInvite(contactById(invitationContactId)) || contactById(invitationContactId)?.operations.responseStatus !== 'attending';
  $('[data-wallet-add]').disabled = true;
  $('[data-email-send]').disabled = true;
  renderCommunicationStatus();
  $('[data-contacts-logout]').disabled = busy;
  $('[data-contacts-convert]').disabled = busy || !permitted() || !user?.roles.some(role=>['reviewer','superadmin'].includes(role)) || !features.intentInvitations || !intentState || selectedContacts.size === 0;
  $('[data-contacts-select-visible]').disabled = busy || !permitted() || !features.intentInvitations || !intentState;
  $('[data-contacts-batch-invite]').disabled = busy || !permitted() || !features.batchInvitations || !intentState || !selectedContacts.size;
  for (const input of document.querySelectorAll('[data-contact-selection]')) input.disabled = busy || !features.intentInvitations || !maySelect(contactById(input.dataset.contactSelection));
  $('[data-contacts-selected]').textContent = '已选 '+selectedContacts.size+' 位';
}
async function request(path, options = {}) {
  const generation=sessionGeneration;
  const headers = { Accept: 'application/json' };
  if (options.body) headers['Content-Type'] = 'application/json';
  if (options.method && options.method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const response = await fetch(path, { ...options, headers, credentials: 'same-origin', cache: 'no-store' });
  if(generation!==sessionGeneration)throw new Error('会话已改变，请重新登录。');
  const result = await response.json().catch(() => ({}));
  if(generation!==sessionGeneration)throw new Error('会话已改变，请重新登录。');
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/admin/login') clearPrivateState();
    const details = result.error?.fields ? [...new Set(Object.values(result.error.fields))].join(' ') : '';
    throw new Error(response.status === 409 ? (result.error?.code === 'INVITATION_GENERATION_MISMATCH' ? '邀请函生成记录已变化，请重新生成并下载当前版本，再核对实际发出的版本。' : '名单版本已更新或预览已过期。当前编辑仍保留，请先核对并刷新名单后重试。') : (result.error?.message || '操作未完成，请确认本地服务已启动。') + (details ? ' ' + details : ''));
  }
  return result;
}
async function action(callback) {
  if (busy) return;
  busy = true; lock();
  try { await callback(); } catch (error) { announce(error.message || '操作未完成。', true); }
  finally { busy = false; lock();if(pendingContactId&&user&&contacts.length){const id=pendingContactId;pendingContactId=null;const contact=contactById(id);if(contact)openContact(contact);else announce('关联人员已不在当前名单中，请核对最新资料。',true);} }
}
function clearImport() {
  importSource = null;
  importPreview = null;
  $('[data-import-preview]').hidden = true;
  $('[data-import-rows]').replaceChildren();
  $('[data-import-summary]').textContent = '';
  $('[data-import-duplicates]').checked = false;
  $('[data-import-source-confirm]').checked = false;
  $('[data-contacts-file]').value = '';
  $('[data-contacts-file-name]').textContent = '支持原始 Excel 问卷或旧后台 contacts.json 快照';
}
function clearPrivateState() {
  sessionGeneration+=1;
  clearBatchResult();
  selectedContacts.clear();intentState=null;visibleContactIds=[];
  user = null; csrfToken = ''; revision = 0; contacts = []; content = null; communications = null; features = { contactImport: false, communicationsPreview: false };
  currentContactId = null; invitationContactId = null; renderedSettings = null; operationsDirty = false;
  clearImport();
  resetProfile();
  $('[data-contacts-import-panel]').hidden = true;
  $('[data-communications-panel]').hidden = true;
  $('[data-contacts-workspace]').hidden = true;
  $('[data-contacts-account]').hidden = true;
  $('[data-contacts-login-panel]').hidden = false;
  $('[data-contacts-user]').textContent = '';
  $('[data-contacts-rows]').replaceChildren();
  $('[data-contacts-metrics]').replaceChildren();
  $('[data-contacts-planning]').textContent = '';
  $('[data-contacts-progress-note]').textContent = '';
  $('[data-contact-title]').textContent = '对象详情';
  $('[data-contacts-search]').value = '';
  $('[data-contacts-category]').value = '';
  $('[data-contacts-response]').value = '';
  $('[data-contacts-arrangement]').value = '';
  $('[data-contacts-participation]').value = '';
  $('[data-contacts-due]').checked = false;
  $('[data-contacts-owner]').value = '';
  $('[data-contacts-progress]').value = '';
  $('[data-contacts-result-count]').textContent = '';
  $('[data-contact-profile]').replaceChildren();
  $('[data-contact-sessions]').replaceChildren();
  $('[data-contact-booths]').replaceChildren();
  $('[data-contact-form]').reset();
  $('[data-invitation-form]').reset();
  $('[data-invitation-form] [name=recipientName]').value = '';
  $('[data-invitation-panel]').hidden = true;
  clearCommunicationPreviews();
  renderCommunicationStatus();
  const canvas = $('[data-invitation-canvas]');
  canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);
  canvas.removeAttribute('data-ready'); $('[data-invitation-image]').hidden=true; $('[data-invitation-image]').removeAttribute('src');
  $('[data-invitation-caption]').textContent = '选择对象后点击预览，生成专属邀请函。';
  $('[data-contact-error]').textContent = '';
  $('[data-contact-error]').hidden = true;
  if ($('[data-contact-dialog]').open) $('[data-contact-dialog]').close();
}
async function loadWorkspace() {
  if (!permitted()) throw new Error('此账号没有邀约管理权限，请由维护人员为账号配置 outreach 权限。');
  const state = await request('/api/admin/contacts');
  const program = await request('/api/admin/planning');
  const nextFeatures = { contactImport: program.features?.contactImport === true, communicationsPreview: program.features?.communicationsPreview === true, intentInvitations: program.features?.intentInvitations === true, protectedContactImport: program.features?.protectedContactImport === true, batchInvitations: program.features?.batchInvitations === true };
  const nextCommunications = nextFeatures.communicationsPreview ? await request('/api/admin/communications') : null;
  revision = state.revision; contacts = state.contacts; content = program.content;
  features = nextFeatures; communications = nextCommunications;
  intentState = nextFeatures.intentInvitations ? await request('/api/admin/intent-invitations').catch(()=>null) : null;
  for(const id of selectedContacts)if(!contacts.some(contact=>contact.id===id))selectedContacts.delete(id);
  $('[data-contacts-conversion-note]').textContent = intentState ? '将已核对的既有意向登记为工作人员代登记，保留原始来源；不会代替申请人的网站隐私同意，也不会自动发送邀请。' : '报名转换服务尚未就绪；现有名单、跟进与现场安排仍可分别维护。';
  $('[data-contacts-import-panel]').hidden = !features.contactImport;
  $('[data-communications-panel]').hidden = !features.communicationsPreview;
  if (!features.contactImport) clearImport();
  $('[data-contacts-login-panel]').hidden = true;
  $('[data-contacts-workspace]').hidden = false;
  $('[data-contacts-account]').hidden = false;
  $('[data-contacts-user]').textContent = user.label || user.id;
  render();
}
function today() { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date()); }
function due(item) { return !contactDeclined(item) && !!item.operations.followUpAt && item.operations.followUpAt <= today() && item.operations.responseStatus === 'pending'; }
function invitationState(item) { return invitationProgressLabels[contactProgress(item, progressOptions()).state]; }
function render() {
  const metrics = $('[data-contacts-metrics]'); metrics.replaceChildren();
  const summary = summarizeContactProgress(contacts, progressOptions());
  for (const [label, count] of [['对象总数',summary.total],['已记录人工发出 · 当前版',summary.manuallySent],['服务商已接受 · 未证明送达',summary.providerAccepted],['发送结果待核对',summary.unknown],['候补 · 名额尚未确认',summary.waitlisted],['名额状态待核对',summary.admissionUnknown],['出席已确认',summary.attending],['已联系待回复',summary.awaitingReply]]) {
    const card=node('article');card.append(node('span',label),node('strong',String(count)));metrics.append(card);
  }
  $('[data-contacts-progress-note]').textContent = '按人去重，拒绝联络或出席 '+summary.excluded+' 位不计入联络进度；旧版已发出不计作当前版。'+(features.intentInvitations&&!intentState?'新版报名邀请记录暂时无法读取，当前统计仅含可核对的旧邀请函。':'人工发出与服务商接受分别统计，均不表示本人回复或邮件送达。');
  const ownerSelect = $('[data-contacts-owner]'), previousOwner = ownerSelect.value;
  ownerSelect.replaceChildren();for(const [value,label] of [['','全部负责同事'],['__unassigned','尚未分配负责人'],...[...new Set(contacts.map(item=>item.operations.owner).filter(Boolean))].sort().map(value=>[value,value])]){const option=node('option',label);option.value=value;ownerSelect.append(option);}ownerSelect.value=previousOwner;
  $('[data-contacts-planning]').textContent='原问卷意向：自报 SO / RO '+contacts.filter(item=>item.profile.categories.some(value=>['so','ro'].includes(value))).length+' 位，筹备新站点 '+contacts.filter(item=>item.profile.categories.includes('prospective_site')).length+' 位，展示意向 '+contacts.filter(item=>item.profile.interests.includes('exhibition')).length+' 位，需要住宿 '+contacts.filter(item=>item.profile.accommodationIntent==='needed').length+' 位；同意联络 '+contacts.filter(item=>item.profile.contactConsent==='consented'&&!contactDeclined(item)).length+' 位。意向不代表安排已确认。';
  const search=$('[data-contacts-search]').value.trim().toLowerCase();
  const type=$('[data-contacts-category]').value;
  const response=$('[data-contacts-response]').value;
  const onlyDue=$('[data-contacts-due]').checked;
  const arrangement=$('[data-contacts-arrangement]').value;
  const participation=$('[data-contacts-participation]').value;
  const owner=$('[data-contacts-owner]').value, progressFilter=$('[data-contacts-progress]').value;
  const matches=contacts.filter(item=>{
    const p=item.profile;
    const assigned=item.operations.sessionIds.length+item.operations.boothIds.length;
    const matchesArrangement=!arrangement||(arrangement==='assigned'&&assigned>0)||(arrangement==='unassigned'&&assigned===0)||(arrangement==='sessions'&&item.operations.sessionIds.length>0)||(arrangement==='booths'&&item.operations.boothIds.length>0);
    const forms=item.operations.participationForms??[];
    const matchesParticipation=!participation||(participation==='__none'?forms.length===0:forms.includes(participation));
    const progress=contactProgress(item,progressOptions());
    const matchesOwner=!owner||(owner==='__unassigned'?!progress.owner:progress.owner===owner);
    const progressMatches={unconverted:!progress.excluded&&Boolean(intentState)&&!progress.conversion,unreplied:!progress.excluded&&progress.response==='pending'&&progress.contacted,unassigned:!progress.excluded&&!progress.inactive&&!progress.admissionPending&&progress.response==='attending'&&progress.missingAssignment,unsent:!progress.excluded&&!progress.inactive&&!progress.admissionPending&&progress.consented&&!progress.contacted&&!progress.unknown,excluded:progress.excluded,manually_sent:progress.manuallySent,provider_accepted:progress.providerAccepted,unknown:progress.unknown,stale:progress.state==='stale',waitlisted:progress.admissionStatus==='waitlisted',admission_unknown:progress.admissionStatus==='unknown'};
    const matchesProgress=!progressFilter||progressMatches[progressFilter]===true;
    return matchesOwner&&matchesProgress&&matchesParticipation&&matchesArrangement&&(!search||[p.name,p.displayName,p.organization,p.city,p.email,p.wechat].some(value=>value.toLowerCase().includes(search)))&&(!response||item.operations.responseStatus===response)&&(!onlyDue||due(item))&&(!type||(type.startsWith('category:')?p.categories.includes(type.slice(9)):p.interests.includes(type.slice(9))));
  });
  const body=$('[data-contacts-rows]');body.replaceChildren();
  for(const id of selectedContacts)if(!maySelect(contactById(id)))selectedContacts.delete(id);
  visibleContactIds=matches.filter(maySelect).map(item=>item.id);
  for(const item of matches){
    const row=node('tr');
    const identity=node('td');
    const choice=node('input');choice.type='checkbox';choice.dataset.contactSelection=item.id;choice.checked=selectedContacts.has(item.id);choice.setAttribute('aria-label','选择 '+item.profile.displayName+' 进行代登记或准备邀请');choice.addEventListener('change',()=>{if(choice.checked)selectedContacts.add(item.id);else selectedContacts.delete(item.id);lock();});identity.append(choice,node('strong',item.profile.displayName),node('small',[item.profile.organization,item.profile.city].filter(Boolean).join(' · ')));row.append(identity);
    if(item.profile.contactConsent==='declined'||item.operations.responseStatus==='declined')identity.append(node('small','已拒绝联络或出席 · 不转换、不邀请','contacts-conversion-blocked'));
    const tags=node('td');
    for(const value of item.profile.categories)tags.append(node('span',categoryLabels.get(value)||value,'contacts-tag'));
    for(const value of item.profile.interests)tags.append(node('span',interestLabels.get(value)||value,'contacts-tag'));
    if(!tags.childNodes.length)tags.append(node('small','未记录'));
    row.append(tags);
    const invitation=node('td',invitationState(item));const progress=contactProgress(item,progressOptions());if(progress.manuallySent&&progress.providerAccepted)invitation.append(node('small','服务商也已接受 · 未证明送达'));if(progress.unknown&&progress.state!=='unknown')invitation.append(node('small','另有发送结果待核对 · 勿重复发送'));if(progress.stale)invitation.append(node('small','另有历史版本记录，不计入当前版发出'));if(item.invitation.generatedAt)invitation.append(node('small',item.invitation.settings?.confirmed?'手工邀请函：正式版':'手工邀请函：暂定版'));
    const linked=intentState?.conversions?.find(value=>value.sourceContactId===item.id);
    if(linked){const link=node('a','已代登记 · 查看报名');link.href='/admin/registrations/#registration='+encodeURIComponent(linked.registrationId);invitation.append(link);}
    row.append(invitation);
    const follow=node('td',item.operations.owner||'待分配');follow.append(node('small',item.operations.followUpAt||'未安排跟进日期'));if(item.operations.priority==='high')follow.append(node('small','优先跟进'));row.append(follow);
    row.append(node('td',responses[item.operations.responseStatus]));
    const participationCell=node('td',undefined,'contacts-participation-cell');
    for(const value of item.operations.participationForms??[])participationCell.append(node('span',participationLabels.get(value)||value,'contacts-tag'));
    if(!participationCell.childNodes.length)participationCell.append(node('small','尚未标记'));
    row.append(participationCell);
    const arrangements=node('td',undefined,'contacts-arrangements');
    for(const [key,list] of [['sessionIds',content.sessions],['boothIds',content.booths]])for(const id of item.operations[key]){
      const record=list.find(entry=>entry.id===id);
      const warning=!record||record.status==='cancelled';
      const label=!record?(key==='sessionIds'?'场次已删除 · 请核对':'展位已删除 · 请核对'):key==='sessionIds'?record.start+'–'+record.end+' / '+record.zone+'区 · '+record.title:record.code+' / '+record.zone+'区 · '+(record.organization||'待确认');
      arrangements.append(node('span',label+(record?.status==='cancelled'?'（已取消）':''),'contacts-tag'+(warning?' contacts-tag-warning':'')));
    }
    if(!arrangements.childNodes.length)arrangements.append(node('small','尚未安排'));
    row.append(arrangements);
    const actions=node('td',undefined,'contacts-row-actions');for(const [text,handler]of[['编辑资料',()=>openProfile(item)],['详情与安排',()=>openContact(item)],['邀请函',()=>openInvitation(item)]]){const button=node('button',text);button.type='button';if(text==='邀请函'&&!mayInvite(item)){button.textContent=progress.admissionPending?'名额待确认':progress.inactive?'报名已停用':'联络未获同意';button.title=invitationBlockReason(item);button.dataset.consentBlocked='true';button.disabled=true;}button.addEventListener('click',handler);actions.append(button);}const guest=node('button','管理嘉宾资料');guest.type='button';
    if(!user.roles.includes('editor')||!mayInvite(item)||!['pending','attending'].includes(item.operations.responseStatus)){guest.dataset.roleBlocked='true';guest.title=!user.roles.includes('editor')?'同时需要活动编辑权限':!mayInvite(item)?invitationBlockReason(item):'对象已回复不出席；请先核对最新实际回复';}
    guest.addEventListener('click',()=>{if(busy||!permitted()||!user.roles.includes('editor')||!mayInvite(item)||!['pending','attending'].includes(item.operations.responseStatus))return;location.assign('/admin/#invitee='+encodeURIComponent(item.id));});actions.append(guest);
    if(linked){
      const prepare=node('button',mayInvite(item)?'生成报名邀请':progress.admissionPending?'名额待确认 · 暂不准备正式邀请':'报名邀请暂不可用');prepare.type='button';if(!mayInvite(item)){prepare.dataset.roleBlocked='true';prepare.title=invitationBlockReason(item);}prepare.addEventListener('click',()=>action(()=>prepareRegistrationInvitation(item,linked,'manual')));actions.append(prepare);
      const email=node('button','邮件发送报名邀请');email.type='button';
      if(!mayInvite(item)){email.dataset.roleBlocked='true';email.textContent='名额或授权待核对 · 不发送邀请';email.title=invitationBlockReason(item);}else if(!intentState?.email?.ready){email.dataset.roleBlocked='true';email.title='寄件服务尚未配置，无法发送邮件';}
      email.addEventListener('click',()=>action(()=>prepareRegistrationInvitation(item,linked,'email')));actions.append(email);
      const manual=intentState.invitations?.find(value=>value.sourceContactId===item.id&&value.channel==='manual');
      if(manual){const state=node('small',({prepared:'报名邀请已准备，未记录发出',manually_sent:'报名邀请已记录人工发出',provider_accepted:'服务商已接受发送',unknown:'发送结果不明，勿重复发送',rejected:'服务商拒绝发送'})[manual.status]||'邀请状态待核对');actions.append(state);if(manual.status==='prepared'&&mayInvite(item)){const sent=node('button','记录报名邀请已发出');sent.type='button';sent.addEventListener('click',()=>action(async()=>{const named=prompt('确认已经实际发出后，填写实际渠道：微信、邮件或其他。此操作只记录，不发送消息。');const channel=({微信:'wechat',邮件:'email',其他:'other'})[named?.trim()];if(!channel)return;await request('/api/admin/intent-invitations/'+encodeURIComponent(manual.id)+'/manual-sent',{method:'POST',body:JSON.stringify({channel})});intentState=await request('/api/admin/intent-invitations');render();announce('已记录报名邀请经'+named.trim()+'人工发出；没有自动确认对方出席。');}));actions.append(sent);}}
    }
    row.append(actions);
    ['对象','原始身份与意向','邀请函 / 发出记录','跟进','出席回复','参与形式','现场安排','操作'].forEach((label,index)=>{row.children[index].dataset.label=label;});body.append(row);
  }
  $('[data-contacts-empty]').hidden=matches.length>0;
  $('[data-contacts-empty]').textContent=contacts.length?'没有符合筛选条件的对象。':'目前没有对象，可手动新增联系人。'+(features.contactImport?'也可导入并核对名单。':'');
  $('[data-contacts-result-count]').textContent='显示 '+matches.length+' / '+contacts.length+' 位';
  lock();
}
async function prepareRegistrationInvitation(item,linked,channel){
  if(!features.intentInvitations||!intentState)throw new Error('报名邀请服务尚未就绪。');
  if(!mayInvite(item))throw new Error(invitationBlockReason(item));
  if(channel==='email'&&!confirm('确认现在向 '+item.profile.displayName+' 发送这份报名邀请邮件？服务商接受不等于送达；结果不明时不要重复发送。'))return;
  const result=await request('/api/admin/contacts/'+encodeURIComponent(item.id)+'/invitation',{method:'POST',body:JSON.stringify({expectedContactRevision:revision,channel,expectedRegistrationId:linked.registrationId,...(channel==='email'?{confirmEmail:true}:{})})});
  const invitation=result.invitation;
  if(channel==='manual'){
    const settings=invitation?.content?.settings;if(!settings)throw new Error('邀请内容未完成，请刷新后核对。');
    await renderInvitation($('[data-invitation-canvas]'),{templateUrl:'/invitations/template-blank.png',...settings});
    const blob=await invitationPngBlob($('[data-invitation-canvas]'));const url=URL.createObjectURL(blob),link=node('a');link.href=url;link.download=invitationFilename(settings.recipientName,true);document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
    announce('报名邀请 PNG 已准备并开始下载。尚未发出；实际发送后再记录渠道。');
  }else announce(invitation?.status==='provider_accepted'?'邮件服务商已接受发送请求，尚无送达证明。':invitation?.status==='unknown'?'邮件结果尚未确认，系统不会自动重送；请先人工核对。':'邮件未确认发送成功，请核对服务状态。',invitation?.status!=='provider_accepted');
  intentState=await request('/api/admin/intent-invitations');render();
}
function detailPair(dl,label,value){if(!value)return;dl.append(node('dt',label),node('dd',value));}
function openContact(item){
  if(busy||!permitted())return;
  currentContactId=item.id;operationsDirty=false;
  $('[data-contact-title]').textContent=item.profile.displayName+' · 跟进与安排';
  const profile=$('[data-contact-profile]');const dl=node('dl');
  const p=item.profile;
  for(const [label,value]of[['机构 / 职务',[p.organization,p.position].filter(Boolean).join(' · ')],['城市',p.city],['邮箱',p.email],['微信',p.wechat],['身份',p.categories.map(value=>categoryLabels.get(value)||value).join('、')],['参与意向',p.interests.map(value=>interestLabels.get(value)||value).join('、')],['背景与经验',p.background],['关注主题',p.topics],['网站 / 作品',[p.website,p.caseLinks].filter(Boolean).join('\n')],['原出席意向',p.attendanceIntentLabel||'源选项码 '+(p.attendanceIntentCode||'未填')+'（待核对）'],['原住宿意向',p.accommodationIntentLabel||'源选项码 '+(p.accommodationIntentCode||'未填')+'（待核对）'],['原联络同意',p.contactConsentLabel||'源选项码 '+(p.contactConsentCode||'未填')+'（待核对）'],['原未来合作',p.futureCooperationLabel||'源选项码 '+(p.futureCooperationCode||'未填')+'（待核对）'],['原提交时间',p.submittedAt]])detailPair(dl,label,value);
  detailPair(dl,'电话',p.phone);detailPair(dl,'站点 / 职务',[p.siteName,p.siteRole].filter(Boolean).join(' · '));
  detailPair(dl,'联络许可',consentLabels[p.contactConsent]||consentLabels.unknown);
  detailPair(dl,'来源',item.source.key==='manual'?'工作人员手动新增':'问卷导入 · 来源序号 '+item.source.rowId);
  profile.replaceChildren(dl);
  const linked=intentState?.conversions?.find(value=>value.sourceContactId===item.id);
  if(linked){const link=node('a','查看已关联报名 · '+linked.referenceCode,'ah-admin-button');link.href='/admin/registrations/#registration='+encodeURIComponent(linked.registrationId);profile.append(link);}
  if(item.sourceProfile){const original=node('details');original.append(node('summary','查看原始来源基本资料（只读）'));const source=node('dl');for(const key of EDITABLE_CONTACT_FIELDS)if(item.sourceProfile[key]&&item.sourceProfile[key]!==p[key])detailPair(source,key,item.sourceProfile[key]);if(!source.childNodes.length)source.append(node('dd','基本资料与原始来源一致。'));original.append(source);profile.append(original);}
  const form=$('[data-contact-form]');form.reset();
  for(const key of ['owner','priority','followUpAt','notes','responseStatus'])form.elements.namedItem(key).value=item.operations[key];
  for(const input of form.querySelectorAll('[name=participationForms]'))input.checked=(item.operations.participationForms??[]).includes(input.value);
  for(const [key,list,target]of[['sessionIds',content.sessions,'[data-contact-sessions]'],['boothIds',content.booths,'[data-contact-booths]']]){
    const holder=$(target);holder.replaceChildren();
    for(const record of list){const label=node('label');const input=node('input');input.type='checkbox';input.name=key;input.value=record.id;input.checked=record.status!=='cancelled'&&item.operations[key].includes(record.id);input.disabled=record.status==='cancelled';label.append(input,document.createTextNode(key==='sessionIds'?record.start+'–'+record.end+' / '+record.zone+' 区 · '+record.title+(record.status==='cancelled'?'（已取消）':''):record.code+' · '+(record.organization||'待确认')+' · '+(record.project||'待确认')));holder.append(label);}
    const missing=item.operations[key].filter(id=>!list.some(record=>record.id===id));
    if(item.operations[key].some(id=>list.some(record=>record.id===id&&record.status==='cancelled')))holder.append(node('p','原安排含已取消项目。本次保存将移除该关联，请核对。','contacts-empty-hint'));
    if(missing.length)holder.append(node('p','有 '+missing.length+' 条原安排已删除，请核对后重新选择。','contacts-empty-hint'));
    if(!list.length)holder.append(node('p',key==='boothIds'?'请先到活动 / 嘉宾安排建立展位，再为对象安排出席展位。':'暂无可安排场次。','contacts-empty-hint'));
  }
  $('[data-contact-error]').hidden=true;$('[data-contact-error]').textContent='';
  $('[data-contact-dialog]').showModal();
}
function closeContact(){if(busy)return;if(operationsDirty&&!confirm('关闭将放弃未保存的跟进修改，继续吗？'))return;operationsDirty=false;$('[data-contact-dialog]').close();$('[data-contact-form]').reset();$('[data-contact-profile]').replaceChildren();}
function updateContact(result){revision=result.revision;const exists=contacts.some(item=>item.id===result.contact.id);contacts=exists?contacts.map(item=>item.id===result.contact.id?result.contact:item):[...contacts,result.contact];render();}
function resetProfile(){
  profileContactId=null;profileDirty=false;
  const dialog=$('[data-profile-dialog]');if(dialog.open)dialog.close();
  $('[data-profile-form]').reset();$('[data-profile-title]').textContent='新增联系人';
  $('[data-profile-source]').textContent='';$('[data-profile-error]').textContent='';$('[data-profile-error]').hidden=true;
  $('[data-profile-duplicates]').hidden=true;$('[data-profile-duplicate-message]').textContent='';
  $('[data-profile-consent-readonly]').textContent='';
}
function profileDuplicates(){
  const form=$('[data-profile-form]');
  const email=form.elements.namedItem('email').value.trim().toLowerCase();
  const wechat=form.elements.namedItem('wechat').value.trim().toLowerCase();
  return contacts.filter(item=>item.id!==profileContactId&&((email&&item.profile.email.toLowerCase()===email)||(wechat&&item.profile.wechat.toLowerCase()===wechat))).length;
}
function syncProfileDuplicates(){
  const count=profileDuplicates();$('[data-profile-duplicates]').hidden=!count;
  $('[data-profile-duplicate-message]').textContent=count?'发现 '+count+' 位现有对象使用相同邮箱或微信。请先核对，系统不会自动合并。':'';
  lock();
}
function openProfile(item=null){
  if(busy||!permitted())return;
  resetProfile();profileContactId=item?.id??null;
  const form=$('[data-profile-form]');
  for(const key of EDITABLE_CONTACT_FIELDS)form.elements.namedItem(key).value=item?.profile[key]??'';
  $('[data-profile-title]').textContent=item?'编辑联系人基本资料':'新增联系人';
  $('[data-profile-source]').textContent=item?(item.source.key==='manual'?'工作人员手动新增。基本资料修正不会改变原联络同意或跟进记录。':'问卷导入。只修正基本资料，原始答案、同意与来源身份保持只读。'):'手动录入仅保存在私有人员工作区；不自动获邀或公开。';
  $('[data-profile-consent-field]').hidden=Boolean(item);
  form.elements.namedItem('contactConsent').disabled=Boolean(item);
  $('[data-profile-consent-readonly]').hidden=!item;
  $('[data-profile-consent-readonly]').textContent=item?'已记录的联络许可（只读）：'+(consentLabels[item.profile.contactConsent]||consentLabels.unknown):'';
  syncProfileDuplicates();$('[data-profile-dialog]').showModal();
}
function closeProfile(){
  if(busy)return;
  if(profileDirty&&!confirm('关闭将放弃未保存的基本资料，继续吗？'))return;
  resetProfile();lock();
}
function openInvitation(item){
  if(busy||!permitted())return;
  if(!mayInvite(item)){announce(invitationBlockReason(item),true);return;}
  invitationContactId=item.id;renderedSettings=null;clearCommunicationPreviews();
  const form=$('[data-invitation-form]');form.reset();
  const settings=item.invitation.settings||{recipientName:item.profile.displayName,date:eventConfig.date.value,time:eventConfig.time.label,venue:eventConfig.venue.address,confirmed:false};
  for(const key of ['recipientName','date','time','venue'])form.elements.namedItem(key).value=settings[key];
  form.elements.namedItem('confirmed').checked=settings.confirmed===true;
  $('[data-invitation-sent-confirm]').checked=false;
  const canvas=$('[data-invitation-canvas]');canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);canvas.removeAttribute('data-ready');$('[data-invitation-image]').hidden=true;$('[data-invitation-image]').removeAttribute('src');
  $('[data-invitation-caption]').textContent=item.profile.displayName+' · '+invitationState(item);
  $('[data-invitation-panel]').hidden=false;
  $('[data-invitation-panel]').scrollIntoView({behavior:'smooth',block:'start'});lock();
}
function settingsFromForm(){const form=$('[data-invitation-form]');return{recipientName:form.elements.namedItem('recipientName').value.trim(),date:form.elements.namedItem('date').value,time:form.elements.namedItem('time').value.trim(),venue:form.elements.namedItem('venue').value.trim(),confirmed:form.elements.namedItem('confirmed').checked};}

$('[data-contacts-login]').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;if(!form.reportValidity())return;action(async()=>{let result;try{result=await request('/api/admin/login',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});}finally{form.elements.namedItem('password').value='';}user=result.user;csrfToken=result.csrfToken;$('[data-contacts-account]').hidden=false;$('[data-contacts-user]').textContent=user.label||user.id;await loadWorkspace();announce('已登录。名单和联系方式仅在此私有工作区显示。');});});
$('[data-contacts-logout]').addEventListener('click',()=>action(async()=>{if((operationsDirty||profileDirty)&&!confirm('退出将清空未保存的修改，继续吗？'))return;await request('/api/admin/logout',{method:'POST'});clearPrivateState();announce('已退出，已清空本页的名单与邀请函预览。');}));
$('[data-contacts-refresh]').addEventListener('click',()=>action(async()=>{if((operationsDirty||profileDirty)&&!confirm('有未保存的修改，刷新将放弃这些修改。继续刷新吗？'))return;operationsDirty=false;resetProfile();if($('[data-contact-dialog]').open)$('[data-contact-dialog]').close();await loadWorkspace();clearImport();announce('已载入最新名单。');}));
$('[data-contacts-select-visible]').addEventListener('click',()=>{for(const id of visibleContactIds)selectedContacts.add(id);render();});
$('[data-contacts-clear-selection]').addEventListener('click',()=>{selectedContacts.clear();render();});
$('[data-contacts-batch-invite]').addEventListener('click',()=>action(async()=>{
  if(!features.batchInvitations||!intentState||!selectedContacts.size)throw new Error('请先选择已核对的对象。');
  if(selectedContacts.size>100)throw new Error('每次最多准备 100 位，请分批核对。');
  const generation=sessionGeneration, contactIds=[...selectedContacts], expectedContactRevision=revision;
  const {previewBatchInvitations,prepareBatchInvitations}=await import('../lib/invitation-batch.mjs');
  const preview=await previewBatchInvitations({contactIds,expectedContactRevision,request});
  if(generation!==sessionGeneration)throw new Error('会话已改变，请重新登录。');
  clearBatchResult();$('[data-batch-panel]').hidden=false;
  for(const entry of preview.entries){const item=contactById(entry.contactId);$('[data-batch-results]').append(node('li',(item?.profile.displayName||'所选对象')+' · '+(entry.eligible?'可准备邀请':'跳过：'+batchReason(entry.reason))));}
  $('[data-batch-summary]').textContent='预检 '+preview.summary.selected+' 位，可准备 '+preview.summary.eligible+' 位，跳过 '+preview.summary.skipped+' 位。';
  if(!preview.summary.eligible){announce('本次没有符合条件的邀请，未准备或发送任何消息。');return;}
  if(!confirm('已预检所选对象：可准备 '+preview.summary.eligible+' 位，跳过 '+preview.summary.skipped+' 位。确认批量准备具名邀请与 ZIP？仅准备、下载，不会发送或记录已发出。'))return;
  const result=await prepareBatchInvitations({contactIds,expectedContactRevision,previewToken:preview.previewToken,request,
    renderInvitation:async invitation=>{const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1920;await renderInvitation(canvas,{templateUrl:'/invitations/template-blank.png',...invitation.content.settings});return invitationPngBlob(canvas);},
    onProgress:progress=>{if(generation===sessionGeneration)$('[data-batch-summary]').textContent=typeof progress==='string'?progress:'正在准备本次邀请 ZIP，请保留此页。';}});
  if(generation!==sessionGeneration)throw new Error('会话已改变，未提供私有下载。');
  $('[data-batch-results]').replaceChildren();
  for(const entry of result.results??[]){const item=contactById(entry.contactId);const label=({prepared:'已准备，尚未发出',replayed:'沿用已保存版本，未重复准备',skipped:'已跳过',failed:'未完成',unknown:'结果不明，先核对勿重试'})[entry.status]||'待核对';$('[data-batch-results]').append(node('li',(item?.profile.displayName||'所选对象')+' · '+label+(entry.pngStatus==='failed'?' · 图片未完成，ZIP 中仅保留结果记录':'')+(entry.code?' · '+batchReason(entry.code):'')));}
  if(result.blob?.size){batchDownloadUrl=URL.createObjectURL(result.blob);const download=$('[data-batch-download]');download.href=batchDownloadUrl;download.download=result.fileName;download.hidden=false;}
  $('[data-batch-summary]').textContent=result.blob?.size?'本次 ZIP 已准备，可点击下载。实际生成 '+(result.summary?.pngCreated??0)+' 张图片'+(result.summary?.pngFailed?'，另有 '+result.summary.pngFailed+' 张图片未完成':'')+'；请逐人核对发送清单，下载不会记录已发出。':'本次没有可供下载的邀请。请按逐人结果核对，勿自动重试结果不明的对象。';
  try{intentState=await request('/api/admin/intent-invitations');render();}catch{announce('邀请结果已保留在本页，最新进度读取未完成。请下载后刷新核对，勿重复发送。',true);return;}
  announce('批量准备结束，逐人结果已列出。没有发送邀请或确认任何人出席。');
}));
function batchReason(code){return ({CONTACT_DECLINED:'已拒绝联络或出席',CONTACT_NOT_CONSENTED:'联络授权尚未核实',REGISTRATION_REQUIRED:'尚未代登记',REGISTRATION_INACTIVE:'报名已停用或名额待核对',ADMISSION_REQUIRED:'名额尚未确认',INVITATION_DISPATCH_RECORDED:'已有发出或服务商接受记录，不重复准备',INVITATION_STATUS_UNKNOWN:'发送结果不明，先核对勿重试',INVITATION_CHANGED:'邀请版本已变化，请核对',REVISION_CONFLICT:'名单版本已更新',STORAGE_UNAVAILABLE:'保存结果待核对'})[code]||'请核对对象资料及有效报名';}
$('[data-contacts-convert]').addEventListener('click',()=>action(async()=>{
  if(!intentState||!selectedContacts.size)throw new Error('请先选择要代登记的对象。');
  if(selectedContacts.size>100)throw new Error('每次最多代登记 100 位，请分批核对。');
  const preview=await request('/api/admin/contacts/convert/preview',{method:'POST',body:JSON.stringify({contactIds:[...selectedContacts],expectedContactRevision:revision})});
  if(!Array.isArray(preview.entries)||!preview.summary)throw new Error('转换预览尚未完成，未登记任何新报名。');
  const eligible=preview.entries.filter(item=>item.eligible===true).map(item=>item.contactId);
  if(!eligible.length)throw new Error('所选对象目前没有可转换记录，拒绝联络或出席的对象不会转换或邀请。');
  const omissions=Number.isSafeInteger(preview.summary.optionalFieldsOmitted)?preview.summary.optionalFieldsOmitted:0;
  if(!confirm('已核对 '+eligible.length+' 位可代登记对象。'+(omissions?'其中 '+omissions+' 项无效选填网站／案例链接不会写入新报名，原始来源仍保留。':'')+'保留原始来源，不代替本人完成网站隐私同意，也不发送消息。确认转换吗？'))return;
  const result=await request('/api/admin/contacts/convert',{method:'POST',body:JSON.stringify({contactIds:eligible,expectedContactRevision:revision})});
  intentState=await request('/api/admin/intent-invitations');
  const success=Array.isArray(result.registrations)?result.registrations.length:0,failed=Array.isArray(result.failures)?result.failures.length:0;
  for(const record of result.registrations??[])selectedContacts.delete(record.contactId);
  const skipped=Array.isArray(result.skipped)?result.skipped.length:0;
  render();announce('已确认代登记 '+success+' 位'+(skipped?'；跳过 '+skipped+' 位拒绝联络或出席对象。':'。')+(failed?'另有 '+failed+' 位未完成，请核对后重试。':'')+'没有自动发出邀请或确认出席。',failed>0);
}));
for(const selector of ['[data-contacts-search]','[data-contacts-category]','[data-contacts-response]','[data-contacts-arrangement]','[data-contacts-participation]','[data-contacts-due]','[data-contacts-owner]','[data-contacts-progress]'])$(selector).addEventListener('input',render);
for(const [prefix,items,label]of[['category:',sourceLabels.categories,'身份'],['interest:',sourceLabels.interests,'参与意向']]){const group=node('optgroup');group.label=label;for(const item of items){const option=node('option',item.label);option.value=prefix+item.value;group.append(option);}$('[data-contacts-category]').append(group);}
$('[data-contacts-file]').addEventListener('change',event=>{
  const file=event.currentTarget.files?.[0];
  if(!file||busy||!permitted()||!features.contactImport){event.currentTarget.value='';return;}
  action(async()=>{
    clearImport();
    if(!/\.(?:xlsx|json)$/iu.test(file.name)||file.size>2*1024*1024)throw new Error('请选择不超过 2 MiB 的原始 .xlsx 问卷或 contacts.json 快照。');
    announce('正在当前浏览器读取原始文件并准备私有导入预览…');
    const bytes=new Uint8Array(await file.arrayBuffer());
    const originalSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');
    let parsed=null;
    if(file.name.toLowerCase().endsWith('.json')){
      if(!features.protectedContactImport)throw new Error('此旧版本本机服务只支持 Excel 问卷；JSON 快照须使用已完成配置的云端后台。');
      let snapshot;try{snapshot=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new Error('请选择 UTF-8 编码的原始 contacts.json。');}
      importSource={kind:'snapshot',snapshot,originalSha256};
    }else{
      const {readSheet}=await import('read-excel-file/universal');const matrix=await readSheet(file);parsed=parseContactImport(matrix);
      if(!parsed.rows.length||parsed.rows.length>500)throw new Error('每批请导入 1–500 位对象。');
      let binary='';for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
      importSource={kind:'rows',sourceKey:WORKBOOK_SOURCE_KEY,rows:parsed.rows,sourceFileBase64:btoa(binary),originalSha256};
    }
    const payload=features.protectedContactImport?importSource:{sourceKey:WORKBOOK_SOURCE_KEY,rows:parsed.rows};
    importPreview=await request('/api/admin/contacts/import/preview',{method:'POST',body:JSON.stringify(payload)});
    $('[data-contacts-file-name]').textContent=file.name;const summary=importPreview.summary;
    $('[data-import-summary]').textContent='共 '+summary.total+' 位：新增 '+summary.new+'，已存在 '+summary.unchanged+'，来源变更 '+summary.conflicts+'，无效 '+summary.invalid+'，可能重复 '+summary.possibleDuplicates+'。';
    const holder=$('[data-import-rows]');
    for(const row of importPreview.rows??[])holder.append(node('p',row.displayName+' · '+({new:'准备新增',unchanged:'已存在，不重复导入',source_changed:'来源变更，需人工核对',invalid:'请先修正'}[row.status]||'请核对')+(row.messages?.length?' · '+row.messages.join(' '):'')));
    if(!importPreview.rows?.length&&parsed)for(const row of parsed.rows)holder.append(node('p',row.displayName+' · '+[row.organization,row.city].filter(Boolean).join(' / ')+'（本机读取，提交后由服务端独立核对）'));
    $('[data-import-preview]').hidden=false;
    announce(parsed?.warnings.length?parsed.warnings.map(item=>item.message).join(' '):'请核对原始来源、导入统计与必要授权，再确认写入私有名单。');
  });
});
$('[data-import-duplicates]').addEventListener('change',lock);
$('[data-import-cancel]').addEventListener('click',()=>{clearImport();lock();announce('已取消本次导入预览，没有写入名单。');});
$('[data-import-source-confirm]').addEventListener('change',lock);
$('[data-import-confirm]').addEventListener('click',()=>action(async()=>{
  if(!permitted()||!features.contactImport||!importPreview?.canCommit||!$('[data-import-source-confirm]').checked)throw new Error('请先核对有效预览、原始文件与导入授权。');
  const payload=features.protectedContactImport?{...importSource,expectedRevision:importPreview.expectedRevision,previewToken:importPreview.previewToken,allowPossibleDuplicates:$('[data-import-duplicates]').checked,confirmSource:true}:{expectedRevision:revision,previewToken:importPreview.previewToken,allowPossibleDuplicates:$('[data-import-duplicates]').checked};
  const result=await request('/api/admin/contacts/import',{method:'POST',body:JSON.stringify(payload)});
  revision=result.revision;contacts=result.contacts;const summary=result.summary;clearImport();render();
  announce('已确认写入 '+summary.new+' 位，已有 '+summary.unchanged+' 位保持不变。尚未自动代登记、生成邀请或确认出席。');
}));
$('[data-contact-new]').addEventListener('click',()=>openProfile());
for(const button of document.querySelectorAll('[data-profile-close]'))button.addEventListener('click',closeProfile);
$('[data-profile-dialog]').addEventListener('cancel',event=>{event.preventDefault();closeProfile();});
$('[data-profile-form]').addEventListener('input',event=>{if(!event.target.name)return;profileDirty=true;$('[data-profile-duplicates-confirm]').checked=false;syncProfileDuplicates();});
$('[data-profile-duplicates-confirm]').addEventListener('change',lock);
$('[data-profile-form]').addEventListener('submit',event=>{
  event.preventDefault();const form=event.currentTarget;if(!permitted()||!form.reportValidity())return;
  if(profileDuplicates()&&!$('[data-profile-duplicates-confirm]').checked){syncProfileDuplicates();return;}
  const profile=Object.fromEntries(EDITABLE_CONTACT_FIELDS.map(key=>[key,form.elements.namedItem(key).value.trim()]));
  if(!profileContactId)profile.contactConsent=form.elements.namedItem('contactConsent').value;
  const id=profileContactId;
  action(async()=>{try{
    const result=await request('/api/admin/contacts'+(id?'/'+encodeURIComponent(id)+'/profile':''),{method:id?'PUT':'POST',body:JSON.stringify({expectedRevision:revision,profile})});
    updateContact(result);resetProfile();announce(id?'基本资料已保存；来源答案、联络许可与跟进安排保持独立。':'联系人已保存；尚未生成邀请、发出消息或确认出席。');
  }catch(error){if(user){$('[data-profile-error]').textContent=error.message;$('[data-profile-error]').hidden=false;$('[data-profile-error]').focus();}throw error;}});
});
$('[data-contact-form]').addEventListener('input',()=>{operationsDirty=true;});
for(const button of document.querySelectorAll('[data-contact-close]'))button.addEventListener('click',closeContact);
$('[data-contact-dialog]').addEventListener('cancel',event=>{event.preventDefault();closeContact();});
$('[data-contact-form]').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;if(!form.reportValidity())return;const data=new FormData(form);action(async()=>{const operations=Object.fromEntries(['owner','priority','followUpAt','notes','responseStatus'].map(key=>[key,data.get(key)||'']));operations.sessionIds=data.getAll('sessionIds');operations.boothIds=data.getAll('boothIds');operations.participationForms=data.getAll('participationForms');try{const result=await request('/api/admin/contacts/'+encodeURIComponent(currentContactId),{method:'PUT',body:JSON.stringify({expectedRevision:revision,operations})});updateContact(result);operationsDirty=false;$('[data-contact-dialog]').close();announce('跟进与安排已保存。此操作没有改变公开讲者或展位名单。');}catch(error){$('[data-contact-error]').textContent=error.message;$('[data-contact-error]').hidden=false;$('[data-contact-error]').focus();throw error;}});});
$('[data-invitation-form]').addEventListener('input',event=>{if(!['recipientName','date','time','venue','confirmed'].includes(event.target.name))return;renderedSettings=null;$('[data-invitation-image]').hidden=true;$('[data-invitation-image]').removeAttribute('src');$('[data-invitation-sent-confirm]').checked=false;clearCommunicationPreviews();lock();});
$('[data-invitation-form]').addEventListener('submit',event=>{event.preventDefault();if(!event.currentTarget.reportValidity())return;action(async()=>{requireInviteConsent();const settings=settingsFromForm();await renderInvitation($('[data-invitation-canvas]'),{templateUrl:'/invitations/template-blank.png',...settings});renderedSettings=settings;$('[data-invitation-canvas]').dataset.ready='true';$('[data-invitation-image]').src=$('[data-invitation-canvas]').toDataURL('image/png');$('[data-invitation-image]').hidden=false;$('[data-invitation-caption]').textContent=settings.recipientName+' · '+(settings.confirmed?'正式版预览':'暂定版预览')+' · 仅预览，不会发送';announce('邀请函预览已生成。下载只保存图片，不会发送给对象。');});});
$('[data-invitation-download]').addEventListener('click',()=>action(async()=>{requireInviteConsent();if(!renderedSettings||!invitationContactId)throw new Error('请先生成当前设置的邀请函预览。');const blob=await invitationPngBlob($('[data-invitation-canvas]'));if(!blob.size)throw new Error('图片生成未完成，请重试。');const link=node('a');const url=URL.createObjectURL(blob);try{link.href=url;link.download=invitationFilename(renderedSettings.recipientName,renderedSettings.confirmed);document.body.append(link);link.click();}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}const result=await request('/api/admin/contacts/'+encodeURIComponent(invitationContactId)+'/invitation/generated',{method:'POST',body:JSON.stringify({expectedRevision:revision,settings:renderedSettings})});updateContact(result);$('[data-invitation-sent-confirm]').checked=false;announce('PNG 已生成并开始下载，已记录生成时间；尚未记录发出。');}));
$('[data-invitation-sent-confirm]').addEventListener('change',lock);
$('[data-invitation-channel]').addEventListener('change',()=>{$('[data-invitation-sent-confirm]').checked=false;lock();});
$('[data-invitation-record-sent]').addEventListener('click',()=>action(async()=>{requireInviteConsent();if(!$('[data-invitation-sent-confirm]').checked)throw new Error('请先确认你已经实际发出邀请。');if(!matchesSavedInvitation())throw new Error('当前设置与最近一次生成记录不同，请重新生成并下载，再核对实际发出的版本。');const result=await request('/api/admin/contacts/'+encodeURIComponent(invitationContactId)+'/invitation/sent',{method:'POST',body:JSON.stringify({expectedRevision:revision,channel:$('[data-invitation-channel]').value,generatedAt:contactById(invitationContactId).invitation.generatedAt,settings:settingsFromForm()})});updateContact(result);$('[data-invitation-sent-confirm]').checked=false;announce('已保存工作人员的手动发出记录。系统没有发送任何消息，也没有自动确认对方出席。');}));
$('[data-invitation-close]').addEventListener('click',()=>{
  $('[data-invitation-panel]').hidden=true;invitationContactId=null;renderedSettings=null;
  $('[data-invitation-form]').reset();$('[data-invitation-form] [name=recipientName]').value='';
  $('[data-invitation-image]').hidden=true;$('[data-invitation-image]').removeAttribute('src');
  const canvas=$('[data-invitation-canvas]');canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);canvas.removeAttribute('data-ready');
  $('[data-invitation-caption]').textContent='选择对象后点击预览，生成专属邀请函。';clearCommunicationPreviews();lock();
});
$('[data-wallet-preview-button]').addEventListener('click',()=>{if(!$('[data-invitation-form]').reportValidity())return;action(async()=>{requireInviteConsent();const result=await request('/api/admin/contacts/'+encodeURIComponent(invitationContactId)+'/wallet/preview',{method:'POST',body:JSON.stringify({settings:settingsFromForm()})});for(const [selector,value]of [['[data-wallet-title]',result.title],['[data-wallet-name]',result.name],['[data-wallet-date]',result.date],['[data-wallet-time]',result.time],['[data-wallet-location]',result.location],['[data-wallet-notice]',result.notice]])$(selector).textContent=value;$('[data-wallet-preview]').hidden=false;announce('已生成未签名 Wallet 卡片预览。尚未制作或发送 Apple Wallet 通行证。');});});
$('[data-email-preview-button]').addEventListener('click',()=>{if(!$('[data-invitation-form]').reportValidity())return;action(async()=>{requireInviteConsent();if(contactById(invitationContactId)?.operations.responseStatus!=='attending')throw new Error('请先核实并保存对方已确认出席的回复。');const result=await request('/api/admin/contacts/'+encodeURIComponent(invitationContactId)+'/email/preview',{method:'POST',body:JSON.stringify({settings:settingsFromForm()})});$('[data-email-to]').textContent=result.toEmail;$('[data-email-subject]').textContent=result.subject;$('[data-email-text]').textContent=result.text;$('[data-email-preview]').hidden=false;announce('确认信内容已生成，仅供核对，尚未发送。');});});
window.addEventListener('beforeunload',event=>{if(operationsDirty||profileDirty){event.preventDefault();event.returnValue='';}});
if(location.protocol==='file:'){announce('这是离线界面预览。请启动本地服务，使用有邀约管理权限的账号登录。');lock();}else{action(async()=>{const response=await fetch('/api/admin/session',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});if(response.status===401)return;if(!response.ok)throw new Error('请先启动本地后台服务。');const session=await response.json();user=session.user;csrfToken=session.csrfToken;$('[data-contacts-account]').hidden=false;$('[data-contacts-user]').textContent=user.label||user.id;await loadWorkspace();announce('已恢复工作人员会话。');});}
