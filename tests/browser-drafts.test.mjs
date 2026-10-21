import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserDraftStore, BROWSER_DRAFT_TTL_MS } from '../src/lib/browser-drafts.mjs';
import { createStaffFormDraft } from '../src/lib/staff-form-draft.mjs';

// Synthetic IndexedDB transaction model: connections share a serializable
// read/write cursor, writes stage privately, and abort never commits a prefix.
function indexedFixture() {
  const databases = new Map(), state = { failWrites: false, opens: 0 };
  const later = callback => setImmediate(callback), copy = value => structuredClone(value);
  const indexedDB = { open(name) {
    const request = {}; state.opens++;
    later(() => {
      let data = databases.get(name), fresh = !data;
      if (fresh) { data = { stores: new Map(), queue: [], busy: false }; databases.set(name, data); }
      const connection = {
        objectStoreNames: { contains: key => data.stores.has(key) },
        createObjectStore(key, options) { data.stores.set(key, { keyPath: options.keyPath, records: new Map() }); },
        close() {},
        transaction(names, mode) {
          let aborted = false, started = false, finished = false, pending = 0, working;
          const operations = [], tx = {};
          function next() { data.busy = false; if (data.queue.length) data.queue.shift()(); }
          function finish() {
            if (finished || aborted || !started || pending) return;
            finished = true;
            if (mode === 'readwrite') for (const [key, values] of working) data.stores.get(key).records = values;
            tx.oncomplete?.(); next();
          }
          tx.abort = () => { if (finished || aborted) return; aborted = true; later(() => { tx.onabort?.(); next(); }); };
          function run(operation) {
            later(() => {
              if (aborted || finished) return;
              try {
                operation.request.result = operation.action(); pending--;
                operation.request.onsuccess?.(); later(finish);
              } catch { operation.request.error = new Error('SYNTHETIC_PRIVATE_QUOTA'); operation.request.onerror?.(); tx.abort(); }
            });
          }
          function request(action) {
            const operation = { request: {}, action }; pending++;
            if (started) run(operation); else operations.push(operation);
            return operation.request;
          }
          tx.objectStore = key => ({
            getAll: () => request(() => [...working.get(key).values()].map(copy)),
            put: value => request(() => {
              if (mode !== 'readwrite' || state.failWrites) throw new Error();
              const stored = copy(value); working.get(key).set(stored[data.stores.get(key).keyPath], stored); return stored.key;
            }),
            delete: keyValue => request(() => { if (mode !== 'readwrite' || state.failWrites) throw new Error(); working.get(key).delete(keyValue); }),
          });
          const start = () => {
            data.busy = true; started = true; working = new Map(names.map(key => [key, new Map([...data.stores.get(key).records].map(([k, v]) => [k, copy(v)]))]));
            for (const operation of operations) run(operation); later(finish);
          };
          if (data.busy) data.queue.push(start); else later(start);
          // Reserve immediately, so two connections cannot both schedule start.
          if (!data.busy) data.busy = true;
          return tx;
        },
      };
      request.result = connection;
      if (fresh) request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  } };
  return { indexedDB, state, databases };
}
const scope = (entityId = 'profile:synthetic-person', actorId = 'synthetic-staff') => ({ actorId, eventId: 'synthetic-event', page: 'contacts', entityId });
const policy = {
  fields: ['name', 'payloadJson', 'idempotencyKey', 'attempted', 'uncertain'],
  pendingFields: ['payloadJson', 'idempotencyKey'], jsonFields: ['payloadJson'],
  validate(value, { kind }) { return typeof value.name === 'string' && (kind === 'editing' || typeof value.payloadJson === 'string' && typeof value.idempotencyKey === 'string'); },
};
const pending = () => ({ name: '合成申请人', payloadJson: '{"eventId":"synthetic-event","fields":{"name":"合成申请人"},"consent":{"accepted":true}}', idempotencyKey: 'a'.repeat(64), attempted: false, uncertain: false });
function fixture() {
  const idb = indexedFixture(), time = { now: 1000 };
  const make = () => createBrowserDraftStore({ indexedDB: idb.indexedDB, clock: () => time.now, BroadcastChannel: null });
  return { ...idb, time, make, store: make() };
}
async function write(store, key, value, kind = 'editing', old) {
  old ??= await store.read(key, policy);
  return store.write(key, { expectedRevision: old.revision, actorEpoch: old.actorEpoch, kind, baseRevision: 4, value }, policy);
}

test('independent connections CAS one writer; exact scopes isolate actor, page and entity', async () => {
  const f = fixture(), a = f.store, b = f.make(), key = scope(), initial = await a.read(key, policy);
  const result = await Promise.allSettled([write(a, key, { name: '合成甲' }, 'editing', initial), write(b, key, { name: '合成乙' }, 'editing', initial)]);
  assert.equal(result.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(result.find(value => value.status === 'rejected').reason.code, 'CONFLICT');
  assert.equal((await b.read(key, policy)).revision, 1);
  for (const other of [scope('other'), scope(key.entityId, 'other'), { ...key, page: 'review' }, { ...key, eventId: 'another-event' }]) assert.equal((await a.read(other, policy)).record, null);
});

test('pending request exact bytes survive restart indefinitely; attempts may update but request and downgrade never change', async () => {
  const f = fixture(), key = scope('application', 'public'), value = pending();
  const saved = await write(f.store, key, value, 'pending_submission');
  assert.equal(saved.record.expiresAt, null); f.time.now += BROWSER_DRAFT_TTL_MS * 100;
  const restored = await f.make().read(key, policy); assert.deepEqual(restored.record.value, value);
  const changed = await write(f.store, key, { ...value, attempted: true, uncertain: true }, 'pending_submission', restored);
  for (const update of [{ ...value, idempotencyKey: 'b'.repeat(64) }, { ...value, payloadJson: value.payloadJson + ' ' }]) await assert.rejects(write(f.store, key, update, 'pending_submission', changed), { code: 'PENDING_IMMUTABLE' });
  await assert.rejects(write(f.store, key, { name: '新建' }, 'editing', changed), { code: 'PENDING_IMMUTABLE' });
  await assert.rejects(f.store.remove(key, { expectedRevision: changed.revision, actorEpoch: changed.actorEpoch }), { code: 'PENDING_IMMUTABLE' });
  assert.deepEqual((await f.make().read(key, policy)).record.value, { ...value, attempted: true, uncertain: true });
});

test('ordinary drafts expire after seven days without read writes; removal heads prevent stale ABA recreation', async () => {
  const f = fixture(), key = scope(), saved = await write(f.store, key, { name: '合成过期' });
  f.time.now += BROWSER_DRAFT_TTL_MS;
  const expired = await f.store.read(key, policy); assert.equal(expired.record, null); assert.equal(expired.revision, saved.revision);
  const removed = await f.store.remove(key, { expectedRevision: expired.revision, actorEpoch: expired.actorEpoch });
  assert.equal(removed.revision, 2);
  await assert.rejects(write(f.store, key, { name: '过期旧标签页' }, 'editing', { revision: 0, actorEpoch: 0 }), { code: 'CONFLICT' });
  const next = await write(f.store, key, { name: '新草稿' }, 'editing', removed); assert.equal(next.revision, 3);
});

test('explicit logout atomically clears actor drafts and makes every prior tab epoch unusable', async () => {
  const f = fixture(), key = scope(), prior = await write(f.store, key, { name: '合成退出' });
  await write(f.store, scope('other'), pending(), 'pending_submission');
  await write(f.store, scope('another', 'second-actor'), { name: '别的账号' });
  const result = await f.make().clearActor(key.actorId); assert.equal(result.actorEpoch, 1);
  assert.equal((await f.store.read(key, policy)).record, null);
  await assert.rejects(write(f.store, key, { name: '退出后旧回调' }, 'editing', prior), { code: 'STALE_ACTOR' });
  assert.equal((await f.store.read(scope('another', 'second-actor'), policy)).record.value.name, '别的账号');
});

test('blocked credentials, unlisted fields, Files/accessors and secrets inside exact request JSON fail before storage', async () => {
  const f = fixture(); let invoked = false;
  const accessor = {}; Object.defineProperty(accessor, 'name', { enumerable: true, get() { invoked = true; return 'PRIVATE'; } });
  for (const value of [{ name: '合成', unknown: 'private' }, { name: '合成', password: 'PRIVATE' }, accessor,
    { name: 'data:image/png;base64,PRIVATE' }, { name: new Blob(['PRIVATE']) }]) await assert.rejects(write(f.store, scope(), value), { code: 'INVALID' });
  for (const hidden of ['password', 'token', 'authorization', 'csrfToken', 'privateKey', 'X-CSRF-Token', 'EMAILJS_PRIVATE_KEY']) await assert.rejects(write(f.store, scope(), { ...pending(), payloadJson: JSON.stringify({ [hidden]: 'PRIVATE' }) }, 'pending_submission'), { code: 'INVALID' });
  assert.equal(invoked, false); assert.equal((await f.store.read(scope(), policy)).revision, 0);
});

test('quota abort and overlarge drafts never report success or replace prior durable content', async () => {
  const f = fixture(), key = scope(), original = await write(f.store, key, { name: '合成持久原件' });
  f.state.failWrites = true;
  await assert.rejects(write(f.store, key, { name: '没有提交的新件' }, 'editing', original), { code: 'UNAVAILABLE' });
  f.state.failWrites = false;
  assert.deepEqual(await f.make().read(key, policy), original);
  await assert.rejects(write(f.store, key, { name: '字'.repeat(1024 * 1024) }, 'editing', original), { code: 'LIMIT' });
  assert.deepEqual(await f.make().read(key, policy), original);
});

test('record limit does not evict an unresolved submission and unavailable IndexedDB has no pretend fallback', async () => {
  const f = fixture(), publicKey = scope('pending', 'public'); await write(f.store, publicKey, pending(), 'pending_submission');
  for (let i = 0; i < 63; i++) await write(f.store, scope('record-' + i), { name: '合成' });
  await assert.rejects(write(f.store, scope('overflow'), { name: '合成' }), { code: 'LIMIT' });
  assert.deepEqual((await f.store.read(publicKey, policy)).record.value, pending());
  const unavailable = createBrowserDraftStore({ indexedDB: null, BroadcastChannel: null });
  await assert.rejects(unavailable.read(scope(), policy), { code: 'UNAVAILABLE' }); unavailable.close();
});

function binding(f, options = {}) {
  const state = { value: { name: '合成表单' }, applies: 0, current: true, base: 4, events: [] };
  const form = createStaffFormDraft({ store: f.store, scope: scope(), policy, baseRevision: () => state.base,
    isCurrent: () => state.current, capture: () => state.value, apply: async value => { state.applies++; state.value = value; }, onState: event => state.events.push(event.status), delayMs: 0, ...options });
  return { state, form };
}

test('binding offers a local draft without applying; explicit same-base restoration is required before autosave', async () => {
  const f = fixture(); await write(f.store, scope(), { name: '合成待恢复' });
  const b = binding(f); const loaded = await b.form.load(); assert.equal(loaded.record.value.name, '合成待恢复');
  assert.equal(b.state.applies, 0); assert.equal(b.form.blocked, true);
  await assert.rejects(b.form.flush(), { code: 'CONFLICT' });
  await b.form.restore(); assert.equal(b.state.applies, 1); assert.equal(b.form.blocked, false);
  b.state.value.name = '合成后续'; await b.form.flush(); assert.equal((await f.store.read(scope(), policy)).record.value.name, '合成后续'); b.form.close();
});

test('changed cloud revision remains read-only; pending-only restoration exposes exact request without allowing overwrite', async () => {
  const f = fixture(); await write(f.store, scope(), pending(), 'pending_submission');
  const b = binding(f); b.state.base = 5; await b.form.load();
  await assert.rejects(b.form.restore(), { code: 'CONFLICT' }); assert.equal(b.state.applies, 0);
  await b.form.restore({ pendingOnly: true }); assert.equal(b.state.applies, 1); assert.equal(b.form.blocked, true);
  await assert.rejects(b.form.flush(), { code: 'CONFLICT' });
  await b.form.discard({ allowPending: true }); assert.equal(b.form.blocked, false); b.form.close();
});

test('binding serializes saves, inherits pending kind and ignores session changes during delayed reads', async () => {
  const f = fixture(), b = binding(f); await b.form.load();
  await b.form.markPending(pending()); b.state.value = { ...pending(), uncertain: true };
  await b.form.flush(); assert.equal(b.form.snapshot.record.kind, 'pending_submission');
  assert.equal(b.form.snapshot.record.value.uncertain, true); b.form.close();
  let release; const gate = new Promise(resolve => { release = resolve; });
  const delayed = { ...f.store, read: async (...args) => { await gate; return f.store.read(...args); } };
  const late = binding(f, { store: delayed }); const reading = late.form.load(); late.state.current = false; late.form.close(); release();
  await assert.rejects(reading, { code: 'STALE_ACTOR' }); assert.equal(late.state.applies, 0); assert.equal(late.form.snapshot, null);
});

test('an external CAS update blocks stale form writes and preserves both cloud and local inputs', async () => {
  const f = fixture(), b = binding(f); await b.form.load();
  await write(f.make(), scope(), { name: '另页合成原件' });
  await assert.rejects(b.form.flush(), { code: 'CONFLICT' }); assert.equal(b.state.value.name, '合成表单');
  assert.equal((await f.store.read(scope(), policy)).record.value.name, '另页合成原件'); b.form.close();
});

test('a restore prompt cannot revive an editing draft that expired while it was open', async () => {
  const f = fixture(); await write(f.store, scope(), { name: '合成过期提示' });
  const b = binding(f); await b.form.load(); f.time.now += BROWSER_DRAFT_TTL_MS;
  const result = await b.form.restore(); assert.equal(result.record, null); assert.equal(b.state.applies, 0); assert.equal(b.form.blocked, false); b.form.close();
});

test('queued pending requests freeze caller bytes at invocation and never follow later object mutation', async () => {
  const f = fixture(); let release;
  const gate = new Promise(resolve => { release = resolve; });
  let delayed = true;
  const store = { ...f.store, write: async (...args) => { if (delayed) { delayed = false; await gate; } return f.store.write(...args); } };
  const b = binding(f, { store }); await b.form.load();
  const first = b.form.flush(); await new Promise(resolve => setImmediate(resolve));
  const value = pending(), original = structuredClone(value), frozen = b.form.markPending(value);
  value.payloadJson = '{"changed":true}'; value.idempotencyKey = 'b'.repeat(64); release();
  await first; await frozen;
  assert.deepEqual(b.form.snapshot.record.value, original); b.form.close();
});

test('logout cancels debounced work and a changed cloud base blocks a queued original request', async () => {
  const f = fixture(), b = binding(f, { delayMs: 20 }); await b.form.load(); b.form.schedule(); b.form.close();
  await f.store.clearActor(scope().actorId); await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal((await f.store.read(scope(), policy)).record, null);
  let release; const gate = new Promise(resolve => { release = resolve; });
  const c = binding(f, { store: { ...f.store, write: async (...args) => { await gate; return f.store.write(...args); } } }); await c.form.load();
  const first = c.form.flush(); await new Promise(resolve => setImmediate(resolve));
  const next = c.form.markPending(pending()); c.state.base++; release(); await first;
  await assert.rejects(next, { code: 'CONFLICT' }); assert.equal(c.form.snapshot.record.kind, 'editing'); c.form.close();
});

test('four MiB aggregate ceiling rejects new writes without evicting existing pending records', async () => {
  const f = fixture(), payload = 'x'.repeat(950000);
  for (let i = 0; i < 4; i++) await write(f.store, scope('large-' + i), { name: payload });
  await assert.rejects(write(f.store, scope('large-overflow'), { name: payload }), { code: 'LIMIT' });
  assert.equal((await f.store.read(scope('large-0'), policy)).record.value.name, payload);
});


test('input scheduling reports unsaved work immediately and external logout drops private cached snapshots', async () => {
  const f = fixture(), b = binding(f, { delayMs: 40 }); await b.form.load(); b.form.schedule();
  assert.equal(b.state.events.at(-1), 'saving'); assert.equal((await f.store.read(scope(), policy)).record, null);
  await b.form.flush(); assert.equal(b.state.events.at(-1), 'saved');
  await f.store.clearActor(scope().actorId); assert.equal(b.form.snapshot, null); assert.equal(b.form.blocked, true);
  await assert.rejects(b.form.flush(), { code: 'STALE_ACTOR' }); b.form.close();
});

test('a late local write or removal ACK cannot clear a newer cross-tab conflict', async () => {
  for (const operation of ['write', 'remove']) {
    const f = fixture(); if (operation === 'remove') await write(f.store, scope(), { name: '待清除合成' });
    let hint, release, committed;
    const gate = new Promise(resolve => { release = resolve; }), done = new Promise(resolve => { committed = resolve; });
    const adapter = { ...f.store, subscribe: (_scope, listener) => { hint = listener; return () => {}; },
      [operation]: async (...args) => { const result = await f.store[operation](...args); committed(); await gate; return result; } };
    const b = binding(f, { store: adapter }); await b.form.load(); if (operation === 'remove') await b.form.restore();
    const saving = operation === 'write' ? b.form.flush() : b.form.discard(); await done;
    const competing = await write(f.make(), scope(), { name: '另一页较新草稿' });
    hint({ type: 'change', actorEpoch: competing.actorEpoch, revision: competing.revision }); release();
    await assert.rejects(saving, { code: 'CONFLICT' });
    assert.equal(b.form.blocked, true); assert.equal(b.state.events.at(-1), 'conflict');
    assert.equal((await f.store.read(scope(), policy)).record.value.name, '另一页较新草稿'); b.form.close();
  }
});


test('logout during a held initial read cannot expose the old private draft after that read resolves', async () => {
  const f = fixture(); await write(f.store, scope(), { name: '退出前私人合成' });
  let release, observed; const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { observed = resolve; });
  const held = { ...f.store, read: async (...args) => { const value = await f.store.read(...args); observed(); await gate; return value; } };
  const b = binding(f, { store: held }); const loading = b.form.load(); await ready;
  await f.store.clearActor(scope().actorId); release();
  await assert.rejects(loading, { code: 'STALE_ACTOR' }); assert.equal(b.form.snapshot, null); assert.equal(b.state.applies, 0);
  assert.equal(b.state.events.includes('available'), false); b.form.close();
});
