import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT_SCHEMA_VERSION, MAX_CONTENT_ITEMS, validateContent, toPublicContent } from '../shared/content-schema.mjs';
import { createInitialContent } from '../src/config/content.mjs';

function emptyContent() { return { ...createInitialContent(), sessions: [], booths: [] }; }

/** @param {Partial<import('../shared/content-schema.mjs').Session>} [overrides] */
function session(overrides = {}) {
  return {
    id: 'session-synthetic-a', start: '10:00', end: '10:30', zone: 'A', title: '合成测试场次',
    speakerName: '', speakerStatus: 'pending', status: 'scheduled', internalNotes: '', ...overrides,
  };
}

/** @param {Partial<import('../shared/content-schema.mjs').Booth>} [overrides] */
function booth(overrides = {}) {
  return {
    id: 'booth-synthetic-c01', code: 'C01', organization: '合成测试机构', project: '合成测试项目', zone: 'C',
    status: 'pending', internalNotes: '', ...overrides,
  };
}

test('seed contains the full fifteen-slot schedule, with stable IDs, no empty B sessions and no invented exhibitors', () => {
  const content = createInitialContent();
  const result = validateContent(content);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(content.schemaVersion, CONTENT_SCHEMA_VERSION);
  assert.equal(content.sessions.length, 43);
  assert.equal(content.sessions.filter((item) => item.zone === 'A').length, 15);
  assert.equal(content.sessions.filter((item) => item.zone === 'B').length, 13);
  assert.equal(content.sessions.filter((item) => item.zone === 'C').length, 15);
  assert.ok(content.sessions.every((item) => item.title !== '—' && item.speakerName === '' && item.speakerStatus === 'pending'));
  assert.deepEqual(content.booths, []);
  assert.equal(content.event.status, 'confirmed');
  assert.equal(content.event.dateStatus, 'confirmed');
  assert.equal(content.event.venueStatus, 'confirmed');
  assert.deepEqual(content.sessions.map((item) => item.id), createInitialContent().sessions.map((item) => item.id));
  const second = createInitialContent();
  second.sessions[0].title = '本次独立编辑';
  assert.notEqual(second.sessions[0].title, content.sessions[0].title);
});

test('schedule validation rejects same-zone intersections, including containment, but allows adjacency and parallel zones', () => {
  const content = emptyContent();
  content.sessions = [session(), session({ id: 'session-second', start: '10:15', end: '10:45' })];
  const overlap = validateContent(content);
  assert.ok(overlap.errors['sessions.0.start']);
  assert.ok(overlap.errors['sessions.1.start']);
  content.sessions[1] = session({ id: 'session-second', start: '10:30', end: '11:00' });
  assert.equal(validateContent(content).valid, true);
  content.sessions[1] = session({ id: 'session-second', zone: 'B' });
  assert.equal(validateContent(content).valid, true);
  content.sessions[1] = session({ id: 'session-second', start: '10:05', end: '10:10' });
  assert.equal(validateContent(content).valid, false);
  content.sessions[1].status = 'draft';
  assert.equal(validateContent(content).valid, true);
  content.sessions[1].status = 'cancelled';
  assert.equal(validateContent(content).valid, true);
});

test('invalid clock times, reversed ranges and cross-day sessions are rejected', () => {
  for (const [start, end] of [['9:30', '10:30'], ['24:00', '24:30'], ['10:00', '10:00'], ['11:00', '10:00'], ['23:00', '01:00'], ['10:60', '11:00']]) {
    const content = emptyContent();
    content.sessions = [session({ start, end })];
    assert.equal(validateContent(content).valid, false, `${start}–${end}`);
  }
});

test('public projection excludes draft sessions, unconfirmed speakers, internal notes and unknown contact fields', () => {
  const content = emptyContent();
  content.sessions = [
    session({ speakerName: 'PRIVATE-PENDING-SPEAKER', internalNotes: 'PRIVATE-STAFF-NOTE' }),
    session({ id: 'session-draft', status: 'draft', title: 'PRIVATE-DRAFT-TITLE', speakerName: 'PRIVATE-DRAFT-SPEAKER', internalNotes: 'PRIVATE-DRAFT-NOTE' }),
    session({ id: 'session-confirmed', zone: 'B', speakerName: '合成公开讲者', speakerStatus: 'confirmed' }),
    session({ id: 'session-cancelled', zone: 'C', status: 'cancelled', speakerName: 'PRIVATE-CANCELLED-PENDING' }),
  ];
  content.booths = [
    booth({ organization: 'PRIVATE-PENDING-EXHIBITOR', internalNotes: 'PRIVATE-BOOTH-NOTE' }),
    booth({ id: 'booth-confirmed', code: 'c02', status: 'confirmed', internalNotes: 'PRIVATE-CONFIRMED-NOTE' }),
    booth({ id: 'booth-cancelled', code: 'C03', status: 'cancelled', organization: 'PRIVATE-CANCELLED-EXHIBITOR' }),
  ];
  /** @type {Record<string,unknown>} */ (content.booths[1]).contactEmail = 'private@example.invalid';
  /** @type {Record<string,unknown>} */ (content.event).internalNotes = 'PRIVATE-EVENT-NOTE';
  const published = toPublicContent(content);
  const serialized = JSON.stringify(published);
  assert.equal(serialized.includes('PRIVATE-'), false);
  assert.equal(serialized.includes('private@example.invalid'), false);
  assert.equal(serialized.includes('internalNotes'), false);
  assert.equal(published.sessions.length, 3);
  assert.equal(published.sessions[0].speakerName, '');
  assert.ok(published.sessions.some((item) => item.speakerName === '合成公开讲者'));
  assert.equal(published.sessions.find((item) => item.id === 'session-cancelled')?.status, 'cancelled');
  assert.equal(published.booths.length, 1);
  assert.equal(published.booths[0].code, 'C02');
  assert.equal(published.booths[0].organization, '合成测试机构');
});

