const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const states=['provider_accepted','rejected','unknown','disabled','not_configured','not_applicable','not_public','withdrawn','unavailable','not_attempted'];
const walletReasons=new Set(['WALLET_NOT_CONFIGURED','WALLET_DISABLED','CONFIGURED_SIGNER_DEVICE_TEST_REQUIRED','WALLET_BUNDLE_UNAVAILABLE',
  'WALLET_CERTIFICATE_INVALID','WALLET_CERTIFICATE_EXPIRED','WALLET_CERTIFICATE_CHAIN_INVALID','WALLET_CERTIFICATE_ID_MISMATCH',
  'WALLET_CERTIFICATE_TYPE_INVALID','WALLET_IDENTITY_INVALID','WALLET_PRIVATE_KEY_INVALID','WALLET_UNAVAILABLE']);
const validExpiry=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const validCounts=value=>plain(value)&&['total','providerAccepted','rejected','unknown'].every(key=>Number.isSafeInteger(value[key])&&value[key]>=0&&value[key]<=10000);
const copyCounts=value=>Object.fromEntries(['total','providerAccepted','rejected','unknown'].map(key=>[key,value[key]]));
export function deliverySettingsView(value){
  if(!plain(value)||!Number.isSafeInteger(value.revision)||value.revision<0||typeof value.automaticEnabled!=='boolean'||typeof value.email?.ready!=='boolean'
    ||!Array.isArray(value.email.missing)||value.email.missing.length>30||value.email.missing.some(key=>typeof key!=='string'||!/^[A-Z][A-Z0-9_]{0,100}$/u.test(key))
    ||typeof value.wallet?.ready!=='boolean'||value.wallet.missing!==undefined&&(!Array.isArray(value.wallet.missing)||value.wallet.missing.length>20||value.wallet.missing.some(key=>typeof key!=='string'||!/^[A-Z][A-Z0-9_]{0,79}$/u.test(key)))
    ||value.wallet.deviceTestRequired!==undefined&&typeof value.wallet.deviceTestRequired!=='boolean'
    ||value.wallet.certificateExpiresAt!==undefined&&!validExpiry(value.wallet.certificateExpiresAt)
    ||!validCounts(value.counts)||value.notificationCounts!==undefined&&(!plain(value.notificationCounts)||['applicationReceived','preEventReminder'].some(key=>!validCounts(value.notificationCounts[key]))))return null;
  const reason=value.wallet.reason===undefined?(value.wallet.ready?'CONFIGURED_SIGNER_DEVICE_TEST_REQUIRED':'WALLET_NOT_CONFIGURED')
    :walletReasons.has(value.wallet.reason)?value.wallet.reason:'WALLET_UNAVAILABLE';
  return{revision:value.revision,automaticEnabled:value.automaticEnabled,email:{ready:value.email.ready,missing:[...value.email.missing]},
    wallet:{ready:value.wallet.ready,reason,missing:[...(value.wallet.missing??[])],deviceTestRequired:value.wallet.deviceTestRequired!==false,
      ...(value.wallet.certificateExpiresAt===undefined?{}:{certificateExpiresAt:value.wallet.certificateExpiresAt})},
    counts:copyCounts(value.counts),...(value.notificationCounts===undefined?{}:{notificationCounts:Object.fromEntries(['applicationReceived','preEventReminder'].map(key=>[key,copyCounts(value.notificationCounts[key])]))})};
}

