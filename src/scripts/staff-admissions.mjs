import { admissionAdminState, createAdmissionOperations } from '../lib/admission-admin.mjs';
import { admissionLabels } from '../lib/admission-view.mjs';

function element(tag,text){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;}
/** Private capacity management uses the same authenticated request boundary as review. */
export function createStaffAdmissions({root,request,openRecord,onChange=async()=>{}}){
  const $=selector=>root.querySelector(selector);
  let user=null,state=null,busy=false,externalBusy=false,generation=0,loadSequence=0,accountKey=null,labels=new Map(),successCleanup=null,settingsDirty=false;
  const operations=createAdmissionOperations({request,revision:()=>state?.revision});
  const allowed=()=>user?.roles.some(role=>['reviewer','superadmin'].includes(role));
  const admin=()=>user?.roles.includes('superadmin');
  const current=started=>started===generation&&allowed();
  function status(message,error=false){$('[data-admissions-status]').textContent=error?'':message;$('[data-admissions-error]').textContent=error?message:'';$('[data-admissions-error]').hidden=!error;if(error)$('[data-admissions-error]').focus();}
  function lock(){
    for(const field of root.querySelectorAll('button,input,select,textarea'))field.disabled=busy||externalBusy||!allowed()||operations.pending;
    for(const section of root.querySelectorAll('[data-admissions-superadmin]')){section.hidden=!admin();for(const field of section.querySelectorAll('button,input,select,textarea'))field.disabled=busy||externalBusy||!admin()||operations.pending;}
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
    for(const[label,count]of[['已确认 / 总上限',summary.confirmedCount+' / '+summary.capacity],['一般参会已确认',summary.attendeeConfirmedCount],['工作人员已确认',summary.crewConfirmedCount],['一般剩余名额',summary.remainingPublic],['候补（未确认）',summary.waitlistCount],['工作人员预留',summary.staffReserve]]){const card=element('article');card.append(element('span',label),element('strong',String(count)));metrics.append(card);}
    const settings=$('[data-admissions-settings]');if(!settingsDirty){settings.elements.namedItem('staffReserve').value=String(summary.staffReserve);settings.elements.namedItem('waitlistEnabled').checked=summary.waitlistEnabled;}settings.elements.namedItem('staffReserve').max=String(summary.capacity);
    const people=$('[data-admissions-people]');people.replaceChildren();
    const teamNames=new Map(state.teams.map(team=>[team.id,team.name]));
    for(const person of [...state.people].sort((a,b)=>a.queueNumber-b.queueNumber)){
      const row=element('tr'),identity=element('td');identity.dataset.label='人员 / 编号';const link=element('button',labels.get(person.registrationId)||'查看已登记人员');link.type='button';link.className='ah-admin-text-button';link.addEventListener('click',()=>{if(current(rendered)&&!busy&&!externalBusy)openRecord(person.registrationId);});identity.append(link,element('small',person.registrationId));row.append(identity);
      const cell=(label,text)=>{const item=element('td',text);item.dataset.label=label;row.append(item);return item;};
      cell('名额状态',admissionLabels[person.status]+' · 顺序 '+person.queueNumber);cell('类别',person.kind==='crew'?'工作人员':'一般参会');cell('团队',teamNames.get(person.teamId)||'未关联');
      const actions=cell('操作');
      if(person.status!=='withdrawn'){
        const withdraw=element('button','取消并释放名额');withdraw.type='button';withdraw.className='ah-admin-button';withdraw.addEventListener('click',()=>{if(!current(rendered)||!confirm('确认取消这一人的名额？实际空位将按候补顺序补位，不会自动发送通知。'))return;mutate('/withdraw',{registrationId:person.registrationId});});actions.append(withdraw);
      }
      if(admin()&&person.status!=='withdrawn'){
        const change=element('button',person.kind==='crew'?'改为一般参会':'改为工作人员');change.type='button';change.className='ah-admin-button';change.addEventListener('click',()=>{if(!current(rendered)||!confirm('确认变更这一人的名额类别？系统将重新核对预留及候补，不增加总上限。'))return;mutate('/kind',{registrationId:person.registrationId,kind:person.kind==='crew'?'attendee':'crew'});});actions.append(change);
      }
      people.append(row);
    }
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
  async function load(started){const sequence=++loadSequence;let result;try{result=await request('/api/admin/admissions');}catch(error){if(!current(started)||sequence!==loadSequence)return false;throw error;}if(!current(started)||sequence!==loadSequence)return false;const next=admissionAdminState(result);if(!next)throw new Error('名额统计未通过核对，请刷新后重试。');if(state&&next.revision<state.revision)return false;state=next;render();return true;}
  async function action(callback){if(busy||externalBusy||!allowed())return;busy=true;lock();const started=generation;try{await callback(started);}catch(error){if(current(started))status(error.message||'名额操作尚未确认，请保留本页并再次确认。',true);}finally{if(current(started)){busy=false;lock();}}}
  async function accept(result,started){if(!current(started))return;loadSequence++;state=result;const count=Array.isArray(result.promotedIds)?result.promotedIds.length:0;const added=result.registrationId?state.people.find(person=>person.registrationId===result.registrationId):null;
    if(successCleanup){const cleanup=successCleanup;successCleanup=null;cleanup();}if(!current(started))return;render();status(added?'实际一人的登记已保存：'+admissionLabels[added.status]+'。未代填网站本人同意。':'名额安排已保存。'+(count?'本次有 '+count+' 位候补转正，请另行核对并通知。':'未自动发送通知。'));
    if(current(started))await onChange();
  }
  function mutate(suffix,data,method='POST',cleanup=null){if(operations.pending||busy||externalBusy||!allowed())return;successCleanup=cleanup;action(async started=>accept(await operations.run('/api/admin/admissions'+suffix,data,method),started));}
  $('[data-admissions-refresh]').addEventListener('click',()=>action(async started=>{if(await load(started)&&current(started))status(operations.pending?'已读取最新状态；原操作结果仍待确认，请使用「再次确认同一操作」。':'已读取最新名额状态，未执行任何修改。');}));
  $('[data-admissions-retry]').addEventListener('click',()=>action(async started=>accept(await operations.retry(),started)));
  $('[data-admissions-promote]').addEventListener('click',()=>{if(confirm('按候补登记顺序补足适用的实际空位？不会自动发送通知。'))mutate('/promote',{});});
  $('[data-admissions-settings]').addEventListener('input',()=>{settingsDirty=true;});
  $('[data-admissions-settings]').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;if(!form.reportValidity()||!admin())return;mutate('/settings',{settings:{staffReserve:Number(form.elements.namedItem('staffReserve').value),waitlistEnabled:form.elements.namedItem('waitlistEnabled').checked}},'PUT',()=>{settingsDirty=false;});});
  function resetTeam(){const form=$('[data-admissions-team]');form.reset();form.elements.namedItem('id').value='';}
  $('[data-admissions-team-reset]').addEventListener('click',resetTeam);
  $('[data-admissions-team]').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;if(!form.reportValidity())return;const data=new FormData(form),memberIds=data.getAll('memberIds');if(memberIds.length>50){status('一个团队最多关联 50 位已登记成员。',true);return;}mutate('/teams',{team:{...(data.get('id')?{id:data.get('id')}:{}),name:data.get('name').trim(),memberIds}},'POST',resetTeam);});
  $('[data-admissions-staff]').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;if(!form.reportValidity()||!admin())return;const data=new FormData(form);if(!data.get('email').trim()&&!data.get('wechat').trim()){status('请填写本人邮箱或微信，至少一项。',true);return;}const fields=Object.fromEntries(['name','email','wechat'].map(key=>[key,data.get(key).trim()]).filter(([,value])=>value));mutate('/staff',{input:{fields,permissionReference:data.get('permissionReference').trim(),kind:data.get('kind')}},'POST',()=>form.reset());});
  return Object.freeze({
    get pending(){return operations.pending;},
    async configure(account,registrations=[]){
      if(!account?.roles?.some(role=>['reviewer','superadmin'].includes(role))){clear();return;}
      const key=JSON.stringify([account.id,[...account.roles].sort()]);if(key!==accountKey)clear();
      accountKey=key;user={id:account.id,roles:[...account.roles]};const started=generation;root.hidden=false;
      for(const record of registrations)if(typeof record.id==='string'&&typeof record.fields?.name==='string')labels.set(record.id,record.fields.name);
      const sequence=loadSequence+1;
      try{await load(started);}catch(error){if(current(started)&&sequence===loadSequence)status(error.message||'名额功能尚未就绪，请刷新核对。',true);}if(current(started))lock();
    },
    lock(value){externalBusy=value;lock();},
    clear,
  });
  function clear(){generation++;loadSequence++;accountKey=null;user=null;state=null;busy=false;labels.clear();operations.clear();successCleanup=null;settingsDirty=false;root.hidden=true;for(const form of root.querySelectorAll('form'))form.reset();resetTeam();for(const selector of ['[data-admissions-people]','[data-admissions-teams]','[data-admissions-metrics]','[data-admissions-team] [name=memberIds]'])$(selector).replaceChildren();status('');lock();}
}
