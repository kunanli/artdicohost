import {createStaffFormDraft} from './staff-form-draft.mjs';

/** Nonsecret recovery UI. Restoring never submits, and pending writes require human reconciliation. */
export function createSettingsFormDraft({store,actorId,entity,form,policy,baseRevision,isCurrent,capture,apply,onChange=()=>{},onPending=()=>{},onDiscard=()=>{}}){
  const panel=document.createElement('section');panel.className='settings-local-draft';panel.dataset.settingsLocalDraft=entity;
  const message=document.createElement('p'),actions=document.createElement('div'),restore=document.createElement('button'),discard=document.createElement('button'),view=document.createElement('button'),copy=document.createElement('pre');
  actions.className='contacts-action-row';restore.textContent='恢复本机填写';discard.textContent='清除本机草稿';view.textContent='查看本机内容';copy.hidden=true;
  for(const button of[restore,discard,view]){button.type='button';button.className='ah-admin-button';}actions.append(restore,discard,view);panel.append(message,actions,copy);form.before(panel);
  let state='empty',closed=false;
  const binding=createStaffFormDraft({store,scope:{actorId,eventId:'ggj-artdico-host-2026',page:'settings',entityId:entity},policy,baseRevision,isCurrent,capture,apply,
    onState(value){
      state=value.status;const record=value.snapshot?.record;
      const labels={empty:'未保存的非敏感填写会暂存在本机 7 天；密码、密钥、图片不保存。',saving:'正在保存本机填写…',saved:'非敏感填写已保存在本机；尚未保存到后台。',available:'找到本机填写。确认后恢复；不会自动提交。',restored:'已恢复非敏感填写；请重新填写密码或选择图片，核对后保存。',stale:'后台版本已改变。只能查看本机内容，不能直接覆盖。',pending:'上次提交结果待核对。这里只保留非敏感原输入，不会重送；请先人工核对后台。',discarded:'本机草稿已清除。',conflict:'另一页或会话已改变本机草稿。请重新载入核对，避免覆盖。',unavailable:'本机草稿无法核实保存。请保留当前页面，提交前需恢复本机保存能力。',closed:''};
      message.textContent=record?.kind==='pending_submission'?labels.pending:labels[state]??'';panel.hidden=state==='closed';restore.hidden=!['available'].includes(state);view.hidden=!record;discard.hidden=!record||['saving','conflict'].includes(state);discard.textContent=record?.kind==='pending_submission'?'已手动核对，解除本机锁定':'清除本机草稿';
      if(record?.kind==='pending_submission'&&['pending','stale'].includes(state))onPending(record.value);onChange();
    }});
  restore.addEventListener('click',()=>binding.restore().catch(()=>{}));
  discard.addEventListener('click',async()=>{const pending=binding.snapshot?.record?.kind==='pending_submission';if(!confirm(pending?'已人工核对后台原操作？解除锁定只清除本机记录，不撤销或重送后台操作。':'清除这份本机填写？后台数据不会改变。'))return;try{await binding.discard({allowPending:pending});copy.textContent='';copy.hidden=true;await onDiscard(pending);}catch{}});
  view.addEventListener('click',()=>{copy.textContent=JSON.stringify(binding.snapshot?.record?.value??{},null,2);copy.hidden=!copy.hidden;});
  const schedule=()=>binding.schedule();form.addEventListener('input',schedule);form.addEventListener('change',schedule);
  return Object.freeze({get blocked(){return binding.blocked;},get pending(){return binding.snapshot?.record?.kind==='pending_submission';},get state(){return state;},load:()=>binding.load(),schedule,
    markPending:value=>binding.markPending(value??capture()),
    async discard(){return binding.discard({allowPending:true});},
    close(){if(closed)return;closed=true;binding.close();form.removeEventListener('input',schedule);form.removeEventListener('change',schedule);copy.textContent='';panel.remove();}});
}
