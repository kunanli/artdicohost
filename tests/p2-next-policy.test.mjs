import test from 'node:test';
import assert from 'node:assert/strict';
import { PEOPLE_WORK_FILTERS, PEOPLE_HEALTH_KINDS, personWorkRecommendation } from '../shared/organizer-progress.mjs';
import { personNextAction, personSourceView, personWorkspaceView } from '../src/lib/person-workspace.mjs';
import { fixture, CONTACT, REGISTRATION } from './person-workspace-fixture.mjs';

const facts = patch => ({contactId: CONTACT, registrationId: REGISTRATION, profileId: null,
  responseStatus: 'attending', admissionStatus: 'confirmed', registrationState: 'available',
  invitationStatus: 'provider_accepted', deliveryStatus: 'provider_accepted', contactConsent: 'consented',
  canReview: true, canIntegrate: true, canEdit: true, canContact: true, ...patch});

test('unknown receipts come before duplicate, integration, notification or publication suggestions', () => {
  const value = facts({registrationId: null, admissionStatus: null, registrationState: 'unlinked',
    invitationStatus: 'unknown', duplicateCandidate: true, publicNeedsUpdate: true});
  const before = structuredClone(value), result = personWorkRecommendation(value);
  assert.equal(result.nextAction.key, 'check'); assert.equal(result.nextAction.label, '核对结果');
  assert.equal(result.nextAction.kind, 'refresh'); assert.match(result.nextAction.reason, /勿重寄/u);
  assert.ok(result.workKinds.includes('notification')); assert.ok(result.workKinds.includes('pending'));
  assert.deepEqual(value, before);
  assert.doesNotMatch(JSON.stringify(result), /operationId|providerKey|permissionReference|receiptToken/u);
  assert.equal(personWorkRecommendation(facts({deliveryStatus: 'unknown'})).nextAction.key, 'check');
  assert.equal(personWorkRecommendation(facts({invitationStatus: 'issuing'})).nextAction.key, 'check');
});

test('source failures and malformed identities cannot masquerade as new integration or completion', () => {
  for (const patch of [{sourceUnavailable: true}, {registrationId: '../another-person'}, {profileId: 'https://example.invalid/'},
    {admissionStatus: 'invented'}, {registrationState: 'unavailable'}, {deliveryStatus: 'unavailable'}]) {
    const result = personWorkRecommendation(facts(patch));
    assert.equal(result.nextAction.key, 'check'); assert.equal(result.nextAction.kind, 'refresh');
    assert.deepEqual(result.workKinds, ['pending', 'unavailable']);
    assert.doesNotMatch(result.nextAction.href, /\.\.|https:|example/u);
  }
  assert.equal(personWorkRecommendation({}).nextAction.key, 'check');
  const accessor = facts();
  Object.defineProperty(accessor, 'registrationId', {enumerable: true, get() { assert.fail('policy must not invoke getters'); }});
  assert.equal(personWorkRecommendation(accessor).nextAction.key, 'check');
});

test('only a saved attending contact with no known registration is suggested for integration', () => {
  const fresh = facts({registrationId: null, admissionStatus: null, registrationState: 'unlinked'});
  assert.equal(personWorkRecommendation(fresh).nextAction.key, 'integration');
  for (const admissionStatus of ['pending_review', 'rejected', 'withdrawn', 'waitlisted', 'confirmed']) {
    const result = personWorkRecommendation(facts({admissionStatus}));
    assert.notEqual(result.nextAction.key, 'integration', admissionStatus);
    assert.equal(result.workKinds.includes('integration'), false, admissionStatus);
  }
  assert.equal(personWorkRecommendation(facts({registrationId: null, admissionStatus: null, registrationState: 'restricted'})).nextAction.key, 'details');
  assert.equal(personWorkRecommendation({...fresh, responseStatus: 'pending'}).nextAction.key, 'reply');
  assert.equal(personWorkRecommendation({...fresh, responseStatus: 'declined'}).nextAction.key, 'details');
});

test('review, withdrawal verification and permission handoffs preserve the original admission', () => {
  const pending = facts({admissionStatus: 'pending_review'});
  assert.equal(personWorkRecommendation(pending).nextAction.key, 'review');
  assert.equal(personWorkRecommendation({...pending, canReview: false}).nextAction.kind, 'handoff');
  const declined = facts({responseStatus: 'declined'}), before = structuredClone(declined);
  const result = personWorkRecommendation(declined);
  assert.equal(result.nextAction.key, 'review'); assert.equal(result.nextAction.label, '核对原名额');
  assert.ok(result.nextAction.href.endsWith(REGISTRATION));
  assert.deepEqual(declined, before); assert.equal(declined.admissionStatus, 'confirmed');
  assert.equal(personWorkRecommendation({...declined, canReview: false}).nextAction.label, '交由审核人');
  for (const [patch, label] of [[{duplicateCandidate: true, canIntegrate: false}, '交由负责人'],
    [{publicNeedsUpdate: true, canEdit: false}, '交由活动编辑'],
    [{responseStatus: 'pending', canContact: false}, '交由跟进人']]) {
    const recommendation = personWorkRecommendation(facts(patch)).nextAction;
    assert.equal(recommendation.kind, 'handoff'); assert.equal(recommendation.label, label); assert.ok(recommendation.reason);
  }
});

