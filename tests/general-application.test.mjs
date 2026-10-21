import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGeneralApplicationFields } from '../shared/general-application.mjs';
import { validateRegistrationSubmission } from '../functions/registration-api/validation.mjs';
import { registrationFields } from '../src/lib/registration-fields.mjs';
import { createRegistrationReviewStore,registrationFilters } from '../functions/registration-admin/store.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';

const AT='2026-10-21T08:00:00.000Z',EVENT='synthetic-general-2026';
const fields=()=>({intake:'general-v2',name:'合成学生',email:'synthetic@example.invalid',categories:['student'],participationInterests:['attend']});
const policy={enabled:true,eventId:EVENT,opensAt:'2026-10-01T00:00:00+08:00',closesAt:'2026-12-05T12:00:00+08:00',privacy:{version:'privacy-2026-v1',processor:'合成处理者',contactEmail:'privacy@example.invalid',purpose:'合成申请',storageRegion:'合成地区',retention:'合成期限',rightsRequest:'合成权利申请',sharing:'合成范围'}};
const payload=source=>({eventId:EVENT,fields:source,consent:{accepted:true,version:policy.privacy.version}});
const validate=source=>validateRegistrationSubmission(payload(source),{policy,now:AT});
test('one student application stays sparse without inventing answers to removed questions',()=>{
  const value=validate(fields());assert.equal(value.valid,true);assert.deepEqual(value.value.fields,fields());
  for(const key of ['city','organization','wechat','attendance','accommodationChoice','accommodationNights','cooperationInterest','cooperationForms','position','background'])assert.equal(Object.hasOwn(value.value.fields,key),false,key);
  assert.deepEqual(registrationFields({...fields(),consentAccepted:true}),fields());
});
test('identity is one explicit choice and never activates a legacy organizer questionnaire',()=>{
  for(const identity of ['student','so','ro','new_site','industry','education','partner','other'])assert.equal(validate({...fields(),categories:[identity]}).valid,true,identity);
  for(const categories of [[],['student','industry'],'student',['unknown'],[null]])assert.equal(validate({...fields(),categories}).valid,false);
});
test('optional proposal belongs to the same applicant and only topic and summary are accepted',()=>{
  const source={...fields(),participationInterests:['attend','talk'],speaker:{topic:'合成主题',summary:'合成摘要\n第二行'}};assert.equal(validate(source).valid,true);assert.deepEqual(validate(source).value.fields,source);
  for(const change of [value=>{delete value.speaker;},value=>{value.speaker.topic='';},value=>{value.speaker.language='中文';},value=>{value.speaker.extra='hidden';},value=>{value.participationInterests=['talk'];},value=>{value.participationInterests=['attend','talk','exhibition'];},value=>{value.participationInterests=['attend'];}]){const input=structuredClone(source);change(input);assert.equal(validate(input).valid,false);}
});
test('new intake strictly rejects extra policy, status, unknown marker and malformed fields',()=>{
  for(const change of [value=>{value.admissionStatus='confirmed';},value=>{value.attendance='expected';},value=>{value.accommodationChoice='not_needed';},value=>{value.cooperationInterest='none';},value=>{value.intake='future-v9';},value=>{value.email='not-email';},value=>{value.name='单';},value=>{value.organization=3;},value=>{value.wechat='bad\nline';},value=>{value.name='\ud800';}]){const input=fields();change(input);assert.equal(validate(input).valid,false);}
  const noConsent=payload(fields());noConsent.consent.accepted=false;assert.equal(validateRegistrationSubmission(noConsent,{policy,now:AT}).valid,false);
});
test('general field validator rejects accessor and malformed arrays without invoking accessors',()=>{
  let invoked=false;const input=fields();Object.defineProperty(input,'name',{get(){invoked=true;return'private';},enumerable:true});assert.equal(validateGeneralApplicationFields(input).valid,false);assert.equal(invoked,false);
  const categories=[];Object.defineProperty(categories,0,{get(){invoked=true;return'student';},enumerable:true});categories.length=1;assert.equal(validateGeneralApplicationFields({...fields(),categories}).valid,false);assert.equal(invoked,false);
});
test('optional text is normalized, empty fields omitted and bounds enforced before persistence',()=>{
  const input={...fields(),name:' 合成学生 ',organization:'  合成学校 ',city:'',wechat:'  合成微信  '};const checked=validate(input);assert.equal(checked.valid,true);assert.deepEqual(checked.value.fields,{...fields(),organization:'合成学校',wechat:'合成微信'});
  assert.equal(validate({...fields(),organization:'字'.repeat(161)}).valid,false);assert.equal(validate({...fields(),email:'x'.repeat(250)+'@example.invalid'}).valid,false);
});
test('legacy full public validation remains required when no intake marker is supplied',()=>{
  const legacy={name:'合成来宾',city:'合成城市',organization:'合成机构',position:'合成角色',email:'legacy@example.invalid',categories:['industry'],participationInterests:['attend'],attendance:'expected',accommodationChoice:'not_needed',cooperationInterest:'none'};
  assert.equal(validate(legacy).valid,true);delete legacy.city;assert.equal(validate(legacy).valid,false);
});
test('review reader supports mixed sparse/student and legacy records without adding source answers',async()=>{
  const sparse={id:'s'.repeat(43),referenceCode:'s'.repeat(43),eventId:EVENT,submittedAt:AT,fields:fields(),consent:{accepted:true,version:policy.privacy.version,acceptedAt:AT},provenance:{kind:'public'}};
  const legacy={...structuredClone(sparse),id:'l'.repeat(43),referenceCode:'l'.repeat(43),fields:{name:'旧完整申请',city:'合成城市',categories:['industry'],participationInterests:['attend'],attendance:'expected',accommodationChoice:'not_needed'}};
  const objects=memoryObjects(),journal=createObjectJournal({objects,prefix:'cms/v1/registration-reviews/'+EVENT});const store=createRegistrationReviewStore({journal,eventId:EVENT,clock:()=>Date.parse(AT),loadRegistrations:async()=>({revision:2,registrations:[sparse,legacy]})});
  const list=await store.list({filters:{category:'student'}});assert.equal(list.total,1);assert.equal(list.overallTotal,2);assert.equal(list.registrations[0].fields.intake,'general-v2');assert.equal(list.registrations[0].fields.accommodationChoice,undefined);assert.equal(list.stats.byAttendance.unknown,1);
  const detail=await store.detail(sparse.id);assert.deepEqual(detail.registration.fields,fields());assert.equal(detail.review.accommodationStatus,'not_requested');assert.deepEqual(registrationFilters({category:'student'}),{category:'student'});assert.equal(objects.files.size,0);
  sparse.fields.accommodationChoice='not_needed';await assert.rejects(store.list(),{code:'STORAGE_UNAVAILABLE'});
});
