import test from 'node:test';
import assert from 'node:assert/strict';
import { EDITABLE_CONTACT_FIELDS, validateManualContactProfile, validateContactProfileEdit, guestPrefillFromContact } from '../shared/contact-editor.mjs';
import { validateImportedContact, validateStoredContact, createEmptyContactOperations, validateContactOperations, PARTICIPATION_FORMS } from '../shared/contacts-schema.mjs';

function importedProfile(overrides = {}) {
  const { sourceRowId, ...profile } = validateImportedContact({
    sourceRowId: 'synthetic-1', name: '合成对象', displayName: '合成称呼', organization: '合成团队', email: 'synthetic@example.invalid',
    categories: ['so'], interests: ['talk'], attendanceIntent: 'expected', contactConsent: 'declined',
    attendanceIntentCode: '1', contactConsentCode: '2', contactConsentLabel: '原问卷不同意',
    needs: '原始需求保持', caseLinks: '原作品资料保持', ...overrides,
  }).value;
  return profile;
}
function contact(profile = importedProfile()) {
  return {
    id: 'synthetic-contact', source: { key: 'synthetic-source', rowId: 'synthetic-1', digest: 'a'.repeat(64), importedAt: '2026-10-20T00:00:00.000Z' },
    profile, operations: createEmptyContactOperations(), invitation: { generatedAt: null, settings: null, sentAt: null, channel: null, sentGenerationAt: null },
    createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z',
  };
}

test('manual profile has no inferred contact consent or historic questionnaire answers', () => {
  const result = validateManualContactProfile({ name: ' 合成新增 ', email: ' SYNTHETIC@example.invalid ' });
  assert.equal(result.valid, true);
  assert.equal(result.value.name, '合成新增'); assert.equal(result.value.displayName, '合成新增');
  assert.equal(result.value.email, 'synthetic@example.invalid');
  assert.equal(result.value.contactConsent, 'unknown'); assert.equal(result.value.attendanceIntent, 'unknown');
  assert.equal(result.value.contactConsentCode, ''); assert.deepEqual(result.value.categories, []);
  assert.equal('sourceRowId' in result.value, false);
  assert.equal(validateManualContactProfile({ name: '合成新增', contactConsent: 'consented' }).value.contactConsent, 'consented');
  for (const contactConsent of [true, 1, 'yes', '']) assert.equal(validateManualContactProfile({ name: '合成新增', contactConsent }).valid, false);
});

test('profile patch preserves original noneditable answers and refuses privilege or consent mass assignment', () => {
  const original = importedProfile(), before = structuredClone(original);
  const edited = validateContactProfileEdit({ name: '合成修正', organization: '合成新团队', background: '合成多行\n经历' }, original);
  assert.equal(edited.valid, true); assert.equal(edited.value.name, '合成修正'); assert.equal(edited.value.organization, '合成新团队');
  for (const key of Object.keys(original).filter(key => !EDITABLE_CONTACT_FIELDS.includes(key))) assert.deepEqual(edited.value[key], original[key]);
  assert.deepEqual(original, before);
  for (const key of ['source', 'sourceProfile', 'id', 'sourceRowId', 'operations', 'invitation', 'contactConsent', 'contactConsentCode', 'contactConsentLabel', 'attendanceIntent', 'categories', 'interests', 'roles', 'publicConsent']) {
    const input = { name: '合成修正', [key]: key === 'contactConsent' ? 'consented' : 'MASS_ASSIGNMENT_SYNTHETIC' };
    assert.equal(validateContactProfileEdit(input, original).valid, false, key);
    if (!['contactConsent'].includes(key)) assert.equal(validateManualContactProfile(input).valid, false, key);
  }
  assert.equal(validateContactProfileEdit({}, original).valid, false);
});

test('editable website never accepts executable protocols or credentials and inputs stay plain bounded data', () => {
  for (const website of ['javascript:alert(1)', 'data:text/html,<script>', 'file:///tmp/x', 'https://user:password@example.invalid', '//example.invalid', 'https:example.invalid']) {
    assert.equal(validateManualContactProfile({ name: '合成新增', website }).valid, false, website);
  }
  assert.equal(validateManualContactProfile({ name: '合成新增', website: 'https://example.invalid/path?q=synthetic' }).valid, true);
  for (const input of [null, [], { name: 123 }, { name: '字'.repeat(121) }, { name: '合成\n新行' }, { name: '\n合成\n' }, { name: '\t合成\t' }, { name: '\r合成\r' }, { name: '合成', email: 'invalid' }]) assert.equal(validateManualContactProfile(input).valid, false);
  let accessed = false;
  const getter = Object.defineProperty({}, 'name', { enumerable: true, get: () => { accessed = true; throw new Error('must not execute'); } });
  assert.equal(validateManualContactProfile(getter).valid, false); assert.equal(accessed, false);
  assert.equal(validateManualContactProfile(JSON.parse('{"name":"合成","__proto__":{"isAdmin":true}}')).valid, false);
  assert.equal(validateManualContactProfile({ name: '合成', [Symbol('private')]: true }).valid, false);
});