test('a provider acceptance never invents an attendee reply or a completed notification', () => {
  const pending = personWorkRecommendation(facts({responseStatus: 'pending'}));
  assert.equal(pending.stateLabel, '待回复'); assert.equal(pending.nextAction.key, 'reply');
  assert.equal(personWorkRecommendation(facts({deliveryStatus: 'not_sent'})).nextAction.key, 'notification');
  assert.equal(personWorkRecommendation(facts({deliveryStatus: 'rejected'})).nextAction.label, '核对通知');
  assert.equal(personWorkRecommendation(facts({admissionStatus: 'waitlisted', deliveryStatus: 'not_sent'})).nextAction.key, 'details');
  const permission = personWorkRecommendation(facts({contactConsent: 'unknown'})).nextAction;
  assert.equal(permission.label, '核对联络许可'); assert.equal(permission.key, 'source', 'permission review must not open an actual attendance reply editor');
  const denied = personWorkRecommendation(facts({contactConsent: 'declined', deliveryStatus: 'not_sent'}));
  assert.equal(denied.nextAction.key, 'details'); assert.equal(denied.stateLabel, '已拒绝联络');
});

test('recommendations are deterministic and use safe fixed routes instead of supplied URLs', () => {
  const source = facts({publicNeedsUpdate: true, profileId: 'synthetic-profile', href: 'https://example.invalid/private-link',
    privateEmail: 'PRIVATE_EMAIL@example.invalid', rawAnswers: 'PRIVATE_ORIGINAL_ANSWER'});
  const result = personWorkRecommendation(source);
  assert.equal(result.nextAction.href, '/admin/content/guests/#guest=synthetic-profile');
  assert.deepEqual(result, personWorkRecommendation(structuredClone(source)));
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|example|rawAnswers/u);
  source.publicNeedsUpdate = false;
  assert.equal(personWorkRecommendation(source).nextAction.key, 'details', 'new saved facts replace the old recommendation without a new stored workflow');
  assert.deepEqual(personWorkRecommendation(source).workKinds, []);
  assert.deepEqual(PEOPLE_WORK_FILTERS, ['pending', 'all', 'reply', 'integration', 'duplicate', 'notification', 'unavailable', 'review', 'publication', 'arrangement']);
  assert.deepEqual(PEOPLE_HEALTH_KINDS, ['unlinked_source', 'duplicate', 'attending_unintegrated', 'email_mismatch', 'publication', 'lodging', 'legacy_work', 'event_facts']);
  assert.ok(Object.isFrozen(PEOPLE_WORK_FILTERS)); assert.ok(Object.isFrozen(PEOPLE_HEALTH_KINDS));
});

test('selected-person recommendations reuse actual validated read-only projection and preserve pending operations', async () => {
  const f = fixture(), {body} = await f.read(), view = personWorkspaceView(body, body.selected);
  assert.ok(view);
  const before = structuredClone(view), action = personNextAction(view, ['superadmin']);
  assert.equal(action.key, 'reply', 'a linked person is not misread as a missing source');
  assert.equal(action.href, '/admin/person/#contact=' + CONTACT);
  const pending = personNextAction(view, ['superadmin'], 'unknown');
  assert.equal(pending.key, 'check'); assert.equal(pending.label, '核对结果');
  assert.equal(pending.reason, '保存结果待核对。');
  assert.deepEqual(view, before);
  view.communications.confirmations[0].status = 'unknown';
  assert.equal(personNextAction(view, ['superadmin']).key, 'check');
  assert.doesNotMatch(JSON.stringify(personNextAction(view, ['superadmin'])), /PRIVATE-|@|receiptToken/u);
});

test('selected-person integration never recreates an existing rejected, pending or withdrawn registration', async () => {
  const f = fixture(); f.data.contacts.contacts[0].operations.responseStatus = 'attending';
  for (const status of ['pending_review', 'rejected', 'withdrawn']) {
    f.data.admission.status = status;
    const {body} = await f.read(), action = personNextAction(body, ['superadmin']);
    assert.notEqual(action.key, 'integration', status);
  }
  const unlinked = fixture({linked: false}); unlinked.data.contacts.contacts[0].operations.responseStatus = 'attending';
  const {body} = await unlinked.read();
  assert.equal(personNextAction(body, ['superadmin']).key, 'integration');
  assert.equal(personNextAction(body, ['outreach']).kind, 'handoff');
});

test('selected original source validates identity, data shape and size while preserving real line breaks', () => {
  const source = {schemaVersion: 1, contactId: CONTACT, revision: 0, sourceKind: 'imported', snapshot: 'preserved',
    fields: [{label: '原始住宿需求', value: '需要\n后续联系\t主办方'}]};
  const saved = personSourceView(source, CONTACT);
  assert.deepEqual(saved, source); assert.notEqual(saved, source); assert.notEqual(saved.fields[0], source.fields[0]);
  saved.fields[0].value = 'changed'; assert.equal(source.fields[0].value, '需要\n后续联系\t主办方');
  assert.equal(personSourceView(source, 'other-person'), null);
  for (const patch of [{revision: -1}, {sourceKind: 'guessed'}, {snapshot: 'latest'}, {otherPerson: 'PRIVATE'},
    {fields: [{label: '需求', value: 'bad\u0000value'}]}, {fields: Array.from({length: 41}, () => ({label: '需求', value: ''}))},
    {fields: [{label: '需求', value: 'x'.repeat(10001)}]},
    {fields: Array.from({length: 12}, () => ({label: '需求', value: 'x'.repeat(9000)}))}]) {
    assert.equal(personSourceView({...source, ...patch}, CONTACT), null);
  }
  const accessor = {...source};
  Object.defineProperty(accessor, 'fields', {enumerable: true, get() { assert.fail('source display must not invoke getters'); }});
  assert.equal(personSourceView(accessor, CONTACT), null);
});
