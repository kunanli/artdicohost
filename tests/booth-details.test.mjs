import test from 'node:test';
import assert from 'node:assert/strict';
import { validateContent, toPublicContent } from '../shared/content-schema.mjs';
import { buildArrangementOverview } from '../shared/arrangement-overview.mjs';
import { createInitialContent } from '../src/config/content.mjs';

const booth = (patch = {}) => ({ id: 'synthetic-booth', code: 'C01', organization: '合成组织', project: '合成项目标题', zone: 'C', status: 'confirmed', slotNumber: 1, internalNotes: '', ...patch });
const content = (...booths) => ({ ...createInitialContent(), sessions: [], booths });
const overview = value => buildArrangementOverview({ content: value, contacts: [], contentRevision: 1, contactsRevision: 0 });

test('booth occupants retain private responsible contact details and publish only confirmed description with project title', () => {
  const source = content(
    booth({ contactName: '  PRIVATE-RESPONSIBLE  ', contactMethods: 'PRIVATE-PHONE\nPRIVATE-WECHAT', description: '  合成展位内容\n试玩与交流  ' }),
    booth({ id: 'pending', code: 'C02', slotNumber: 2, status: 'pending', organization: '', project: '', contactName: 'PRIVATE-PENDING', contactMethods: 'PRIVATE-CONTACT', description: 'PRIVATE-PENDING-DESCRIPTION' }),
    booth({ id: 'cancelled', code: 'C03', slotNumber: 3, status: 'cancelled', description: 'PRIVATE-CANCELLED-DESCRIPTION' }),
  );
  const before = structuredClone(source), checked = validateContent(source);
  assert.equal(checked.valid, true, JSON.stringify(checked.errors));
  assert.equal(checked.value.booths[0].contactName, 'PRIVATE-RESPONSIBLE');
  assert.equal(checked.value.booths[0].contactMethods, 'PRIVATE-PHONE\nPRIVATE-WECHAT');
  assert.equal(checked.value.booths[0].description, '合成展位内容\n试玩与交流');
  const published = toPublicContent(source);
  assert.equal(published.booths.length, 1); assert.equal(published.booths[0].project, '合成项目标题');
  assert.equal(published.booths[0].description, '合成展位内容\n试玩与交流');
  assert.equal(JSON.stringify(published).includes('PRIVATE-'), false);
  for (const name of ['contactName', 'contactMethods']) assert.equal(Object.hasOwn(published.booths[0], name), false);
  assert.deepEqual(toPublicContent(published), published);
  assert.deepEqual(source, before);
  const privateView = overview(checked.value);
  assert.equal(privateView.boothRows[0].booth.contactName, 'PRIVATE-RESPONSIBLE');
  assert.equal(privateView.boothRows[0].booth.contactMethods, 'PRIVATE-PHONE\nPRIVATE-WECHAT');
  assert.equal(privateView.boothRows[0].booth.description, '合成展位内容\n试玩与交流');
  assert.equal(privateView.boothRows[1].booth.contactName, 'PRIVATE-PENDING');
});

test('legacy booth shapes never gain optional empty keys and explicit empty additions remain valid and idempotent', () => {
  const legacy = content(booth()), checked = validateContent(legacy);
  assert.equal(checked.valid, true);
  for (const name of ['contactName', 'contactMethods', 'description']) {
    assert.equal(Object.hasOwn(checked.value.booths[0], name), false);
    assert.equal(Object.hasOwn(toPublicContent(legacy).booths[0], name), false);
    assert.equal(Object.hasOwn(overview(checked.value).boothRows[0].booth, name), false);
  }
  const explicit = content(booth({ contactName: '', contactMethods: '', description: '' }));
  assert.equal(validateContent(explicit).valid, true);
  assert.deepEqual(toPublicContent(toPublicContent(explicit)), toPublicContent(explicit));
  assert.equal(toPublicContent(explicit).booths[0].description, '');
  assert.deepEqual(createInitialContent().booths, [], 'the schema does not fabricate fifteen exhibitors');
});

test('optional booth fields reject wrong types, unsafe controls, accessor values and Unicode length overflow', () => {
  for (const [name, maximum] of Object.entries({ contactName: 120, contactMethods: 500, description: 2000 })) {
    assert.equal(validateContent(content(booth({ [name]: '界'.repeat(maximum) }))).valid, true, name);
    assert.equal(validateContent(content(booth({ [name]: '😀'.repeat(maximum) }))).valid, true, name + ' code points');
    for (const value of [null, undefined, false, 123, [], {}, 'x\u0000y', '界'.repeat(maximum + 1)]) {
      const checked = validateContent(content(booth({ [name]: value })));
      assert.equal(checked.valid, false, name + ':' + String(value));
      assert.ok(checked.errors['booths.0.' + name]);
    }
    let invoked = false;
    const item = booth();
    Object.defineProperty(item, name, { enumerable: true, get() { invoked = true; throw new Error('PRIVATE-GETTER'); } });
    assert.equal(validateContent(content(item)).valid, false); assert.equal(invoked, false);
  }
  assert.ok(validateContent(content(booth({ contactName: 'name\nsecond' }))).errors['booths.0.contactName']);
  assert.equal(validateContent(content(booth({ contactMethods: 'mail@example.invalid\n微信 synthetic', description: '第一行\n第二行' }))).valid, true);
});

test('fifteen independently assigned occupants retain unique physical positions and reject conflicting occupancy', () => {
  const booths = Array.from({ length: 15 }, (_, index) => booth({ id: 'synthetic-' + index, code: 'C' + (index + 1), slotNumber: index + 1,
    organization: '合成组织' + (index + 1), contactName: 'PRIVATE-OWNER-' + index, contactMethods: 'PRIVATE-CONTACT-' + index, description: '合成展位内容' + index }));
  const checked = validateContent(content(...booths)); assert.equal(checked.valid, true);
  assert.deepEqual(overview(checked.value).boothRows.map(row => row.booth.organization), booths.map(item => item.organization));
  assert.equal(toPublicContent(content(...booths)).booths.length, 15);
  booths[14].slotNumber = 1;
  const conflict = validateContent(content(...booths)); assert.equal(conflict.valid, false);
  assert.ok(conflict.errors['booths.0.slotNumber']); assert.ok(conflict.errors['booths.14.slotNumber']);
  for (const slotNumber of [-1, 16, 1.5, '15']) assert.ok(validateContent(content(booth({ slotNumber }))).errors['booths.0.slotNumber']);
  booths[14].status = 'cancelled'; assert.equal(validateContent(content(...booths)).valid, true);
});
