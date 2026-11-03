import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createHuodongxingMutations,huodongxingPreviewView,huodongxingReasonLabel} from '../src/lib/delivery-settings.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex'),op='1'.repeat(64),id='a'.repeat(43),other='b'.repeat(43),eventId='ggj-cn-2026';
const user={id:'synthetic-staff',roles:['superadmin']},clone=structuredClone;
const row={sourceRow:2,tid:'00123',registrationNumber:'000456',orderNumber:'000789',name:'Synthetic person',email:'synthetic@example.invalid',phone:'00123456',wechat:'synthetic-chat',registeredAt:'2026-11-03 12:00:00',lastVerifiedAt:'',status:'报名成功'};
const raw='synthetic original file bytes',source={kind:'huodongxing',sourceEventId:'8884819113200',rows:[row],sourceFileBase64:Buffer.from(raw).toString('base64'),originalSha256:digest(raw)};
const preview=(overrides={})=>({kind:'huodongxing',sourceEventId:source.sourceEventId,previewToken:'f'.repeat(64),expectedRevision:2,expectedTicketRevision:3,expectedAdmissionRevision:4,summary:{total:1,new:1,existing:0,needsReview:0,eligible:1},rows:[{tid:row.tid,sourceRow:2,name:row.name,email:row.email,status:'new',reason:null,contactId:null,registrationId:null,candidates:[],canSelect:true}],canCommit:true,...overrides});
const completed=()=>({kind:'huodongxing',operationId:op,status:'completed',results:[{tid:row.tid,status:'imported',contactId:'synthetic-contact',registrationId:id}],registrationIds:[id]});
const selection={selectedTids:[row.tid],links:[],separateTids:[],confirmSource:true,confirmPermission:true};
const mailPreview=()=>({kind:'registration',revision:1,sourceRevision:'c'.repeat(64),total:1,nextCursor:null,message:{subject:'Synthetic confirmation',text:'Open [私人参会页链接]',privateUrlPlaceholder:'[私人参会页链接]'},rows:[{registrationId:id,name:row.name,organization:'',status:'not_sent',eligible:true,reason:'ELIGIBLE',retryRejected:false,accessRevision:0}]});
function memory(){const values=new Map();return{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key),values};}
function setup(handler){const storage=memory(),calls=[],state={user};const request=async(path,options={})=>{calls.push({path,...options});return handler(path,options);};const make=()=>createHuodongxingMutations({request,getUser:()=>state.user,eventId,storage,operationId:()=>op,hashText:async value=>digest(value),clock:()=>1230000});return{storage,calls,state,make};}

test('preview is read-only and import needs explicit selection and two separate attestations',async()=>{
  const f=setup(path=>path.endsWith('/preview')?preview():completed()),client=f.make();assert.ok(huodongxingPreviewView(preview()));await client.preview(clone(source));
  for(const change of [{selectedTids:[]},{confirmSource:false},{confirmPermission:false}])await assert.rejects(client.commit({...selection,...change}));
  assert.equal(f.calls.length,1);assert.equal(client.pending,false);const result=await client.commit(selection);assert.equal(result.status,'completed');
  const body=JSON.parse(f.calls.at(-1).body);assert.deepEqual(body.selectedTids,[row.tid]);assert.match(body.permissionReference,/8884819113200.*SHA-256/u);assert.equal(body.confirmSource,true);assert.equal(body.confirmPermission,true);assert.equal(f.calls.filter(call=>call.path.includes('confirmation')).length,0);assert.equal(client.pending,false);
});

