import {registrationSchema} from '../../shared/registration-schema.mjs';
import {createStaffAdmissions} from './staff-admissions.mjs';
import {downloadPrivateXlsx} from '../lib/xlsx-download.mjs';

const $=selector=>document.querySelector(selector);
const statuses={new:'新报名',in_review:'核查中',awaiting_maria:'待 Maria 审阅',approved:'已确认',discussion:'待讨论',not_this_time:'本次不邀请',withdrawn:'已撤回'};
const accommodations={not_requested:'未申请',requested:'已申请',pending:'待核对',approved:'已批准',declined:'未批准'};
const categories=Object.fromEntries(registrationSchema.identityOptions.map(item=>[item.value,item.label]));
const reviewFields=['status','accommodationStatus','recommendation','proposedRole','internalNotes','assignedTo','lastContactDate','nextStep','mariaReviewDate','mariaFeedback','mariaDecision','invitationStatus'];
let user=null,csrfToken='',revision=0,nextCursor=null,selected=null,busy=false,dirty=false;
let sessionGeneration=0;
let filters={};
const privateExportUrls=new Set();
const staffAdmissions=createStaffAdmissions({root:$('[data-staff-admissions]'),request,openRecord:id=>action(()=>openRecord(id)),onChange:()=>load()});
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
  for(const selector of ['[data-review-export]','[data-review-export-xlsx]','[data-review-export-contact]','[data-review-export-answers]'])$(selector).disabled=busy||!user?.roles.includes('superadmin');
  $('[data-review-export-arrangements]').disabled=busy||!user?.roles.includes('superadmin');
  staffAdmissions.lock(busy||!allowed());
}
function clear(){
  sessionGeneration+=1;
  for(const url of privateExportUrls)URL.revokeObjectURL(url);privateExportUrls.clear();
  staffAdmissions.clear();
  user=null;csrfToken='';revision=0;nextCursor=null;selected=null;dirty=false;filters={};
  $('[data-review-workspace]').hidden=true;$('[data-review-account]').hidden=true;$('[data-review-login-panel]').hidden=false;
  for(const selector of ['[data-review-rows]','[data-review-metrics]','[data-review-details]'])$(selector).replaceChildren();
  $('[data-review-form]').reset();$('[data-review-filters]').reset();$('[data-review-export-contact]').checked=false;
  $('[data-review-export-answers]').checked=false;$('[data-review-export-arrangements]').checked=false;
  if($('[data-review-dialog]').open)$('[data-review-dialog]').close();
}
async function request(path,options={}){
  const generation=sessionGeneration;
  const response=await fetch(path,{...options,credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(options.method&&options.method!=='GET'&&csrfToken?{'X-CSRF-Token':csrfToken}:{})}});
  if(generation!==sessionGeneration)throw new Error('会话已改变，请重新登录。');
  if(response.status===401){clear();throw new Error(path==='/api/admin/login'?'账号或密码未通过验证。':'会话已结束，请重新登录。');}
  if(!response.ok){
    const messages={403:'此账号没有相应的报名读取、修改或导出权限。',409:'记录版本已改变，你的编辑仍保留在本页。请先核对并保留修改，再刷新最新记录。',422:'请检查核查字段、日期与状态是否完整有效。',429:'请求较多，请稍后重试。',503:'报名服务暂时不可用，请稍后重试。'};
    const error=new Error(messages[response.status]||'操作尚未完成，请稍后重试。');error.status=response.status;throw error;
  }
  const result=await response.json().catch(()=>null);
  if(generation!==sessionGeneration)throw new Error('会话已改变，请重新登录。');
  if(!result||typeof result!=='object')throw new Error('服务返回结果无效，请稍后重试。');
  return result;
}
async function action(callback){if(busy)return;busy=true;lock();try{await callback();}catch(error){announce(error.message||'操作未完成。',true);}finally{busy=false;lock();}}
function readFilters(){return Object.fromEntries(['query','city','category','status','accommodation','attendance'].map(name=>[name,$('[data-review-filters]').elements.namedItem(name).value.trim()]).filter(([,value])=>value));}
function renderStats(state){
  const summary=state.stats??{},output=$('[data-review-metrics]');output.replaceChildren();
  for(const[label,count]of[['全部已保存报名',state.overallTotal??summary.overallTotal??state.total],['当前筛选',state.total],['筛选内审核确认',summary.byStatus?.approved??0],['筛选内住宿批准',summary.byAccommodation?.approved??0]]){
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
    cell(row,'审核状态',statuses[review.status]??'待核对');cell(row,'住宿',accommodations[review.accommodationStatus]??'待核对');
    cell(row,'来源',record.provenance?.kind==='staff_assisted'?'工作人员代登记':record.provenance?.kind==='staff_entry'?'受托逐人登记':'申请人自行提交');
    cell(row,'保存时间',typeof record.submittedAt==='string'?record.submittedAt.replace('T',' ').replace(/\.\d+Z$/u,' UTC'):'—');
    const actions=cell(row,'操作');const button=node('button','查看与核查','ah-admin-button');button.type='button';button.addEventListener('click',()=>action(()=>openRecord(record.id)));const person=node('a','个人工作页','ah-admin-button');person.href='/admin/person/#registration='+encodeURIComponent(record.id);actions.append(button,person);output.append(row);
  }
  $('[data-review-empty]').hidden=records.length>0;
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
  const generation=sessionGeneration;
  const result=await request('/api/admin/registrations/'+encodeURIComponent(id));
  if(generation!==sessionGeneration)return;
  if(!result.registration||!Number.isSafeInteger(result.revision))throw new Error('报名详情结果无效。');
  const review=result.review??result.registration.review??{};selected={...result.registration,review,revision:result.revision};revision=result.revision;dirty=false;
  $('[data-review-detail-title]').textContent=(selected.fields?.name||'报名资料')+' · 内部核查';renderDetails(selected);
  $('[data-review-provenance]').textContent=['staff_assisted','staff_entry'].includes(selected.provenance?.kind)?(selected.provenance.kind==='staff_entry'?'工作人员根据已核定许可逐人登记。':'工作人员根据既有意向资料代登记。')+'此记录不代表本人完成网站隐私同意；原始来源与联络许可须分别核对。':'申请人通过正式表单提交，隐私同意版本与时间随原始报名保存。';
  const form=$('[data-review-form]');for(const name of reviewFields)form.elements.namedItem(name).value=review[name]??'';
  $('[data-review-deletion-state]').textContent=review.deletionRequested?'已登记删除申请；尚未宣称完成数据擦除，后续须按受控维护流程处理。':'';
  $('[data-review-detail-error]').hidden=true;
  if(!$('[data-review-dialog]').open)$('[data-review-dialog]').showModal();
}
function closeDetail(){if(busy)return;if(dirty&&!confirm('核查修改尚未保存，确定关闭并放弃吗？'))return;dirty=false;selected=null;$('[data-review-dialog]').close();$('[data-review-form]').reset();$('[data-review-details]').replaceChildren();}
$('[data-review-login]').addEventListener('submit',event=>{
  event.preventDefault();const form=event.currentTarget;if(!form.reportValidity())return;const login=Object.fromEntries(new FormData(form));
  action(async()=>{let result;try{result=await request('/api/admin/login',{method:'POST',body:JSON.stringify(login)});}finally{form.elements.namedItem('password').value='';login.password='';}user=result.user;csrfToken=result.csrfToken;await load();announce('已登录。请按需要核查，避免导出或分享无关个人资料。');});
});
$('[data-review-logout]').addEventListener('click',()=>action(async()=>{if((dirty||staffAdmissions.pending)&&!confirm(staffAdmissions.pending?'有操作结果尚未确认，退出将清空本页的原操作重试入口。请优先确认同一操作结果；仍要退出吗？':'还有未保存修改，确定退出吗？'))return;await request('/api/admin/logout',{method:'POST'});clear();announce('已退出，当前页的报名资料已清空。');}));
$('[data-review-filters]').addEventListener('submit',event=>{event.preventDefault();filters=readFilters();action(()=>load());});
$('[data-review-filters]').addEventListener('reset',()=>{filters={};queueMicrotask(()=>action(()=>load()));});
$('[data-review-refresh]').addEventListener('click',()=>action(async()=>{if(dirty&&!confirm('有未保存修改，放弃后刷新吗？'))return;dirty=false;selected=null;if($('[data-review-dialog]').open)$('[data-review-dialog]').close();await load();announce('已读取最新保存记录。');}));
$('[data-review-next]').addEventListener('click',()=>action(()=>load(nextCursor)));
for(const button of document.querySelectorAll('[data-review-detail-close]'))button.addEventListener('click',closeDetail);
$('[data-review-dialog]').addEventListener('cancel',event=>{event.preventDefault();closeDetail();});
$('[data-review-form]').addEventListener('input',()=>{dirty=true;});
$('[data-review-form]').addEventListener('change',()=>{dirty=true;});
$('[data-review-form]').addEventListener('submit',event=>{
  event.preventDefault();if(!selected||!event.currentTarget.reportValidity())return;
  const review=Object.fromEntries(reviewFields.map(name=>[name,event.currentTarget.elements.namedItem(name).value]));const id=selected.id,expectedRevision=selected.revision;
  action(async()=>{try{await request('/api/admin/registrations/'+encodeURIComponent(id)+'/review',{method:'PATCH',body:JSON.stringify({expectedRevision,review})});dirty=false;await openRecord(id);await load();announce('核查记录已保存。未发送通知或公开报名资料。');}catch(error){$('[data-review-detail-error]').textContent=error.message;$('[data-review-detail-error]').hidden=false;$('[data-review-detail-error]').focus();throw error;}});
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
  try{result=await downloadPrivateXlsx({path:'/api/admin/registrations/export.xlsx',body:{expectedRevision:revision,filters,includeContact,includeAnswers,includeArrangements},csrfToken,filename:'artdico-registration-attendance.xlsx',isCurrent:()=>generation===sessionGeneration&&Boolean(user),onPrivateUrl:url=>privateExportUrls.add(url)});}catch(error){if(error.status===401)clear();throw error;}
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
  if(!response.ok||!response.headers.get('content-type')?.toLowerCase().startsWith('text/csv'))throw new Error(response.status===403?'此账号没有导出权限。':response.status===409?'记录版本已更新，请刷新后重新核对导出范围。':'导出未完成，请稍后重试。');
  const blob=await response.blob();if(blob.size>4*1024*1024)throw new Error('导出超过页面下载上限，请缩小筛选范围。');
  if(generation!==sessionGeneration)throw new Error('会话已改变，未提供导出下载。');
  const url=URL.createObjectURL(blob),link=node('a');link.href=url;link.download='artdico-registration-review.csv';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
  await load();announce('CSV 已生成并开始下载，服务端已记录导出操作。请按核定范围使用。');
}));
window.addEventListener('beforeunload',event=>{if(dirty||staffAdmissions.pending){event.preventDefault();event.returnValue='';}});
if(location.protocol==='https:'||location.hostname==='127.0.0.1'||location.hostname==='localhost')action(async()=>{
  const response=await fetch('/api/admin/session',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});if(response.status===401)return;if(!response.ok)throw new Error('报名后台暂未就绪，请稍后重试。');const result=await response.json();user=result.user;csrfToken=result.csrfToken;$('[data-review-account]').hidden=false;$('[data-review-user]').textContent=user?.label||user?.id||'';await load();
});else announce('请通过已配置的 HTTPS 工作人员入口登录。');
lock();
