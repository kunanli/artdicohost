const ID=/^[A-Za-z0-9_-]{43}$/u;
const REASONS={OPERATOR_PERMISSION_REQUIRED:'此账号可核对通知记录。',ELIGIBLE:'可以寄送确认信。',ADMISSION_NOT_CONFIRMED:'名额尚未确认，暂不寄送正式凭证。',EMAIL_MISSING:'未记录邮箱，请先核对联络资料。',CONTACT_CONSENT_REQUIRED:'联络授权尚未核实，暂不寄送。',CONTACT_DECLINED:'对方已拒绝联络或出席，暂不寄送。',CONTACT_EMAIL_CHANGED:'联络邮箱与原报名不同，请先核对原记录。',CONTACT_NOT_FOUND:'原联系人无法核对，请先处理关联。',STAFF_PERMISSION_REQUIRED:'缺少工作人员代登记依据，暂不寄送。',PERMISSION_UNAVAILABLE:'联络授权暂时无法核对。',EMAIL_PAUSED:'确认邮件已暂停，请在设置中核对。',EMAIL_NOT_READY:'邮件服务暂不可用，请在设置中核对。',ALREADY_ACCEPTED:'邮件服务商已接受此确认信；请向收件人核实收件。',DELIVERY_UNKNOWN:'上次寄送结果不明，请核实服务商或收件箱后处理，系统不会自动重寄。',RETRY_LIMIT:'已到达明确失败的重试次数上限。'};
const STATUSES=['not_sent','provider_accepted','rejected','unknown'];
export function validPersonConfirmation(value,id){return Boolean(value&&value.registrationId===id&&ID.test(id)&&Number.isSafeInteger(value.revision)&&value.revision>=0
  &&['pending_review','confirmed','waitlisted','rejected','withdrawn'].includes(value.admissionStatus)&&STATUSES.includes(value.status)&&Object.hasOwn(REASONS,value.reason)
  &&typeof value.ready==='boolean'&&typeof value.canSend==='boolean'&&typeof value.retryRejected==='boolean'&&value.retryRejected===(value.status==='rejected')
  &&(!value.ready||value.canSend&&value.reason==='ELIGIBLE'&&value.admissionStatus==='confirmed'&&['not_sent','rejected'].includes(value.status))
  &&typeof value.recipient==='string'&&value.recipient.length<=320&&!/[\u0000-\u001f\u007f]/u.test(value.recipient));}
export function createPersonConfirmation({root,request,getUser,isBlocked=()=>false,onChanged=()=>{}}){
  const $=selector=>root.querySelector(selector);let id=null,actor=null,sequence=0,state=null,pending=null,busy=false;
  const current=(generation,selected)=>generation===sequence&&id===selected&&actor===getUser()?.id;
  function lock(){const disabled=busy||isBlocked()||!getUser();$('[data-person-confirmation-send]').disabled=disabled||!state?.ready||Boolean(pending);$('[data-person-confirmation-check]').disabled=disabled;}
  function render(){if(!state)return;root.hidden=false;$('[data-person-confirmation-recipient]').textContent=state.recipient?'收件人：'+state.recipient:'';
    $('[data-person-confirmation-status]').textContent=(state.status==='rejected'?'上次明确未发出。':'')+REASONS[state.reason]+(!state.canSend?' 当前账号可查看，寄送需要活动管理权限。':'');
    $('[data-person-confirmation-send]').textContent=state.retryRejected?'重试明确失败的确认信':'寄送确认信';$('[data-person-confirmation-check]').textContent=pending?'再次确认原寄送操作':'核对寄送状态';lock();}
  async function load(){if(!id||!getUser()||busy)return;const selected=id,generation=++sequence;actor=getUser().id;busy=true;lock();
    try{const value=await request('/api/admin/registration-confirmation/delivery/'+selected,{signal:AbortSignal.timeout(15000),current:()=>current(generation,selected)});if(!current(generation,selected))return;
      if(!validPersonConfirmation(value,selected))throw new Error('Invalid confirmation state.');state=value;render();
    }catch{if(current(generation,selected)){state=null;$('[data-person-confirmation-status]').textContent='寄送状态暂时无法核对，请重试。';}}
    finally{if(current(generation,selected)){busy=false;lock();}}}
  async function send(replay=false){if(!id||busy||isBlocked()||!getUser()||(!replay&&(!state?.ready||pending)))return;
    if(!replay&&!confirm('寄送这位参加人的确认信？邮件会包含私人确认页与 Apple Wallet 入口。'))return;
    const selected=id,generation=++sequence;actor=getUser().id;
    pending??={expectedRevision:state.revision,operationId:crypto.randomUUID().replaceAll('-',''),retryRejected:state.retryRejected};
    busy=true;lock();
    try{const result=await request('/api/admin/registration-confirmation/send/'+selected,{method:'POST',body:JSON.stringify(pending),signal:AbortSignal.timeout(15000),current:()=>current(generation,selected)});if(!current(generation,selected))return;
      if(!['updated','replayed'].includes(result?.outcome)||result.operationId!==pending.operationId||!Array.isArray(result.results)||result.results.length!==1||result.results[0].registrationId!==selected)throw new Error('Unknown delivery receipt.');
      pending=null;busy=false;await load();onChanged();
    }catch(error){if(!current(generation,selected))return;if(error.status===409){pending=null;busy=false;await load();}
      else{$('[data-person-confirmation-status]').textContent='原寄送操作结果待核对。请再次确认同一操作，系统不会另建寄送。';$('[data-person-confirmation-check]').textContent='再次确认原寄送操作';}}
    finally{if(current(generation,selected)){busy=false;lock();}}}
  function select(value){if(id===(ID.test(value??'')?value:null)&&actor===getUser()?.id){lock();return;}sequence++;id=ID.test(value??'')?value:null;actor=getUser()?.id;state=null;pending=null;busy=false;root.hidden=!id;$('[data-person-confirmation-recipient]').textContent='';$('[data-person-confirmation-status]').textContent='正在核对寄送记录…';lock();if(id)void load();}
  $('[data-person-confirmation-send]').addEventListener('click',()=>void send());$('[data-person-confirmation-check]').addEventListener('click',()=>void(pending?send(true):load()));
  return{select,refresh:load,clear:()=>select(null),lock};
}
