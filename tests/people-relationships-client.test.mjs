import test from 'node:test';
import assert from 'node:assert/strict';
import { validateImportedContact, createEmptyContactOperations } from '../shared/contacts-schema.mjs';
import { peopleRelationships, organizationMemberships, relationshipForContact, matchesPeopleRelationships, parseOrganizationSelection, savedContactReceipt, conversionPreview, conversionReceipt, admissionForContact, privateResponseAction, attendancePresentation, profilePublicationPresentation } from '../src/lib/people-relationships.mjs';

const registrationId='r'.repeat(43),referenceCode='c'.repeat(43);
function contact(){const {sourceRowId,...profile}=validateImportedContact({sourceRowId:'synthetic-1',name:'合成人员',displayName:'合成称呼',organization:'同名组织',email:'fixture@example.invalid',categories:['so'],interests:['talk'],contactConsent:'consented'}).value;return{id:'contact_1',source:{key:'synthetic',rowId:sourceRowId,digest:'a'.repeat(64),importedAt:'2026-10-21T00:00:00Z'},profile,operations:createEmptyContactOperations(),invitation:{generatedAt:null,settings:null,sentAt:null,channel:null,sentGenerationAt:null},createdAt:'2026-10-21T00:00:00Z',updatedAt:'2026-10-21T00:00:00Z'};}
function catalog(){return{schemaVersion:1,contentRevision:8,publishedRevision:5,organizations:[{id:'org_1',name:'同名组织',status:'confirmed',participation:'exhibitor'},{id:'org_2',name:'同名组织',status:'withdrawn',participation:'attendee'}],profiles:[{id:'guest_1',contactId:'contact_1',publicRoles:['speaker','guest'],status:'confirmed',publicConsent:true,hasPortrait:false,published:true,publishedMatchesDraft:false}],boothOrganizations:[{boothId:'booth_1',organizationId:'org_1'}],publicationAttributionUnavailable:false};}
test('relationship projection retains exact IDs and strips private unrelated source fields',()=>{
  const value=catalog();value.privateNotes='never copy';value.organizations[0].members=['private'];value.profiles[0].name='do not copy';const parsed=peopleRelationships(value);assert.equal(parsed.privateNotes,undefined);assert.equal(parsed.organizations[0].members,undefined);assert.equal(parsed.profiles[0].name,undefined);assert.notEqual(parsed.organizations[0].id,parsed.organizations[1].id);
});
test('malformed catalog fails closed rather than claiming no profiles or organizations',()=>{
  for(const mutate of [v=>{delete v.publicationAttributionUnavailable;},v=>{v.publishedRevision=null;},v=>{v.profiles[0].publicRoles=['host'];},v=>{v.profiles.push({...v.profiles[0],id:'other'});},v=>{v.organizations[0].name='';},v=>{v.contentRevision='8';},v=>{v.boothOrganizations[0].organizationId='Name With Spaces';}]){const value=catalog();mutate(value);assert.throws(()=>peopleRelationships(value));}
});
test('membership validation preserves historical ID and rejects duplicates, free text and overflow',()=>{
  assert.deepEqual(organizationMemberships([{organizationId:'missing_org',role:'lead',title:'合成职务😀'}]),[{organizationId:'missing_org',role:'lead',title:'合成职务😀'}]);
  for(const value of [[{organizationId:'机构名称',role:'member',title:''}],[{organizationId:'org_1',role:'speaker',title:''}],[{organizationId:'org_1',role:'member',title:'line\nbreak'}],Array.from({length:21},(_,i)=>({organizationId:'org_'+i,role:'member',title:''})),[{organizationId:'org_1',role:'member',title:''},{organizationId:'org_1',role:'lead',title:''}]])assert.throws(()=>organizationMemberships(value));
});
test('directory failure is unavailable and suspends negative filters without losing explicit membership',()=>{
  const item=contact();item.operations.organizationMemberships=[{organizationId:'org_1',role:'member',title:''}];const relationship=relationshipForContact(item,null);assert.equal(relationship.available,false);assert.equal(relationship.memberships[0].organizationId,'org_1');assert.equal(relationship.memberships[0].state,'unavailable');
  assert.equal(matchesPeopleRelationships(item,null,{organization:'__none',publicState:'unlinked',publicRole:'speaker'}),true);
});
test('organization and public role filters use exact relationships and retain orphan warnings',()=>{
  const item=contact(),source=peopleRelationships(catalog());assert.equal(matchesPeopleRelationships(item,source,{organization:'org_1'}),false,'matching organization text does not create membership');item.operations.organizationMemberships=[{organizationId:'org_2',role:'lead',title:''},{organizationId:'missing',role:'member',title:''}];
  assert.equal(matchesPeopleRelationships(item,source,{organization:'org_2',publicRole:'speaker',publicState:'changed'}),true);assert.equal(matchesPeopleRelationships(item,source,{organization:'org_1'}),false);assert.equal(matchesPeopleRelationships(item,source,{publicState:'unlinked'}),false);
  assert.deepEqual(relationshipForContact(item,source).memberships.map(row=>row.state),['withdrawn','missing']);
});
test('unattributed publication is excluded from unpublished filters while exact positive facts remain usable',()=>{
  const source=peopleRelationships({...catalog(),publicationAttributionUnavailable:true}),item=contact();assert.equal(matchesPeopleRelationships(item,source,{publicState:'unpublished'}),false);assert.equal(matchesPeopleRelationships(item,source,{publicRole:'organizer',publicState:'unpublished'}),false);assert.equal(matchesPeopleRelationships(item,source,{publicState:'published'}),true);
});
test('actual guest ID publication remains visible while current identity and contents await verification',()=>{
  const source=peopleRelationships(catalog()),item=contact();assert.equal(relationshipForContact(item,source).profiles[0].published,true);assert.equal(matchesPeopleRelationships(item,source,{publicState:'published'}),true);assert.equal(matchesPeopleRelationships(item,source,{publicState:'changed'}),true);
  source.profiles[0].publishedMatchesDraft=true;assert.equal(matchesPeopleRelationships(item,source,{publicState:'published'}),true);assert.equal(matchesPeopleRelationships(item,source,{publicState:'changed'}),false);
});
test('same-session expiry clears private data before stale selection checks; old-account expiry is ignored',()=>{
  let checked=0;const stale=()=>{checked++;return false;};
  for(const status of [401,403])assert.equal(privateResponseAction({requestGeneration:4,currentGeneration:4,status,selectionCurrent:stale}),'clear_session');assert.equal(checked,0);
  for(const status of [200,401,403])assert.equal(privateResponseAction({requestGeneration:3,currentGeneration:4,status,selectionCurrent:stale}),'ignore_session');assert.equal(checked,0);
  assert.equal(privateResponseAction({requestGeneration:4,currentGeneration:4,status:200,selectionCurrent:stale}),'ignore_selection');assert.equal(checked,1);
  assert.equal(privateResponseAction({requestGeneration:4,currentGeneration:4,status:200}),'accept');assert.equal(privateResponseAction({requestGeneration:4,currentGeneration:4,status:401,login:true}),'accept');
});
test('organization deep links contain only bounded stable identifiers',()=>{
  assert.equal(parseOrganizationSelection('#organization=org_1'),'org_1');for(const hash of ['#organization=同名组织','#organization=org_1&contact=contact_1','#organization=fixture@example.invalid','#organization=%ED%A0%80','#guest=org_1'])assert.equal(parseOrganizationSelection(hash),null);
});
test('saved contact requires exact reply ACK and independent valid admission receipt',()=>{
  const item=contact();item.operations.responseStatus='attending';const operations=structuredClone(item.operations),pending={contactId:item.id,expectedRevision:4,operations};const value={replySaved:true,revision:5,contact:item,admission:{status:'confirmed',registrationId,referenceCode,revision:30,privateKey:'never copy'}};
  const receipt=savedContactReceipt(value,pending);assert.equal(receipt.admission.status,'confirmed');assert.equal(receipt.admission.privateKey,undefined);
  for(const mutate of [v=>{delete v.replySaved;},v=>{v.revision=6;},v=>{v.contact.id='foreign';},v=>{v.contact.operations.owner='changed';},v=>{delete v.contact.profile;},v=>{v.admission.registrationId='bad';},v=>{v.admission.referenceCode='bad';},v=>{delete v.admission;},v=>{v.admission.status='sent';}]){const input=structuredClone(value);mutate(input);assert.throws(()=>savedContactReceipt(input,pending));}
  const unavailable=structuredClone(value);unavailable.admission={status:'unavailable',reason:'STORAGE_UNAVAILABLE'};assert.deepEqual(savedContactReceipt(unavailable,pending).admission,{status:'unavailable'});
});
test('attendance reply never becomes an admission or releases withdrawn registration in the browser',()=>{
  const item=contact();item.operations.responseStatus='attending';assert.equal(admissionForContact(item,null).status,'unavailable');assert.equal(admissionForContact(item,{conversions:[]}).status,'unlinked');const intent={conversions:[{sourceContactId:item.id,registrationId,admissionStatus:'withdrawn'}]};assert.equal(admissionForContact(item,intent).status,'withdrawn');item.operations.responseStatus='declined';intent.conversions[0].admissionStatus='confirmed';assert.equal(admissionForContact(item,intent).status,'confirmed');
});
test('conversion preview binds exact selected IDs, revision and bounded explicit batch',()=>{
  const value={contactRevision:4,entries:[{contactId:'contact_1',eligible:true,reason:null,warnings:[]}],summary:{selected:1,eligible:1}};assert.deepEqual(conversionPreview(value,['contact_1'],4).eligibleIds,['contact_1']);for(const [ids,rev]of[[['foreign'],4],[['contact_1'],5],[[],4],[['contact_1','contact_1'],4]])assert.throws(()=>conversionPreview(value,ids,rev));
});
test('conversion receipt partitions exact selections and contains no admission promise',()=>{
  const draft={contactRevision:4,eligibleIds:['contact_1','contact_2']},value={status:'partial',contactRevision:4,registrations:[{contactId:'contact_1',registrationId,referenceCode}],failures:[{contactId:'contact_2',code:'STORAGE_UNAVAILABLE'}],skipped:[]};const result=conversionReceipt(value,draft);assert.equal(result.failureCount,1);assert.equal(result.admission,undefined);
  for(const mutate of [v=>{v.registrations[0].contactId='foreign';},v=>{v.failures[0].contactId='contact_1';},v=>{v.failures=[];},v=>{v.status='completed';},v=>{v.contactRevision=5;},v=>{v.registrations[0].referenceCode='bad';}]){const input=structuredClone(value);mutate(input);assert.throws(()=>conversionReceipt(input,draft));}
});


