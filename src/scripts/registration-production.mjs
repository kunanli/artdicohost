import { createRegistrationClient } from '../lib/registration-client.mjs';
import { registrationFields } from '../lib/registration-fields.mjs';
import { renderRegistrationSuccess } from './registration-success.mjs';
import { createBrowserDraftStore } from '../lib/browser-drafts.mjs';
import { createApplicationDraft, applicationDraftValue, applicationDraftFromFields } from '../lib/application-draft.mjs';
import { eventConfig } from '../config/event.mjs';

function node(tag,text) { const result = document.createElement(tag); result.textContent = text; return result; }

let currentPublicPrivacy=null;
let currentAvailability=null;
function renderPublicPrivacy(){
  const output=document.querySelector('[data-public-privacy]');
  if(output&&currentPublicPrivacy){output.replaceChildren();const labels={processor:'处理者',contactEmail:'联络邮箱',purpose:'用途',storageRegion:'存储地区',retention:'保留期限',rightsRequest:'查阅、更正、撤回及删除',sharing:'分享范围',version:'告知版本'};for(const[key,label]of Object.entries(labels))output.append(node('p',label+'：'+currentPublicPrivacy[key]));}
  for(const faq of document.querySelectorAll('[data-public-faq] details')){
    const question=faq.querySelector('summary')?.textContent??'',answer=faq.querySelector('p');if(!answer)continue;
    if(question.startsWith('现在可以报名吗？')&&currentAvailability)answer.textContent=currentAvailability.message;
    if(question.startsWith('如何修改或撤回资料？')&&currentPublicPrivacy)answer.textContent=currentPublicPrivacy.rightsRequest;
  }
}
document.addEventListener('artdico:registration-ready',event=>{currentPublicPrivacy=event.detail?.privacy??null;currentAvailability={message:'可以提交参会申请。申请收到后需由主办方人工审核；待审核不占参会名额。审核通过并确认名额后再发送正式邀请。'};renderPublicPrivacy();});
document.addEventListener('artdico:registration-policy',event=>{currentPublicPrivacy=event.detail?.privacy??null;renderPublicPrivacy();});
document.addEventListener('artdico:registration-unavailable',event=>{currentAvailability=event.detail;renderPublicPrivacy();});
document.addEventListener('artdico:public-content-updated',renderPublicPrivacy);

