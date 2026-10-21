import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewRegistrationSelection} from '../src/lib/registration-review-selection.mjs';

test('registration deep links accept the complete saved 43-character base64url ID contract',()=>{
  for(const first of ['a','Z','0','-','_']){const id=first+'a'.repeat(42);assert.equal(reviewRegistrationSelection('#registration='+id),id);}
  assert.equal(reviewRegistrationSelection('#registration=%2D'+'a'.repeat(42)),'-'+'a'.repeat(42));
});
test('malformed or ambiguous registration selections cannot trigger a private detail read',()=>{
  for(const value of [null,{},'', '#registration=', '#registration=%ZZ', '#registration='+'a'.repeat(42), '#registration='+'a'.repeat(44), '#registration='+'a'.repeat(43)+'&next=other','#registration='+'a'.repeat(42)+'/', '#contact='+'a'.repeat(43)])assert.equal(reviewRegistrationSelection(value),null);
});
