import {canManageEventOperations} from '../../shared/staff-permissions.mjs';
import {CONFIRMATION_EMAIL_CONFIGURATION_FIELDS,CONFIRMATION_EMAIL_REASONS} from '../../shared/confirmation-delivery.mjs';

const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const states=['provider_accepted','rejected','unknown','disabled','not_configured','not_applicable','not_public','withdrawn','unavailable','not_attempted'];
const emailFields=new Set(CONFIRMATION_EMAIL_CONFIGURATION_FIELDS),emailReasons=new Set(CONFIRMATION_EMAIL_REASONS);
const validEmailFields=value=>Array.isArray(value)&&value.length<=emailFields.size&&new Set(value).size===value.length&&[...value].every(key=>emailFields.has(key));
const emailMessages={CONFIGURED_PROVIDER_NOT_DELIVERY_PROOF:'寄件设置可用，实际收件另行核对。',EMAIL_NOT_READY:'寄件设置未就绪，请核对设置。',
  EMAIL_DISABLED:'寄件服务未开启，请核对设置。',EMAIL_CONFIGURATION_MISSING:'寄件设置未齐，请补齐所列项目。',
  EMAIL_CONFIGURATION_INVALID:'寄件设置有误，请核对所列项目。',EMAIL_CONFIGURATION_UNAVAILABLE:'寄件设置暂时无法读取，请重新核对。'};
const emailFieldLabels={EMAILJS_SERVICE_ID:'寄件服务',EMAILJS_CONFIRMATION_TEMPLATE_ID:'确认信模板',EMAILJS_PUBLIC_KEY:'服务公钥',
  EMAILJS_PRIVATE_KEY:'服务私钥',EMAIL_FROM_ADDRESS:'寄件邮箱',EMAIL_FROM_NAME:'寄件名称'};
function emailSettingsView(value){
  if(!plain(value)||typeof value.ready!=='boolean'||!validEmailFields(value.missing)||value.invalid!==undefined&&!validEmailFields(value.invalid))return null;
  const reason=value.reason===undefined?(value.ready?'CONFIGURED_PROVIDER_NOT_DELIVERY_PROOF':'EMAIL_NOT_READY')
    :emailReasons.has(value.reason)?value.reason:'EMAIL_CONFIGURATION_UNAVAILABLE';
  return{ready:value.ready,reason,missing:[...value.missing],...(value.invalid===undefined?{}:{invalid:[...value.invalid]})};
}
/** Staff-facing text is selected only from the safe vocabulary; values never enter the UI. */
export function deliveryEmailPresentation(value){
  const email=emailSettingsView(value);
  if(!email)return{message:emailMessages.EMAIL_CONFIGURATION_UNAVAILABLE,fields:[]};
  return{message:emailMessages[email.reason],fields:[...email.missing.map(key=>'缺少：'+emailFieldLabels[key]),...(email.invalid??[]).map(key=>'无效：'+emailFieldLabels[key])]};
}
const walletReasons=new Set(['WALLET_NOT_CONFIGURED','WALLET_DISABLED','CONFIGURED_SIGNER_DEVICE_TEST_REQUIRED','WALLET_BUNDLE_UNAVAILABLE',
  'WALLET_CERTIFICATE_INVALID','WALLET_CERTIFICATE_EXPIRED','WALLET_CERTIFICATE_CHAIN_INVALID','WALLET_CERTIFICATE_ID_MISMATCH',
  'WALLET_CERTIFICATE_TYPE_INVALID','WALLET_IDENTITY_INVALID','WALLET_PRIVATE_KEY_INVALID','WALLET_UNAVAILABLE']);
