import {eventConfig} from '../config/event.mjs';
const ID=/^[A-Za-z0-9_-]{43}$/u;
const REASONS={OPERATOR_PERMISSION_REQUIRED:'此账号可核对通知记录。',ELIGIBLE:'可以寄送确认信。',ADMISSION_NOT_CONFIRMED:'名额尚未确认，暂不寄送正式凭证。',EMAIL_MISSING:'未记录邮箱，请先核对联络资料。',CONTACT_CONSENT_REQUIRED:'联络授权尚未核实，暂不寄送。',CONTACT_DECLINED:'对方已拒绝联络或出席，暂不寄送。',CONTACT_EMAIL_CHANGED:'联络邮箱与原报名不同，请先核对原记录。',CONTACT_NOT_FOUND:'原联系人无法核对，请先处理关联。',STAFF_PERMISSION_REQUIRED:'缺少工作人员代登记依据，暂不寄送。',PERMISSION_UNAVAILABLE:'联络授权暂时无法核对。',EMAIL_PAUSED:'确认邮件已暂停，请在设置中核对。',EMAIL_NOT_READY:'邮件服务暂不可用，请在设置中核对。',EVENT_FACTS_MISMATCH:'活动资料待核对。',EVENT_FACTS_UNAVAILABLE:'活动资料暂时无法核对。',ALREADY_ACCEPTED:'邮件服务已接收；请向收件人核实收件。',HISTORICAL_DELIVERY_UNKNOWN:'原邮箱寄送结果未明，请先核对历史记录。',DELIVERY_UNKNOWN:'上次寄送结果不明，请核实服务商或收件箱后处理，系统不会自动重寄。',RETRY_LIMIT:'已到达明确失败的重试次数上限。'};
const STATUSES=['not_sent','provider_accepted','rejected','unknown'];
export function validPersonConfirmation(value,id){return Boolean(value&&value.registrationId===id&&ID.test(id)&&Number.isSafeInteger(value.revision)&&value.revision>=0
  &&(!Object.hasOwn(value,'accessRevision')||Number.isSafeInteger(value.accessRevision)&&value.accessRevision>=0)
  &&['pending_review','confirmed','waitlisted','rejected','withdrawn'].includes(value.admissionStatus)&&STATUSES.includes(value.status)&&Object.hasOwn(REASONS,value.reason)
  &&typeof value.ready==='boolean'&&typeof value.canSend==='boolean'&&typeof value.retryRejected==='boolean'&&value.retryRejected===(value.status==='rejected')
  &&(!value.ready||value.canSend&&value.reason==='ELIGIBLE'&&value.admissionStatus==='confirmed'&&['not_sent','rejected'].includes(value.status))
  &&typeof value.recipient==='string'&&value.recipient.length<=320&&!/[\u0000-\u001f\u007f]/u.test(value.recipient));}
const OP=/^[A-Za-z0-9_-]{32,128}$/u;
const RESULTS=['provider_accepted','rejected','unknown','disabled','not_configured','not_applicable','not_public','withdrawn','unavailable','not_attempted'];
const unresolved=value=>value.status==='unknown'||value.results.some(row=>['unknown','unavailable'].includes(row.status));
const actorKey=user=>user?.id+'|'+[...(user?.roles??[])].sort().join(',');
export function personConfirmationScope(user,id,eventId=eventConfig.id){
  if(!user?.id||!ID.test(id)||!Array.isArray(user.roles)||!user.roles.length||user.roles.length>5||new Set(user.roles).size!==user.roles.length||user.roles.some(role=>!['editor','publisher','outreach','reviewer','superadmin'].includes(role)))throw Error('工作人员权限无法核对。');
  return{actorId:user.id,eventId,page:'person-confirmation:roles='+[...user.roles].sort().join(','),entityId:'registration:'+id};
}
export function personConfirmationPolicy(id){
  return{fields:['path','method','payloadJson'],pendingFields:['path','method','payloadJson'],jsonFields:['payloadJson'],validate(value,{kind}){
    if(kind!=='pending_submission'||value.path!=='/api/admin/registration-confirmation/send/'+id||value.method!=='POST'||typeof value.payloadJson!=='string'||value.payloadJson.length>1024)return false;
    let body;try{body=JSON.parse(value.payloadJson);}catch{return false;}
    return Boolean(body&&['expectedRevision,operationId,retryRejected','expectedAccessRevision,expectedRevision,operationId,retryRejected'].includes(Object.keys(body).sort().join(','))&&Number.isSafeInteger(body.expectedRevision)&&body.expectedRevision>=0&&OP.test(body.operationId)&&typeof body.retryRejected==='boolean'
      &&(!Object.hasOwn(body,'expectedAccessRevision')||Number.isSafeInteger(body.expectedAccessRevision)&&body.expectedAccessRevision>=0));
  }};
}
export function validPersonConfirmationOperation(value,{registrationId,operationId,lookup=false}={}){
  if(!value||!['updated','replayed'].includes(value.outcome)||!Number.isSafeInteger(value.revision)||value.revision<0||value.operationId!==operationId||!OP.test(operationId??'')||!ID.test(registrationId??'')||!['completed','partial','unknown'].includes(value.status)||!Array.isArray(value.results)||value.results.length!==1)return false;
  if(Object.keys(value).length!==(lookup?7:5)||Object.keys(value).some(key=>!['outcome','revision','operationId','status','results',...(lookup?['kind','checkedAt']:[])].includes(key)))return false;
  if(lookup&&(value.kind!=='registration'||typeof value.checkedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/u.test(value.checkedAt)||!Number.isFinite(Date.parse(value.checkedAt))))return false;
  const row=value.results[0];return Boolean(row&&Object.keys(row).length===2&&row.registrationId===registrationId&&RESULTS.includes(row.status));
}
/** This controller never replays a POST. Durable pending contains only the
 * exact original request and is scoped to this actor, role set and attendee. */
