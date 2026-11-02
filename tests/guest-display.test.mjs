import test from 'node:test';
import assert from 'node:assert/strict';
import { publicGuestCards, publicGuestAffiliation, publicGuestSubtitle } from '../shared/guest-display.mjs';
import { toPublicContent } from '../shared/content-schema.mjs';
import { createInitialContent } from '../src/config/content.mjs';
const attendance = (confirmedGuestIds = ['synthetic-guest']) => ({ schemaVersion: 1, sourceRevision: 1, confirmedGuestIds });
const confirmedCards = input => publicGuestCards(input, attendance());
const person = (overrides = {}) => ({ id: 'synthetic-guest', name: '合成嘉宾', company: '合成机构', ggjRole: '', portraitId: 'a'.repeat(64) + '.png', status: 'confirmed', publicConsent: true, ...overrides });

test('bubble affiliation and position remain separate when both public fields are present',()=>{
  assert.equal(publicGuestAffiliation({company:'  合成机构 ',title:'合成技术总监'}),'合成机构');
  assert.deepEqual(publicGuestSubtitle({title:'  合成技术总监 ',ggjRole:'合成组织者',company:'合成机构'}),{text:'合成技术总监',kind:'title'});
  assert.deepEqual(publicGuestSubtitle({title:'',ggjRole:'合成组织者',company:'合成机构'}),{text:'合成组织者',kind:'role'});
  assert.deepEqual(publicGuestSubtitle({company:'合成机构'}),{text:'',kind:'none'});
});
test('bubble subtitle never invents a position from a name or private notes',()=>{
  assert.deepEqual(publicGuestSubtitle({name:'合成姓名',internalNotes:'合成私有职位'}),{text:'',kind:'none'});
  assert.deepEqual(publicGuestSubtitle(null),{text:'',kind:'none'});
});
test('bubble affiliation only uses a valid public company and never invokes getters',()=>{
  const value={title:'合成职位',internalNotes:'合成私有单位'};
  Object.defineProperty(value,'company',{get(){throw Error('must not read getter');}});
  assert.equal(publicGuestAffiliation(value),'');
  for(const input of [null,{},value,{company:'a'.repeat(161)},{company:'单位\n私密'}, {company:{toString(){throw Error('must not coerce');}}}])assert.equal(publicGuestAffiliation(input),'');
  assert.equal(publicGuestAffiliation(Object.assign(Object.create(null),{company:' 合成单位 '})),'合成单位');
});
test('bubble subtitle does not invoke accessors or display unsafe field values',()=>{
  const value={company:'安全公开机构',ggjRole:'无效\n身份'};
  Object.defineProperty(value,'title',{get(){throw Error('must not invoke an accessor');}});
  assert.deepEqual(publicGuestSubtitle(value),{text:'',kind:'none'});
  assert.equal(publicGuestAffiliation(value),'安全公开机构');
});

test('legacy published profiles remain visible as attendance pending without changing the publication or private facts', () => {
  const content = createInitialContent();
  content.guests = Array.from({ length: 9 }, (_, index) => person({ id: 'published-' + index,
    status: index === 0 ? 'pending' : 'confirmed', publicConsent: false,
    internalNotes: 'PRIVATE-NOTE', contactId: 'private-contact-' + index }));
  const published = toPublicContent(content), before = JSON.stringify(published), cards = publicGuestCards(published.guests);
  assert.equal(Object.hasOwn(published, 'guestAttendance'), false);
  assert.equal(cards.length, 9);
  assert.ok(cards.every(item => item.attendance === 'pending'));
  assert.equal(cards[0].status, 'pending');
  assert.equal(Object.hasOwn(cards[1], 'status'), false);
  assert.doesNotMatch(JSON.stringify(cards), /PRIVATE-|contactId|publicConsent|sourceRevision|private-contact/u);
  assert.equal(JSON.stringify(published), before);
  assert.deepEqual(toPublicContent(published), published);
  cards[0].name = '仅修改显示副本';
  assert.equal(JSON.stringify(published), before);
});

test('display validates privacy, photos and fields while corrupt proofs never fall back', () => {
  const hidden = person({ id: 'private-guest', visibility: 'private' });
  assert.deepEqual(publicGuestCards([hidden]), []);
  for (const patch of [{ visibility: undefined }, { status: 'approved' }, { portraitId: '../photo.png' }, { name: '' }]) {
    assert.deepEqual(publicGuestCards([person(patch)]), []);
  }
  const accessor = person();
  Object.defineProperty(accessor, 'name', { get() { assert.fail('legacy display must not execute getters'); } });
  assert.deepEqual(publicGuestCards([accessor]), []);
  for (const proof of [null, {}, { ...attendance(), confirmedGuestIds: ['missing'] }]) {
    assert.deepEqual(publicGuestCards([person()], proof), []);
  }
  assert.equal(publicGuestCards([person()], attendance([]))[0].attendance, 'pending');
  assert.equal(confirmedCards([person()])[0].attendance, 'attending');
});

