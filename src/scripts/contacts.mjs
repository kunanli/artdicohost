import {createOperationsFormDraft,operationsDraftStore,captureDraftFields,applyDraftFields} from '../lib/operations-form-draft.mjs';
import { parseContactImport, WORKBOOK_SOURCE_KEY, sourceLabels } from '../../shared/contact-import.mjs';
import { renderInvitation, invitationPngBlob, invitationFilename } from '../lib/invitation-renderer.mjs';
import { EDITABLE_CONTACT_FIELDS, EDITABLE_CONTACT_ARRAY_FIELDS } from '../../shared/contact-editor.mjs';
import { SESSION_ROLES, SESSION_ROLE_LABELS } from '../../shared/contacts-schema.mjs';
import { eventConfig } from '../config/event.mjs';
import { contactProgress, summarizeContactProgress, invitationProgressLabels, contactDeclined,buildPosterInvitationSettings,INVITATION_POSTER_RENDER_VERSION } from '../../shared/organizer-progress.mjs';
import { peopleRelationships, organizationMemberships, relationshipForContact, matchesPeopleRelationships, parseOrganizationSelection, admissionForContact, ADMISSION_LABELS, PUBLIC_ROLE_LABELS, savedContactReceipt, conversionPreview, conversionReceipt, privateResponseAction } from '../lib/people-relationships.mjs';