export function createPersonConfirmation({root,request,getUser,draftStore,eventId=eventConfig.id,isBlocked=()=>false,isSendBlocked=()=>false,onChanged=()=>{},onLockChange=()=>{},onInvalidated=()=>{},onChecked=()=>{}}){
  const $=selector=>root.querySelector(selector);
  let id=null,actor='',sequence=0,state=null,pending=null,snapshot=null,scope=null,policy=null,busy=false,storageReady=false,readUnavailable=false,writingGeneration=null,unsubscribe=null,activated=true,settling=Promise.resolve();
  const active=(generation,selected)=>generation===sequence&&id===selected&&actor===actorKey(getUser());
  const blocked=()=>busy||Boolean(pending)||!storageReady||readUnavailable||state?.status==='unknown'||state?.reason==='DELIVERY_UNKNOWN';
  function lock(){const disabled=busy||isBlocked()||!getUser();$('[data-person-confirmation-send]').disabled=disabled||isSendBlocked()||!state?.ready||Boolean(pending)||!storageReady;$('[data-person-confirmation-check]').disabled=disabled;onLockChange();}
  function message(text){root.hidden=!id;$('[data-person-confirmation-status]').textContent=text;lock();}
  function render(){
    if(!state)return;root.hidden=false;$('[data-person-confirmation-recipient]').textContent=state.recipient?'收件人：'+state.recipient:'';
    const status=$('[data-person-confirmation-status]');status.textContent=pending?'原寄送结果待核对，不会重复寄送。':(state.status==='rejected'?'上次明确未发出。':'')+REASONS[state.reason]+(!state.canSend?' 当前账号可查看，寄送需要活动管理权限。':'');
    if(['EVENT_FACTS_MISMATCH','EVENT_FACTS_UNAVAILABLE'].includes(state.reason)){if(getUser()?.roles?.some(role=>['editor','superadmin'].includes(role))){const link=document.createElement('a');link.href='/admin/content/event/';link.textContent='核对活动资料';status.append(' ',link);}else status.append(' 请交由活动编辑核对。');}
    $('[data-person-confirmation-send]').textContent=state.retryRejected?'重试明确失败的确认信':'寄送确认信';$('[data-person-confirmation-check]').textContent=pending?'核对原寄送结果':'核对寄送状态';lock();
  }
  async function removePending(generation,selected){
    writingGeneration=generation;try{
      const cleared=await draftStore.remove(scope,{expectedRevision:snapshot.revision,actorEpoch:snapshot.actorEpoch,allowPending:true});
      if(!active(generation,selected))return false;snapshot=cleared;pending=null;return true;
    }finally{if(writingGeneration===generation)writingGeneration=null;}
  }
  async function delivery(generation,selected){
    state=null;readUnavailable=true;$('[data-person-confirmation-recipient]').textContent='';lock();
    const value=await request('/api/admin/registration-confirmation/delivery/'+selected,{signal:AbortSignal.timeout(15000),current:()=>active(generation,selected)});
    if(!active(generation,selected))return;if(!validPersonConfirmation(value,selected))throw Error('Invalid confirmation state.');state=value;readUnavailable=false;render();
  }
  async function check(){
    if(!id||!getUser()||busy)return;if(!storageReady)return initialize();
    const selected=id,generation=++sequence;busy=true;lock();
    try{
      const recovering=Boolean(pending);
      if(pending){
        const original=JSON.parse(pending.payloadJson),value=await request('/api/admin/registration-confirmation/operation/'+original.operationId,{signal:AbortSignal.timeout(15000),current:()=>active(generation,selected)});
        if(!active(generation,selected))return;
        if(!validPersonConfirmationOperation(value,{registrationId:selected,operationId:original.operationId,lookup:true}))throw Error('Original receipt is invalid.');
        onChecked({registrationId:selected,checkedAt:value.checkedAt});
        if(unresolved(value))throw Error('Original outcome remains unknown.');
        if(!await removePending(generation,selected))return;
      }
      if(activated)await delivery(generation,selected);else root.hidden=true;
      if(recovering)onChanged();
    }catch{if(active(generation,selected)){state=null;$('[data-person-confirmation-recipient]').textContent='';message(pending?'原寄送结果仍待核对，不会重复寄送。':'寄送状态暂时无法核对，请重试。');}}
    finally{if(active(generation,selected)){busy=false;lock();}}
  }
  async function initialize(){
    if(!id||!getUser())return;const selected=id,generation=++sequence;busy=true;storageReady=false;lock();
    try{
      scope=personConfirmationScope(getUser(),selected,eventId);policy=personConfirmationPolicy(selected);
      const observed=await draftStore.read(scope,policy);if(!active(generation,selected))return;
      snapshot=observed;pending=observed.record?.value??null;
      if(pending&&observed.record.baseRevision!==JSON.parse(pending.payloadJson).expectedRevision)throw Error('Invalid local pending.');
      storageReady=true;
      unsubscribe?.();unsubscribe=draftStore.subscribe(scope,event=>{
        if(writingGeneration===sequence||!id||actor!==actorKey(getUser()))return;
        if(event.type==='actor_cleared'){select(null);onInvalidated();return;}
        if(event.revision!==snapshot?.revision){storageReady=false;state=null;$('[data-person-confirmation-recipient]').textContent='';message('另一页已更新本机原操作，请先核对。');}
      });
      busy=false;if(pending||activated)await check();else{root.hidden=true;lock();}
    }catch{if(active(generation,selected)){state=null;storageReady=false;$('[data-person-confirmation-recipient]').textContent='';message('本机原操作暂时无法核对，尚未开始新寄送。');}}
    finally{if(active(generation,selected)){busy=false;lock();}}
  }
  async function send(){
    if(!id||busy||isBlocked()||isSendBlocked()||!getUser()||!state?.ready||pending||!storageReady)return;
    if(!confirm('寄送这位参加人的确认信？邮件会包含私人确认页与 Apple Wallet 入口。'))return;
    const selected=id,generation=++sequence,original={expectedRevision:state.revision,operationId:crypto.randomUUID().replaceAll('-',''),retryRejected:state.retryRejected,expectedAccessRevision:state.accessRevision??0};
    const value={path:'/api/admin/registration-confirmation/send/'+selected,method:'POST',payloadJson:JSON.stringify(original)};
    busy=true;let sent=false,received=false;lock();
    try{
      const observed=await draftStore.read(scope,policy);if(!active(generation,selected))return;
      snapshot=observed;if(observed.record){pending=observed.record.value;message('发现原寄送操作，请先核对。');return;}
      let saved;writingGeneration=generation;try{saved=await draftStore.write(scope,{expectedRevision:snapshot.revision,actorEpoch:snapshot.actorEpoch,kind:'pending_submission',baseRevision:original.expectedRevision,value},policy);}finally{if(writingGeneration===generation)writingGeneration=null;}
      if(!active(generation,selected))return;snapshot=saved;pending=value;sent=true;
      const result=await request(value.path,{method:'POST',body:value.payloadJson,signal:AbortSignal.timeout(15000),current:()=>active(generation,selected)});
      if(!active(generation,selected))return;
      if(!validPersonConfirmationOperation(result,{registrationId:selected,operationId:original.operationId}))throw Error('Unverified original receipt.');
      received=true;if(unresolved(result)){message('原寄送结果待核对，不会重复寄送。');return;}
      if(!await removePending(generation,selected))return;
      await delivery(generation,selected);onChanged();
    }catch(error){
      if(!active(generation,selected))return;
      // Only this first POST's definite pre-start rejection proves it did not
      // create the original dispatch. Restored/unknown requests never POST.
      if(sent&&!received&&[400,403,404,409].includes(error.status)){
        try{if(await removePending(generation,selected))await delivery(generation,selected);}catch{message('原操作仍待核对，暂不开始新寄送。');}
      }else if(sent){message(pending?'原寄送操作结果待核对，不会重复寄送。':'原操作已核对，当前寄送状态暂时无法核对。');}
      else{storageReady=false;message('本机原操作未确认保存，尚未开始寄送。');}
    }finally{if(active(generation,selected)){busy=false;lock();}}
  }
  function select(value,{activate=true,suppress=false}={}){
    const selected=ID.test(value??'')?value:null,nextActor=actorKey(getUser());if(id===selected&&actor===nextActor){if(suppress){activated=false;state=null;root.hidden=!pending;}else if(activate&&!activated){activated=true;if(!busy)settling=check();}lock();return settling;}
    sequence++;unsubscribe?.();unsubscribe=null;id=selected;actor=nextActor;state=null;pending=null;snapshot=null;scope=null;policy=null;busy=false;storageReady=false;readUnavailable=false;activated=activate&&!suppress;
    root.hidden=!id;$('[data-person-confirmation-recipient]').textContent='';$('[data-person-confirmation-status]').textContent=id?'正在核对寄送记录…':'';
    $('[data-person-confirmation-check]').textContent='核对寄送状态';lock();settling=id?initialize():Promise.resolve();return settling;
  }
  $('[data-person-confirmation-send]').addEventListener('click',()=>void send());$('[data-person-confirmation-check]').addEventListener('click',()=>void check());
  return{select,refresh:check,clear:()=>select(null),lock,get settled(){return settling;},get blocked(){return id?blocked():false;},get pending(){return Boolean(pending);}};
}
