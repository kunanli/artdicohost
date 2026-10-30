import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {createCloudContentServer} from '../functions/cloud-content/http-server.mjs';
import {createRegistrationClient} from '../src/lib/registration-client.mjs';
import {peopleRuntimeFixture} from './helpers/people-runtime-fixture.mjs';

const API='https://api.artdico.host',SITE='https://artdico.host',NOW=Date.parse('2026-10-21T09:00:00Z');
const gatewayHeaders=Object.fromEntries(Array.from({length:34},(_,i)=>['x-synthetic-gateway-'+i,'synthetic']));
async function serve(t,app){
  const errors=[],server=createCloudContentServer({runtime:{configured:true,handle:app.handle}});
  server.on('clientError',error=>errors.push(error.code));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  let loseNextCommit=false;const calls=[];
  const fetchFn=(url,options)=>new Promise((resolve,reject)=>{
    const path=new URL(url).pathname;assert.equal(new URL(url).origin,API);
    const headers={Host:'api.artdico.host',Connection:'close',...gatewayHeaders,Origin:SITE,...options.headers};
    const req=httpRequest({hostname:'127.0.0.1',port:server.address().port,path,method:options.method,headers,agent:false},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);res.on('end',()=>{
        calls.push({path,method:options.method,status:res.statusCode,body:options.body,key:new Headers(options.headers).get('idempotency-key')});
        if(loseNextCommit&&path.endsWith('/submit')&&res.statusCode===201){loseNextCommit=false;reject(new Error('SYNTHETIC_LOST_ACK'));return;}
        resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers}));
      });
    });req.on('error',reject);req.end(options.body);
  });
  return{server,errors,calls,fetchFn,loseAck:()=>{loseNextCommit=true;}};
}
const client=fetchFn=>createRegistrationClient({apiOrigin:API,pageOrigin:SITE,fetchFn,clock:()=>NOW,randomBytes:()=>new Uint8Array(32).fill(11)});

test('gateway header count reproduces empty submit 400; the original request survives the fixed HTTP boundary and a lost commit ACK',async t=>{
  const f=await peopleRuntimeFixture({mail:false}),old=await serve(t,f.app);old.server.maxHeadersCount=40;
  const first=client(old.fetchFn);await first.configure();
  const fields={intake:'general-v2',name:'合成边界申请人',email:'synthetic.http@example.invalid',categories:['student'],participationInterests:['attend']};
  await assert.rejects(first.submit(fields),error=>error.stage==='submit'&&error.reason==='RESPONSE_FORMAT');
  assert.equal(old.calls.find(call=>call.path.endsWith('/token')).status,200);
  assert.equal(old.calls.find(call=>call.path.endsWith('/submit')).status,400);
  assert.ok(old.errors.includes('HPE_HEADER_OVERFLOW'));
  assert.equal((await f.app.registrationService.repository.readIndex()).value.entries.length,0);
  const original=first.pendingSnapshot;
  const fixed=await serve(t,f.app),second=client(fixed.fetchFn);fixed.loseAck();second.restorePending(original);
  await assert.rejects(second.resume(),error=>error.stage==='submit'&&error.reason==='NETWORK');
  assert.equal((await f.app.registrationService.repository.readIndex()).value.entries.length,1);
  const restored=client(fixed.fetchFn);restored.restorePending(second.pendingSnapshot);const result=await restored.resume();
  assert.equal(result.httpStatus,200);assert.equal(result.body.admissionStatus,'pending_review');assert.equal(restored.pending,false);
  const submissions=[...old.calls,...fixed.calls].filter(call=>call.path.endsWith('/submit'));
  assert.deepEqual(submissions.map(call=>call.status),[400,201,200]);
  for(const call of submissions){assert.equal(call.key,original.idempotencyKey);assert.equal(call.body,original.payloadJson);}
  assert.equal((await f.app.registrationService.repository.readIndex()).value.entries.length,1);
  assert.equal(f.messages.length,0);assert.deepEqual(fixed.errors,[]);
});
