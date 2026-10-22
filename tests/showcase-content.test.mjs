import test from 'node:test';
import assert from 'node:assert/strict';
import { validateContent, toPublicContent, MAX_CONTENT_ITEMS } from '../shared/content-schema.mjs';
import { showcaseSummary, publicShowcaseCards } from '../shared/showcase-display.mjs';
import { createInitialContent } from '../src/config/content.mjs';

const coverId = 'b'.repeat(64) + '.png';
const showcase = changes => ({
  id: 'synthetic-showcase', title: '合成作品', teamName: '合成团队', school: 'PRIVATE-SCHOOL',
  contactName: 'PRIVATE-CONTACT', email: 'private@example.invalid', wechat: 'PRIVATE-WECHAT', memberCount: 3,
  participationForms: ['share', 'booth'], responseStatus: 'attending', materialLinks: 'https://example.invalid/PRIVATE-MATERIAL',
  summary: '合成作品简介', coverId, status: 'confirmed', publicConsent: true,
  sessionId: 'synthetic-session', boothId: 'synthetic-booth', internalNotes: 'PRIVATE-NOTE', ...changes,
});
function fixture() {
  const content = createInitialContent();
  content.sessions = [{ id: 'synthetic-session', start: '15:30', end: '15:40', zone: 'A', title: '合成作品分享', guestId: '', speakerName: '', speakerStatus: 'pending', status: 'scheduled', internalNotes: '' }];
  content.booths = [{ id: 'synthetic-booth', code: 'C01', organization: '合成公开团队', project: '合成作品', zone: 'C', status: 'confirmed', internalNotes: '' }];
  content.showcases = [showcase()];
  return content;
}

test('legacy version-one content normalizes empty showcases; explicit malformed collection and overflows reject', () => {
  const content = fixture();
  delete content.showcases;
  assert.deepEqual(validateContent(content).value.showcases, []);
  for (const malformed of [null, 'showcases', {}, 1]) assert.equal(validateContent({ ...content, showcases: malformed }).valid, false);
  content.showcases = Array.from({ length: MAX_CONTENT_ITEMS + 1 }, (_, index) => showcase({ id: 'synthetic-' + index }));
  assert.ok(validateContent(content).errors.showcases);
  assert.equal(createInitialContent().showcases.length, 0);
});

test('public showcases project only authorized artwork fields and are idempotent across restart', () => {
  const content = fixture();
  const original = structuredClone(content);
  const result = validateContent(content);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  const published = toPublicContent(content);
  assert.deepEqual(published.showcases, [{
    id: 'synthetic-showcase', title: '合成作品', teamName: '合成团队', summary: '合成作品简介', coverId,
    coverUrl: '/api/public/portraits/' + coverId, sessionId: 'synthetic-session', boothId: 'synthetic-booth',
    participationForms: ['booth', 'share'], status: 'confirmed', responseStatus: 'attending', publicConsent: true,
  }]);
  assert.deepEqual(toPublicContent(published), published);
  for (const privateText of ['PRIVATE-', 'private@example.invalid', 'memberCount', 'school', 'contactName', 'wechat', 'materialLinks', 'internalNotes']) assert.equal(JSON.stringify(published).includes(privateText), false, privateText);
  assert.deepEqual(content, original);
  published.showcases[0].title = '修改公开副本';
  assert.equal(content.showcases[0].title, '合成作品');
});

test('visibility alone controls public works while reply and allocation facts stay accurate', () => {
  for (const changes of [{ responseStatus: 'pending' }, { responseStatus: 'declined' }, { status: 'pending' }, { publicConsent: false }, { coverId: '' }, { participationForms: [], sessionId: '', boothId: '' }]) {
    const content = fixture(); Object.assign(content.showcases[0], changes);
    assert.equal(validateContent(content).valid, true, JSON.stringify(changes));
    const shown = toPublicContent(content).showcases[0]; assert.ok(shown);
    for (const field of ['status','responseStatus','publicConsent','coverId']) assert.equal(shown[field],content.showcases[0][field]);
    assert.deepEqual(toPublicContent(toPublicContent(content)),toPublicContent(content));
    content.showcases[0].visibility='private'; assert.deepEqual(toPublicContent(content).showcases,[]);
  }
  const content = fixture(); content.sessions[0].status = 'draft'; content.booths[0].status = 'pending';
  assert.equal(validateContent(content).valid, true);
  let published = toPublicContent(content); assert.equal(published.showcases.length,1);
  assert.deepEqual(published.showcases[0].participationForms, []); assert.equal(published.showcases[0].sessionId,'');assert.equal(published.showcases[0].boothId,'');
  content.sessions[0].status = 'scheduled'; published = toPublicContent(content);
  assert.deepEqual(published.showcases[0].participationForms, ['share']);
  assert.equal(published.showcases[0].boothId, ''); assert.deepEqual(toPublicContent(published), published);
});

