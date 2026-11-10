import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { validateGeneralApplicationFields, validateWalletApplicationFields, WALLET_APPLICATION_INTAKE } from '../shared/general-application.mjs';
import { createRegistrationService } from '../functions/registration-api/service.mjs';
import { createRegistrationApi } from '../functions/registration-api/handler.mjs';
import { createRegistrationAdminApi } from '../functions/registration-admin/handler.mjs';
import { createRegistrationReviewStore } from '../functions/registration-admin/store.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';
import { createRegistrationClient } from '../src/lib/registration-client.mjs';
import { createApplicationDraft, applicationDraftFromFields, applicationDraftValue, applicationDraftScope } from '../src/lib/application-draft.mjs';

const EVENT='synthetic-wallet-requests',SITE='https://artdico.host',API='https://api.artdico.host',NOW=Date.parse('2026-11-10T08:00:00Z');
const key=()=>randomBytes(32).toString('base64url'),actor={id:'synthetic-reviewer',roles:['reviewer','superadmin']};
const fields=()=>({intake:WALLET_APPLICATION_INTAKE,name:'合成纪念卡申请人',email:'synthetic.wallet@example.invalid',wechat:'synthetic_wechat_001',huodongxingReference:'000012345678901234567890',categories:['other'],participationInterests:['attend']});
const privacy={version:'synthetic-wallet-v1',processor:'合成处理者',contactEmail:'privacy@example.invalid',purpose:'合成纪念卡申请',storageRegion:'合成地区',retention:'合成期限',rightsRequest:'合成权利入口',sharing:'合成范围'};
function fixture(){
 const base=memoryObjects(),state={loseAck:false,callbacks:[],now:NOW};
 const objects={...base,async append(path,position,bytes){const value=await base.append(path,position,bytes);if(state.loseAck&&path.endsWith('/index/commits.jsonl')){state.loseAck=false;throw new Error('Synthetic lost ACK');}return value;}};
 const make=(patch={})=>createRegistrationService({objects,journalFor:prefix=>createObjectJournal({objects,prefix}),policy:{enabled:true,eventId:EVENT,publicRegistrationMode:'speaker_only',attendeeReviewRequired:false,opensAt:'2026-10-01T00:00:00Z',closesAt:'2026-12-05T04:00:00Z',privacy,...patch},capacity:1,waitlistEnabled:false,tokenSecret:'synthetic-wallet-request-secret-123456789',allowedOrigins:[SITE],clock:()=>state.now,onSaved:async value=>{state.callbacks.push(value);return{};}});
 return{make,state,objects};
}
async function input(service,value=fields(),flags={walletApplication:true}){
 const idempotencyKey=key(),issued=await service.issueToken({eventId:EVENT,origin:SITE,idempotencyKey,...flags});assert.equal(issued.outcome,'issued');
 return{origin:SITE,idempotencyKey,submissionToken:issued.submissionToken,payload:{eventId:EVENT,fields:value,consent:{accepted:true,version:privacy.version}}};
}
function scopedMemoryStore(){
 const rows=new Map(),read=scope=>structuredClone(rows.get(JSON.stringify(scope))??{revision:0,actorEpoch:0,record:null});
 return{async read(scope){return read(scope);},async write(scope,update,policy){const before=read(scope);assert.equal(update.expectedRevision,before.revision);assert.equal(policy.validate(update.value,{kind:update.kind}),true);if(before.record?.kind==='pending_submission')assert.equal(update.value.payloadJson,before.record.value.payloadJson);const after={revision:before.revision+1,actorEpoch:0,record:{kind:update.kind,value:structuredClone(update.value)}};rows.set(JSON.stringify(scope),after);return read(scope);},async remove(scope,update){const before=read(scope);assert.equal(update.expectedRevision,before.revision);if(before.record?.kind==='pending_submission')assert.equal(update.allowPending,true);rows.set(JSON.stringify(scope),{revision:before.revision+1,actorEpoch:0,record:null});return read(scope);},async rejectPending(scope,update,policy){const before=read(scope);assert.equal(before.record.value.uncertain,false);rows.set(JSON.stringify(scope),{...before,record:null});return this.write(scope,{...update,kind:'editing',value:policy.rejectPending(before.record.value)},policy);},subscribe(){return()=>{};}};
}
function clientFixture(service,store,{lostResponse=false}={}){
 const api=createRegistrationApi({allowedOrigins:[SITE],submissionService:service,clock:()=>NOW}),calls=[];let lose=lostResponse;
 const client=createRegistrationClient({apiOrigin:API,pageOrigin:SITE,applicationKind:'wallet',pendingStore:store,clock:()=>NOW,fetchFn:async(url,options)=>{
  const path=new URL(url).pathname.replace('/api/admin/registration/config','/api/registration/config').replace('/api/admin/registration/token','/api/registration/token').replace('/api/admin/registration/submit','/api/registrations');
  calls.push({path,body:options.body,headers:options.headers});const response=await api(new Request(API+path,{...options,headers:{...options.headers,Origin:SITE}}));if(path==='/api/registrations'&&lose){lose=false;throw new Error('Synthetic lost response');}return response;
 }});return{client,calls,api};
}

