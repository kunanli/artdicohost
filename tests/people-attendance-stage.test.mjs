import test from 'node:test';
import assert from 'node:assert/strict';
import {PEOPLE_ATTENDANCE_FILTERS,personAttendanceStage,validPersonAttendanceStage} from '../shared/organizer-progress.mjs';

const contact = patch => ({responseStatus:'pending',admissionStatus:'confirmed',contactConsent:'consented',selfRegistered:false,
  currentManualInvitationSent:false,deliveryStatus:'not_sent',invitationStatus:'not_started',sourceUnavailable:false,...patch});
const unknownWarning = '寄送结果待核对，请勿重寄。';

test('attendance grouping exposes fixed filters and safe default facts without inventing confirmation',()=>{
  assert.deepEqual(PEOPLE_ATTENDANCE_FILTERS,['all','awaiting','confirmed','invited','other']);assert.equal(Object.isFrozen(PEOPLE_ATTENDANCE_FILTERS),true);
  const stage=personAttendanceStage();assert.deepEqual(stage,{key:'awaiting',label:'待确认是否出席',invitationLabel:'',warning:''});assert.equal(validPersonAttendanceStage(stage),true);
});

test('a contact needs an attending reply; an admission reservation or any send record does not confirm attendance',()=>{
  for(const patch of [{},{currentManualInvitationSent:true},{deliveryStatus:'provider_accepted'},
    {currentManualInvitationSent:true,deliveryStatus:'provider_accepted'},{invitationStatus:'manually_sent'}]){
    const stage=personAttendanceStage(contact(patch));assert.equal(stage.key,'awaiting');assert.equal(stage.label,'待确认是否出席');assert.equal(validPersonAttendanceStage(stage),true);
  }
  const both=personAttendanceStage(contact({currentManualInvitationSent:true,deliveryStatus:'provider_accepted'}));
  assert.equal(both.invitationLabel,'人工已记录发出；邮件服务已接收，未证明送达');
});

test('an explicitly self-registered public attendee with a confirmed place counts even without a contact',()=>{
  const facts={responseStatus:null,admissionStatus:'confirmed',contactConsent:null,selfRegistered:true,deliveryStatus:'not_sent'};
  assert.equal(personAttendanceStage(facts).key,'confirmed');assert.equal(personAttendanceStage({...facts,deliveryStatus:'provider_accepted'}).key,'invited');
  assert.equal(personAttendanceStage({...facts,selfRegistered:false}).key,'awaiting','staff-created or imported reservations do not imply attendance');
  assert.equal(personAttendanceStage({...facts,admissionStatus:null}).key,'awaiting');
});

test('current invitation evidence is independent from prepared, aggregate and stale invitation history',()=>{
  const facts=contact({responseStatus:'attending',admissionStatus:null});assert.equal(personAttendanceStage(facts).key,'confirmed');
  for(const invitationStatus of ['prepared','manually_sent','provider_accepted','not_started','not_applicable']){
    const stage=personAttendanceStage({...facts,invitationStatus,currentManualInvitationSent:false});assert.equal(stage.key,'confirmed');assert.equal(stage.invitationLabel,'','historical aggregate status is not current send evidence');
  }
  const manual=personAttendanceStage({...facts,currentManualInvitationSent:true});assert.equal(manual.key,'invited');assert.equal(manual.label,'已确认出席并发送邀请函');assert.equal(manual.invitationLabel,'人工已记录发出');
  const formal=personAttendanceStage({...facts,deliveryStatus:'provider_accepted'});assert.equal(formal.key,'invited');assert.equal(formal.invitationLabel,'邮件服务已接收，未证明送达');
});

test('uncertain invitation or formal results preserve attendance facts while warning against another send',()=>{
  for(const responseStatus of ['pending','attending'])for(const invitationStatus of ['unknown','reserved','issuing']){
    const stage=personAttendanceStage(contact({responseStatus,invitationStatus}));assert.equal(stage.key,responseStatus==='attending'?'confirmed':'awaiting');assert.equal(stage.warning,unknownWarning);
  }
  const unknown=personAttendanceStage(contact({responseStatus:'attending',deliveryStatus:'unknown'}));assert.equal(unknown.key,'confirmed');assert.equal(unknown.invitationLabel,'');assert.equal(unknown.warning,unknownWarning);
  const manual=personAttendanceStage(contact({responseStatus:'attending',currentManualInvitationSent:true,deliveryStatus:'unknown'}));assert.equal(manual.key,'invited');assert.equal(manual.invitationLabel,'人工已记录发出');assert.equal(manual.warning,unknownWarning,'known manual evidence coexists with an unresolved formal email');
  const formal=personAttendanceStage(contact({responseStatus:'attending',invitationStatus:'unknown',deliveryStatus:'provider_accepted'}));assert.equal(formal.key,'invited');assert.equal(formal.warning,unknownWarning);
});

