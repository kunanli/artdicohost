import {createOperationsFormDraft,captureDraftFields,applyDraftFields,createOperationsSaveState} from '../lib/operations-form-draft.mjs';
import {canManageEventOperations} from '../../shared/staff-permissions.mjs';
import { admissionAdminState, createAdmissionOperations, admissionFormChanged, admissionStaffRecovery } from '../lib/admission-admin.mjs';
import { admissionLabels } from '../lib/admission-view.mjs';

function element(tag,text){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;}
/** Private capacity management uses the same authenticated request boundary as review. */
export function createStaffAdmissions({root,request,openRecord,onChange=async()=>{},onStateChange=()=>{},onActorCleared=()=>{},onNotice=()=>{}}){
  const $=selector=>root.querySelector(selector);
  let user=null,state=null,busy=false,externalBusy=false,generation=0,loadSequence=0,accountKey=null,labels=new Map(),successCleanup=null,settingsDirty=false,reviewQueueOpened=false;
  let pendingDraft=null,formRevision=null,restoredOperation=false,savedStaffId=null;const formDrafts=new Map(),dirtyForms=new Set(),formBases=new Map(),formConflicts=new Set(),formViews=new Map(),conflictReads=new Map();let lastReadSequence=0;
  const formNames={settings:['staffReserve','waitlistEnabled'],team:['id','name','memberIds'],staff:['name','kind','email','wechat','permissionReference']};
  const operationKind=action=>({settings:'settings',team_save:'team',staff_intake:'staff'})[action]??null;
  function formFields(kind){return captureDraftFields($('[data-admissions-'+kind+']'),formNames[kind]);}
  function formConflictText(kind){return kind==='staff'?'原登记已确认保存，当前还有不同填写。请核对是否为另一位实际人员，再明确继续新增。':kind==='settings'?'云端名额设置已变化（当前预留 '+state.settings.staffReserve+'，候补'+(state.settings.waitlistEnabled?'开启':'关闭')+'）。本页填写保留，请核对后继续。':'云端团队或所选成员关联已变化。本页填写保留，请核对最新团队名单后继续。';}
  async function flushForms(){for(const kind of dirtyForms){const draft=formDrafts.get(kind);if(draft&&!draft.blocked)await draft.flush();}}
  const operations=createAdmissionOperations({request,revision:()=>state?.revision,savePending:operation=>pendingDraft.markPending(operation),clearPending:async()=>{await pendingDraft?.acknowledge();}});
  function setupDrafts(){
    if(!state||!allowed())return;const started=generation;
    if(!pendingDraft)pendingDraft=createOperationsFormDraft({actorId:user.id,roles:user.roles,page:'review',entity:'admission-pending',autoSave:false,form:root,baseRevision:()=>state?.revision,isCurrent:()=>current(started),capture:()=>({}),apply:()=>{},onPending:({path,method,body})=>{if(['/settings','/staff','/kind'].some(suffix=>path.endsWith(suffix))&&!admin())throw new Error('此账号没有原操作所需权限。');operations.restore({path,method,body});restoredOperation=true;successCleanup=null;onStateChange();},onDiscard:()=>{operations.clear();restoredOperation=false;lock();onStateChange();},onChange:event=>{if(event.error?.code==='STALE_ACTOR'){onActorCleared();return;}lock();onStateChange();}});void pendingDraft.load();
    const changed=formRevision!==state.revision;formRevision=state.revision;
    for(const[kind,names]of Object.entries(formNames)){
      if(kind!=='team'&&!admin())continue;const form=$('[data-admissions-'+kind+']');
      if(!formViews.has(kind)){
        const view=createOperationsSaveState({form,button:form.querySelector('button[type=submit]'),status:form.querySelector('[data-admissions-save-state]')});view.set('idle');formViews.set(kind,view);
      }
      if(formDrafts.has(kind)){
        if(changed){
          if(dirtyForms.has(kind)&&admissionFormChanged(formBases.get(kind),state,kind,formFields(kind))){formConflicts.add(kind);formViews.get(kind).set('conflict',formConflictText(kind));}
          else if(!formConflicts.has(kind))formBases.set(kind,structuredClone(state));
        }
        continue;
      }
      formBases.set(kind,structuredClone(state));
      const draft=createOperationsFormDraft({actorId:user.id,roles:user.roles,page:'review',entity:'admission-form:'+kind,form,baseRevision:()=>formBases.get(kind)?.revision??state?.revision,isCurrent:()=>current(started),onEdit:()=>{
        dirtyForms.add(kind);if(kind==='settings')settingsDirty=true;
        formViews.get(kind).set(formConflicts.has(kind)?'conflict':'dirty',formConflicts.has(kind)?formConflictText(kind):'本页填写尚未保存。');lock();
      },capture:()=>formFields(kind),apply:fields=>{applyDraftFields(form,fields,names);if(kind==='settings')settingsDirty=true;if(kind==='staff')form.elements.namedItem('confirmed').checked=false;dirtyForms.add(kind);formViews.get(kind).set(formConflicts.has(kind)?'conflict':'dirty',formConflicts.has(kind)?formConflictText(kind):'已恢复本机填写，尚未保存到云端。');},onChange:event=>{if(event.error?.code==='STALE_ACTOR'){onActorCleared();return;}if(event.status==='conflict')formViews.get(kind).set('conflict','另一页修改了本机草稿，请保留填写并核对。');lock();}});formDrafts.set(kind,draft);void draft.load();
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
    if(savedStaffId){const form=$('[data-admissions-staff]');for(const field of form.elements)field.disabled=true;const next=form.querySelector('[data-admissions-staff-next]');next.hidden=false;next.disabled=busy||externalBusy||operations.pending||!admin();}else $('[data-admissions-staff-next]').hidden=true;
    for(const[kind]of formDrafts){const form=$('[data-admissions-'+kind+']');const submit=form.querySelector('button[type=submit]');submit.disabled=submit.disabled||!dirtyForms.has(kind)||formConflicts.has(kind);const review=form.querySelector('[data-admissions-reconcile]');if(review){review.hidden=!formConflicts.has(kind);review.disabled=busy||externalBusy||operations.pending||!allowed()||conflictReads.has(kind)&&lastReadSequence<=conflictReads.get(kind);}}
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
    const teamForm=$('[data-admissions-team]'),select=teamForm.elements.namedItem('memberIds'),editingTeamId=teamForm.elements.namedItem('id').value,cleanTeam=!dirtyForms.has('team')&&editingTeamId?state.teams.find(team=>team.id===editingTeamId):null;
    if(!dirtyForms.has('team')&&editingTeamId){teamForm.elements.namedItem('id').value=cleanTeam?.id??'';teamForm.elements.namedItem('name').value=cleanTeam?.name??'';}
    const selectedIds=new Set(!dirtyForms.has('team')&&editingTeamId?(cleanTeam?.memberIds??[]):Array.from(select.selectedOptions,option=>option.value));select.replaceChildren();
    for(const person of state.people){const option=element('option',personLabel(person)+(person.status==='withdrawn'?'（已取消）':''));option.value=person.registrationId;option.selected=selectedIds.has(person.registrationId);select.append(option);}for(const id of selectedIds)if(!state.people.some(person=>person.registrationId===id)){const option=element('option','原所选成员已不在最新名单，请核对 · '+id);option.value=id;option.selected=true;select.append(option);}
    const teams=$('[data-admissions-teams]');teams.replaceChildren();
    for(const team of state.teams){
      const card=element('div');card.className='admissions-team-card';card.append(element('strong',team.name+' · '+team.memberIds.length+' 位已登记成员'));
      const edit=element('button','编辑关联');edit.type='button';edit.className='ah-admin-button';edit.addEventListener('click',async()=>{if(!current(rendered)||dirtyForms.has('team')&&!confirm('放弃当前未保存的团队填写，改为编辑这个团队？'))return;await formDrafts.get('team')?.acknowledge().catch(()=>{});if(!current(rendered))return;dirtyForms.delete('team');formConflicts.delete('team');formBases.set('team',structuredClone(state));const form=$('[data-admissions-team]');form.elements.namedItem('id').value=team.id;form.elements.namedItem('name').value=team.name;for(const option of select.options)option.selected=team.memberIds.includes(option.value);formViews.get('team')?.set('idle','修改后点击保存。');form.scrollIntoView({block:'center'});lock();});
      const remove=element('button','移除团队关联');remove.type='button';remove.className='ah-admin-button';remove.addEventListener('click',()=>{if(current(rendered)&&confirm('仅移除这个团队的关联，成员的逐人登记与名额保留。确认移除吗？'))mutate('/teams/remove',{teamId:team.id});});card.append(edit,remove);teams.append(card);
    }
    lock();
  }
  async function load(started){await flushForms();if(!current(started))return false;const sequence=++loadSequence;let result;try{result=await request('/api/admin/admissions');}catch(error){if(!current(started)||sequence!==loadSequence)return false;throw error;}if(!current(started)||sequence!==loadSequence)return false;const next=admissionAdminState(result);if(!next)throw new Error('名额统计未通过核对，请刷新后重试。');if(state&&next.revision<state.revision)return false;state=next;lastReadSequence=sequence;setupDrafts();render();return true;}
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
    if(added&&decision==='staff_intake')return '实际一人的登记已保存：'+admissionLabels[added.status]+'。未代填网站本人同意。';
    const count=Array.isArray(result.promotedIds)?result.promotedIds.length:0;
    const prefix=({withdraw:'已撤回此人的申请／名额。',kind:'名额类别已保存。',team_save:'团队关联已保存。',team_remove:'团队关联已移除，逐人名额保留。',settings:'名额设置已保存。',promote:'候补补位已核对。'})[decision]??'名额安排已保存。';
    return prefix+(count?'本次有 '+count+' 位已核准候补转正。'+emailMessage(result.promotionEmail):'未产生新的正式邀请。');
  }
  async function accept(result,started,originalOperation=null){if(!current(started))return;loadSequence++;state=result;
    if(restoredOperation&&result.operation?.action==='staff_intake'&&originalOperation){
      const staffDraft=formDrafts.get('staff'),localSnapshot=await staffDraft?.load();if(!current(started))return;
      let recovery=admissionStaffRecovery(formFields('staff'),originalOperation);const localFields=localSnapshot?.record?.value?.fields;
      if(staffDraft&&!localSnapshot&&recovery)recovery={...recovery,state:'different'};
      if(localSnapshot?.record?.kind==='pending_submission'&&recovery)recovery={...recovery,state:'different'};
      if(localFields&&admissionStaffRecovery(localFields,originalOperation)?.state!=='saved'&&recovery)recovery={...recovery,state:'different'};
      if(recovery?.state==='saved'){
        try{await formDrafts.get('staff')?.acknowledge();}catch{recovery={...recovery,state:'different'};}
        if(!current(started))return;
        if(recovery.state==='saved'){applyDraftFields($('[data-admissions-staff]'),recovery.fields,formNames.staff);$('[data-admissions-staff]').elements.namedItem('confirmed').checked=false;savedStaffId=result.registrationId;dirtyForms.delete('staff');formConflicts.delete('staff');formBases.set('staff',structuredClone(state));}
      }
      if(recovery?.state==='different'){formConflicts.add('staff');dirtyForms.add('staff');}
      restoredOperation=false;
    }

    if(successCleanup){const cleanup=successCleanup;successCleanup=null;await cleanup();}if(!current(started))return;setupDrafts();render();const kind=operationKind(result.operation?.action);if(kind)formViews.get(kind)?.set(formConflicts.has(kind)?'conflict':dirtyForms.has(kind)?'dirty':'saved',formConflicts.has(kind)?formConflictText(kind):dirtyForms.has(kind)?'原操作已核对；当前填写仍未保存。':kind==='staff'?'当前一人登记已保存；新增请点「新增下一人」。':'已核对云端保存回执。');const message=resultMessage(result);status(message);
    if(current(started))try{await onChange();}catch{if(current(started))status(message+' 报名列表刷新未完成，请稍后明确刷新核对。');}
    return true;
  }
  function mutate(suffix,data,method='POST',cleanup=null){
    if(operations.pending||pendingDraft?.blocked||busy||externalBusy||!allowed())return;
    const draftKind=suffix==='/settings'?'settings':suffix==='/teams'?'team':suffix==='/staff'?'staff':null;
    if(draftKind&&(formDrafts.get(draftKind)?.blocked||formConflicts.has(draftKind)||!dirtyForms.has(draftKind)))return;
    const createdGeneration=generation;restoredOperation=false;successCleanup=async()=>{
      if(draftKind){await formDrafts.get(draftKind)?.acknowledge().catch(()=>{});if(!current(createdGeneration))return;dirtyForms.delete(draftKind);formConflicts.delete(draftKind);conflictReads.delete(draftKind);formBases.set(draftKind,structuredClone(state));}cleanup?.(state);
    };
    return action(async started=>{await flushForms();if(!current(started))return;formViews.get(draftKind)?.set('saving');
      try{return await accept(await operations.run('/api/admin/admissions'+suffix,data,method),started);}
      catch(error){if(current(started)&&draftKind){const pending=operations.pending;if(pending)await pendingDraft?.markUnknown().catch(()=>{});if(!current(started))throw error;if(!pending&&error.status===409){formConflicts.add(draftKind);conflictReads.set(draftKind,loadSequence);}formViews.get(draftKind)?.set(pending?'unknown':error.status===409?'conflict':'error',pending?'填写保留，请核对同一操作结果。':error.status===409?'填写保留，请先刷新名额并核对当前云端资料。':error.message||'填写保留，请修正后重试。');}throw error;}
    });
  }

  function retryOperation(){return action(async started=>{const originalOperation=operations.pendingRequest,path=originalOperation?.path,kind=path?.endsWith('/settings')?'settings':path?.endsWith('/teams')?'team':path?.endsWith('/staff')?'staff':null;formViews.get(kind)?.set('saving','正在核对原保存操作…');try{return await accept(await operations.retry(),started,originalOperation);}catch(error){if(current(started))formViews.get(kind)?.set('unknown','原操作结果仍待核对，填写保留。');throw error;}});}
  function reviewApplication(registrationId,decision){
    if(!['approve','reject'].includes(decision)||operations.pending||pendingDraft?.blocked||busy||externalBusy||!allowed())return;
    if(!state?.people.some(person=>person.registrationId===registrationId&&person.status==='pending_review')){status('当前申请不是待审核状态，请刷新名额核对。',true);return;}
    if(!confirm(decision==='approve'?'确认审核通过？系统先分配已核准候补，再按共同上限分配此人的名额或候补；真正取得名额后按通知设置自动发送正式邀请。':'确认不通过这份申请？原始申请与审核记录保留，不占名额，也不会标记为本人婉拒。'))return;
    return mutate('/'+decision,{registrationId});
  }
  for(const button of root.querySelectorAll('[data-admissions-reconcile]'))button.addEventListener('click',async()=>{const kind=button.dataset.admissionsReconcile,started=generation;if(!formConflicts.has(kind)||busy||externalBusy||operations.pending||conflictReads.has(kind)&&lastReadSequence<=conflictReads.get(kind))return;
    if(kind==='staff'&&formDrafts.get(kind)?.blocked){const fields=formDrafts.get(kind).snapshot?.record?.value?.fields,currentFields=formFields(kind),hasVisible=['name','email','wechat','permissionReference'].some(name=>currentFields[name]?.trim());try{await formDrafts.get(kind).acknowledge();}catch{if(current(started))status('本机填写已被其他页面改变，请保留内容并重新核对。',true);return;}if(!current(started))return;if(!hasVisible&&fields)applyDraftFields($('[data-admissions-staff]'),fields,formNames.staff);$('[data-admissions-staff]').elements.namedItem('confirmed').checked=false;dirtyForms.add(kind);}
    formBases.set(kind,structuredClone(state));formConflicts.delete(kind);conflictReads.delete(kind);formViews.get(kind)?.set('dirty',kind==='staff'?'已作为下一人填写保留；重新核对本人许可后点击保存。':'已保留本页填写；点击保存才会提交到当前云端版本。');lock();});
  $('[data-admissions-refresh]').addEventListener('click',()=>action(async started=>{if(await load(started)&&current(started))status(operations.pending?'已读取最新状态；原操作结果仍待确认，请使用「再次确认同一操作」。':'已读取最新名额状态，未执行任何修改。');}));
  $('[data-admissions-filter]').addEventListener('change',render);
  $('[data-admissions-retry]').addEventListener('click',retryOperation);
  $('[data-admissions-promote]').addEventListener('click',()=>{if(confirm('按已核准进入候补的先后补足适用空位？真正转正者会按通知设置发送正式邀请；未审核申请不递补。'))mutate('/promote',{});});
  $('[data-admissions-settings]').addEventListener('input',()=>{settingsDirty=true;});
  $('[data-admissions-settings]').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;if(!form.reportValidity()||!admin())return;mutate('/settings',{settings:{staffReserve:Number(form.elements.namedItem('staffReserve').value),waitlistEnabled:form.elements.namedItem('waitlistEnabled').checked}},'PUT',()=>{settingsDirty=false;});});
  function resetTeam(){const form=$('[data-admissions-team]');form.reset();form.elements.namedItem('id').value='';dirtyForms.delete('team');formConflicts.delete('team');conflictReads.delete('team');if(state)formBases.set('team',structuredClone(state));formViews.get('team')?.set('idle');lock();}
  $('[data-admissions-team-reset]').addEventListener('click',async()=>{const started=generation;if(dirtyForms.has('team')&&!confirm('放弃当前未保存的团队填写？云端团队不受影响。'))return;await formDrafts.get('team')?.acknowledge().catch(()=>{});if(current(started))resetTeam();});
  $('[data-admissions-team]').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;if(!form.reportValidity())return;const data=new FormData(form),memberIds=data.getAll('memberIds');if(memberIds.some(id=>!state.people.some(person=>person.registrationId===id))){status('原所选成员已不在最新名单，请核对并重新选择实际已登记成员。',true);return;}if(memberIds.length>50){status('一个团队最多关联 50 位已登记成员。',true);return;}mutate('/teams',{team:{...(data.get('id')?{id:data.get('id')}:{}),name:data.get('name').trim(),memberIds}},'POST',result=>{const team=result.teams.find(team=>team.id===result.operation?.teamId);if(!team){formConflicts.add('team');return;}form.elements.namedItem('id').value=team.id;form.elements.namedItem('name').value=team.name;for(const option of form.elements.namedItem('memberIds').options)option.selected=team.memberIds.includes(option.value);});});
  $('[data-admissions-staff]').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;if(!form.reportValidity()||!admin())return;const data=new FormData(form);if(!data.get('email').trim()&&!data.get('wechat').trim()){status('请填写本人邮箱或微信，至少一项。',true);return;}const fields=Object.fromEntries(['name','email','wechat'].map(key=>[key,data.get(key).trim()]).filter(([,value])=>value));mutate('/staff',{input:{fields,permissionReference:data.get('permissionReference').trim(),kind:data.get('kind')}},'POST',result=>{savedStaffId=result.registrationId;});});
  $('[data-admissions-staff-next]').addEventListener('click',()=>{if(!savedStaffId||busy||externalBusy||operations.pending)return;savedStaffId=null;const form=$('[data-admissions-staff]');form.reset();dirtyForms.delete('staff');formConflicts.delete('staff');formBases.set('staff',structuredClone(state));formViews.get('staff')?.set('idle','填写实际下一人的资料后保存。');lock();});
  return Object.freeze({
    get summary(){return allowed()&&state?{...state.summary}:null;},
    get pending(){return operations.pending||Boolean(pendingDraft?.blocked);},
    person(id){const person=state?.people.find(item=>item.registrationId===id);return allowed()&&person?{registrationId:person.registrationId,status:person.status,kind:person.kind}:null;},
    reviewApplication,
    retry:retryOperation,
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
  function clear(){for(const draft of formDrafts.values())draft.close();formDrafts.clear();dirtyForms.clear();formBases.clear();formConflicts.clear();conflictReads.clear();lastReadSequence=0;for(const view of formViews.values())view.set('idle');formViews.clear();formRevision=null;restoredOperation=false;savedStaffId=null;pendingDraft?.close();pendingDraft=null;generation++;loadSequence++;accountKey=null;user=null;state=null;busy=false;labels.clear();operations.clear();successCleanup=null;settingsDirty=false;reviewQueueOpened=false;root.hidden=true;for(const form of root.querySelectorAll('form'))form.reset();$('[data-admissions-filter]').value='';resetTeam();for(const selector of ['[data-admissions-people]','[data-admissions-teams]','[data-admissions-metrics]','[data-admissions-team] [name=memberIds]'])$(selector).replaceChildren();status('');lock();onStateChange();}
}