test('same email never auto-links; a canonical link or an explicit separate-person choice is mandatory',async()=>{
  const duplicate=preview({summary:{total:1,new:0,existing:0,needsReview:1,eligible:1},rows:[{...preview().rows[0],status:'needs_review',reason:'POSSIBLE_DUPLICATE',candidates:[{registrationId:id,name:'Existing synthetic',organization:'',status:'confirmed'}]}]});
  const f=setup(path=>path.endsWith('/preview')?duplicate:completed()),client=f.make();await client.preview(clone(source));await assert.rejects(client.commit(selection));assert.equal(f.calls.length,1);
  await assert.rejects(client.commit({...selection,links:[{tid:row.tid,registrationId:other}]}));assert.equal(f.calls.length,1);
  await client.commit({...selection,separateTids:[row.tid]});assert.deepEqual(JSON.parse(f.calls.at(-1).body).separateTids,[row.tid]);assert.deepEqual(JSON.parse(f.calls.at(-1).body).links,[]);
});

test('lost import ACK preserves a scoped non-PII command; refresh GET cannot create writes and explicit same-file resume sends identical bytes',async()=>{
  let imports=0;const f=setup((path,options)=>{if(path.endsWith('/preview'))return preview();if(path.includes('/operations/'))return{kind:'huodongxing',operationId:op,status:'pending',results:[],registrationIds:[]};if(options.method==='POST'){if(++imports===1)throw Error('Synthetic lost ACK');return completed();}throw Error('Unexpected request');});
  let client=f.make();await client.preview(clone(source));await assert.rejects(client.commit(selection));const firstBody=f.calls.at(-1).body,saved=[...f.storage.values.values()].join();assert.equal(client.pending,true);assert.doesNotMatch(saved,/Synthetic person|example\.invalid|synthetic-chat|synthetic original file bytes|sourceFileBase64/u);assert.ok(saved.includes(op));
  client=f.make();assert.equal(client.restore(),true);assert.equal(client.canResume,false);await client.lookup();assert.equal(imports,1);await assert.rejects(client.preview(clone(source)));await assert.rejects(client.attachSource({...clone(source),originalSha256:'d'.repeat(64)}));
  await client.attachSource(clone(source));assert.equal(client.canResume,true);assert.equal(imports,1);await client.resume();assert.equal(imports,2);assert.equal(f.calls.at(-1).body,firstBody);assert.equal(client.pending,false);
});

test('mail is separately previewed and explicitly sent; unknown mail only GETs the original operation across refresh',async()=>{
  let sends=0;const f=setup((path,options)=>{if(path==='/api/admin/contacts/import/preview')return preview();if(path==='/api/admin/contacts/import')return completed();if(path.endsWith('/confirmation/preview'))throw Error('wrong path');if(path==='/api/admin/registration-confirmation/preview')return mailPreview();if(path.endsWith('/dispatch')){sends++;throw Error('Synthetic unknown mail ACK');}if(path.includes('/operation/'))return{kind:'registration',checkedAt:'2026-11-03T00:00:00.000Z',outcome:'replayed',revision:2,operationId:op.slice(0,32),status:'completed',results:[{registrationId:id,status:'provider_accepted'}]};throw Error('Unexpected '+path);});
  let client=f.make();await client.preview(clone(source));await client.commit(selection);assert.equal(sends,0);await client.previewMail([id]);assert.equal(sends,0);await assert.rejects(client.sendMail([other]));await assert.rejects(client.sendMail([id]));assert.equal(sends,1);assert.equal(client.mailPending,true);
  await assert.rejects(client.sendMail([id]));assert.equal(sends,1);client=f.make();assert.equal(client.restore(),true);const result=await client.lookupMail();assert.equal(result.results[0].status,'provider_accepted');assert.equal(sends,1);assert.equal(client.mailPending,false);assert.doesNotMatch([...f.storage.values.values()].join(),/example\.invalid|Synthetic person/u);
});

test('full role gate happens before source IO and a changed session cannot adopt an old preview',async()=>{
  let release;const f=setup(()=>new Promise(resolve=>{release=resolve;}));f.state.user={id:'synthetic-outreach',roles:['outreach']};let client=f.make();await assert.rejects(client.preview(clone(source)));assert.equal(f.calls.length,0);
  f.state.user=user;const pending=client.preview(clone(source));await new Promise(resolve=>setTimeout(resolve,0));client.clear();f.state.user={id:'another-synthetic',roles:['superadmin']};release(preview());await assert.rejects(pending);assert.equal(client.currentPreview,null);assert.equal(client.pending,false);assert.equal(f.storage.values.size,0);
});

