import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createInitialContent } from '../src/config/content.mjs';
import { createOssContentStore, MAX_CONTENT_AUDIT_ENTRIES } from '../functions/cloud-content/store.mjs';
import { createOssPortraitStore, MAX_PORTRAIT_BYTES } from '../functions/cloud-content/portrait-store.mjs';
import { CloudContentError } from '../functions/cloud-content/errors.mjs';

// Generated solid 2×3 pixels, never a real person's picture.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0KFjAwMDAxMDAgKAAGOQBVgs9CEsAAAAASUVORK5CYII=';
const SHA = 'a'.repeat(64);
const AT = '2026-10-20T06:00:00.000Z';
const now = () => Date.parse(AT);
const clone = value => structuredClone(value);
async function fails(operation, code, status) {
  await assert.rejects(operation, error => error instanceof CloudContentError && error.code === code
    && (status === undefined || error.status === status) && !error.cause && !/PROVIDER-PRIVATE/u.test(error.message));
}
function journalFixture() {
  let value = null, cursor = { position: 0, version: 0, hash: null }, commits = 0, fail = null, pairedReads;
  return {
    client: () => ({
      read: async () => {
        const captured = clone({ value, cursor });
        if (pairedReads) {
          const gate = pairedReads;
          if (--gate.remaining === 0) { pairedReads = null; gate.release(); }
          await gate.promise;
        }
        return captured;
      },
      commit: async (expected, next) => {
        commits++;
        if (JSON.stringify(expected) !== JSON.stringify(cursor)) throw new CloudContentError('WRITE_CONFLICT', 'PROVIDER-PRIVATE conflict', 409);
        if (fail === 'before') { fail = null; throw new Error('PROVIDER-PRIVATE write failure'); }
        value = clone(next);
        cursor = { position: cursor.position + 1, version: cursor.version + 1, hash: createHash('sha256').update(JSON.stringify(value)).digest('hex') };
        if (fail === 'after') { fail = null; throw new Error('PROVIDER-PRIVATE lost acknowledgement'); }
        return clone({ value, cursor });
      },
    }),
    pairNextReads: () => {
      let release;
      const promise = new Promise(resolve => { release = resolve; });
      pairedReads = { promise, release, remaining: 2 };
    },
    failure: phase => { fail = phase; },
    corrupt: input => { value = input; cursor = { position: 1, version: 1, hash: SHA }; },
    snapshot: () => clone({ value, cursor, commits }),
  };
}
function objectsFixture() {
  const values = new Map(), accesses = [];
  return {
    values, accesses,
    client: {
      get: async (key, { maxBytes } = {}) => {
        accesses.push({ operation: 'get', key });
        const entry = values.get(key);
        if (!entry) return null;
        if (entry.data.length > maxBytes) throw new CloudContentError('OBJECT_UNAVAILABLE', 'PROVIDER-PRIVATE oversized', 503);
        return { ...entry, data: Buffer.from(entry.data) };
      },
      putImmutable: async (key, data, { contentType }) => {
        accesses.push({ operation: 'putImmutable', key });
        const old = values.get(key);
        if (old && !old.data.equals(data)) throw new Error('PROVIDER-PRIVATE differing object');
        if (!old) values.set(key, { data: Buffer.from(data), contentType, objectType: 'Normal' });
        return { data: Buffer.from(data), contentType, objectType: 'Normal' };
      },
    },
  };
}
const input = () => ({ contentType: 'image/png', dataBase64: PNG });
const guest = portraitId => ({ id: 'synthetic-guest', name: '合成嘉宾', company: '合成机构', ggjRole: '', portraitId, status: 'confirmed', publicConsent: true, internalNotes: 'PRIVATE-SYNTHETIC-NOTE' });

async function setup() {
  const objects = objectsFixture();
  const portraits = createOssPortraitStore({ objects: objects.client });
  const journal = journalFixture();
  const a = createOssContentStore({ journal: journal.client(), portraitStore: portraits, now });
  const b = createOssContentStore({ journal: journal.client(), portraitStore: createOssPortraitStore({ objects: objects.client }), now });
  return { journal, objects, portraits, a, b };
}
function oneWinner(outcomes) {
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  const failure = outcomes.find(item => item.status === 'rejected').reason;
  assert.equal(failure.code, 'REVISION_CONFLICT'); assert.equal(failure.status, 409);
}

