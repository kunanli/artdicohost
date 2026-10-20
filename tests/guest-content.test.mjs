import test from 'node:test';
import assert from 'node:assert/strict';
import { validateContent, toPublicContent, MAX_CONTENT_ITEMS } from '../shared/content-schema.mjs';
import { createInitialContent } from '../src/config/content.mjs';

const portraitId = 'a'.repeat(64) + '.png';
const guest = (overrides = {}) => ({
  id: 'synthetic-guest', name: '合成嘉宾', company: '合成公司', ggjRole: '',
  portraitId, status: 'confirmed', publicConsent: true, internalNotes: 'PRIVATE-GUEST-NOTE', ...overrides,
});
function fixture() {
  const content = createInitialContent();
  content.guests = [guest()];
  content.sessions[0] = { ...content.sessions[0], guestId: 'synthetic-guest', speakerName: 'PRIVATE-STALE-COPIED-NAME', speakerStatus: 'confirmed' };
  return content;
}

test('version-one drafts without guests and guestId retain legacy speaker publication', () => {
  const content = createInitialContent();
  delete content.guests;
  delete content.sessions[0].guestId;
  content.sessions[0].speakerName = '合成旧版讲者';
  content.sessions[0].speakerStatus = 'confirmed';
  const normalized = validateContent(content);
  assert.equal(normalized.valid, true);
  assert.deepEqual(normalized.value.guests, []);
  assert.equal(normalized.value.sessions[0].guestId, '');
  assert.equal(toPublicContent(content).sessions[0].speakerName, '合成旧版讲者');
  for (const malformed of [null, {}, 'guests', 1]) {
    assert.equal(validateContent({ ...content, guests: malformed }).valid, false);
  }
});

test('guest publication is explicit, minimal and idempotent; linked sessions derive their approved speaker', () => {
  const content = fixture();
  const value = toPublicContent(content);
  assert.equal(value.guests.length, 1);
  assert.deepEqual(value.guests[0], {
    id: 'synthetic-guest', name: '合成嘉宾', company: '合成公司', ggjRole: '', portraitId,
    portraitUrl: '/api/public/portraits/' + portraitId, status: 'confirmed', publicConsent: true,
  });
  assert.equal(value.sessions[0].guestId, 'synthetic-guest');
  assert.equal(value.sessions[0].speakerName, '合成嘉宾');
  assert.equal(value.sessions[0].speakerStatus, 'confirmed');
  assert.equal(JSON.stringify(value).includes('PRIVATE-'), false);
  assert.deepEqual(toPublicContent(value), value);
  assert.equal(content.sessions[0].speakerName, 'PRIVATE-STALE-COPIED-NAME');
  value.guests[0].name = 'changed';
  assert.equal(content.guests[0].name, '合成嘉宾');
});

test('pending, unapproved or incomplete draft guests cannot leak through linked session names', () => {
  for (const changes of [
    { status: 'pending' }, { publicConsent: false },
    { status: 'pending', name: '', company: '', portraitId: '' },
    { publicConsent: false, portraitId: '' },
  ]) {
    const content = fixture();
    Object.assign(content.guests[0], changes);
    const published = toPublicContent(content);
    assert.deepEqual(published.guests, []);
    assert.equal(published.sessions[0].guestId, '');
    assert.equal(published.sessions[0].speakerName, '');
    assert.equal(published.sessions[0].speakerStatus, 'pending');
    assert.equal(JSON.stringify(published).includes('PRIVATE-'), false);
  }
});

test('guest validation rejects unknown references, duplicate IDs, remote images, forged consent and overflows', () => {
  const cases = [
    ['guests.0.name', { name: '' }],
    ['guests.0.company', { company: '' }],
    ['guests.0.ggjRole', { ggjRole: '字'.repeat(161) }],
    ['guests.0.publicConsent', { publicConsent: 'true' }],
    ['guests.0.publicConsent', { publicConsent: 1 }],
    ['guests.0.portraitId', { portraitId: '' }],
    ['guests.0.portraitId', { portraitId: 'https://example.invalid/photo.jpg' }],
    ['guests.0.portraitId', { portraitId: '../photo.png' }],
    ['guests.0.portraitId', { portraitId: 'a'.repeat(64) + '.svg' }],
    ['guests.0.portraitId', { portraitId: 42 }],
    ['guests.0.status', { status: 'invited' }],
  ];
  for (const [field, changes] of cases) {
    const content = fixture();
    Object.assign(content.guests[0], changes);
    assert.ok(validateContent(content).errors[field], field);
  }
  for (const guestId of ['missing-guest', 42, {}]) {
    const content = fixture();
    content.sessions[0].guestId = guestId;
    assert.ok(validateContent(content).errors['sessions.0.guestId']);
  }
  const content = fixture();
  content.guests.push(guest());
  assert.ok(validateContent(content).errors['guests.1.id']);
  content.guests = [guest({ id: content.sessions[0].id })];
  assert.ok(validateContent(content).errors['sessions.0.id']);
  content.guests = Array.from({ length: MAX_CONTENT_ITEMS + 1 }, (_, index) => guest({ id: 'synthetic-' + index, status: 'pending', publicConsent: false }));
  assert.ok(validateContent(content).errors.guests);
});

test('guest display fields reject raw single-line controls, while private notes remain multiline', () => {
  for (const field of ['name', 'company', 'ggjRole']) {
    for (const control of ['\0', '\t', '\n', '\r', '\x1f', '\x7f']) {
      const content = fixture();
      content.guests[0][field] = control + '合成单行' + control;
      const result = validateContent(content);
      assert.equal(result.valid, false);
      assert.ok(result.errors['guests.0.' + field]);
      assert.throws(() => toPublicContent(content), /校验/u);
    }
  }
  const content = fixture();
  content.guests[0].internalNotes = '内部第一行\n内部第二行\t备注';
  assert.equal(validateContent(content).valid, true);
  assert.equal(JSON.stringify(toPublicContent(content)).includes('内部'), false);
});

test('guest contact links are optional, private and unique to prevent duplicate invitee profiles', () => {
  const content = fixture();
  content.guests[0].contactId = 'synthetic-contact';
  assert.equal(validateContent(content).valid, true);
  assert.equal(validateContent(content).value.guests[0].contactId, 'synthetic-contact');
  assert.equal(JSON.stringify(toPublicContent(content)).includes('synthetic-contact'), false);
  assert.equal(JSON.stringify(toPublicContent(content)).includes('contactId'), false);
  content.guests.push(guest({ id: 'second-guest', contactId: 'synthetic-contact' }));
  assert.ok(validateContent(content).errors['guests.1.contactId']);
  for (const contactId of [12, {}, '../contact', '']) {
    content.guests = [guest({ contactId })];
    assert.equal(validateContent(content).valid, contactId === '');
  }
});