test('single-form applications publish their assigned form without requiring a second allocation', () => {
  for (const form of ['booth', 'share']) {
    const content = fixture();
    content.showcases[0].participationForms = [form];
    content.showcases[0][form === 'booth' ? 'sessionId' : 'boothId'] = '';
    assert.equal(validateContent(content).valid, true);
    assert.deepEqual(toPublicContent(content).showcases[0].participationForms, [form]);
  }
});

test('showcase basics, images, participation choices and exact assignments reject malformed values', () => {
  const cases = [
    ['title', ''], ['teamName', ''], ['title', '合成\n作品'], ['school', 12], ['summary', '字'.repeat(301)],
    ['email', 'bad email'], ['email', 'x@example.invalid\n'], ['memberCount', 0], ['memberCount', 51], ['memberCount', 1.1], ['memberCount', '3'], ['memberCount', true],
    ['coverId', 'https://example.invalid/image.png'], ['coverId', '../image.png'], ['coverId', 'a'.repeat(64) + '.svg'],
    ['participationForms', 'share'], ['participationForms', ['share', 'share']], ['participationForms', ['speaker']], ['participationForms', [1]],
    ['responseStatus', 'confirmed'], ['status', 'approved'], ['publicConsent', 'true'], ['sessionId', 'missing'], ['boothId', 'missing'],
    ['materialLinks', 'http://example.invalid/material'], ['materialLinks', 'https://user:password@example.invalid/material'], ['materialLinks', 'javascript:alert(1)'],
    ['materialLinks', Array.from({ length: 11 }, (_, index) => 'https://example.invalid/' + index).join('\n')],
  ];
  for (const [field, value] of cases) {
    const content = fixture();
    content.showcases[0][field] = value;
    const result = validateContent(content);
    assert.equal(result.valid, false, field + ':' + JSON.stringify(value));
    assert.ok(result.errors['showcases.0.' + field], field);
  }
  const content = fixture();
  content.showcases[0].participationForms = ['booth'];
  assert.ok(validateContent(content).errors['showcases.0.sessionId']);
  content.showcases[0].participationForms = ['share'];
  assert.ok(validateContent(content).errors['showcases.0.boothId']);
  content.showcases[0].participationForms = ['share', 'booth'];
  content.sessions[0].status = 'cancelled';
  content.booths[0].status = 'cancelled';
  assert.ok(validateContent(content).errors['showcases.0.sessionId']);
  assert.ok(validateContent(content).errors['showcases.0.boothId']);
});

test('showcase IDs are stable, unique across content collections, and private notes support multiline', () => {
  const content = fixture();
  content.showcases[0].internalNotes = '合成内部备注第一行\n第二行\t设备';
  content.showcases[0].materialLinks += '\nhttps://example.invalid/second';
  assert.equal(validateContent(content).valid, true);
  assert.equal(validateContent(content).value.showcases[0].id, 'synthetic-showcase');
  content.showcases.push(showcase());
  assert.ok(validateContent(content).errors['showcases.1.id']);
  content.showcases = [showcase({ id: 'synthetic-session' })];
  assert.ok(validateContent(content).errors['showcases.0.id']);
});

test('admin showcase summary counts recorded attending group sizes and active allocations independently of publication', () => {
  const content = fixture();
  content.showcases.push(showcase({ id: 'synthetic-private', memberCount: 2, status: 'pending', publicConsent: false, participationForms: ['share'], boothId: '' }));
  content.showcases.push(showcase({ id: 'synthetic-pending', memberCount: 4, responseStatus: 'pending' }));
  content.showcases.push(showcase({ id: 'synthetic-declined', memberCount: 5, responseStatus: 'declined' }));
  assert.deepEqual(showcaseSummary(content.showcases, content), {
    totalTeams: 4, confirmedTeams: 2, confirmedStudents: 5, shareTeams: 2, boothTeams: 1, readyToPublishTeams: 4,
  });
});

test('display cards ignore forged URLs and private fields while accepting public pending work and rejecting opt-outs or malformed cards', () => {
  const published = toPublicContent(fixture());
  const card = published.showcases[0];
  const cards = publicShowcaseCards([{ ...card, coverUrl: 'https://example.invalid/forged', email: 'PRIVATE-EMAIL' }]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].coverUrl, '/api/public/portraits/' + coverId);
  assert.equal(JSON.stringify(cards).includes('PRIVATE-'), false);
  assert.equal(publicShowcaseCards([card, card]).length, 1);
  for (const changes of [{ visibility:'private' }, { coverId: '../test.png' }, { title: 'bad\nname' }, { participationForms: [] }, { boothId: '' }, { summary: '字'.repeat(301) }]) assert.deepEqual(publicShowcaseCards([{ ...card, ...changes }]), []);
  for (const changes of [{status:'pending'},{responseStatus:'pending'},{responseStatus:'declined'},{publicConsent:false},{coverId:''}]) assert.equal(publicShowcaseCards([{...card,...changes}]).length,1);
  assert.deepEqual(publicShowcaseCards([{ ...card, status: undefined }]), []);
  const inherited = Object.create({ ...card });
  assert.deepEqual(publicShowcaseCards([inherited]), []);
});
