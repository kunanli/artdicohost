import test from 'node:test';
import assert from 'node:assert/strict';
import { publicGuestCards } from '../shared/guest-display.mjs';
import { toPublicContent } from '../shared/content-schema.mjs';
import { createInitialContent } from '../src/config/content.mjs';
const person = (overrides = {}) => ({ id: 'synthetic-guest', name: '合成嘉宾', company: '合成机构', ggjRole: '', portraitId: 'a'.repeat(64) + '.png', status: 'confirmed', publicConsent: true, ...overrides });

test('guest display defaults public independently of confirmation or legacy consent and whitelists fields', () => {
  const value = person({ ggjRole: '合成站点职务', internalNotes: 'PRIVATE-NOTE', email: 'private@example.invalid', portraitUrl: 'https://untrusted.example/track.png' });
  assert.deepEqual(publicGuestCards([value]), [{ id: value.id, name: value.name, company: value.company, ggjRole: value.ggjRole,
    portraitId: value.portraitId, portraitUrl: '/api/public/portraits/' + value.portraitId }]);
  assert.equal(publicGuestCards([person({status:'pending',publicConsent:false})])[0].status,'pending');
  assert.equal(publicGuestCards([person({publicConsent:false})]).length,1);
  for (const override of [{ visibility:'private' }, { visibility:'' }, { visibility:undefined }, { status: 'approved' }]) {
    assert.deepEqual(publicGuestCards([person(override)]), []);
  }
  assert.equal(value.internalNotes, 'PRIVATE-NOTE');
});

test('portraits cannot point to remote hosts, traversal paths or active image formats', () => {
  for (const portraitId of ['https://untrusted.example/a.png', '../photo.png', 'a'.repeat(64) + '.svg', 'a'.repeat(64) + '.png?track=1', 'a'.repeat(63) + '.png']) {
    assert.deepEqual(publicGuestCards([person({ portraitId })]), []);
  }
  for (const extension of ['jpg', 'png', 'webp']) assert.equal(publicGuestCards([person({ portraitId: 'a'.repeat(64) + '.' + extension })]).length, 1);
});

test('an authorized confirmed guest without a photo keeps a card without any image URL', () => {
  const content = createInitialContent();
  content.guests = [person({ portraitId: '', publicRoles: [] })];
  const published = toPublicContent(content), cards = publicGuestCards(published.guests);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].portraitId, ''); assert.equal(cards[0].portraitUrl, '');
  assert.deepEqual(toPublicContent(published), published);
  for (const changes of [{ status: 'pending' }, { publicConsent: false }]) {
    assert.equal(publicGuestCards([{ ...content.guests[0], ...changes }]).length, 1);
  }
  for (const portraitId of [null, undefined, false, {}, '../not-an-image']) {
    assert.deepEqual(publicGuestCards([person({ portraitId })]), []);
  }
});

test('malformed, duplicate or over-limit entries cannot introduce misleading guest cards', () => {
  for (const value of [undefined, null, {}, new Array(201).fill(person())]) assert.deepEqual(publicGuestCards(value), []);
  for (const override of [{ id: '__proto__' }, { name: '' }, { name: 'x'.repeat(121) }, { company: '' }, { ggjRole: 12 }, { company: 'hidden\nrole' }]) {
    assert.deepEqual(publicGuestCards([person(override)]), []);
  }
  assert.equal(publicGuestCards([person(), person()]).length, 1);
  const accessor = person();
  Object.defineProperty(accessor, 'name', { get() { assert.fail('Display does not run arbitrary getters'); } });
  assert.deepEqual(publicGuestCards([accessor]), []);
  assert.equal(publicGuestCards([person()])[0].ggjRole, '');
});

test('guest cards consume the actual backend publication contract including stable mixed-case IDs', () => {
  const content = createInitialContent();
  content.guests = [person({ id: 'Guest_1', name: '🎮'.repeat(120) }), person({ id: 'pending-guest', status: 'pending' })];
  const published = toPublicContent(content);
  const cards = publicGuestCards(published.guests);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].id, 'Guest_1');
  assert.equal(cards[0].name, content.guests[0].name);
});

test('pending guest display has honest fallbacks and explicit manual privacy survives incomplete data',()=>{
  const value=person({name:'',company:'',portraitId:'',status:'pending',publicConsent:false});
  const cards=publicGuestCards([value]);
  assert.equal(cards[0].name,'嘉宾姓名待补');assert.equal(cards[0].company,'');assert.equal(cards[0].portraitUrl,'');assert.equal(cards[0].status,'pending');
  assert.equal(publicGuestCards([{...value,visibility:'private'}]).length,0);
  assert.equal(publicGuestCards([{...value,visibility:'public'}]).length,1);
  const original=JSON.stringify(value);publicGuestCards([value]);assert.equal(JSON.stringify(value),original);
  const accessor=person();Object.defineProperty(accessor,'visibility',{get(){assert.fail('visibility getters must not execute');}});
  assert.deepEqual(publicGuestCards([accessor]),[]);
});