test('source replacement, malformed server preview and forged candidate values fail before an import',async()=>{
  const f=setup(()=>preview({rows:[{...preview().rows[0],tid:'unrelated'}]})),client=f.make();await assert.rejects(client.preview(clone(source)));assert.equal(client.currentPreview,null);assert.equal(f.calls.length,1);
  assert.equal(huodongxingPreviewView({...preview(),expectedTicketRevision:'3'}),null);assert.equal(huodongxingPreviewView({...preview(),rows:[{...preview().rows[0],candidates:[{registrationId:'https://bad.invalid',name:'a',organization:'',status:'confirmed'}]}]}),null);
});

test('a known absent operation must be explicitly acknowledged before a fresh preview; reserved partial operations keep their original command',async()=>{
  let absent=false;const f=setup((path,options)=>{if(path.endsWith('/preview'))return preview();if(path.includes('/operations/')){if(absent)throw Object.assign(Error('Not found'),{status:404,code:'CONTACT_NOT_FOUND'});return{kind:'huodongxing',operationId:op,status:'partial',finished:false,results:[],registrationIds:[]};}throw Object.assign(Error('stale preview'),{status:409});});
  const client=f.make();await client.preview(clone(source));await assert.rejects(client.commit(selection));await client.lookup();assert.equal(client.canRestart,false);assert.throws(()=>client.resetUnstarted());assert.equal(client.pending,true);absent=true;await assert.rejects(client.lookup());assert.equal(client.canRestart,true);const original=client.resetUnstarted();assert.equal(client.pending,false);assert.equal(original.originalSha256,source.originalSha256);await client.preview(original);assert.equal(f.calls.filter(call=>call.path.endsWith('/import')).length,1);
});

test('finished partial import is a known result and permits a new explicit preview instead of retrying the finished operation',async()=>{
  const f=setup(path=>path.endsWith('/preview')?preview():{...completed(),status:'partial',finished:true,results:[{tid:row.tid,status:'capacity_conflict',reason:'CAPACITY_CONFLICT'}],registrationIds:[]}),client=f.make();await client.preview(clone(source));const result=await client.commit(selection);assert.equal(result.status,'partial');assert.equal(client.pending,false);assert.equal(client.currentPreview,null);await client.preview(clone(source));assert.equal(f.calls.length,3);
});

test('browser controller matches the composed protected import API without contacting a provider or guessing consent',async()=>{
  const {peopleRuntimeFixture}=await import('./helpers/people-runtime-fixture.mjs');const f=await peopleRuntimeFixture({attendeeReviewRequired:false}),headers=await f.login(),storage=memory(),calls=[];
  const request=async(path,options={})=>{calls.push({path,method:options.method});const response=await f.app.handle(f.request(path,{method:options.method??'GET',headers,...(options.body?{body:JSON.parse(options.body)}:{})})),value=await response.json();if(!response.ok)throw Object.assign(Error(value.error.message),{status:response.status,code:value.error.code});return value;};
  const client=createHuodongxingMutations({request,getUser:()=>f.users[0],eventId,storage,operationId:()=>op,hashText:async value=>digest(value)}),valid=clone(source);valid.rows[0].status='有效票';valid.rows[0].registeredAt='2026-10-21 12:00:00';
  const before=await client.preview(valid);assert.equal(before.summary.new,1);assert.equal(before.rows[0].canSelect,true);const result=await client.commit(selection);assert.equal(result.status,'completed');assert.equal(result.registrationIds.length,1);assert.equal(f.messages.length,0);
  const admission=(await f.app.registrationService.getAdmissions({actor:f.users[0]})).people.find(item=>item.registrationId===result.registrationIds[0]);assert.equal(admission.status,'confirmed');const contacts=await f.app.contactsStore.read();assert.equal(contacts.contacts[0].profile.contactConsent,'unknown');assert.equal(contacts.contacts[0].profile.phone,'00123456');assert.equal(contacts.contacts[0].profile.wechat,'synthetic-chat');
  const second=await client.preview(valid);assert.equal(second.summary.existing,1);assert.equal(second.summary.new,0);const formal=await client.previewMail(result.registrationIds);assert.equal(formal.rows[0].registrationId,result.registrationIds[0]);assert.equal(f.messages.length,0);assert.equal(calls.filter(call=>call.path.endsWith('/dispatch')).length,0);
});

