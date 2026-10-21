import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readSheet} from 'read-excel-file/node';
import {createRegistrationReviewStore} from '../functions/registration-admin/store.mjs';
import {createRegistrationXlsxApi,createContactsXlsxApi} from '../functions/registration-admin/xlsx-handler.mjs';
import {createObjectJournal} from '../functions/cloud-content/object-journal.mjs';
import {createOssContactsStore} from '../functions/cloud-content/contacts-store.mjs';
import {createInitialContent} from '../src/config/content.mjs';
import {memoryObjects} from './helpers/cloud-memory-objects.mjs';
import {XLSX_MIME} from '../shared/xlsx-workbook.mjs';
import {contactsWorkbook} from '../functions/registration-admin/xlsx-export.mjs';

const AT='2026-10-21T00:00:00.000Z',EVENT='ggj-cn-2026',A='A'.repeat(43),B='B'.repeat(43),C='C'.repeat(43),TEAM='t_'+'a'.repeat(22);
const clone=value=>structuredClone(value),digest=value=>createHash('sha256').update(value).digest('hex');
function record(id,name='合成报名者'){
  return {id,referenceCode:id,eventId:EVENT,submittedAt:AT,fields:{name,organization:'合成机构',city:'深圳',position:'合成职位',email:'synthetic@example.invalid',wechat:'SYNTHETIC_PRIVATE_WECHAT',categories:['industry'],participationInterests:['attend'],attendance:'expected',accommodationChoice:'not_needed',background:'合成原回答'},provenance:{kind:'public'},consent:{accepted:true,version:'synthetic-notice-v1',acceptedAt:AT}};
}
const auth={authenticate:async request=>({user:{id:'synthetic-staff',roles:(request.headers.get('cookie')??'editor').split(',')},csrfToken:'synthetic-csrf'})};
function request(path='/api/admin/registrations/export.xlsx',{role='superadmin',origin='https://api.artdico.host',csrf='synthetic-csrf',body={expectedRevision:0},headers={}}={}){
  return new Request('https://api.artdico.host'+path,{method:'POST',headers:{Cookie:role,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
}
function fixture({unknownAck=false,canExport}={}){
  const objects=memoryObjects(),source=[record(A,'=SUM(A1)'),record(B),record(C)],base=createObjectJournal({objects,prefix:'cms/v1/registration-reviews/'+EVENT});let commits=0;
  const journal={read:base.read,async commit(...args){commits++;const result=await base.commit(...args);if(unknownAck)throw new Error('SYNTHETIC_PRIVATE_PROVIDER');return result;}};
  const store=createRegistrationReviewStore({journal,eventId:EVENT,clock:()=>Date.parse(AT),loadRegistrations:async()=>({registrations:clone(source),revision:3})});
  const admissions={revision:3,people:[{registrationId:A,status:'confirmed',kind:'attendee',teamId:TEAM},{registrationId:B,status:'waitlisted',kind:'attendee',teamId:''},{registrationId:C,status:'withdrawn',kind:'crew',teamId:''}],teams:[{id:TEAM,name:'合成团队',memberIds:[A]}]};
  const contact={id:'c_synthetic',profile:{name:'合成来源称呼'},operations:{responseStatus:'attending',participationForms:['speaker','organizer'],owner:'合成负责人',sessionIds:['session_one'],boothIds:['booth_one'],sessionRoles:[{sessionId:'session_one',roles:['speaker','organizer']}]}};
  const arrangements={contactRevision:7,contentRevision:9,contacts:[contact],conversions:[{registrationId:A,sourceContactId:contact.id}],content:{sessions:[{id:'session_one',title:'合成研讨会',start:'10:00',end:'11:00',status:'scheduled'}],booths:[{id:'booth_one',code:'C-01',organization:'合成展示机构',status:'cancelled'}]}};
  const calls={admissions:0,arrangements:0};
  const api=createRegistrationXlsxApi({enabled:true,auth,store,canExport,loadAdmissions:async()=>{calls.admissions++;return clone(admissions);},loadArrangements:async()=>{calls.arrangements++;return clone(arrangements);}});
  return {api,store,source,admissions,arrangements,calls,base,commits:()=>commits};
}
async function table(bytes,name){return readSheet(Buffer.from(bytes),name,{trim:false});}
function cell(rows,label,index=1){return rows[index][rows[0].indexOf(label)];}

test('registration Excel is real scoped OOXML, preserves withdrawn/waitlisted records and excludes contact fields by default',async()=>{
  const f=fixture(),before=clone(f.source),response=await f.api(request());assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),XLSX_MIME);
  const bytes=Buffer.from(await response.arrayBuffer());assert.equal(digest(bytes),response.headers.get('x-export-sha256'));assert.equal(Number(response.headers.get('content-length')),bytes.length);
  const rows=await table(bytes,'报名与参会');assert.equal(rows.length,4);assert.equal(cell(rows,'姓名'),'=SUM(A1)');assert.equal(cell(rows,'有效参会状态',2),'waitlisted');assert.equal(cell(rows,'有效参会状态',3),'withdrawn');
  assert.equal(rows[0].includes('邮箱'),false);assert.doesNotMatch(bytes.toString(),/synthetic@example.invalid|SYNTHETIC_PRIVATE_WECHAT|permissionReference/u);assert.equal(f.calls.arrangements,0);assert.deepEqual(f.source,before);
  const audit=(await f.base.read()).value.audit[0];assert.equal(audit.action,'export');assert.equal(audit.metadata.format,'xlsx');assert.equal(audit.metadata.workbookSha256,digest(bytes));assert.equal(audit.metadata.count,3);
  assert.deepEqual(audit.metadata.sourceRevisions,{applications:3,admissions:3,contacts:null,content:null});assert.equal((await f.store.list()).revision,1);
});
test('explicit contact, original-answer and arrangement scopes stay separate and preserve actual per-session roles',async()=>{
  const f=fixture(),response=await f.api(request(undefined,{body:{expectedRevision:0,includeContact:true,includeAnswers:true,includeArrangements:true}}));assert.equal(response.status,200);
  const bytes=Buffer.from(await response.arrayBuffer()),rows=await table(bytes,'报名与参会'),duties=await table(bytes,'当前参与职责与安排'),answers=await table(bytes,'已保存原始回答');
  assert.equal(cell(rows,'邮箱'),'synthetic@example.invalid');assert.equal(cell(rows,'团队'),'合成团队');assert.match(cell(duties,'逐场次职责'),/合成研讨会：讲者 \/ 研讨会组织者/u);assert.match(cell(duties,'展位与组织'),/已取消/u);assert.equal(cell(answers,'background'),'合成原回答');
  assert.equal(cell(rows,'原参与意向'),'attend');assert.equal(cell(duties,'实际参与角色'),'讲者 / 研讨会组织者');assert.equal(f.calls.arrangements,1);
  const meta=(await f.base.read()).value.audit[0].metadata;assert.equal(meta.contactIncluded,true);assert.equal(meta.answersIncluded,true);assert.equal(meta.arrangementsIncluded,true);assert.deepEqual(meta.sourceRevisions,{applications:3,admissions:3,contacts:7,content:9});
});
test('both Excel views preserve explicit organization membership roles and orphan history without inferring employers',async()=>{
  const f=fixture(),contact=f.arrangements.contacts[0];
  contact.operations.organizationMemberships=[{organizationId:'organization_one',role:'lead',title:'合成联络负责人'},
    {organizationId:'organization_missing',role:'member',title:''}];
  f.arrangements.content.organizations=[{id:'organization_one',name:'=SUM(A1)',status:'withdrawn'},
    {id:'organization_unlinked',name:'合成来源称呼',status:'confirmed'}];
  const original=clone(f.arrangements),response=await f.api(request(undefined,{body:{expectedRevision:0,includeArrangements:true}}));
  assert.equal(response.status,200);
  const arrangements=await table(await response.arrayBuffer(),'当前参与职责与安排');
  const expected='=SUM(A1) · 负责人 · 合成联络负责人 · 组织已退出\norganization_missing · 历史组织已不存在 · 成员';
  assert.equal(cell(arrangements,'已关联参与组织与成员职责'),expected);
  assert.equal(cell(arrangements,'已关联参与组织与成员职责',2),null,'an unlinked registration does not inherit a matching employer');
  const bytes=contactsWorkbook({contacts:[{...contact,source:{rowId:'1'}}],content:f.arrangements.content,
    contactRevision:7,contentRevision:9,exportedAt:AT});
  const contacts=await table(bytes,'全部筹备人员');
  assert.equal(cell(contacts,'已关联参与组织与成员职责'),expected);assert.equal(contacts[0].includes('邮箱'),false);
  assert.deepEqual(f.arrangements,original,'exports never rewrite source relationships');
});
test('review withdrawal does not remove raw data and is never exported as a valid admission during a release gap',async()=>{
  const f=fixture(),detail=await f.store.detail(A),review={...detail.review,status:'withdrawn'};delete review.deletionRequested;
  await f.store.saveReview(A,0,review,'synthetic-staff');
  const response=await f.api(request(undefined,{body:{expectedRevision:1,filters:{status:'withdrawn'}}}));assert.equal(response.status,200);const rows=await table(await response.arrayBuffer(),'报名与参会');
  assert.equal(rows.length,2);assert.equal(cell(rows,'有效参会状态'),'withdrawn');assert.equal(cell(rows,'名额索引状态'),'confirmed');assert.equal(f.source.length,3);assert.equal((await f.store.detail(A)).registration.fields.name,'=SUM(A1)');
});
test('independent export requests compete on one review revision and the unknown audit ACK never returns private bytes',async()=>{
  const f=fixture(),outcomes=await Promise.all([f.api(request()),f.api(request())]);assert.deepEqual(outcomes.map(response=>response.status).sort(),[200,409]);assert.equal((await f.base.read()).value.audit.length,1);
  const uncertain=fixture({unknownAck:true}),response=await uncertain.api(request());assert.equal(response.status,503);assert.match(response.headers.get('content-type'),/application\/json/u);assert.doesNotMatch(await response.text(),/SYNTHETIC_PRIVATE|synthetic@example|PK/u);assert.equal(uncertain.commits(),1);assert.equal((await uncertain.base.read()).value.audit.length,1);
});
test('role, scope, Origin, CSRF and bounded JSON gates execute before any private source load',async()=>{
  const f=fixture();
  for(const options of [{role:'editor'},{role:'outreach'},{role:'reviewer'},{origin:'https://foreign.example.invalid'},{csrf:'wrong'}])assert.equal((await f.api(request(undefined,options))).status,403);
  assert.equal((await f.api(request('/api/admin/registrations/export.xlsx?includeContact=true'))).status,404);
  assert.equal((await f.api(request(undefined,{body:{expectedRevision:0,recipient:'private@example.invalid'}}))).status,400);
  assert.equal((await f.api(request(undefined,{headers:{'Content-Encoding':'gzip'}}))).status,415);
  assert.equal((await f.api(request(undefined,{body:{expectedRevision:0,filters:{query:'x'.repeat(20000)}}}))).status,413);assert.deepEqual(f.calls,{admissions:0,arrangements:0});
  const granted=fixture({canExport:()=>true});assert.equal((await granted.api(request(undefined,{role:'reviewer',body:{expectedRevision:0,includeContact:true}}))).status,403);
  assert.equal((await granted.api(request(undefined,{role:'reviewer',body:{expectedRevision:0,includeArrangements:true}}))).status,403);assert.equal(granted.calls.admissions,0);
  assert.equal((await granted.api(request(undefined,{role:'reviewer'}))).status,200);assert.equal(granted.calls.arrangements,0);
});
test('mismatched admission revision and missing people fail before an export audit can claim a complete workbook',async()=>{
  const f=fixture();f.admissions.revision=4;assert.equal((await f.api(request())).status,409);assert.equal(f.commits(),0);
  f.admissions.revision=3;f.admissions.people.pop();assert.equal((await f.api(request())).status,503);assert.equal(f.commits(),0);
});
test('legacy CSV export audit remains readable beside the richer XLSX event',async()=>{
  const f=fixture();await f.store.exportCsv(0,{},'synthetic-staff');assert.equal((await f.api(request(undefined,{body:{expectedRevision:1}}))).status,200);
  const state=(await f.base.read()).value;assert.equal(state.audit.length,2);assert.deepEqual(state.audit[0].metadata,{count:3,contactIncluded:false,filterNames:[]});assert.equal((await f.store.list()).revision,2);
});
test('separate contacts Excel includes unconverted and declined people, preserves sources and records a global audit',async()=>{
  const objects=memoryObjects(),content=createInitialContent(),journal=createObjectJournal({objects,prefix:'cms/v1/contacts'}),store=createOssContactsStore({journal,contentStore:{read:async()=>({draft:{content}})},now:()=>Date.parse(AT)});
  const first=await store.createContact(0,{name:'合成未代登记者',organization:'合成机构',email:'synthetic@example.invalid',contactConsent:'consented'},'synthetic-staff');
  await store.createContact(1,{name:'合成拒绝者',organization:'合成机构',contactConsent:'declined'},'synthetic-staff');
  const session=content.sessions[0];await store.saveOperations(first.contact.id,2,{...first.contact.operations,participationForms:['speaker','organizer'],sessionIds:[session.id],sessionRoles:[{sessionId:session.id,roles:['speaker','organizer']}]},'synthetic-staff');
  await store.saveProfile(first.contact.id,3,{name:'合成更正姓名'},'synthetic-staff');
  const before=await store.read();let loads=0;
  const api=createContactsXlsxApi({enabled:true,auth,contactsStore:store,loadContent:async()=>{loads++;return {revision:5,content};},clock:()=>Date.parse(AT)});
  assert.equal((await api(request('/api/admin/contacts/export.xlsx',{role:'reviewer',body:{expectedRevision:4}}))).status,403);assert.equal(loads,0);
  const response=await api(request('/api/admin/contacts/export.xlsx',{role:'outreach',body:{expectedRevision:4,includeContact:true,includeAnswers:true}}));assert.equal(response.status,200);
  const bytes=Buffer.from(await response.arrayBuffer()),rows=await table(bytes,'全部筹备人员');assert.equal(rows.length,3);assert.equal(cell(rows,'姓名'),'合成更正姓名');assert.equal(cell(rows,'联络授权',2),'declined');assert.match(cell(rows,'逐场次职责'),/研讨会组织者/u);
  const original=await table(bytes,'首次保存原件');assert.equal(cell(original,'name'),'合成未代登记者');assert.equal(cell(original,'email'),'synthetic@example.invalid');
  const after=await store.read();assert.equal(after.revision,5);assert.deepEqual(after.contacts,before.contacts);const event=(await journal.read()).value.audit.at(-1);assert.equal(event.action,'export_contacts');assert.equal(event.workbookSha256,digest(bytes));
  assert.equal((await api(request('/api/admin/contacts/export.xlsx',{role:'outreach',body:{expectedRevision:4}}))).status,409);
});
