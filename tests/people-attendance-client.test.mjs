import test from 'node:test';
import assert from 'node:assert/strict';
import {personWorkspaceView,personAttendanceView,personNextAction} from '../src/lib/person-workspace.mjs';
import {validatePeopleDirectory,createPeopleNavigation} from '../src/lib/people-directory.mjs';
import {personAttendanceStage} from '../shared/organizer-progress.mjs';
import {fixture} from './person-workspace-fixture.mjs';

test('selected-person attendance is a closed safe projection and old replies never become confirmation from a reserved place',async()=>{
  const f=fixture(),{body}=await f.read();assert.equal(body.attendance.key,'awaiting');
  const view=personWorkspaceView(body,body.selected);assert.equal(personAttendanceView(view).key,'awaiting');
  const legacy=structuredClone(body);delete legacy.attendance;
  assert.equal(personAttendanceView(personWorkspaceView(legacy,legacy.selected)).key,'awaiting');
  legacy.registration.provenance.kind='public';
  assert.equal(personAttendanceView(personWorkspaceView(legacy,legacy.selected)).key,'invited','validated public provenance is explicit self-registration proof; current formal acceptance stays independent');
  for(const patch of[{label:'已送达'},{key:'invented'},{warning:'RAW_PROVIDER_BODY'},{recipient:'private@example.invalid'}]){
    const invalid=structuredClone(body);invalid.attendance={...invalid.attendance,...patch};assert.equal(personWorkspaceView(invalid,invalid.selected),null);
  }
});

test('old-recipient unknown remains a visible warning and check action without suppressing proven current acceptance',async()=>{
  const f=fixture();f.data.contacts.contacts[0].operations.responseStatus='attending';
  f.data.registration.registration.profileCorrection={revision:8,accessRevision:1};
  const at='2026-10-21T00:00:00.000Z',old={id:'old-recipient-unknown',kind:'registration',status:'unknown',admissionStatus:'confirmed',attempt:1,createdAt:at,updatedAt:at,currentRecipient:false};
  f.data.confirmations.notices=[old];let{body}=await f.read();
  assert.equal(body.attendance.key,'confirmed');assert.equal(body.attendance.invitationLabel,'');assert.match(body.attendance.warning,/待核对.*勿重寄/u);assert.equal(personNextAction(body,['superadmin']).key,'check');
  f.data.confirmations.notices.push({...old,id:'current-recipient-accepted',status:'provider_accepted',currentRecipient:true});({body}=await f.read());
  assert.equal(body.attendance.key,'invited');assert.match(body.attendance.invitationLabel,/服务已接收.*未证明送达/u);assert.match(body.attendance.warning,/待核对.*勿重寄/u);assert.equal(personNextAction(body,['superadmin']).key,'check');
  const legacy=structuredClone(body);delete legacy.attendance;const view=personWorkspaceView(legacy,legacy.selected);assert.equal(personAttendanceView(view).key,'invited');assert.match(personAttendanceView(view).warning,/待核对/u);
});

test('attendance filters persist within the same tab while legacy navigation stays readable and malformed filter values fail closed',()=>{
  const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const nav=createPeopleNavigation({storage,eventId:'synthetic-event',clock:()=>1000}),user={id:'synthetic-owner',roles:['reviewer']};
  const input={view:'all',query:'合成查询',work:'all',attendance:'invited',cursor:'',trail:[],revision:'a'.repeat(64),ids:['registration:'+'a'.repeat(43)],selected:'registration:'+'a'.repeat(43),focus:'registration:'+'a'.repeat(43),scrollY:300};
  assert.equal(nav.save(user,input),true);assert.equal(nav.read(user).attendance,'invited');
  assert.equal(nav.save(user,{...input,attendance:'unknown-provider-value'}),false);
  const legacy={...input};delete legacy.attendance;assert.equal(nav.save(user,legacy),true);assert.ok(nav.read(user));
});