test('a fresh known pre-start mail rejection can reread recipients without sending; unknown outcomes cannot use this action',async()=>{
  let sends=0,serial=0;const calls=[],storage=memory();const request=async(path,options)=>{calls.push({path,...options});if(path==='/api/admin/contacts/import/preview')return preview();if(path==='/api/admin/contacts/import')return{...completed(),operationId:JSON.parse(options.body).operationId};if(path==='/api/admin/registration-confirmation/preview')return{...mailPreview(),revision:sends?2:1};if(path.endsWith('/dispatch')){if(++sends===1)throw Object.assign(Error('Synthetic changed preview'),{status:409});return{outcome:'updated',revision:3,operationId:JSON.parse(options.body).operationId,status:'completed',results:[{registrationId:id,status:'provider_accepted'}]};}throw Error('Unexpected request');};
  const client=createHuodongxingMutations({request,getUser:()=>user,eventId,storage,operationId:()=>String(++serial).repeat(64),hashText:async value=>digest(value)});await client.preview(clone(source));await client.commit(selection);await client.previewMail([id]);await assert.rejects(client.sendMail([id]));assert.equal(sends,1);assert.equal(client.mailKnownRejected,true);
  const ids=client.acknowledgeRejectedMail();assert.deepEqual(ids,[id]);assert.equal(client.mailPending,false);await client.previewMail(ids);assert.equal(sends,1,'acknowledgment and recipient refresh never resend');await client.sendMail(ids);assert.equal(sends,2);const dispatched=calls.filter(call=>call.path.endsWith('/dispatch')).map(call=>JSON.parse(call.body));assert.notEqual(dispatched[0].operationId,dispatched[1].operationId);
  const unknown=setup(path=>path==='/api/admin/registration-confirmation/preview'?mailPreview():path.endsWith('/preview')?preview():path.endsWith('/import')?completed():Promise.reject(Error('Synthetic unknown ACK'))),otherClient=unknown.make();await otherClient.preview(clone(source));await otherClient.commit(selection);await otherClient.previewMail([id]);await assert.rejects(otherClient.sendMail([id]));assert.equal(otherClient.mailKnownRejected,false);assert.throws(()=>otherClient.acknowledgeRejectedMail());assert.equal(unknown.calls.filter(call=>call.path.endsWith('/dispatch')).length,1);
});

