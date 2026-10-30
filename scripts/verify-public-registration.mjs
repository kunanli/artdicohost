import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRegistrationClient } from '../src/lib/registration-client.mjs';
import { eventConfig } from '../src/config/event.mjs';

const API='https://api.artdico.host',SITE='https://artdico.host';
const ROUTES=['/api/admin/registration/config','/api/admin/registration/token','/api/admin/registration/submit'];

/** Anonymous GET + OPTIONS only. No token issuance, application, or staff cookie. */
export async function observePublicRegistration({fetchFn=fetch,timeoutMs=15000}={}) {
  let stage='config',status,verificationFailure;
  const fail=code=>{verificationFailure=code;throw new Error('Public registration read verification failed.');};
  try {
    if(typeof fetchFn!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>15000)fail('INVALID_ARGUMENTS');
    async function read(url,options={}) {
      status=undefined;
      if(!ROUTES.some(path=>url===API+path)||!['GET','OPTIONS'].includes(options.method))fail('READ_ONLY_BOUNDARY');
      const signal=AbortSignal.timeout(timeoutMs);
      const response=await fetchFn(url,{...options,signal:options.signal?AbortSignal.any([signal,options.signal]):signal,
        credentials:'omit',redirect:'error',cache:'no-store',headers:{...options.headers,Origin:SITE,'accept-encoding':'identity'}});
      status=response?.status;
      if(!response||response.redirected||response.url&&response.url!==url)fail('RESPONSE_URL');
      if(response.headers.get('access-control-allow-origin')!==SITE||response.headers.has('set-cookie'))fail('CORS_ORIGIN');
      return response;
    }
    const client=createRegistrationClient({apiOrigin:API,pageOrigin:SITE,fetchFn:read});
    const config=await client.configure();
    if(config?.eventId!==eventConfig.id||typeof config.enabled!=='boolean')fail('EVENT_CONFIGURATION');
    const preflights={};
    for(const [name,path,headers] of [['token',ROUTES[1],['content-type']],['submit',ROUTES[2],['content-type','idempotency-key','x-registration-token']]]) {
      stage=name+'_preflight';
      const response=await read(API+path,{method:'OPTIONS',headers:{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':headers.join(',')}});
      const methods=(response.headers.get('access-control-allow-methods')??'').toUpperCase().split(',').map(s=>s.trim());
      const allowed=(response.headers.get('access-control-allow-headers')??'').toLowerCase().split(',').map(s=>s.trim());
      await response.body?.cancel();
      if(response.status!==204||!methods.includes('POST')||headers.some(name=>!allowed.includes(name)))fail('CORS_PREFLIGHT');
      preflights[name]=true;
    }
    return {verified:true,eventId:config.eventId,enabled:config.enabled,preflights};
  } catch(error) {
    const allowed=new Set(['INVALID_ARGUMENTS','READ_ONLY_BOUNDARY','RESPONSE_URL','CORS_ORIGIN','EVENT_CONFIGURATION','CORS_PREFLIGHT']);
    return {verified:false,stage,...(Number.isInteger(status)&&status>=100&&status<=599?{status}:{}),
      failure:allowed.has(verificationFailure)?verificationFailure:'READ_UNAVAILABLE'};
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const result=await observePublicRegistration();
  console.log('Anonymous registration GET/OPTIONS verification: '+JSON.stringify(result));
  if(!result.verified)process.exitCode=1;
}
