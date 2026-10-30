import test from 'node:test';
import assert from 'node:assert/strict';
import { observePublicRegistration } from '../scripts/verify-public-registration.mjs';

const SITE='https://artdico.host';
const config={enabled:true,eventId:'ggj-cn-2026',opensAt:'2026-10-01T00:00:00Z',closesAt:'2026-12-05T04:00:00Z',capacity:300,
  privacy:Object.fromEntries(['version','processor','contactEmail','purpose','storageRegion','retention','rightsRequest','sharing'].map(key=>[key,'synthetic-'+key]))};
const response=(body,status=200,headers={})=>new Response(body===null?null:JSON.stringify(body),{status,headers:{'content-type':'application/json','access-control-allow-origin':SITE,...headers}});
test('live observation makes exactly one anonymous GET and two OPTIONS, never issuing a token or submitting',async()=>{
  const calls=[];
  const result=await observePublicRegistration({fetchFn:async(url,options)=>{
    calls.push({url,options});
    if(options.method==='GET')return response(config);
    return response(null,204,{'access-control-allow-methods':'POST','access-control-allow-headers':options.headers['Access-Control-Request-Headers']});
  }});
  assert.deepEqual(result,{verified:true,eventId:'ggj-cn-2026',enabled:true,preflights:{token:true,submit:true}});
  assert.deepEqual(calls.map(call=>call.options.method),['GET','OPTIONS','OPTIONS']);
  for(const call of calls){assert.equal(call.options.credentials,'omit');assert.equal(call.options.body,undefined);assert.equal(call.options.headers.Origin,SITE);}
});
test('observation suppresses provider text and reports a rejected browser preflight',async()=>{
  const result=await observePublicRegistration({fetchFn:async(url,options)=>options.method==='GET'?response(config):response({private:'PRIVATE_PROVIDER_DETAIL'},403)});
  assert.equal(result.verified,false);assert.equal(result.stage,'token_preflight');assert.equal(result.status,403);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_PROVIDER/u);
  const broken=await observePublicRegistration({fetchFn:async()=>{throw new Error('PRIVATE_TRANSPORT_DETAIL');}});
  assert.equal(broken.verified,false);assert.doesNotMatch(JSON.stringify(broken),/PRIVATE_TRANSPORT/u);
});
