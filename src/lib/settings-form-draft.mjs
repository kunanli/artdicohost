import {createStaffFormDraft} from './staff-form-draft.mjs';

/** Nonsecret recovery UI. Restoring never submits, and pending writes require human reconciliation. */
export function createSettingsFormDraft({store,actorId,eventId,entity,form,policy,baseRevision,isCurrent,capture,apply,onChange=()=>{},onPending=()=>{},onDiscard=()=>{}}){
  if(typeof eventId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(eventId))throw new Error('活动标识无法核对，未保存本机填写。');
  const panel=document.createElement('section');panel.className='settings-local-draft';panel.dataset.settingsLocalDraft=entity;
  const message=document.createElement('p'),actions=document.createElement('div'),restore=document.createElement('button'),discard=document.createElement('button'),view=document.createElement('button'),copy=document.createElement('pre');
  actions.className='contacts-action-row';restore.textContent='恢复填写';discard.textContent='清除暂存';view.textContent='查看原填写';copy.hidden=true;
  for(const button of[restore,discard,view]){button.type='button';button.className='ah-admin-button';}actions.append(restore,discard,view);panel.append(message,actions,copy);form.before(panel);
  let state='empty',closed=false;
  const binding=createStaffFormDraft({store,scope:{actorId,eventId,page:'settings',entityId:entity},policy,baseRevision,isCurrent,capture,apply,
    onState(value){
      if(value.error?.code==='STALE_ACTOR'){form.dispatchEvent(new CustomEvent('settings-actor-cleared',{bubbles:true,detail:{actorId}}));return;}
      state=value.status;const record=value.snapshot?.record;
      const labels={empty:'',saving:'正在暂存…',saved:'本机已暂存 · 未保存云端',available:'有本机暂存，可恢复填写。',restored:'已恢复填写 · 未保存云端',stale:'云端有更新，先查看原填写。',pending:'提交结果待核对，请先核对后台；不会重送。',discarded:'',conflict:'另一页更新了暂存，请重新载入核对。',unavailable:'本机暂存未完成，请保留此页。',closed:''};
      message.textContent=record?.kind==='pending_submission'?labels.pending:labels[state]??'';panel.hidden=['empty','discarded','closed'].includes(state);restore.hidden=!['available'].includes(state);view.hidden=!record;discard.hidden=!record||['saving','conflict'].includes(state);discard.textContent=record?.kind==='pending_submission'?'已手动核对，解除锁定':'清除暂存';
      if(record?.kind==='pending_submission'&&['pending','stale'].includes(state))onPending(record.value);onChange();
    }});
  restore.addEventListener('click',()=>binding.restore().catch(()=>{}));
  discard.addEventListener('click',async()=>{const pending=binding.snapshot?.record?.kind==='pending_submission';if(!confirm(pending?'已人工核对后台原操作？解除锁定只清除本机记录，不撤销或重送后台操作。':'清除这份本机填写？后台数据不会改变。'))return;try{await binding.discard({allowPending:pending});copy.textContent='';copy.hidden=true;await onDiscard(pending);}catch{}});
  view.addEventListener('click',()=>{copy.textContent=JSON.stringify(binding.snapshot?.record?.value??{},null,2);copy.hidden=!copy.hidden;});
  const schedule=()=>binding.schedule();form.addEventListener('input',schedule);form.addEventListener('change',schedule);
  return Object.freeze({get blocked(){return binding.blocked;},get pending(){return binding.snapshot?.record?.kind==='pending_submission';},get value(){return binding.snapshot?.record?.value??null;},get state(){return state;},load:()=>binding.load(),schedule,
    markPending:value=>binding.markPending(value??capture()),
    async discard(){return binding.discard({allowPending:true});},
    close(){if(closed)return;closed=true;binding.close();form.removeEventListener('input',schedule);form.removeEventListener('change',schedule);copy.textContent='';panel.remove();}});
}
