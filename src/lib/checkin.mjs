const ticketPattern=/^[A-Za-z0-9_-]{22}$/u;
const operationPattern=/^[A-Za-z0-9_-]{43}$/u;
const statuses=new Set(['pending_review','confirmed','waitlisted','rejected','withdrawn']);
const object=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const iso=value=>typeof value==='string'&&value.length<=35&&/^\d{4}-\d{2}-\d{2}T/u.test(value)&&Number.isFinite(Date.parse(value));
export function readEntryTicket(hash){return typeof hash==='string'?/^#ticket=([A-Za-z0-9_-]{22})$/u.exec(hash)?.[1]??null:null;}
export function validEntryView(value,code){
  return object(value)&&value.ticketCode===code&&ticketPattern.test(code)&&Number.isSafeInteger(value.revision)&&value.revision>=0
    &&typeof value.registrationId==='string'&&/^[A-Za-z0-9_-]{43}$/u.test(value.registrationId)
    &&typeof value.name==='string'&&value.name.length<=120&&typeof value.organization==='string'&&value.organization.length<=300
    &&statuses.has(value.admissionStatus)&&typeof value.eligible==='boolean'&&typeof value.canCheckIn==='boolean'
    &&(value.checkedInAt===null||iso(value.checkedInAt))
    &&(!value.eligible||value.admissionStatus==='confirmed')&&(!value.canCheckIn||value.eligible&&!value.checkedInAt)
    &&(value.eligible||value.name===''&&value.organization==='');
}
function validReceipt(value,code,operationId){return validEntryView(value,code)&&value.operationId===operationId&&['checked_in','already_checked_in'].includes(value.outcome)&&Boolean(value.checkedInAt);}
function randomOperation(cryptoFn){const bytes=new Uint8Array(32);cryptoFn.getRandomValues(bytes);let text='';for(const byte of bytes)text+=String.fromCharCode(byte);return btoa(text).replaceAll('+','-').replaceAll('/','_').replace(/=+$/u,'');}
const failure=(message,status=0)=>Object.assign(new Error(message),{status,entrySafe:true});
const messageFor=status=>({401:'请登录后核验入场。',403:'此账号没有入场核验权限。',404:'入场码已失效，请联系主办方。',409:'记录已更新，请重新核对。',429:'请求较多，请稍后核对。',503:'核验服务暂时不可用，请稍后核对。'})[status]??'暂时无法核对，请稍后重试。';

/** One scanned token stays in memory. Reads never check anyone in; uncertain writes
 * retain their exact operation and only query its receipt. No private data is stored. */
export function createEntryCheckin({ticketCode,fetchFn=globalThis.fetch,cryptoFn=globalThis.crypto,onChange=()=>{},timeoutMs=12000}={}){
  let code=ticketPattern.test(ticketCode??'')?ticketCode:null,user=null,csrf='',epoch=0,busy=false,view=null,pending=null,message='',error='',controllers=new Set();
  const snapshot=()=>({hasTicket:Boolean(code),user:user?{...user,roles:[...user.roles]}:null,busy,view:view?{...view}:null,unresolved:Boolean(pending),message,error});
  const emit=()=>onChange(snapshot());
  function expire(){epoch++;user=null;csrf='';view=null;for(const controller of controllers)controller.abort();controllers.clear();}
  async function request(path,{method='GET',body}={}){
    const stamp=epoch,controller=new AbortController();controllers.add(controller);const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetchFn(path,{method,credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal,
        headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{}),...(method!=='GET'&&csrf?{'X-CSRF-Token':csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});
      if(stamp!==epoch)throw failure('会话已改变，请重新核对。');
      if(response.status===401||response.status===403){const status=response.status;expire();throw failure(messageFor(status),status);}
      if(!response.ok)throw failure(messageFor(response.status),response.status);
      if(!/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type')??''))throw failure('核验结果格式无效，请重新核对。');
      const raw=await response.text();if(raw.length>16384)throw failure('核验结果格式无效，请重新核对。');
      let value;try{value=JSON.parse(raw);}catch{throw failure('核验结果格式无效，请重新核对。');}
      if(stamp!==epoch)throw failure('会话已改变，请重新核对。');return value;
    }finally{clearTimeout(timer);controllers.delete(controller);}
  }
  async function action(fn){if(busy)return;busy=true;message='';error='';emit();try{await fn();}catch(reason){error=reason?.entrySafe===true?reason.message:'暂时无法核对，请稍后重试。';}finally{busy=false;emit();}}
  function session(value){
    if(!object(value)||!object(value.user)||typeof value.user.id!=='string'||!value.user.id||value.user.id.length>160||!Array.isArray(value.user.roles)||value.user.roles.some(role=>typeof role!=='string')||typeof value.csrfToken!=='string'||!/^[A-Za-z0-9_-]{43}$/u.test(value.csrfToken))throw failure('工作人员会话未通过核对。');
    user={id:value.user.id,label:typeof value.user.label==='string'?value.user.label:'工作人员',roles:[...value.user.roles]};csrf=value.csrfToken;
  }
  async function inspect(){
    view=null;
    if(!code){message='请用手机扫描参会者的入场二维码。';return;}
    if(pending){await recover();return;}
    const value=await request('/api/admin/checkin/'+code);if(!validEntryView(value,code))throw failure('入场记录未通过核对。');view=value;
    message=value.checkedInAt?'已入场':value.eligible?'请核对姓名后确认入场。':'此票券当前不能入场。';
  }
  async function recover(){
    if(!pending)return;
    if(user?.id!==pending.actor){view=null;throw failure('请由原操作账号登录后核对入场结果。');}
    const value=await request('/api/admin/checkin/'+code+'/operation/'+pending.operationId);
    if(!object(value)||typeof value.found!=='boolean')throw failure('入场结果未通过核对，请继续核对原操作。');
    if(!value.found){
      const current=await request('/api/admin/checkin/'+code);
      if(!validEntryView(current,code))throw failure('入场记录未通过核对。');
      if(current.checkedInAt){view=current;pending=null;message='已入场';return;}
      view=null;message='尚未查到原操作结果，请稍后继续核对。';return;
    }
    if(!validReceipt(value.result,code,pending.operationId))throw failure('入场结果未通过核对，请继续核对原操作。');
    view=value.result;pending=null;message='已入场';
  }
  return Object.freeze({get state(){return snapshot();},
    resume:()=>action(async()=>{session(await request('/api/admin/session'));await inspect();}),
    login:credentials=>action(async()=>{session(await request('/api/admin/login',{method:'POST',body:credentials}));await inspect();}),
    refresh:()=>action(async()=>{if(user)await inspect();}),
    check:()=>action(async()=>{if(user)await recover();}),
    confirm:()=>{
      if(!code||!user||!view?.canCheckIn||!view.eligible||view.checkedInAt||pending)return Promise.resolve();
      return action(async()=>{
      const operationId=randomOperation(cryptoFn);if(!operationPattern.test(operationId))throw failure('暂时无法确认入场，请重新核对。');
      pending={operationId,expectedRevision:view.revision,actor:user.id};view={...view,canCheckIn:false};emit();
      let value;
      try{value=await request('/api/admin/checkin/'+code,{method:'POST',body:{operationId,expectedRevision:pending.expectedRevision}});}
      catch(reason){message='入场结果待核对，请核对原操作。';throw reason;}
      if(!validReceipt(value,code,operationId)){message='入场结果待核对，请核对原操作。';throw failure('入场结果未通过核对。');}
      view=value;pending=null;message='已入场';
      });
    },
    logout:()=>action(async()=>{
      try{await request('/api/admin/logout',{method:'POST'});}finally{expire();code=null;pending=null;message='页面资料已清空，请重新扫描入场码。';}
    }),
    clear(){expire();code=null;pending=null;busy=false;message='';error='';emit();},
  });
}

export function mountEntryCheckin(root,{location=globalThis.location,history=globalThis.history,...options}={}){
  if(!root)return null;
  const $=selector=>root.querySelector(selector),secure=location.protocol==='https:'||['127.0.0.1','localhost'].includes(location.hostname),ticketCode=readEntryTicket(location.hash);
  if(location.hash)history.replaceState(null,'',location.pathname+location.search);
  const formatTime=value=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Taipei',dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
  const client=createEntryCheckin({...options,ticketCode,onChange(state){
    $('[data-entry-login-panel]').hidden=Boolean(state.user);$('[data-entry-workspace]').hidden=!state.user;
    $('[data-entry-account]').textContent=state.user?.label??'';$('[data-entry-message]').textContent=state.message;
    $('[data-entry-error]').textContent=state.error;$('[data-entry-error]').hidden=!state.error;
    $('[data-entry-record]').hidden=!state.view;
    $('[data-entry-name]').textContent=state.view?.name??'';$('[data-entry-organization]').textContent=state.view?.organization??'';
    $('[data-entry-time]').textContent=state.view?.checkedInAt?'入场时间：'+formatTime(state.view.checkedInAt):'';
    $('[data-entry-confirm]').hidden=!state.view?.canCheckIn||state.unresolved;$('[data-entry-confirm]').disabled=state.busy;
    $('[data-entry-check]').hidden=!state.unresolved;$('[data-entry-check]').disabled=state.busy;
    $('[data-entry-refresh]').hidden=state.unresolved;$('[data-entry-refresh]').disabled=state.busy||!state.hasTicket;
    $('[data-entry-logout]').disabled=state.busy;
    for(const field of $('[data-entry-login]').querySelectorAll('input,button'))field.disabled=state.busy||!secure;
    root.setAttribute('aria-busy',String(state.busy));options.onChange?.(state);
  }});
  $('[data-entry-login]').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget,username=form.elements.namedItem('username').value,password=form.elements.namedItem('password').value;form.elements.namedItem('password').value='';void client.login({username,password});});
  $('[data-entry-confirm]').addEventListener('click',()=>void client.confirm());
  $('[data-entry-check]').addEventListener('click',()=>void client.check());
  $('[data-entry-refresh]').addEventListener('click',()=>void client.refresh());
  $('[data-entry-logout]').addEventListener('click',()=>void client.logout());
  globalThis.addEventListener?.('pagehide',()=>client.clear(),{once:true});
  if(secure)void client.resume();else{$('[data-entry-error]').textContent='请通过安全网址打开入场核验。';$('[data-entry-error]').hidden=false;}
  return client;
}