const reminderReasons=new Set(['ELIGIBLE','EMAIL_MISSING','ALREADY_ACCEPTED','DELIVERY_UNKNOWN','HISTORICAL_DELIVERY_UNKNOWN','EMAIL_PAUSED','EMAIL_NOT_READY','RETRY_LIMIT','ADMISSION_NOT_CONFIRMED','CONTACT_DECLINED','CONTACT_CONSENT_REQUIRED','CONTACT_EMAIL_CHANGED','CONTACT_NOT_FOUND','STAFF_PERMISSION_REQUIRED','PERMISSION_UNAVAILABLE','EVENT_FACTS_MISMATCH','EVENT_FACTS_UNAVAILABLE','REMINDER_WINDOW_CLOSED']);
const validAccessRevision=value=>Number.isSafeInteger(value)&&value>=0;
const validAccessRevisions=(value,ids)=>plain(value)&&Object.keys(value).length===ids.length&&ids.every(id=>Object.hasOwn(value,id)&&validAccessRevision(value[id]));
const safeText=(value,max,empty=true)=>typeof value==='string'&&value.length<=max&&(empty||Boolean(value.trim()))&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
export function deliveryReminderPreviewView(value){
  if(!plain(value)||value.kind!=='pre_event_reminder'||!Number.isSafeInteger(value.revision)||value.revision<0||!Array.isArray(value.rows)||value.rows.length>100
    ||!Number.isSafeInteger(value.total)||value.total<value.rows.length||value.total>10000||value.nextCursor!==null&&(!safeText(value.nextCursor,2048,false)||/[\s]/u.test(value.nextCursor))
    ||!plain(value.message)||!safeText(value.message.subject,300,false)||!safeText(value.message.text,16000,false)||value.message.privateUrlPlaceholder!=='[私人参会页链接]'||!value.message.text.includes(value.message.privateUrlPlaceholder))return null;
  const ids=new Set();for(const row of value.rows){
    if(!plain(row)||!/^[A-Za-z0-9_-]{43}$/u.test(row.registrationId??'')||ids.has(row.registrationId)||!safeText(row.name,400,false)||!safeText(row.organization,500)
      ||!['not_sent','provider_accepted','rejected','unknown'].includes(row.status)||typeof row.eligible!=='boolean'||typeof row.retryRejected!=='boolean'||!reminderReasons.has(row.reason)
      ||Object.hasOwn(row,'accessRevision')&&!validAccessRevision(row.accessRevision)
      ||row.eligible&&(!['not_sent','rejected'].includes(row.status)||row.reason!=='ELIGIBLE')||row.status==='rejected'&&row.eligible&&!row.retryRejected)return null;
    ids.add(row.registrationId);
  }
  return{revision:value.revision,kind:value.kind,total:value.total,nextCursor:value.nextCursor,message:{subject:value.message.subject,text:value.message.text,privateUrlPlaceholder:value.message.privateUrlPlaceholder},rows:value.rows.map(row=>({registrationId:row.registrationId,name:row.name,organization:row.organization,status:row.status,eligible:row.eligible,reason:row.reason,retryRejected:row.retryRejected,accessRevision:row.accessRevision??0}))};
}

/** The formal family has its own read-only source proof and never borrows a reminder preview. */
export function deliveryConfirmationPreviewView(value){
  if(!plain(value)||value.kind!=='registration'||!/^[a-f0-9]{64}$/u.test(value.sourceRevision??'')||value.total>1000)return null;
  const checked=deliveryReminderPreviewView({...value,kind:'pre_event_reminder'});
  if(!checked||checked.rows.some(row=>row.reason==='REMINDER_WINDOW_CLOSED'))return null;
  return{...checked,kind:'registration',sourceRevision:value.sourceRevision};
}

export function deliveryConfirmationOperationView(value,operationId){
  if(value?.kind!=='registration'||!validExpiry(value.checkedAt))return null;
  const checked=deliveryDispatchView(value,operationId);
  return checked?{...checked,operationId,kind:'registration',checkedAt:value.checkedAt}:null;
}

export const deliveryConfirmationRequestView=deliveryReminderRequestView;

export function deliveryConfirmationDraftPolicy({roleKey,canReject=()=>false}){
  if(typeof roleKey!=='string'||!roleKey||typeof canReject!=='function')throw new TypeError('Invalid confirmation recovery scope');
  return{fields:['body','roleKey','uncertain'],pendingFields:['body','roleKey'],jsonFields:['body'],
    validate:value=>Object.keys(value).sort().join(',')==='body,roleKey,uncertain'&&typeof value.uncertain==='boolean'&&value.roleKey===roleKey&&Boolean(deliveryConfirmationRequestView(value.body)),
    rejectPending:value=>canReject(value)?value:null};
}

/** Old local bulk drafts contain parsed fields, not the original request bytes.
 * They are useful only to GET the existing operation, never to reconstruct a POST. */
export function deliveryLegacyDispatchView(value){
  if(!plain(value)||Object.keys(value).sort().join(',')!=='action,expectedRevision,operationId,registrationIds,retryRejected'
    ||value.action!=='dispatch'||!Number.isSafeInteger(value.expectedRevision)||value.expectedRevision<0
    ||!/^[A-Za-z0-9_-]{32,128}$/u.test(value.operationId??'')||typeof value.retryRejected!=='boolean'
    ||!Array.isArray(value.registrationIds)||!value.registrationIds.length||value.registrationIds.length>100
    ||new Set(value.registrationIds).size!==value.registrationIds.length||value.registrationIds.some(id=>!/^[A-Za-z0-9_-]{43}$/u.test(id)))return null;
  return{id:value.operationId,ids:[...value.registrationIds],revision:value.expectedRevision};
}

