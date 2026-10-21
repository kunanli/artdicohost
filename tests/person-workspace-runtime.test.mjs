import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../functions/content-api/auth.mjs';
import { createCloudApplication } from '../functions/cloud-content/runtime.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';

const API='https://api.artdico.host',PUBLIC='https://artdico.host',EVENT='ggj-cn-2026';
const PASSWORD='synthetic-person-workspace-password',SECRET='synthetic-person-workspace-registration-secret';
const passwordHash=await hashPassword(PASSWORD);
const users=[
  {id:'synthetic-owner',username:'synthetic.owner',roles:['editor','publisher','outreach','reviewer','superadmin'],passwordHash},
  {id:'synthetic-outreach',username:'synthetic.outreach',roles:['outreach'],passwordHash},
  {id:'synthetic-reviewer',username:'synthetic.reviewer',roles:['reviewer'],passwordHash},
  {id:'synthetic-editor',username:'synthetic.editor',roles:['editor'],passwordHash},
].map(user=>({...user,label:user.id}));
const policy={enabled:true,eventId:EVENT,capacity:3,opensAt:'2026-10-19T00:00:00+08:00',closesAt:'2026-12-05T12:00:00+08:00',
  privacy:{version:'synthetic-workspace-notice',processor:'合成处理者',contactEmail:'synthetic@example.invalid',purpose:'合成隔离测试',storageRegion:'合成地区',
    retention:'合成保留规则',rightsRequest:'合成权利入口',sharing:'不对外分享合成资料'}};