test('wallet requests keep private ticket references and contact text without accepting a self-selected identity',()=>{
 const value=fields();value.name='  合成申请人  ';value.huodongxingReference=' 000001234567890123456789 ';value.phone='+852 0012 3456';
 const checked=validateGeneralApplicationFields(value);assert.equal(checked.valid,true);assert.equal(checked.value.huodongxingReference,'000001234567890123456789');assert.equal(checked.value.phone,'+852 0012 3456');assert.equal(checked.value.name,'合成申请人');
 for(const patch of [{walletIdentity:'staff'},{admissionStatus:'confirmed'},{speaker:{}},{categories:['industry']},{participationInterests:['talk']},{huodongxingReference:123},{locale:'fr'},{email:'invalid'}])assert.equal(validateWalletApplicationFields({...fields(),...patch}).valid,false);
 for(const name of ['name','email','wechat','huodongxingReference']){const missing=fields();delete missing[name];assert.equal(validateWalletApplicationFields(missing).valid,false);}
 let invoked=false;const accessor={...fields()};Object.defineProperty(accessor,'email',{enumerable:true,get(){invoked=true;return'private';}});assert.equal(validateWalletApplicationFields(accessor).valid,false);assert.equal(invoked,false);
});

test('wallet requests stay pending at full capacity and do not reserve, promote or automatically confirm a place',async()=>{
 const f=fixture(),legacy=f.make({publicRegistrationMode:'legacy'}),ordinary={intake:'general-v2',name:'合成一般来宾',email:'ordinary@example.invalid',categories:['other'],participationInterests:['attend']};
 const first=await legacy.submit(await input(legacy,ordinary,{}));assert.equal(first.receipt.admissionStatus,'confirmed');
 const service=f.make(),before=await service.getAdmissions({actor}),saved=await service.submit(await input(service));assert.equal(saved.outcome,'created');assert.equal(saved.receipt.admissionStatus,'pending_review');
 const after=await service.getAdmissions({actor});assert.equal(after.summary.confirmedCount,before.summary.confirmedCount);assert.equal(after.summary.waitlistCount,0);assert.equal(after.summary.pendingReviewCount,1);assert.equal(f.state.callbacks.at(-1).notify,false);assert.deepEqual(f.state.callbacks.at(-1).promotedIds,[]);
});