test('attendance colors describe only the personal reply, never infer guest status or admission',()=>{
  assert.deepEqual(attendancePresentation('attending'),{label:'已确认出席',tone:'positive'});
  assert.deepEqual(attendancePresentation('pending'),{label:'未确认出席',tone:'negative'});
  assert.deepEqual(attendancePresentation('declined'),{label:'不出席',tone:'negative'});
  for(const status of [undefined,null,'confirmed','provider_accepted'])assert.deepEqual(attendancePresentation(status),{label:'出席回复待核对',tone:'neutral'});
});

test('public presentation keeps live snapshots green through updates and withdrawals; missing knowledge stays neutral',()=>{
  const profile=catalog().profiles[0];
  let status=profilePublicationPresentation(profile);assert.equal(status.tone,'positive');assert.equal(status.label,'已公开');assert.equal(status.change,'updated');assert.match(status.detail,/历史公开版本.*待核对/u);
  profile.publicConsent=false;status=profilePublicationPresentation(profile);assert.equal(status.tone,'positive');assert.equal(status.change,'removed');assert.equal(status.changeLabel,'待撤下');assert.deepEqual(status.reasons,['待核实公开授权']);
  profile.published=false;status=profilePublicationPresentation(profile);assert.equal(status.tone,'negative');assert.equal(status.label,'未公开');assert.equal(status.change,'blocked');
  assert.equal(profilePublicationPresentation(profile,{known:false}).tone,'neutral');assert.equal(profilePublicationPresentation(null).tone,'neutral');
});

