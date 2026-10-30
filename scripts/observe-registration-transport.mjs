import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL='https://api.artdico.host/api/admin/registration/submit',ORIGIN='https://artdico.host';
const fakeToken=length=>'a.'+'b'.repeat(length-46)+'.'+'c'.repeat(43);
const browserHeaders={Accept:'application/json',Origin:ORIGIN,'Content-Type':'application/json',
  'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  Referer:ORIGIN+'/','Accept-Language':'zh-TW,zh;q=0.9,en;q=0.8','Sec-Fetch-Site':'same-site','Sec-Fetch-Mode':'cors',
  'Sec-Fetch-Dest':'empty','Sec-CH-UA':'"Chromium";v="142", "Not_A Brand";v="99"','Sec-CH-UA-Mobile':'?0','Sec-CH-UA-Platform':'"Windows"'};

/** GET only: application rejects the method before token verification or registration IO.
 * Dummy headers measure HTTP transport, never prove that a POST can be committed.
 */
export async function observeRegistrationTransport({fetchFn=fetch,timeoutMs=10000}={}){
  if(typeof fetchFn!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw new TypeError('Invalid observation arguments.');
  const observations=[];
  for(const [probe,tokenBytes]of [['baseline',0],['submission_headers',512],['maximum_token_headers',4096]]){
    let response;
    try{
      response=await fetchFn(URL,{method:'GET',credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(timeoutMs),
        headers:{...browserHeaders,...(tokenBytes?{'Idempotency-Key':'0'.repeat(64),'X-Registration-Token':fakeToken(tokenBytes)}:{})}});
      if(response.redirected||response.url&&response.url!==URL)throw new Error();
      const type=(response.headers.get('content-type')??'').toLowerCase();
      const contentType=type.startsWith('application/json')?'json':type.startsWith('text/html')?'html':type.startsWith('text/plain')?'text':type?'other':'absent';
      const reader=response.body?.getReader();let bytes=0,text='',truncated=false;
      if(reader)try{for(;;){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>2048){truncated=true;break;}text+=new TextDecoder().decode(next.value);}}
      finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
      let code;try{const candidate=JSON.parse(text)?.error?.code;if(['METHOD_NOT_ALLOWED','NOT_FOUND','UNAVAILABLE','CONTENT_NOT_READY','BODY_TOO_LARGE'].includes(candidate))code=candidate;}catch{}
      const cors=response.headers.get('access-control-allow-origin')===ORIGIN;
      observations.push({probe,tokenBytes,status:response.status,contentType,empty:bytes===0,truncated,cors,...(code?{code}:{})});
    }catch{await response?.body?.cancel().catch(()=>{});observations.push({probe,tokenBytes,failure:'TRANSPORT_UNAVAILABLE'});}
  }
  return{verified:observations.every(item=>item.status===405&&item.contentType==='json'&&item.code==='METHOD_NOT_ALLOWED'&&item.cors),observations};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await observeRegistrationTransport();
  console.log('Read-only registration HTTP transport: '+JSON.stringify(result));
  if(!result.verified)process.exitCode=1;
}