test('wallet token flags cannot open ordinary registration, bypass consent or ignore the global application window',async()=>{
 const f=fixture(),service=f.make();const ordinary={intake:'general-v2',name:'合成一般来宾',email:'ordinary@example.invalid',categories:['other'],participationInterests:['attend']};
 assert.deepEqual(await service.submit(await input(service,ordinary)),{outcome:'closed'});
 const bad=await input(service);bad.payload.consent.accepted=false;assert.deepEqual(await service.submit(bad),{outcome:'invalid'});
 const role=await input(service,{...fields(),walletIdentity:'guest'});assert.deepEqual(await service.submit(role),{outcome:'invalid'});
 const disabled=f.make({enabled:false});assert.equal((await disabled.issueToken({eventId:EVENT,origin:SITE,idempotencyKey:key(),walletApplication:true})).outcome,'closed');
 f.state.now=Date.parse('2026-12-06T00:00:00Z');assert.equal((await service.issueToken({eventId:EVENT,origin:SITE,idempotencyKey:key(),walletApplication:true})).outcome,'closed');
});

test('lost wallet commit acknowledgements replay the exact private application after closure without a second record',async()=>{
 const f=fixture(),service=f.make(),request=await input(service),body=JSON.stringify(request.payload);f.state.loseAck=true;
 assert.deepEqual(await service.submit(request),{outcome:'unavailable'});
 const closed=f.make({enabled:false}),issued=await closed.issueToken({eventId:EVENT,origin:SITE,idempotencyKey:request.idempotencyKey,walletApplication:true});assert.equal(issued.outcome,'issued');
 const replay=await closed.submit({...request,submissionToken:issued.submissionToken});assert.equal(replay.outcome,'replayed');assert.equal(replay.receipt.admissionStatus,'pending_review');assert.equal(JSON.stringify(request.payload),body);assert.equal((await closed.repository.list()).registrations.length,1);
 assert.equal((await closed.submit({...request,payload:{...request.payload,fields:{...fields(),wechat:'changed'}}})).outcome,'conflict');
});

test('reviewers assign an audited card identity while retaining original requests and omitted fields from older clients',async()=>{
 const f=fixture(),service=f.make(),saved=await service.submit(await input(service)),id=saved.receipt.registrationId;
 const store=()=>createRegistrationReviewStore({journal:createObjectJournal({objects:f.objects,prefix:'cms/v1/registration-reviews/'+EVENT}),loadRegistrations:()=>service.repository.list(),eventId:EVENT,clock:()=>NOW});
 const detail=await store().detail(id),original=JSON.stringify(detail.registration.fields),review={...detail.review,walletIdentity:'guest'};delete review.deletionRequested;
 const written=await store().saveReview(id,detail.revision,review,actor.id);assert.equal(written.review.walletIdentity,'guest');
 const old={...review};delete old.walletIdentity;old.nextStep='合成工作人员已核对';await store().saveReview(id,written.revision,old,actor.id);
 const current=await store().detail(id);assert.equal(current.review.walletIdentity,'guest');assert.equal(JSON.stringify(current.registration.fields),original);
 const projection=await store().projectRegistration(current.registration);assert.equal(projection.walletRequested,true);assert.equal(projection.walletIdentity,'guest');assert.equal(projection.fields.huodongxingReference,fields().huodongxingReference);
 await assert.rejects(store().saveReview(id,current.revision,{...old,walletIdentity:'administrator'},actor.id),{code:'INVALID_REVIEW'});
 const cleared=await store().saveReview(id,current.revision,{...old,walletIdentity:''},actor.id);assert.equal(cleared.review.walletIdentity,'');
 await assert.rejects(store().saveReview(id,current.revision,review,actor.id),{code:'REVISION_CONFLICT'});
 assert.equal((await service.getAdmissionStatus(id)).status,'pending_review','a card label never grants admission');
});