/** A formal POST is issued once; all recovery, including old parsed drafts, is GET-only. */
export function createConfirmationMutations({request,revision,operationId=()=>crypto.randomUUID().replaceAll('-','')}){
  let pending=null,busy=false,generation=0;
  async function perform(readOnly){
    if(!pending||busy)throw new Error('请先核对原确认信。');
    const started=generation,operation=pending;busy=true;
    if(readOnly){operation.fresh=false;operation.knownRejected=false;}
    try{
      const value=await request('/api/admin/registration-confirmation/'+(readOnly?'operation/'+operation.id:'dispatch'),readOnly?{method:'GET'}:{method:'POST',body:operation.body});
      if(started!==generation||operation!==pending)throw new Error('会话已改变，请重新核对原确认信。');
      const result=readOnly?deliveryConfirmationOperationView(value,operation.id)
        :Object.hasOwn(value??{},'kind')?null:deliveryDispatchView(value,operation.id);
      if(!result||result.results.length!==operation.ids.length||operation.ids.some((id,index)=>result.results[index]?.registrationId!==id))throw new Error('确认信结果尚未完整，请核对原寄送。');
      if(result.status!=='unknown'&&!result.results.some(row=>['unknown','unavailable'].includes(row.status)))pending=null;
      return result;
    }catch(error){
      if(started===generation&&pending===operation){
        operation.knownRejected=!readOnly&&operation.fresh===true&&[400,403,404,409].includes(error.status);
        operation.fresh=false;
      }
      throw error;
    }finally{if(started===generation)busy=false;}
  }
  return Object.freeze({
    get pending(){return pending!==null;},get body(){return pending?.body??null;},get id(){return pending?.id??null;},get knownRejected(){return pending?.knownRejected===true;},
    async run({registrationIds,retryRejected=false,expectedAccessRevisions}){
      if(pending||busy)throw new Error('请先核对原确认信，不会另建寄送。');
      const body=JSON.stringify({registrationIds,retryRejected,expectedRevision:revision(),operationId:operationId(),...(expectedAccessRevisions===undefined?{}:{expectedAccessRevisions})}),value=deliveryConfirmationRequestView(body);
      if(!value)throw new Error('请重新读取确认信名单，再选择收件人。');
      pending={...value,fresh:true,knownRejected:false};return perform(false);
    },
    restore(body){
      if(pending||busy){if(pending?.body===body)return;throw new Error('原确认信仍待核对。');}
      const value=deliveryConfirmationRequestView(body);if(!value)throw new Error('本机确认信记录无法核对，请保留原记录。');pending={...value,fresh:false,knownRejected:false};
    },
    restoreLegacy(value){
      const checked=deliveryLegacyDispatchView(value);if(!checked)throw new Error('旧确认信记录无法核对，请保留原记录。');
      if(pending||busy){if(pending?.id===checked.id&&pending.body===null)return;throw new Error('原确认信仍待核对。');}
      pending={...checked,body:null,fresh:false,knownRejected:false};
    },
    lookup:()=>perform(true),
    acknowledgeRejection(){if(busy||!pending?.knownRejected)throw new Error('原确认信尚未证明未提交。');pending=null;},
    clear(){generation++;pending=null;busy=false;},
  });
}

export function deliveryReminderOperationView(value,operationId){
  if(value?.kind!=='pre_event_reminder')return null;
  const result=deliveryDispatchView(value,operationId);return result?{...result,operationId,kind:'pre_event_reminder'}:null;
}

