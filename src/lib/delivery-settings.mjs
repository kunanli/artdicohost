const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const states=['provider_accepted','rejected','unknown','disabled','not_configured','not_applicable','not_public','withdrawn','unavailable','not_attempted'];
const walletReasons=new Set(['WALLET_NOT_CONFIGURED','WALLET_DISABLED','CONFIGURED_SIGNER_DEVICE_TEST_REQUIRED','WALLET_BUNDLE_UNAVAILABLE',
  'WALLET_CERTIFICATE_INVALID','WALLET_CERTIFICATE_EXPIRED','WALLET_CERTIFICATE_CHAIN_INVALID','WALLET_CERTIFICATE_ID_MISMATCH',
  'WALLET_CERTIFICATE_TYPE_INVALID','WALLET_IDENTITY_INVALID','WALLET_PRIVATE_KEY_INVALID','WALLET_UNAVAILABLE']);
const validExpiry=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
export function deliverySettingsView(value){
  if(!plain(value)||!Number.isSafeInteger(value.revision)||value.revision<0||typeof value.automaticEnabled!=='boolean'||typeof value.email?.ready!=='boolean'
    ||!Array.isArray(value.email.missing)||value.email.missing.length>30||value.email.missing.some(key=>typeof key!=='string'||!/^[A-Z][A-Z0-9_]{0,100}$/u.test(key))
    ||typeof value.wallet?.ready!=='boolean'||value.wallet.missing!==undefined&&(!Array.isArray(value.wallet.missing)||value.wallet.missing.length>20||value.wallet.missing.some(key=>typeof key!=='string'||!/^[A-Z][A-Z0-9_]{0,79}$/u.test(key)))
    ||value.wallet.deviceTestRequired!==undefined&&typeof value.wallet.deviceTestRequired!=='boolean'
    ||value.wallet.certificateExpiresAt!==undefined&&!validExpiry(value.wallet.certificateExpiresAt)
    ||!plain(value.counts)||['total','providerAccepted','rejected','unknown'].some(key=>!Number.isSafeInteger(value.counts[key])||value.counts[key]<0||value.counts[key]>10000))return null;
  const reason=value.wallet.reason===undefined?(value.wallet.ready?'CONFIGURED_SIGNER_DEVICE_TEST_REQUIRED':'WALLET_NOT_CONFIGURED')
    :walletReasons.has(value.wallet.reason)?value.wallet.reason:'WALLET_UNAVAILABLE';
  return{revision:value.revision,automaticEnabled:value.automaticEnabled,email:{ready:value.email.ready,missing:[...value.email.missing]},
    wallet:{ready:value.wallet.ready,reason,missing:[...(value.wallet.missing??[])],deviceTestRequired:value.wallet.deviceTestRequired!==false,
      ...(value.wallet.certificateExpiresAt===undefined?{}:{certificateExpiresAt:value.wallet.certificateExpiresAt})},
    counts:Object.fromEntries(['total','providerAccepted','rejected','unknown'].map(key=>[key,value.counts[key]]))};
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
