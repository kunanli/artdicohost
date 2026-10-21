import { validateGeneralApplicationFields, GENERAL_APPLICATION_INTAKE } from '../../shared/general-application.mjs';

const EVENT=/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u,KEY=/^[a-f0-9]{64}$/u;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const exact=(value,keys)=>plain(value)&&Reflect.ownKeys(value).length===keys.length&&keys.every(key=>Object.getOwnPropertyDescriptor(value,key)?.enumerable&&'value' in Object.getOwnPropertyDescriptor(value,key));
const fail=()=>{const error=new Error('本机恢复记录无法核对，请保留当前页面。');error.code='DRAFT_INVALID';throw error;};
const formed=value=>{for(const character of value){const point=character.codePointAt(0);if(point>=0xd800&&point<=0xdfff)return false;}return true;};
export const APPLICATION_DRAFT_KEYS=Object.freeze(['intake','name','email','category','organization','city','wechat','proposal','topic','summary']);
export function applicationDraftValue(value){
  if(!exact(value,APPLICATION_DRAFT_KEYS)||value.intake!==GENERAL_APPLICATION_INTAKE||typeof value.proposal!=='boolean')fail();
  const result={intake:GENERAL_APPLICATION_INTAKE};
  for(const[key,max]of[['name',80],['email',254],['category',80],['organization',160],['city',100],['wechat',100],['topic',200],['summary',1500]]){const text=value[key];if(typeof text!=='string'||text.length>max*2||[...text].length>max||!formed(text)||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)||key!=='summary'&&/[\r\n\t]/u.test(text))fail();result[key]=text;}
  result.proposal=value.proposal;return result;
}
export function applicationPendingValue(value,eventId){
  if(!exact(value,['eventId','idempotencyKey','payloadJson','attempted','uncertain'])||!EVENT.test(value.eventId)||eventId!==undefined&&value.eventId!==eventId||!KEY.test(value.idempotencyKey)||typeof value.payloadJson!=='string'||new TextEncoder().encode(value.payloadJson).length>128*1024||typeof value.attempted!=='boolean'||typeof value.uncertain!=='boolean'||value.uncertain&&!value.attempted)fail();
  let payload;try{payload=JSON.parse(value.payloadJson);}catch{fail();}
  if(!exact(payload,['eventId','fields','consent'])||payload.eventId!==value.eventId||!exact(payload.consent,['accepted','version'])||payload.consent.accepted!==true||typeof payload.consent.version!=='string'||!payload.consent.version.trim()||payload.consent.version.length>4000||/demo|frontend|mock/iu.test(payload.consent.version)||!validateGeneralApplicationFields(payload.fields).valid||JSON.stringify(payload)!==value.payloadJson)fail();
  return{eventId:value.eventId,idempotencyKey:value.idempotencyKey,payloadJson:value.payloadJson,attempted:value.attempted,uncertain:value.uncertain};
}
export function applicationDraftFromFields(fields){
  return applicationDraftValue({intake:GENERAL_APPLICATION_INTAKE,name:fields.name??'',email:fields.email??'',category:fields.categories?.[0]??'',organization:fields.organization??'',city:fields.city??'',wechat:fields.wechat??'',proposal:fields.participationInterests?.includes('talk')===true,topic:fields.speaker?.topic??'',summary:fields.speaker?.summary??''});
}
export function applicationDraftScope(eventId){if(!EVENT.test(eventId))fail();return{actorId:'public',eventId,page:'application',entityId:GENERAL_APPLICATION_INTAKE};}
export const applicationDraftPolicy=Object.freeze({fields:[...new Set([...APPLICATION_DRAFT_KEYS,'eventId','idempotencyKey','payloadJson','attempted','uncertain'])],pendingFields:['idempotencyKey','payloadJson'],jsonFields:['payloadJson'],validate(value,{kind}){try{if(kind==='editing')applicationDraftValue(value);else if(kind==='pending_submission')applicationPendingValue(value);else return false;return true;}catch{return false;}}});
/** CAS wrapper. Reads and cache writes never send an application. */
export function createApplicationDraft({store,eventId}={}){
  if(!store||!['read','write','remove','subscribe'].every(key=>typeof store[key]==='function'))fail();
  const scope=applicationDraftScope(eventId);let snapshot=null;
  const remember=value=>{if(!value||!Number.isSafeInteger(value.revision)||value.revision<0||!Number.isSafeInteger(value.actorEpoch)||value.actorEpoch<0||value.record!==null&&!plain(value.record))fail();if(value.record){if(value.record.kind==='editing')applicationDraftValue(value.record.value);else if(value.record.kind==='pending_submission')applicationPendingValue(value.record.value,eventId);else fail();}snapshot=value;return structuredClone(value);};
  const loaded=()=>{if(!snapshot)fail();return snapshot;};
  const samePending=value=>snapshot?.record?.kind==='pending_submission'&&snapshot.record.value.idempotencyKey===value.idempotencyKey&&snapshot.record.value.payloadJson===value.payloadJson;
  async function write(kind,value){const current=loaded();return remember(await store.write(scope,{expectedRevision:current.revision,actorEpoch:current.actorEpoch,kind,baseRevision:null,value},applicationDraftPolicy));}
  async function read(){return remember(await store.read(scope,applicationDraftPolicy));}
  const pendingStore={
    async prepare(raw){const value=applicationPendingValue(raw,eventId);if(loaded().record?.kind==='pending_submission')fail();const result=await write('pending_submission',value);return result.record.value;},
    async update(raw){const value=applicationPendingValue(raw,eventId);if(!samePending(value)||snapshot.record.value.attempted&&!value.attempted||snapshot.record.value.uncertain&&!value.uncertain)fail();const result=await write('pending_submission',value);return result.record.value;},
    async clear(raw){const value=applicationPendingValue(raw,eventId);await read();if(!samePending(value))fail();const current=loaded();return remember(await store.remove(scope,{expectedRevision:current.revision,actorEpoch:current.actorEpoch,allowPending:true}));},
    async reject(raw){const value=applicationPendingValue(raw,eventId);await read();if(!samePending(value)||snapshot.record.value.uncertain)fail();const current=loaded();remember(await store.remove(scope,{expectedRevision:current.revision,actorEpoch:current.actorEpoch,allowPending:true}));return write('editing',applicationDraftFromFields(JSON.parse(value.payloadJson).fields));},
  };
  return Object.freeze({scope,pendingStore,read,get snapshot(){return snapshot?structuredClone(snapshot):null;},save(value){if(loaded().record?.kind==='pending_submission')fail();return write('editing',applicationDraftValue(value));},async clear(){const current=loaded();if(current.record?.kind==='pending_submission')fail();return remember(await store.remove(scope,{expectedRevision:current.revision,actorEpoch:current.actorEpoch,allowPending:false}));},subscribe(listener){return store.subscribe(scope,listener);}});
}
