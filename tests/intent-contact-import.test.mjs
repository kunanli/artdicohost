import test from 'node:test';
import assert from 'node:assert/strict';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { createOssContactsStore } from '../functions/cloud-content/contacts-store.mjs';
import { createInitialContent } from '../src/config/content.mjs';
import { createIntentContactImporter } from '../functions/intent-invitations/importer.mjs';
import { createIntentContactImportApi } from '../functions/intent-invitations/import-handler.mjs';
import { readContactSnapshot, contactHash } from '../functions/intent-invitations/contact-snapshot.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';

const actor = { id: 'synthetic-importer', roles: ['outreach'] };
const at = Date.parse('2026-10-20T01:00:00.000Z'), now = () => at + 3600000;
function target(options = {}) {
  const objects = options.objects ?? memoryObjects();
  const journal = createObjectJournal({ objects, prefix: 'cms/v1/contacts' });
  const contentStore = { read: async () => ({ draft: { content: createInitialContent() } }) };
  const store = createOssContactsStore({ journal: options.journal ?? journal, contentStore, now });
  return { objects, journal, store, importer: createIntentContactImporter({ contactsStore: store, now }) };
}
async function original() {
  const f = target();
  let record = await f.store.createContact(0, { name: '合成原姓名', email: 'synthetic@example.invalid', organization: '合成机构', contactConsent: 'consented' }, actor.id);
  record = await f.store.saveProfile(record.contact.id, 1, { name: '合成修正姓名' }, actor.id);
  record = await f.store.saveOperations(record.contact.id, 2, { ...record.contact.operations, responseStatus: 'attending', notes: '合成私密跟进记录' }, actor.id);
  record = await f.store.recordGenerated(record.contact.id, 3, { recipientName: '合成称呼', date: '2026-12-05', time: '09:30–18:00', venue: '合成场地', confirmed: true }, actor.id);
  record = await f.store.recordSent(record.contact.id, 4, 'wechat', record.contact.invitation.generatedAt, record.contact.invitation.settings, actor.id);
  const value = (await f.journal.read()).value;
  // The legacy local store did not have these two optional cloud audit digests.
  for (const entry of value.audit) { delete entry.sourceDigest; delete entry.settingsDigest; }
  const snapshot = JSON.stringify(value);
  return { snapshot, originalSha256: contactHash(snapshot), kind: 'snapshot', contact: record.contact, value };
}
const commitInput = (input, preview) => ({ kind: input.kind, snapshot: input.snapshot, originalSha256: input.originalSha256,
  expectedRevision: preview.expectedRevision, previewToken: preview.previewToken, confirmSource: true, allowPossibleDuplicates: false, actor });

test('legacy snapshot import preserves identities, source, edits, replies and invitation history behind a strict archived audit', async () => {
  const source = await original(), f = target();
  const preview = await f.importer.preview({ kind: source.kind, snapshot: source.snapshot, originalSha256: source.originalSha256, actor });
  assert.equal(preview.summary.new, 1); assert.deepEqual(preview.rows, []); assert.equal(preview.canCommit, true);
  assert.equal((await f.store.read()).revision, 0);
  const imported = await f.importer.commit(commitInput(source, preview));
  assert.equal(imported.imported, true); assert.equal(imported.revision, 1); assert.deepEqual(imported.contacts[0], source.contact);
  const durable = (await f.journal.read()).value;
  assert.deepEqual(durable.audit.map(entry => entry.action), ['import_contacts']);
  assert.deepEqual(JSON.parse(durable.migrationArchives[0].snapshot).audit, source.value.audit);
  assert.equal(durable.migrationArchives[0].sourceFileSha256, source.originalSha256);
  assert.equal(durable.contacts[0].source.key, 'manual');
  const rebuilt = target({ objects: f.objects });
  assert.deepEqual((await rebuilt.store.read()).contacts[0], source.contact);
  await rebuilt.store.saveProfile(source.contact.id, 1, { name: '合成迁移后修正' }, actor.id);
  const replay = await rebuilt.importer.commit(commitInput(source, preview));
  assert.equal(replay.imported, false); assert.equal(replay.revision, 2); assert.equal(replay.contacts[0].profile.name, '合成迁移后修正');
  const latest = await rebuilt.importer.preview({ kind: source.kind, snapshot: source.snapshot, originalSha256: source.originalSha256, actor });
  assert.equal(latest.summary.unchanged, 1); assert.equal((await rebuilt.journal.read()).value.audit.length, 2);
});

