import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {observeRegistrationTransport} from '../scripts/observe-registration-transport.mjs';
import {createRegistrationApi} from '../functions/registration-api/handler.mjs';
import {createCloudContentServer} from '../functions/cloud-content/http-server.mjs';
const origin='https://artdico.host';
test('transport observation uses fixed anonymous requests that cannot carry an accepted registration',async()=>{
  const calls=[];
  const result=await observeRegistrationTransport({fetchFn:async(url,options)=>{
    calls.push({url,options});const get=options.method==='GET',json=!get&&options.headers['Content-Type']==='application/json';return new Response(JSON.stringify({error:{code:get?'METHOD_NOT_ALLOWED':json?'INVALID_HEADERS':'UNSUPPORTED_MEDIA_TYPE'}}),{status:get?405:json?400:415,headers:{'content-type':'application/json','access-control-allow-origin':origin}});
  }});
  assert.equal(result.verified,true);assert.equal(calls.length,10);
  assert.deepEqual(calls.map(x=>x.options.headers['X-Registration-Token']?.length??0),[0,512,4096,512,512,512,0,0,512,512]);
  for(const {url,options}of calls){assert.equal(url,'https://api.artdico.host/api/admin/registration/submit');assert.ok(['GET','POST'].includes(options.method));assert.equal(options.credentials,'omit');assert.equal(options.headers.Origin,origin);assert.equal(options.headers.Cookie,undefined);
    if(options.method==='GET')assert.equal(options.body,undefined);else{assert.ok(options.headers['Content-Type']==='text/plain'||options.headers['Content-Type']==='application/json'&&!options.headers['X-Registration-Token'].includes('.'));assert.doesNotMatch(options.body,/eventId|fields|consent/u);assert.ok(Buffer.byteLength(options.body)<8192);}}
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
test('all live diagnostic shapes are rejected over actual HTTP before token issuance or registration IO',async t=>{
  let calls=0;
  const forbidden=()=>{calls++;throw new Error('diagnostics must not enter the service');};
  const api=createRegistrationApi({allowedOrigins:[origin],submissionService:{submit:forbidden,issueToken:forbidden,metadata:forbidden}});
  const server=createCloudContentServer({runtime:{configured:true,handle:request=>api(new Request('https://api.artdico.host/api/registrations',request))}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const result=await observeRegistrationTransport({fetchFn:async(_url,options)=>new Promise((resolve,reject)=>{
    const req=httpRequest({hostname:'127.0.0.1',port:server.address().port,path:'/api/admin/registration/submit',method:options.method,
      headers:{...options.headers,Host:'api.artdico.host',Connection:'close'},agent:false},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));
    });req.on('error',reject);req.end(options.body);
  })});
  assert.equal(result.verified,true);assert.deepEqual(result.observations.map(item=>item.status),[405,405,405,415,415,415,415,415,415,400]);assert.equal(calls,0);
});