const validExpiry=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const validCounts=value=>plain(value)&&['total','providerAccepted','rejected','unknown'].every(key=>Number.isSafeInteger(value[key])&&value[key]>=0&&value[key]<=10000);
const copyCounts=value=>Object.fromEntries(['total','providerAccepted','rejected','unknown'].map(key=>[key,value[key]]));
export function deliverySettingsView(value){
  const email=emailSettingsView(value?.email);
  if(!plain(value)||!Number.isSafeInteger(value.revision)||value.revision<0||typeof value.automaticEnabled!=='boolean'||!email
    ||typeof value.wallet?.ready!=='boolean'||value.wallet.missing!==undefined&&(!Array.isArray(value.wallet.missing)||value.wallet.missing.length>20||value.wallet.missing.some(key=>typeof key!=='string'||!/^[A-Z][A-Z0-9_]{0,79}$/u.test(key)))
    ||value.wallet.deviceTestRequired!==undefined&&typeof value.wallet.deviceTestRequired!=='boolean'
    ||value.wallet.certificateExpiresAt!==undefined&&!validExpiry(value.wallet.certificateExpiresAt)
    ||!validCounts(value.counts)||value.notificationCounts!==undefined&&(!plain(value.notificationCounts)||['applicationReceived','preEventReminder'].some(key=>!validCounts(value.notificationCounts[key]))))return null;
  const reason=value.wallet.reason===undefined?(value.wallet.ready?'CONFIGURED_SIGNER_DEVICE_TEST_REQUIRED':'WALLET_NOT_CONFIGURED')
    :walletReasons.has(value.wallet.reason)?value.wallet.reason:'WALLET_UNAVAILABLE';
  return{revision:value.revision,automaticEnabled:value.automaticEnabled,email,
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

// Staff-reviewed external ticket intake. Raw source bytes and row contents live
// only in memory; recovery storage contains operation IDs, hashes and selections.
const HDX_EVENT='8884819113200',HDX_KIND='huodongxing',HDX_ID=/^[A-Za-z0-9_-]{43}$/u,HDX_SHA=/^[a-f0-9]{64}$/u;
const hdxPermission=sha=>'活动行 https://9525102647817.huodongxing.com/event/'+HDX_EVENT+' · 原文件 SHA-256 '+sha;
const hdxText=(value,max=300)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f\u007f]/u.test(value);
const hdxHash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
const HUODONGXING_REASON_LABELS=Object.freeze({
  POSSIBLE_DUPLICATE:'相同联系方式，请核对是否同一人',TICKET_STATUS_REVIEW:'原票务状态需核对',
  NAME_MISSING:'缺少姓名',EMAIL_MISSING:'缺少邮箱',REGISTRATION_TIME_MISSING:'缺少报名时间',
  SOURCE_CHANGED:'原名单与已保存来源不同，请核对修改',CONTACT_DECLINED:'已记录拒绝联络或出席',
  CONTACT_EMAIL_CHANGED:'当前邮箱已更改，请核对本人资料',CONTACT_NOT_FOUND:'关联人员已变化，请重新核对',
  LINK_CHANGED:'所选主报名或名额已变化，请重新核对',STAFF_PERMISSION_REQUIRED:'本次通知依据尚未核对',
  ADMISSION_WITHDRAWN:'关联名额已撤回',ADMISSION_WAITLISTED:'关联报名仍在候补，尚无入场名额',
  ADMISSION_PENDING_REVIEW:'关联报名待审核，尚无入场名额',ADMISSION_REJECTED:'关联报名未通过，不能分配入场券',
  CAPACITY_CONFLICT:'当前没有可确认名额，未分配入场券',CAPACITY_EXCEEDED:'名单容量已满，请联系维护人员',
  REGISTRATION_INVALID:'报名资料未通过校验，请核对',REGISTRATION_DISABLED:'本站报名暂未开放',
  REGISTRATION_NOT_OPEN:'本站报名尚未开始',REGISTRATION_CLOSED:'本站报名已结束',
  REGISTRATION_INACTIVE:'关联报名已停用',REVISION_CONFLICT:'名单已更新，请重新核对',
  STORAGE_UNAVAILABLE:'暂时无法核对，请稍后读取原操作',
});
export function huodongxingReasonLabel(code){return typeof code==='string'&&Object.hasOwn(HUODONGXING_REASON_LABELS,code)?HUODONGXING_REASON_LABELS[code]:'此行需要核对';}
export function huodongxingPreviewView(value){
  if(!value||value.kind!==HDX_KIND||value.sourceEventId!==HDX_EVENT||!hdxText(value.previewToken,256)||!value.previewToken||![value.expectedRevision,value.expectedTicketRevision,value.expectedAdmissionRevision].every(number=>Number.isSafeInteger(number)&&number>=0)||typeof value.canCommit!=='boolean'||!value.summary||!['total','new','existing','needsReview','eligible'].every(key=>Number.isSafeInteger(value.summary[key])&&value.summary[key]>=0&&value.summary[key]<=500)||!Array.isArray(value.rows)||value.rows.length!==value.summary.total||value.rows.length>500)return null;
  const tids=new Set();for(const row of value.rows){if(!row||!hdxText(row.tid,100)||!row.tid||tids.has(row.tid)||!Number.isSafeInteger(row.sourceRow)||row.sourceRow<2||row.sourceRow>501||!hdxText(row.name,160)||!hdxText(row.email,254)||!['new','existing','needs_review'].includes(row.status)||typeof row.canSelect!=='boolean'||!(row.reason===null||hdxText(row.reason,160))||!(row.registrationId===null||HDX_ID.test(row.registrationId??''))||!Array.isArray(row.candidates)||row.candidates.length>100)return null;tids.add(row.tid);const candidates=new Set();for(const item of row.candidates){if(!item||!HDX_ID.test(item.registrationId??'')||candidates.has(item.registrationId)||!hdxText(item.name,160)||!hdxText(item.organization,600)||!hdxText(item.status,80))return null;candidates.add(item.registrationId);}}
  return value;
}
export function huodongxingOperationView(value,id){
  if(!value||value.kind!==HDX_KIND||value.operationId!==id||!HDX_SHA.test(id)||!['completed','partial','pending'].includes(value.status)||value.finished!==undefined&&typeof value.finished!=='boolean'||!Array.isArray(value.results)||value.results.length>100||!Array.isArray(value.registrationIds)||value.registrationIds.length>100||new Set(value.registrationIds).size!==value.registrationIds.length||value.registrationIds.some(key=>!HDX_ID.test(key)))return null;
  const tids=new Set();for(const item of value.results){if(!item||!hdxText(item.tid,100)||!item.tid||tids.has(item.tid)||!['imported','linked','existing','needs_review','capacity_conflict','unknown'].includes(item.status)||(['imported','linked','existing'].includes(item.status)?!HDX_ID.test(item.registrationId??''):item.registrationId!==undefined&&item.registrationId!==null&&!HDX_ID.test(item.registrationId))||item.reason!==undefined&&item.reason!==null&&!hdxText(item.reason,200))return null;tids.add(item.tid);}
  if(value.registrationIds.some(id=>!value.results.some(row=>row.registrationId===id&&['imported','linked','existing'].includes(row.status))))return null;
  return value;
}
export function createHuodongxingMutations({request,getUser,eventId,storage,clock=Date.now,hashText=hdxHash,operationId=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('')}={}){
  let pending=null,source=null,preview=null,mailPreview=null,pendingMail=null,busy=false,generation=0;
  const key='artdico:huodongxing:v1:'+eventId,scope=()=>{const user=getUser();return user?.id+'|'+[...(user?.roles??[])].sort().join(',');};
  const allowed=()=>canManageEventOperations(getUser()),store=()=>storage??globalThis.sessionStorage;
  const persist=()=>{const user=getUser();if(!user?.id)return;const value={schemaVersion:1,actorId:user.id,roles:[...(user.roles??[])].sort(),eventId,expiresAt:clock()+30*60*1000,pendingImport:pending?{operationId:pending.id,sourceSha:pending.sourceSha,rowsSha:pending.rowsSha,bodySha:pending.bodySha,command:pending.command}:null,pendingMail};const raw=JSON.stringify(value);if(raw.length>65536)throw Error('原操作记录过大，请分批导入。');try{store().setItem(key,raw);}catch{throw Error('无法保留原操作，请检查浏览器储存后再继续。');}};
  const emails=createConfirmationMutations({revision:()=>mailPreview?.revision,operationId:()=>operationId().slice(0,32),request:async(path,options)=>{if(options.method==='POST'){pendingMail=options.body;persist();}return request(path,options);}});
  function ready(){if(!allowed())throw Error('需要完整活动管理权限。');if(busy)throw Error('正在核对原操作，请稍候。');}
  async function guarded(run){ready();const current=++generation,actor=scope();busy=true;try{const value=await run(()=>current===generation&&scope()===actor&&allowed());if(current!==generation||scope()!==actor||!allowed())throw Error('会话已改变，已清除私人预览。');return value;}finally{if(current===generation)busy=false;}}
  function validSource(value){return value?.kind===HDX_KIND&&value.sourceEventId===HDX_EVENT&&HDX_SHA.test(value.originalSha256??'')&&Array.isArray(value.rows)&&value.rows.length>0&&value.rows.length<=500&&typeof value.sourceFileBase64==='string'&&value.sourceFileBase64.length>0&&value.sourceFileBase64.length<=2796204&&new TextEncoder().encode(JSON.stringify(value)).byteLength<=3*1024*1024;}
  async function restoreSource(value){const original=pending;if(!original||!validSource(value)||value.originalSha256!==pending.sourceSha||await hashText(JSON.stringify(value.rows))!==original.rowsSha||pending!==original)throw Error('请重新选择原来的同一份文件。');const body=JSON.stringify({...value,...original.command});if(await hashText(body)!==original.bodySha||pending!==original)throw Error('原文件或解析版本已变化，不能另建导入。');source=value;pending.body=body;return true;}
  async function executeImport(){const currentPending=pending;if(!currentPending?.body)throw Error('请重新选择原文件后继续原导入。');const result=huodongxingOperationView(await request('/api/admin/contacts/import',{method:'POST',body:currentPending.body}),currentPending.id);if(pending!==currentPending)throw Error('会话已改变。');if(!result)throw Error('导入回执尚未完整，请核对原操作。');if(result.status==='completed'||result.finished===true){pending=null;source=null;preview=null;}persist();return result;}
  function restore(){if(!allowed())return false;try{const raw=store().getItem(key);if(!raw)return false;if(raw.length>65536)throw Error();const saved=JSON.parse(raw),user=getUser();if(saved.schemaVersion!==1||saved.actorId!==user.id||saved.eventId!==eventId||JSON.stringify(saved.roles)!==JSON.stringify([...(user.roles??[])].sort())||!Number.isSafeInteger(saved.expiresAt)||saved.expiresAt>clock()+30*60*1000+5000)throw Error();if(saved.pendingImport){const item=saved.pendingImport;if(![item.operationId,item.sourceSha,item.rowsSha,item.bodySha].every(value=>HDX_SHA.test(value))||!item.command||item.command.operationId!==item.operationId||item.command.permissionReference!==hdxPermission(item.sourceSha)||!Array.isArray(item.command.selectedTids)||item.command.selectedTids.length>100)throw Error();pending={id:item.operationId,sourceSha:item.sourceSha,rowsSha:item.rowsSha,bodySha:item.bodySha,command:item.command,body:null};}if(saved.pendingMail){if(!deliveryConfirmationRequestView(saved.pendingMail))throw Error();pendingMail=saved.pendingMail;emails.restore(saved.pendingMail);}return Boolean(pending||emails.pending);}catch{try{store().removeItem(key);}catch{}pending=null;pendingMail=null;source=null;preview=null;mailPreview=null;emails.clear();return false;}}
  return Object.freeze({
    get pending(){return Boolean(pending);},get pendingId(){return pending?.id??null;},get canResume(){return Boolean(pending?.body);},get canRestart(){return pending?.absent===true;},get mailPending(){return emails.pending;},get mailKnownRejected(){return emails.knownRejected;},get currentPreview(){return preview;},get currentMailPreview(){return mailPreview;},get busy(){return busy;},restore,
    preview:input=>guarded(async current=>{if(pending||emails.pending)throw Error('请先核对原操作。');if(!validSource(input))throw Error('活动行原始文件无法核对。');const value=huodongxingPreviewView(await request('/api/admin/contacts/import/preview',{method:'POST',body:JSON.stringify(input)}));if(!current())throw Error('会话已改变。');if(!value)throw Error('活动行预览无法核对。');if(value.rows.some(row=>!input.rows.some(item=>item.tid===row.tid&&item.sourceRow===row.sourceRow)))throw Error('来源行已变化，请重新预览。');source=input;preview=value;return value;}),
    commit:input=>guarded(async current=>{if(pending||emails.pending||!source||!preview?.canCommit)throw Error('请先读取有效预览并核对原操作。');const ids=input.selectedTids;if(!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length||ids.some(id=>!preview.rows.some(row=>row.tid===id&&row.canSelect))||input.confirmSource!==true||input.confirmPermission!==true)throw Error('请选择最多100张有效票，并确认来源及通知依据。');const links=input.links??[],separateTids=input.separateTids??[];if(!Array.isArray(links)||!Array.isArray(separateTids)||links.some(link=>!ids.includes(link.tid)||!preview.rows.find(row=>row.tid===link.tid)?.candidates.some(item=>item.registrationId===link.registrationId&&item.status==='confirmed'))||separateTids.some(id=>!ids.includes(id))||new Set(links.map(item=>item.tid)).size!==links.length||new Set(separateTids).size!==separateTids.length||links.some(item=>separateTids.includes(item.tid))||ids.some(id=>(preview.rows.find(row=>row.tid===id).candidates.length>0||preview.rows.find(row=>row.tid===id).reason==='POSSIBLE_DUPLICATE')&&!links.some(item=>item.tid===id)&&!separateTids.includes(id)))throw Error('关联对象需要重新核对。');const id=operationId();if(!HDX_SHA.test(id))throw Error('原操作编号无法建立。');const command={operationId:id,expectedRevision:preview.expectedRevision,expectedTicketRevision:preview.expectedTicketRevision,expectedAdmissionRevision:preview.expectedAdmissionRevision,previewToken:preview.previewToken,selectedTids:[...ids],links:structuredClone(links),separateTids:[...separateTids],confirmSource:true,confirmPermission:true,permissionReference:hdxPermission(source.originalSha256)},body=JSON.stringify({...source,...command});if(new TextEncoder().encode(body).byteLength>3*1024*1024)throw Error('本批资料超出可传输范围，请拆表后重新预览。');const sourceSha=source.originalSha256,rowsSha=await hashText(JSON.stringify(source.rows)),bodySha=await hashText(body);if(!current())throw Error('会话已改变。');pending={id,sourceSha,rowsSha,bodySha,command,body};persist();return executeImport();}),
    attachSource:input=>guarded(()=>restoreSource(input)),
    resume:()=>guarded(()=>executeImport()),
    lookup:()=>guarded(async current=>{if(!pending)throw Error('没有待核对的导入。');const original=pending;let raw;try{raw=await request('/api/admin/contacts/import/operations/'+original.id,{method:'GET'});}catch(error){if(current()&&pending===original&&error.status===404&&error.code==='CONTACT_NOT_FOUND')original.absent=true;throw error;}const result=huodongxingOperationView(raw,original.id);if(!current())throw Error('会话已改变。');if(!result)throw Error('原导入结果尚未完整。');if(result.status==='completed'||result.finished===true){pending=null;source=null;preview=null;}persist();return result;}),
    resetUnstarted(){ready();if(!pending?.absent)throw Error('原导入尚未证明未开始，请先核对。');const original=source;pending=null;preview=null;persist();return original;},
    previewMail:ids=>guarded(async current=>{if(pending||emails.pending||!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>!HDX_ID.test(id)))throw Error('请先核对已导入的本批报名。');const result=deliveryConfirmationPreviewView(await request('/api/admin/registration-confirmation/preview',{method:'POST',body:JSON.stringify({registrationIds:ids})}));if(!current())throw Error('会话已改变。');if(!result||result.rows.some(row=>!ids.includes(row.registrationId))||result.nextCursor!==null)throw Error('本批确认信收件人无法核对。');mailPreview=result;return result;}),
    sendMail:ids=>guarded(async()=>{if(pending||emails.pending||!mailPreview||!Array.isArray(ids)||!ids.length||ids.some(id=>!mailPreview.rows.some(row=>row.registrationId===id&&row.eligible&&row.status==='not_sent')))throw Error('请选择本批尚未发送且符合条件的人员。');const result=await emails.run({registrationIds:ids,expectedAccessRevisions:Object.fromEntries(ids.map(id=>[id,mailPreview.rows.find(row=>row.registrationId===id).accessRevision]))});pendingMail=emails.pending?emails.body:null;persist();return result;}),
    acknowledgeRejectedMail(){ready();if(!emails.knownRejected||!mailPreview)throw Error('原确认函尚未证明未提交，请核对原寄送。');const ids=mailPreview.rows.map(row=>row.registrationId);emails.acknowledgeRejection();pendingMail=null;mailPreview=null;persist();return ids;},
    lookupMail:()=>guarded(async()=>{if(!emails.pending)throw Error('没有待核对的确认信。');const result=await emails.lookup();pendingMail=emails.pending?emails.body:null;persist();return result;}),
    clear(){generation++;pending=null;pendingMail=null;source=null;preview=null;mailPreview=null;emails.clear();busy=false;try{store().removeItem(key);}catch{}},
  });
}