test('independent cloud content stores compete on journal position and never overwrite the winning save', async () => {
  const { journal, a, b } = await setup();
  assert.equal((await a.read()).draft.revision, 0);
  const left = createInitialContent(), right = createInitialContent();
  left.event.title = '合成左编辑'; right.event.title = '合成右编辑';
  journal.pairNextReads();
  const outcomes = await Promise.allSettled([a.save(0, left, 'left'), b.save(0, right, 'right')]);
  oneWinner(outcomes);
  const saved = await createOssContentStore({ journal: journal.client(), now }).read();
  assert.equal(saved.draft.revision, 1);
  assert.equal(saved.draft.content.event.title, outcomes.find(item => item.status === 'fulfilled').value.content.event.title);
  assert.equal(journal.snapshot().value.audit.length, 1);
  saved.draft.content.event.title = 'client mutation';
  assert.notEqual((await a.read()).draft.content.event.title, 'client mutation');
  await fails(() => a.save(0, createInitialContent(), 'left'), 'REVISION_CONFLICT', 409);
});

test('save, publish and portrait audit all use the same storage cursor despite independent draft revision', async () => {
  for (const opponent of ['save', 'publish']) {
    const { journal, a, b, portraits } = await setup();
    const photo = await portraits.upload(input());
    await a.save(0, createInitialContent(), 'editor');
    journal.pairNextReads();
    const operation = opponent === 'save' ? b.save(1, createInitialContent(), 'editor') : b.publish(1, 'publisher');
    oneWinner(await Promise.allSettled([operation, a.recordPortraitUpload(photo.id, 'uploader')]));
    assert.equal(journal.snapshot().value.audit.length, 2);
    assert.equal((await a.read()).draft.revision, opponent === 'save' && journal.snapshot().value.audit.at(-1).action === 'save_draft' ? 2 : 1);
  }
  const { journal, a, b } = await setup();
  journal.pairNextReads();
  oneWinner(await Promise.allSettled([a.save(0, createInitialContent(), 'editor'), b.publish(0, 'publisher')]));
  assert.equal(journal.snapshot().value.audit.length, 1);
});

test('real synthetic image upload, save, publication, restart and withdrawal retain only authorized public fields', async () => {
  const { journal, objects, portraits, a, b } = await setup();
  const photo = await portraits.upload(input());
  assert.match(photo.id, /^[a-f0-9]{64}\.png$/u);
  assert.ok(objects.accesses.at(-1).operation === 'get');
  await a.recordPortraitUpload(photo.id, 'editor');
  const content = createInitialContent(); content.guests = [guest(photo.id)];
  content.sessions[0].guestId = 'synthetic-guest';
  await a.save(0, content, 'editor');
  assert.equal((await b.read()).published, null);
  const published = await b.publish(1, 'publisher');
  assert.equal(published.content.guests[0].name, '合成嘉宾');
  assert.equal(published.content.sessions[0].speakerName, '合成嘉宾');
  assert.equal(JSON.stringify(published).includes('PRIVATE-SYNTHETIC'), false);
  assert.deepEqual((await createOssContentStore({ journal: journal.client(), portraitStore: portraits, now }).read()).published, published);
  const commits = journal.snapshot().commits;
  assert.deepEqual(await b.publish(1, 'publisher'), published);
  assert.equal(journal.snapshot().commits, commits);
  const legacy = clone(content); delete legacy.guests;
  await fails(() => a.save(1, legacy, 'editor'), 'VALIDATION_ERROR', 422);
  content.guests[0].publicConsent = false;
  await a.save(1, content, 'editor');
  assert.equal((await b.read()).published.content.guests.length, 1);
  const withdrawn = await b.publish(2, 'publisher');
  assert.equal(withdrawn.content.guests.length, 0);
  assert.equal(withdrawn.content.sessions[0].speakerName, '');
  assert.equal((await portraits.read(photo.id)).bytes, photo.bytes); // Private retention is separate from public authorization.
  assert.equal(journal.snapshot().value.audit.length, 5);
});

test('unavailable or inconsistent images reject save and publication without changing the private journal', async () => {
  const { a, journal, objects, portraits } = await setup();
  const content = createInitialContent(); content.guests = [guest(SHA + '.png')];
  await fails(() => a.save(0, content, 'editor'), 'VALIDATION_ERROR', 422);
  assert.equal(journal.snapshot().value, null);
  const photo = await portraits.upload(input()); content.guests = [guest(photo.id)];
  await a.save(0, content, 'editor');
  objects.values.delete('cms/v1/portraits/' + photo.id);
  await fails(() => a.publish(1, 'publisher'), 'VALIDATION_ERROR', 422);
  assert.equal((await a.read()).published, null);
  assert.equal(journal.snapshot().commits, 1);
});

