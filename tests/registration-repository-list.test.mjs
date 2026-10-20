import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createRegistrationRepository, RegistrationStorageError } from '../functions/registration-api/repository.mjs';

const EVENT = 'synthetic-list-event';
const AT = '2026-10-20T00:00:00.000Z';
const hash = value => createHash('sha256').update(value).digest('hex');
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(count) {
  const pending = new Map(), started = [], records = new Map();
  const entries = Array.from({ length: count }, (_, index) => {
    const id = randomBytes(32).toString('base64url');
    const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, kind: 'registration', id, eventId: EVENT, submittedAt: AT,
      fields: { name: 'PRIVATE-SYNTHETIC-' + index }, consent: { accepted: true, version: 'notice-v1', acceptedAt: AT }, provenance: { kind: 'public' } }));
    const recordHash = hash(bytes);
    records.set(recordHash, { bytes, index });
    return { id, keyHash: hash('key-' + index), payloadHash: hash('payload-' + index), recordHash, committedAt: AT };
  });
  const value = { schemaVersion: 1, kind: 'registration_index', eventId: EVENT, revision: count, entries };
  const state = { value, cursor: { version: count, position: count * 350, hash: count ? 'a'.repeat(64) : null } };
  let active = 0, maximum = 0;
  const objects = {
    async get(key) {
      const found = records.get(key.split('/').at(-1).slice(0, -5));
      assert.ok(found);
      active++; maximum = Math.max(maximum, active); started.push(found.index);
      await new Promise(resolve => pending.set(found.index, resolve));
      active--;
      return { objectType: 'Normal', contentType: 'application/json', data: Buffer.from(found.bytes) };
    },
    async putImmutable() { throw new Error('Unexpected write'); },
  };
  const repository = createRegistrationRepository({ eventId: EVENT, objects, journalFor: async () => ({ async read() { return structuredClone(state); }, async commit() { throw new Error('Unexpected write'); } }) });
  return { repository, state, records, started, pending, max: () => maximum, release(index) { const resolve = pending.get(index); pending.delete(index); resolve(); } };
}
const opaque = error => error instanceof RegistrationStorageError && !error.message.includes('PRIVATE-') && !Object.hasOwn(error, 'registrations') && !error.cause;

test('listing uses at most eight concurrent verified reads and returns original index order despite out-of-order completions', async () => {
  const f = fixture(23);
  let completed = false;
  const result = f.repository.list().then(value => { completed = true; return value; });
  await flush();
  assert.deepEqual(f.started, [0, 1, 2, 3, 4, 5, 6, 7]); assert.equal(f.max(), 8);
  while (f.started.length < 23) {
    const highest = Math.max(...f.pending.keys());
    f.release(highest);
    await flush();
    assert.equal(completed, false);
    assert.ok(f.pending.size <= 8);
  }
  for (const index of [...f.pending.keys()].sort((a, b) => b - a)) f.release(index);
  const value = await result;
  assert.equal(f.max(), 8); assert.equal(value.revision, 23);
  assert.deepEqual(value.registrations.map(item => item.id), f.state.value.entries.map(item => item.id));
  assert.deepEqual(value.registrations.map(item => item.fields.name), Array.from({ length: 23 }, (_, index) => 'PRIVATE-SYNTHETIC-' + index));
  // A fresh request re-reads every immutable record; there is no cross-request PII cache.
  const second = f.repository.list(); await flush();
  while (f.pending.size) { for (const index of [...f.pending.keys()]) f.release(index); await flush(); }
  await second; assert.equal(f.started.length, 46); assert.equal(f.max(), 8);
});

test('one corrupt record fails the whole list, stops queuing, and exposes no partially read personal records', async () => {
  const f = fixture(300), first = f.state.value.entries[0];
  f.records.get(first.recordHash).bytes = Buffer.from('PRIVATE-SYNTHETIC-CORRUPT');
  let delivered;
  const operation = f.repository.list().then(value => { delivered = value; });
  const failure = assert.rejects(operation, opaque);
  await flush(); assert.equal(f.started.length, 8);
  f.release(0); await failure;
  assert.equal(delivered, undefined); assert.equal(f.started.length, 8); assert.equal(f.max(), 8);
  for (const index of [...f.pending.keys()]) f.release(index);
  await flush(); assert.equal(f.started.length, 8);
});

test('oversized and malformed restored indexes reject before any record request', async () => {
  for (const mutate of [
    f => { f.state.value.entries.push(...Array(1001 - f.state.value.entries.length).fill(f.state.value.entries[0])); f.state.value.revision = 1001; f.state.cursor.version = 1001; },
    f => { f.state.cursor.hash = 'PRIVATE-INVALID-HASH'; },
    f => { f.state.cursor.position = -1; },
    f => { f.state.value.entries[0].committedAt = 'not-a-time'; },
  ]) {
    const f = fixture(1); mutate(f);
    await assert.rejects(f.repository.list(), opaque); assert.equal(f.started.length, 0);
  }
});

test('a deadline or external abort stops a 300-record queue after at most eight in-flight reads', async () => {
  for (const mode of ['timeout', 'abort']) {
    const f = fixture(300), controller = new AbortController();
    const operation = f.repository.list({ timeoutMs: mode === 'timeout' ? 30 : 12000, signal: controller.signal });
    const failure = assert.rejects(operation, opaque);
    await flush(); assert.equal(f.started.length, 8);
    if (mode === 'abort') controller.abort();
    await failure;
    assert.equal(f.started.length, 8); assert.equal(f.max(), 8);
    for (const index of [...f.pending.keys()]) f.release(index);
    await flush(); assert.equal(f.started.length, 8);
  }
});
