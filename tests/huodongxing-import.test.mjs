import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {peopleRuntimeFixture} from './helpers/people-runtime-fixture.mjs';
import {validateHuodongxingLedger,createHuodongxingImporter} from '../functions/intent-invitations/importer.mjs';
import {HUODONGXING_JOURNAL_PREFIX as PREFIX,validateHuodongxingTicketRow} from '../shared/contacts-schema.mjs';
import {createObjectJournal} from '../functions/cloud-content/object-journal.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex'),operation=()=>randomBytes(32).toString('hex');
const row=(patch={})=>({sourceRow:2,tid:'synthetic-ticket-1',registrationNumber:'0000123',orderNumber:'0000456',name:'合成活动行来宾',email:'synthetic.hui@example.invalid',phone:'+852 0012 3456',wechat:'synthetic-hui',registeredAt:'2026-11-03 12:00:00',lastVerifiedAt:'',status:'有效票',...patch});
function source(rows=[row()],bytes='SYNTHETIC ORIGINAL FILE BYTES'){const file=Buffer.from(bytes);return {kind:'huodongxing',sourceEventId:'8884819113200',rows,sourceFileBase64:file.toString('base64'),originalSha256:hash(file)};}
async function fixture(options={}){const f=await peopleRuntimeFixture({mail:true,attendeeReviewRequired:false,clock:()=>Date.parse('2026-11-03T09:00:00Z'),...options});return {...f,headers:await f.login()};}
async function call(f,path,body,expected=200,app=f.app,headers=f.headers){const response=await app.handle(f.request(path,{method:body===undefined?'GET':'POST',headers,body})),value=await response.json();assert.equal(response.status,expected,JSON.stringify(value));return value;}
const preview=(f,input,app)=>call(f,'/api/admin/contacts/import/preview',input,200,app);
function command(input,p,extra={}){return {...input,operationId:operation(),expectedRevision:p.expectedRevision,expectedTicketRevision:p.expectedTicketRevision,expectedAdmissionRevision:p.expectedAdmissionRevision,previewToken:p.previewToken,selectedTids:input.rows.map(row=>row.tid),links:[],separateTids:[],confirmSource:true,confirmPermission:true,permissionReference:'活动行 https://9525102647817.huodongxing.com/event/8884819113200 · 原文件 SHA-256 '+input.originalSha256,...extra};}
const commit=(f,input,status=200,app)=>call(f,'/api/admin/contacts/import',input,status,app);
const readOp=(f,id,app)=>call(f,'/api/admin/contacts/import/operations/'+id,undefined,200,app);
const ledger=f=>createObjectJournal({objects:f.objects,prefix:PREFIX}).read();
const count=f=>f.app.registrationService.getAdmissions({actor:f.users[0]});

test('typed external rows reject unknown fields, numeric identifiers and getters without inventing consent',()=>{
  assert.equal(validateHuodongxingTicketRow(row()).valid,true);assert.equal(validateHuodongxingTicketRow(row({wechat:''})).valid,true);
  for(const patch of [{tid:123},{phone:123},{sourceRow:1},{sourceRow:502},{email:'bad'},{phone:'bad\nline'},{extra:'hidden'},{name:'x'.repeat(81)}])assert.equal(validateHuodongxingTicketRow({...row(),...patch}).valid,false);
  let invoked=false;const value=row();Object.defineProperty(value,'tid',{enumerable:true,get(){invoked=true;return'secret';}});assert.equal(validateHuodongxingTicketRow(value).valid,false);assert.equal(invoked,false);
});

test('full event roles authorize external preview, commit and operation lookup before any private import reads',async()=>{
  const f=await fixture(),input=source();for(const username of ['outreach','reviewer','editor','combined']){const headers=await f.login(username),at=f.objects.calls.length;await call(f,'/api/admin/contacts/import/preview',input,403,f.app,headers);await call(f,'/api/admin/contacts/import/operations/'+'a'.repeat(64),undefined,403,f.app,headers);assert.equal(f.objects.calls.slice(at).some(item=>item.key?.startsWith(PREFIX)||item.key?.startsWith('cms/v1/contacts')),false);}
  assert.equal((await preview(f,input)).summary.new,1);
});

