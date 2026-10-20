import test from 'node:test';
import assert from 'node:assert/strict';
import {admissionSummary, registrationReceiptState} from '../src/lib/admission-view.mjs';

const summary = () => ({capacity:300,staffReserve:10,waitlistEnabled:true,confirmedCount:290,attendeeConfirmedCount:280,crewConfirmedCount:10,waitlistCount:4,remainingPublic:0,remainingTotal:10});

test('a saved waitlist receipt is distinct from confirmed admission, including legacy confirmed receipts', () => {
  assert.equal(registrationReceiptState({status:'registered'}),'confirmed');
  assert.equal(registrationReceiptState({status:'registered',admissionStatus:'confirmed',admissionKind:'crew',admissionRevision:7}),'confirmed');
  assert.equal(registrationReceiptState({status:'waitlisted',admissionStatus:'waitlisted',admissionKind:'attendee',admissionRevision:8}),'waitlisted');
  for (const value of [null,[],{}, {status:'pending'}, {status:'registered',admissionStatus:'waitlisted'}, {status:'waitlisted',admissionStatus:'confirmed'}, {status:'waitlisted',admissionKind:'team'}, {status:'registered',admissionRevision:-1}, {status:'registered',admissionRevision:1.5}]) {
    assert.equal(registrationReceiptState(value),null);
  }
});

test('capacity facts project bounded aggregate counts and exclude private or unknown properties', () => {
  assert.deepEqual(admissionSummary({...summary(),people:[{name:'PRIVATE-SYNTHETIC'}],credential:'PRIVATE-SYNTHETIC'}),summary());
  assert.deepEqual(admissionSummary({capacity:300,staffReserve:0,waitlistEnabled:true,confirmedCount:300,attendeeConfirmedCount:300,crewConfirmedCount:0,waitlistCount:2,remainingPublic:0,remainingTotal:0}),{capacity:300,staffReserve:0,waitlistEnabled:true,confirmedCount:300,attendeeConfirmedCount:300,crewConfirmedCount:0,waitlistCount:2,remainingPublic:0,remainingTotal:0});
  for (const patch of [{capacity:0},{staffReserve:301},{confirmedCount:291},{remainingTotal:9},{remainingPublic:11},{waitlistCount:1001},{crewConfirmedCount:-1},{attendeeConfirmedCount:280.5},{waitlistEnabled:'true'}]) {
    assert.equal(admissionSummary({...summary(),...patch}),null);
  }
  const incomplete=summary();delete incomplete.waitlistCount;
  assert.equal(admissionSummary(incomplete),null);
});