test('mail permissions and availability never change an actual reply into an unconfirmed reply',()=>{
  for(const[deliveryStatus,warning]of [['restricted','确认信状态需由审核同事核对。'],['unavailable','确认信状态暂时无法核对。']]){
    const confirmed=personAttendanceStage(contact({responseStatus:'attending',deliveryStatus}));assert.equal(confirmed.key,'confirmed');assert.equal(confirmed.warning,warning);
    assert.equal(personAttendanceStage(contact({deliveryStatus})).key,'awaiting');
    assert.equal(personAttendanceStage(contact({responseStatus:'attending',deliveryStatus,currentManualInvitationSent:true})).key,'invited');
  }
  const unavailable=personAttendanceStage(contact({responseStatus:'attending',deliveryStatus:'provider_accepted',currentManualInvitationSent:true,sourceUnavailable:true}));assert.equal(unavailable.key,'unavailable');assert.equal(unavailable.invitationLabel,'');assert.equal(unavailable.warning,'资料来源暂时无法核对。');
});

test('declines and terminal, waitlist or review decisions override public admission and sent evidence truthfully',()=>{
  const facts=contact({responseStatus:'attending',selfRegistered:true,currentManualInvitationSent:true,deliveryStatus:'provider_accepted'});
  for(const[key,label]of [['withdrawn','已撤回'],['rejected','申请未通过'],['waitlisted','候补'],['pending_review','待审核']]){
    const stage=personAttendanceStage({...facts,admissionStatus:key,sourceUnavailable:true});assert.equal(stage.key,key);assert.equal(stage.label,label);assert.equal(validPersonAttendanceStage(stage),true);
    assert.equal(personAttendanceStage({...facts,admissionStatus:key,responseStatus:'declined'}).key,'declined','an explicit decline is never overridden by admission or delivery');
  }
  for(const patch of [{responseStatus:'declined'},{contactConsent:'declined'}])assert.equal(personAttendanceStage({...facts,...patch}).key,'declined');
});

test('malformed flags and source states fail closed without invoking source accessors or copying private data',()=>{
  for(const bad of [null,[],new Date(),{responseStatus:'yes'},{admissionStatus:'reserved'},{contactConsent:'public'},
    {selfRegistered:'true'},{currentManualInvitationSent:1},{sourceUnavailable:'false'},{deliveryStatus:'delivered'},{invitationStatus:'sent'}]){
    const stage=personAttendanceStage(bad);assert.equal(stage.key,'unavailable');assert.equal(validPersonAttendanceStage(stage),true);
  }
  const accessor=contact();Object.defineProperty(accessor,'responseStatus',{enumerable:true,get(){assert.fail('grouping must not invoke an accessor');}});assert.equal(personAttendanceStage(accessor).key,'unavailable');
  const facts=contact({responseStatus:'attending',rawProvider:'PRIVATE_PROVIDER',email:'PRIVATE_EMAIL',href:'https://example.invalid/PRIVATE'}),before=structuredClone(facts);
  const stage=personAttendanceStage(facts);assert.deepEqual(facts,before);assert.doesNotMatch(JSON.stringify(stage),/PRIVATE|example|rawProvider|email|href/u);
});

test('the attendance DTO validator accepts only the four fixed safe fields and matching labels',()=>{
  const stage=personAttendanceStage(contact({responseStatus:'attending',currentManualInvitationSent:true}));assert.equal(validPersonAttendanceStage(stage),true);
  for(const patch of [{key:'all'},{key:'other'},{key:'invented'},{label:'已确认出席'},{invitationLabel:'邮件已送达'},
    {warning:'PRIVATE_PROVIDER_ERROR'},{warning:null},{extra:'PRIVATE'}, {label:undefined}])assert.equal(validPersonAttendanceStage({...stage,...patch}),false);
  for(const key of Object.keys(stage)){const missing={...stage};delete missing[key];assert.equal(validPersonAttendanceStage(missing),false);}
  const symbol={...stage,[Symbol('PRIVATE')]:true};assert.equal(validPersonAttendanceStage(symbol),false);
  assert.equal(validPersonAttendanceStage({...stage,key:{toString(){assert.fail('validator must not coerce arbitrary field values');}}}),false);
  const accessor={...stage};Object.defineProperty(accessor,'warning',{enumerable:true,get(){assert.fail('validator must not invoke an accessor');}});assert.equal(validPersonAttendanceStage(accessor),false);
  assert.equal(validPersonAttendanceStage(Object.assign(Object.create(null),stage)),true);
});