test('wallet and speaker editing/pending drafts are independent and never persist consent or token secrets',async()=>{
 const store=scopedMemoryStore(),speaker=createApplicationDraft({store,eventId:EVENT}),wallet=createApplicationDraft({store,eventId:EVENT,intake:WALLET_APPLICATION_INTAKE});await speaker.read();await wallet.read();
 const proposal=applicationDraftFromFields({name:'合成讲者',email:'speaker@example.invalid',participationInterests:['talk'],speaker:{topic:'合成主题',summary:'合成简介'}});await speaker.save(proposal);
 const card=applicationDraftFromFields(fields());card.huodongxingReference='000123';await wallet.save(card);assert.equal((await speaker.read()).record.value.name,'合成讲者');assert.equal((await wallet.read()).record.value.huodongxingReference,'000123');assert.notDeepEqual(applicationDraftScope(EVENT),applicationDraftScope(EVENT,WALLET_APPLICATION_INTAKE));
 for(const patch of [{consentAccepted:true},{submissionToken:'private'},{walletIdentity:'staff'}])assert.throws(()=>applicationDraftValue({...card,...patch}));
});

test('the browser client uses the wallet token route and recovers the same saved body after a lost HTTP response',async()=>{
 const f=fixture(),store=scopedMemoryStore(),draft=createApplicationDraft({store,eventId:EVENT,intake:WALLET_APPLICATION_INTAKE});await draft.read();
 const first=clientFixture(f.make(),draft.pendingStore,{lostResponse:true});await first.client.configure();await assert.rejects(first.client.submit(fields()));
 assert.equal(first.client.pending,true);const pending=(await draft.read()).record.value;assert.equal(pending.uncertain,true);
 const token=first.calls.find(call=>call.path.endsWith('/token'));assert.equal(JSON.parse(token.body).walletApplication,true);
 const recovered=createApplicationDraft({store,eventId:EVENT,intake:WALLET_APPLICATION_INTAKE}),snapshot=await recovered.read(),second=clientFixture(f.make({enabled:false}),recovered.pendingStore);await second.client.configure();second.client.restorePending(snapshot.record.value);assert.equal(second.calls.length,1,'reading a draft never submits');
 const result=await second.client.resume();assert.equal(result.body.admissionStatus,'pending_review');assert.equal((await recovered.read()).record,null);
 const original=first.calls.find(call=>call.path==='/api/registrations'),replay=second.calls.find(call=>call.path==='/api/registrations');assert.equal(replay.body,original.body);assert.equal(replay.headers['Idempotency-Key'],original.headers['Idempotency-Key']);assert.equal((await f.make().repository.list()).registrations.length,1);
});


test('linked requests direct staff to the primary card identity and cannot update an ineffective alias label',async()=>{
 const f=fixture(),service=f.make(),primary=(await service.submit(await input(service))).receipt.registrationId,alias=(await service.submit(await input(service,{...fields(),name:'合成关联申请人'}))).receipt.registrationId;
 const store=createRegistrationReviewStore({journal:createObjectJournal({objects:f.objects,prefix:'cms/v1/registration-reviews/'+EVENT}),loadRegistrations:()=>service.repository.list(),eventId:EVENT,clock:()=>NOW});
 const api=createRegistrationAdminApi({enabled:true,store,profileTarget:async()=>primary,auth:{authenticate:async()=>({user:actor,csrfToken:'synthetic-csrf'})}});
 const response=await api(new Request(API+'/api/admin/registrations/'+alias));assert.equal(response.status,200);const detail=await response.json();assert.equal(detail.walletIdentityTargetId,primary);
 const review={...detail.review,walletIdentity:'staff'};delete review.deletionRequested;
 const rejected=await api(new Request(API+'/api/admin/registrations/'+alias+'/review',{method:'PATCH',headers:{Origin:API,'Content-Type':'application/json','X-CSRF-Token':'synthetic-csrf'},body:JSON.stringify({expectedRevision:detail.revision,review})}));assert.equal(rejected.status,409);assert.equal((await store.detail(alias)).revision,detail.revision);
 const canonical=await store.detail(primary),selected={...canonical.review,walletIdentity:'guest'};delete selected.deletionRequested;await store.saveReview(primary,canonical.revision,selected,actor.id);
 assert.equal((await store.projectRegistration(detail.registration,primary,[primary,alias])).walletIdentity,'guest');assert.equal((await store.detail(alias)).review.walletIdentity,undefined);
});
