import test from 'node:test';
import assert from 'node:assert/strict';
import { createOssObjectClient } from '../functions/cloud-content/oss-client.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { CloudContentError } from '../functions/cloud-content/errors.mjs';
import { fakeCredentials, fixedClock, objectFixture } from './cloud-oss-fixture.mjs';

const prefix = 'cms/v1/content', logKey = prefix + '/commits.jsonl';
const make = (fixture, options = {}) => createObjectJournal({ objects: createOssObjectClient({ credentials: async () => fakeCredentials, clock: fixedClock, fetchFn: fixture.fetchFn }), prefix, ...options });
const opaque = error => error instanceof CloudContentError && error.status === 503 && !/PRIVATE|cms\/v1|Example|raw|secret/iu.test(error.message + JSON.stringify(error));

test('immutable value snapshots and compact commit references survive independent journal instances', async () => {
  const fixture = objectFixture(), first = make(fixture);
  const initial = await first.read(); assert.deepEqual(initial, { value: null, cursor: { position: 0, version: 0, hash: null } });
  const value = { draft: { revision: 1, title: '合成活动' }, published: null, audit: [{ action: 'save' }] };
  const saved = await first.commit(initial.cursor, value);
  assert.equal(saved.cursor.version, 1); assert.equal(saved.cursor.hash.length, 64);
  const reloaded = await make(fixture).read(); assert.deepEqual(reloaded, saved);
  value.draft.title = 'not persisted'; assert.equal((await first.read()).value.draft.title, '合成活动');
  const published = await make(fixture).commit(reloaded.cursor, { ...reloaded.value, published: { title: '合成活动' } });
  assert.equal(published.cursor.version, 2);
  const records = fixture.stored.get(logKey).data.toString().trim().split('\n').map(line => JSON.parse(line));
  assert.equal(records.length, 2); assert.equal(records[1].previousHash, records[0].hash);
  assert.equal('draft' in records[0], false); assert.ok(records.every(record => Buffer.byteLength(JSON.stringify(record)) < 512));
  assert.deepEqual((await make(fixture).read()).value, published.value);
});

