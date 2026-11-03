import test from 'node:test';
import assert from 'node:assert/strict';
import { observePublicRegistration } from '../scripts/verify-public-registration.mjs';

const SITE='https://artdico.host';
const config={enabled:true,eventId:'ggj-cn-2026',publicRegistrationMode:'speaker_only',speakerApplicationsEnabled:true,opensAt:'2026-10-01T00:00:00Z',closesAt:'2026-12-05T04:00:00Z',capacity:300,
  privacy:Object.fromEntries(['version','processor','contactEmail','purpose','storageRegion','retention','rightsRequest','sharing'].map(key=>[key,'synthetic-'+key]))};
const response=(body,status=200,headers={})=>new Response(body===null?null:JSON.stringify(body),{status,headers:{'content-type':'application/json','access-control-allow-origin':SITE,...headers}});
test('live observation makes exactly one anonymous GET and two OPTIONS, never issuing a token or submitting',async()=>{
  for(const attendeeReviewRequired of [false,true,undefined]){
  const calls=[];
  const result=await observePublicRegistration({fetchFn:async(url,options)=>{
    calls.push({url,options});
    if(options.method==='GET')return response({...config,...(attendeeReviewRequired===undefined?{}:{attendeeReviewRequired})});
    return response(null,204,{'access-control-allow-methods':'POST','access-control-allow-headers':options.headers['Access-Control-Request-Headers']});
  }});
  assert.deepEqual(result,{verified:true,eventId:'ggj-cn-2026',enabled:true,attendeeReviewRequired:attendeeReviewRequired??null,publicRegistrationMode:'speaker_only',speakerApplicationsEnabled:true,preflights:{token:true,submit:true}});
  assert.deepEqual(calls.map(call=>call.options.method),['GET','OPTIONS','OPTIONS']);
  for(const call of calls){assert.equal(call.options.credentials,'omit');assert.equal(call.options.body,undefined);assert.equal(call.options.headers.Origin,SITE);}
  }
});
test('read-only release observation rejects a legacy endpoint or disabled speaker intake before any preflight',async()=>{
  for(const change of [{publicRegistrationMode:'legacy'},{publicRegistrationMode:undefined},{publicRegistrationMode:'foreign'},{speakerApplicationsEnabled:false}]){
    let calls=0;const result=await observePublicRegistration({fetchFn:async(_url,options)=>{calls++;assert.equal(options.method,'GET');return response({...config,...change});}});
    // An invalid enum is rejected by the client before the observer can compare
    // it. Both paths fail closed without a token or business request.
    assert.deepEqual(result,{verified:false,stage:'config',status:200,failure:change.publicRegistrationMode==='foreign'?'READ_UNAVAILABLE':'REGISTRATION_MODE'});assert.equal(calls,1);
  }
});
test('observation suppresses provider text and reports a rejected browser preflight',async()=>{
  const result=await observePublicRegistration({fetchFn:async(url,options)=>options.method==='GET'?response(config):response({private:'PRIVATE_PROVIDER_DETAIL'},403)});
  assert.equal(result.verified,false);assert.equal(result.stage,'token_preflight');assert.equal(result.status,403);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_PROVIDER/u);
  const broken=await observePublicRegistration({fetchFn:async()=>{throw new Error('PRIVATE_TRANSPORT_DETAIL');}});
  assert.equal(broken.verified,false);assert.doesNotMatch(JSON.stringify(broken),/PRIVATE_TRANSPORT/u);
});