test('source snapshot is optional for legacy contacts but strict, canonical and history-preserving once stored', () => {
  const legacy = contact(); assert.equal(validateStoredContact(legacy), true);
  const corrected = structuredClone(legacy); corrected.sourceProfile = structuredClone(legacy.profile); corrected.sourceProfileDigest = 'b'.repeat(64); corrected.profile.name = '合成修正';
  assert.equal(validateStoredContact(corrected), true);
  for (const mutate of [
    item => { item.sourceProfile.extra = 'not allowed'; },
    item => { item.sourceProfile = null; },
    item => { delete item.sourceProfileDigest; },
    item => { item.sourceProfile.name = ' spaced '; },
    item => { item.profile.contactConsent = 'consented'; },
    item => { item.profile.contactConsentCode = '1'; },
    item => { item.profile.attendanceIntent = 'uncertain'; },
    item => { item.profile.categories = ['ro']; },
  ]) {
    const corrupted = structuredClone(corrected); mutate(corrupted); assert.equal(validateStoredContact(corrupted), false);
  }
});

test('consented pending invitees can prepare minimal linked drafts without confirming attendance or public authorization', () => {
  const item = contact(importedProfile({ siteRole: '合成待核实职务', contactConsent: 'consented' }));
  const pendingBefore = structuredClone(item), pending = guestPrefillFromContact(item);
  assert.equal(pending.valid, true); assert.equal(pending.responseStatus, 'pending');
  assert.deepEqual(item, pendingBefore);
  item.operations.responseStatus = 'attending';
  const before = structuredClone(item), result = guestPrefillFromContact(item);
  assert.equal(result.valid, true);
  assert.equal(result.responseStatus, 'attending');
  assert.deepEqual(result.value, { name: '合成称呼', company: '合成团队', ggjRole: '合成待核实职务', contactId: 'synthetic-contact' });
  assert.deepEqual(item, before);
  assert.equal(JSON.stringify(result).includes('example.invalid'), false);
  assert.equal('publicConsent' in result.value, false); assert.equal('portraitId' in result.value, false);
  for (const contactConsent of ['unknown', 'declined']) assert.equal(guestPrefillFromContact({ ...item, profile: { ...item.profile, contactConsent } }).valid, false);
  assert.equal(guestPrefillFromContact({ ...item, operations: { ...item.operations, responseStatus: 'declined' } }).valid, false);
  assert.equal(guestPrefillFromContact({ ...item, id: 'https://example.invalid/private' }).valid, false);
  assert.equal(guestPrefillFromContact({ ...item, profile: { ...item.profile, organization: '字'.repeat(161) } }).valid, false);
});

test('participation forms are independent multi-select staff arrangements with strict codes and a legacy empty default', () => {
  const base = createEmptyContactOperations(); assert.deepEqual(base.participationForms, []);
  const legacy = { ...base }; delete legacy.participationForms;
  assert.equal(validateContactOperations(legacy).valid, true);
  assert.deepEqual(validateContactOperations(legacy).value.participationForms, []);
  const multiple = validateContactOperations({ ...base, participationForms: [...PARTICIPATION_FORMS] });
  assert.equal(multiple.valid, true); assert.deepEqual(multiple.value.participationForms, PARTICIPATION_FORMS);
  assert.equal(multiple.value.responseStatus, 'pending'); // An intended role never confirms attendance.
  for (const participationForms of [null, 'speaker', ['speaker', 'speaker'], ['unknown'], [true], Array(2), Array(8).fill('host')]) {
    assert.equal(validateContactOperations({ ...base, participationForms }).valid, false);
  }
  const stored = contact(); delete stored.operations.participationForms;
  assert.equal(validateStoredContact(stored), true);
  stored.operations.participationForms = ['student_showcase', 'booth'];
  assert.equal(validateStoredContact(stored), true);
  stored.operations.participationForms = ['automatic_publication'];
  assert.equal(validateStoredContact(stored), false);
});