test('preview is read-only and binds event, normalized source, original file checksum and all revisions',async()=>{
  const f=await fixture(),input=source(),at=f.objects.calls.length,p=await preview(f,input);assert.equal(p.summary.new,1);assert.equal(p.canCommit,true);assert.equal(f.objects.calls.slice(at).some(item=>item.operation==='append'||item.operation==='putImmutable'),false);assert.equal(f.messages.length,0);
  for(const patch of [{sourceEventId:'different-event'},{originalSha256:'a'.repeat(64)},{rows:[row(),row({sourceRow:3})]}])await call(f,'/api/admin/contacts/import/preview',{...input,...patch},patch.rows?422:400);
  await f.createContact({name:'合成无关更新',email:'unrelated@example.invalid'});await commit(f,command(input,p),409);assert.equal((await count(f)).people.length,0);
});

test('both source and separate notification-basis attestations are required before writing a ticket or seat',async()=>{
  const f=await fixture(),input=source(),p=await preview(f,input),base=command(input,p);for(const patch of [{confirmSource:false},{confirmPermission:false},{permissionReference:''},{selectedTids:[]}])await commit(f,{...base,...patch},400);
  assert.equal((await ledger(f)).value,null);assert.equal((await f.app.contactsStore.read()).contacts.length,0);assert.equal((await count(f)).people.length,0);assert.equal(f.messages.length,0);
});

test('valid staff-attested ticket saves phone, WeChat, external time and a confirmed shared seat without public consent or mail',async()=>{
  const f=await fixture(),input=source(),p=await preview(f,input),body=command(input,p),result=await commit(f,body),id=result.registrationIds[0];assert.equal(result.finished,true);assert.equal(result.results[0].status,'imported');assert.equal(f.messages.length,0);
  const record=(await f.app.registrationService.repository.list()).registrations[0],contact=(await f.app.contactsStore.read()).contacts[0];
  assert.deepEqual(record.consent,{accepted:false,version:null,acceptedAt:null});assert.equal(record.provenance.kind,'staff_assisted');assert.equal(record.provenance.sourceContactId,contact.id);assert.equal(record.fields.phone,input.rows[0].phone);assert.equal(record.fields.wechat,input.rows[0].wechat);assert.equal(contact.profile.contactConsent,'unknown');assert.equal(contact.operations.responseStatus,'pending');assert.equal(contact.profile.submittedAt,input.rows[0].registeredAt);assert.notEqual(contact.createdAt,contact.profile.submittedAt);
  const value=validateHuodongxingLedger((await ledger(f)).value);assert.equal(value.tickets[0].actorId,f.users[0].id);assert.equal(value.tickets[0].permissionReference,body.permissionReference);assert.equal(JSON.stringify(value).includes(input.sourceFileBase64),false);assert.equal((await count(f)).summary.confirmedCount,1);
  const proof=await f.app.huodongxingImporter.attendanceEvidence({registrationIds:[id]});assert.deepEqual(proof.registrationIds,[id]);assert.equal(proof.revision,value.revision);assert.doesNotMatch(JSON.stringify(proof),/synthetic\.hui|ticket-1|wechat|phone/u);
});

test('same ticket and reordered row positions are existing; repeated commands never allocate or send again',async()=>{
  const f=await fixture(),input=source(),body=command(input,await preview(f,input)),first=await commit(f,body),before=(await ledger(f)).value.revision;assert.deepEqual(await commit(f,body),first);assert.equal((await ledger(f)).value.revision,before);
  const reordered=source([row({sourceRow:9})],'SYNTHETIC REORDERED FILE'),p=await preview(f,reordered);assert.equal(p.summary.existing,1);assert.equal(p.rows[0].canSelect,true);const again=await commit(f,command(reordered,p));assert.equal(again.results[0].status,'existing');assert.deepEqual(again.registrationIds,first.registrationIds);assert.equal((await count(f)).people.length,1);assert.equal(f.messages.length,0);
  await commit(f,{...body,permissionReference:'合成改变原命令'},409);
});

