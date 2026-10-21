import {createOperationsFormDraft,operationsDraftStore,captureDraftFields,applyDraftFields} from '../lib/operations-form-draft.mjs';
import {canManageEventOperations} from '../../shared/staff-permissions.mjs';
import {registrationSchema} from '../../shared/registration-schema.mjs';
import {admissionLabels} from '../lib/admission-view.mjs';
import {createStaffAdmissions} from './staff-admissions.mjs';
import {downloadPrivateXlsx} from '../lib/xlsx-download.mjs';

const $=selector=>document.querySelector(selector);
const statuses={new:'新报名',in_review:'核查中',awaiting_maria:'待 Maria 审阅',approved:'内部建议通过（不授予名额）',discussion:'待讨论',not_this_time:'本次不邀请',withdrawn:'已撤回'};
const accommodations={not_requested:'未申请',requested:'已申请',pending:'待核对',approved:'已批准',declined:'未批准'};
const categories=Object.fromEntries(registrationSchema.identityOptions.map(item=>[item.value,item.label]));
const reviewFields=['status','accommodationStatus','recommendation','proposedRole','internalNotes','assignedTo','lastContactDate','nextStep','mariaReviewDate','mariaFeedback','mariaDecision','invitationStatus'];
let user=null,csrfToken='',revision=0,nextCursor=null,selected=null,busy=false,dirty=false;
let sessionGeneration=0;
let filters={};
let reviewDraft=null,reviewPending=null;
function openReviewDraft(){
  reviewDraft?.close();reviewPending=null;const id=selected.id,generation=sessionGeneration,form=$('[data-review-form]');
  reviewDraft=createOperationsFormDraft({actorId:user.id,roles:user.roles,page:'review',entity:id,form,baseRevision:()=>selected?.revision,isCurrent:()=>generation===sessionGeneration&&selected?.id===id&&Boolean(user),capture:()=>captureDraftFields(form,reviewFields),apply:fields=>{applyDraftFields(form,fields,reviewFields);dirty=true;renderAdmissionDecision();},manualPending:true,onPending:request=>{if(request.path!=='/api/admin/registrations/'+encodeURIComponent(id)+'/review'||request.method!=='PATCH')throw new Error('原审核保存操作无法核对。');reviewPending=JSON.parse(request.body);dirty=true;},onChange:event=>{if(event.error?.code==='STALE_ACTOR'){clear();return;}if(event.status==='discarded')reviewPending=null;lock();}});void reviewDraft.load();
}

