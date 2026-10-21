import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { contentSchema, validateContent, toPublicContent, validateShowcaseOrganizationChanges } from '../shared/content-schema.mjs';
import { createInitialContent } from '../src/config/content.mjs';

const coverId = 'b'.repeat(64) + '.png';
const work = (changes = {}) => ({ id: 'synthetic-work', title: '合成游戏', teamName: '合成团队', school: 'PRIVATE-SCHOOL',
  contactName: 'PRIVATE-CONTACT', email: 'private@example.invalid', wechat: 'PRIVATE-WECHAT', memberCount: 3,
  participationForms: ['booth'], responseStatus: 'attending', materialLinks: 'https://example.invalid/PRIVATE-MATERIAL',
  summary: '合成作品简介', coverId, status: 'confirmed', publicConsent: true, sessionId: '', boothId: 'synthetic-booth', internalNotes: 'PRIVATE-NOTE', ...changes });
const organization = (changes = {}) => ({ id: 'synthetic-organization', name: '合成组织', logoId: '', website: 'https://example.invalid/',
  participation: 'attendee', status: 'confirmed', publicConsent: true, internalNotes: 'PRIVATE-ORG', ...changes });
function content() {
  const value = createInitialContent(); value.sessions = []; value.guests = [];
  value.booths = [{ id: 'synthetic-booth', code: 'C01', organization: '合成展位组织', project: '合成展位内容', zone: 'C', status: 'confirmed', slotNumber: 0, internalNotes: '' }];
  value.showcases = [work()]; return value;
}

test('optional work metadata preserves legacy normalized and public byte shapes without backfilling display defaults', () => {
  const legacy = content(), before = structuredClone(legacy), normalized = validateContent(legacy);
  assert.equal(normalized.valid, true);
  assert.deepEqual(contentSchema.showcaseKinds, ['student', 'indie', 'team']);
  for (const item of [normalized.value.showcases[0], toPublicContent(legacy).showcases[0]]) {
    assert.equal(Object.hasOwn(item, 'kind'), false); assert.equal(Object.hasOwn(item, 'organizationId'), false);
  }
  assert.deepEqual(legacy, before);
  // This isolated, fixed fixture is also checked against the pre-change schema below.
  const projection = toPublicContent(legacy);
  assert.equal(createHash('sha256').update(JSON.stringify(projection.showcases)).digest('hex'), '55f8421a8df97e99b9bbd62ef34576bd77434ef00aa7d85423566627abd06d6e');
  assert.deepEqual(toPublicContent(projection), projection);
});

test('work categories and optional organization syntax reject null, unknown enum values, controls and accessor fields', () => {
  for (const kind of ['student', 'indie', 'team']) {
    const input = content(); input.showcases[0].kind = kind;
    assert.equal(validateContent(input).valid, true);
    assert.equal(toPublicContent(input).showcases[0].kind, kind);
  }
  for (const [field, values] of [['kind', ['', null, undefined, 'unknown', ' student ', 'student\n', 1, {}]],
    ['organizationId', [null, undefined, {}, 1, '../organization', ' synthetic-organization ', 'x\n']]]) {
    for (const value of values) {
      const input = content(); input.showcases[0][field] = value;
      assert.ok(validateContent(input).errors['showcases.0.' + field], field + ':' + String(value));
      assert.throws(() => toPublicContent(input), TypeError);
    }
    for (const enumerable of [true, false]) {
      const input = content();
      Object.defineProperty(input.showcases[0], field, { enumerable, get() { assert.fail('Optional work accessors must not execute'); } });
      assert.ok(validateContent(input).errors['showcases.0.' + field]);
    }
  }
});