test('failed and lost-ack commits never claim a successful save or publish and are never automatically resubmitted', async () => {
  const { a, journal } = await setup();
  journal.failure('before');
  await fails(() => a.save(0, createInitialContent(), 'editor'), 'STORAGE_ERROR', 503);
  assert.equal(journal.snapshot().commits, 1); assert.equal(journal.snapshot().value, null);
  journal.failure('after');
  await fails(() => a.publish(0, 'publisher'), 'STORAGE_ERROR', 503);
  assert.equal(journal.snapshot().commits, 2);
  const observed = await a.read();
  assert.equal(observed.published.revision, 0); // Only an explicit later read resolves the uncertain prior outcome.
  assert.deepEqual(await a.publish(0, 'publisher'), observed.published);
  assert.equal(journal.snapshot().commits, 2);
});

test('resolved journal commits require an acknowledgement of the exact state and a valid advanced cursor', async () => {
  const invalidAcks = [
    () => undefined, () => null,
    ack => ({ ...ack, value: null }),
    ack => ({ ...ack, value: { ...ack.value, storageVersion: 2 } }),
    ack => ({ ...ack, cursor: { ...ack.cursor, position: 0 } }),
    ack => ({ ...ack, cursor: { ...ack.cursor, version: 0 } }),
    ack => ({ ...ack, cursor: { ...ack.cursor, version: 2 } }),
    ack => ({ ...ack, cursor: { ...ack.cursor, hash: 'PROVIDER-PRIVATE' } }),
  ];
  for (const invalidAck of invalidAcks) {
    for (const operation of ['save', 'publish', 'audit']) {
      const journal = journalFixture(), client = journal.client();
      let commits = 0;
      const { portraits } = await setup(), photo = await portraits.upload(input());
      const store = createOssContentStore({ journal: {
        read: client.read,
        commit: async (...args) => { commits++; return invalidAck(await client.commit(...args)); },
      }, portraitStore: portraits, now });
      await fails(() => operation === 'save' ? store.save(0, createInitialContent(), 'editor')
        : operation === 'publish' ? store.publish(0, 'publisher') : store.recordPortraitUpload(photo.id, 'editor'), 'STORAGE_ERROR', 503);
      assert.equal(commits, 1);
      assert.equal(journal.snapshot().cursor.version, 1); // No retry after the uncertain acknowledgement.
    }
  }
});

test('corrupt, missing-at-a-nonzero-cursor, unknown-version and inconsistent publication state never reset to seed', async () => {
  const { journal, a } = await setup();
  const good = { storageVersion: 1, draft: { revision: 0, content: createInitialContent() }, published: null, audit: [] };
  for (const value of [undefined, {}, { ...good, storageVersion: 2 }, { ...good, extra: 'PRIVATE' }, { ...good, draft: { ...good.draft, revision: 1 } }, { ...good, audit: [{ action: 'unknown', actorId: 'editor', at: AT }] }, { ...good, published: { revision: 0, publishedAt: AT, content: createInitialContent() } }]) {
    journal.corrupt(value);
    await fails(() => a.read(), 'STORAGE_ERROR', 503);
    await fails(() => a.save(0, createInitialContent(), 'editor'), 'STORAGE_ERROR', 503);
  }
  const missing = createOssContentStore({ journal: { read: async () => ({ value: null, cursor: { position: 1, version: 1, hash: SHA } }), commit: async () => assert.fail('must not commit') } });
  await fails(() => missing.read(), 'STORAGE_ERROR', 503);
  assert.equal(journal.snapshot().commits, 0);
});