test('stable IDs survive edits and reorder, while duplicate IDs and case-insensitive booth codes are rejected', () => {
  const content = emptyContent();
  content.sessions = [session(), session({ id: 'session-second', zone: 'B' })];
  content.sessions.reverse();
  content.sessions[0].title = '编辑后的标题';
  assert.equal(validateContent(content).value.sessions[0].id, 'session-second');
  content.sessions[1].id = content.sessions[0].id;
  assert.ok(validateContent(content).errors['sessions.1.id']);
  content.sessions = [];
  content.booths = [booth(), booth({ id: 'booth-second', code: 'c01' })];
  assert.ok(validateContent(content).errors['booths.1.code']);
  content.booths[1] = booth({ id: content.booths[0].id, code: 'C02' });
  assert.ok(validateContent(content).errors['booths.1.id']);
});

test('bounds cap both collections, while pending booths can be saved without invented public organization or project', () => {
  const content = emptyContent();
  content.sessions = Array.from({ length: MAX_CONTENT_ITEMS }, (_, index) => session({ id: `draft-${index}`, status: 'draft' }));
  content.booths = Array.from({ length: MAX_CONTENT_ITEMS }, (_, index) => booth({ id: `booth-${index}`, code: `C-${index}`, organization: '', project: '' }));
  assert.equal(validateContent(content).valid, true);
  content.sessions.push(session({ id: 'overflow-session', status: 'draft' }));
  content.booths.push(booth({ id: 'overflow-booth', code: 'OVERFLOW' }));
  const over = validateContent(content);
  assert.ok(over.errors.sessions);
  assert.ok(over.errors.booths);
});

test('confirmed speakers and booths require display content; invalid enums, zones, dates and versions fail closed', () => {
  const content = emptyContent();
  content.sessions = [session({ speakerStatus: 'confirmed', speakerName: '' })];
  content.booths = [booth({ status: 'confirmed', organization: '', project: '', zone: 'A' })];
  const invalid = validateContent(content);
  assert.ok(invalid.errors['sessions.0.speakerName']);
  assert.ok(invalid.errors['booths.0.organization']);
  assert.ok(invalid.errors['booths.0.project']);
  assert.ok(invalid.errors['booths.0.zone']);
  assert.throws(() => toPublicContent(content), TypeError);
  const malformed = emptyContent();
  malformed.schemaVersion = 99;
  malformed.event.date = '2026-02-30';
  malformed.event.timezone = 'NOT_A_TIMEZONE';
  malformed.sessions = [session({ zone: 'Z', status: 'approved', speakerStatus: 'invited' })];
  const result = validateContent(malformed);
  for (const key of ['schemaVersion', 'event.date', 'event.timezone', 'sessions.0.zone', 'sessions.0.status', 'sessions.0.speakerStatus']) assert.ok(result.errors[key], key);
});

test('public output and normalized state do not mutate the draft or share editable object references', () => {
  const draft = createInitialContent();
  const snapshot = structuredClone(draft);
  const normalized = validateContent(draft).value;
  const published = toPublicContent(draft);
  normalized.sessions[0].title = '仅规范化副本编辑';
  published.event.title = '仅公开副本编辑';
  published.sessions[0].title = '仅公开场次副本编辑';
  assert.deepEqual(draft, snapshot);
});

test('legacy sessions and booths normalize unclassified / unpositioned without changing their public payload', () => {
  const content = emptyContent();
  content.sessions = [session({ speakerName: '合成公开讲者', speakerStatus: 'confirmed' })];
  content.booths = [booth({ code: 'C15', status: 'confirmed' })];
  const normalized = validateContent(content);
  assert.equal(normalized.valid, true);
  assert.equal(normalized.value.sessions[0].format, 'other');
  assert.equal(normalized.value.booths[0].slotNumber, 0);
  const published = toPublicContent(content);
  assert.equal(Object.hasOwn(published.sessions[0], 'format'), false);
  assert.equal(Object.hasOwn(published.booths[0], 'slotNumber'), false);
  assert.deepEqual(toPublicContent(published), published);
  // A code which happens to contain digits is never treated as a physical allocation.
  assert.equal(validateContent({ ...content, booths: [booth({ code: 'S15' })] }).value.booths[0].slotNumber, 0);
});