test('public work organization links require the same snapshot organization consent and never expose private fields', () => {
  for (const changes of [{}, { status: 'pending' }, { status: 'withdrawn' }, { publicConsent: false }]) {
    const input = content(); input.organizations = [organization(changes)];
    input.showcases[0].kind = 'indie'; input.showcases[0].organizationId = input.organizations[0].id;
    const projected = toPublicContent(input), visible = !changes.status && changes.publicConsent !== false;
    assert.equal(projected.showcases.length, 1);
    assert.equal(Object.hasOwn(projected.showcases[0], 'organizationId'), visible);
    if (visible) assert.equal(projected.showcases[0].organizationId, 'synthetic-organization');
    assert.deepEqual(toPublicContent(projected), projected);
    for (const privateKey of ['school', 'contactName', 'email', 'wechat', 'memberCount', 'materialLinks', 'internalNotes']) assert.equal(JSON.stringify(projected).includes(privateKey), false);
    assert.equal(JSON.stringify(projected).includes('PRIVATE-'), false);
  }
  for (const organizationId of ['', 'historical-missing-organization']) {
    const input = content(); input.showcases[0].organizationId = organizationId;
    assert.equal(validateContent(input).valid, true);
    assert.equal(Object.hasOwn(toPublicContent(input).showcases[0], 'organizationId'), false);
  }
});

test('new work organization links require explicit saved IDs; unchanged or explicitly cleared orphan history remains valid', () => {
  const current = content(); current.showcases[0].organizationId = 'historical-missing-organization';
  assert.equal(validateShowcaseOrganizationChanges(current, current).valid, true);
  const next = structuredClone(current); next.showcases[0].organizationId = 'new-missing-organization';
  assert.equal(validateShowcaseOrganizationChanges(next, current).valid, false);
  next.organizations = [organization({ id: 'new-missing-organization', publicConsent: false, status: 'pending' })];
  assert.equal(validateShowcaseOrganizationChanges(next, current).valid, true);
  next.showcases[0].organizationId = '';
  assert.equal(validateShowcaseOrganizationChanges(next, current).valid, true);
});

test('several work categories share one booth without turning category or organization linkage into publication approval', () => {
  const input = content(); input.organizations = [organization()];
  input.showcases = ['student', 'indie', 'team'].map((kind, index) => work({ id: 'synthetic-work-' + index, kind, organizationId: 'synthetic-organization' }));
  assert.equal(validateContent(input).valid, true);
  const publicValue = toPublicContent(input);
  assert.equal(publicValue.showcases.length, 3);
  assert.equal(new Set(publicValue.showcases.map(item => item.boothId)).size, 1);
  for (const changes of [{ publicConsent: false }, { status: 'pending' }, { responseStatus: 'declined' }, { participationForms: [], boothId: '' }]) {
    Object.assign(input.showcases[0], work({ ...changes, kind: 'indie', organizationId: 'synthetic-organization' }));
    assert.equal(toPublicContent(input).showcases.some(item => item.id === 'synthetic-work'), false);
  }
});

test('photo-free confirmed consented guests and linked speakers publish without weakening nonempty-image validation', () => {
  const input = content();
  input.guests = [{ id: 'synthetic-guest', name: '合成嘉宾', company: '合成机构', ggjRole: '', portraitId: '', status: 'confirmed', publicConsent: true, internalNotes: 'PRIVATE-NOTE', contactId: 'private-person' }];
  input.sessions = [{ id: 'synthetic-session', start: '10:00', end: '11:00', zone: 'A', title: '合成分享', format: 'talk',
    guestId: 'synthetic-guest', speakerName: 'PRIVATE-STALE-NAME', speakerStatus: 'pending', status: 'scheduled', internalNotes: '' }];
  const published = toPublicContent(input);
  assert.equal(published.guests[0].portraitId, ''); assert.equal(published.guests[0].portraitUrl, '');
  assert.equal(published.sessions[0].speakerName, '合成嘉宾'); assert.equal(published.sessions[0].speakerStatus, 'confirmed');
  assert.deepEqual(toPublicContent(published), published); assert.equal(JSON.stringify(published).includes('PRIVATE-'), false);
  for (const portraitId of [null, 1, 'https://example.invalid/photo.png', '../portrait.png', 'a'.repeat(64) + '.svg']) {
    input.guests[0].portraitId = portraitId;
    assert.ok(validateContent(input).errors['guests.0.portraitId']);
  }
});