test('actual capacity partial DTO accepts a null failed registration, keeps only confirmed canonical IDs, and finishes the original import',async()=>{
  const {peopleRuntimeFixture}=await import('./helpers/people-runtime-fixture.mjs');const f=await peopleRuntimeFixture({capacity:1,attendeeReviewRequired:false}),headers=await f.login(),storage=memory(),calls=[];
  const request=async(path,options={})=>{calls.push({path,...options});const response=await f.app.handle(f.request(path,{method:options.method??'GET',headers,...(options.body?{body:JSON.parse(options.body)}:{})})),value=await response.json();if(!response.ok)throw Object.assign(Error(value.error.message),{status:response.status,code:value.error.code});return value;};
  const client=createHuodongxingMutations({request,getUser:()=>f.users[0],eventId,storage,operationId:()=>op,hashText:async value=>digest(value)}),valid=clone(source);valid.rows[0].status='有效票';valid.rows[0].registeredAt='2026-10-21 12:00:00';valid.rows.push({...clone(valid.rows[0]),sourceRow:3,tid:'second-ticket',registrationNumber:'second-registration',orderNumber:'second-order',name:'Synthetic second person',email:'second-synthetic@example.invalid',phone:'002222222',wechat:'synthetic-second-chat'});
  await client.preview(valid);const result=await client.commit({...selection,selectedTids:valid.rows.map(row=>row.tid)});assert.equal(result.status,'partial');assert.equal(result.finished,true);assert.equal(result.results.filter(row=>row.status==='imported').length,1);assert.equal(result.results.find(row=>row.status==='capacity_conflict').registrationId,null);assert.equal(result.registrationIds.length,1);assert.equal(client.pending,false);assert.equal(client.currentPreview,null);assert.equal(f.messages.length,0);
  const operation=await request('/api/admin/contacts/import/operations/'+op,{method:'GET'});assert.equal(operation.finished,true);assert.equal(operation.results.find(row=>row.status==='capacity_conflict').registrationId,null);await client.previewMail(result.registrationIds);assert.equal(f.messages.length,0);assert.equal(calls.filter(call=>call.path.endsWith('/import')&&call.method==='POST').length,1);
});

test('duplicate matches entirely inside the uploaded batch still require an explicit separate-person decision without existing candidates',async()=>{
  const value=preview({summary:{total:1,new:0,existing:0,needsReview:1,eligible:1},rows:[{...preview().rows[0],status:'needs_review',reason:'POSSIBLE_DUPLICATE',candidates:[]}]}),f=setup(path=>path.endsWith('/preview')?value:completed()),client=f.make();await client.preview(clone(source));await assert.rejects(client.commit(selection));assert.equal(f.calls.length,1);await client.commit({...selection,separateTids:[row.tid]});assert.deepEqual(JSON.parse(f.calls.at(-1).body).separateTids,[row.tid]);
});


test('actual protected preview reasons identify the required staff correction without exposing arbitrary reason text',async()=>{
  const {peopleRuntimeFixture}=await import('./helpers/people-runtime-fixture.mjs');const f=await peopleRuntimeFixture(),headers=await f.login(),rows=Array.from({length:5},(_,index)=>({...clone(row),sourceRow:index+2,tid:'reason-'+index,name:'Synthetic reason '+index,email:'reason'+index+'@example.invalid',phone:'00'+index,wechat:'reason-'+index,status:'有效票'}));
  rows[1].status='已取消';rows[2].name='';rows[3].email='';rows[4].registeredAt='';
  const response=await f.app.handle(f.request('/api/admin/contacts/import/preview',{method:'POST',headers,body:{...clone(source),rows}}));assert.equal(response.status,200);const value=huodongxingPreviewView(await response.json());assert.ok(value);
  assert.deepEqual(value.rows.slice(1).map(item=>huodongxingReasonLabel(item.reason)),['原票务状态需核对','缺少姓名','缺少邮箱','缺少报名时间']);
  assert.equal(huodongxingReasonLabel('ADMISSION_WITHDRAWN'),'关联名额已撤回');assert.match(huodongxingReasonLabel('ADMISSION_WAITLISTED'),/候补/u);assert.match(huodongxingReasonLabel('ADMISSION_PENDING_REVIEW'),/待审核/u);assert.match(huodongxingReasonLabel('ADMISSION_REJECTED'),/未通过/u);assert.match(huodongxingReasonLabel('CONTACT_DECLINED'),/拒绝/u);assert.match(huodongxingReasonLabel('LINK_CHANGED'),/重新核对/u);
  for(const unsafe of ['ADMISSION_<script>private</script>','__proto__','constructor','UNKNOWN_PRIVATE_PROVIDER_REASON',null])assert.equal(huodongxingReasonLabel(unsafe),'此行需要核对');assert.equal(f.messages.length,0);
});