test('changed source, cancelled or unknown tickets and incomplete contacts require review without overwriting existing data',async()=>{
  const f=await fixture(),input=source();await commit(f,command(input,await preview(f,input)));const before=JSON.stringify((await f.app.contactsStore.read()).contacts);
  const changes=source([row({name:'合成来源改名'}),row({sourceRow:3,tid:'cancelled',status:'已取消'}),row({sourceRow:4,tid:'unknown',status:'未知状态'}),row({sourceRow:5,tid:'missing-email',email:''}),row({sourceRow:6,tid:'missing-name',name:''}),row({sourceRow:7,tid:'missing-time',registeredAt:''})]);const p=await preview(f,changes);assert.equal(p.summary.needsReview,6);assert.equal(p.rows.every(row=>!row.canSelect),true);assert.equal(p.canCommit,false);await commit(f,command(changes,p),422);assert.equal(JSON.stringify((await f.app.contactsStore.read()).contacts),before);assert.equal((await count(f)).people.length,1);assert.equal(f.messages.length,0);
});

test('explicit link reuses an existing confirmed website admission and never creates another seat',async()=>{
  const f=await fixture(),old=await f.seedPublic({intake:'general-v2',name:'合成网站来宾',email:row().email}),beforeMail=f.messages.length,input=source(),p=await preview(f,input);assert.equal(p.rows[0].reason,'POSSIBLE_DUPLICATE');assert.equal(p.rows[0].candidates[0].registrationId,old.reference_code);
  await commit(f,command(input,p),422);const body=command(input,p,{links:[{tid:row().tid,registrationId:old.reference_code}]}),result=await commit(f,body);assert.equal(result.results[0].status,'linked');assert.deepEqual(result.registrationIds,[old.reference_code]);assert.equal((await count(f)).summary.confirmedCount,1);assert.equal((await f.app.registrationService.repository.list()).registrations.length,1);assert.equal(f.messages.length,beforeMail);
});

test('same email in two distinct tickets requires an explicit different-person decision, not automatic merging',async()=>{
  const f=await fixture(),input=source([row(),row({sourceRow:3,tid:'synthetic-ticket-2',name:'合成另一位来宾'})]),p=await preview(f,input);assert.equal(p.rows.every(row=>row.reason==='POSSIBLE_DUPLICATE'),true);await commit(f,command(input,p),422);
  const result=await commit(f,command(input,p,{separateTids:input.rows.map(row=>row.tid)}));assert.equal(result.registrationIds.length,2);assert.equal((await count(f)).summary.confirmedCount,2);assert.equal((await ledger(f)).value.tickets.length,2);assert.equal(f.messages.length,0);
});

test('capacity conflict records a clear partial outcome without creating a waitlist or importing a false ticket proof',async()=>{
  const f=await fixture({capacity:1});await f.seedPublic({intake:'general-v2',name:'合成已占名额',email:'already@example.invalid'});const baseline=f.messages.length,input=source(),result=await commit(f,command(input,await preview(f,input)));assert.equal(result.status,'partial');assert.equal(result.finished,true);assert.equal(result.results[0].status,'capacity_conflict');assert.deepEqual(result.registrationIds,[]);const admissions=await count(f);assert.equal(admissions.summary.confirmedCount,1);assert.equal(admissions.summary.waitlistCount,0);assert.equal(admissions.people.length,1);assert.equal((await ledger(f)).value.tickets.length,0);assert.equal(f.messages.length,baseline);
});

for(const point of ['contact','admission','ticket'])test('lost '+point+' acknowledgement retains the same operation; GET is read-only and exact resume allocates once',async()=>{
  const f=await fixture(),input=source();let lose=true,externalWrites=0;const objects={...f.objects,async append(path,position,bytes){const ack=await f.objects.append(path,position,bytes);if(path===PREFIX+'/commits.jsonl')externalWrites++;const match=point==='contact'?path==='cms/v1/contacts/commits.jsonl':point==='admission'?path==='cms/v1/registrations/ggj-cn-2026/index/commits.jsonl':path===PREFIX+'/commits.jsonl'&&externalWrites===2;if(lose&&match){lose=false;throw new Error('Synthetic lost private acknowledgement');}return ack;}};
  const app=f.make({objects}),body=command(input,await preview(f,input,app));await commit(f,body,503,app);const at=f.objects.calls.length,known=await readOp(f,body.operationId,app);assert.equal(f.objects.calls.slice(at).some(item=>item.operation==='append'||item.operation==='putImmutable'),false);assert.equal(f.messages.length,0);
  const result=await commit(f,body,200,f.make());assert.equal(result.results[0].status,point==='ticket'?'imported':'imported');assert.equal(result.finished,true);assert.equal((await count(f)).people.length,1);assert.equal((await ledger(f)).value.tickets.length,1);assert.equal(f.messages.length,0);assert.equal(known.operationId,body.operationId);
});

