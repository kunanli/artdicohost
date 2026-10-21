import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmationLink, confirmationToken, savedConfirmation, confirmationView, createConfirmationClient, confirmationEmailMessage, confirmationStatusLabels } from '../src/lib/confirmation-client.mjs';

const token='v1.'+'x'.repeat(100)+'.'+'y'.repeat(43),api='https://api.artdico.host',site='https://artdico.host',now=Date.parse('2026-10-21T00:00:00Z');
const value=()=>({referenceCode:'r'.repeat(43),submittedAt:'2026-10-21T00:00:00Z',event:{id:'synthetic-event',title:'合成活动',date:'2026-12-05',time:'10:00–18:00',venue:'合成场地',timezone:'Asia/Shanghai',checkIn:'09:30'},admission:{status:'confirmed',kind:'attendee',revision:1},attendee:{name:'合成报名人',organization:'合成机构',email:'PRIVATE-SHOULD-NOT-RENDER'},email:{status:'not_configured',recipient:'PRIVATE-SHOULD-NOT-RENDER'},wallet:{ready:false},provenance:{permissionReference:'PRIVATE-SHOULD-NOT-RENDER'}});
const json=(body,headers={})=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json; charset=utf-8',...headers}});

test('a saved receipt redirects only to its matching fixed-origin capability, without query PII or expired access',()=>{
  const receipt={receiptToken:token,confirmationUrl:confirmationLink(token),expiresAt:'2027-03-05T00:00:00Z',email:{status:'not_configured'}};
  assert.equal(savedConfirmation(receipt,now).confirmationUrl,site+'/registration/confirmation/#r='+token);
  assert.equal(confirmationToken('#r='+token),token);
  for(const url of ['https://evil.invalid/#r='+token,site+'/registration/confirmation/?email=private#r='+token,site+'/registration/confirmation/#r=other',site+'/registration/confirmation/#r='+token+'&extra=1']){
    assert.equal(savedConfirmation({...receipt,confirmationUrl:url},now),null);
  }
  assert.equal(savedConfirmation({...receipt,expiresAt:'2026-10-20T00:00:00Z'},now),null);
  for(const input of ['#r=short','#r='+token+'%0a','#token='+token,'#r='+token+'&email=private'])assert.equal(confirmationToken(input),null);
});

test('confirmation projection suppresses personal extras and all waitlist/withdrawn Wallet or group access',()=>{
  const confirmed=value();confirmed.groupInvite={platform:'wechat',qrImageUrl:api+'/api/admin/registration/group-invite/v1.a.b',expiresAt:'2026-12-05T00:00:00Z'};
  const safe=confirmationView(confirmed,now);assert.ok(safe.groupInvite);assert.doesNotMatch(JSON.stringify(safe),/PRIVATE-SHOULD-NOT-RENDER/u);
  for(const status of ['pending_review','waitlisted','rejected','withdrawn']){
    const candidate={...confirmed,admission:{...confirmed.admission,status},wallet:{ready:true}};
    const output=confirmationView(candidate,now);assert.equal(output.groupInvite,null);assert.equal(output.wallet.ready,false);
    if(status==='withdrawn')assert.deepEqual(output.attendee,{name:'',organization:''});
    if(['pending_review','rejected'].includes(status))assert.equal(output.email.status,'not_applicable');
  }
  assert.equal(confirmationView({...confirmed,groupInvite:{...confirmed.groupInvite,qrImageUrl:'https://evil.invalid/qr'}},now).groupInvite,null);
  for(const patch of [{admission:{status:'registered',kind:'attendee',revision:1}},{admission:{status:'confirmed',kind:'attendee',revision:-1}},{email:{status:'delivered'}},{referenceCode:'unknown'}])assert.equal(confirmationView({...confirmed,...patch},now),null);
});

test('pending/rejected application receipt has no invitation or email-pending promise and prints its actual state',()=>{
  for(const status of ['pending_review','rejected']){
    const input={...value(),admission:{status,kind:'attendee',revision:4},wallet:{ready:true},email:{status:'pending'},groupInvite:{platform:'wechat',qrImageUrl:api+'/api/admin/registration/group-invite/v1.a.b',expiresAt:'2026-12-05T00:00:00Z'}};
    const view=confirmationView(input,now);assert.equal(view.admission.status,status);assert.equal(view.wallet.ready,false);assert.equal(view.groupInvite,null);assert.equal(view.email.status,'not_applicable');
    const message=confirmationEmailMessage(status,'pending');assert.doesNotMatch(message,/邮件待处理|准备.*邀请|名额已确认/u);assert.match(confirmationStatusLabels[status][3],status==='pending_review'?/申请收据/u:/审核结果/u);
  }
  assert.match(confirmationEmailMessage('waitlisted','provider_accepted'),/不提供正式邀请/u);
  assert.equal(confirmationStatusLabels.pending_review[1],'申请已收到，待审核');
  assert.equal(confirmationEmailMessage('unknown','pending'),'');
});

test('confirmation reads are bounded public POSTs with no staff credentials and never request a send endpoint',async()=>{
  const calls=[];
  const client=createConfirmationClient({apiOrigin:api,pageOrigin:site,fetchFn:async(url,options)=>{calls.push({url,options});return json(value());}});
  assert.equal((await client.read(token)).attendee.name,'合成报名人');
  assert.equal((await client.read(token)).admission.status,'confirmed');assert.equal(calls.length,2);
  for(const call of calls){assert.equal(call.url,api+'/api/admin/registration/confirmation');assert.equal(call.options.credentials,'omit');assert.equal(call.options.referrerPolicy,'no-referrer');assert.equal(call.options.redirect,'error');assert.equal(call.options.method,'POST');assert.deepEqual(JSON.parse(call.options.body),{receiptToken:token});assert.equal(Object.hasOwn(call.options.headers,'Cookie'),false);}
});

test('decoded JSON bounds protect receipt reads without rejecting HTTP decompression length differences',async()=>{
  const create=fetchFn=>createConfirmationClient({apiOrigin:api,pageOrigin:site,fetchFn});
  assert.ok(await create(async()=>json(value(),{'content-length':'12'})).read(token));
  await assert.rejects(create(async()=>json({...value(),extra:'x'.repeat(70*1024)})).read(token),/暂时无法核对/u);
  await assert.rejects(create(async()=>json(value(),{'content-type':'application/jsonx'})).read(token),/暂时无法核对/u);
  await assert.rejects(create(async()=>new Response('PRIVATE-PROVIDER-ERROR',{status:403})).read(token),error=>!error.message.includes('PRIVATE')&&error.message.includes('失效'));
});

test('missing/foreign configuration or malformed capability performs no request; Wallet uses its scoped endpoint and MIME',async()=>{
  let calls=0;
  const disabled=createConfirmationClient({apiOrigin:api,pageOrigin:'https://other.invalid',fetchFn:()=>{calls++;throw new Error();}});
  await assert.rejects(disabled.read(token));assert.equal(calls,0);
  const valid=createConfirmationClient({apiOrigin:api,pageOrigin:site,fetchFn:async(url,options)=>{calls++;assert.equal(url,api+'/api/admin/registration/wallet');assert.equal(options.credentials,'omit');return new Response(new Uint8Array([80,75,3,4,1]),{headers:{'content-type':'application/vnd.apple.pkpass'}});}});
  await assert.rejects(valid.read('bad'));assert.equal(calls,0);
  const pass=await valid.wallet(token);assert.equal(pass.type,'application/vnd.apple.pkpass');assert.equal(calls,1);
});