test('audit and state size limits reject the new operation without trimming history or creating another commit', async () => {
  const { journal, a } = await setup();
  const audit = Array.from({ length: MAX_CONTENT_AUDIT_ENTRIES }, () => ({ action: 'upload_portrait', actorId: 'editor', portraitId: SHA + '.png', bytes: 80, at: AT }));
  journal.corrupt({ storageVersion: 1, draft: { revision: 0, content: createInitialContent() }, published: null, audit });
  assert.equal((await a.read()).draft.revision, 0);
  await fails(() => a.save(0, createInitialContent(), 'editor'), 'CONTENT_CAPACITY_EXCEEDED', 503);
  assert.equal(journal.snapshot().value.audit.length, MAX_CONTENT_AUDIT_ENTRIES);
  assert.equal(journal.snapshot().commits, 0);
  const fresh = journalFixture(), store = createOssContentStore({ journal: fresh.client() });
  const oversized = createInitialContent();
  oversized.guests = Array.from({ length: 200 }, (_, index) => ({ ...guest(''), id: 'synthetic-' + index, name: '', company: '', status: 'pending', publicConsent: false, internalNotes: '字'.repeat(3000) }));
  await fails(() => store.save(0, oversized, 'editor'), 'CONTENT_CAPACITY_EXCEEDED', 503);
  assert.equal(fresh.snapshot().commits, 0); assert.equal(fresh.snapshot().value, null);
});

test('cloud portrait normalization strips metadata and verifies actual private readback before returning a receipt', async () => {
  const { objects, portraits } = await setup();
  const plain = await portraits.upload(input());
  const raw = Buffer.from(PNG, 'base64'), text = Buffer.from('SYNTHETIC-PRIVATE-LOCATION');
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([Buffer.from('tEXt'), text])) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1; }
  const chunk = Buffer.alloc(text.length + 12); chunk.writeUInt32BE(text.length); chunk.write('tEXt', 4); text.copy(chunk, 8); chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  const withMetadata = Buffer.concat([raw.subarray(0, 33), chunk, raw.subarray(33)]);
  assert.deepEqual(await portraits.upload({ contentType: 'image/png', dataBase64: withMetadata.toString('base64') }), plain);
  const stored = await portraits.read(plain.id);
  assert.equal(stored.data.includes(text), false);
  assert.equal(createHash('sha256').update(stored.data).digest('hex'), plain.id.slice(0, 64));
  assert.ok(objects.accesses.every(access => /^cms\/v1\/portraits\/[a-f0-9]{64}\.png$/u.test(access.key)));
  const failures = [
    { get: async () => null, putImmutable: async () => undefined },
    { get: async () => { throw Object.assign(new Error('PROVIDER-PRIVATE'), { status: 404 }); }, putImmutable: async () => undefined },
    { get: objects.client.get, putImmutable: async () => { throw new Error('PROVIDER-PRIVATE lost acknowledgement'); } },
    { get: async () => ({ data: Buffer.alloc(30), contentType: 'image/png' }), putImmutable: async () => undefined },
  ];
  for (const client of failures) await assert.rejects(() => createOssPortraitStore({ objects: client }).upload(input()), error => error instanceof CloudContentError && [404, 503].includes(error.status) && !/PROVIDER-PRIVATE/u.test(error.message));
});

test('cloud portraits refuse URL/path IDs, MIME confusion, invalid bodies, changed bytes and wrong storage metadata', async () => {
  const { objects, portraits } = await setup();
  for (const id of ['https://example.invalid/x.png', '../x.png', SHA + '.svg', SHA.toUpperCase() + '.png', null]) await fails(() => portraits.read(id), 'INVALID_PORTRAIT_ID', 422);
  await fails(() => portraits.read(SHA + '.png'), 'NOT_FOUND', 404);
  for (const contentType of ['image/svg+xml', 'image/PNG', 'text/html', null]) await fails(() => portraits.upload({ ...input(), contentType }), 'INVALID_PORTRAIT', 422);
  for (const dataBase64 of [PNG + '\n', 'AB==', '', '<svg/>']) await fails(() => portraits.upload({ ...input(), dataBase64 }), 'INVALID_PORTRAIT', 422);
  await fails(() => portraits.upload({ ...input(), dataBase64: Buffer.alloc(MAX_PORTRAIT_BYTES + 1).toString('base64') }), 'PORTRAIT_TOO_LARGE', 413);
  const photo = await portraits.upload(input()), key = 'cms/v1/portraits/' + photo.id;
  const saved = objects.values.get(key);
  saved.contentType = 'text/html';
  await fails(() => portraits.read(photo.id), 'PORTRAIT_UNAVAILABLE', 503);
  saved.contentType = 'image/png'; saved.objectType = 'Appendable';
  await fails(() => portraits.read(photo.id), 'PORTRAIT_UNAVAILABLE', 503);
  saved.objectType = 'Normal';
  saved.contentType = 'image/png'; saved.data[40] ^= 1;
  await fails(() => portraits.read(photo.id), 'PORTRAIT_UNAVAILABLE', 503);
});