const privateExportUrls=new Set();
const staffAdmissions=createStaffAdmissions({root:$('[data-staff-admissions]'),request,openRecord:id=>action(()=>openRecord(id)),onChange:()=>load(),onStateChange:renderAdmissionDecision,onActorCleared:clear,onNotice:message=>{$('[data-review-admission-notice]').textContent=message;}});
let pendingRegistration=null;
let pendingSettingsAnchor=['#staff-settings-title','#delivery-settings-heading'].includes(location.hash)?location.hash:null;
if(location.hash.startsWith('#registration=')){try{const raw=decodeURIComponent(location.hash.slice(14));if(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/u.test(raw))pendingRegistration=raw;}catch{}history.replaceState(null,'',location.pathname+location.search);}
function node(tag,text,className){const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(className)element.className=className;return element;}
function announce(message,error=false){$('[data-review-status]').textContent=error?'':message;$('[data-review-error]').textContent=error?message:'';$('[data-review-error]').hidden=!error;}
function allowed(){return user?.roles.some(role=>['reviewer','superadmin'].includes(role));}
function lock(){
  $('[data-review-login-submit]').disabled=busy||location.protocol==='file:';
  for(const element of document.querySelectorAll('[data-review-workspace] button,[data-review-workspace] input,[data-review-workspace] select,[data-review-form] input,[data-review-form] select,[data-review-form] textarea,[data-review-form] button'))element.disabled=busy||!allowed();
  $('[data-review-logout]').disabled=busy;
  $('[data-review-deletion]').disabled=busy||!user?.roles.includes('superadmin')||!selected;
  for(const selector of ['[data-review-export]','[data-review-export-xlsx]','[data-review-export-contact]','[data-review-export-answers]'])$(selector).disabled=busy||!canManageEventOperations(user);
  $('[data-review-export-arrangements]').disabled=busy||!canManageEventOperations(user);
  for(const field of $('[data-review-form]').elements)field.disabled=busy||!allowed()||Boolean(reviewDraft?.blocked)||Boolean(reviewPending);
  // Draft recovery controls remain usable while the cloud-save controls are locked.
  for(const field of $('[data-review-form]').querySelectorAll('.operations-local-draft button'))field.disabled=busy||!allowed();
  staffAdmissions.lock(busy||!allowed());
  for(const button of document.querySelectorAll('[data-review-detail-close]'))button.disabled=busy;
  renderAdmissionDecision();
}
function clear(){
  reviewDraft?.close();reviewDraft=null;reviewPending=null;
  sessionGeneration+=1;
  for(const url of privateExportUrls)URL.revokeObjectURL(url);privateExportUrls.clear();
  staffAdmissions.clear();
  user=null;csrfToken='';revision=0;nextCursor=null;selected=null;dirty=false;filters={};busy=false;pendingRegistration=null;
  $('[data-review-workspace]').hidden=true;$('[data-review-account]').hidden=true;$('[data-review-login-panel]').hidden=false;
  for(const selector of ['[data-review-rows]','[data-review-metrics]','[data-review-details]'])$(selector).replaceChildren();
  $('[data-review-form]').reset();$('[data-review-filters]').reset();$('[data-review-export-contact]').checked=false;
  $('[data-review-export-answers]').checked=false;$('[data-review-export-arrangements]').checked=false;
  $('[data-review-login]').reset();
  $('[data-review-detail-title]').textContent='报名资料';
  for(const selector of ['[data-review-user]','[data-review-result-count]','[data-review-provenance]','[data-review-detail-error]','[data-review-deletion-state]','[data-review-admission-notice]','[data-review-status]','[data-review-error]'])$(selector).textContent='';
  $('[data-review-detail-error]').hidden=true;$('[data-review-error]').hidden=true;$('[data-review-next]').hidden=true;$('[data-review-empty]').hidden=true;
  renderAdmissionDecision();
  if($('[data-review-dialog]').open)$('[data-review-dialog]').close();
  lock();
}
async function request(path,options={}){
  const generation=sessionGeneration;
  const response=await fetch(path,{...options,credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(options.method&&options.method!=='GET'&&csrfToken?{'X-CSRF-Token':csrfToken}:{})}});
  if(generation!==sessionGeneration)throw new Error('会话已改变，请重新登录。');
  if(response.status===401){clear();throw new Error(path==='/api/admin/login'?'账号或密码未通过验证。':'会话已结束，请重新登录。');}
  if(response.status===403){clear();const error=new Error('此账号没有相应权限，请重新登录核对。');error.status=403;throw error;}
  if(!response.ok){
    const messages={403:'此账号没有相应的报名读取、修改或导出权限。',409:'记录版本已改变，你的编辑仍保留在本页。请先核对并保留修改，再刷新最新记录。',422:'请检查核查字段、日期与状态是否完整有效。',429:'请求较多，请稍后重试。',503:'报名服务暂时不可用，请稍后重试。'};
    let message=messages[response.status]||'操作尚未完成，请稍后重试。';
    if(response.status===409&&path==='/api/admin/admissions/approve'){
      const detail=await response.json().catch(()=>null);
      if(generation!==sessionGeneration)throw new Error('会话已改变，请重新登录。');
      if(detail?.error?.code==='CAPACITY_CONFLICT')message='当前无可用名额且未开放候补，申请仍待审核。请刷新名额后核对安排。';
    }
    const error=new Error(message);error.status=response.status;throw error;
  }
  const result=await response.json().catch(()=>null);
  if(generation!==sessionGeneration)throw new Error('会话已改变，请重新登录。');
  if(!result||typeof result!=='object')throw new Error('服务返回结果无效，请稍后重试。');
  return result;
}
async function action(callback){if(busy)return;const generation=sessionGeneration;busy=true;lock();try{await callback();}catch(error){if(generation===sessionGeneration||!user)announce(error.message||'操作未完成。',true);}finally{if(generation===sessionGeneration){busy=false;lock();}}}
function readFilters(){return Object.fromEntries(['query','city','category','status','accommodation','attendance'].map(name=>[name,$('[data-review-filters]').elements.namedItem(name).value.trim()]).filter(([,value])=>value));}
function renderStats(state){
  const summary=state.stats??{},output=$('[data-review-metrics]');output.replaceChildren();
  for(const[label,count]of[['全部已保存报名',state.overallTotal??summary.overallTotal??state.total],['当前筛选',state.total],['筛选内内部建议通过',summary.byStatus?.approved??0],['筛选内住宿批准',summary.byAccommodation?.approved??0]]){
    const card=node('article');card.append(node('span',label),node('strong',String(Number.isSafeInteger(count)?count:0)));output.append(card);
  }
}
function cell(row,label,text){const item=node('td',text);item.dataset.label=label;row.append(item);return item;}
function renderRows(records){
  const output=$('[data-review-rows]');output.replaceChildren();
  for(const record of records){
    if(typeof record.id!=='string')continue;
    const row=node('tr'),fields=record.fields??{},review=record.review??{};
    const name=cell(row,'姓名 / 机构',fields.name||'未填写姓名');name.append(node('small',fields.organization||'机构未填写'));
    const location=cell(row,'城市 / 类别',fields.city||'—');location.append(node('small',(fields.categories??[]).map(value=>categories[value]??value).join(' / ')));
    const admission=cell(row,'申请 / 名额','名额状态待核对');admission.dataset.reviewAdmissionRow=record.id;
    cell(row,'内部核查',statuses[review.status]??'待核对');cell(row,'住宿',accommodations[review.accommodationStatus]??'待核对');
    cell(row,'来源',record.provenance?.kind==='staff_assisted'?'工作人员代登记':record.provenance?.kind==='staff_entry'?'受托逐人登记':'申请人自行提交');
    cell(row,'保存时间',typeof record.submittedAt==='string'?record.submittedAt.replace('T',' ').replace(/\.\d+Z$/u,' UTC'):'—');
    const actions=cell(row,'操作');const button=node('button','查看与核查','ah-admin-button');button.type='button';button.addEventListener('click',()=>action(()=>openRecord(record.id)));const person=node('a','个人工作页','ah-admin-button');person.href='/admin/person/#registration='+encodeURIComponent(record.id);actions.append(button,person);output.append(row);
  }
  $('[data-review-empty]').hidden=records.length>0;
  renderAdmissionDecision();
}
async function load(cursor){
  if(!allowed())throw new Error('此账号没有报名审核权限。');
  const generation=sessionGeneration;
  const params=new URLSearchParams({...filters,limit:'20',...(cursor?{cursor}:{} )});
  const state=await request('/api/admin/registrations?'+params);
  if(generation!==sessionGeneration)return;
  if(!Array.isArray(state.registrations)||!Number.isSafeInteger(state.revision)||!Number.isSafeInteger(state.total))throw new Error('报名列表结果无效，请稍后重试。');
  revision=state.revision;nextCursor=typeof state.nextCursor==='string'?state.nextCursor:null;
  renderStats(state);renderRows(state.registrations);
  $('[data-review-result-count]').textContent='本页 '+state.registrations.length+' 条 · 符合筛选 '+state.total+' 条';
  $('[data-review-next]').hidden=!nextCursor;
  $('[data-review-login-panel]').hidden=true;$('[data-review-workspace]').hidden=false;$('[data-review-account]').hidden=false;$('[data-review-user]').textContent=user.label||user.id;
  if(pendingRegistration){const id=pendingRegistration;pendingRegistration=null;await openRecord(id);}
  if(generation!==sessionGeneration)return;
  await staffAdmissions.configure(user,state.registrations);
  if(pendingSettingsAnchor){
    const anchor=pendingSettingsAnchor;pendingSettingsAnchor=null;
    requestAnimationFrame(()=>{if(generation!==sessionGeneration||location.hash!==anchor)return;const heading=document.getElementById(anchor.slice(1));if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});heading.scrollIntoView({block:'start',behavior:'instant'});}});
  }
}
function pair(output,label,value){if(value===undefined||value===null||value==='')return;output.append(node('dt',label),node('dd',Array.isArray(value)?value.join(' / '):String(value)));}
function renderDetails(record){
  const output=$('[data-review-details]');output.replaceChildren();const fields=record.fields??{};
  pair(output,'报名编号',record.referenceCode);pair(output,'受理时间',record.submittedAt);
  for(const field of registrationSchema.baseFields){
    if(field.name==='consentAccepted')continue;
    let value=fields[field.name];
    if(field.options){const labels=Object.fromEntries(field.options.map(item=>[item.value,item.label]));value=Array.isArray(value)?value.map(item=>labels[item]??item):labels[value]??value;}
    pair(output,field.label,value);
  }
  for(const[name,branch]of Object.entries(registrationSchema.branches))if(name!=='accommodation'&&fields[name])for(const field of branch.fields)pair(output,branch.label+' / '+field.label,fields[name][field.name]);
  pair(output,'隐私告知版本',record.consent?.version);pair(output,'本人同意时间',record.consent?.acceptedAt);
}
async function openRecord(id){
  if(dirty&&!confirm('还有未保存的核查修改，放弃后打开另一条记录吗？'))return;
  const generation=sessionGeneration;if(dirty&&!reviewDraft?.blocked&&!reviewPending)await reviewDraft?.flush().catch(()=>{});if(generation!==sessionGeneration)return;
  const result=await request('/api/admin/registrations/'+encodeURIComponent(id));
  if(generation!==sessionGeneration)return;
  if(!result.registration||!Number.isSafeInteger(result.revision))throw new Error('报名详情结果无效。');
  const review=result.review??result.registration.review??{};selected={...result.registration,review,revision:result.revision};revision=result.revision;dirty=false;
  $('[data-review-detail-title]').textContent=(selected.fields?.name||'报名资料')+' · 内部核查';renderDetails(selected);
  $('[data-review-provenance]').textContent=['staff_assisted','staff_entry'].includes(selected.provenance?.kind)?(selected.provenance.kind==='staff_entry'?'工作人员根据已核定许可逐人登记。':'工作人员根据既有意向资料代登记。')+'此记录不代表本人完成网站隐私同意；原始来源与联络许可须分别核对。':'申请人通过正式表单提交，隐私同意版本与时间随原始报名保存。';
  const form=$('[data-review-form]');for(const name of reviewFields)form.elements.namedItem(name).value=review[name]??'';
  $('[data-review-deletion-state]').textContent=review.deletionRequested?'已登记删除申请；尚未宣称完成数据擦除，后续须按受控维护流程处理。':'';
  $('[data-review-detail-error]').hidden=true;
  $('[data-review-admission-notice]').textContent='';
  renderAdmissionDecision();
  if(!$('[data-review-dialog]').open)$('[data-review-dialog]').showModal();openReviewDraft();
}
function renderAdmissionDecision(){
  const person=selected?staffAdmissions.person(selected.id):null;
  $('[data-review-admission-status]').textContent=person?'当前状态：'+(admissionLabels[person.status]||'需刷新核对')+'。':'实际名额状态尚未核对，请先刷新名额。';
  const disabled=busy||!allowed()||dirty||staffAdmissions.pending||person?.status!=='pending_review';
  $('[data-review-approve]').disabled=disabled;$('[data-review-reject]').disabled=disabled;
  $('[data-review-admission-pending]').hidden=!staffAdmissions.pending;
  $('[data-review-admission-retry]').disabled=busy||!allowed()||!staffAdmissions.pending;
  for(const cell of document.querySelectorAll('[data-review-admission-row]')){const current=staffAdmissions.person(cell.dataset.reviewAdmissionRow);cell.textContent=current?admissionLabels[current.status]||'需核对':'名额状态待核对';}
}
async function admissionAction(callback){
  if(busy||!allowed())return;
  if(dirty){$('[data-review-admission-notice]').textContent='请先保存内部核查修改，或关闭并放弃修改，再执行正式审核。';return;}
  const work=callback();if(!work)return;
  const generation=sessionGeneration;busy=true;lock();
  try{await work;}finally{if(generation===sessionGeneration){busy=false;lock();}}
}
$('[data-review-approve]').addEventListener('click',()=>{if(selected)admissionAction(()=>staffAdmissions.reviewApplication(selected.id,'approve'));});
$('[data-review-reject]').addEventListener('click',()=>{if(selected)admissionAction(()=>staffAdmissions.reviewApplication(selected.id,'reject'));});
$('[data-review-admission-retry]').addEventListener('click',()=>admissionAction(()=>staffAdmissions.retry()));
async function closeDetail(){if(busy)return;const generation=sessionGeneration;if(dirty&&!confirm('关闭表单并保留本机草稿？'))return;if(dirty&&!reviewDraft?.blocked&&!reviewPending)await reviewDraft?.flush().catch(()=>{});if(generation!==sessionGeneration)return;reviewDraft?.close();reviewDraft=null;reviewPending=null;dirty=false;selected=null;$('[data-review-dialog]').close();$('[data-review-form]').reset();$('[data-review-details]').replaceChildren();}
$('[data-review-login]').addEventListener('submit',event=>{
  event.preventDefault();const form=event.currentTarget;if(!form.reportValidity())return;const login=Object.fromEntries(new FormData(form));
  action(async()=>{let result;try{result=await request('/api/admin/login',{method:'POST',body:JSON.stringify(login)});}finally{form.elements.namedItem('password').value='';login.password='';}user=result.user;csrfToken=result.csrfToken;await load();announce('已登录。请按需要核查，避免导出或分享无关个人资料。');});
});
$('[data-review-logout]').addEventListener('click',()=>action(async()=>{if((dirty||staffAdmissions.pending)&&!confirm('退出并清除本机草稿及待核对操作？云端结果需另行核对。'))return;const actorId=user?.id;reviewDraft?.close();staffAdmissions.clear();try{if(actorId)await operationsDraftStore().clearActor(actorId);}finally{try{await request('/api/admin/logout',{method:'POST'});}finally{clear();}}announce('已退出，本机填写与报名资料已清空。');}));
$('[data-review-filters]').addEventListener('submit',event=>{event.preventDefault();filters=readFilters();action(()=>load());});
$('[data-review-filters]').addEventListener('reset',()=>{filters={};queueMicrotask(()=>action(()=>load()));});
$('[data-review-refresh]').addEventListener('click',()=>action(async()=>{if(dirty&&!confirm('有未保存修改，放弃后刷新吗？'))return;if(dirty&&!reviewDraft?.blocked&&!reviewPending)await reviewDraft?.flush().catch(()=>{});reviewDraft?.close();reviewDraft=null;reviewPending=null;dirty=false;selected=null;if($('[data-review-dialog]').open)$('[data-review-dialog]').close();await load();announce('已读取最新保存记录。');}));
$('[data-review-next]').addEventListener('click',()=>action(()=>load(nextCursor)));
for(const button of document.querySelectorAll('[data-review-detail-close]'))button.addEventListener('click',closeDetail);
$('[data-review-dialog]').addEventListener('cancel',event=>{event.preventDefault();closeDetail();});
$('[data-review-form]').addEventListener('input',()=>{dirty=true;renderAdmissionDecision();});
$('[data-review-form]').addEventListener('change',()=>{dirty=true;renderAdmissionDecision();});
$('[data-review-form]').addEventListener('submit',event=>{
  event.preventDefault();if(!selected||reviewDraft?.blocked||reviewPending||!event.currentTarget.reportValidity())return;
  const review=Object.fromEntries(reviewFields.map(name=>[name,event.currentTarget.elements.namedItem(name).value]));const id=selected.id,expectedRevision=selected.revision,generation=sessionGeneration;
  action(async()=>{try{const path='/api/admin/registrations/'+encodeURIComponent(id)+'/review',body=JSON.stringify({expectedRevision,review});await reviewDraft.markPending({path,method:'PATCH',body});reviewPending={expectedRevision,review};await request(path,{method:'PATCH',body});const checked=await request('/api/admin/registrations/'+encodeURIComponent(id));const saved=checked.review??checked.registration?.review;if(!Number.isSafeInteger(checked.revision)||checked.revision<=expectedRevision||!saved||!Object.entries(review).every(([key,value])=>saved[key]===value))throw new Error('云端核查结果尚未与本次填写一致，请手动核对。');await reviewDraft.acknowledge();reviewPending=null;dirty=false;await openRecord(id);await load();announce('核查记录已保存。未发送通知或公开报名资料。');}catch(error){if(generation===sessionGeneration&&error.status>=400&&error.status<500){await reviewDraft?.acknowledge();reviewPending=null;}if(generation===sessionGeneration&&selected?.id===id){$('[data-review-detail-error]').textContent=error.message;$('[data-review-detail-error]').hidden=false;$('[data-review-detail-error]').focus();}throw error;}});
});
$('[data-review-deletion]').addEventListener('click',()=>{
  if(!selected||!user?.roles.includes('superadmin'))return;if(dirty){announce('请先保存或放弃核查修改，再登记删除申请。',true);return;}
  const reason=prompt('填写收到删除申请的依据（不要重复输入证件或其他敏感资料）。此操作仅登记申请，不表示资料已被擦除。');if(!reason?.trim())return;
  const id=selected.id,expectedRevision=selected.revision;action(async()=>{await request('/api/admin/registrations/'+encodeURIComponent(id)+'/deletion-request',{method:'POST',body:JSON.stringify({expectedRevision,reason:reason.trim()})});await openRecord(id);announce('已登记删除申请。实际删除及历史快照、备份处理仍需受控维护流程。');});
});
$('[data-review-export-xlsx]').addEventListener('click',()=>action(async()=>{
  const generation=sessionGeneration;
  if(dirty)throw new Error('请先保存或放弃核查修改，再导出。');
  const includeContact=$('[data-review-export-contact]').checked,includeAnswers=$('[data-review-export-answers]').checked,includeArrangements=$('[data-review-export-arrangements]').checked;
  if(!confirm('确认导出当前筛选的 Excel？'+(includeContact?'包含联络字段。':'不含结构化联络字段。')+(includeAnswers?'包含完整原始回答；请特别核对自由文本。':'')+(includeArrangements?'另含当前角色与场次／展位。':'')+'请核对接收范围。'))return;
  let result;
  try{result=await downloadPrivateXlsx({path:'/api/admin/registrations/export.xlsx',body:{expectedRevision:revision,filters,includeContact,includeAnswers,includeArrangements},csrfToken,filename:'artdico-registration-attendance.xlsx',isCurrent:()=>generation===sessionGeneration&&Boolean(user),onPrivateUrl:url=>privateExportUrls.add(url)});}catch(error){if(generation===sessionGeneration&&[401,403].includes(error.status))clear();throw error;}
  if(generation!==sessionGeneration)return;revision=result.revision;
  try{await load();}catch(error){if(generation===sessionGeneration)announce('Excel 已开始下载且已记录审计；列表刷新未完成，请稍后明确刷新核对。',true);return;}
  if(generation===sessionGeneration)announce('Excel 已生成并开始下载（'+result.count+' 份报名）；原始回答、当前名额与职责分别记录。请按核定范围使用。');
}));
$('[data-review-export]').addEventListener('click',()=>action(async()=>{
  const generation=sessionGeneration;
  if(dirty)throw new Error('请先保存或放弃核查修改，再导出。');
  const includeContact=$('[data-review-export-contact]').checked;
  if(!confirm(includeContact?'确认导出当前筛选，包含联络方式？请先核对接收者与必要范围。':'确认导出当前筛选的最小必要资料？默认不包含联络方式。'))return;
  const response=await fetch('/api/admin/registrations/export',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify({expectedRevision:revision,filters,includeContact})});
  if(generation!==sessionGeneration)throw new Error('会话已改变，未提供导出下载。');
  if(response.status===401){clear();throw new Error('会话已结束，请重新登录。');}
  if(response.status===403){clear();throw new Error('此账号没有导出权限，请重新登录核对。');}
  if(!response.ok||!response.headers.get('content-type')?.toLowerCase().startsWith('text/csv'))throw new Error(response.status===403?'此账号没有导出权限。':response.status===409?'记录版本已更新，请刷新后重新核对导出范围。':'导出未完成，请稍后重试。');
  const blob=await response.blob();if(blob.size>4*1024*1024)throw new Error('导出超过页面下载上限，请缩小筛选范围。');
  if(generation!==sessionGeneration)throw new Error('会话已改变，未提供导出下载。');
  const url=URL.createObjectURL(blob),link=node('a');privateExportUrls.add(url);link.href=url;link.download='artdico-registration-review.csv';document.body.append(link);link.click();link.remove();setTimeout(()=>{URL.revokeObjectURL(url);privateExportUrls.delete(url);},10000);
  await load();announce('CSV 已生成并开始下载，服务端已记录导出操作。请按核定范围使用。');
}));
window.addEventListener('beforeunload',event=>{if(dirty||staffAdmissions.pending){event.preventDefault();event.returnValue='';}});
if(location.protocol==='https:'||location.hostname==='127.0.0.1'||location.hostname==='localhost')action(async()=>{
  const response=await fetch('/api/admin/session',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});if(response.status===401)return;if(!response.ok)throw new Error('报名后台暂未就绪，请稍后重试。');const result=await response.json();user=result.user;csrfToken=result.csrfToken;$('[data-review-account]').hidden=false;$('[data-review-user]').textContent=user?.label||user?.id||'';await load();
});else announce('请通过已配置的 HTTPS 工作人员入口登录。');
lock();