const $ = value => document.querySelector(value);
const responses = { pending: '尚未确认', attending: '已确认出席', declined: '不出席' };
const categoryLabels = new Map(sourceLabels.categories.map(item => [item.value, item.label]));
const interestLabels = new Map(sourceLabels.interests.map(item => [item.value, item.label]));
const participationLabels = new Map([...document.querySelectorAll('[data-contact-participation] input')].map(input => [input.value, input.dataset.participationLabel]));
let user = null, csrfToken = '', revision = 0, contacts = [], content = null;
let busy = false, importPreview = null, currentContactId = null, invitationContactId = null, renderedSettings = null;
let operationsDirty = false, communications = null;
let invitationRenderVersion,invitationGeneration=0;
let profileContactId = null, profileDirty = false;
let features = { contactImport: false, communicationsPreview: false };
let intentState = null;
let importSource = null;
const selectedContacts = new Set();
let visibleContactIds = [];
let relationships = null, relationshipSequence = 0, operationRevision = null, membershipEdited = false, uncertainSave = null, conversionDraft = null;
const admissionReceipts = new Map();
let profileDraft=null,contactDraft=null,profilePending=false;
const operationNames=()=>['owner','priority','followUpAt','notes','responseStatus','participationForms','sessionIds','boothIds',...content.sessions.map(item=>'sessionRoles:'+item.id)];
function openContactDraft(){
  contactDraft?.close();const id=currentContactId,generation=sessionGeneration,form=$('[data-contact-form]');
  const names=operationNames();
  contactDraft=createOperationsFormDraft({actorId:user.id,roles:user.roles,page:'people',entity:'operations:'+id,form,baseRevision:()=>operationRevision,isCurrent:()=>generation===sessionGeneration&&currentContactId===id&&Boolean(user),
    capture:()=>({...captureDraftFields(form,names),...(relationships?{membershipsJson:JSON.stringify([...$('[data-contact-memberships]').children].map(row=>({organizationId:row.querySelector('[name=organizationId]').value,role:row.querySelector('[name=role]').value,title:row.querySelector('[name=title]').value})))}:{})}),
    apply:fields=>{const{membershipsJson,...values}=fields;let members=null;if(membershipsJson){members=organizationMemberships(JSON.parse(membershipsJson));if(!relationships||members.some(member=>!relationships.organizations.some(item=>item.id===member.organizationId)))throw new Error('组织关联已改变，请手动核对本机草稿。');}applyDraftFields(form,values,names);if(members){$('[data-contact-memberships]').replaceChildren();for(const member of members)membershipRow(member);membershipEdited=true;}for(const input of form.querySelectorAll('[name=sessionIds]'))input.dispatchEvent(new Event('change'));operationsDirty=true;},
    manualPending:true,onPending:request=>{const body=JSON.parse(request.body);if(request.path!=='/api/admin/contacts/'+encodeURIComponent(id)||request.method!=='PUT'||!body.operations||!Number.isSafeInteger(body.expectedRevision))throw new Error('原保存操作无法核对。');uncertainSave={contactId:id,expectedRevision:body.expectedRevision,operations:body.operations};$('[data-contact-save-unknown]').hidden=false;},onChange:event=>{if(event.error?.code==='STALE_ACTOR'){clearPrivateState();return;}if(event.status==='discarded'){uncertainSave=null;$('[data-contact-save-unknown]').hidden=true;}lock();}});void contactDraft.load();
}
function openProfileDraft(){
  profileDraft?.close();profilePending=false;const id=profileContactId,generation=sessionGeneration,form=$('[data-profile-form]'),names=[...EDITABLE_CONTACT_FIELDS,...EDITABLE_CONTACT_ARRAY_FIELDS];
  profileDraft=createOperationsFormDraft({actorId:user.id,roles:user.roles,page:'people',entity:'profile:'+(id||'new'),form,baseRevision:revision,isCurrent:()=>generation===sessionGeneration&&profileContactId===id&&Boolean(user),capture:()=>captureDraftFields(form,names),apply:fields=>{applyDraftFields(form,fields,names);profileDirty=true;form.elements.namedItem('contactConsent').value='unknown';$('[data-profile-duplicates-confirm]').checked=false;syncProfileDuplicates();},manualPending:true,onPending:request=>{const expected='/api/admin/contacts'+(id?'/'+encodeURIComponent(id)+'/profile':'');if(request.path!==expected||request.method!==(id?'PUT':'POST'))throw new Error('原联系人保存操作无法核对。');profilePending=true;},onChange:event=>{if(event.error?.code==='STALE_ACTOR'){clearPrivateState();return;}if(event.status==='discarded')profilePending=false;lock();}});void profileDraft.load();
}
let organizationSelection = parseOrganizationSelection(location.hash);
let pendingContactId=null,pendingContactAction='contact',sessionGeneration=0;
let batchDownloadUrl = null;
const privateExportUrls = new Set();
const contactFragment=location.hash.match(/^#(contact|profile|invitation)=([^&?#]+)$/u);
if(contactFragment){try{const id=decodeURIComponent(contactFragment[2]);if(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(id)){pendingContactId=id;pendingContactAction=contactFragment[1];}}catch{}history.replaceState(null,'',location.pathname+location.search);}
const consentLabels = { unknown: '尚未核实', consented: '已明确同意联络', declined: '不同意联络' };

function matchesSavedInvitation() {
  const invitation = contactById(invitationContactId)?.invitation;
  if (!invitation?.generatedAt || !invitation.settings) return false;
  const current = settingsFromForm();
  return ['recipientName','date','time','venue','confirmed','renderVersion'].every(key => current[key] === invitation.settings[key]);
}
const invitationVersionLabel=settings=>settings?.renderVersion===INVITATION_POSTER_RENDER_VERSION?'新版海报':settings?.renderVersion===undefined?'旧版图片':'未知图片版本';
const dispatchLabel=status=>({prepared:'已准备，未记录发出',manually_sent:'已记录人工发出',provider_accepted:'服务商已接受，未证明送达',issuing:'发送结果待核对，勿重送',unknown:'发送结果待核对，勿重送',rejected:'服务商拒绝发送'})[status]??'状态待核对';
function invitationHistory(item){
  const records=[];
  if(item.invitation?.generatedAt&&item.invitation.settings)records.push({id:'custom',settings:item.invitation.settings,at:item.invitation.generatedAt,label:'自订图片',status:item.invitation.sentGenerationAt===item.invitation.generatedAt&&item.invitation.sentAt?'已记录人工发出':'已生成，未记录本版发出',historySentAt:item.invitation.sentAt&&item.invitation.sentGenerationAt!==item.invitation.generatedAt?item.invitation.sentAt:null});
  for(const entry of intentState?.invitations??[])if(entry.sourceContactId===item.id&&entry.content?.settings)records.push({id:entry.id,settings:entry.content.settings,at:entry.createdAt,label:entry.channel==='manual'?'报名邀请图片':'报名邀请邮件',status:dispatchLabel(entry.status),manual:entry.channel==='manual'});
  return records;
}
function renderInvitationHistory(item){
  const output=$('[data-invitation-history]');output.replaceChildren();const records=invitationHistory(item);$('[data-invitation-history-panel]').hidden=!records.length;
  for(const record of records){const article=node('article');article.dataset.invitationHistoryRow=record.id;article.append(node('strong',record.label+' · '+invitationVersionLabel(record.settings)),node('p',record.status),node('p',[record.settings.recipientName,record.settings.date,record.settings.time,record.settings.venue].join(' · ')),node('small',record.at));if(record.historySentAt)article.append(node('p','另有历史版本人工发出记录：'+record.historySentAt));
    if(record.id==='custom'||record.manual){const button=node('button','下载此版本 PNG','ah-admin-button');button.type='button';button.addEventListener('click',()=>action(()=>downloadSavedInvitation(item,record.settings)));article.append(button);}output.append(article);}
}
function invalidateInvitationPreview(){invitationGeneration++;renderedSettings=null;$('[data-invitation-image]').hidden=true;$('[data-invitation-image]').removeAttribute('src');$('[data-invitation-sent-confirm]').checked=false;const canvas=$('[data-invitation-canvas]');canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);canvas.removeAttribute('data-ready');clearCommunicationPreviews();}
function syncInvitationVersion(){$('[data-invitation-version]').textContent=invitationVersionLabel({...(invitationRenderVersion===undefined?{}:{renderVersion:invitationRenderVersion})})+' · 请核对本次填写';}
async function renderedPng(settings,current){const canvas=document.createElement('canvas');await renderInvitation(canvas,settings);if(!current())throw new Error('当前人员或会话已变化，未提供旧图片。');const blob=await invitationPngBlob(canvas);if(!current()||!blob.size)throw new Error('图片未完成或会话已变化，请重新核对。');return{canvas,blob};}
function downloadPng(blob,settings){const url=URL.createObjectURL(blob),link=node('a');privateExportUrls.add(url);link.href=url;link.download=invitationFilename(settings.recipientName,settings.confirmed).replace(/\.png$/u,settings.renderVersion===INVITATION_POSTER_RENDER_VERSION?'-新版海报.png':'.png');document.body.append(link);link.click();link.remove();setTimeout(()=>{URL.revokeObjectURL(url);privateExportUrls.delete(url);},10000);}
async function downloadSavedInvitation(item,settings){if(!mayInvite(contactById(item.id)))throw new Error(invitationBlockReason(contactById(item.id)));const generation=sessionGeneration,selection=invitationGeneration;const{blob}=await renderedPng(settings,()=>generation===sessionGeneration&&selection===invitationGeneration&&invitationContactId===item.id&&mayInvite(contactById(item.id)));downloadPng(blob,settings);announce('已按保存的版本和活动信息准备下载；没有更新生成或发出记录。');}
function clearCommunicationPreviews() {
  $('[data-wallet-preview]').hidden = true;
  $('[data-email-preview]').hidden = true;
  for (const selector of ['[data-wallet-title]','[data-wallet-name]','[data-wallet-date]','[data-wallet-time]','[data-wallet-location]','[data-wallet-notice]','[data-email-to]','[data-email-subject]','[data-email-text]']) $(selector).textContent = '';
}
function renderCommunicationStatus() {
  const item = contactById(invitationContactId);
  $('[data-wallet-status]').textContent = '这里只生成未签名卡片预览。正式票券配置请到「设置与通知」核对。';
  $('[data-email-status]').textContent = '这里只预览旧版确认信文字，不代表实际寄件服务状态。正式邮件与发送记录请到「设置与通知」核对。';
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
function mayInvite(item) { if(item?.profile.contactConsent!=='consented'||contactDeclined(item)||features.intentInvitations&&!intentState)return false;const progress=contactProgress(item,progressOptions());return !progress.conversion||progress.admissionStatus==='confirmed'; }
function invitationBlockReason(item) { if(features.intentInvitations&&!intentState)return '报名与名额状态暂时无法核对，请刷新后再准备邀请。';if(contactDeclined(item))return '已拒绝联络或出席，不准备或发出邀请。';if(item?.profile.contactConsent!=='consented')return '联络授权尚未核实，暂不能准备邀请。';const progress=contactProgress(item,progressOptions());return progress.admissionStatus==='waitlisted'?'已登记候补，名额尚未确认，暂不准备正式邀请。':progress.inactive?'关联报名已停用，请先核对。':'名额状态尚未核对，确认前不准备正式邀请。'; }
function progressOptions() { return { intent: intentState, content, event: eventConfig }; }
function maySelect(item) { return Boolean(item) && permitted() && !contactDeclined(item) && (mayConvert(item) || mayInvite(item)); }
function clearBatchResult() { if(batchDownloadUrl)URL.revokeObjectURL(batchDownloadUrl);batchDownloadUrl=null;$('[data-batch-download]').hidden=true;$('[data-batch-download]').removeAttribute('href');$('[data-batch-results]').replaceChildren();$('[data-batch-summary]').textContent='';$('[data-batch-panel]').hidden=true; }
function mayConvert(item) { return Boolean(item)&&permitted()&&user.roles.some(role=>['reviewer','superadmin'].includes(role))&&item.profile.contactConsent!=='declined'&&item.operations.responseStatus!=='declined'; }
function requireInviteConsent() { if (!mayInvite(contactById(invitationContactId))) throw new Error(invitationBlockReason(contactById(invitationContactId))); }
function lock() {
  $('[data-contacts-login-submit]').disabled = busy || location.protocol === 'file:';
  for(const button of document.querySelectorAll('.operations-local-draft button'))button.disabled=busy||!permitted();
  for (const field of document.querySelectorAll('[data-contacts-workspace] button,[data-contacts-file]')) field.disabled = busy || !permitted() || field.hasAttribute('data-consent-blocked') || field.hasAttribute('data-role-blocked');
  $('[data-contacts-file]').disabled = busy || !permitted() || !features.contactImport;
  $('[data-profile-fields]').disabled = busy || !permitted() || profilePending || Boolean(profileDraft?.blocked);
  $('[data-profile-save]').disabled = busy || !permitted() || profilePending || Boolean(profileDraft?.blocked) || (!$('[data-profile-duplicates]').hidden && !$('[data-profile-duplicates-confirm]').checked);
  for (const button of document.querySelectorAll('[data-profile-close]')) button.disabled = busy;
  $('[data-contact-save]').disabled = busy || !permitted() || Boolean(uncertainSave) || Boolean(contactDraft?.blocked);
  $('[data-contact-fields]').disabled = busy || !permitted() || Boolean(uncertainSave) || Boolean(contactDraft?.blocked);
  $('[data-contacts-export]').disabled = busy || !permitted() || !features.contactXlsxExport;
  for(const option of document.querySelectorAll('[data-contacts-export-contact],[data-contacts-export-answers]'))option.disabled=busy||!permitted()||!features.contactXlsxExport;
  for (const field of document.querySelectorAll('[data-invitation-form] input,[data-invitation-form] select')) field.disabled = busy || !permitted();
  $('[data-import-confirm]').disabled = busy || !permitted() || !features.contactImport || !importPreview?.canCommit || !$('[data-import-source-confirm]').checked || !!importPreview?.summary.possibleDuplicates && !$('[data-import-duplicates]').checked;
  $('[data-invitation-download]').disabled = busy || !renderedSettings || !mayInvite(contactById(invitationContactId));
  $('[data-invitation-record-sent]').disabled = busy || !$('[data-invitation-sent-confirm]').checked || !matchesSavedInvitation() || !mayInvite(contactById(invitationContactId));
  $('[data-wallet-preview-button]').disabled = busy || !permitted() || !features.communicationsPreview || !mayInvite(contactById(invitationContactId));
  $('[data-email-preview-button]').disabled = busy || !permitted() || !features.communicationsPreview || !mayInvite(contactById(invitationContactId)) || contactById(invitationContactId)?.operations.responseStatus !== 'attending';
  renderCommunicationStatus();
  $('[data-contacts-logout]').disabled = busy;
  $('[data-contacts-convert]').disabled = busy || !permitted() || !user?.roles.some(role=>['reviewer','superadmin'].includes(role)) || !features.intentInvitations || !intentState || selectedContacts.size === 0;
  $('[data-contacts-select-visible]').disabled = busy || !permitted() || !features.intentInvitations || !intentState;
  $('[data-contacts-batch-invite]').disabled = busy || !permitted() || !features.batchInvitations || !intentState || !selectedContacts.size;
  for (const input of document.querySelectorAll('[data-contact-selection]')) input.disabled = busy || !features.intentInvitations || !maySelect(contactById(input.dataset.contactSelection));
  $('[data-contacts-selected]').textContent = '已选 '+selectedContacts.size+' 位';
  for(const key of ['organization','public-role','public-state'])$('[data-contacts-'+key+']').disabled=busy||!permitted()||!relationships;
  const unpublished=$('[data-contacts-public-state] option[value="unpublished"]');unpublished.disabled=!relationships||relationships.publicationAttributionUnavailable;
  $('[data-contact-membership-add]').disabled=busy||!permitted()||!relationships||$('[data-contact-memberships]').children.length>=20||Boolean(uncertainSave);
  $('[data-contact-check-save]').disabled=busy||!permitted()||!uncertainSave;
  $('[data-contacts-sync-attending]').disabled=busy||!permitted()||!user?.roles.some(role=>['reviewer','superadmin'].includes(role))||!intentState||!contacts.some(item=>item.operations.responseStatus==='attending'&&!intentState.conversions?.some(row=>row.sourceContactId===item.id));
  $('[data-conversion-confirm]').disabled=busy||!permitted()||!conversionDraft||conversionDraft.unknown||!conversionDraft.eligibleIds.length;
  for(const button of document.querySelectorAll('[data-conversion-close]'))button.disabled=busy;
}
async function request(path, options = {}) {
  const generation=sessionGeneration;
  const {current=()=>true,...fetchOptions}=options;
  const headers = { Accept: 'application/json' };
  if (options.body) headers['Content-Type'] = 'application/json';
  if (options.method && options.method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15_000);
  let response,result;
  try{
    response=await fetch(path,{...fetchOptions,headers,credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});
    const responseAction=privateResponseAction({requestGeneration:generation,currentGeneration:sessionGeneration,status:response.status,selectionCurrent:current,login:path==='/api/admin/login'});
    if(responseAction==='ignore_session'){response.body?.cancel().catch(()=>{});throw new Error('会话已改变，已忽略旧回应。');}
    if(responseAction==='clear_session'){response.body?.cancel().catch(()=>{});const error=new Error(response.status===401?'工作人员会话已结束，请重新登录。':'此账号没有读取这份私人资料的权限，请重新登录核对。');error.status=response.status;clearPrivateState();announce(error.message,true);throw error;}
    if(responseAction==='ignore_selection'){response.body?.cancel().catch(()=>{});throw new Error('读取对象已改变，已忽略旧回应。');}
    if(!/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type')??''))throw new Error('云端回应格式无法核对。');
    const maximum=path==='/api/admin/contacts'?32*1024*1024:4*1024*1024,declared=response.headers.get('content-length');
    if(declared!==null&&(!/^[0-9]+$/u.test(declared)||Number(declared)>maximum))throw new Error('云端回应超出可核对范围。');
    const reader=response.body?.getReader();if(!reader)throw new Error('云端回应为空。');const chunks=[];let length=0;
    try{while(true){const part=await reader.read();if(part.done)break;if((length+=part.value.length)>maximum)throw new Error('云端回应超出可核对范围。');chunks.push(part.value);}const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}finally{reader.cancel().catch(()=>{});reader.releaseLock();}
    if(generation!==sessionGeneration||!current())throw new Error('会话或读取对象已改变，已忽略旧回应。');
  }finally{clearTimeout(timer);}
  if (!response.ok) {
    if ([401,403].includes(response.status) && path !== '/api/admin/login') clearPrivateState();
    const details = result.error?.fields ? [...new Set(Object.values(result.error.fields))].join(' ') : '';
    const error=new Error(response.status === 409 ? (result.error?.code === 'INVITATION_GENERATION_MISMATCH' ? '邀请函生成记录已变化，请重新生成并下载当前版本，再核对实际发出的版本。' : '名单版本已更新或预览已过期。当前编辑仍保留，请先核对并刷新名单后重试。') : (result.error?.message || '操作未完成，请确认本地服务已启动。') + (details ? ' ' + details : ''));error.status=response.status;throw error;
  }
  return result;
}
async function action(callback) {
  if (busy) return;
  const generation=sessionGeneration;
  busy = true; lock();
  try { await callback(); } catch (error) { if(generation===sessionGeneration)announce(error.message || '操作未完成。', true); }
  finally { if(generation===sessionGeneration){busy = false; lock();if(pendingContactId&&user&&permitted()&&!$('[data-contacts-workspace]').hidden){const id=pendingContactId,kind=pendingContactAction;pendingContactId=null;const contact=contactById(id);if(contact){if(kind==='profile')openProfile(contact);else if(kind==='invitation')openInvitation(contact);else openContact(contact);}else announce('关联人员已不在当前名单中，请核对最新资料。',true);}} }
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
  invitationGeneration++;invitationRenderVersion=undefined;
  profileDraft?.close();profileDraft=null;contactDraft?.close();contactDraft=null;profilePending=false;
  sessionGeneration+=1;
  relationshipSequence+=1;relationships=null;admissionReceipts.clear();operationRevision=null;membershipEdited=false;uncertainSave=null;conversionDraft=null;busy=false;
  for(const url of privateExportUrls)URL.revokeObjectURL(url);privateExportUrls.clear();
  $('[data-contacts-export-contact]').checked=false;$('[data-contacts-export-answers]').checked=false;$('[data-contacts-export-panel]').hidden=true;
  clearBatchResult();
  selectedContacts.clear();intentState=null;visibleContactIds=[];
  user = null; csrfToken = ''; revision = 0; contacts = []; content = null; communications = null; features = { contactImport: false, communicationsPreview: false };
  currentContactId = null; invitationContactId = null; renderedSettings = null; operationsDirty = false;
  clearImport();
  resetProfile();
  $('[data-contacts-import-panel]').hidden = true;
  $('[data-communications-panel]').hidden = true;
  $('[data-communications-panel]').open = false;
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
  for(const selector of ['[data-contacts-organization]','[data-contacts-public-role]','[data-contacts-public-state]'])$(selector).value='';
  const organizationFilter=$('[data-contacts-organization]');organizationFilter.replaceChildren();for(const [value,label]of[['','全部组织关系'],['__none','尚未关联组织']]){const option=node('option',label);option.value=value;organizationFilter.append(option);}organizationSelection=null;
  $('[data-people-relationships-status]').textContent='';$('[data-contact-memberships]').replaceChildren();$('[data-contact-membership-status]').textContent='';$('[data-contact-save-unknown]').hidden=true;
  $('[data-conversion-dialog]').close();$('[data-conversion-entries]').replaceChildren();$('[data-conversion-summary]').textContent='';$('[data-conversion-error]').textContent='';$('[data-conversion-error]').hidden=true;
  $('[data-contact-profile]').replaceChildren();
  $('[data-contact-sessions]').replaceChildren();
  $('[data-contact-booths]').replaceChildren();
  $('[data-contact-form]').reset();
  $('[data-invitation-form]').reset();
  $('[data-invitation-form] [name=recipientName]').value = '';
  $('[data-invitation-panel]').hidden = true;
  $('[data-invitation-version]').textContent='';$('[data-invitation-history]').replaceChildren();$('[data-invitation-history-panel]').hidden=true;$('[data-invitation-history-panel]').open=false;
  clearCommunicationPreviews();
  renderCommunicationStatus();
  const canvas = $('[data-invitation-canvas]');
  canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);
  canvas.removeAttribute('data-ready'); $('[data-invitation-image]').hidden=true; $('[data-invitation-image]').removeAttribute('src');
  $('[data-invitation-caption]').textContent = '选择对象后点击预览，生成专属邀请函。';
  $('[data-contact-error]').textContent = '';
  $('[data-contact-error]').hidden = true;
  if ($('[data-contact-dialog]').open) $('[data-contact-dialog]').close();
  lock();
}
async function loadWorkspace() {
  const generation=sessionGeneration;
  if (!permitted()) throw new Error('此账号没有邀约管理权限，请由维护人员为账号配置 outreach 权限。');
  const state = await request('/api/admin/contacts');
  const program = await request('/api/admin/planning');
  const nextFeatures = { contactImport: program.features?.contactImport === true, communicationsPreview: program.features?.communicationsPreview === true, intentInvitations: program.features?.intentInvitations === true, protectedContactImport: program.features?.protectedContactImport === true, batchInvitations: program.features?.batchInvitations === true, contactXlsxExport: program.features?.contactXlsxExport === true };
  const nextCommunications = nextFeatures.communicationsPreview ? await request('/api/admin/communications') : null;
  const nextIntent = nextFeatures.intentInvitations ? await request('/api/admin/intent-invitations').catch(()=>null) : null;
  const nextRelationships=await loadRelationships();
  if(generation!==sessionGeneration||!permitted())throw new Error('会话已改变，未载入旧私人名单。');
  revision = state.revision; contacts = state.contacts; content = program.content;
  features = nextFeatures; communications = nextCommunications; intentState=nextIntent;
  relationships=nextRelationships;admissionReceipts.clear();organizationSelection=parseOrganizationSelection(location.hash)||organizationSelection;renderRelationshipFilters();
  for(const id of selectedContacts)if(!contacts.some(contact=>contact.id===id))selectedContacts.delete(id);
  $('[data-contacts-conversion-note]').textContent = intentState ? '将已核对的既有意向登记为工作人员代登记，保留原始来源；不会代替申请人的网站隐私同意，也不会自动发送邀请。' : '报名转换服务尚未就绪；现有名单、跟进与现场安排仍可分别维护。';
  $('[data-contacts-import-panel]').hidden = !features.contactImport;
  $('[data-contacts-export-panel]').hidden = !features.contactXlsxExport;
  $('[data-communications-panel]').hidden = !features.communicationsPreview;
  if (!features.contactImport) clearImport();
  $('[data-contacts-login-panel]').hidden = true;
  $('[data-contacts-workspace]').hidden = false;
  $('[data-contacts-account]').hidden = false;
  $('[data-contacts-user]').textContent = user.label || user.id;
  render();
}
async function loadRelationships(){const generation=sessionGeneration,sequence=++relationshipSequence;try{const value=peopleRelationships(await request('/api/admin/people/relationships',{current:()=>sequence===relationshipSequence}));if(generation!==sessionGeneration||sequence!==relationshipSequence)return null;return value;}catch(error){if(generation!==sessionGeneration||sequence!==relationshipSequence)throw error;return null;}}
function renderRelationshipFilters(){
  const select=$('[data-contacts-organization]'),selected=organizationSelection||select.value;select.replaceChildren();
  for(const [value,label]of[['','全部组织关系'],['__none','尚未关联组织'],...(relationships?.organizations??[]).map(row=>[row.id,row.name+(row.status==='withdrawn'?'（已退出）':'')])]){const option=node('option',label);option.value=value;select.append(option);}
  const missing=[...new Set(contacts.flatMap(row=>(row.operations.organizationMemberships??[]).map(link=>link.organizationId)))].filter(id=>!relationships?.organizations.some(row=>row.id===id));if(selected&&!['','__none'].includes(selected)&&!relationships?.organizations.some(row=>row.id===selected)&&!missing.includes(selected))missing.push(selected);
  for(const id of missing){const option=node('option','历史组织 · '+id);option.value=id;select.append(option);}select.value=selected;organizationSelection=null;
  $('[data-people-relationships-status]').dataset.unavailable=String(!relationships);
  $('[data-people-relationships-status]').textContent=!relationships?'组织与公开人物来源暂时无法核对，关系筛选已暂停。现有沟通及已保存组织编号保留，不将读取失败当成「未建立」。':relationships.publicationAttributionUnavailable?'部分旧公开人物无法归属到当前联系人，「尚未发布」筛选暂停；其余明确关系可继续核对。':'按明确人员与组织编号串连；机构文字、内部职责、公开授权及正式名额分别保留。';
}
function today() { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date()); }
function due(item) { return !contactDeclined(item) && !!item.operations.followUpAt && item.operations.followUpAt <= today() && item.operations.responseStatus === 'pending'; }
function invitationState(item) { return invitationProgressLabels[contactProgress(item, progressOptions()).state]; }
function render() {
  const metrics = $('[data-contacts-metrics]'); metrics.replaceChildren();
  const summary = summarizeContactProgress(contacts, progressOptions());
  const formal=contacts.map(item=>admissionForContact(item,intentState));
  for (const [label, count] of [['对象总数',contacts.length],['本人已答应参加',contacts.filter(item=>item.operations.responseStatus==='attending').length],['本名单正式名额',intentState?formal.filter(row=>row.status==='confirmed').length:'待核对'],['本名单候补',intentState?formal.filter(row=>row.status==='waitlisted').length:'待核对'],['跟进已到期',contacts.filter(due).length]]) {
    const card=node('article');card.append(node('span',label),node('strong',String(count)));metrics.append(card);
  }
  $('[data-contacts-progress-note]').textContent = '本人回复与正式名额分别统计；共同 300 人总数以报名审核后台为准。'+(features.intentInvitations&&!intentState?'正式名额来源暂时无法读取，不能据此判断为零。':'拒绝出席后的正式名额须到报名审核明确撤回，回复变更不会自行释放。')+'当前版人工发出 '+summary.manuallySent+' 位，服务商接受 '+summary.providerAccepted+' 位，结果待核对 '+summary.unknown+' 位；接受不等于送达。';
  const ownerSelect = $('[data-contacts-owner]'), previousOwner = ownerSelect.value;
  ownerSelect.replaceChildren();for(const [value,label] of [['','全部负责同事'],['__unassigned','尚未分配负责人'],...[...new Set(contacts.map(item=>item.operations.owner).filter(Boolean))].sort().map(value=>[value,value])]){const option=node('option',label);option.value=value;ownerSelect.append(option);}ownerSelect.value=previousOwner;
  $('[data-contacts-planning]').textContent='原问卷意向：自报 SO / RO '+contacts.filter(item=>(item.sourceProfile??item.profile).categories.some(value=>['so','ro'].includes(value))).length+' 位，筹备新站点 '+contacts.filter(item=>(item.sourceProfile??item.profile).categories.includes('prospective_site')).length+' 位，展示意向 '+contacts.filter(item=>item.profile.interests.includes('exhibition')).length+' 位，需要住宿 '+contacts.filter(item=>item.profile.accommodationIntent==='needed').length+' 位；同意联络 '+contacts.filter(item=>item.profile.contactConsent==='consented'&&!contactDeclined(item)).length+' 位。意向不代表安排已确认。';
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
    const progressMatches={unconverted:!progress.excluded&&Boolean(intentState)&&!progress.conversion,unreplied:!progress.excluded&&progress.response==='pending'&&progress.contacted,unassigned:!progress.excluded&&!progress.inactive&&!progress.admissionPending&&progress.response==='attending'&&progress.missingAssignment,unsent:!progress.excluded&&!progress.inactive&&!progress.admissionPending&&progress.consented&&!progress.contacted&&!progress.unknown,excluded:progress.excluded,manually_sent:progress.manuallySent,provider_accepted:progress.providerAccepted,unknown:progress.unknown,stale:progress.state==='stale',waitlisted:progress.admissionStatus==='waitlisted',pending_review:progress.admissionStatus==='pending_review',rejected:progress.admissionStatus==='rejected',admission_unknown:progress.admissionStatus==='unknown'};
    const matchesProgress=!progressFilter||progressMatches[progressFilter]===true;
    return matchesPeopleRelationships(item,relationships,{organization:$('[data-contacts-organization]').value,publicRole:$('[data-contacts-public-role]').value,publicState:$('[data-contacts-public-state]').value})&&matchesOwner&&matchesProgress&&matchesParticipation&&matchesArrangement&&(!search||[p.name,p.displayName,p.organization,p.city,p.email,p.wechat].some(value=>value.toLowerCase().includes(search)))&&(!response||item.operations.responseStatus===response)&&(!onlyDue||due(item))&&(!type||(type.startsWith('category:')?p.categories.includes(type.slice(9)):type.startsWith('source-category:')?(item.sourceProfile??p).categories.includes(type.slice(16)):p.interests.includes(type.slice(9))));
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
    if(JSON.stringify(item.profile.categories)!==JSON.stringify((item.sourceProfile??item.profile).categories))tags.append(node('small','原始身份：'+((item.sourceProfile??item.profile).categories.map(value=>categoryLabels.get(value)||value).join('、')||'未记录')));
    for(const value of item.profile.interests)tags.append(node('span',interestLabels.get(value)||value,'contacts-tag'));
    if(!tags.childNodes.length)tags.append(node('small','未记录'));
    row.append(tags);
    const invitation=node('td',invitationState(item));const progress=contactProgress(item,progressOptions());if(progress.manuallySent&&progress.providerAccepted)invitation.append(node('small','服务商也已接受 · 未证明送达'));if(progress.unknown&&progress.state!=='unknown')invitation.append(node('small','另有发送结果待核对 · 勿重复发送'));if(progress.stale)invitation.append(node('small','另有历史版本记录，不计入当前版发出'));if(item.invitation.generatedAt)invitation.append(node('small',invitationVersionLabel(item.invitation.settings)+' · '+(item.invitation.settings?.confirmed?'正式版':'暂定版')));if(progress.historyManuallySent)invitation.append(node('small','历史版本已记录人工发出'));if(progress.historyProviderAccepted)invitation.append(node('small','历史邮件服务商已接受，未证明送达'));const versions=invitationHistory(item);if(versions.length){const history=node('details',undefined,'contacts-version-history');history.dataset.invitationVersionHistory=item.id;history.append(node('summary','版本与发出记录（'+versions.length+'）'));for(const entry of versions)history.append(node('small',invitationVersionLabel(entry.settings)+' · '+entry.status+' · '+entry.settings.date+' '+entry.settings.time+' · '+entry.settings.venue));invitation.append(history);}
    const linked=intentState?.conversions?.find(value=>value.sourceContactId===item.id);
    if(linked){const link=node('a','已代登记 · 查看报名');link.href='/admin/registrations/#registration='+encodeURIComponent(linked.registrationId);invitation.append(link);}
    row.append(invitation);
    const follow=node('td',item.operations.owner||'待分配');follow.append(node('small',item.operations.followUpAt||'未安排跟进日期'));if(item.operations.priority==='high')follow.append(node('small','优先跟进'));row.append(follow);
    const reply=node('td',responses[item.operations.responseStatus]),admission=admissionForContact(item,intentState,admissionReceipts);reply.append(node('small',ADMISSION_LABELS[admission.status]));if(admission.registrationId){const link=node('a',admission.status==='withdrawn'?'前往审核／撤回记录':'查看正式报名');link.href='/admin/registrations/#registration='+encodeURIComponent(admission.registrationId);reply.append(link);}if(item.operations.responseStatus==='declined'&&admission.status==='confirmed')reply.append(node('small','本人不出席，原名额仍在；请明确撤回。','people-relationship-warning'));row.append(reply);
    const participationCell=node('td',undefined,'contacts-participation-cell');
    for(const value of item.operations.participationForms??[])participationCell.append(node('span',participationLabels.get(value)||value,'contacts-tag'));
    if(!participationCell.childNodes.length)participationCell.append(node('small','尚未标记'));
    participationCell.dataset.contactRelationships=item.id;renderContactRelationships(participationCell,item);
    row.append(participationCell);
    const arrangements=node('td',undefined,'contacts-arrangements');
    for(const [key,list] of [['sessionIds',content.sessions],['boothIds',content.booths]])for(const id of item.operations[key]){
      const record=list.find(entry=>entry.id===id);
      const warning=!record||record.status==='cancelled';
      const label=!record?(key==='sessionIds'?'场次已删除 · 请核对':'展位已删除 · 请核对'):key==='sessionIds'?record.start+'–'+record.end+' / '+record.zone+'区 · '+record.title:record.code+' / '+record.zone+'区 · '+(record.organization||'待确认');
      const duties=key==='sessionIds'?(item.operations.sessionRoles??[]).find(entry=>entry.sessionId===id)?.roles??[]:[];
      arrangements.append(node('span',label+(duties.length?' · 本场：'+duties.map(role=>SESSION_ROLE_LABELS[role]||role).join('、'):'')+(record?.status==='cancelled'?'（已取消）':''),'contacts-tag'+(warning?' contacts-tag-warning':'')));
    }
    if(!arrangements.childNodes.length)arrangements.append(node('small','尚未安排'));
    row.append(arrangements);
    const actions=node('td',undefined,'contacts-row-actions');const person=node('a','个人工作页','ah-admin-button');person.href='/admin/person/#contact='+encodeURIComponent(item.id);person.dataset.personWorkspaceLink='';actions.append(person);for(const [text,handler]of[['编辑资料',()=>openProfile(item)],['详情与安排',()=>openContact(item)],['邀请函',()=>openInvitation(item)]]){const button=node('button',text);button.type='button';if(text==='邀请函'&&!mayInvite(item)){button.textContent=features.intentInvitations&&!intentState?'名额暂无法核对':progress.admissionPending?'名额待确认':progress.inactive?'报名已停用':'联络未获同意';button.title=invitationBlockReason(item);button.dataset.consentBlocked='true';button.disabled=true;}button.addEventListener('click',handler);actions.append(button);}const guest=node('button','管理嘉宾资料');guest.type='button';
    if(!user.roles.includes('editor')||!mayInvite(item)||!['pending','attending'].includes(item.operations.responseStatus)){guest.dataset.roleBlocked='true';guest.title=!user.roles.includes('editor')?'同时需要活动编辑权限':!mayInvite(item)?invitationBlockReason(item):'对象已回复不出席；请先核对最新实际回复';}
    guest.addEventListener('click',()=>{if(busy||!permitted()||!user.roles.includes('editor')||!mayInvite(item)||!['pending','attending'].includes(item.operations.responseStatus))return;location.assign('/admin/#invitee='+encodeURIComponent(item.id));});actions.append(guest);
    if(linked){
      const prepare=node('button',mayInvite(item)?'准备新版报名邀请':progress.admissionPending?'名额待确认 · 暂不准备正式邀请':'报名邀请暂不可用');prepare.type='button';prepare.dataset.registrationInvitationPoster=item.id;if(!mayInvite(item)){prepare.dataset.roleBlocked='true';prepare.title=invitationBlockReason(item);}prepare.addEventListener('click',()=>action(()=>prepareRegistrationInvitation(item,linked,'manual',INVITATION_POSTER_RENDER_VERSION)));actions.append(prepare);
      const email=node('button','邮件发送报名邀请');email.type='button';
      if(!mayInvite(item)){email.dataset.roleBlocked='true';email.textContent='名额或授权待核对 · 不发送邀请';email.title=invitationBlockReason(item);}else if(!intentState?.email?.ready){email.dataset.roleBlocked='true';email.title='寄件服务尚未配置，无法发送邮件';}
      email.addEventListener('click',()=>action(()=>prepareRegistrationInvitation(item,linked,'email')));actions.append(email);
      const manual=[...(intentState.invitations??[])].reverse().find(value=>value.sourceContactId===item.id&&value.channel==='manual');
      if(manual){const state=node('small',({prepared:'报名邀请已准备，未记录发出',manually_sent:'报名邀请已记录人工发出',provider_accepted:'服务商已接受发送',unknown:'发送结果不明，勿重复发送',rejected:'服务商拒绝发送'})[manual.status]||'邀请状态待核对');actions.append(state);if(manual.status==='prepared'&&mayInvite(item)){const sent=node('button','记录'+invitationVersionLabel(manual.content?.settings)+'报名邀请已发出');sent.type='button';sent.addEventListener('click',()=>action(async()=>{const named=prompt('确认已经实际发出后，填写实际渠道：微信、邮件或其他。此操作只记录，不发送消息。');const channel=({微信:'wechat',邮件:'email',其他:'other'})[named?.trim()];if(!channel)return;await request('/api/admin/intent-invitations/'+encodeURIComponent(manual.id)+'/manual-sent',{method:'POST',body:JSON.stringify({channel})});intentState=await request('/api/admin/intent-invitations');render();announce('已记录报名邀请经'+named.trim()+'人工发出；没有自动确认对方出席。');}));actions.append(sent);}}
    }
    row.append(actions);
    ['对象','原始身份与意向','邀请函 / 发出记录','跟进','回复与正式名额','身份与组织','现场安排','操作'].forEach((label,index)=>{row.children[index].dataset.label=label;});body.append(row);
  }
  $('[data-contacts-empty]').hidden=matches.length>0;
  $('[data-contacts-empty]').textContent=contacts.length?'没有符合筛选条件的对象。':'目前没有对象，可手动新增联系人。'+(features.contactImport?'也可导入并核对名单。':'');
  $('[data-contacts-result-count]').textContent='显示 '+matches.length+' / '+contacts.length+' 位';
  lock();
}
async function prepareRegistrationInvitation(item,linked,channel,renderVersion){
  if(!features.intentInvitations||!intentState)throw new Error('报名邀请服务尚未就绪。');
  if(!mayInvite(item))throw new Error(invitationBlockReason(item));
  const generation=sessionGeneration,selection=invitationGeneration;
  if(channel==='manual'&&renderVersion===INVITATION_POSTER_RENDER_VERSION){const settings=buildPosterInvitationSettings(item.profile.displayName,eventConfig);if(!confirm('使用本次活动信息准备新版图片：'+settings.date+' '+settings.time+' · '+settings.venue+'。仅准备下载，不会发送邮件或记录已发出。继续？'))return;}
  if(channel==='email'&&!confirm('确认现在向 '+item.profile.displayName+' 发送这份报名邀请邮件？服务商接受不等于送达；结果不明时不要重复发送。'))return;
  const result=await request('/api/admin/contacts/'+encodeURIComponent(item.id)+'/invitation',{method:'POST',body:JSON.stringify({expectedContactRevision:revision,channel,expectedRegistrationId:linked.registrationId,...(channel==='manual'&&renderVersion!==undefined?{renderVersion}:{}),...(channel==='email'?{confirmEmail:true}:{})})});
  if(generation!==sessionGeneration)return;
  const invitation=result.invitation;
  if(channel==='manual'){
    const settings=invitation?.content?.settings;if(!settings||settings.renderVersion!==renderVersion)throw new Error('邀请版本未能核对，请刷新后查看保存记录。');
    const {blob}=await renderedPng(settings,()=>generation===sessionGeneration&&selection===invitationGeneration&&mayInvite(contactById(item.id)));downloadPng(blob,settings);
    announce(invitationVersionLabel(settings)+'报名邀请 PNG 已准备并开始下载。尚未发出；实际发送后再记录渠道。');
  }else announce(invitation?.status==='provider_accepted'?'邮件服务商已接受发送请求，尚无送达证明。':invitation?.status==='unknown'?'邮件结果尚未确认，系统不会自动重送；请先人工核对。':'邮件未确认发送成功，请核对服务状态。',invitation?.status!=='provider_accepted');
  const next=await request('/api/admin/intent-invitations');if(generation!==sessionGeneration)return;intentState=next;render();
}