test('proved attendance keeps profile confirmation and legacy consent independent while whitelisting fields', () => {
  const value = person({ ggjRole: '合成站点职务', internalNotes: 'PRIVATE-NOTE', email: 'private@example.invalid', portraitUrl: 'https://untrusted.example/track.png' });
  assert.deepEqual(confirmedCards([value]), [{ id: value.id, name: value.name, company: value.company, ggjRole: value.ggjRole,
    portraitId: value.portraitId, portraitUrl: '/api/public/portraits/' + value.portraitId, attendance: 'attending' }]);
  assert.equal(confirmedCards([person({status:'pending',publicConsent:false})])[0].status,'pending');
  assert.equal(confirmedCards([person({publicConsent:false})]).length,1);
  for (const override of [{ visibility:'private' }, { visibility:'' }, { visibility:undefined }, { status: 'approved' }]) {
    assert.deepEqual(confirmedCards([person(override)]), []);
  }
  assert.equal(value.internalNotes, 'PRIVATE-NOTE');
});

test('portraits cannot point to remote hosts, traversal paths or active image formats', () => {
  for (const portraitId of ['https://untrusted.example/a.png', '../photo.png', 'a'.repeat(64) + '.svg', 'a'.repeat(64) + '.png?track=1', 'a'.repeat(63) + '.png']) {
    assert.deepEqual(confirmedCards([person({ portraitId })]), []);
  }
  for (const extension of ['jpg', 'png', 'webp']) assert.equal(confirmedCards([person({ portraitId: 'a'.repeat(64) + '.' + extension })]).length, 1);
});

test('an authorized confirmed guest without a photo keeps a card without any image URL', () => {
  const content = createInitialContent();
  content.guests = [person({ portraitId: '', publicRoles: [] })];
  const published = toPublicContent(content), cards = confirmedCards(published.guests);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].portraitId, ''); assert.equal(cards[0].portraitUrl, '');
  assert.deepEqual(toPublicContent(published), published);
  for (const changes of [{ status: 'pending' }, { publicConsent: false }]) {
    assert.equal(confirmedCards([{ ...content.guests[0], ...changes }]).length, 1);
  }
  for (const portraitId of [null, undefined, false, {}, '../not-an-image']) {
    assert.deepEqual(confirmedCards([person({ portraitId })]), []);
  }
});

test('malformed, duplicate or over-limit entries cannot introduce misleading guest cards', () => {
  for (const value of [undefined, null, {}, new Array(201).fill(person())]) assert.deepEqual(confirmedCards(value), []);
  for (const override of [{ id: '__proto__' }, { name: '' }, { name: 'x'.repeat(121) }, { company: '' }, { ggjRole: 12 }, { company: 'hidden\nrole' }]) {
    assert.deepEqual(confirmedCards([person(override)]), []);
  }
  assert.equal(confirmedCards([person(), person()]).length, 1);
  const accessor = person();
  Object.defineProperty(accessor, 'name', { get() { assert.fail('Display does not run arbitrary getters'); } });
  assert.deepEqual(confirmedCards([accessor]), []);
  assert.equal(confirmedCards([person()])[0].ggjRole, '');
});

test('guest cards consume the actual backend publication contract including stable mixed-case IDs', () => {
  const content = createInitialContent();
  content.guests = [person({ id: 'Guest_1', name: '🎮'.repeat(120) }), person({ id: 'pending-guest', status: 'pending' })];
  const published = toPublicContent(content);
  const cards = publicGuestCards(published.guests, attendance(published.guests.map(item => item.id)));
  assert.equal(cards.length, 2);
  assert.equal(cards[0].id, 'Guest_1');
  assert.equal(cards[0].name, content.guests[0].name);
});

test('pending guest display has honest fallbacks and explicit manual privacy survives incomplete data',()=>{
  const value=person({name:'',company:'',portraitId:'',status:'pending',publicConsent:false});
  const cards=confirmedCards([value]);
  assert.equal(cards[0].name,'嘉宾姓名待补');assert.equal(cards[0].company,'');assert.equal(cards[0].portraitUrl,'');assert.equal(cards[0].status,'pending');
  assert.equal(confirmedCards([{...value,visibility:'private'}]).length,0);
  assert.equal(confirmedCards([{...value,visibility:'public'}]).length,1);
  const original=JSON.stringify(value);confirmedCards([value]);assert.equal(JSON.stringify(value),original);
  const accessor=person();Object.defineProperty(accessor,'visibility',{get(){assert.fail('visibility getters must not execute');}});
  assert.deepEqual(confirmedCards([accessor]),[]);
});