test('lost link acknowledgement survives an unrelated contact edit and resumes the already canonical target',async()=>{
  const f=await fixture(),old=await f.seedPublic({intake:'general-v2',name:'合成旧网站来宾',email:row().email}),input=source();let lose=true;const objects={...f.objects,async append(path,position,bytes){const ack=await f.objects.append(path,position,bytes);if(lose&&path==='cms/v1/registrations/ggj-cn-2026/index/commits.jsonl'){lose=false;throw new Error('Synthetic lost merge ACK');}return ack;}};const app=f.make({objects}),body=command(input,await preview(f,input,app),{links:[{tid:row().tid,registrationId:old.reference_code}]});await commit(f,body,503,app);await f.createContact({name:'合成无关联系人',email:'unrelated@example.invalid'});const result=await commit(f,body);assert.equal(result.results[0].status,'linked');assert.deepEqual(result.registrationIds,[old.reference_code]);assert.equal((await count(f)).people.length,1);
});

test('a duplicate introduced after preview and before resume stops for review instead of allocating another admission',async()=>{
  const f=await fixture(),input=source();let lose=true;const objects={...f.objects,async append(path,position,bytes){const ack=await f.objects.append(path,position,bytes);if(lose&&path==='cms/v1/contacts/commits.jsonl'){lose=false;throw new Error('Synthetic contact ACK lost');}return ack;}};const app=f.make({objects}),body=command(input,await preview(f,input,app));await commit(f,body,503,app);await f.seedPublic({intake:'general-v2',name:'合成另入口登记',email:row().email});const result=await commit(f,body);assert.equal(result.results[0].status,'needs_review');assert.equal(result.results[0].reason,'POSSIBLE_DUPLICATE');assert.equal((await count(f)).people.length,1);
});

