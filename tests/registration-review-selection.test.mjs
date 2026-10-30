import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewRegistrationSelection,reviewConfirmationLink} from '../src/lib/registration-review-selection.mjs';

test('registration deep links accept the complete saved 43-character base64url ID contract',()=>{
  for(const first of ['a','Z','0','-','_']){const id=first+'a'.repeat(42);assert.equal(reviewRegistrationSelection('#registration='+id),id);}
  assert.equal(reviewRegistrationSelection('#registration=%2D'+'a'.repeat(42)),'-'+'a'.repeat(42));
});
test('malformed or ambiguous registration selections cannot trigger a private detail read',()=>{
  for(const value of [null,{},'', '#registration=', '#registration=%ZZ', '#registration='+'a'.repeat(42), '#registration='+'a'.repeat(44), '#registration='+'a'.repeat(43)+'&next=other','#registration='+'a'.repeat(42)+'/', '#contact='+'a'.repeat(43)])assert.equal(reviewRegistrationSelection(value),null);
});

test('review links bind the current person, event, expiry and exact private URL',()=>{
  const id='a'.repeat(43), now=Date.parse('2026-10-30T00:00:00Z'),expiresAt=now+86400000;
  const token='c1.'+Buffer.from(JSON.stringify({registrationId:id,eventId:'ggj-cn-2026',expiresAt,purpose:'artdico-registration-confirmation-v1'})).toString('base64url')+'.'+'s'.repeat(43);
  const value={ready:true,registrationId:id,receiptToken:token,confirmationUrl:'https://artdico.host/registration/confirmation/#r='+token,expiresAt:new Date(expiresAt).toISOString()};
  assert.deepEqual(reviewConfirmationLink(value,id,now),{confirmationUrl:value.confirmationUrl,expiresAt:value.expiresAt});
  for(const patch of [{ready:false},{registrationId:'b'.repeat(43)},{confirmationUrl:'https://foreign.example.invalid/#r='+token},{expiresAt:new Date(now-1).toISOString()},{expiresAt:new Date(expiresAt+1000).toISOString()},{receiptToken:'wrong'}])
    assert.equal(reviewConfirmationLink({...value,...patch},id,now),null);
  assert.equal(reviewConfirmationLink(value,'b'.repeat(43),now),null);
});