/** Reminder unknowns are reconciled with GET; the original POST is never replayed. */
export function deliveryReminderRequestView(body){
    if(typeof body!=='string'||body.length>16000)return null;
    let value;try{value=JSON.parse(body);}catch{return null;}
    if(!plain(value)||!['expectedRevision,operationId,registrationIds,retryRejected','expectedAccessRevisions,expectedRevision,operationId,registrationIds,retryRejected'].includes(Object.keys(value).sort().join(','))||!Number.isSafeInteger(value.expectedRevision)||value.expectedRevision<0
      ||!/^[A-Za-z0-9_-]{32,128}$/u.test(value.operationId??'')||typeof value.retryRejected!=='boolean'||!Array.isArray(value.registrationIds)||!value.registrationIds.length||value.registrationIds.length>100
      ||new Set(value.registrationIds).size!==value.registrationIds.length||value.registrationIds.some(id=>!/^[A-Za-z0-9_-]{43}$/u.test(id))
      ||Object.hasOwn(value,'expectedAccessRevisions')&&!validAccessRevisions(value.expectedAccessRevisions,value.registrationIds))return null;
    return{body,id:value.operationId,ids:[...value.registrationIds],revision:value.expectedRevision};
}
export function createReminderMutations({request,revision,operationId=()=>crypto.randomUUID().replaceAll('-','')}){
  let pending=null,busy=false,generation=0;
  async function perform(readOnly){
    if(!pending||busy)throw new Error('请先核对当前提醒。');const started=generation,operation=pending;busy=true;
    try{
      const value=await request('/api/admin/registration-confirmation/'+(readOnly?'reminder-operation/'+operation.id:'reminder-dispatch'),readOnly?{method:'GET'}:{method:'POST',body:operation.body});
      if(started!==generation||operation!==pending)throw new Error('会话已改变，请重新读取提醒。');
      const result=deliveryReminderOperationView(value,operation.id);
      if(!result||result.results.length!==operation.ids.length||operation.ids.some(id=>!result.results.some(row=>row.registrationId===id)))throw new Error('提醒结果尚未完整，请核对原寄送。');
      if(result.status!=='unknown'&&!result.results.some(row=>row.status==='unknown'))pending=null;return result;
    }catch(error){if(started===generation&&!readOnly&&Number.isInteger(error.status)&&error.status>=400&&error.status<500)pending=null;throw error;}
    finally{if(started===generation)busy=false;}
  }
  return Object.freeze({
    get pending(){return pending!==null;},get body(){return pending?.body??null;},get id(){return pending?.id??null;},
    async run({registrationIds,retryRejected=false,expectedAccessRevisions}){
      if(pending||busy)throw new Error('请先核对原寄送，不会另建提醒。');
      const body=JSON.stringify({registrationIds,retryRejected,expectedRevision:revision(),operationId:operationId(),...(expectedAccessRevisions===undefined?{}:{expectedAccessRevisions})}),operation=deliveryReminderRequestView(body);
      if(!operation)throw new Error('请重新读取提醒名单，再选择收件人。');pending=operation;return perform(false);
    },
    restore(body){if(pending||busy){if(pending?.body===body)return;throw new Error('原提醒尚待核对。');}const value=deliveryReminderRequestView(body);if(!value)throw new Error('本机提醒记录无效，请保留原记录并联系主办方。');pending=value;},
    lookup:()=>perform(true),
    clear(){generation++;pending=null;busy=false;},
  });
}
export function deliveryDispatchView(value,operationId){
  if(!plain(value)||!['updated','replayed'].includes(value.outcome)||!Number.isSafeInteger(value.revision)||value.revision<0||value.operationId!==operationId
    ||!['completed','partial','unknown'].includes(value.status)||!Array.isArray(value.results)||value.results.length>100)return null;
  const ids=new Set();for(const row of value.results){if(!/^[A-Za-z0-9_-]{43}$/u.test(row.registrationId??'')||ids.has(row.registrationId)||!states.includes(row.status))return null;ids.add(row.registrationId);}
  return{revision:value.revision,status:value.status,results:value.results.map(row=>({registrationId:row.registrationId,status:row.status}))};
}
export function createDeliveryMutations({request,revision,operationId=()=>crypto.randomUUID().replaceAll('-','')}){
  let pending=null,busy=false,generation=0;
  async function send(){
    if(!pending||busy)throw new Error('请先核对当前操作。');const started=generation,operation=pending;busy=true;
    try{
      const value=await request(operation.path,{method:operation.method,body:operation.body});
      if(started!==generation||operation!==pending)throw new Error('会话已变更，请重新读取设置。');
      const result=operation.kind==='settings'&&['updated','replayed'].includes(value.outcome)?deliverySettingsView(value)
        :operation.kind==='dispatch'?deliveryDispatchView(value,operation.id):null;
      if(!result||operation.kind==='settings'&&(value.operationId!==operation.id||value.enabled!==operation.enabled||result.revision<operation.revision+1))throw new Error('结果未通过核对，请保留本页并再次确认同一操作。');
      if(operation.kind==='dispatch'&&(result.results.length!==operation.ids.length||operation.ids.some(id=>!result.results.some(row=>row.registrationId===id))))throw new Error('逐人结果尚未完整，请保留本页并再次确认同一操作。');
      pending=null;return{kind:operation.kind,value:result,...(operation.kind==='settings'?{requestedEnabled:operation.enabled}:{})};
    }catch(error){if(started===generation&&Number.isInteger(error.status)&&error.status>=400&&error.status<500)pending=null;throw error;}
    finally{if(started===generation)busy=false;}
  }
  return Object.freeze({
    get pending(){return pending!==null;},
    async run(kind,data){
      if(pending||busy)throw new Error('上次结果尚未确认，请先再次确认同一操作。');
      const id=operationId(),expectedRevision=revision();if(!/^[A-Za-z0-9_-]{32,128}$/u.test(id)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0||!['settings','dispatch'].includes(kind))throw new Error('设置尚未读取，请先刷新。');
      pending={kind,id,revision:expectedRevision,enabled:kind==='settings'?data.enabled:undefined,ids:kind==='dispatch'?[...data.registrationIds]:[],path:'/api/admin/registration-confirmation/'+(kind==='settings'?'settings':'dispatch'),method:kind==='settings'?'PUT':'POST',body:JSON.stringify({...data,expectedRevision,operationId:id})};return send();
    },
    retry:send,
    clear(){generation++;pending=null;busy=false;},
  });
}
