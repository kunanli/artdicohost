import {canManageEventOperations} from '../../shared/staff-permissions.mjs';
const key=value=>typeof value==='string'&&/^(?:contact:[A-Za-z0-9][A-Za-z0-9_-]{0,79}|registration:[A-Za-z0-9_-]{43})$/u.test(value);
const ROLE=['attendee','guest','speaker','exhibitor'];
const STATUS={confirmed:'已确认名额',waitlisted:'候补',pending_review:'申请待审核',withdrawn:'已退出',rejected:'申请未通过'};
export function createPeopleResolution({root,request,getUser,onChanged,onIntegrate}){
 const $=selector=>root.querySelector(selector),dialog=document.querySelector('[data-resolution-dialog]'),d=selector=>dialog.querySelector(selector);
 const node=(tag,text,cls)=>{const value=document.createElement(tag);if(text!==undefined)value.textContent=text;if(cls)value.className=cls;return value;};
 let sequence=0,keys=[],state=null,busy=false,pending=null,dirty=false,openedActor=null;
 const allowed=()=>canManageEventOperations(getUser()),current=(seq,actor)=>seq===sequence&&getUser()?.id===actor&&allowed();
 function lock(){root.hidden=!allowed();for(const control of root.querySelectorAll('button'))control.disabled=busy||!allowed();for(const field of dialog.querySelectorAll('button,input'))field.disabled=busy||!allowed()||field.dataset.locked==='true';d('[data-resolution-save]').disabled=busy||!allowed()||!state||Boolean(pending);d('[data-resolution-reload]').textContent=pending?'核对原整合操作':'重新预览';d('[data-resolution-integrate]').disabled=busy||!allowed()||dirty||Boolean(pending);}
 function showError(message){d('[data-resolution-error]').textContent=message;d('[data-resolution-error]').hidden=false;}
 function validPreview(value){return value&&Array.isArray(value.keys)&&value.keys.every(key)&&Number.isSafeInteger(value.expectedRevision)&&Number.isSafeInteger(value.expectedContactRevision)
  &&key(value.primaryKey)&&Array.isArray(value.rows)&&value.rows.length>0&&value.rows.length<=200&&value.rows.every(row=>key(row.key)&&typeof row.name==='string'&&typeof row.organization==='string'&&typeof row.email==='string'&&typeof row.wechat==='string'&&(row.status===null||Object.hasOwn(STATUS,row.status)))
  &&Array.isArray(value.roles)&&value.roles.every(role=>ROLE.includes(role))&&Array.isArray(value.lockedRoles)&&value.lockedRoles.every(role=>ROLE.includes(role));}
 function render(){
  const merging=keys.length>1;d('[data-resolution-sources]').open=merging;d('[data-resolution-source-summary]').textContent=(merging?'核对来源与选择主资料':'原始来源')+' · '+state.rows.length+' 项';const primarySource=state.rows.find(row=>row.key===state.primaryKey);d('[data-resolution-person]').textContent=merging?'':primarySource?.name??'';d('[data-resolution-title]').textContent=merging?'核对并整合同一人':'参会身份与报名';d('[data-resolution-source-list]').replaceChildren();
  for(const row of state.rows){const label=node('label',undefined,'people-resolution-source'),radio=node('input');radio.type='radio';radio.name='primaryKey';radio.value=row.key;radio.checked=row.key===state.primaryKey;radio.hidden=!merging;
   const text=node('div');text.append(node('strong',row.name),node('small',[row.organization,row.email,row.wechat,row.phone].filter(Boolean).join(' · ')),node('small',row.source+(row.status?' · '+STATUS[row.status]+(row.admissionKind==='crew'?'（工作人员名额）':''):'')+(row.contactConsent?' · '+({consented:'已记录联络同意',declined:'已拒绝联络',unknown:'联络许可待核实'})[row.contactConsent]:'')),node('small',row.submittedAt?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Taipei',dateStyle:'medium',timeStyle:'short'}).format(new Date(row.submittedAt)):''));const source=node('a','查看原资料');source.href='/admin/person/#'+(row.kind==='contact'?'contact=':'registration=')+encodeURIComponent(row.id);source.target='_blank';source.rel='noopener noreferrer';text.append(source);label.append(radio,text);d('[data-resolution-source-list]').append(label);}
  for(const input of d('[data-resolution-form]').querySelectorAll('[name=roles]')){input.checked=state.roles.includes(input.value);input.dataset.locked=String(state.lockedRoles.includes(input.value));}
  d('[data-resolution-role-note]').textContent=state.lockedRoles.length?'已有场次或人物资料的身份暂时保留，请在相应安排中调整后再移除。':'';
  d('[data-resolution-confirm-row]').hidden=!merging;d('[name=confirmSamePerson]').checked=false;d('[data-resolution-save]').textContent=merging?'确认同一人并整合':'保存身份';
  const registrations=state.rows.filter(row=>row.kind==='registration'),primary=registrations.find(row=>row.key===state.primaryKey)??registrations.toSorted((a,b)=>({confirmed:0,waitlisted:1,pending_review:2,withdrawn:3,rejected:4})[a.status]-({confirmed:0,waitlisted:1,pending_review:2,withdrawn:3,rejected:4})[b.status])[0],contact=state.rows.find(row=>row.key===state.primaryKey&&row.kind==='contact')??state.rows.find(row=>row.kind==='contact');
  d('[data-resolution-registration]').hidden=merging;d('[data-resolution-integrate]').hidden=Boolean(primary)||!contact;
  d('[data-resolution-registration-link]').hidden=!primary;if(primary)d('[data-resolution-registration-link]').href='/admin/registrations/#registration='+primary.id;
  d('[data-resolution-registration-status]').textContent=primary?STATUS[primary.status]+'。已沿用现有报名，不另建名额。':contact?.responseStatus==='attending'?'已记录本人答应出席，尚待整合到网站报名。':'保存身份后，可在核实本人确认参加时整合到网站报名。';
  d('[data-resolution-integrate]').textContent=contact?.responseStatus==='attending'?'整合已确认出席者':'确认出席并整合报名';dirty=false;lock();
 }
 async function load(){if(!allowed()||!keys.length||busy)return;const seq=++sequence,actor=getUser().id;openedActor=actor;busy=true;lock();
  try{const value=await request('/api/admin/people/resolve',{method:'POST',body:JSON.stringify({action:'preview',keys}),current:()=>current(seq,actor)});if(!current(seq,actor))return;if(!validPreview(value))throw new Error('原始来源无法核对。');state=value;keys=[...value.keys];render();d('[data-resolution-status]').textContent=keys.length>1?'请逐项核对原始来源，选择保留的主资料。合并本身不会寄信。':'身份分流不等于确认出席或取得名额。';}
  catch(error){if(current(seq,actor))showError(error.message||'来源暂时无法核对。');}finally{if(current(seq,actor)){busy=false;lock();}}
 }
 async function open(value){if(!allowed()||busy)return;if(dialog.open&&dirty&&!confirm('重新选择来源？尚未保存的身份选择将放弃，原始记录会保留。'))return;sequence++;keys=Array.isArray(value)?value:[value];if(keys.some(k=>!key(k)))return;pending=null;state=null;dirty=false;d('[data-resolution-error]').hidden=true;d('[data-resolution-source-list]').replaceChildren();if(!dialog.open)dialog.showModal();await load();}
 async function save(replay=false){if(!allowed()||busy||!state)return;
  if(!replay){if(keys.length>1&&!d('[name=confirmSamePerson]').checked){showError('请先确认这些来源确为同一人，再执行整合。');return;}
   const primaryKey=d('[name=primaryKey]:checked')?.value;if(!key(primaryKey))return;
   pending={action:keys.length>1?'merge':'roles',keys:[...keys],primaryKey,roles:[...d('[data-resolution-form]').querySelectorAll('[name=roles]:checked')].map(input=>input.value),expectedRevision:state.expectedRevision,expectedContactRevision:state.expectedContactRevision,operationId:crypto.randomUUID().replaceAll('-',''),...(keys.length>1?{confirmSamePerson:true}:{})};}
  const seq=++sequence,actor=getUser().id;busy=true;lock();d('[data-resolution-error]').hidden=true;
  try{const result=await request('/api/admin/people/resolve',{method:'POST',body:JSON.stringify(pending),current:()=>current(seq,actor)});if(!current(seq,actor))return;
   if(!['updated','replayed'].includes(result?.outcome)||result.operationId!==pending.operationId||!Number.isSafeInteger(result.revision)||!result.person)throw new Error('整合回执尚未确认。');
   const merging=pending.action==='merge';pending=null;dirty=false;busy=false;await onChanged();if(!current(seq,actor))return;
   if(merging){dialog.close();state=null;root.querySelector('[data-resolution-scan-status]').textContent='人员已整合，原始来源保留；重复名额释放 '+result.releasedCount+' 个。';await scan();}
   else{await load();d('[data-resolution-status]').textContent='身份已保存。名额、票券与确认信仍按实际报名状态处理。';}
  }catch(error){if(!current(seq,actor))return;if(error.status>=400&&error.status<500)pending=null;showError(error.message||'整合结果待核对，请使用原操作再次确认。');}
  finally{if(current(seq,actor)){busy=false;lock();}}
 }
 async function scan(){if(!allowed()||busy)return;const seq=++sequence,actor=getUser().id;busy=true;lock();$('[data-resolution-scan-status]').textContent='正在核对重复线索…';
  try{const value=await request('/api/admin/people/duplicates',{current:()=>current(seq,actor)});if(!current(seq,actor))return;if(!Array.isArray(value?.candidates)||value.candidates.length>200)throw new Error('重复线索无法核对。');$('[data-resolution-candidates]').replaceChildren();
   for(const pair of value.candidates){if(!Array.isArray(pair.keys)||pair.keys.length!==2||!pair.keys.every(key)||!Array.isArray(pair.rows)||pair.rows.length!==2||!Array.isArray(pair.reasons)||pair.reasons.some(reason=>!['相同邮箱','相同微信','相同电话','姓名与机构相同'].includes(reason)))throw new Error('重复线索格式无效。');
    const row=node('article'),content=node('div');for(const source of pair.rows){if(typeof source.name!=='string'||typeof source.organization!=='string')throw new Error('来源格式无效。');content.append(node('strong',source.name),node('small',source.organization||'机构未填'));}content.append(node('small',pair.reasons.join('、')+'；仍须人工核对'));const button=node('button','核对这两项来源','ah-admin-button');button.type='button';button.addEventListener('click',()=>void open(pair.keys));row.append(content,button);$('[data-resolution-candidates]').append(row);}
   $('[data-resolution-scan-status]').textContent=value.candidates.length?'发现 '+value.candidates.length+' 组疑似重复。共用邮箱也可能是不同人，不会自动合并。'+(value.truncated?'本次最多显示 200 组。':''):'目前没有发现符合规则的重复线索。';
  }catch(error){if(current(seq,actor))$('[data-resolution-scan-status]').textContent=error.message||'重复资料暂时无法核对。';}finally{if(current(seq,actor)){busy=false;lock();}}
 }
 async function integrate(){if(!state||busy||dirty||pending||!allowed())return;const contact=state.rows.find(row=>row.key===state.primaryKey&&row.kind==='contact')??state.rows.find(row=>row.kind==='contact');if(!contact||state.rows.some(row=>row.kind==='registration'))return;
  if(!confirm(contact.responseStatus==='attending'?'将这位已确认出席的人整合到网站报名？沿用现有来源，同一人只占一席。':'已核实本人确认参加，并确认名额后处理确认信？身份、展位与住宿仍分别核对。'))return;
  const seq=++sequence,actor=getUser().id;busy=true;lock();try{const message=await onIntegrate(contact.id,state.expectedContactRevision);if(!current(seq,actor))return;busy=false;await onChanged();await load();d('[data-resolution-status]').textContent=message;}
  catch(error){if(current(seq,actor))showError((error.message||'原操作结果待核对。')+' 请重新预览现有来源，核对已保存的出席回复与报名，不要重复建立人员。');}finally{if(current(seq,actor)){busy=false;lock();}}
 }
 function clear(){sequence++;state=null;keys=[];pending=null;busy=false;dirty=false;openedActor=null;root.open=false;$('[data-resolution-candidates]').replaceChildren();$('[data-resolution-scan-status]').textContent='';d('[data-resolution-source-list]').replaceChildren();d('[data-resolution-person]').textContent='';d('[data-resolution-status]').textContent='';d('[data-resolution-error]').textContent='';d('[data-resolution-registration-link]').removeAttribute('href');d('[data-resolution-form]').reset();if(dialog.open)dialog.close();lock();}
 $('[data-resolution-scan]').addEventListener('click',()=>void scan());d('[data-resolution-form]').addEventListener('submit',event=>{event.preventDefault();void save();});d('[data-resolution-form]').addEventListener('change',()=>{dirty=true;lock();});d('[data-resolution-reload]').addEventListener('click',()=>void(pending?save(true):load()));d('[data-resolution-integrate]').addEventListener('click',()=>void integrate());
 function close(){if(busy)return;if((dirty||pending)&&!confirm('关闭当前核对？原始资料与已保存操作仍会保留，请稍后重新预览核对。'))return;sequence++;dialog.close();state=null;pending=null;dirty=false;}
 d('[data-resolution-close]').addEventListener('click',close);dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 return{open,clear,lock};
}