for (const section of document.querySelectorAll('[data-registration-api-origin]')) {
  const form = section.querySelector('[data-registration-form]');
  if (!(form instanceof HTMLFormElement)) continue;
  let draft=null,draftStore=null,draftReady=false,draftBlocked=false,draftRevision=0,editSequence=0,draftTimer=null,draftWrite=Promise.resolve(),watchRead=false,watchPending=false,localWrites=0,savedEditSequence=0;
  const draftStatus=form.querySelector('[data-application-draft-status]'),restoreDraft=form.querySelector('[data-application-draft-restore]'),clearDraft=form.querySelector('[data-application-draft-clear]');
  const localFailure=()=>{const error=new Error('本机草稿未能保存，尚未提交。');error.code='DRAFT_UNAVAILABLE';throw error;};
  async function pendingOperation(method,value){if(!draft)localFailure();localWrites++;try{const result=await draft.pendingStore[method](value);draftRevision=draft.snapshot.revision;return result;}finally{localWrites--;checkDraftHints();}}
  const pendingStore={prepare:async value=>{await flushDraft();if(!draft||draftBlocked)localFailure();return pendingOperation('prepare',value);},update:value=>pendingOperation('update',value),clear:async value=>{const result=await pendingOperation('clear',value);draftMessage('本机草稿已清除','saved');return result;},reject:value=>pendingOperation('reject',value)};
  const client = createRegistrationClient({apiOrigin:section.dataset.registrationApiOrigin,pageOrigin:location.origin,pendingStore});
  const submit = form.querySelector('[data-submit]');
  const summary = form.querySelector('[data-form-error]');
  const receipt = section.querySelector('[data-registration-success]');
  const trackedControls = () => [...form.querySelectorAll('input,select,textarea,[data-next-step],[data-prev-step]')];
  let frozen = false;
  let config = null;
  let pendingFields = null;
  let provenReceipt = false;
  function draftMessage(message,state='saved'){if(draftStatus){draftStatus.textContent=message;draftStatus.dataset.state=state;}if(restoreDraft)restoreDraft.hidden=!draftBlocked;if(clearDraft)clearDraft.hidden=!draftReady||client.pending||draftBlocked||!draft?.snapshot?.record;}
  function readDraftFields(){const value={intake:'general-v2',proposal:form.querySelector('[data-proposal-toggle]').checked};for(const [key,name]of[['name','name'],['email','email'],['category','categories'],['organization','organization'],['city','city'],['wechat','wechat'],['topic','speaker.topic'],['summary','speaker.summary']])value[key]=form.elements.namedItem(name).value;return applicationDraftValue(value);}
  function applyDraft(value){const fields=applicationDraftValue(value);for(const [key,name]of[['name','name'],['email','email'],['category','categories'],['organization','organization'],['city','city'],['wechat','wechat'],['topic','speaker.topic'],['summary','speaker.summary']])form.elements.namedItem(name).value=fields[key];const proposal=form.querySelector('[data-proposal-toggle]');proposal.checked=fields.proposal;const branch=form.querySelector('[data-speaker-proposal]');branch.hidden=!fields.proposal;branch.disabled=!fields.proposal;form.elements.namedItem('consentAccepted').checked=false;}
  function adoptSnapshot(snapshot,{force=false}={}){draftRevision=snapshot.revision;if(snapshot.record?.kind==='pending_submission'){const value=snapshot.record.value;if(client.pending&&(client.pendingSnapshot.idempotencyKey!==value.idempotencyKey||client.pendingSnapshot.payloadJson!==value.payloadJson))localFailure();if(!client.pending){applyDraft(applicationDraftFromFields(JSON.parse(value.payloadJson).fields));client.restorePending(value);}frozen=true;pendingFields=JSON.parse(value.payloadJson).fields;draftBlocked=false;draftMessage('上次申请结果待核对','pending');lock(false);return;}if(editSequence&&!force&&snapshot.record){draftBlocked=true;draftMessage('本机有另一份草稿，请先恢复','conflict');return;}if(snapshot.record?.kind==='editing'){applyDraft(snapshot.record.value);savedEditSequence=editSequence;}draftBlocked=false;draftMessage(snapshot.record?'已恢复本机草稿':'本机草稿已就绪','saved');}
  async function loadDraft({force=false}={}){if(!draft)localFailure();const snapshot=await draft.read();draftReady=true;adoptSnapshot(snapshot,{force});return snapshot;}
  function queueDraft(){if(frozen||form.dataset.submitting==='true')return;editSequence++;clearTimeout(draftTimer);draftMessage(draftReady?'正在暂存…':'输入待暂存…','saving');if(!draftReady)return;draftTimer=setTimeout(()=>{draftTimer=null;void saveDraft().catch(()=>{});},400);}
  function saveDraft(){if(!draftReady||draftBlocked||client.pending)return Promise.resolve();const sequence=editSequence;let value;try{value=readDraftFields();}catch(error){draftBlocked=true;draftMessage(error.message,'error');if(form.dataset.submitting!=='true')lock(false);return Promise.reject(error);}draftWrite=draftWrite.catch(()=>{}).then(async()=>{if(draftBlocked)localFailure();localWrites++;try{const saved=await draft.save(value);draftRevision=saved.revision;savedEditSequence=sequence;if(sequence===editSequence)draftMessage('本机已暂存','saved');}catch(error){draftBlocked=true;draftMessage(error.code==='CONFLICT'||error.code==='PENDING_IMMUTABLE'?'另一页签已更新，请先恢复本机草稿':'本机暂存失败，请保留当前输入','conflict');if(form.dataset.submitting!=='true')lock(false);throw error;}finally{localWrites--;checkDraftHints();}});return draftWrite;}
  async function flushDraft(){clearTimeout(draftTimer);draftTimer=null;if(!draftReady||draftBlocked)localFailure();await draftWrite.catch(()=>{});if(draftBlocked)localFailure();if(!client.pending)await saveDraft();}
  function checkDraftHints(){if(!watchPending||watchRead||localWrites||form.dataset.submitting==='true'||!draft)return;watchPending=false;watchRead=true;void draft.read().then(snapshot=>{if(localWrites||form.dataset.submitting==='true'){watchPending=true;return;}if(snapshot.revision===draftRevision)return;draftBlocked=true;draftMessage(snapshot.record?.kind==='pending_submission'?'另一页签有待核对申请，请先恢复':'另一页签已更新，请先恢复本机草稿','conflict');lock(false);}).catch(()=>{if(localWrites||form.dataset.submitting==='true'){watchPending=true;return;}draftBlocked=true;draftMessage('本机草稿暂不可核对','error');lock(false);}).finally(()=>{watchRead=false;checkDraftHints();});}
  async function initializeDraft(){try{draftStore=createBrowserDraftStore({indexedDB:globalThis.indexedDB});draft=createApplicationDraft({store:draftStore,eventId:eventConfig.id});await loadDraft();draftReady=true;if(!client.pending&&editSequence&&!draftBlocked)queueDraft();else if(!draftBlocked)draftMessage(client.pending?'上次申请结果待核对':draft.snapshot.record?'已恢复本机草稿':'本机草稿已就绪',client.pending?'pending':'saved');draft.subscribe(()=>{watchPending=true;checkDraftHints();});}catch{draftBlocked=true;draftMessage('本机暂存不可用，请保留当前输入','error');}}
  const draftInitialization=initializeDraft();
  form.addEventListener('input',event=>{if(!event.isComposing&&event.target.name!=='consentAccepted')queueDraft();});form.addEventListener('change',event=>{if(event.target.name!=='consentAccepted'){queueDraft();captureDraft();}});form.addEventListener('compositionend',queueDraft);
  for(const button of form.querySelectorAll('[data-application-draft-save]'))button.addEventListener('click',()=>{if(!client.pending)void flushDraft().catch(error=>draftMessage(error.message,'error'));});
  restoreDraft?.addEventListener('click',()=>{if(form.dataset.submitting==='true')return;clearTimeout(draftTimer);draftTimer=null;void draftWrite.catch(()=>{}).then(()=>loadDraft({force:true})).then(()=>{editSequence=0;savedEditSequence=0;lock(false);}).catch(error=>draftMessage(error.message,'error'));});
  clearDraft?.addEventListener('click',()=>{if(client.pending||form.dataset.submitting==='true')return;clearTimeout(draftTimer);draftTimer=null;localWrites++;void draftWrite.catch(()=>{}).then(()=>draft.clear()).then(snapshot=>{editSequence=0;savedEditSequence=0;draftRevision=snapshot.revision;form.reset();const branch=form.querySelector('[data-speaker-proposal]');branch.hidden=true;branch.disabled=true;draftMessage('本机草稿已清除','saved');}).catch(()=>{draftBlocked=true;draftMessage('本机草稿尚未清除','error');}).finally(()=>{localWrites--;checkDraftHints();});});
  function captureDraft(){if(!draftReady||draftBlocked||client.pending||frozen||form.dataset.submitting==='true'||editSequence<=savedEditSequence)return;clearTimeout(draftTimer);draftTimer=null;void saveDraft().catch(()=>{});}
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')captureDraft();});
  window.addEventListener('pagehide',captureDraft);
  function unavailable(reason) {
    const closed=reason==='closed';
    form.dataset.registrationMode=client.pending?'recovery':closed?'closed':'unavailable';
    submit.disabled=!client.pending;
    submit.textContent=client.pending?'核对原申请结果':closed?'参会申请已关闭':'参会申请暂不可用';
    const message=closed?'本站已停止接收新申请。已保存申请的审核及结果查询不受影响。':'申请服务暂时无法确认，请稍后再试。当前不会提交或保存资料。';
    section.querySelector('[data-registration-notice]').textContent=message;
    section.querySelector('[data-registration-mode-label]').textContent=closed?'申请已关闭':'服务暂不可用';
    section.querySelector('[data-registration-open-label]').textContent='参会申请';
    section.querySelector('[data-registration-disclaimer]').textContent=message;
    section.querySelector('[data-registration-data-hint]').textContent='当前不受理提交，请勿填写真实资料。';
    for(const control of trackedControls())control.disabled=true;
    for(const status of document.querySelectorAll('[data-registration-availability]'))status.textContent=closed?'申请已关闭':'申请服务暂不可用';
    for(const faq of document.querySelectorAll('[data-public-faq] details'))if(faq.querySelector('summary')?.textContent.startsWith('现在可以报名吗？')){const answer=faq.querySelector('p');if(answer)answer.textContent=message;}
    document.dispatchEvent(new CustomEvent('artdico:registration-unavailable',{detail:{message}}));
  }
  function announce(message) { summary.textContent = message; summary.hidden = false; summary.focus(); }
  function lock(value) {
    form.dataset.submitting = String(value);
    form.dataset.applicationPending=String(frozen);
    if(clearDraft)clearDraft.hidden=client.pending||draftBlocked||!draftReady||!draft?.snapshot?.record;
    if(frozen&&!value&&!draftBlocked)draftMessage('上次申请结果待核对','pending');
    submit.disabled = value || !client.pending&&(!config||draftBlocked||!draftReady);
    for(const button of form.querySelectorAll('[data-application-draft-save],[data-application-draft-clear],[data-application-draft-restore]'))button.disabled=value||client.pending&&button!==restoreDraft;
    for (const control of trackedControls()) {
      if (value || frozen || !config) { if (!control.disabled) { control.dataset.registrationLocked = 'true'; control.disabled = true; } }
      else if (control.dataset.registrationLocked) { control.disabled = false; delete control.dataset.registrationLocked; }
    }
    submit.textContent = value ? '正在确认申请结果…' : frozen ? '再次确认申请结果' : '提交参会申请';
    if(!value)checkDraftHints();
  }
  async function submitFields(fields) {
    if ((!config&&!client.pending) || form.dataset.submitting === 'true') return;
    lock(true); summary.hidden = true;
    try {
      const result = client.pending?await client.resume():await client.submit(fields);
      provenReceipt=true;savedEditSequence=editSequence;if(result.localRecoveryRetained)draftMessage('申请已收到，本机恢复记录待清理','error');
      if (!renderRegistrationSuccess(receipt,result)) {
        const labels={pending_review:'申请已收到，待主办方审核；尚未确认参会名额。编号：',confirmed:'参会名额已确认，编号：',waitlisted:'候补登记已保存，尚未确认参会。编号：',rejected:'本次申请未通过审核，编号：',withdrawn:'申请已撤回，编号：'};const fallback=node('p',(labels[result.body.admissionStatus]||'申请结果需核对，编号：')+result.body.reference_code+'。请保留编号，无需重复提交。');
        fallback.setAttribute('role','status');section.append(fallback);
      }
      frozen = false;
      pendingFields = null;
      form.dispatchEvent(new Event('artdico:registration-saved'));
      if (result.body.confirmation) { location.assign(result.body.confirmation.confirmationUrl); return; }
      receipt?.querySelector('h3,h2')?.focus();
    } catch (error) {
      frozen = client.pending;
      if (!frozen) {pendingFields = null;form.elements.namedItem('consentAccepted').checked=false;}
      if(!frozen&&draft)try{if(error.code==='INVALID')await loadDraft({force:true});else{const current=await draft.read();if(current.record?.kind==='pending_submission'&&JSON.stringify(JSON.parse(current.record.value.payloadJson).fields)===JSON.stringify(fields))adoptSnapshot(current,{force:true});else{draftBlocked=true;draftMessage('本机记录有变化，当前输入仍保留','conflict');}}}catch{draftBlocked=true;draftMessage('本机草稿暂不可核对，当前输入仍保留','error');}
      announce(error.message || '申请尚未确认保存，请保留本页并明确核对同一申请结果。');
    } finally { lock(false); }
  }
  form.addEventListener('artdico:registration-submit', event => {
    if(event.detail?.fields?.consentAccepted!==true)return;
    pendingFields=registrationFields(event.detail.fields);
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
    const details = section.querySelector('[data-registration-policy-details]');
    const labels = {processor:'处理者',contactEmail:'联系邮箱',purpose:'使用目的',storageRegion:'存储地区',retention:'保留期限',rightsRequest:'查阅、更正、撤回及删除',sharing:'资料分享范围',version:'告知版本'};
    details.replaceChildren();
    for (const [key,label] of Object.entries(labels)) details.append(node('dt',label),node('dd',value.privacy[key]));
    details.append(node('dt','全场人数与截止时间'),node('dd','全场人数上限 '+value.capacity+' 人；申请截止 '+new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Taipei',dateStyle:'medium',timeStyle:'short'}).format(new Date(value.closesAt))+'（UTC+8）。申请须人工审核，待审核不占参会名额。'));
    section.querySelector('[data-registration-policy]').hidden = false;
    const admissions = value.admissions;
    if (admissions) details.append(node('dt','当前参会名额'),node('dd','已确认 '+admissions.confirmedCount+' 人；候补 '+admissions.waitlistCount+' 人。提交申请不保留名额；审核通过时再按共同容量确认名额或候补。'));
    section.querySelector('[data-registration-notice]').textContent='提交申请 → 主办方审核 → 确认名额与邀请';
    section.querySelector('[data-registration-open-label]').textContent = '参会申请';
    section.querySelector('[data-registration-mode-label]').textContent = '人工审核';
    section.querySelector('[data-registration-data-hint]').textContent = '带 * 为必填。学校／机构、城市、微信可不填。';
    section.querySelector('[data-registration-disclaimer]').textContent = '本机暂存不等于提交；提交后等待审核。';
    const consentCopy = form.querySelector('[data-registration-consent-copy]');
    consentCopy.replaceChildren(document.createTextNode('我已阅读以上个人信息处理告知，并同意按告知范围处理本次申请资料。'));
    const consent = form.elements.namedItem('consentAccepted');
    consent.checked = false;
    const consentHint = document.getElementById('field-consentAccepted-hint');
    if (consentHint) consentHint.textContent = '请主动勾选。工作人员不会代替你完成个人信息处理同意。';
    const emailHint = document.getElementById('field-email-hint');
    if (emailHint) emailHint.textContent = '用于查询申请及接收审核后的通知。';
    submit.textContent = '提交参会申请';
    lock(false);
    form.dataset.registrationMode = 'production';
    for(const status of document.querySelectorAll('[data-registration-availability]'))status.textContent='参会申请开放，须人工审核';
    document.dispatchEvent(new CustomEvent('artdico:registration-ready',{detail:{privacy:value.privacy,closesAt:value.closesAt}}));
  }).catch(async() => {
    await draftInitialization;
    unavailable('unavailable');
  });
}
