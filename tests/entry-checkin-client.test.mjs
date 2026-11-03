import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createEntryCheckin,readEntryTicket,validEntryView} from '../src/lib/checkin.mjs';
const code='a'.repeat(22),id='b'.repeat(43),session={user:{id:'checker',label:'合成工作人员',roles:['reviewer']},csrfToken:'c'.repeat(43)};
const view={ticketCode:code,revision:0,registrationId:id,name:'合成来宾',organization:'合成组织',admissionStatus:'confirmed',checkedInAt:null,eligible:true,canCheckIn:true};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const receipt=(operationId)=>({...view,revision:1,canCheckIn:false,checkedInAt:'2026-12-05T02:00:00.000Z',operationId,outcome:'checked_in'});
function fixture(handler){const calls=[];const client=createEntryCheckin({ticketCode:code,cryptoFn:webcrypto,fetchFn:async(path,options)=>{calls.push({path,...options});if(path==='/api/admin/session'||path==='/api/admin/login')return json(session);return handler(path,options,calls);}});return {client,calls};}
test('entry tokens accept only exact dedicated fragment and record contract',()=>{
  assert.equal(readEntryTicket('#ticket='+code),code);for(const invalid of ['', '#ticket='+code+'&other=x','#ticket=%61'.repeat(22),'#r='+code,'#ticket='+code+'a'])assert.equal(readEntryTicket(invalid),null);
  assert.equal(validEntryView(view,code),true);assert.equal(validEntryView({...view,canCheckIn:true,checkedInAt:'2026-12-05T02:00:00.000Z'},code),false);
  assert.equal(validEntryView({...view,eligible:false,canCheckIn:false},code),false);assert.equal(validEntryView({...view,eligible:false,canCheckIn:false,name:'',organization:''},code),true);
});
test('resuming a scanned ticket reads only; dedicated code never becomes confirmation link',async()=>{
  const f=fixture(()=>json(view));await f.client.resume();assert.equal(f.client.state.view.name,view.name);assert.equal(f.calls.length,2);assert.ok(f.calls.every(call=>call.method==='GET'));assert.ok(f.calls.every(call=>call.credentials==='same-origin'&&call.cache==='no-store'&&call.redirect==='error'&&call.referrerPolicy==='no-referrer'));assert.equal(f.client.state.unresolved,false);
});
test('explicit confirmation sends one operation and duplicate clicks send nothing',async()=>{
  const f=fixture((path,options)=>options.method==='POST'?json(receipt(JSON.parse(options.body).operationId)):json(view));await f.client.resume();await f.client.confirm();await f.client.confirm();assert.equal(f.client.state.message,'已入场');const sent=f.calls.filter(call=>call.method==='POST');assert.equal(sent.length,1);const body=JSON.parse(sent[0].body);assert.match(body.operationId,/^[A-Za-z0-9_-]{43}$/u);assert.equal(body.expectedRevision,0);assert.equal(sent[0].headers['X-CSRF-Token'],session.csrfToken);assert.ok(f.client.state.view.checkedInAt);
});
test('a lost acknowledgement retains exact operation and only GET queries recover it',async()=>{
  let attempted;const f=fixture((path,options)=>{if(options.method==='POST'){attempted=JSON.parse(options.body).operationId;throw new Error('合成丢失回执');}if(path.includes('/operation/'))return json({found:true,result:receipt(attempted)});return json(view);});
  await f.client.resume();await f.client.confirm();assert.equal(f.client.state.unresolved,true);await f.client.confirm();await f.client.check();assert.equal(f.client.state.unresolved,false);assert.equal(f.client.state.message,'已入场');assert.equal(f.calls.filter(call=>call.method==='POST').length,1);assert.equal(f.calls.at(-1).path,'/api/admin/checkin/'+code+'/operation/'+attempted);
});
test('missing or malformed original receipt never permits a new check-in operation',async()=>{
  let proof={found:false};const f=fixture((path,options)=>{if(options.method==='POST')throw new Error('合成丢失回执');if(path.includes('/operation/'))return json(proof);return json(view);});await f.client.resume();await f.client.confirm();await f.client.check();assert.equal(f.client.state.unresolved,true);assert.equal(f.client.state.view,null);proof={found:true,result:{...receipt('d'.repeat(43))}};await f.client.check();await f.client.confirm();assert.equal(f.client.state.unresolved,true);assert.equal(f.calls.filter(call=>call.method==='POST').length,1);
});
test('already checked-in and ineligible ticket inspections cannot POST',async()=>{
  for(const ticket of [{...view,checkedInAt:'2026-12-05T02:00:00.000Z',canCheckIn:false},{...view,eligible:false,canCheckIn:false,admissionStatus:'waitlisted',name:'',organization:''}]){const f=fixture(()=>json(ticket));await f.client.resume();await f.client.confirm();assert.equal(f.calls.filter(call=>call.method==='POST').length,0);}
});
test('unauthorized refresh clears all private record and account fields',async()=>{
  let status=200;const f=fixture(()=>json(status===200?view:{error:{code:'FORBIDDEN'}},status));await f.client.resume();status=403;await f.client.refresh();assert.equal(f.client.state.user,null);assert.equal(f.client.state.view,null);assert.equal(f.client.state.hasTicket,true);
});
test('late read after explicit clearing cannot repaint a private record',async()=>{
  let release;const f=fixture(()=>new Promise(resolve=>{release=()=>resolve(json(view));}));const running=f.client.resume();for(let n=0;!release&&n<20;n++)await new Promise(resolve=>setImmediate(resolve));assert.equal(typeof release,'function');f.client.clear();release();await running;assert.equal(f.client.state.user,null);assert.equal(f.client.state.view,null);assert.equal(f.client.state.hasTicket,false);
});
test('logout clears scanned token and pending receipt even if logout network fails',async()=>{
  const f=fixture((path,options)=>{if(options.method==='POST')throw new Error('合成网络中断');return json(view);});await f.client.resume();await f.client.confirm();assert.equal(f.client.state.unresolved,true);await f.client.logout();assert.equal(f.client.state.hasTicket,false);assert.equal(f.client.state.view,null);assert.equal(f.client.state.user,null);assert.equal(f.client.state.unresolved,false);
});
test('another actor cannot recover or replace an unresolved original operation',async()=>{
  let newActor=false,seen=0;const calls=[];const client=createEntryCheckin({ticketCode:code,cryptoFn:webcrypto,fetchFn:async(path,options)=>{calls.push({path,...options});if(path==='/api/admin/session'||path==='/api/admin/login')return json(newActor?{...session,user:{...session.user,id:'other'}}:session);if(options.method==='POST'){seen++;return json({},401);}return json(view);}});await client.resume();await client.confirm();assert.equal(client.state.user,null);newActor=true;await client.login({username:'synthetic',password:'synthetic'});assert.equal(client.state.unresolved,true);assert.equal(client.state.view,null);await client.confirm();assert.equal(seen,1);assert.match(client.state.error,/原操作账号/u);
});
test('a concurrent staff check-in can resolve uncertainty without claiming original operation succeeded',async()=>{
  let submitted=false;const f=fixture((path,options)=>{if(options.method==='POST'){submitted=true;throw new Error('合成丢失回执');}if(path.includes('/operation/'))return json({found:false});return json(submitted?{...view,revision:1,checkedInAt:'2026-12-05T02:00:00.000Z',canCheckIn:false}:view);});await f.client.resume();await f.client.confirm();await f.client.check();assert.equal(f.client.state.unresolved,false);assert.equal(f.client.state.message,'已入场');assert.equal(f.calls.filter(call=>call.method==='POST').length,1);
});