test('a confirmed consented profile needs neither photo nor public role to be ready or synchronized',()=>{
  const profile={...catalog().profiles[0],publicRoles:[],hasPortrait:false,published:false};
  let status=profilePublicationPresentation(profile);assert.equal(status.ready,true);assert.equal(status.change,'new');assert.deepEqual(status.reasons,[]);assert.deepEqual(status.suggestions,['照片可稍后补充','公开职责可稍后补充']);
  const source=peopleRelationships({...catalog(),profiles:[profile]}),item=contact();assert.equal(matchesPeopleRelationships(item,source,{publicState:'ready'}),true);assert.equal(matchesPeopleRelationships(item,source,{publicState:'blocked'}),false);assert.equal(matchesPeopleRelationships(item,source,{publicState:'unpublished'}),true);
  profile.published=true;profile.publishedMatchesDraft=true;status=profilePublicationPresentation(profile);assert.equal(status.change,'unchanged');assert.equal(status.label,'已公开');
  source.profiles[0].status='pending';assert.equal(matchesPeopleRelationships(item,source,{publicState:'blocked'}),true);assert.equal(matchesPeopleRelationships(item,source,{publicState:'ready'}),false);
});


test('unpublished filter requires known publication metadata and an existing linked profile',()=>{
  const item=contact(),source=peopleRelationships(catalog());source.profiles[0].published=false;
  assert.equal(matchesPeopleRelationships(item,source,{publicState:'unpublished'}),true);
  assert.equal(profilePublicationPresentation(source.profiles[0]).tone,'negative');
  source.publicationAttributionUnavailable=true;
  assert.equal(matchesPeopleRelationships(item,source,{publicState:'unpublished'}),false);
  assert.equal(profilePublicationPresentation(source.profiles[0],{known:false}).tone,'neutral');
  assert.equal(matchesPeopleRelationships(item,null,{publicState:'unpublished'}),false);
  source.publicationAttributionUnavailable=false;source.profiles=[];
  assert.equal(matchesPeopleRelationships(item,source,{publicState:'unpublished'}),false,'unlinked is separate from a known unpublished profile');
});

test('an unrelated orphan does not erase a linked guest ID that the server positively found published',()=>{
  const profile=catalog().profiles[0],status=profilePublicationPresentation(profile,{known:false});
  assert.equal(status.label,'已公开');assert.equal(status.tone,'positive');assert.equal(status.change,'updated');assert.match(status.detail,/历史公开版本.*待核对/u);
});
