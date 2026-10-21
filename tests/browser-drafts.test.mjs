import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserDraftStore, BROWSER_DRAFT_TTL_MS } from '../src/lib/browser-drafts.mjs';
import { createStaffFormDraft } from '../src/lib/staff-form-draft.mjs';

// Synthetic IndexedDB transaction model: connections share a serializable
// read/write cursor, writes stage privately, and abort never commits a prefix.
function indexedFixture() {
  const databases = new Map(), state = { failWrites: false, opens: 0, writes: 0, failAt: null };
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
              if (mode !== 'readwrite' || state.failWrites || ++state.writes === state.failAt) throw new Error();
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

test('a first definitive rejection atomically recovers exact request fields or retains the original pending on write failure', async () => {
  const f = fixture(), key = scope('application', 'public');
  const rejectionPolicy = { ...policy, rejectPending(value) {
    if (value.attempted !== true || value.uncertain !== false) return false;
    return { name: JSON.parse(value.payloadJson).fields.name };
  } };
  const original = await write(f.store, key, { ...pending(), attempted: true }, 'pending_submission');
  // Abort after staging the new editable record, before its CAS head commits.
  f.state.failAt = f.state.writes + 2;
  await assert.rejects(f.store.rejectPending(key, { expectedRevision: original.revision, actorEpoch: original.actorEpoch }, rejectionPolicy), { code: 'UNAVAILABLE' });
  assert.deepEqual(await f.make().read(key, rejectionPolicy), original);
  f.state.failAt = null;
  const recovered = await f.store.rejectPending(key, { expectedRevision: original.revision, actorEpoch: original.actorEpoch }, rejectionPolicy);
  assert.equal(recovered.revision, original.revision + 1); assert.equal(recovered.record.kind, 'editing');
  assert.equal(recovered.record.baseRevision, original.record.baseRevision);
  assert.deepEqual(recovered.record.value, { name: '合成申请人' });
  await assert.rejects(f.store.rejectPending(key, { expectedRevision: original.revision, actorEpoch: original.actorEpoch }, rejectionPolicy), { code: 'CONFLICT' });
  for (const value of [{ ...pending(), attempted: false }, { ...pending(), attempted: true, uncertain: true }]) {
    const other = scope('blocked-' + value.uncertain, 'public'), saved = await write(f.store, other, value, 'pending_submission');
    await assert.rejects(f.store.rejectPending(other, { expectedRevision: saved.revision, actorEpoch: saved.actorEpoch }, rejectionPolicy), { code: 'PENDING_IMMUTABLE' });
    assert.deepEqual(await f.store.read(other, rejectionPolicy), saved);
    if (value.uncertain) await assert.rejects(f.store.write(other, { expectedRevision: saved.revision, actorEpoch: saved.actorEpoch,
      kind: 'pending_submission', baseRevision: saved.record.baseRevision, value: { ...value, uncertain: false } }, rejectionPolicy), { code: 'PENDING_IMMUTABLE' });
  }
});

test('unsettled input warns before unload until its own durable ACK, including edits made during a held older ACK', async () => {
  const listeners = new Map(), priorWindow = globalThis.window;
  globalThis.window = { addEventListener: (type, callback) => listeners.set(type, callback), removeEventListener: type => listeners.delete(type) };
  const f = fixture(); let release, ready;
  const gate = new Promise(resolve => { release = resolve; }), committed = new Promise(resolve => { ready = resolve; });
  let first = true;
  const held = { ...f.store, write: async (...args) => { const saved = await f.store.write(...args); if (first) { first = false; ready(); await gate; } return saved; } };
  const b = binding(f, { store: held, delayMs: 5000 });
  try {
    await b.form.load(); assert.equal(b.form.unsettled, false);
    b.form.schedule(); assert.equal(b.form.unsettled, true);
    let prevented = 0; const event = { preventDefault() { prevented++; }, returnValue: null };
    listeners.get('beforeunload')(event); assert.equal(prevented, 1); assert.equal(event.returnValue, '');
    const saving = b.form.flush({ value: { name: '较早输入' } }); await committed;
    b.state.value.name = '较新末字'; b.form.schedule(); release(); await saving;
    assert.equal(b.form.unsettled, true); assert.equal(b.state.events.at(-1), 'saving');
    await b.form.flush(); assert.equal(b.form.unsettled, false); assert.equal(b.state.events.at(-1), 'saved');
    listeners.get('beforeunload')(event); assert.equal(prevented, 1);
    b.form.close(); assert.equal(listeners.size, 0);
  } finally { release(); b.form.close(); if (priorWindow === undefined) delete globalThis.window; else globalThis.window = priorWindow; }
});

test('binding definitive rejection preserves typed fields atomically and never downgrades an unknown or freshly restored request', async () => {
  const rejectionPolicy = { ...policy, rejectPending: value => value.uncertain === false ? { name: JSON.parse(value.payloadJson).fields.name } : false };
  const f = fixture(), b = binding(f, { policy: rejectionPolicy }); await b.form.load();
  const original = await b.form.markPending({ ...pending(), attempted: true });
  f.state.failAt = f.state.writes + 2;
  await assert.rejects(b.form.rejectPending(), { code: 'UNAVAILABLE' });
  assert.deepEqual(b.form.snapshot, original); assert.deepEqual(await f.make().read(scope(), rejectionPolicy), original);
  f.state.failAt = null;
  const recovered = await b.form.rejectPending();
  assert.equal(recovered.revision, original.revision + 1); assert.equal(recovered.record.kind, 'editing');
  assert.deepEqual(recovered.record.value, { name: '合成申请人' }); assert.equal(b.form.blocked, false);
  assert.equal(b.state.events.at(-1), 'saved');
  await b.form.markPending({ ...pending(), attempted: true, uncertain: true });
  await assert.rejects(b.form.rejectPending(), { code: 'PENDING_IMMUTABLE' });
  assert.equal(b.form.snapshot.record.kind, 'pending_submission'); b.form.close();
  const restored = binding(f, { policy: rejectionPolicy }); await restored.form.load();
  await assert.rejects(restored.form.rejectPending(), { code: 'CONFLICT' });
  assert.equal(restored.form.snapshot.record.kind, 'pending_submission'); restored.form.close();
  const other = fixture(); await write(other.store, scope(), pending(), 'pending_submission');
  const ambiguous = binding(other, { policy: rejectionPolicy }); await ambiguous.form.load();
  await ambiguous.form.restore({ pendingOnly: true });
  await assert.rejects(ambiguous.form.rejectPending(), { code: 'CONFLICT' });
  assert.equal(ambiguous.form.snapshot.record.value.uncertain, false); ambiguous.form.close();
});

test('late atomic rejection ACK cannot clear a newer local conflict or a logout lease', async () => {
  const rejectionPolicy = { ...policy, rejectPending: value => ({ name: JSON.parse(value.payloadJson).fields.name }) };
  for (const action of ['competing_edit', 'logout']) {
    const f = fixture(); let release, ready;
    const gate = new Promise(resolve => { release = resolve; }), committed = new Promise(resolve => { ready = resolve; });
    const held = { ...f.store, rejectPending: async (...args) => { const result = await f.store.rejectPending(...args); ready(); await gate; return result; } };
    const b = binding(f, { store: held, policy: rejectionPolicy }); await b.form.load();
    await b.form.markPending(pending()); const rejecting = b.form.rejectPending(); await committed;
    if (action === 'logout') await f.store.clearActor(scope().actorId);
    else {
      const other = await f.store.read(scope(), rejectionPolicy);
      await f.store.write(scope(), { expectedRevision: other.revision, actorEpoch: other.actorEpoch, kind: 'editing', baseRevision: 4, value: { name: '较新另一页填写' } }, rejectionPolicy);
    }
    release(); await assert.rejects(rejecting, { code: action === 'logout' ? 'STALE_ACTOR' : 'CONFLICT' });
    assert.equal(b.form.blocked, true);
    if (action === 'logout') assert.equal(b.form.snapshot, null);
    else {
      assert.equal(b.state.events.at(-1), 'conflict');
      assert.equal((await f.store.read(scope(), rejectionPolicy)).record.value.name, '较新另一页填写');
    }
    b.form.close();
  }
});

test('proven completion replaces pending and advances its cloud base atomically, retaining the original on quota abort', async () => {
  const f=fixture(),key=scope(),original=await write(f.store,key,{...pending(),uncertain:true},'pending_submission');
  const update={expectedRevision:original.revision,actorEpoch:original.actorEpoch,baseRevision:5,value:{name:'其他页面尚未完成的合成填写'}};
  f.state.failAt=f.state.writes+2;
  await assert.rejects(f.store.completePending(key,update,policy),{code:'UNAVAILABLE'});
  assert.deepEqual(await f.make().read(key,policy),original,'staging the editable record must not delete the exact original request');
  f.state.failAt=null;
  const saved=await f.store.completePending(key,update,policy);
  assert.equal(saved.revision,original.revision+1);assert.equal(saved.record.kind,'editing');assert.equal(saved.record.baseRevision,5);
  assert.deepEqual(saved.record.value,update.value);assert.equal(saved.record.expiresAt,f.time.now+BROWSER_DRAFT_TTL_MS);
  await assert.rejects(f.store.completePending(key,update,policy),{code:'CONFLICT'});
});

test('completion rejects an unadvanced cloud base, unsafe value or lost local lease without forgetting the pending request', async () => {
  const f=fixture(),key=scope(),original=await write(f.store,key,pending(),'pending_submission');
  const update={expectedRevision:original.revision,actorEpoch:original.actorEpoch,baseRevision:5,value:{name:'保留的填写'}};
  for(const baseRevision of [0,4,null,-1,'5'])await assert.rejects(f.store.completePending(key,{...update,baseRevision},policy),{code:typeof baseRevision==='number'&&baseRevision>=0?'CONFLICT':'INVALID'});
  for(const value of [{name:'合成',password:'PRIVATE'}, {name:new Blob(['PRIVATE'])}, {name:'字'.repeat(1024*1024)}])await assert.rejects(f.store.completePending(key,{...update,value},policy));
  assert.deepEqual(await f.make().read(key,policy),original);
  const other=await write(f.make(),key,{...pending(),uncertain:true},'pending_submission',original);
  await assert.rejects(f.store.completePending(key,update,policy),{code:'CONFLICT'});assert.deepEqual(await f.store.read(key,policy),other);
  await f.make().clearActor(key.actorId);
  await assert.rejects(f.store.completePending(key,{...update,expectedRevision:0},policy),{code:'STALE_ACTOR'});assert.equal((await f.store.read(key,policy)).record,null);
});

test('binding completion freezes remaining input and can finish a restored original only after explicit pending recovery', async () => {
  const f=fixture(),b=binding(f);await b.form.load();await b.form.markPending({...pending(),uncertain:true});b.form.close();
  const restored=binding(f);restored.state.base=5;await restored.form.load();
  await assert.rejects(restored.form.completePending({name:'尚未明确恢复'}),{code:'CONFLICT'});
  await restored.form.restore({pendingOnly:true});assert.equal(restored.form.blocked,true);
  const value={name:'保留原始未完成栏位'},saving=restored.form.completePending(value);value.name='调用后不能偷换的内容';
  const saved=await saving;assert.equal(saved.record.kind,'editing');assert.equal(saved.record.baseRevision,5);
  assert.equal(saved.record.value.name,'保留原始未完成栏位');assert.equal(restored.form.blocked,false);assert.equal(restored.form.unsettled,false);
  assert.equal(restored.state.events.at(-1),'saved');restored.form.close();
});

test('late completion cannot clear a newer cross-tab draft, logout epoch, or changed cloud base', async () => {
  for(const action of ['competing_edit','logout','new_cloud_base']){
    const f=fixture();let release,ready;
    const gate=new Promise(resolve=>{release=resolve;}),committed=new Promise(resolve=>{ready=resolve;});
    const held={...f.store,completePending:async(...args)=>{const value=await f.store.completePending(...args);ready();await gate;return value;}};
    const b=binding(f,{store:held});await b.form.load();await b.form.markPending(pending());b.state.base=5;
    const completing=b.form.completePending({name:'较早剩余填写'});await committed;
    if(action==='logout')await f.store.clearActor(scope().actorId);
    else if(action==='competing_edit')await write(f.store,scope(),{name:'另一页较新填写'});
    else b.state.base=6;
    release();await assert.rejects(completing,{code:action==='logout'?'STALE_ACTOR':'CONFLICT'});assert.equal(b.form.blocked,true);
    if(action==='logout')assert.equal((await f.store.read(scope(),policy)).record,null);
    else if(action==='competing_edit')assert.equal((await f.store.read(scope(),policy)).record.value.name,'另一页较新填写');
    b.form.close();
  }
});
