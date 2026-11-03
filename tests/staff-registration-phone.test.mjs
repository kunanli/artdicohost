import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateStaffRegistrationFields,validateRegistrationSubmission} from '../functions/registration-api/validation.mjs';
import {registrationSchema} from '../shared/registration-schema.mjs';
import {registrationJson} from '../functions/registration-api/repository.mjs';
import {peopleRuntimeFixture} from './helpers/people-runtime-fixture.mjs';

const actor={id:'synthetic-phone-staff',roles:['reviewer']};
const staff=(sourceContactId,phone)=>({sourceContactId,actor,requireConfirmed:true,input:{fields:{name:'合成电话来宾',email:'synthetic.phone@example.invalid',...(phone===undefined?{}:{phone})},permissionReference:'合成已核实来源授权'}});

test('staff phone stays optional private text with leading zero and country prefix, bounded at 150 characters',()=>{
  const legacy={name:'合成旧来宾',wechat:'synthetic-contact'};
  assert.deepEqual(validateStaffRegistrationFields(legacy).value,legacy);
  for(const phone of['+852 0012 3456','0086 001 2345','0'.repeat(150),'']){
    const result=validateStaffRegistrationFields({...legacy,phone});assert.equal(result.valid,true);assert.equal(result.value.phone,phone);
  }
  for(const phone of[null,12345,false,{},[],'0'.repeat(151),'123\n456','123\t456','123\u0000456','\ud800']){
    const result=validateStaffRegistrationFields({...legacy,phone});assert.equal(result.valid,false);assert.ok(result.errors['fields.phone']);
  }
  assert.equal(validateStaffRegistrationFields({name:'只有电话',phone:'+86 00123'}).valid,false,'phone does not replace the existing email or WeChat permission boundary');
});

test('confirmed-only staff records retain phone after restart without returning it in the receipt or using it as identity',async()=>{
  const f=await peopleRuntimeFixture({capacity:3}),phone='+852 0012 3456';
  const first=await f.app.registrationService.submitStaffRegistration(staff('synthetic-phone-a',phone));assert.equal(first.outcome,'created');
  const second=await f.app.registrationService.submitStaffRegistration(staff('synthetic-phone-b',phone));assert.equal(second.outcome,'created');
  assert.notEqual(first.receipt.registrationId,second.receipt.registrationId,'only the explicit source identity joins a staff intake');
  const restarted=f.make(),rows=(await restarted.registrationService.repository.list()).registrations;assert.equal(rows.length,2);assert.ok(rows.every(row=>row.fields.phone===phone));
  assert.doesNotMatch(JSON.stringify([first,second]),/00852|0012 3456|synthetic.phone@example/u);
  const replay=await restarted.registrationService.submitStaffRegistration(staff('synthetic-phone-a',phone));assert.equal(replay.outcome,'replayed');assert.equal(replay.receipt.registrationId,first.receipt.registrationId);
  const changed=await restarted.registrationService.submitStaffRegistration(staff('synthetic-phone-a','0086 00001'));assert.equal(changed.outcome,'conflict','an existing source cannot silently replace the original phone');
  assert.equal(f.messages.length,0);
});

test('the contact conversion mapper preserves private phone through staff registration while directory projection omits it',async()=>{
  const f=await peopleRuntimeFixture(),phone='0086 00 12345',created=await f.createContact({name:'合成电话来源',phone});
  const converted=await f.app.intentService.convertContacts({actor:f.users[0],contactIds:[created.contact.id],expectedContactRevision:created.revision,permissionReference:'合成现有联络许可'});
  assert.equal(converted.status,'completed');const id=converted.registrations[0].registrationId;
  const record=(await f.make().registrationService.repository.list()).registrations.find(row=>row.id===id);assert.equal(record.fields.phone,phone);
  const headers=await f.login(),person=await(await f.app.handle(f.request('/api/admin/people/registrations/'+id,{headers}))).json();assert.equal(person.registration.fields.phone,phone);
  const directory=await(await f.app.handle(f.request('/api/admin/people/directory',{headers}))).json();assert.doesNotMatch(JSON.stringify(directory),/0086 00 12345/u);
  const internal=await f.app.reviewStore.healthDirectory();assert.equal(Object.hasOwn(internal.registrations[0].fields,'phone'),false,'new registration phone is not added to comparison fields');
  assert.equal(f.messages.length,0);
});

test('stored staff phone reader accepts older missing fields and rejects malformed present phone with valid object hashes',async()=>{
  const f=await peopleRuntimeFixture(),service=f.app.registrationService;
  await service.submitStaffRegistration(staff('synthetic-stored-phone'));
  const entry=(await service.repository.readIndex()).value.entries[0],original=await service.repository.readRecord(entry);
  assert.equal(Object.hasOwn(original.fields,'phone'),false);
  for(const phone of[undefined,'+86 00123','0'.repeat(150),'',123,null,'1'.repeat(151),'123\r456','\ud800']){
    const value=structuredClone(original);if(phone!==undefined)value.fields.phone=phone;
    const bytes=registrationJson(value),recordHash=createHash('sha256').update(bytes).digest('hex'),candidate={...entry,recordHash};
    await f.objects.putImmutable(service.repository.prefix+'/records/'+recordHash+'.json',bytes,{contentType:'application/json'});
    if(phone===undefined||typeof phone==='string'&&phone.length<=150&&phone!=='123\r456'&&phone!=='\ud800')assert.equal((await service.repository.readRecord(candidate)).fields.phone,phone);
    else await assert.rejects(service.repository.readRecord(candidate),/Registration storage is unavailable/u);
  }
});

test('general-v2 phone stays on its existing validation path while the legacy public base schema is unchanged',()=>{
  const phone='+852 0001 2345',now=Date.parse('2026-10-21T00:00:00Z'),policy={enabled:true,eventId:'synthetic-phone-event',opensAt:'2026-10-01T00:00:00Z',closesAt:'2026-12-05T00:00:00Z',privacy:{version:'phone-notice-v1',processor:'合成处理者',contactEmail:'synthetic@example.invalid',purpose:'合成用途',storageRegion:'合成地区',retention:'合成期限',rightsRequest:'合成权利',sharing:'合成分享'}};
  const checked=validateRegistrationSubmission({eventId:policy.eventId,fields:{intake:'general-v2',name:'合成公开报名',email:'synthetic.public@example.invalid',phone,categories:['student'],participationInterests:['attend']},consent:{accepted:true,version:policy.privacy.version}},{policy,now});
  assert.equal(checked.valid,true);assert.equal(checked.value.fields.phone,phone);assert.equal(registrationSchema.baseFields.some(field=>field.name==='phone'),false);
});
