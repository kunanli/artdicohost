// Shared isolated runtime fixture. No real identities, storage, keys or outbound mail.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {hashPassword} from '../../functions/content-api/auth.mjs';
import {createCloudApplication} from '../../functions/cloud-content/runtime.mjs';
import {memoryObjects} from './cloud-memory-objects.mjs';

export const PEOPLE_FIXTURE_API='https://api.artdico.host';
export const PEOPLE_FIXTURE_PUBLIC='https://artdico.host';
export const PEOPLE_FIXTURE_EVENT='ggj-cn-2026';
export const PEOPLE_FIXTURE_PASSWORD='synthetic-people-runtime-password';
export const PEOPLE_FIXTURE_PRIVATE='SYNTHETIC_ORIGINAL_PEOPLE_ANSWER_NEVER_PROJECT';
const passwordHash=await hashPassword(PEOPLE_FIXTURE_PASSWORD);

/** Actual auth, content, contact, conversion and shared admission services over memory OSS. */
export async function peopleRuntimeFixture({capacity=3,mail=false}={}){
  assert.ok(Number.isSafeInteger(capacity)&&capacity>=1&&capacity<=1000);
  const objects=memoryObjects(),messages=[];
  const users=[
    ['owner',['editor','publisher','outreach','reviewer','superadmin']],
    ['combined',['outreach','reviewer']],['outreach',['outreach']],['reviewer',['reviewer']],
    ['editor',['editor']],['editoroutreach',['editor','outreach']],
  ].map(([username,roles])=>({id:'synthetic-people-'+username,username,label:'合成人员同事 '+username,roles,passwordHash}));
  const policy={enabled:true,eventId:PEOPLE_FIXTURE_EVENT,capacity,opensAt:'2026-10-19T00:00:00+08:00',closesAt:'2026-12-05T12:00:00+08:00',privacy:{
    version:'synthetic-people-notice-v1',processor:'合成处理者',contactEmail:'synthetic@example.invalid',purpose:'合成人员串联回归',storageRegion:'合成隔离地区',
    retention:'合成保留规则',rightsRequest:'合成权利入口',sharing:'合成资料不对外分享'}};
  const env={ADMIN_USERS_JSON:JSON.stringify(users),ARTDICO_REGISTRATION_ENABLED:'true',ARTDICO_REGISTRATION_WAITLIST_ENABLED:'true',
    ARTDICO_REGISTRATION_POLICY_JSON:JSON.stringify(policy),ARTDICO_REGISTRATION_CAPACITY:String(capacity),
    ARTDICO_REGISTRATION_TOKEN_SECRET:'synthetic-people-registration-token-secret-123456',ARTDICO_CONFIRMATION_EMAIL_ENABLED:mail?'true':'false',
    EMAILJS_SERVICE_ID:'synthetic-service',EMAILJS_CONFIRMATION_TEMPLATE_ID:'synthetic-confirmation-template',EMAILJS_PUBLIC_KEY:'synthetic-public-key',
    EMAILJS_PRIVATE_KEY:'synthetic-private-key-never-project',EMAIL_FROM_ADDRESS:'synthetic@artdico.co',EMAIL_FROM_NAME:'合成筹备团队'};
  const make=({objects:runtimeObjects=objects}={})=>createCloudApplication({objects:runtimeObjects,env,now:()=>Date.parse('2026-10-21T09:00:00.000Z'),fetchFn:async(url,options)=>{
    assert.equal(url,'https://api.emailjs.com/api/v1.0/email/send','all fixture mail must remain synthetic');messages.push(JSON.parse(options.body));
    return new Response('OK',{status:200,headers:{'content-type':'text/plain'}});
  }});
  const app=make();let serial=0;
  function request(path,{method='GET',headers={},body,origin}={}){
    const url=new URL(path,PEOPLE_FIXTURE_API);assert.equal(url.origin,PEOPLE_FIXTURE_API,'fixture requests use only its isolated API origin');
    return new Request(url,{method,headers:{...headers,...(origin!==undefined?{Origin:origin}:method!=='GET'?{Origin:PEOPLE_FIXTURE_API}:{}),
      ...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  }
  async function login(username='owner'){
    const response=await app.handle(request('/api/admin/login',{method:'POST',body:{username,password:PEOPLE_FIXTURE_PASSWORD}}));
    assert.equal(response.status,200,'synthetic login '+username);const value=await response.json();assert.equal(typeof value.csrfToken,'string');
    return {Cookie:response.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':value.csrfToken};
  }
  async function createContact(profile={},expectedRevision){
    const index=++serial;if(expectedRevision===undefined)expectedRevision=(await app.contactsStore.read()).revision;
    return app.contactsStore.createContact(expectedRevision,{name:'合成人员 '+index,organization:'合成组织文字',city:'合成城市',email:'synthetic.person.'+index+'@example.invalid',
      background:PEOPLE_FIXTURE_PRIVATE,contactConsent:'consented',...profile},users[0].id);
  }
  async function seedPublic(fields={}){
    const key=randomBytes(32).toString('base64url'),token=await app.handle(request('/api/admin/registration/token',{method:'POST',origin:PEOPLE_FIXTURE_PUBLIC,
      body:{eventId:PEOPLE_FIXTURE_EVENT,idempotencyKey:key}}));assert.equal(token.status,200);
    const response=await app.handle(request('/api/admin/registration/submit',{method:'POST',origin:PEOPLE_FIXTURE_PUBLIC,
      headers:{'Idempotency-Key':key,'X-Registration-Token':(await token.json()).submissionToken},body:{eventId:PEOPLE_FIXTURE_EVENT,
        fields:fields.intake==='general-v2'
          ?{name:'合成公开申请人',email:'synthetic.public@example.invalid',categories:['student'],participationInterests:['attend'],...fields}
          :{name:'合成公开参会者',city:'合成城市',organization:'合成组织文字',position:'合成开发者',email:'synthetic.public@example.invalid',categories:['industry'],participationInterests:['attend'],
            background:PEOPLE_FIXTURE_PRIVATE,attendance:'expected',accommodationChoice:'not_needed',cooperationInterest:'none',...fields},consent:{accepted:true,version:policy.privacy.version}}}));
    assert.equal(response.status,201,'synthetic public registration');return response.json();
  }
  async function approvePublic(registrationId,{headers,expectedRevision,operationId=randomBytes(32).toString('base64url')}={}){
    headers??=await login();
    expectedRevision??=(await app.registrationService.getAdmissions({actor:users[0]})).revision;
    const response=await app.handle(request('/api/admin/admissions/approve',{method:'POST',headers,body:{registrationId,expectedRevision,operationId}}));
    const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));
    assert.equal(value.operation?.operationId,operationId);assert.equal(value.operation?.registrationId,registrationId);
    return value;
  }
  return {app,make,objects,messages,users,request,login,createContact,seedPublic,approvePublic};
}