test('raw file hash, original profile hash and exact archived audit schemas are checked before any cloud mutation', async () => {
  const source = await original(), f = target();
  await assert.rejects(f.importer.preview({ kind: 'snapshot', snapshot: source.snapshot, originalSha256: 'a'.repeat(64), actor }), { code: 'INVALID_INPUT' });
  for (const change of [value => { value.contacts[0].source.digest = 'a'.repeat(64); }, value => { value.audit[0].message = 'PRIVATE-SYNTHETIC'; },
    value => { value.audit[2].action = 'unknown_operation'; }, value => { value.audit.pop(); value.revision--; },
    value => { value.contacts[0].invitation.sentGenerationAt = null; }]) {
    const value = structuredClone(source.value); change(value); const snapshot = JSON.stringify(value);
    assert.throws(() => readContactSnapshot(snapshot));
    await assert.rejects(f.importer.preview({ kind: 'snapshot', snapshot, originalSha256: contactHash(snapshot), actor }));
  }
  assert.equal((await f.store.read()).contacts.length, 0);
  assert.equal(f.objects.calls.filter(call => call.operation !== 'get').length, 0);
});

test('browser-normalized questionnaire rows verify original bytes and preserve unknown consent without granting public or attendance status', async () => {
  const f = target(), file = Buffer.from('SYNTHETIC-XLSX-BYTES-ONLY');
  const input = { kind: 'rows', sourceKey: 'wjx-388636468', sourceFileBase64: file.toString('base64'), originalSha256: contactHash(file),
    rows: [{ sourceRowId: '1', name: '合成问卷对象', email: 'synthetic-row@example.invalid', categories: ['so'], interests: ['roundtable'], attendanceIntent: 'expected' }] };
  const preview = await f.importer.preview({ ...input, actor });
  const result = await f.importer.commit({ ...input, expectedRevision: preview.expectedRevision, previewToken: preview.previewToken, confirmSource: true, actor });
  const contact = result.contacts[0];
  assert.equal(contact.source.key, input.sourceKey); assert.equal(contact.source.rowId, '1');
  assert.equal(contact.profile.contactConsent, 'unknown'); assert.equal(contact.profile.attendanceIntent, 'expected');
  assert.equal(contact.operations.responseStatus, 'pending'); assert.equal(contact.invitation.sentAt, null);
  const durable = (await f.journal.read()).value;
  assert.equal(durable.migrationArchives[0].sourceKind, 'rows');
  assert.equal(JSON.stringify(durable).includes(file.toString('base64')), false);
  await assert.rejects(f.importer.preview({ ...input, originalSha256: 'f'.repeat(64), actor }), { code: 'INVALID_INPUT' });
  const again = await f.importer.preview({ ...input, actor });
  assert.equal(again.summary.new, 0); assert.equal(again.summary.unchanged, 1);
});

test('same source identity with changed original digest conflicts; duplicate contact channels require explicit review', async () => {
  const source = await original(), f = target();
  let preview = await f.importer.preview({ kind: source.kind, snapshot: source.snapshot, originalSha256: source.originalSha256, actor });
  await f.importer.commit(commitInput(source, preview));
  const changed = structuredClone(source.value); changed.contacts[0].sourceProfile.organization = '合成来源变更';
  changed.contacts[0].sourceProfileDigest = contactHash(JSON.stringify(changed.contacts[0].sourceProfile));
  changed.contacts[0].source.digest = changed.contacts[0].sourceProfileDigest;
  const snapshot = JSON.stringify(changed);
  preview = await f.importer.preview({ kind: 'snapshot', snapshot, originalSha256: contactHash(snapshot), actor });
  assert.equal(preview.canCommit, false); assert.equal(preview.summary.conflicts, 1);
  await assert.rejects(f.importer.commit({ ...commitInput({ kind: 'snapshot', snapshot, originalSha256: contactHash(snapshot) }, preview) }), { code: 'REVISION_CONFLICT' });
  const empty = target(); await empty.store.createContact(0, { name: '合成不同对象', email: source.contact.profile.email }, actor.id);
  preview = await empty.importer.preview({ kind: source.kind, snapshot: source.snapshot, originalSha256: source.originalSha256, actor });
  assert.equal(preview.summary.possibleDuplicates, 1);
  await assert.rejects(empty.importer.commit(commitInput(source, preview)), { code: 'REVISION_CONFLICT' });
  const accepted = await empty.importer.commit({ ...commitInput(source, preview), allowPossibleDuplicates: true });
  assert.equal(accepted.contacts.length, 2);
});