test('fifteen explicit booth positions are bounded and unique among active records; cancelled positions may be reused', () => {
  const content = emptyContent();
  content.booths = Array.from({ length: 15 }, (_, index) => booth({ id: 'synthetic-' + index, code: 'X-' + index, slotNumber: index + 1 }));
  assert.equal(validateContent(content).valid, true);
  for (const value of [-1, 16, 1.5, '1', null, true, NaN, Infinity]) {
    const invalid = { ...content, booths: [booth({ slotNumber: value })] };
    assert.ok(validateContent(invalid).errors['booths.0.slotNumber'], String(value));
  }
  for (const firstStatus of ['pending', 'confirmed']) {
    for (const secondStatus of ['pending', 'confirmed']) {
      const conflicting = { ...content, booths: [booth({ slotNumber: 4, status: firstStatus }), booth({ id: 'second', code: 'DIFFERENT', slotNumber: 4, status: secondStatus })] };
      const result = validateContent(conflicting);
      assert.ok(result.errors['booths.0.slotNumber']);
      assert.ok(result.errors['booths.1.slotNumber']);
    }
  }
  content.booths = [booth({ slotNumber: 15, status: 'cancelled' }), booth({ id: 'new-position-holder', code: 'UNRELATED', slotNumber: 15, status: 'confirmed' })];
  assert.equal(validateContent(content).valid, true);
  assert.equal(toPublicContent(content).booths.length, 1);
  assert.equal(toPublicContent(content).booths[0].slotNumber, 15);
  content.booths[0].slotNumber = 16;
  assert.ok(validateContent(content).errors['booths.0.slotNumber'], 'cancelled records still require a valid position');
  content.booths = [booth(), booth({ id: 'second-unpositioned', code: 'SECOND' })];
  assert.equal(validateContent(content).valid, true, 'many unassigned records may remain at zero');
});

test('session formats accept only explicit supported choices and never infer workshop from titles', () => {
  const content = emptyContent();
  for (const format of ['talk', 'workshop', 'roundtable', 'showcase', 'social', 'break', 'other']) {
    content.sessions = [session({ format, title: '任意合成标题' })];
    assert.equal(validateContent(content).valid, true, format);
    const publicSession = toPublicContent(content).sessions[0];
    assert.equal(publicSession.format, format === 'other' ? undefined : format);
    assert.deepEqual(toPublicContent(toPublicContent(content)), toPublicContent(content));
  }
  for (const format of ['', 'lecture', 'Workshop', 3, null, {}, true, 'talk\n']) {
    content.sessions = [session({ format })];
    assert.ok(validateContent(content).errors['sessions.0.format'], JSON.stringify(format));
  }
  content.sessions = [session({ title: '合成工作坊 · 不据标题猜测形式' })];
  assert.equal(validateContent(content).value.sessions[0].format, 'other');
  const seed = createInitialContent();
  assert.deepEqual(seed.sessions.filter(item => item.format === 'talk').map(item => item.id), [
    'session-ggj-talk-a', 'session-speaker-one-a', 'session-speaker-two-a', 'session-speaker-three-a',
  ]);
  assert.deepEqual(seed.sessions.filter(item => item.format === 'roundtable').map(item => item.id), ['session-speaker-one-b']);
  assert.deepEqual(seed.sessions.filter(item => item.format === 'showcase').map(item => item.id), ['session-student-showcase-a']);
  assert.equal(seed.sessions.filter(item => item.format === 'workshop').length, 0);
  assert.equal(seed.sessions.filter(item => item.format === 'other').length, 37);
  assert.deepEqual(seed.booths, [], 'empty physical positions do not create fictional booth records');
});

test('public position and format additions retain private-field filtering and legacy snapshot idempotence', () => {
  const content = emptyContent();
  content.sessions = [session({ format: 'workshop', internalNotes: 'PRIVATE-WORKSHOP', speakerName: 'PRIVATE-UNCONFIRMED' })];
  content.booths = [booth({ slotNumber: 7, status: 'confirmed', internalNotes: 'PRIVATE-BOOTH' })];
  const published = toPublicContent(content);
  assert.equal(published.sessions[0].format, 'workshop');
  assert.equal(published.booths[0].slotNumber, 7);
  assert.equal(JSON.stringify(published).includes('PRIVATE-'), false);
  assert.deepEqual(toPublicContent(published), published);
  assert.deepEqual(toPublicContent(validateContent(published).value), published);
});
