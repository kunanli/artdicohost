import test from 'node:test';
import assert from 'node:assert/strict';
import {observeRegistrationTransport} from '../scripts/observe-registration-transport.mjs';
const origin='https://artdico.host';
test('transport observation uses fixed anonymous rejections; every POST is unsupported text with no registration payload',async()=>{
  const calls=[];
  const result=await observeRegistrationTransport({fetchFn:async(url,options)=>{
    calls.push({url,options});return new Response(JSON.stringify({error:{code:options.method==='GET'?'METHOD_NOT_ALLOWED':'UNSUPPORTED_MEDIA_TYPE'}}),{status:options.method==='GET'?405:415,headers:{'content-type':'application/json','access-control-allow-origin':origin}});
  }});
  assert.equal(result.verified,true);assert.equal(calls.length,6);
  assert.deepEqual(calls.map(x=>x.options.headers['X-Registration-Token']?.length??0),[0,512,4096,512,512,512]);
  for(const {url,options}of calls){assert.equal(url,'https://api.artdico.host/api/admin/registration/submit');assert.ok(['GET','POST'].includes(options.method));assert.equal(options.credentials,'omit');assert.equal(options.headers.Origin,origin);assert.equal(options.headers.Cookie,undefined);
    if(options.method==='GET')assert.equal(options.body,undefined);else{assert.equal(options.headers['Content-Type'],'text/plain');assert.doesNotMatch(options.body,/eventId|fields|consent/u);assert.ok(Buffer.byteLength(options.body)<8192);}}
});
test('transport observation distinguishes an opaque 400 and suppresses provider bodies and exceptions',async()=>{
  let n=0;
  const result=await observeRegistrationTransport({fetchFn:async()=>{
    n++;if(n===1)return new Response(null,{status:400});
    if(n===2)return new Response('PRIVATE_SYNTHETIC_PROVIDER_DETAIL',{status:400,headers:{'content-type':'text/html'}});
    throw new Error('PRIVATE_SYNTHETIC_TRANSPORT_DETAIL');
  }});
  assert.equal(result.verified,false);assert.equal(result.observations[0].empty,true);assert.equal(result.observations[0].status,400);
  assert.equal(result.observations[1].contentType,'html');assert.equal(result.observations[2].failure,'TRANSPORT_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_SYNTHETIC/u);
});
