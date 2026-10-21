import {createOperationsFormDraft,captureDraftFields,applyDraftFields} from '../lib/operations-form-draft.mjs';
import {canManageEventOperations} from '../../shared/staff-permissions.mjs';
import { admissionAdminState, createAdmissionOperations } from '../lib/admission-admin.mjs';
import { admissionLabels } from '../lib/admission-view.mjs';

function element(tag,text){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;}
/** Private capacity management uses the same authenticated request boundary as review. */
export function createStaffAdmissions({root,request,openRecord,onChange=async()=>{},onStateChange=()=>{},onActorCleared=()=>{},onNotice=()=>{}}){
  const $=selector=>root.querySelector(selector);
  let user=null,state=null,busy=false,externalBusy=false,generation=0,loadSequence=0,accountKey=null,labels=new Map(),successCleanup=null,settingsDirty=false,reviewQueueOpened=false;
  let pendingDraft=null,formRevision=null;const formDrafts=new Map(),dirtyForms=new Set();
  async function flushForms(){for(const kind of dirtyForms){const draft=formDrafts.get(kind);if(draft&&!draft.blocked)await draft.flush();}}
  const operations=createAdmissionOperations({request,revision:()=>state?.revision,savePending:operation=>pendingDraft.markPending(operation),clearPending:async({acknowledged,operation})=>{if(acknowledged){const kind=operation.path.endsWith('/settings')?'settings':operation.path.endsWith('/teams')?'team':operation.path.endsWith('/staff')?'staff':null;if(kind)await formDrafts.get(kind)?.acknowledge();}await pendingDraft?.acknowledge();}});
  function setupDrafts(){
    if(!state||!allowed())return;const started=generation;
    if(!pendingDraft)pendingDraft=createOperationsFormDraft({actorId:user.id,page:'review',entity:'admission-pending',autoSave:false,form:root,baseRevision:()=>state?.revision,isCurrent:()=>current(started),capture:()=>({}),apply:()=>{},onPending:operation=>{operations.restore(operation);onStateChange();},onDiscard:()=>{operations.clear();lock();onStateChange();},onChange:event=>{if(event.error?.code==='STALE_ACTOR'){onActorCleared();return;}lock();onStateChange();}});void pendingDraft.load();
    if(formRevision===state.revision)return;for(const draft of formDrafts.values())draft.close();formDrafts.clear();dirtyForms.clear();formRevision=state.revision;settingsDirty=false;for(const form of root.querySelectorAll('form'))form.reset();
    for(const[kind,names]of[['settings',['staffReserve','waitlistEnabled']],['team',['id','name','memberIds']],['staff',['name','kind','email','wechat','permissionReference']]]){
      if(kind!=='team'&&!admin())continue;const form=$('[data-admissions-'+kind+']');
      const draft=createOperationsFormDraft({actorId:user.id,page:'review',entity:'admission-form:'+kind,form,baseRevision:()=>state?.revision,isCurrent:()=>current(started),onEdit:()=>dirtyForms.add(kind),capture:()=>{if(state?.revision!==formRevision)throw new Error('云端名额版本已改变，请刷新核对。');return captureDraftFields(form,names);},apply:fields=>{applyDraftFields(form,fields,names);if(kind==='settings')settingsDirty=true;if(kind==='staff')form.elements.namedItem('confirmed').checked=false;dirtyForms.add(kind);},onChange:event=>{if(event.error?.code==='STALE_ACTOR'){onActorCleared();return;}lock();}});formDrafts.set(kind,draft);void draft.load();
    }
  }
  const allowed=()=>user?.roles.some(role=>['reviewer','superadmin'].includes(role));
  const admin=()=>canManageEventOperations(user);
  const current=started=>started===generation&&allowed();
  function status(message,error=false){$('[data-admissions-status]').textContent=error?'':message;$('[data-admissions-error]').textContent=error?message:'';$('[data-admissions-error]').hidden=!error;if(error)$('[data-admissions-error]').focus();onNotice(message,error);}
  function lock(){
    for(const field of root.querySelectorAll('button,input,select,textarea'))field.disabled=busy||externalBusy||!allowed()||operations.pending||Boolean(pendingDraft?.blocked);
    for(const section of root.querySelectorAll('[data-admissions-superadmin]')){section.hidden=!admin();for(const field of section.querySelectorAll('button,input,select,textarea'))field.disabled=busy||externalBusy||!admin()||operations.pending||Boolean(pendingDraft?.blocked);}
    for(const[kind,draft]of formDrafts){for(const field of $('[data-admissions-'+kind+']').elements)field.disabled=busy||externalBusy||!allowed()||operations.pending||Boolean(pendingDraft?.blocked)||draft.blocked;}
    for(const target of root.querySelectorAll('.operations-local-draft button'))target.disabled=busy||externalBusy||!allowed();
    $('[data-admissions-pending]').hidden=!operations.pending;
    $('[data-admissions-retry]').disabled=busy||externalBusy||!allowed()||!operations.pending;
    // Read refresh never clears a pending operation; it can help inspect a saved result.
    $('[data-admissions-refresh]').disabled=busy||externalBusy||!allowed();
  }
  function personLabel(person){return (labels.get(person.registrationId)||'已登记人员')+' · '+person.registrationId;}
  function render(){
    if(!state||!allowed())return;
    const rendered=generation;
    const summary=state.summary,metrics=$('[data-admissions-metrics]');metrics.replaceChildren();
    for(const[label,count]of[['已确认 / 总上限',summary.confirmedCount+' / '+summary.capacity],['一般参会已确认',summary.attendeeConfirmedCount],['工作人员已确认',summary.crewConfirmedCount],['一般剩余名额',summary.remainingPublic],['候补（未确认）',summary.waitlistCount],['工作人员预留',summary.staffReserve],['待审核（不占名额）',summary.pendingReviewCount??0],['审核不通过',summary.rejectedCount??0]]){const card=element('article');card.append(element('span',label),element('strong',String(count)));metrics.append(card);}
    const settings=$('[data-admissions-settings]');if(!settingsDirty){settings.elements.namedItem('staffReserve').value=String(summary.staffReserve);settings.elements.namedItem('waitlistEnabled').checked=summary.waitlistEnabled;}settings.elements.namedItem('staffReserve').max=String(summary.capacity);
    const people=$('[data-admissions-people]');people.replaceChildren();
    const teamNames=new Map(state.teams.map(team=>[team.id,team.name]));
    const filter=$('[data-admissions-filter]').value;
    for(const person of [...state.people].filter(person=>!filter||person.status===filter).sort((a,b)=>a.queueNumber-b.queueNumber)){
      const row=element('tr'),identity=element('td');identity.dataset.label='人员 / 编号';const link=element('button',labels.get(person.registrationId)||'查看已登记人员');link.type='button';link.className='ah-admin-text-button';link.addEventListener('click',()=>{if(current(rendered)&&!busy&&!externalBusy)openRecord(person.registrationId);});identity.append(link,element('small',person.registrationId));row.append(identity);
      const cell=(label,text)=>{const item=element('td',text);item.dataset.label=label;row.append(item);return item;};
      cell('名额状态',admissionLabels[person.status]+' · 申请顺序 '+person.queueNumber);cell('类别',person.kind==='crew'?'工作人员':'一般参会');cell('团队',teamNames.get(person.teamId)||'未关联');
      const actions=cell('操作');
      if(person.status==='pending_review'){
        for(const [decision,label]of[['approve','审核通过并分配名额'],['reject','不通过申请']]){
          const button=element('button',label);button.type='button';button.className='ah-admin-button'+(decision==='approve'?' ah-admin-primary':'');button.dataset[decision==='approve'?'admissionsApprove':'admissionsReject']=person.registrationId;
          button.addEventListener('click',()=>{if(current(rendered))reviewApplication(person.registrationId,decision);});actions.append(button);
        }
      }
      if(['pending_review','confirmed','waitlisted'].includes(person.status)){
        const withdraw=element('button','取消并释放名额');withdraw.type='button';withdraw.className='ah-admin-button';withdraw.addEventListener('click',()=>{if(!current(rendered)||!confirm('确认撤回这一人的申请或名额？已核准候补将按进入候补的先后补位；实际转正者会按通知设置发送正式邀请。'))return;mutate('/withdraw',{registrationId:person.registrationId});});actions.append(withdraw);
      }
      if(admin()&&['confirmed','waitlisted'].includes(person.status)){
        const change=element('button',person.kind==='crew'?'改为一般参会':'改为工作人员');change.type='button';change.className='ah-admin-button';change.addEventListener('click',()=>{if(!current(rendered)||!confirm('确认变更这一人的名额类别？系统将重新核对预留及候补，不增加总上限。'))return;mutate('/kind',{registrationId:person.registrationId,kind:person.kind==='crew'?'attendee':'crew'});});actions.append(change);
      }
      people.append(row);
    }
    if((summary.pendingReviewCount??0)>0&&!reviewQueueOpened){$('[data-admissions-people]').closest('details').open=true;reviewQueueOpened=true;}
    onStateChange();
    const select=$('[data-admissions-team] [name=memberIds]'),selectedIds=new Set(Array.from(select.selectedOptions,option=>option.value));select.replaceChildren();
    for(const person of state.people){const option=element('option',personLabel(person)+(person.status==='withdrawn'?'（已取消）':''));option.value=person.registrationId;option.selected=selectedIds.has(person.registrationId);select.append(option);}
    const teams=$('[data-admissions-teams]');teams.replaceChildren();
    for(const team of state.teams){
      const card=element('div');card.className='admissions-team-card';card.append(element('strong',team.name+' · '+team.memberIds.length+' 位已登记成员'));
      const edit=element('button','编辑关联');edit.type='button';edit.className='ah-admin-button';edit.addEventListener('click',()=>{if(!current(rendered))return;const form=$('[data-admissions-team]');form.elements.namedItem('id').value=team.id;form.elements.namedItem('name').value=team.name;for(const option of select.options)option.selected=team.memberIds.includes(option.value);form.scrollIntoView({block:'center'});});
      const remove=element('button','移除团队关联');remove.type='button';remove.className='ah-admin-button';remove.addEventListener('click',()=>{if(current(rendered)&&confirm('仅移除这个团队的关联，成员的逐人登记与名额保留。确认移除吗？'))mutate('/teams/remove',{teamId:team.id});});card.append(edit,remove);teams.append(card);
    }
    lock();
  }
  async function load(started){await flushForms();if(!current(started))return false;const sequence=++loadSequence;let result;try{result=await request('/api/admin/admissions');}catch(error){if(!current(started)||sequence!==loadSequence)return false;throw error;}if(!current(started)||sequence!==loadSequence)return false;const next=admissionAdminState(result);if(!next)throw new Error('名额统计未通过核对，请刷新后重试。');if(state&&next.revision<state.revision)return false;state=next;setupDrafts();render();return true;}
  async function action(callback){if(busy||externalBusy||!allowed())return;busy=true;lock();const started=generation;try{return await callback(started);}catch(error){if(current(started))status(error.message||'名额操作尚未确认，请保留本页并再次确认。',true);}finally{if(current(started)){busy=false;lock();}}}
  function emailMessage(email){
    if(!email||!['not_configured','pending','completed','not_applicable'].includes(email.status)||!Number.isSafeInteger(email.attemptedCount)||!Number.isSafeInteger(email.pendingCount)||email.attemptedCount<0||email.pendingCount<0)return '通知结果请到发送记录核对。';
    if(email.status==='not_configured')return '正式邀请邮件尚未配置；名额决定已保存，请到设置与通知完成配置。';
    if(email.status==='not_applicable')return '当前名额不适用正式邀请通知，请核对最新状态。';
    if(email.status==='pending'||email.pendingCount>0)return '正式邀请邮件待处理；请到发送记录核对，勿重复审核或盲目重寄。';
    return '正式邀请邮件已处理；发送与送达情况请到通知记录核对。';
  }
  function resultMessage(result){
    const added=result.registrationId?state.people.find(person=>person.registrationId===result.registrationId):null,decision=result.operation?.action;
    if(decision==='approve'||decision==='reject'){
      const prefix=result.outcome==='replayed'?'已核对同一审核操作；':'审核决定已保存；';
      if(added?.status==='rejected')return prefix+'当前为审核不通过，原申请保留，不占参会名额。';
      if(added?.status==='withdrawn')return prefix+'当前申请／名额已撤回，未恢复参会。';
      if(added?.status==='waitlisted')return prefix+'当前为已核准候补，尚未取得参会名额，不发送正式邀请。';
      if(added?.status==='confirmed')return prefix+'当前已确认参会名额。'+emailMessage(result.approvalEmail);
      return prefix+'当前状态：'+(admissionLabels[added?.status]||'需刷新核对')+'。';
    }
    if(added)return '实际一人的登记已保存：'+admissionLabels[added.status]+'。未代填网站本人同意。';
    const count=Array.isArray(result.promotedIds)?result.promotedIds.length:0;
    return '名额安排已保存。'+(count?'本次有 '+count+' 位已核准候补转正。'+emailMessage(result.promotionEmail):'未产生新的正式邀请。');
  }
  async function accept(result,started){if(!current(started))return;loadSequence++;state=result;
    if(successCleanup){const cleanup=successCleanup;successCleanup=null;await cleanup();}if(!current(started))return;setupDrafts();render();const message=resultMessage(result);status(message);
    if(current(started))try{await onChange();}catch{if(current(started))status(message+' 报名列表刷新未完成，请稍后明确刷新核对。');}
    return true;
  }
  function mutate(suffix,data,method='POST',cleanup=null){if(operations.pending||pendingDraft?.blocked||busy||externalBusy||!allowed())return;const draftKind=suffix==='/settings'?'settings':suffix==='/teams'?'team':suffix==='/staff'?'staff':null;if(draftKind&&formDrafts.get(draftKind)?.blocked)return;successCleanup=async()=>{if(draftKind)await formDrafts.get(draftKind)?.acknowledge();cleanup?.();};return action(async started=>{await flushForms();if(!current(started))return;return accept(await operations.run('/api/admin/admissions'+suffix,data,method),started);});}
  function reviewApplication(registrationId,decision){
    if(!['approve','reject'].includes(decision)||operations.pending||pendingDraft?.blocked||busy||externalBusy||!allowed())return;
    if(!state?.people.some(person=>person.registrationId===registrationId&&person.status==='pending_review')){status('当前申请不是待审核状态，请刷新名额核对。',true);return;}
    if(!confirm(decision==='approve'?'确认审核通过？系统先分配已核准候补，再按共同上限分配此人的名额或候补；真正取得名额后按通知设置自动发送正式邀请。':'确认不通过这份申请？原始申请与审核记录保留，不占名额，也不会标记为本人婉拒。'))return;
    return mutate('/'+decision,{registrationId});
  }
  $('[data-admissions-refresh]').addEventListener('click',()=>action(async started=>{if(await load(started)&&current(started))status(operations.pending?'已读取最新状态；原操作结果仍待确认，请使用「再次确认同一操作」。':'已读取最新名额状态，未执行任何修改。');}));
  $('[data-admissions-filter]').addEventListener('change',render);
  $('[data-admissions-retry]').addEventListener('click',()=>action(async started=>accept(await operations.retry(),started)));
  $('[data-admissions-promote]').addEventListener('click',()=>{if(confirm('按已核准进入候补的先后补足适用空位？真正转正者会按通知设置发送正式邀请；未审核申请不递补。'))mutate('/promote',{});});
  $('[data-admissions-settings]').addEventListener('input',()=>{settingsDirty=true;});
  $('[data-admissions-settings]').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;if(!form.reportValidity()||!admin())return;mutate('/settings',{settings:{staffReserve:Number(form.elements.namedItem('staffReserve').value),waitlistEnabled:form.elements.namedItem('waitlistEnabled').checked}},'PUT',()=>{settingsDirty=false;});});
  function resetTeam(){const form=$('[data-admissions-team]');form.reset();form.elements.namedItem('id').value='';}
  $('[data-admissions-team-reset]').addEventListener('click',resetTeam);
  $('[data-admissions-team]').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;if(!form.reportValidity())return;const data=new FormData(form),memberIds=data.getAll('memberIds');if(memberIds.length>50){status('一个团队最多关联 50 位已登记成员。',true);return;}mutate('/teams',{team:{...(data.get('id')?{id:data.get('id')}:{}),name:data.get('name').trim(),memberIds}},'POST',resetTeam);});
  $('[data-admissions-staff]').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;if(!form.reportValidity()||!admin())return;const data=new FormData(form);if(!data.get('email').trim()&&!data.get('wechat').trim()){status('请填写本人邮箱或微信，至少一项。',true);return;}const fields=Object.fromEntries(['name','email','wechat'].map(key=>[key,data.get(key).trim()]).filter(([,value])=>value));mutate('/staff',{input:{fields,permissionReference:data.get('permissionReference').trim(),kind:data.get('kind')}},'POST',()=>form.reset());});
  return Object.freeze({
    get pending(){return operations.pending||Boolean(pendingDraft?.blocked);},
    person(id){const person=state?.people.find(item=>item.registrationId===id);return allowed()&&person?{registrationId:person.registrationId,status:person.status,kind:person.kind}:null;},
    reviewApplication,
    retry(){return action(async started=>accept(await operations.retry(),started));},
    async configure(account,registrations=[]){
      if(!account?.roles?.some(role=>['reviewer','superadmin'].includes(role))){clear();return;}
      const key=JSON.stringify([account.id,[...account.roles].sort()]);if(key!==accountKey)clear();
      accountKey=key;user={id:account.id,roles:[...account.roles]};const started=generation;root.hidden=false;
      for(const record of registrations)if(typeof record.id==='string'&&typeof record.fields?.name==='string')labels.set(record.id,record.fields.name);
      const sequence=loadSequence+1;
      try{await load(started);if(current(started))setupDrafts();}catch(error){if(current(started)&&sequence===loadSequence)status(error.message||'名额功能尚未就绪，请刷新核对。',true);}if(current(started))lock();
    },
    lock(value){externalBusy=value;lock();},
    clear,
  });
  function clear(){for(const draft of formDrafts.values())draft.close();formDrafts.clear();dirtyForms.clear();formRevision=null;pendingDraft?.close();pendingDraft=null;generation++;loadSequence++;accountKey=null;user=null;state=null;busy=false;labels.clear();operations.clear();successCleanup=null;settingsDirty=false;reviewQueueOpened=false;root.hidden=true;for(const form of root.querySelectorAll('form'))form.reset();$('[data-admissions-filter]').value='';resetTeam();for(const selector of ['[data-admissions-people]','[data-admissions-teams]','[data-admissions-metrics]','[data-admissions-team] [name=memberIds]'])$(selector).replaceChildren();status('');lock();onStateChange();}
}