const request=(path,{method='GET',headers={},body,origin}={})=>new Request(API+path,{method,
  headers:{...headers,...(origin?{Origin:origin}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},
  ...(body===undefined?{}:{body:JSON.stringify(body)})});
function fixture({mail=false}={}){
  const objects=memoryObjects(),messages=[];
  const env={ADMIN_USERS_JSON:JSON.stringify(users),ARTDICO_REGISTRATION_ENABLED:'true',ARTDICO_REGISTRATION_WAITLIST_ENABLED:'true',
    ARTDICO_REGISTRATION_POLICY_JSON:JSON.stringify(policy),ARTDICO_REGISTRATION_CAPACITY:'3',ARTDICO_REGISTRATION_TOKEN_SECRET:SECRET,
    ARTDICO_CONFIRMATION_EMAIL_ENABLED:mail?'true':'false',EMAILJS_SERVICE_ID:'synthetic-service',EMAILJS_CONFIRMATION_TEMPLATE_ID:'synthetic-confirmation',
    EMAILJS_PUBLIC_KEY:'synthetic-public-key',EMAILJS_PRIVATE_KEY:'synthetic-private-key-do-not-project',EMAIL_FROM_ADDRESS:'synthetic@artdico.co',EMAIL_FROM_NAME:'合成筹备团队'};
  const make=()=>createCloudApplication({objects,env,now:()=>Date.parse('2026-10-21T04:00:00.000Z'),fetchFn:async(url,options)=>{
    assert.equal(url,'https://api.emailjs.com/api/v1.0/email/send');messages.push(JSON.parse(options.body));
    return new Response('OK',{status:200,headers:{'content-type':'text/plain'}});
  }});
  return {objects,messages,app:make(),make};
}
async function login(app,username='synthetic.owner'){
  const response=await app.handle(request('/api/admin/login',{method:'POST',origin:API,body:{username,password:PASSWORD}}));
  assert.equal(response.status,200);const body=await response.json();
  return {Cookie:response.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':body.csrfToken};
}
async function contactRegistration(f){
  const created=await f.app.contactsStore.createContact(0,{name:'合成工作页人员',organization:'合成团队',city:'合成城市',email:'synthetic.person@example.invalid',
    background:'PRIVATE_ORIGINAL_WORKSPACE_ANSWER',contactConsent:'consented'},users[0].id);
  const converted=await f.app.intentService.convertContacts({contactIds:[created.contact.id],expectedContactRevision:created.revision,
    actor:users[0],permissionReference:'合成隔离测试明确授权'});
  assert.equal(converted.registrations.length,1,JSON.stringify(converted.failures));
  return {contactId:created.contact.id,registrationId:converted.registrations[0].registrationId};
}
async function publicRegistration(f){
  const key=randomBytes(32).toString('base64url');
  const token=await f.app.handle(request('/api/admin/registration/token',{method:'POST',origin:PUBLIC,body:{eventId:EVENT,idempotencyKey:key}}));
  assert.equal(token.status,200);
  const saved=await f.app.handle(request('/api/admin/registration/submit',{method:'POST',origin:PUBLIC,
    headers:{'Idempotency-Key':key,'X-Registration-Token':(await token.json()).submissionToken},body:{eventId:EVENT,
      fields:{name:'合成公开参会者',city:'合成城市',organization:'合成学校',position:'合成开发者',email:'synthetic.public@example.invalid',
        categories:['industry'],participationInterests:['attend'],background:'PRIVATE_PUBLIC_ORIGINAL_ANSWER',attendance:'expected',accommodationChoice:'not_needed',cooperationInterest:'none'},
      consent:{accepted:true,version:policy.privacy.version}}}));
  assert.equal(saved.status,201);return saved.json();
}

test('runtime person routes use the durable explicit relation without creating a second roster or performing reads before authorization',async()=>{
  const f=fixture();assert.equal(f.objects.calls.length,0);
  const denied=await f.app.handle(request('/api/admin/people/contacts/synthetic-missing'));
  assert.equal(denied.status,401);
  const ids=await contactRegistration(f),headers=await login(f.app);
  const start=f.objects.calls.length;
  const response=await f.app.handle(request('/api/admin/people/contacts/'+ids.contactId,{headers}));
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const value=await response.json();
  assert.equal(value.linkage.state,'linked');assert.equal(value.linkage.registrationId,ids.registrationId);
  assert.equal(value.person.name,'合成工作页人员');assert.equal(value.admission.status,'confirmed');
  assert.equal(value.availability.registration,'available');assert.equal(value.registration.id,ids.registrationId);
  assert.doesNotMatch(JSON.stringify(value),/PRIVATE_ORIGINAL_WORKSPACE_ANSWER|sourceDigest|permissionReference|synthetic-private-key|receiptToken/u);
  assert.equal(f.objects.calls.slice(start).some(call=>call.operation!=='get'),false,'opening the workspace never writes a journal');
  const fromRegistration=await f.make().handle(request('/api/admin/people/registrations/'+ids.registrationId,{headers}));
  assert.equal(fromRegistration.status,200);assert.equal((await fromRegistration.json()).linkage.contactId,ids.contactId);
  assert.equal(f.messages.length,0);
});

test('runtime person projections preserve outreach versus reviewer access and reject content-only roles',async()=>{
  const f=fixture(),ids=await contactRegistration(f);
  const outreach=await login(f.app,'synthetic.outreach');
  const contact=await f.app.handle(request('/api/admin/people/contacts/'+ids.contactId,{headers:outreach}));
  assert.equal(contact.status,200);const contactValue=await contact.json();
  assert.equal(contactValue.contact.profile.email,'synthetic.person@example.invalid');
  assert.equal(contactValue.registration,null);assert.equal(contactValue.availability.registration,'restricted');
  assert.equal(contactValue.availability.confirmations,'restricted');
  assert.equal((await f.app.handle(request('/api/admin/people/registrations/'+ids.registrationId,{headers:outreach}))).status,403);

  const reviewer=await login(f.app,'synthetic.reviewer'),before=f.objects.calls.length;
  const registration=await f.app.handle(request('/api/admin/people/registrations/'+ids.registrationId,{headers:reviewer}));
  assert.equal(registration.status,200);const registrationValue=await registration.json();
  assert.equal(registrationValue.contact,null);assert.equal(registrationValue.availability.contact,'restricted');
  assert.equal(registrationValue.availability.invitations,'restricted');
  assert.equal(f.objects.calls.slice(before).some(call=>/^cms\/v1\/(?:contacts|intent-invitations)(?:\/|$)/u.test(call.key)),false,'review-only access never reads the contact or invitation journals');
  assert.equal((await f.app.handle(request('/api/admin/people/contacts/'+ids.contactId,{headers:reviewer}))).status,403);

  const editor=await login(f.app,'synthetic.editor'),editorBefore=f.objects.calls.length;
  assert.equal((await f.app.handle(request('/api/admin/people/contacts/'+ids.contactId,{headers:editor}))).status,403);
  assert.equal(f.objects.calls.slice(editorBefore).some(call=>/^cms\/v1\/(?:contacts|intent-invitations|registration-confirmations)(?:\/|$)/u.test(call.key)),false);
});

test('a public registration exposes its saved email history without replaying mail or inventing a contact match',async()=>{
  const f=fixture({mail:true}),receipt=await publicRegistration(f);
  assert.equal(receipt.confirmation.email.status,'provider_accepted');assert.equal(f.messages.length,1);
  const headers=await login(f.app),before=f.objects.calls.length;
  for(let read=0;read<2;read++){
    const response=await f.app.handle(request('/api/admin/people/registrations/'+receipt.reference_code,{headers}));
    assert.equal(response.status,200);const value=await response.json();
    assert.equal(value.linkage.state,'unlinked');assert.equal(value.contact,null);
    assert.equal(value.availability.confirmations,'available');assert.equal(value.communications.confirmations.length,1);
    assert.equal(value.communications.confirmations[0].status,'provider_accepted');
    assert.doesNotMatch(JSON.stringify(value),/PRIVATE_PUBLIC_ORIGINAL_ANSWER|synthetic-private-key|receiptToken|invitation_text|accessToken/u);
  }
  assert.equal(f.messages.length,1,'reading or reopening a person never calls EmailJS again');
  assert.equal(f.objects.calls.slice(before).some(call=>call.operation!=='get'),false);
});
