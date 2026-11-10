import { createRegistrationClient } from '../lib/registration-client.mjs';
import { registrationFields } from '../lib/registration-fields.mjs';
import { renderRegistrationSuccess } from './registration-success.mjs';
import { createBrowserDraftStore } from '../lib/browser-drafts.mjs';
import { createApplicationDraft, applicationDraftValue, applicationDraftFromFields } from '../lib/application-draft.mjs';
import { isSpeakerApplicationFields } from '../../shared/general-application.mjs';
import { eventConfig, PUBLIC_CONTACT_EMAIL } from '../config/event.mjs';
import '../lib/public-faq.mjs';

function node(tag,text) { const result = document.createElement(tag); result.textContent = text; return result; }

let currentPublicPrivacy=null;
function renderPublicPrivacy(){
  const output=document.querySelector('[data-public-privacy]');
  if(output&&currentPublicPrivacy){output.replaceChildren();const labels={processor:'处理者',contactEmail:'联络邮箱',purpose:'用途',storageRegion:'存储地区',retention:'保留期限',rightsRequest:'查阅、更正、撤回及删除',sharing:'分享范围',version:'告知版本'};for(const[key,label]of Object.entries(labels))output.append(node('p',label+'：'+(key==='contactEmail'?PUBLIC_CONTACT_EMAIL:currentPublicPrivacy[key])));output.append(node('p','主办方使用 EmailJS 发送必要活动通知，向该服务提供发送所需的姓名、邮箱与通知内容（包括活动安排及私人查询入口）。请妥善保存私人链接。'));}
}
const privacyDialog=document.querySelector('[data-privacy-dialog]');let privacyTrigger=null;
function openPrivacy(trigger){
  if(!privacyDialog)return;
  privacyTrigger=trigger??null;if(!privacyDialog.open)privacyDialog.showModal();
  privacyDialog.querySelector('h3')?.focus({preventScroll:true});
}
document.addEventListener('click',event=>{
  if(!(event.target instanceof Element))return;
  const trigger=event.target.closest('a[href="#privacy"]');
  if(trigger&&privacyDialog){event.preventDefault();openPrivacy(trigger);}
});
privacyDialog?.querySelector('[data-privacy-close]')?.addEventListener('click',()=>privacyDialog.close());
privacyDialog?.addEventListener('close',()=>{if(privacyTrigger?.isConnected)privacyTrigger.focus({preventScroll:true});privacyTrigger=null;});
if(location.hash==='#privacy')openPrivacy();
document.addEventListener('artdico:registration-ready',event=>{currentPublicPrivacy=event.detail?.privacy??null;renderPublicPrivacy();});
document.addEventListener('artdico:registration-policy',event=>{currentPublicPrivacy=event.detail?.privacy??null;renderPublicPrivacy();});
document.addEventListener('artdico:public-content-updated',renderPublicPrivacy);