test('unknown import acknowledgement never reports success or retries; an explicit replay reads the committed migration', async () => {
  const source = await original(), objects = memoryObjects(), base = createObjectJournal({ objects, prefix: 'cms/v1/contacts' });
  let attempts = 0;
  const f = target({ objects, journal: { read: base.read, async commit(...args) { attempts++; await base.commit(...args); throw new Error('PRIVATE-SYNTHETIC-LOST-ACK'); } } });
  const preview = await f.importer.preview({ kind: source.kind, snapshot: source.snapshot, originalSha256: source.originalSha256, actor });
  await assert.rejects(f.importer.commit(commitInput(source, preview)), error => error.code === 'STORAGE_UNAVAILABLE' && !error.message.includes('PRIVATE-'));
  assert.equal(attempts, 1);
  const recovered = target({ objects });
  const replay = await recovered.importer.commit(commitInput(source, preview));
  assert.equal(replay.imported, false); assert.equal(replay.contacts.length, 1);
  assert.equal(objects.calls.filter(call => call.operation === 'append').length, 1);
});

test('independent import instances have a single atomic winning migration and never silently overwrite', async () => {
  const source = await original(), first = target(), second = target({ objects: first.objects });
  const payload = { kind: source.kind, snapshot: source.snapshot, originalSha256: source.originalSha256, actor };
  const previews = await Promise.all([first.importer.preview(payload), second.importer.preview(payload)]);
  const outcomes = await Promise.allSettled([first.importer.commit(commitInput(source, previews[0])), second.importer.commit(commitInput(source, previews[1]))]);
  assert.ok(outcomes.some(result => result.status === 'fulfilled'));
  for (const result of outcomes.filter(result => result.status === 'rejected')) assert.equal(result.reason.code, 'REVISION_CONFLICT');
  assert.equal((await first.store.read()).contacts.length, 1);
  assert.equal((await first.journal.read()).value.audit.length, 1);
});

test('a recomputed archive checksum cannot bless unknown audit actions or altered source metadata on later reads', async () => {
  const source = await original(), f = target();
  const preview = await f.importer.preview({ kind: source.kind, snapshot: source.snapshot, originalSha256: source.originalSha256, actor });
  await f.importer.commit(commitInput(source, preview));
  const baseline = (await f.journal.read()).value;
  for (const alter of [state => {
    const archived = JSON.parse(state.migrationArchives[0].snapshot); archived.audit[0].action = 'arbitrary_archive_action';
    const snapshot = JSON.stringify(archived), digest = contactHash(snapshot);
    Object.assign(state.migrationArchives[0], { snapshot, digest, sourceFileSha256: digest, payloadSha256: digest }); state.audit[0].archiveDigest = digest;
  }, state => { state.migrationArchives[0].sourceFileSha256 = 'f'.repeat(64); }, state => { state.audit[0].actorId = 'other-staff'; }]) {
    const value = structuredClone(baseline); alter(value);
    const broken = target({ journal: { read: async () => ({ value, cursor: { position: 100, version: 1, hash: 'a'.repeat(64) } }), commit: async () => { throw new Error('unexpected mutation'); } } });
    await assert.rejects(broken.store.read(), { code: 'CONTACT_STORAGE_ERROR' });
  }
});

test('import preview and commit bind source digest, authenticated operator, revision and explicit source review', async () => {
  const source = await original(), f = target();
  const preview = await f.importer.preview({ kind: source.kind, snapshot: source.snapshot, originalSha256: source.originalSha256, actor });
  const input = commitInput(source, preview);
  await assert.rejects(f.importer.commit({ ...input, confirmSource: false }), { code: 'INVALID_INPUT' });
  await assert.rejects(f.importer.commit({ ...input, actor: { ...actor, id: 'another-staff' } }), { code: 'REVISION_CONFLICT' });
  await assert.rejects(f.importer.commit({ ...input, expectedRevision: 1 }), { code: 'REVISION_CONFLICT' });
  await assert.rejects(f.importer.preview({ kind: source.kind, snapshot: source.snapshot, originalSha256: source.originalSha256, actor: { id: actor.id, roles: ['editor'] } }), { code: 'FORBIDDEN' });
  const api = createIntentContactImportApi({ importer: f.importer, authenticate: async () => ({ user: actor, csrfToken: 'synthetic-csrf' }) });
  const request = (path, payload, headers = {}) => new Request('https://api.artdico.host' + path, { method: 'POST',
    headers: { origin: 'https://api.artdico.host', 'content-type': 'application/json', 'x-csrf-token': 'synthetic-csrf', ...headers }, body: JSON.stringify(payload) });
  const payload = { kind: source.kind, snapshot: source.snapshot, originalSha256: source.originalSha256 };
  assert.equal((await api(request('/api/admin/contacts/import/preview', payload, { origin: 'https://evil.example.invalid' }))).status, 403);
  assert.equal((await api(request('/api/admin/contacts/import/preview', payload, { 'x-csrf-token': 'wrong' }))).status, 403);
  const response = await api(request('/api/admin/contacts/import/preview', payload));
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json(); assert.equal(body.summary.new, 1); assert.deepEqual(body.rows, []);
  assert.equal(JSON.stringify(body).includes(source.contact.profile.email), false);
});