test('two independent clients competing at the same cursor have exactly one atomic winner', async () => {
  const fixture = objectFixture(), first = make(fixture), second = make(fixture);
  const [a, b] = await Promise.all([first.read(), second.read()]);
  const results = await Promise.allSettled([first.commit(a.cursor, { writer: 'one' }), second.commit(b.cursor, { writer: 'two' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const failed = results.find(r => r.status === 'rejected').reason;
  assert.ok(failed instanceof CloudContentError); assert.equal(failed.code, 'WRITE_CONFLICT'); assert.equal(failed.status, 409);
  const current = await make(fixture).read(); assert.equal(current.cursor.version, 1);
  assert.deepEqual(current.value, results.find(r => r.status === 'fulfilled').value.value);
  assert.equal(fixture.stored.get(logKey).data.toString().trim().split('\n').length, 1);
});

test('stale, fabricated and accessor cursors are rejected without staging snapshots or committing', async () => {
  const fixture = objectFixture(), journal = make(fixture), initial = await journal.read();
  await journal.commit(initial.cursor, { saved: true });
  const count = fixture.stored.size;
  for (const cursor of [initial.cursor, { position: 99, version: 1, hash: 'a'.repeat(64) }, { position: 0, version: 0, hash: 'a'.repeat(64) }, { position: 0, version: 0, hash: null, extra: true }, Object.defineProperty({ position: 0, version: 0, hash: null }, 'position', { get() { throw new Error('PRIVATE'); }, enumerable: true })]) {
    await assert.rejects(journal.commit(cursor, { saved: false }), error => error.code === 'WRITE_CONFLICT' && error.status === 409);
    assert.equal(fixture.stored.size, count);
  }
});

test('snapshot write, readback and append must each complete before success, with no retries after unknown outcomes', async () => {
  for (const stage of ['snapshot', 'readback', 'append-before', 'append-after', 'log-readback']) {
    const fixture = objectFixture(), base = createOssObjectClient({ credentials: async () => fakeCredentials, fetchFn: fixture.fetchFn, clock: fixedClock });
    let appendCalls = 0, afterAppend = false;
    const objects = {
      get: async (key, options) => { if (stage === 'readback' && key.includes('/blobs/')) return null; if (stage === 'log-readback' && afterAppend) throw new Error('PRIVATE'); return base.get(key, options); },
      putImmutable: async (...args) => { if (stage === 'snapshot') throw new Error('PRIVATE'); return base.putImmutable(...args); },
      append: async (...args) => { appendCalls++; if (stage === 'append-before') throw new Error('PRIVATE'); const result = await base.append(...args); afterAppend = true; if (stage === 'append-after') throw new Error('PRIVATE'); return result; },
    };
    const journal = createObjectJournal({ objects, prefix });
    await assert.rejects(journal.commit((await journal.read()).cursor, { example: true }), opaque);
    assert.ok(appendCalls <= 1);
    if (stage === 'append-after' || stage === 'log-readback') assert.deepEqual((await make(fixture).read()).value, { example: true });
    else assert.equal(await base.get(logKey), null);
  }
});

test('corrupt, truncated, reordered or mismatching log chains never reset to a seed', async () => {
  for (const change of [data => data.subarray(0, data.length - 1), data => Buffer.from(data.toString().replace('"version":1', '"version":2')), data => Buffer.from(data.toString().replace('"previousHash":null', '"previousHash":"' + 'a'.repeat(64) + '"')), data => Buffer.from(data.toString().replace('{', '{ ')), data => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), data]), data => Buffer.concat([data, data]), () => Buffer.from('{"broken":true}\n'), () => Buffer.from([0xff, 10]), () => Buffer.alloc(0)]) {
    const fixture = objectFixture(), journal = make(fixture);
    await journal.commit((await journal.read()).cursor, { example: true });
    fixture.stored.get(logKey).data = change(fixture.stored.get(logKey).data);
    const writes = fixture.calls.filter(call => call.method !== 'GET').length;
    await assert.rejects(make(fixture).read(), opaque);
    assert.equal(fixture.calls.filter(call => call.method !== 'GET').length, writes);
  }
});

test('missing, wrong-hash and invalid latest snapshots are errors rather than empty content', async () => {
  for (const change of ['missing', 'wrong-hash', 'invalid-json']) {
    const fixture = objectFixture(), journal = make(fixture);
    const committed = await journal.commit((await journal.read()).cursor, { example: true });
    const key = [...fixture.stored.keys()].find(key => key.includes('/blobs/'));
    if (change === 'missing') fixture.stored.delete(key);
    else fixture.stored.get(key).data = Buffer.from(change === 'wrong-hash' ? '{"example":false}' : '{');
    await assert.rejects(make(fixture).read(), opaque);
    const writes = fixture.calls.filter(call => call.method !== 'GET').length;
    await assert.rejects(make(fixture).commit(committed.cursor, { replacement: true }), opaque);
    assert.equal(fixture.calls.filter(call => call.method !== 'GET').length, writes);
  }
});

test('log and value capacity, non-JSON values and unsafe shapes fail before the commit point', async () => {
  const fixture = objectFixture(), bounded = make(fixture, { maxValueBytes: 32, maxLogBytes: 400 });
  const initial = await bounded.read();
  const cycle = {}; cycle.self = cycle;
  let invoked = false;
  const nonenumerable = Object.defineProperty({}, 'toJSON', { value() { invoked = true; return { altered: true }; } });
  for (const value of [{ large: 'x'.repeat(100) }, { n: NaN }, { missing: undefined }, { bad: () => {} }, cycle, Object.defineProperty({}, 'secret', { get() { throw new Error('PRIVATE'); }, enumerable: true }), nonenumerable, { date: new Date() }, JSON.parse('{"__proto__":{"a":1}}'), { array: Array(2) }, { array: Object.assign([], { named: true }) }]) await assert.rejects(bounded.commit(initial.cursor, value), opaque);
  assert.equal(invoked, false);
  assert.equal(fixture.calls.filter(call => call.method !== 'GET').length, 0);
  await bounded.commit(initial.cursor, { n: 1 });
  const before = await bounded.read();
  await assert.rejects(bounded.commit(before.cursor, { n: 2 }), opaque);
  assert.equal((await bounded.read()).value.n, 1);
  const wrong = objectFixture(); wrong.stored.set(logKey, { data: Buffer.from('x'.repeat(501)), objectType: 'Appendable', contentType: 'application/x-ndjson' });
  await assert.rejects(make(wrong, { maxLogBytes: 500 }).read(), opaque);
});

test('readback can include a later commit but only returns the caller own confirmed entry and cursor', async () => {
  const fixture = objectFixture(), base = createOssObjectClient({ credentials: async () => fakeCredentials, fetchFn: fixture.fetchFn, clock: fixedClock });
  let intervened = false;
  const objects = { ...base, append: async (...args) => {
    const ack = await base.append(...args);
    if (!intervened) { intervened = true; const newer = make(fixture), current = await newer.read(); await newer.commit(current.cursor, { newer: true }); }
    return ack;
  } };
  const journal = createObjectJournal({ objects, prefix }), initial = await journal.read();
  const result = await journal.commit(initial.cursor, { original: true });
  assert.deepEqual(result.value, { original: true }); assert.equal(result.cursor.version, 1);
  const latest = await make(fixture).read(); assert.deepEqual(latest.value, { newer: true }); assert.equal(latest.cursor.version, 2);
});

test('injected storage failures are normalized and never expose arbitrary CloudContentError fields', async () => {
  const objects = { get: async () => { const e = new CloudContentError('PRIVATE', 'PRIVATE_SECRET'); e.key = logKey; throw e; }, putImmutable: async () => {}, append: async () => {} };
  await assert.rejects(createObjectJournal({ objects, prefix }).read(), opaque);
});