function detailPair(dl,label,value){if(!value)return;dl.append(node('dt',label),node('dd',value));}
function renderContactRelationships(output,item){
  const related=relationshipForContact(item,relationships);
  if(!related.available){output.append(node('small','公开身份与组织目录待核对','people-relationship-warning'));for(const row of related.memberships)output.append(node('small','已保存组织编号：'+row.organizationId));return;}
  for(const profile of related.profiles){output.append(node('small','公开职责：'+(profile.publicRoles.map(role=>PUBLIC_ROLE_LABELS[role]).join('、')||'尚未标记')));output.append(node('small',[profile.publicConsent?'已记录公开授权':'公开授权待核对',profile.hasPortrait?'已有照片':'照片待补',profile.published?profile.publishedMatchesDraft?'当前资料已发布':'资料有历史公开版本，当前人员关联及内容待核对':related.publicationKnown?'尚未发布':'公开归属待核对'].join(' · ')));}
  if(!related.profiles.length)output.append(node('small','尚未关联人物资料'));
  for(const member of related.memberships){const line=node('small',member.name+' · '+(member.role==='lead'?'负责人':'成员')+(member.title?' · '+member.title:'')+(member.state==='missing'?'（组织已失效，保留关联）':member.state==='withdrawn'?'（组织已退出）':''),member.state!=='available'?'people-relationship-warning':undefined);output.append(line);if(user?.roles.includes('editor')&&member.state!=='missing'){const link=node('a','查看组织','people-profile-link');link.href='/admin/#organization='+encodeURIComponent(member.organizationId);output.append(link);}}
  if(!related.memberships.length)output.append(node('small','尚未关联组织'));
}
function membershipRow(member={organizationId:'',role:'member',title:''}){
  const output=$('[data-contact-memberships]');if(output.children.length>=20)return;
  const row=node('div',undefined,'people-membership-row');row.dataset.contactMembershipRow='';
  const organizationLabel=node('label','组织'),organization=node('select');organization.name='organizationId';organization.required=true;
  const empty=node('option','请选择已保存组织');empty.value='';organization.append(empty);
  for(const item of relationships?.organizations??[]){const option=node('option',item.name+(item.status==='withdrawn'?'（已退出）':''));option.value=item.id;option.disabled=item.status==='withdrawn'&&item.id!==member.organizationId;organization.append(option);}
  if(member.organizationId&&!relationships?.organizations.some(item=>item.id===member.organizationId)){const option=node('option','历史组织 · '+member.organizationId);option.value=member.organizationId;organization.append(option);row.append(node('p','原组织已失效，关联仍保留；请核对后明确移除。','people-relationship-warning'));}
  organization.value=member.organizationId;organizationLabel.append(organization);
  const roleLabel=node('label','关系'),role=node('select');role.name='role';for(const [value,label]of[['member','成员'],['lead','负责人']]){const option=node('option',label);option.value=value;role.append(option);}role.value=member.role;roleLabel.append(role);
  const titleLabel=node('label','组织内职务／说明（内部）'),title=node('input');title.name='title';title.maxLength=120;title.value=member.title;titleLabel.append(title);
  const remove=node('button','解除这项关联','ah-admin-button');remove.type='button';remove.dataset.contactMembershipRemove='';remove.addEventListener('click',()=>{if(busy||uncertainSave)return;row.remove();membershipEdited=true;operationsDirty=true;contactDraft?.schedule();lock();});
  row.addEventListener('input',()=>{membershipEdited=true;operationsDirty=true;});row.addEventListener('change',()=>{membershipEdited=true;operationsDirty=true;});row.append(organizationLabel,roleLabel,titleLabel,remove);output.append(row);
}
function membershipValues(){return organizationMemberships([...$('[data-contact-memberships]').children].map(row=>({organizationId:row.querySelector('[name="organizationId"]').value,role:row.querySelector('[name="role"]').value,title:row.querySelector('[name="title"]').value.normalize('NFC').trim()})));}
function openContact(item){
  if(busy||!permitted())return;
  currentContactId=item.id;operationsDirty=false;
  operationRevision=revision;membershipEdited=false;uncertainSave=null;$('[data-contact-save-unknown]').hidden=true;
  $('[data-contact-title]').textContent=item.profile.displayName+' · 跟进与安排';
  const profile=$('[data-contact-profile]');const dl=node('dl');
  const p=item.profile;
  for(const [label,value]of[['机构 / 职务',[p.organization,p.position].filter(Boolean).join(' · ')],['城市',p.city],['邮箱',p.email],['微信',p.wechat],['当前身份',p.categories.map(value=>categoryLabels.get(value)||value).join('、')||'未标记'],['原始身份（只读）',(item.sourceProfile??p).categories.map(value=>categoryLabels.get(value)||value).join('、')||'未记录'],['参与意向',p.interests.map(value=>interestLabels.get(value)||value).join('、')],['背景与经验',p.background],['关注主题',p.topics],['网站 / 作品',[p.website,p.caseLinks].filter(Boolean).join('\n')],['原出席意向',p.attendanceIntentLabel||'源选项码 '+(p.attendanceIntentCode||'未填')+'（待核对）'],['原住宿意向',p.accommodationIntentLabel||'源选项码 '+(p.accommodationIntentCode||'未填')+'（待核对）'],['原联络同意',p.contactConsentLabel||'源选项码 '+(p.contactConsentCode||'未填')+'（待核对）'],['原未来合作',p.futureCooperationLabel||'源选项码 '+(p.futureCooperationCode||'未填')+'（待核对）'],['原提交时间',p.submittedAt]])detailPair(dl,label,value);
  detailPair(dl,'电话',p.phone);detailPair(dl,'站点 / 职务',[p.siteName,p.siteRole].filter(Boolean).join(' · '));
  detailPair(dl,'联络许可',consentLabels[p.contactConsent]||consentLabels.unknown);
  detailPair(dl,'来源',item.source.key==='manual'?'工作人员手动新增':'问卷导入 · 来源序号 '+item.source.rowId);
  profile.replaceChildren(dl);
  const linked=intentState?.conversions?.find(value=>value.sourceContactId===item.id);
  if(linked){const link=node('a','查看已关联报名 · '+linked.referenceCode,'ah-admin-button');link.href='/admin/registrations/#registration='+encodeURIComponent(linked.registrationId);profile.append(link);}
  if(item.sourceProfile){const original=node('details');original.append(node('summary','查看原始来源基本资料（只读）'));const source=node('dl');for(const key of EDITABLE_CONTACT_FIELDS)if(item.sourceProfile[key]&&item.sourceProfile[key]!==p[key])detailPair(source,key,item.sourceProfile[key]);if(!source.childNodes.length)source.append(node('dd','基本资料与原始来源一致。'));original.append(source);profile.append(original);}
  const form=$('[data-contact-form]');form.reset();
  $('[data-contact-memberships]').replaceChildren();
  if(relationships)for(const member of item.operations.organizationMemberships??[])membershipRow(member);
  $('[data-contact-membership-status]').textContent=relationships?'选择或移除关系后，连同下方跟进一起保存。':'组织目录暂时无法核对；此次保存保留原组织关联。请重新读取后再调整。';
  for(const key of ['owner','priority','followUpAt','notes','responseStatus'])form.elements.namedItem(key).value=item.operations[key];
  for(const input of form.querySelectorAll('[name=participationForms]'))input.checked=(item.operations.participationForms??[]).includes(input.value);
  for(const [key,list,target]of[['sessionIds',content.sessions,'[data-contact-sessions]'],['boothIds',content.booths,'[data-contact-booths]']]){
    const holder=$(target);holder.replaceChildren();
    for(const record of list){
      const choice=node('div',undefined,'contacts-session-choice'),label=node('label'),input=node('input');
      input.type='checkbox';input.name=key;input.value=record.id;input.checked=record.status!=='cancelled'&&item.operations[key].includes(record.id);input.disabled=record.status==='cancelled';
      label.append(input,document.createTextNode(key==='sessionIds'?record.start+'–'+record.end+' / '+record.zone+' 区 · '+record.title+(record.status==='cancelled'?'（已取消）':''):record.code+' · '+(record.organization||'待确认')+' · '+(record.project||'待确认')));choice.append(label);
      if(key==='sessionIds'&&record.status!=='cancelled'){
        const duties=node('fieldset',undefined,'contacts-session-roles');duties.dataset.sessionRoles=record.id;duties.append(node('legend','这场的职责（可多选）'));
        const selected=(item.operations.sessionRoles??[]).find(entry=>entry.sessionId===record.id)?.roles??[];
        for(const role of SESSION_ROLES){const roleLabel=node('label'),box=node('input');box.type='checkbox';box.name='sessionRoles:'+record.id;box.value=role;box.checked=selected.includes(role);roleLabel.append(box,document.createTextNode(SESSION_ROLE_LABELS[role]));duties.append(roleLabel);}
        const sync=()=>{duties.disabled=!input.checked;duties.hidden=!input.checked;};input.addEventListener('change',sync);sync();choice.append(duties);
      }
      holder.append(choice);
    }
    const missing=item.operations[key].filter(id=>!list.some(record=>record.id===id));
    if(item.operations[key].some(id=>list.some(record=>record.id===id&&record.status==='cancelled')))holder.append(node('p','原安排含已取消项目。本次保存将移除该关联，请核对。','contacts-empty-hint'));
    if(missing.length)holder.append(node('p','有 '+missing.length+' 条原安排已删除，请核对后重新选择。','contacts-empty-hint'));
    if(!list.length)holder.append(node('p',key==='boothIds'?'请先到活动 / 嘉宾安排建立展位，再为对象安排出席展位。':'暂无可安排场次。','contacts-empty-hint'));
  }
  $('[data-contact-error]').hidden=true;$('[data-contact-error]').textContent='';
  $('[data-contact-dialog]').showModal();
  openContactDraft();lock();
}
async function closeContact(){if(busy)return;const generation=sessionGeneration;if((operationsDirty||uncertainSave)&&!confirm('关闭表单并保留本机草稿及待核对操作？'))return;if(operationsDirty&&!contactDraft?.blocked&&!uncertainSave)await contactDraft?.flush().catch(()=>{});if(generation!==sessionGeneration)return;contactDraft?.close();contactDraft=null;operationsDirty=false;uncertainSave=null;operationRevision=null;membershipEdited=false;$('[data-contact-save-unknown]').hidden=true;$('[data-contact-dialog]').close();$('[data-contact-form]').reset();$('[data-contact-profile]').replaceChildren();$('[data-contact-memberships]').replaceChildren();}
function updateContact(result){revision=result.revision;const exists=contacts.some(item=>item.id===result.contact.id);contacts=exists?contacts.map(item=>item.id===result.contact.id?result.contact:item):[...contacts,result.contact];render();}
function resetProfile(){
  profileDraft?.close();profileDraft=null;profilePending=false;
  profileContactId=null;profileDirty=false;
  const dialog=$('[data-profile-dialog]');if(dialog.open)dialog.close();
  $('[data-profile-form]').reset();$('[data-profile-title]').textContent='新增联系人';
  $('[data-profile-source]').textContent='';$('[data-profile-error]').textContent='';$('[data-profile-error]').hidden=true;
  $('[data-profile-duplicates]').hidden=true;$('[data-profile-duplicate-message]').textContent='';
  $('[data-profile-consent-readonly]').textContent='';
  $('[data-profile-original-categories]').textContent='';
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
  for(const input of form.querySelectorAll('[name=categories]'))input.checked=(item?.profile.categories??[]).includes(input.value);
  $('[data-profile-original-categories]').textContent=item?'原始身份（只读）：'+((item.sourceProfile??item.profile).categories.map(value=>categoryLabels.get(value)||value).join('、')||'未记录'):'';
  $('[data-profile-title]').textContent=item?'编辑联系人基本资料':'新增联系人';
  $('[data-profile-source]').textContent=item?(item.source.key==='manual'?'工作人员手动新增。基本资料修正不会改变原联络同意或跟进记录。':'问卷导入。可修正基本资料与当前身份；原始身份、来源答案与联络同意保留。'):'手动录入仅保存在私有人员工作区；不自动获邀或公开。';
  $('[data-profile-consent-field]').hidden=Boolean(item);
  form.elements.namedItem('contactConsent').disabled=Boolean(item);
  $('[data-profile-consent-readonly]').hidden=!item;
  $('[data-profile-consent-readonly]').textContent=item?'已记录的联络许可（只读）：'+(consentLabels[item.profile.contactConsent]||consentLabels.unknown):'';
  syncProfileDuplicates();$('[data-profile-dialog]').showModal();openProfileDraft();
}
async function closeProfile(){
  if(busy)return;const generation=sessionGeneration;
  if(profileDirty&&!confirm('关闭表单并保留本机草稿？'))return;
  if(profileDirty&&!profileDraft?.blocked&&!profilePending)await profileDraft?.flush().catch(()=>{});if(generation!==sessionGeneration)return;resetProfile();lock();
}
function openInvitation(item){
  if(busy||!permitted())return;
  if(!mayInvite(item)){announce(invitationBlockReason(item),true);return;}
  invitationContactId=item.id;invalidateInvitationPreview();
  const form=$('[data-invitation-form]');form.reset();
  const settings=item.invitation.settings||{recipientName:item.profile.displayName,date:eventConfig.date.value,time:eventConfig.time.label,venue:eventConfig.venue.address,confirmed:false};
  for(const key of ['recipientName','date','time','venue'])form.elements.namedItem(key).value=settings[key];
  form.elements.namedItem('confirmed').checked=settings.confirmed===true;invitationRenderVersion=settings.renderVersion;syncInvitationVersion();renderInvitationHistory(item);
  $('[data-invitation-sent-confirm]').checked=false;
  const canvas=$('[data-invitation-canvas]');canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);canvas.removeAttribute('data-ready');$('[data-invitation-image]').hidden=true;$('[data-invitation-image]').removeAttribute('src');
  $('[data-invitation-caption]').textContent=item.profile.displayName+' · '+invitationState(item);
  $('[data-invitation-panel]').hidden=false;
  $('[data-invitation-panel]').scrollIntoView({behavior:'smooth',block:'start'});lock();
}
function settingsFromForm(){const form=$('[data-invitation-form]');return{recipientName:form.elements.namedItem('recipientName').value.trim(),date:form.elements.namedItem('date').value,time:form.elements.namedItem('time').value.trim(),venue:form.elements.namedItem('venue').value.trim(),confirmed:form.elements.namedItem('confirmed').checked,...(invitationRenderVersion===undefined?{}:{renderVersion:invitationRenderVersion})};}

