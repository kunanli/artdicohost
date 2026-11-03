import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { confirmationEmailPresentation, CONFIRMATION_PRESENTATION_KEYS } from '../functions/registration-confirmation/presentation.mjs';
const token='s'.repeat(22),confirmationUrl='https://artdico.host/r/#'+token;
const ticket={confirmationUrl,admissionQrImageUrl:'https://api.artdico.host/api/admin/registration/entry-links/'+token+'/entry.png',groupQrImageUrl:'https://api.artdico.host/api/admin/registration/entry-links/'+token+'/group.png',groupExpiresAt:'2026-11-05T04:00:00.000Z'};
const input={locale:'zh-CN',kind:'registration',subject:'合成活动｜参会名额已确认',confirmationUrl,ticket,walletReady:true};
test('confirmation email uses the official language badge and separate admission/group images',()=>{
  const cn=confirmationEmailPresentation(input);assert.deepEqual(Object.keys(cn),CONFIRMATION_PRESENTATION_KEYS);assert.equal(cn.email_language,'zh-CN');
  assert.match(cn.confirmation_actions,/add-to-apple-wallet-cn\.png/u);assert.match(cn.confirmation_actions,/入场二维码/u);assert.match(cn.confirmation_actions,/加入活动微信群/u);assert.match(cn.confirmation_actions,/有效至/u);assert.match(cn.confirmation_actions,/11\/05 12:00/u);
  assert.ok(cn.confirmation_actions.includes(ticket.admissionQrImageUrl));assert.ok(cn.confirmation_actions.includes(ticket.groupQrImageUrl));assert.equal((cn.confirmation_actions.match(/src="https:\/\/api\.artdico\.host/gu)||[]).length,2);
  const en=confirmationEmailPresentation({...input,locale:'en'});assert.equal(en.email_language,'en');assert.match(en.confirmation_actions,/add-to-apple-wallet-en\.png/u);assert.match(en.confirmation_actions,/Admission QR code/u);assert.doesNotMatch(en.confirmation_actions,/入场|加入活动微信群/u);
});
test('pending applications never display Wallet, admission or group capabilities',()=>{
  const pending=confirmationEmailPresentation({...input,kind:'application_received'});assert.doesNotMatch(pending.confirmation_actions,/<img|入场|钱包|微信群/u);assert.ok(pending.confirmation_actions.includes(confirmationUrl));
  const noGroup=confirmationEmailPresentation({...input,ticket:{confirmationUrl,admissionQrImageUrl:ticket.admissionQrImageUrl},walletReady:false});assert.doesNotMatch(noGroup.confirmation_actions,/wallet|微信群/u);assert.match(noGroup.confirmation_actions,/入场二维码/u);
});
test('action rendering rejects cross-origin, cross-person, malformed and swapped image capabilities',()=>{
  for(const bad of [
    {...ticket,confirmationUrl:'https://evil.example.invalid/r/#'+token},
    {...ticket,admissionQrImageUrl:'https://evil.example.invalid/'+token},
    {...ticket,admissionQrImageUrl:ticket.admissionQrImageUrl+'?x=1'},
    {...ticket,admissionQrImageUrl:ticket.admissionQrImageUrl.replace(token,'q'.repeat(22))},
    {...ticket,admissionQrImageUrl:ticket.groupQrImageUrl},
    {...ticket,groupQrImageUrl:'https://api.artdico.host@evil.example.invalid/'+token},
    {...ticket,groupExpiresAt:'2026-11-05'},
  ])assert.throws(()=>confirmationEmailPresentation({...input,ticket:bad}),TypeError);
  for(const url of ['javascript:alert(1)','https://artdico.host/r/#'+token+'" onload="alert(1)','https://artdico.host/r/#'+token+'/extra'])assert.throws(()=>confirmationEmailPresentation({...input,confirmationUrl:url}),TypeError);
  assert.throws(()=>confirmationEmailPresentation({...input,kind:'future'}),TypeError);
});
test('legacy missing locale uses Simplified badge without changing the receipt and never sends a short-lived group image',()=>{
  const legacy='https://artdico.host/registration/confirmation/#r=c1.synthetic.signature';
  const result=confirmationEmailPresentation({...input,locale:undefined,confirmationUrl:legacy,ticket:undefined});assert.equal(result.email_language,'zh-CN');assert.match(result.confirmation_actions,/add-to-apple-wallet-cn\.png/u);assert.ok(result.confirmation_actions.includes(legacy));assert.doesNotMatch(result.confirmation_actions,/group-invite\/|<script|onerror=/u);
});
test('email badge PNGs are bounded rasterizations of the exact official uploaded SVGs',async()=>{
  for(const [locale,svgHash,pngHash] of [['cn','4b832d82c1fe7cf51a9821706566c411234dbdefc54b4ce3487c366f67650d7e','359b17cea9d2f249026388f9c3f625c163f2d872c02e0353363a301cdf6928d5'],['en','052b3b446860fd2f9b49c2f0336038947623a5a9433ee3583585b8552ff6f506','5c81903d7e9c789fc8b25f5db02a3ecf47746c7e99d967cc651e4ff29703a8e1']]){
    const svg=await readFile(new URL('../public/wallet/add-to-apple-wallet-'+locale+'.svg',import.meta.url)),png=await readFile(new URL('../public/wallet/add-to-apple-wallet-'+locale+'.png',import.meta.url));assert.equal(createHash('sha256').update(svg).digest('hex'),svgHash);assert.equal(createHash('sha256').update(png).digest('hex'),pngHash);assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(png.readUInt32BE(20),176);assert.ok(png.length<20_000);
  }
});

test('only the confirmation adapter enables the exact three presentation variables on the audited transport',async()=>{
  const {createInvitationEmailProvider}=await import('../functions/intent-invitations/email-provider.mjs');
  const env={ARTDICO_INVITATION_EMAIL_ENABLED:'true',EMAILJS_SERVICE_ID:'synthetic_service',EMAILJS_TEMPLATE_ID:'synthetic_template',EMAILJS_PUBLIC_KEY:'SYNTHETIC-PUBLIC',EMAILJS_PRIVATE_KEY:'SYNTHETIC-PRIVATE',EMAIL_FROM_ADDRESS:'synthetic@artdico.co',EMAIL_FROM_NAME:'Synthetic'};
  const subject='合成确认',text='合成正文',base={recipient:'synthetic@example.invalid',subject,text,idempotencyKey:'synthetic_presentation',templateVariables:{to_name:'合成人',to_email:'synthetic@example.invalid',event_title:'合成活动',event_date:'2026-12-05',event_time:'10:00–18:00',event_venue:'合成地点',reference_code:'synthetic',invitation_text:text,...confirmationEmailPresentation({...input,subject})}};
  let calls=0,body;const fetchFn=async(_,request)=>{calls++;body=JSON.parse(request.body);return new Response('OK',{status:200});};
  const invitation=createInvitationEmailProvider({env,fetchFn});assert.equal((await invitation.send(base)).status,'rejected');assert.equal(calls,0);
  const confirmation=createInvitationEmailProvider({env,fetchFn,confirmationPresentation:true});assert.equal((await confirmation.send(base)).status,'provider_accepted');assert.equal(calls,1);assert.equal(body.template_params.email_language,'zh-CN');assert.equal(body.template_params.confirmation_actions,base.templateVariables.confirmation_actions);
  for(const change of [value=>{delete value.templateVariables.email_language;},value=>{value.templateVariables.email_language='future';},value=>{value.templateVariables.email_subject='different';},value=>{value.templateVariables.arbitrary_html='<script>x</script>';}]){const bad=structuredClone(base);change(bad);assert.equal((await confirmation.send(bad)).status,'rejected');}
  assert.equal(calls,1);
});