for (const section of document.querySelectorAll('[data-registration-api-origin]')) {
  const form = section.querySelector('[data-registration-form]');
  if (!(form instanceof HTMLFormElement)) continue;
  let draft=null,draftStore=null,draftReady=false,draftBlocked=false,draftRevision=0,editSequence=0,draftTimer=null,draftWrite=Promise.resolve(),watchRead=false,watchPending=false,localWrites=0,savedEditSequence=0;
  const draftStatus=form.querySelector('[data-application-draft-status]'),restoreDraft=form.querySelector('[data-application-draft-restore]'),clearDraft=form.querySelector('[data-application-draft-clear]');
  const localFailure=()=>{const error=new Error('本机草稿未能保存，尚未提交。');error.code='DRAFT_UNAVAILABLE';throw error;};
  async function pendingOperation(method,value){if(!draft)localFailure();localWrites++;try{const result=await draft.pendingStore[method](value);draftRevision=draft.snapshot.revision;return result;}finally{localWrites--;checkDraftHints();}}
  const pendingStore={prepare:async value=>{await flushDraft();if(!draft||draftBlocked)localFailure();return pendingOperation('prepare',value);},update:value=>pendingOperation('update',value),clear:async value=>{const result=await pendingOperation('clear',value);draftMessage('本机草稿已清除','saved');return result;},reject:value=>pendingOperation('reject',value)};
  const client = createRegistrationClient({apiOrigin:section.dataset.registrationApiOrigin,pageOrigin:location.origin,pendingStore,applicationKind:'speaker'});
  const submit = form.querySelector('[data-submit]');
  const summary = form.querySelector('[data-form-error]');
  const receipt = section.querySelector('[data-registration-success]');
  const trackedControls = () => [...form.querySelectorAll('input,select,textarea,[data-next-step],[data-prev-step]')];
  let frozen = false;
  let config = null;
  let pendingFields = null;
  let provenReceipt = false;
  function draftMessage(message,state='saved'){const recoveryBar=form.querySelector('[data-application-draft-recovery]');if(recoveryBar)recoveryBar.hidden=!['conflict','error'].includes(state);if(draftStatus){draftStatus.textContent=message;draftStatus.dataset.state=state;}if(restoreDraft)restoreDraft.hidden=!draftBlocked;if(clearDraft)clearDraft.hidden=!draftReady||client.pending||draftBlocked||!draft?.snapshot?.record;}
  function readDraftFields(){const value={intake:'general-v2',proposal:true};for(const [key,name]of[['name','name'],['email','email'],['category','categories'],['organization','organization'],['city','city'],['wechat','wechat'],['phone','phone'],['topic','speaker.topic'],['summary','speaker.summary']])value[key]=form.elements.namedItem(name).value;return applicationDraftValue(value);}
  function applyDraft(value){const fields=applicationDraftValue(value);for(const [key,name]of[['name','name'],['email','email'],['category','categories'],['organization','organization'],['city','city'],['wechat','wechat'],['phone','phone'],['topic','speaker.topic'],['summary','speaker.summary']])form.elements.namedItem(name).value=fields[key]??'';const branch=form.querySelector('[data-speaker-proposal]');branch.hidden=false;branch.disabled=false;form.elements.namedItem('consentAccepted').checked=false;}
  function adoptSnapshot(snapshot,{force=false}={}){draftRevision=snapshot.revision;if(snapshot.record?.kind==='pending_submission'){const value=snapshot.record.value;if(client.pending&&(client.pendingSnapshot.idempotencyKey!==value.idempotencyKey||client.pendingSnapshot.payloadJson!==value.payloadJson))localFailure();if(!client.pending){applyDraft(applicationDraftFromFields(JSON.parse(value.payloadJson).fields));client.restorePending(value);}frozen=true;pendingFields=JSON.parse(value.payloadJson).fields;draftBlocked=false;draftMessage('上次申请结果待核对','pending');lock(false);return;}if(editSequence&&!force&&snapshot.record){draftBlocked=true;draftMessage('本机有另一份草稿，请先恢复','conflict');return;}if(snapshot.record?.kind==='editing'){applyDraft(snapshot.record.value);savedEditSequence=editSequence;}draftBlocked=false;draftMessage(snapshot.record?.kind==='editing'&&snapshot.record.value.proposal?'已恢复讲者主题草稿，请核对后再提交':snapshot.record?'已保留旧草稿；现表单仅接收讲者主题，一般报名请前往活动行':'讲者申请草稿已就绪','saved');}
  async function loadDraft({force=false}={}){if(!draft)localFailure();const snapshot=await draft.read();draftReady=true;adoptSnapshot(snapshot,{force});return snapshot;}
  function queueDraft(){if(provenReceipt||frozen||form.dataset.submitting==='true')return;editSequence++;clearTimeout(draftTimer);draftMessage(draftReady?'正在暂存…':'输入待暂存…','saving');if(!draftReady)return;draftTimer=setTimeout(()=>{draftTimer=null;void saveDraft().catch(()=>{});},400);}
  function saveDraft(){if(!draftReady||draftBlocked||client.pending)return Promise.resolve();const sequence=editSequence;let value;try{value=readDraftFields();}catch(error){draftBlocked=true;draftMessage(error.message,'error');if(form.dataset.submitting!=='true')lock(false);return Promise.reject(error);}draftWrite=draftWrite.catch(()=>{}).then(async()=>{if(draftBlocked)localFailure();localWrites++;try{const saved=await draft.save(value);draftRevision=saved.revision;savedEditSequence=sequence;if(sequence===editSequence)draftMessage('本机已暂存','saved');}catch(error){draftBlocked=true;draftMessage(error.code==='CONFLICT'||error.code==='PENDING_IMMUTABLE'?'另一页签已更新，请先恢复本机草稿':'本机暂存失败，请保留当前输入','conflict');if(form.dataset.submitting!=='true')lock(false);throw error;}finally{localWrites--;checkDraftHints();}});return draftWrite;}
  async function flushDraft(){clearTimeout(draftTimer);draftTimer=null;if(!draftReady||draftBlocked)localFailure();await draftWrite.catch(()=>{});if(draftBlocked)localFailure();if(!client.pending)await saveDraft();}
  function checkDraftHints(){if(!watchPending||watchRead||localWrites||form.dataset.submitting==='true'||!draft)return;watchPending=false;watchRead=true;void draft.read().then(snapshot=>{if(localWrites||form.dataset.submitting==='true'){watchPending=true;return;}if(snapshot.revision===draftRevision)return;draftBlocked=true;draftMessage(snapshot.record?.kind==='pending_submission'?'另一页签有待核对申请，请先恢复':'另一页签已更新，请先恢复本机草稿','conflict');lock(false);}).catch(()=>{if(localWrites||form.dataset.submitting==='true'){watchPending=true;return;}draftBlocked=true;draftMessage('本机草稿暂不可核对','error');lock(false);}).finally(()=>{watchRead=false;checkDraftHints();});}
  async function initializeDraft(){try{draftStore=createBrowserDraftStore({indexedDB:globalThis.indexedDB});draft=createApplicationDraft({store:draftStore,eventId:eventConfig.id});await loadDraft();draftReady=true;if(!client.pending&&editSequence&&!draftBlocked)queueDraft();else if(!draftBlocked)draftMessage(client.pending?'上次申请结果待核对':draft.snapshot.record?.kind==='editing'&&draft.snapshot.record.value.proposal?'已恢复讲者主题草稿，请核对后再提交':draft.snapshot.record?'已保留旧草稿；现表单仅接收讲者主题，一般报名请前往活动行':'讲者申请草稿已就绪',client.pending?'pending':'saved');draft.subscribe(()=>{watchPending=true;checkDraftHints();});}catch{draftBlocked=true;draftMessage('本机暂存不可用，请保留当前输入','error');}}
  const draftInitialization=initializeDraft();
  form.addEventListener('input',event=>{if(!event.isComposing&&event.target.name!=='consentAccepted')queueDraft();});form.addEventListener('change',event=>{if(event.target.name!=='consentAccepted'){queueDraft();captureDraft();}});form.addEventListener('compositionend',queueDraft);
  for(const button of form.querySelectorAll('[data-application-draft-save]'))button.addEventListener('click',()=>{if(!client.pending)void flushDraft().catch(error=>draftMessage(error.message,'error'));});
  restoreDraft?.addEventListener('click',()=>{if(form.dataset.submitting==='true')return;clearTimeout(draftTimer);draftTimer=null;void draftWrite.catch(()=>{}).then(()=>loadDraft({force:true})).then(()=>{editSequence=0;savedEditSequence=0;lock(false);}).catch(error=>draftMessage(error.message,'error'));});
  clearDraft?.addEventListener('click',()=>{if(client.pending||form.dataset.submitting==='true')return;clearTimeout(draftTimer);draftTimer=null;localWrites++;void draftWrite.catch(()=>{}).then(()=>draft.clear()).then(snapshot=>{editSequence=0;savedEditSequence=0;draftRevision=snapshot.revision;form.reset();const branch=form.querySelector('[data-speaker-proposal]');branch.hidden=false;branch.disabled=false;draftMessage('本机草稿已清除','saved');}).catch(()=>{draftBlocked=true;draftMessage('本机草稿尚未清除','error');}).finally(()=>{localWrites--;checkDraftHints();});});
  function captureDraft(){if(provenReceipt||!draftReady||draftBlocked||client.pending||frozen||form.dataset.submitting==='true'||editSequence<=savedEditSequence)return;clearTimeout(draftTimer);draftTimer=null;void saveDraft().catch(()=>{});}
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')captureDraft();});
  window.addEventListener('pagehide',captureDraft);
  function unavailable(reason) {
    const closed=reason==='closed';
    form.dataset.registrationMode=client.pending?'recovery':closed?'closed':'unavailable';
    submit.disabled=!client.pending;
    submit.textContent=client.pending?'核对原申请结果':closed?'讲者申请已关闭':'讲者申请暂不可用';
    const message=closed?'本站已停止接收新的讲者申请。已保存申请的结果查询不受影响；一般报名请前往活动行。':'申请服务暂时无法确认，请稍后再试。当前不会提交或保存资料。';
    section.querySelector('[data-registration-notice]').textContent=message;
    section.querySelector('[data-registration-mode-label]').textContent=closed?'申请已关闭':'服务暂不可用';
    section.querySelector('[data-registration-open-label]').textContent='讲者申请';
    section.querySelector('[data-registration-disclaimer]').textContent=message;
    section.querySelector('[data-registration-data-hint]').textContent='当前不受理提交，请勿填写真实资料。';
    for(const control of trackedControls())control.disabled=true;
    for(const status of document.querySelectorAll('[data-registration-availability]'))status.textContent=closed?'申请已关闭':'申请服务暂不可用';
    document.dispatchEvent(new CustomEvent('artdico:registration-unavailable',{detail:{message}}));
  }
  function announce(message) { summary.textContent = message; summary.hidden = false; summary.focus(); }
  function lock(value) {
    form.dataset.submitting = String(value);
    form.dataset.applicationPending=String(frozen);
    const recovery=form.querySelector('[data-application-recovery]');
    if(recovery){recovery.hidden=!client.pending;form.querySelector('[data-application-recovery-person]').textContent=client.pending?[pendingFields?.name||form.elements.namedItem('name').value,pendingFields?.email||form.elements.namedItem('email').value].filter(Boolean).join(' · '):'';}
    if(clearDraft)clearDraft.hidden=client.pending||draftBlocked||!draftReady||!draft?.snapshot?.record;
    if(frozen&&!value&&!draftBlocked)draftMessage('上次申请结果待核对','pending');
    submit.disabled = provenReceipt || value || !client.pending&&(!config||draftBlocked||!draftReady);
    for(const button of form.querySelectorAll('[data-application-draft-save],[data-application-draft-clear],[data-application-draft-restore]'))button.disabled=value||client.pending&&button!==restoreDraft;
    for (const control of trackedControls()) {
      if (provenReceipt || value || frozen || !config) { if (!control.disabled) { control.dataset.registrationLocked = 'true'; control.disabled = true; } }
      else if (control.dataset.registrationLocked) { control.disabled = false; delete control.dataset.registrationLocked; }
    }
    submit.textContent = value ? '正在确认申请结果…' : frozen ? '再次确认原申请结果' : '提交讲者申请';
    if(!value)checkDraftHints();
  }
  async function submitFields(fields) {
    if (provenReceipt || (!config&&!client.pending) || form.dataset.submitting === 'true') return;
    lock(true); summary.hidden = true;
    try {
      const result = client.pending?await client.resume():await client.submit(fields);
      provenReceipt=true;savedEditSequence=editSequence;if(result.localRecoveryRetained)draftMessage('申请已收到，本机恢复记录待清理','error');
      let successTarget=receipt;
      const speakerApplication=isSpeakerApplicationFields(pendingFields);
      if (speakerApplication && result.body.admissionStatus==='pending_review') {
        const received=node('p','讲者申请已收到。筹备团队将另行联系；讲者安排与入场资格尚未确认。');received.setAttribute('role','status');received.tabIndex=-1;received.dataset.speakerApplicationReceived='';section.append(received);successTarget=received;
      } else if (!renderRegistrationSuccess(receipt,result,{compact:true})) {
        const labels={pending_review:'申请已收到，待审核',confirmed:'报名成功',waitlisted:'候补登记已保存，尚未确认名额',rejected:'本次申请未通过审核',withdrawn:'申请已撤回'};const fallback=node('p',labels[result.body.admissionStatus]||'报名结果待核对');
        fallback.setAttribute('role','status');fallback.tabIndex=-1;section.append(fallback);successTarget=fallback;
      }
      frozen = false;
      pendingFields = null;
      form.dispatchEvent(new Event('artdico:registration-saved'));
      section.querySelector('[data-registration-preview]')?.setAttribute('hidden','');
      section.querySelector('[data-registration-intro]')?.setAttribute('hidden','');
      successTarget?.focus();
    } catch (error) {
      frozen = client.pending;
      if (!frozen) {pendingFields = null;form.elements.namedItem('consentAccepted').checked=false;}
      if(!frozen&&draft)try{if(error.code==='INVALID')await loadDraft({force:true});else{const current=await draft.read();if(current.record?.kind==='pending_submission'&&JSON.stringify(JSON.parse(current.record.value.payloadJson).fields)===JSON.stringify(fields))adoptSnapshot(current,{force:true});else{draftBlocked=true;draftMessage('本机记录有变化，当前输入仍保留','conflict');}}}catch{draftBlocked=true;draftMessage('本机草稿暂不可核对，当前输入仍保留','error');}
      announce(error.message || '申请尚未确认保存，请保留本页并明确核对同一申请结果。');
    } finally { lock(false); }
  }
  form.addEventListener('artdico:registration-submit', event => {
    if(provenReceipt||event.detail?.fields?.consentAccepted!==true)return;
    pendingFields=registrationFields({...event.detail.fields,locale:document.documentElement.lang.toLowerCase().startsWith('en')?'en':'zh-CN'});
    void submitFields(pendingFields);
  });
  // Disabled controls are absent from FormData. Retry uses the original in-memory
  // fields through the controller, while the visible inputs remain protected.
  form.addEventListener('submit', event => {
    if (!frozen || form.dataset.submitting === 'true') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if(client.pending)void submitFields(pendingFields);
  },true);
  window.addEventListener('beforeunload', event => { if (client.pending&&!provenReceipt||editSequence>savedEditSequence) {event.preventDefault();event.returnValue='';} });
  client.configure().then(async value => {
    await draftInitialization;
    if(value?.privacy)document.dispatchEvent(new CustomEvent('artdico:registration-policy',{detail:{privacy:value.privacy}}));
    if (!value || value.enabled !== true) { unavailable(value?.reason??'unavailable'); return; }
    if(value.eventId!==eventConfig.id){unavailable('unavailable');return;}
    config = value;
    const copy = {title:'讲者申请',notice:'提交分享主题，由筹备团队另行联系。申请不代表确认讲者或入场资格。',openLabel:'讲者申请',modeLabel:'讲者申请',disclaimer:'提交成功仅表示已收到讲者申请；一般报名请前往活动行。',emailHint:'用于接收讲者申请的联系与通知。',submitLabel:'提交讲者申请',availability:'一般报名请前往活动行'};
    section.querySelector('[data-registration-heading]').textContent=copy.title;
    section.querySelector('[data-registration-notice]').textContent=copy.notice;
    section.querySelector('[data-registration-open-label]').textContent = copy.openLabel;
    section.querySelector('[data-registration-mode-label]').textContent = copy.modeLabel;
    section.querySelector('[data-registration-data-hint]').textContent = '带 * 为必填。学校／机构、城市、电话、微信可不填。';
    section.querySelector('[data-registration-disclaimer]').textContent = copy.disclaimer;
    const consentCopy = form.querySelector('[data-registration-consent-copy]');
    const privacyLink=node('a','隐私说明');privacyLink.href='#privacy';
    consentCopy.replaceChildren(document.createTextNode('我已阅读并同意'),privacyLink,document.createTextNode('。'));
    const consent = form.elements.namedItem('consentAccepted');
    consent.checked = false;
    const consentHint = document.getElementById('field-consentAccepted-hint');
    if (consentHint) consentHint.textContent = '请阅读后勾选。';
    const emailHint = document.getElementById('field-email-hint');
    if (emailHint) emailHint.textContent = copy.emailHint;
    submit.textContent = copy.submitLabel;
    lock(false);
    form.dataset.registrationMode = 'production';
    for(const status of document.querySelectorAll('[data-registration-availability]'))status.textContent=copy.availability;
    document.dispatchEvent(new CustomEvent('artdico:registration-ready',{detail:{privacy:value.privacy,closesAt:value.closesAt,
      ...(typeof value.attendeeReviewRequired==='boolean'?{attendeeReviewRequired:value.attendeeReviewRequired}:{}),
      ...(value.admissions?{admissions:{waitlistEnabled:value.admissions.waitlistEnabled}}:{})}}));
  }).catch(async() => {
    await draftInitialization;
    unavailable('unavailable');
  });
}