$('[data-contacts-login]').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;if(!form.reportValidity())return;action(async()=>{let result;try{result=await request('/api/admin/login',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});}finally{form.elements.namedItem('password').value='';}user=result.user;csrfToken=result.csrfToken;$('[data-contacts-account]').hidden=false;$('[data-contacts-user]').textContent=user.label||user.id;await loadWorkspace();announce('已登录。名单和联系方式仅在此私有工作区显示。');});});
$('[data-contacts-logout]').addEventListener('click',()=>action(async()=>{if((operationsDirty||profileDirty)&&!confirm('退出并清除本机草稿？'))return;const actorId=user?.id;profileDraft?.close();contactDraft?.close();try{if(actorId)await operationsDraftStore().clearActor(actorId);}finally{try{await request('/api/admin/logout',{method:'POST'});}finally{clearPrivateState();}}announce('已退出，本机填写与名单预览已清空。');}));
$('[data-contacts-refresh]').addEventListener('click',()=>action(async()=>{if((operationsDirty||profileDirty)&&!confirm('有未保存的修改，刷新将放弃这些修改。继续刷新吗？'))return;if(operationsDirty&&!contactDraft?.blocked&&!uncertainSave)await contactDraft?.flush().catch(()=>{});if(profileDirty&&!profileDraft?.blocked&&!profilePending)await profileDraft?.flush().catch(()=>{});contactDraft?.close();contactDraft=null;operationsDirty=false;resetProfile();if($('[data-contact-dialog]').open)$('[data-contact-dialog]').close();await loadWorkspace();clearImport();announce('已载入最新名单。');}));
$('[data-contacts-select-visible]').addEventListener('click',()=>{for(const id of visibleContactIds)selectedContacts.add(id);render();});
$('[data-contacts-clear-selection]').addEventListener('click',()=>{selectedContacts.clear();render();});
$('[data-contacts-batch-invite]').addEventListener('click',()=>action(async()=>{
  if(!features.batchInvitations||!intentState||!selectedContacts.size)throw new Error('请先选择已核对的对象。');
  if(selectedContacts.size>100)throw new Error('每次最多准备 100 位，请分批核对。');
  const generation=sessionGeneration,selection=invitationGeneration,contactIds=[...selectedContacts],expectedContactRevision=revision;
  const {previewBatchInvitations,prepareBatchInvitations}=await import('../lib/invitation-batch.mjs');
  const renderVersion=INVITATION_POSTER_RENDER_VERSION;const preview=await previewBatchInvitations({contactIds,expectedContactRevision,request,renderVersion});
  if(generation!==sessionGeneration||selection!==invitationGeneration)throw new Error('会话或页面已改变，未继续准备邀请。');
  clearBatchResult();$('[data-batch-panel]').hidden=false;
  for(const entry of preview.entries){const item=contactById(entry.contactId);$('[data-batch-results]').append(node('li',(item?.profile.displayName||'所选对象')+' · '+(entry.eligible?'可准备邀请':'跳过：'+batchReason(entry.reason))));}
  $('[data-batch-summary]').textContent='预检 '+preview.summary.selected+' 位，可准备 '+preview.summary.eligible+' 位，跳过 '+preview.summary.skipped+' 位。';
  if(!preview.summary.eligible){announce('本次没有符合条件的邀请，未准备或发送任何消息。');return;}
  const facts=buildPosterInvitationSettings(contactById(contactIds[0]).profile.displayName,eventConfig);if(!confirm('已预检新版邀请：可准备 '+preview.summary.eligible+' 位，跳过 '+preview.summary.skipped+' 位。使用 '+facts.date+' '+facts.time+' · '+facts.venue+' 准备新版具名邀请与 ZIP？仅准备、下载；旧已发出与结果不明者跳过。'))return;
  const result=await prepareBatchInvitations({contactIds,expectedContactRevision,previewToken:preview.previewToken,request,renderVersion:preview.renderVersion,
    renderInvitation:async invitation=>{const{blob}=await renderedPng(invitation.content.settings,()=>generation===sessionGeneration&&selection===invitationGeneration&&permitted());return blob;},
    onProgress:progress=>{if(generation===sessionGeneration)$('[data-batch-summary]').textContent=typeof progress==='string'?progress:'正在准备本次邀请 ZIP，请保留此页。';}});
  if(generation!==sessionGeneration||selection!==invitationGeneration)throw new Error('会话或页面已改变，未提供私有下载。');
  $('[data-batch-results]').replaceChildren();
  for(const entry of result.results??[]){const item=contactById(entry.contactId);const label=({prepared:'已准备，尚未发出',replayed:'沿用已保存版本，未重复准备',skipped:'已跳过',failed:'未完成',unknown:'结果不明，先核对勿重试'})[entry.status]||'待核对';$('[data-batch-results]').append(node('li',(item?.profile.displayName||'所选对象')+' · '+label+(entry.pngStatus==='failed'?' · 图片未完成，ZIP 中仅保留结果记录':'')+(entry.code?' · '+batchReason(entry.code):'')));}
  if(result.blob?.size){batchDownloadUrl=URL.createObjectURL(result.blob);const download=$('[data-batch-download]');download.href=batchDownloadUrl;download.download=result.fileName;download.hidden=false;}
  $('[data-batch-summary]').textContent=result.blob?.size?'本次 ZIP 已准备，可点击下载。实际生成 '+(result.summary?.pngCreated??0)+' 张图片'+(result.summary?.pngFailed?'，另有 '+result.summary.pngFailed+' 张图片未完成':'')+'；请逐人核对发送清单，下载不会记录已发出。':'本次没有可供下载的邀请。请按逐人结果核对，勿自动重试结果不明的对象。';
  try{intentState=await request('/api/admin/intent-invitations');render();}catch{announce('邀请结果已保留在本页，最新进度读取未完成。请下载后刷新核对，勿重复发送。',true);return;}
  announce('批量准备结束，逐人结果已列出。没有发送邀请或确认任何人出席。');
}));
function batchReason(code){return ({CONTACT_DECLINED:'已拒绝联络或出席',CONTACT_NOT_CONSENTED:'联络授权尚未核实',REGISTRATION_REQUIRED:'尚未代登记',REGISTRATION_INACTIVE:'报名已停用或名额待核对',ADMISSION_REQUIRED:'名额尚未确认',INVITATION_DISPATCH_RECORDED:'已有发出或服务商接受记录，不重复准备',INVITATION_STATUS_UNKNOWN:'发送结果不明，先核对勿重试',INVITATION_CHANGED:'邀请版本已变化，请核对',REVISION_CONFLICT:'名单版本已更新',STORAGE_UNAVAILABLE:'保存结果待核对'})[code]||'请核对对象资料及有效报名';}
function conversionReason(code){return({CONTACT_DECLINED:'本人已拒绝联络或出席',CONTACT_NOT_CONSENTED:'联络许可待核对',ALREADY_CONVERTED:'已有明确报名关联',CONTACT_NOT_FOUND:'人员记录已变化',SOURCE_CHANGED:'来源已变化',REGISTRATION_INACTIVE:'关联报名已停用',REGISTRATION_CLOSED:'正式报名已关闭'})[code]||'来源、许可或报名条件需核对';}
async function previewContactConversions(ids,{backfill=false,total=ids.length}={}){
  if(!intentState||!permitted()||!user.roles.some(role=>['reviewer','superadmin'].includes(role)))throw new Error('需要邀约与审核权限，并先读取正式报名状态。');
  if(operationsDirty||profileDirty||uncertainSave)throw new Error('请先保存或关闭尚未保存的表单，再核对名额同步。');
  if(!ids.length||ids.length>100)throw new Error('每批请选择 1 至 100 位人员。');
  const generation=sessionGeneration,expected=revision;
  const preview=conversionPreview(await request('/api/admin/contacts/convert/preview',{method:'POST',body:JSON.stringify({contactIds:ids,expectedContactRevision:expected})}),ids,expected);
  if(generation!==sessionGeneration)return;
  conversionDraft={...preview,backfill,unknown:false};
  $('[data-conversion-summary]').textContent='已预览 '+ids.length+' 位，可代登记 '+preview.eligibleIds.length+' 位。'+(total>100?'本次仅核对前 100 位；其余 '+(total-100)+' 位请下一批处理。':'')+'下方确认后才写入报名；候补不会冒充已确认名额。';
  const output=$('[data-conversion-entries]');output.replaceChildren();for(const entry of preview.entries){const item=contactById(entry.contactId);output.append(node('li',(item?.profile.displayName||entry.contactId)+' · '+(entry.eligible?'可代登记':conversionReason(entry.reason))+(entry.warningCount?' · 有选填资料需核对，原始来源保留':'')));}
  $('[data-conversion-error]').hidden=true;$('[data-conversion-error]').textContent='';$('[data-conversion-dialog]').showModal();
}
$('[data-contacts-convert]').addEventListener('click',()=>action(()=>previewContactConversions([...selectedContacts])));
$('[data-contacts-sync-attending]').addEventListener('click',()=>action(()=>{const ids=contacts.filter(item=>item.operations.responseStatus==='attending'&&!intentState?.conversions?.some(row=>row.sourceContactId===item.id)).map(item=>item.id);return previewContactConversions(ids.slice(0,100),{backfill:true,total:ids.length});}));
$('[data-conversion-confirm]').addEventListener('click',()=>action(async()=>{
  const draft=conversionDraft,generation=sessionGeneration;if(!draft||draft.unknown||!draft.eligibleIds.length)return;
  try{
    const raw=await request('/api/admin/contacts/convert',{method:'POST',body:JSON.stringify({contactIds:draft.eligibleIds,expectedContactRevision:draft.contactRevision})});
    if(generation!==sessionGeneration||conversionDraft!==draft)return;
    const result=conversionReceipt(raw,draft);
    const nextIntent=await request('/api/admin/intent-invitations').catch(()=>null);if(generation!==sessionGeneration)return;intentState=nextIntent;conversionDraft=null;
    const output=$('[data-conversion-entries]');output.replaceChildren();for(const id of draft.eligibleIds){const item=contactById(id),admission=admissionForContact(item,intentState);const row=node('li',(item?.profile.displayName||id)+' · '+ADMISSION_LABELS[admission.status]);if(admission.registrationId){const link=node('a','查看报名');link.href='/admin/registrations/#registration='+encodeURIComponent(admission.registrationId);row.append(link);}output.append(row);}
    for(const record of result.registrations)selectedContacts.delete(record.contactId);
    $('[data-conversion-summary]').textContent='已收到 '+result.registrations.length+' 位代登记回执；正式名额按下方最新来源核对。'+(result.failureCount?'另有 '+result.failureCount+' 位未完成，请先核对，勿自动重送。':'')+'没有发送邀请或邮件。';render();
  }catch(error){if(generation!==sessionGeneration||conversionDraft!==draft)return;draft.unknown=!error.status||error.status>=500;$('[data-conversion-error]').textContent=error.message+(draft.unknown?' 本次结果待核对，不会自动重送。关闭后请刷新名单及名额，再明确预览。':'');$('[data-conversion-error]').hidden=false;throw error;}
}));
function closeConversion(){if(busy)return;if(conversionDraft?.unknown&&!confirm('本次代登记结果尚待核对。关闭后请重新读取名单及正式名额，不能据此判断未写入。确定关闭？'))return;conversionDraft=null;$('[data-conversion-dialog]').close();lock();}
for(const button of document.querySelectorAll('[data-conversion-close]'))button.addEventListener('click',closeConversion);
$('[data-conversion-dialog]').addEventListener('cancel',event=>{event.preventDefault();closeConversion();});
for(const selector of ['[data-contacts-search]','[data-contacts-category]','[data-contacts-response]','[data-contacts-arrangement]','[data-contacts-participation]','[data-contacts-due]','[data-contacts-owner]','[data-contacts-progress]','[data-contacts-organization]','[data-contacts-public-role]','[data-contacts-public-state]'])$(selector).addEventListener('input',render);
for(const [prefix,items,label]of[['category:',sourceLabels.categories,'当前身份'],['source-category:',sourceLabels.categories,'原始身份（只读）'],['interest:',sourceLabels.interests,'原始参与意向']]){const group=node('optgroup');group.label=label;for(const item of items){const option=node('option',item.label);option.value=prefix+item.value;group.append(option);}$('[data-contacts-category]').append(group);}
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
$('[data-contacts-export]').addEventListener('click',()=>action(async()=>{
  if(!permitted()||!features.contactXlsxExport)return;
  const generation=sessionGeneration,isCurrent=()=>generation===sessionGeneration&&permitted();
  const body={expectedRevision:revision,includeContact:$('[data-contacts-export-contact]').checked,includeAnswers:$('[data-contacts-export-answers]').checked};
  try{
    const {downloadPrivateXlsx}=await import('../lib/xlsx-download.mjs');
    if(!isCurrent())return;
    const result=await downloadPrivateXlsx({path:'/api/admin/contacts/export.xlsx',body,csrfToken,filename:'artdico-all-contacts.xlsx',isCurrent,onPrivateUrl:url=>{if(!isCurrent()){URL.revokeObjectURL(url);return;}privateExportUrls.add(url);setTimeout(()=>privateExportUrls.delete(url),15000);}});
    if(!isCurrent())return;
    revision=result.revision;
    announce('完整人员 Excel 已准备下载，共 '+result.count+' 位；原始资料及当前未保存编辑均保留。');
  }catch(error){if(generation!==sessionGeneration)return;if(error.status===401)clearPrivateState();throw error;}
}));
$('[data-contact-new]').addEventListener('click',()=>openProfile());
for(const button of document.querySelectorAll('[data-profile-close]'))button.addEventListener('click',closeProfile);
$('[data-profile-dialog]').addEventListener('cancel',event=>{event.preventDefault();closeProfile();});
$('[data-profile-form]').addEventListener('input',event=>{if(!event.target.name)return;profileDirty=true;$('[data-profile-duplicates-confirm]').checked=false;syncProfileDuplicates();});
$('[data-profile-duplicates-confirm]').addEventListener('change',lock);
$('[data-profile-form]').addEventListener('submit',event=>{
  event.preventDefault();const form=event.currentTarget;if(!permitted()||profilePending||profileDraft?.blocked||!form.reportValidity())return;
  if(profileDuplicates()&&!$('[data-profile-duplicates-confirm]').checked){syncProfileDuplicates();return;}
  const profile=Object.fromEntries(EDITABLE_CONTACT_FIELDS.map(key=>[key,form.elements.namedItem(key).value.trim()]));
  for(const key of EDITABLE_CONTACT_ARRAY_FIELDS)profile[key]=Array.from(form.querySelectorAll('[name='+key+']:checked'),input=>input.value);
  if(!profileContactId)profile.contactConsent=form.elements.namedItem('contactConsent').value;
  const id=profileContactId;
  action(async()=>{try{
    const path='/api/admin/contacts'+(id?'/'+encodeURIComponent(id)+'/profile':''),method=id?'PUT':'POST',body=JSON.stringify({expectedRevision:revision,profile});
    await profileDraft.markPending({path,method,body});profilePending=true;lock();
    const result=await request(path,{method,body});
    if(!result.contact||!Number.isSafeInteger(result.revision)||result.revision<=revision||id&&result.contact.id!==id)throw new Error('联系人保存回执无法核对，请先手动核对云端。');
    await profileDraft.acknowledge();updateContact(result);resetProfile();announce(id?'基本资料已保存；来源答案、联络许可与跟进安排保持独立。':'联系人已保存；尚未生成邀请、发出消息或确认出席。');
  }catch(error){if(user&&error.status>=400&&error.status<500){await profileDraft?.rejectPending();profilePending=false;}else if(user)await profileDraft?.markUnknown().catch(()=>{});if(user){$('[data-profile-error]').textContent=error.message;$('[data-profile-error]').hidden=false;$('[data-profile-error]').focus();}throw error;}});
});
$('[data-contact-form]').addEventListener('input',()=>{operationsDirty=true;});
for(const button of document.querySelectorAll('[data-contact-close]'))button.addEventListener('click',closeContact);
$('[data-contact-dialog]').addEventListener('cancel',event=>{event.preventDefault();closeContact();});
$('[data-contact-form]').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;if(uncertainSave||contactDraft?.blocked||!form.reportValidity())return;const data=new FormData(form);action(async()=>{
  const generation=sessionGeneration,contactId=currentContactId,expectedRevision=operationRevision;
  const operations=Object.fromEntries(['owner','priority','followUpAt','notes','responseStatus'].map(key=>[key,String(data.get(key)||'').normalize('NFC').trim()]));operations.sessionIds=data.getAll('sessionIds');operations.boothIds=data.getAll('boothIds');operations.participationForms=data.getAll('participationForms');operations.sessionRoles=operations.sessionIds.map(sessionId=>({sessionId,roles:data.getAll('sessionRoles:'+sessionId)})).filter(entry=>entry.roles.length);
  if(relationships&&(membershipEdited||Object.hasOwn(contactById(contactId).operations,'organizationMemberships')))operations.organizationMemberships=membershipValues();
  try{
    const path='/api/admin/contacts/'+encodeURIComponent(contactId),body=JSON.stringify({expectedRevision,operations});await contactDraft.markPending({path,method:'PUT',body});
    const receipt=savedContactReceipt(await request(path,{method:'PUT',body}),{contactId,expectedRevision,operations});
    if(generation!==sessionGeneration)return;
    if(receipt.admission)admissionReceipts.set(contactId,receipt.admission);else admissionReceipts.delete(contactId);
    await contactDraft.acknowledge();contactDraft.close();contactDraft=null;updateContact(receipt);operationsDirty=false;uncertainSave=null;operationRevision=null;$('[data-contact-dialog]').close();
    const nextIntent=features.intentInvitations?await request('/api/admin/intent-invitations').catch(()=>null):null;if(generation!==sessionGeneration)return;intentState=nextIntent;render();
    announce('回复、职责与组织安排已保存。'+(receipt.admission?ADMISSION_LABELS[receipt.admission.status]+'。':'正式名额仍以报名审核记录为准。')+(operations.responseStatus==='declined'?'原报名及名额不会自动撤回，请到报名审核处理。':'')+'没有发送邀请或邮件。');
  }catch(error){if(generation!==sessionGeneration)return;if(error.status>=400&&error.status<500)await contactDraft?.rejectPending();else await contactDraft?.markUnknown().catch(()=>{});operationsDirty=true;if(!error.status||error.status>=500){uncertainSave={contactId,expectedRevision,operations};$('[data-contact-save-unknown]').hidden=false;}$('[data-contact-error]').textContent=error.message;$('[data-contact-error]').hidden=false;$('[data-contact-error]').focus();throw error;}
});});
$('[data-contact-membership-add]').addEventListener('click',()=>{if(busy||!relationships||uncertainSave)return;membershipRow();membershipEdited=true;operationsDirty=true;contactDraft?.schedule();lock();});
$('[data-contact-check-save]').addEventListener('click',()=>action(async()=>{
  const pending=uncertainSave,generation=sessionGeneration;if(!pending)return;
  const state=await request('/api/admin/contacts');if(generation!==sessionGeneration||uncertainSave!==pending)return;
  const contact=state.contacts?.find(item=>item.id===pending.contactId);if(!Number.isSafeInteger(state.revision)||state.revision<=pending.expectedRevision||!contact||!Object.entries(pending.operations).every(([key,value])=>JSON.stringify(contact.operations?.[key])===JSON.stringify(value)))throw new Error('当前云端记录与这份草稿尚未一致，请保留填写内容，关闭后刷新并核对差异。');
  await contactDraft?.acknowledge();contactDraft?.close();contactDraft=null;revision=state.revision;contacts=state.contacts;uncertainSave=null;operationsDirty=false;operationRevision=null;$('[data-contact-save-unknown]').hidden=true;$('[data-contact-dialog]').close();
  intentState=features.intentInvitations?await request('/api/admin/intent-invitations').catch(()=>null):null;if(generation!==sessionGeneration)return;render();announce('已核对当前云端记录与这份填写一致。本人回复、正式名额及邀请发送仍分别核对；没有自动重送或代登记。');
}));
$('[data-invitation-use-poster]').addEventListener('click',()=>{if(busy||!permitted())return;try{requireInviteConsent();const form=$('[data-invitation-form]'),item=contactById(invitationContactId),settings=buildPosterInvitationSettings(form.elements.namedItem('recipientName').value.trim()||item.profile.displayName,eventConfig);for(const key of ['recipientName','date','time','venue'])form.elements.namedItem(key).value=settings[key];form.elements.namedItem('confirmed').checked=false;invitationRenderVersion=INVITATION_POSTER_RENDER_VERSION;invalidateInvitationPreview();syncInvitationVersion();announce('已填入本次活动信息；请重新核实后预览新版，尚未更新保存记录。');lock();}catch(error){announce(error.message,true);}});
$('[data-invitation-form]').addEventListener('input',event=>{if(!['recipientName','date','time','venue','confirmed'].includes(event.target.name))return;invalidateInvitationPreview();lock();});
$('[data-invitation-form]').addEventListener('submit',event=>{event.preventDefault();if(!event.currentTarget.reportValidity())return;action(async()=>{requireInviteConsent();const settings=settingsFromForm(),generation=sessionGeneration,selection=invitationGeneration,id=invitationContactId;const{canvas}=await renderedPng(settings,()=>generation===sessionGeneration&&selection===invitationGeneration&&invitationContactId===id&&mayInvite(contactById(id)));const output=$('[data-invitation-canvas]');output.width=canvas.width;output.height=canvas.height;output.getContext('2d').drawImage(canvas,0,0);renderedSettings=structuredClone(settings);output.dataset.ready='true';$('[data-invitation-image]').src=canvas.toDataURL('image/png');$('[data-invitation-image]').hidden=false;$('[data-invitation-caption]').textContent=settings.recipientName+' · '+invitationVersionLabel(settings)+' · '+(settings.confirmed?'正式版预览':'暂定版预览')+' · 仅预览';announce('邀请函预览已生成。下载只保存图片，不会发送给对象。');});});
$('[data-invitation-download]').addEventListener('click',()=>action(async()=>{requireInviteConsent();if(!renderedSettings||!invitationContactId)throw new Error('请先生成当前设置的邀请函预览。');const settings=structuredClone(renderedSettings),id=invitationContactId,generation=sessionGeneration,selection=invitationGeneration;const blob=await invitationPngBlob($('[data-invitation-canvas]'));if(generation!==sessionGeneration||selection!==invitationGeneration||id!==invitationContactId||!mayInvite(contactById(id))||!blob.size)throw new Error('图片未完成或会话已变化，请重新核对。');downloadPng(blob,settings);const result=await request('/api/admin/contacts/'+encodeURIComponent(id)+'/invitation/generated',{method:'POST',body:JSON.stringify({expectedRevision:revision,settings})});if(generation!==sessionGeneration||id!==invitationContactId)return;updateContact(result);renderInvitationHistory(contactById(id));$('[data-invitation-sent-confirm]').checked=false;announce('PNG 已生成并开始下载，已记录生成时间；尚未记录发出。');}));
$('[data-invitation-sent-confirm]').addEventListener('change',lock);
$('[data-invitation-channel]').addEventListener('change',()=>{$('[data-invitation-sent-confirm]').checked=false;lock();});
$('[data-invitation-record-sent]').addEventListener('click',()=>action(async()=>{requireInviteConsent();if(!$('[data-invitation-sent-confirm]').checked)throw new Error('请先确认你已经实际发出邀请。');if(!matchesSavedInvitation())throw new Error('当前设置与最近一次生成记录不同，请重新生成并下载，再核对实际发出的版本。');const result=await request('/api/admin/contacts/'+encodeURIComponent(invitationContactId)+'/invitation/sent',{method:'POST',body:JSON.stringify({expectedRevision:revision,channel:$('[data-invitation-channel]').value,generatedAt:contactById(invitationContactId).invitation.generatedAt,settings:settingsFromForm()})});updateContact(result);$('[data-invitation-sent-confirm]').checked=false;renderInvitationHistory(contactById(invitationContactId));announce('已保存工作人员的手动发出记录。系统没有发送任何消息，也没有自动确认对方出席。');}));
$('[data-invitation-close]').addEventListener('click',()=>{
  $('[data-invitation-panel]').hidden=true;invitationContactId=null;invitationRenderVersion=undefined;invalidateInvitationPreview();$('[data-invitation-version]').textContent='';$('[data-invitation-history]').replaceChildren();$('[data-invitation-history-panel]').hidden=true;$('[data-invitation-history-panel]').open=false;
  $('[data-invitation-form]').reset();$('[data-invitation-form] [name=recipientName]').value='';
  $('[data-invitation-image]').hidden=true;$('[data-invitation-image]').removeAttribute('src');
  const canvas=$('[data-invitation-canvas]');canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);canvas.removeAttribute('data-ready');
  $('[data-invitation-caption]').textContent='选择对象后点击预览，生成专属邀请函。';clearCommunicationPreviews();lock();
});
$('[data-wallet-preview-button]').addEventListener('click',()=>{if(!$('[data-invitation-form]').reportValidity())return;action(async()=>{requireInviteConsent();const result=await request('/api/admin/contacts/'+encodeURIComponent(invitationContactId)+'/wallet/preview',{method:'POST',body:JSON.stringify({settings:settingsFromForm()})});for(const [selector,value]of [['[data-wallet-title]',result.title],['[data-wallet-name]',result.name],['[data-wallet-date]',result.date],['[data-wallet-time]',result.time],['[data-wallet-location]',result.location],['[data-wallet-notice]',result.notice]])$(selector).textContent=value;$('[data-wallet-preview]').hidden=false;announce('已生成未签名 Wallet 卡片预览。尚未制作或发送 Apple Wallet 通行证。');});});
$('[data-email-preview-button]').addEventListener('click',()=>{if(!$('[data-invitation-form]').reportValidity())return;action(async()=>{requireInviteConsent();if(contactById(invitationContactId)?.operations.responseStatus!=='attending')throw new Error('请先核实并保存对方已确认出席的回复。');const result=await request('/api/admin/contacts/'+encodeURIComponent(invitationContactId)+'/email/preview',{method:'POST',body:JSON.stringify({settings:settingsFromForm()})});$('[data-email-to]').textContent=result.toEmail;$('[data-email-subject]').textContent=result.subject;$('[data-email-text]').textContent=result.text;$('[data-email-preview]').hidden=false;announce('确认信内容已生成，仅供核对，尚未发送。');});});
window.addEventListener('beforeunload',event=>{if(operationsDirty||profileDirty||conversionDraft?.unknown){event.preventDefault();event.returnValue='';}});
window.addEventListener('hashchange',()=>{const organization=parseOrganizationSelection(location.hash);if(!organization)return;organizationSelection=organization;if(user&&permitted()&&!$('[data-contacts-workspace]').hidden){renderRelationshipFilters();render();}});
if(location.protocol==='file:'){announce('这是离线界面预览。请启动本地服务，使用有邀约管理权限的账号登录。');lock();}else{action(async()=>{const session=await request('/api/admin/session');user=session.user;csrfToken=session.csrfToken;$('[data-contacts-account]').hidden=false;$('[data-contacts-user]').textContent=user.label||user.id;await loadWorkspace();announce('已恢复工作人员会话。');});}

window.addEventListener('pagehide',()=>{invalidateInvitationPreview();clearBatchResult();for(const url of privateExportUrls)URL.revokeObjectURL(url);privateExportUrls.clear();});
