// Public reads only. This module has no automatic startup, storage, or staff I/O.
import {toPublicContent} from '../../shared/content-schema.mjs';
const MAX_BYTES=2*1024*1024;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const own=(value,key)=>Object.getOwnPropertyDescriptor(value,key)?.value;
const canonical=value=>JSON.stringify(value,(_,item)=>plain(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
function jsonValue(value,depth=0,budget={left:30000}){
  if(--budget.left<0||depth>16)return false;
  if(value===null||typeof value==='boolean'||typeof value==='string')return true;
  if(typeof value==='number')return Number.isFinite(value);
  if(!Array.isArray(value)&&!plain(value))return false;
  if(Reflect.ownKeys(value).some(key=>typeof key!=='string'))return false;
  return Object.keys(value).every(key=>Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value')&&jsonValue(own(value,key),depth+1,budget));
}

/** Validate before changing any DOM; fingerprint content without adding defaults. */
export function publicContentEnvelope(input,{eventId='ggj-cn-2026'}={}){
  if(!plain(input)||!jsonValue(input))return null;
  const revision=own(input,'revision'),publishedAt=own(input,'publishedAt'),content=own(input,'content');
  if(!Number.isSafeInteger(revision)||revision<0||typeof publishedAt!=='string'
    ||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/u.test(publishedAt)||!Number.isFinite(Date.parse(publishedAt))||!plain(content))return null;
  const canonicalTime=new Date(publishedAt).toISOString();if(canonicalTime!==publishedAt&&canonicalTime.replace('.000Z','Z')!==publishedAt)return null;
  if(content.eventId!==eventId||['sessions','booths','guests','showcases'].some(key=>!Array.isArray(content[key])||content[key].length>200))return null;
  const fingerprint=canonical(content);if(new TextEncoder().encode(fingerprint).length>MAX_BYTES)return null;
  try{if(canonical(toPublicContent(content))!==fingerprint)return null;}catch{return null;}
  return {revision,publishedAt,content:JSON.parse(fingerprint),fingerprint};
}

async function readJson(response){
  const length=response.headers?.get('content-length');if(length&&Number(length)>MAX_BYTES)throw new Error('Public content too large');
  if(!response.body?.getReader){const text=await response.text();if(new TextEncoder().encode(text).length>MAX_BYTES)throw new Error('Public content too large');return JSON.parse(text);}
  const reader=response.body.getReader(),parts=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();throw new Error('Public content too large');}parts.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}

/** One bounded request at a time; lifecycle cancellation also protects ignored aborts. */
export function createPublicContentRefresh({url,eventId='ggj-cn-2026',fetchFn=globalThis.fetch,document:doc=globalThis.document,window:win=globalThis.window,
  onContent=()=>{},onState=()=>{},clock=Date.now,setTimer=globalThis.setTimeout,clearTimer=globalThis.clearTimeout,
  debounceMs=180,minIntervalMs=1000,timeoutMs=10000}={}){
  let current=null,inflight=null,timer=null,epoch=0,lastAttempt=null,closed=false,started=false;
  const visible=()=>doc?.visibilityState!=='hidden';
  const metadata=()=>current?{revision:current.revision,publishedAt:current.publishedAt}:null;
  const state=(status,reason)=>onState({status,current:metadata(),...(reason?{reason}:{})});
  function cancelTimer(){if(timer!==null){clearTimer(timer);timer=null;}}
  function suspend(){cancelTimer();epoch++;inflight?.controller.abort();inflight=null;}
  function refresh(){
    if(closed||!visible())return Promise.resolve(false);
    if(inflight)return inflight.promise;
    if(lastAttempt!==null&&clock()-lastAttempt<minIntervalMs){schedule();return Promise.resolve(false);}
    cancelTimer();lastAttempt=clock();const generation=++epoch,controller=new AbortController();
    const token={controller,promise:null};inflight=token;state('loading');
    token.promise=(async()=>{
      let deadline;
      try{
        const result=await Promise.race([
          (async()=>{const response=await fetchFn(url,{credentials:'omit',cache:'no-store',headers:{Accept:'application/json'},signal:controller.signal});
            if(response.status===404){const missing=await readJson(response);if(missing?.error?.code==='NOT_PUBLISHED')return null;throw new Error('Invalid publication status');}
            if(!response.ok)throw new Error('Public content unavailable');
            const value=publicContentEnvelope(await readJson(response),{eventId});if(!value)throw new Error('Invalid published content');return value;})(),
          new Promise((_,reject)=>{deadline=setTimer(()=>{controller.abort();reject(new Error('Public content timeout'));},timeoutMs);}),
        ]);
        if(closed||generation!==epoch||!visible())return false;
        if(!result){state(current?'unavailable':'missing','not-published');return false;}
        if(current&&(result.revision<current.revision||Date.parse(result.publishedAt)<Date.parse(current.publishedAt))){state('unavailable','older-publication');return false;}
        if(current&&result.revision===current.revision&&result.fingerprint!==current.fingerprint){state('unavailable','conflicting-publication');return false;}
        const changed=!current||current.revision!==result.revision;
        if(changed)await onContent({revision:result.revision,publishedAt:result.publishedAt,content:structuredClone(result.content)});
        if(closed||generation!==epoch||!visible())return false;
        current=result;state('published');return true;
      }catch{if(!closed&&generation===epoch&&visible())state('unavailable','read-failed');return false;}
      finally{clearTimer(deadline);if(inflight===token)inflight=null;}
    })();
    return token.promise;
  }
  function schedule(){
    if(closed||!visible()||inflight)return;
    cancelTimer();const remaining=lastAttempt===null?0:Math.max(0,minIntervalMs-(clock()-lastAttempt));
    timer=setTimer(()=>{timer=null;void refresh();},Math.max(debounceMs,remaining));
  }
  const visibility=()=>{if(visible())schedule();else suspend();};
  const pageshow=event=>{if(event.persisted!==false)schedule();};
  function start(){if(started||closed)return;started=true;doc?.addEventListener('visibilitychange',visibility);win?.addEventListener('focus',schedule);win?.addEventListener('pageshow',pageshow);win?.addEventListener('pagehide',suspend);void refresh();}
  function close(){closed=true;suspend();doc?.removeEventListener('visibilitychange',visibility);win?.removeEventListener('focus',schedule);win?.removeEventListener('pageshow',pageshow);win?.removeEventListener('pagehide',suspend);}
  return {start,refresh,schedule,suspend,close,get current(){return metadata();}};
}