test('staff contact corrections survive reimport and notification is explicit, source-permitted and deduplicated',async()=>{
  const f=await fixture(),input=source(),result=await commit(f,command(input,await preview(f,input))),id=result.registrationIds[0],roster=await f.app.contactsStore.read(),contact=roster.contacts[0];await f.app.contactsStore.saveProfile(contact.id,roster.revision,{name:'合成已更正称呼'},f.users[0].id);const p=await preview(f,input);assert.equal(p.summary.existing,1);await commit(f,command(input,p));assert.equal((await f.app.contactsStore.read()).contacts[0].profile.name,'合成已更正称呼');assert.equal(f.messages.length,0);
  const settings=await f.app.confirmationService.settings({actor:f.users[0]});const sent=await f.app.confirmationService.dispatch({actor:f.users[0],expectedRevision:settings.revision,operationId:operation(),registrationIds:[id]});assert.equal(sent.results[0].status,'provider_accepted');assert.equal(f.messages.length,1);assert.match(f.messages[0].template_params.confirmation_actions,/entry\.png/u);assert.match(f.messages[0].template_params.invitation_text,/https:\/\/artdico\.host\/r\/#[A-Za-z0-9_-]{22}/u);const current=await f.app.confirmationService.settings({actor:f.users[0]});await f.app.confirmationService.dispatch({actor:f.users[0],expectedRevision:current.revision,operationId:operation(),registrationIds:[id]});assert.equal(f.messages.length,1);assert.equal((await f.app.contactsStore.read()).contacts[0].profile.contactConsent,'unknown');
});

test('current withdrawal and declined replies override historical successful import on GET, evidence and email eligibility',async()=>{
  const f=await fixture(),input=source(),body=command(input,await preview(f,input)),saved=await commit(f,body),id=saved.registrationIds[0];const admissions=await count(f);await f.app.registrationService.withdrawAdmission({actor:f.users[0],registrationId:id,expectedRevision:admissions.revision,operationId:operation()});const at=f.objects.calls.length,op=await readOp(f,body.operationId);assert.equal(op.status,'partial');assert.equal(op.results[0].reason,'ADMISSION_WITHDRAWN');assert.deepEqual(op.registrationIds,[]);assert.equal(f.objects.calls.slice(at).some(item=>item.operation==='append'),false);assert.deepEqual((await f.app.huodongxingImporter.attendanceEvidence({registrationIds:[id]})).registrationIds,[]);assert.equal(f.messages.length,0);
});

test('ledger rejects orphan ticket proofs and audit/result actor or source mismatches',async()=>{
  const f=await fixture(),input=source();await commit(f,command(input,await preview(f,input)));const original=(await ledger(f)).value;
  for(const change of [value=>{value.operations=[];value.audit=[];value.revision=0;},value=>{value.audit[1].actorId='another-actor';},value=>{value.audit[1].tid='another-ticket';},value=>{value.operations[0].results=[];value.operations[0].finished=false;value.operations[0].status='pending';},value=>{value.tickets[0].permissionReference='invented-basis';}]){const value=structuredClone(original);change(value);assert.throws(()=>validateHuodongxingLedger(value));}
});


test('any declined contact in a merged canonical group blocks external proof and formal delivery',async()=>{
  const f=await fixture(),input=source(),saved=await commit(f,command(input,await preview(f,input))),id=saved.registrationIds[0],other=await f.createContact({name:'合成同人旧联系人',email:'other@example.invalid'}),roster=await f.app.contactsStore.read(),admission=await count(f);
  const merged=await f.app.registrationService.managePerson({actor:f.users[0],action:'person_merge',expectedRevision:admission.revision,operationId:operation(),input:{keys:['contact:'+other.contact.id,'registration:'+id],primaryKey:'registration:'+id,roles:null,contactRevision:roster.revision},verifySources:async()=>true});assert.equal(merged.outcome,'updated');
  const current=await f.app.contactsStore.read(),contact=current.contacts.find(row=>row.id===other.contact.id);await f.app.contactsStore.saveOperations(contact.id,current.revision,{...contact.operations,responseStatus:'declined'},f.users[0].id);
  assert.deepEqual((await f.app.huodongxingImporter.attendanceEvidence({registrationIds:[id]})).registrationIds,[]);const delivery=await f.app.confirmationService.staffDeliveryState({actor:f.users[0],registrationId:id});assert.equal(delivery.ready,false);assert.equal(delivery.reason,'CONTACT_DECLINED');assert.equal(f.messages.length,0);
});

test('unknown explicit confirmation remains unknown across reimport and cannot be sent twice',async()=>{
  const f=await fixture({mailResult:'unknown'}),input=source(),saved=await commit(f,command(input,await preview(f,input))),id=saved.registrationIds[0];let settings=await f.app.confirmationService.settings({actor:f.users[0]});await f.app.confirmationService.dispatch({actor:f.users[0],expectedRevision:settings.revision,operationId:operation(),registrationIds:[id]});assert.equal(f.messages.length,1);assert.equal((await f.app.confirmationService.staffDeliveryState({actor:f.users[0],registrationId:id})).status,'unknown');
  await commit(f,command(input,await preview(f,input)));settings=await f.app.confirmationService.settings({actor:f.users[0]});await f.app.confirmationService.dispatch({actor:f.users[0],expectedRevision:settings.revision,operationId:operation(),registrationIds:[id]});assert.equal(f.messages.length,1);
});

function capacityLedger({tickets=0,results=0,pending=[]}={}){
  const value={schemaVersion:1,kind:'huodongxing_ticket_ledger',eventId:'ggj-cn-2026',sourceEventId:'8884819113200',revision:0,tickets:[],operations:[],audit:[]},timestamp='2026-11-03T09:00:00.000Z',actorId='a',registrationId='r'.repeat(43),file='a'.repeat(64);let sequence=0;
  const add=(selected,success,unfinished=false)=>{const operationId=(++sequence).toString(16).padStart(64,'0'),resume={sourceEventId:'8884819113200',originalSha256:file,expectedRevision:0,expectedTicketRevision:0,expectedAdmissionRevision:0,previewToken:'b'.repeat(64),selectedTids:selected,links:[],separateTids:[],confirmSource:true,confirmPermission:true,permissionReference:'p'},op={operationId,requestHash:'c'.repeat(64),actorId,startedAt:timestamp,updatedAt:timestamp,finished:!unfinished,status:unfinished?'pending':success?'completed':'partial',reservedBytes:1000,resume,results:[]};value.operations.push(op);value.audit.push({revision:++value.revision,action:'started',operationId,actorId,at:timestamp,tid:null});if(unfinished)return;
    for(const tid of selected){const contactId='c_'+hash('huodongxing-8884819113200\0'+tid).slice(0,32);op.results.push({tid,status:success?'imported':'capacity_conflict',contactId,registrationId:success?registrationId:null,reason:success?null:'CAPACITY_CONFLICT'});value.audit.push({revision:++value.revision,action:'ticket_result',operationId,actorId,at:timestamp,tid});if(success){const r={tid,registrationNumber:'',orderNumber:'',name:'F',email:'a@b.invalid',phone:'',wechat:'',registeredAt:'x',lastVerifiedAt:'',status:'有效票'};value.tickets.push({tid,row:r,rowDigest:hash(JSON.stringify(r)),contactId,registrationId,sourceFileSha256:file,permissionReference:'p',actorId,recordedAt:timestamp});}}
  };
  for(let i=0;i<tickets;i+=100)add(Array.from({length:Math.min(100,tickets-i)},(_,j)=>'t'+(i+j)),true);
  for(let i=0;i<results;i+=100)add(Array.from({length:Math.min(100,results-i)},(_,j)=>'f'+(i+j)),false);
  if(pending.length)add(pending,false,true);return validateHuodongxingLedger(value);
}

test('unfinished operations reserve ticket and audit capacity before any new contact or admission write',async()=>{
  for(const value of [capacityLedger({tickets:999,pending:['reserved-ticket']}),capacityLedger({results:1977,pending:['reserved-audit']})]){
    const f=await fixture(),input=source(),journal={read:async()=>({value:structuredClone(value),cursor:{version:value.revision,position:1,hash:'a'.repeat(64)}}),commit:async()=>assert.fail('a known full ledger cannot start a journal write')},importer=createHuodongxingImporter({contactsStore:f.app.contactsStore,registrationService:f.app.registrationService,journal});
    const p=await importer.preview({...input,actor:f.users[0]}),body=command(input,p),at=f.objects.calls.length;await assert.rejects(importer.commit({...body,actor:f.users[0]}),{code:'CAPACITY_EXCEEDED'});assert.equal(f.objects.calls.slice(at).some(item=>item.operation==='append'||item.operation==='putImmutable'),false);assert.equal((await count(f)).people.length,0);
  }
});

test('explicit external link supplies independent notification basis for an existing confirmed staff record without changing either source consent',async()=>{
  const f=await fixture(),original=(await f.createContact({name:'合成已预留来宾',email:row().email,contactConsent:'unknown'})).contact,roster=await f.app.contactsStore.read();
  const converted=await f.app.intentService.convertContacts({actor:f.users[0],contactIds:[original.id],expectedContactRevision:roster.revision,permissionReference:'合成既有预留依据'}),id=converted.registrations[0].registrationId;assert.equal((await f.app.confirmationService.staffDeliveryState({actor:f.users[0],registrationId:id})).reason,'CONTACT_CONSENT_REQUIRED');
  const input=source(),p=await preview(f,input),saved=await commit(f,command(input,p,{links:[{tid:row().tid,registrationId:id}]}));assert.equal(saved.results[0].status,'linked');assert.equal((await count(f)).people.length,1);assert.equal(f.messages.length,0);
  const state=await f.app.confirmationService.staffDeliveryState({actor:f.users[0],registrationId:id});assert.equal(state.ready,true);const sent=await f.app.confirmationService.dispatch({actor:f.users[0],expectedRevision:state.revision,operationId:operation(),registrationIds:[id]});assert.equal(sent.results[0].status,'provider_accepted');assert.equal(f.messages.length,1);assert.equal((await f.app.contactsStore.read()).contacts.every(contact=>contact.profile.contactConsent==='unknown'),true);
});

test('a same-source historical waitlist is reported for review and is never upgraded by the external import',async()=>{
  const f=await fixture({capacity:1});await f.seedPublic({intake:'general-v2',name:'合成已占席',email:'occupied@example.invalid'});const input=source();await commit(f,command(input,await preview(f,input)));const contact=(await f.app.contactsStore.read()).contacts[0];
  const legacy=await f.app.registrationService.submitStaffRegistration({sourceContactId:contact.id,actor:f.users[0],input:{fields:{name:contact.profile.name,email:contact.profile.email,phone:contact.profile.phone,wechat:contact.profile.wechat},permissionReference:'合成先前转换依据'}});assert.equal(legacy.receipt.admissionStatus,'waitlisted');const before=(await count(f)).people.length,mail=f.messages.length,p=await preview(f,input),saved=await commit(f,command(input,p,{separateTids:[row().tid]}));assert.equal(saved.results[0].status,'needs_review');assert.equal(saved.results[0].reason,'ADMISSION_WAITLISTED');assert.deepEqual(saved.registrationIds,[]);assert.equal((await count(f)).people.length,before);assert.equal((await ledger(f)).value.tickets.length,0);assert.equal(f.messages.length,mail);
});

test('generic normalized rows cannot claim the reserved ticket namespace, while the existing staff import remains available',async()=>{
  const f=await fixture(),headers=await f.login('outreach'),input=source(),base={kind:'rows',sourceKey:'huodongxing-8884819113200',rows:[{sourceRowId:'synthetic-ticket-1',name:'合成旧导入',email:'legacy@example.invalid'}],sourceFileBase64:input.sourceFileBase64,originalSha256:input.originalSha256};const at=f.objects.calls.length;
  await call(f,'/api/admin/contacts/import/preview',base,400,f.app,headers);assert.equal(f.objects.calls.slice(at).every(item=>item.operation==='get'),true);assert.equal((await f.app.contactsStore.read()).contacts.length,0);
  const legacy={...base,sourceKey:'synthetic-existing-legacy'},p=await call(f,'/api/admin/contacts/import/preview',legacy,200,f.app,headers);await call(f,'/api/admin/contacts/import',{...legacy,expectedRevision:p.expectedRevision,previewToken:p.previewToken,allowPossibleDuplicates:false,confirmSource:true},200,f.app,headers);assert.equal((await f.app.contactsStore.read()).contacts.length,1);assert.equal((await count(f)).people.length,0);assert.equal(f.messages.length,0);
});

test('a generic snapshot cannot import an externally named contact without its dedicated ticket ledger and staff attestation',async()=>{
  const origin=await fixture(),input=source();await commit(origin,command(input,await preview(origin,input)));const contact=(await origin.app.contactsStore.read()).contacts[0],snapshot=JSON.stringify({storageVersion:1,revision:1,contacts:[contact],audit:[{action:'import_contacts',actorId:origin.users[0].id,revision:1,at:contact.createdAt,added:1,unchanged:0,duplicateReviewAccepted:false}]}),f=await fixture(),headers=await f.login('outreach'),at=f.objects.calls.length;
  await call(f,'/api/admin/contacts/import/preview',{kind:'snapshot',snapshot,originalSha256:hash(snapshot)},400,f.app,headers);assert.equal(f.objects.calls.slice(at).every(item=>item.operation==='get'),true);assert.equal((await f.app.contactsStore.read()).contacts.length,0);assert.equal((await ledger(f)).value,null);assert.equal(f.messages.length,0);
});

test('current corrected registration email is a duplicate candidate without rewriting original registration or external row',async()=>{
  const f=await fixture(),old=await f.seedPublic({intake:'general-v2',name:'合成网站原姓名',email:'old-address@example.invalid'}),detail=await f.app.reviewStore.detail(old.reference_code),fields=Object.fromEntries(['name','email','organization','position','city','wechat','phone'].map(key=>[key,detail.registration.fields[key]??'']));fields.email=row().email;
  await f.app.reviewStore.saveProfile(old.reference_code,detail.revision,operation(),fields,f.users[0].id);const input=source(),before=JSON.stringify(input.rows),p=await preview(f,input);assert.equal(p.rows[0].reason,'POSSIBLE_DUPLICATE');assert.equal(p.rows[0].candidates[0].registrationId,old.reference_code);assert.equal(JSON.stringify(input.rows),before);assert.equal((await f.app.registrationService.repository.list()).registrations[0].fields.email,'old-address@example.invalid');assert.equal((await count(f)).people.length,1);
});

test('a 300-registration and 100-ticket batch bounds immutable reads, current-profile loads and read concurrency',async t=>{
  const f=await fixture(),records=new Map(),bySource=new Map();let recordReads=0,profileReads=0,revisionReads=0,inactiveReads=0,statusReads=0,active=0,peak=0;
  const index={value:{revision:300,entries:[],admissions:{people:{},personGroups:[]}}};
  function add(name,email,sourceContactId){const id=createHash('sha256').update('synthetic-record-'+records.size).digest('base64url'),recordHash=hash(id),record={id,eventId:'ggj-cn-2026',fields:{name,email},provenance:sourceContactId?{kind:'staff_assisted',sourceContactId}:{kind:'public'}};records.set(id,record);index.value.entries.push({id,recordHash});index.value.admissions.people[id]={status:'confirmed'};if(sourceContactId)bySource.set(sourceContactId,id);return id;}
  for(let i=0;i<300;i++)add('合成旧名册 '+i,'old.'+i+'@example.invalid');
  const service={repository:{readIndex:async()=>structuredClone(index),readRecord:async entry=>{recordReads++;active++;peak=Math.max(peak,active);await new Promise(resolve=>setImmediate(resolve));active--;return structuredClone(records.get(entry.id));}},
    getAdmissionStatus:async id=>{statusReads++;return {status:index.value.admissions.people[id].status};},getStaffRegistrationBySource:async({sourceContactId})=>bySource.has(sourceContactId)?{outcome:'found',receipt:{registrationId:bySource.get(sourceContactId)}}:{outcome:'not_found'},
    submitStaffRegistration:async({sourceContactId,input,requireConfirmed})=>{assert.equal(requireConfirmed,true);const id=add(input.fields.name,input.fields.email,sourceContactId);index.value.revision++;return {outcome:'created',receipt:{registrationId:id}};},managePerson:async()=>assert.fail('no duplicate resolution was selected')};
  const importer=createHuodongxingImporter({contactsStore:f.app.contactsStore,registrationService:service,journal:createObjectJournal({objects:f.objects,prefix:PREFIX}),now:()=>Date.parse('2026-11-03T09:00:00Z'),currentProfiles:async()=>{profileReads++;return{};},currentProfileRevision:async()=>{revisionReads++;return 0;},inactiveRegistrationIds:async()=>{inactiveReads++;return[];}}),input=source(Array.from({length:100},(_,i)=>row({sourceRow:i+2,tid:'new-ticket-'+i,name:'合成新来宾 '+i,email:'new.'+i+'@example.invalid',phone:'',wechat:''}))),p=await importer.preview({...input,actor:f.users[0]});
  recordReads=profileReads=revisionReads=inactiveReads=statusReads=active=peak=0;const saved=await importer.commit({...command(input,p),actor:f.users[0]});assert.equal(saved.registrationIds.length,100);assert.ok(recordReads<=400,'the same immutable 300 records are not reread per ticket: '+recordReads);assert.equal(profileReads,1);assert.ok(revisionReads<=105);assert.ok(inactiveReads<=2);assert.ok(statusReads<=110,'admission status is not fetched per candidate: '+statusReads);assert.ok(peak<=8&&peak>1,'immutable reads use bounded concurrency');assert.equal((await createObjectJournal({objects:f.objects,prefix:'cms/v1/contacts'}).read()).value.migrationArchives.length,1,'one explicit batch uses one existing migration archive');assert.equal(f.messages.length,0);t.diagnostic(JSON.stringify({recordReads,profileReads,revisionReads,inactiveReads,statusReads,peak}));
});
