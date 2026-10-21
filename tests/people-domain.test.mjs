import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createEmptyContactOperations, validateContactOperations, preserveContactOperationDefaults, hasNewContactAllocations,
  validateContactOrganizationMembershipChanges } from '../shared/contacts-schema.mjs';
import { validateContent, toPublicContent, validateBoothOrganizationChanges } from '../shared/content-schema.mjs';
import { toContactPlanningContent, guestPrefillFromContact } from '../shared/contact-editor.mjs';
import { createFileContactsStore } from '../functions/content-api/contacts-store.mjs';
import { createOssContactsStore } from '../functions/cloud-content/contacts-store.mjs';
import { createFileContentStore } from '../functions/content-api/store.mjs';
import { createOssContentStore } from '../functions/cloud-content/store.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { createIntentContactImporter } from '../functions/intent-invitations/importer.mjs';
import { contactHash, readContactSnapshot } from '../functions/intent-invitations/contact-snapshot.mjs';
import { collectJournalBackupKeys, createEncryptedObjectBackup, generateBackupKey, restoreEncryptedBackupIsolated } from '../functions/registration-admin/maintenance.mjs';
import { createInitialContent } from '../src/config/content.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';

const AT = Date.parse('2026-10-21T10:00:00.000Z'), now = () => AT, ACTOR = 'synthetic-people-editor';
const clone = value => structuredClone(value), failure = (code, status) => error => error.code === code && (status === undefined || error.status === status);
const membership = (organizationId = 'org-one', role = 'member', title = '') => ({ organizationId, role, title });
const organization = (id = 'org-one', overrides = {}) => ({ id, name: '合成组织', logoId: '', website: '', participation: 'attendee', status: 'confirmed', publicConsent: true, internalNotes: 'SYNTHETIC_PRIVATE_ORG_NOTE', ...overrides });
const booth = (overrides = {}) => ({ id: 'booth-one', code: 'C01', organization: '旧机构显示文字', project: '合成项目', zone: 'C', status: 'confirmed', internalNotes: '', slotNumber: 1, ...overrides });
const guest = (overrides = {}) => ({ id: 'guest-one', name: '合成人员', company: '旧机构显示文字', ggjRole: '', portraitId: '', status: 'pending', publicConsent: false, internalNotes: '', contactId: 'contact-one', ...overrides });
const content = (overrides = {}) => ({ ...createInitialContent(), organizations: [organization()], booths: [booth()], guests: [guest()], ...overrides });
const profile = { name: '合成对象', organization: '旧机构显示文字', contactConsent: 'unknown', email: 'synthetic@example.invalid' };
async function contactsFixture(mode, t, seed = content()) {
  const current = { content: seed }, contentStore = { read: async () => ({ draft: { content: clone(current.content) } }) };
  if (mode === 'local') {
    const directory = await mkdtemp(join(tmpdir(), 'artdico-people-contacts-')); t.after(() => rm(directory, { recursive: true, force: true }));
    const make = () => createFileContactsStore({ directory, contentStore, now });
    return { current, directory, make, store: make(), raw: async () => JSON.parse(await readFile(join(directory, 'contacts.json'), 'utf8')) };
  }
  const objects = memoryObjects(), prefix = 'cms/v1/contacts', journal = createObjectJournal({ objects, prefix });
  const make = () => createOssContactsStore({ journal: createObjectJournal({ objects, prefix }), contentStore, now });
  return { current, objects, journal, contentStore, make, store: make(), raw: async () => (await journal.read()).value };
}
async function contentFixture(mode, t, seed = content()) {
  if (mode === 'local') {
    const directory = await mkdtemp(join(tmpdir(), 'artdico-people-content-')); t.after(() => rm(directory, { recursive: true, force: true }));
    const make = () => createFileContentStore({ directory, initialContent: seed, now });
    return { directory, make, store: make(), raw: async () => readFile(join(directory, 'content.json'), 'utf8') };
  }
  const objects = memoryObjects(), prefix = 'cms/v1/content';
  const make = () => createOssContentStore({ journal: createObjectJournal({ objects, prefix }), initialContent: seed, now });
  return { objects, make, store: make(), raw: async () => JSON.stringify([...objects.files].map(([key, item]) => [key, item.data.toString('base64')])) };
}

test('private membership shape is explicit, bounded and separate from onsite duties and admission', () => {
  const original = createEmptyContactOperations(), input = { ...original, organizationMemberships: [membership('org-one', 'lead', '  合成带队人  '), membership('org-two')] };
  const checked = validateContactOperations(input); assert.equal(checked.valid, true); assert.equal(checked.value.organizationMemberships[0].title, '合成带队人');
  assert.equal(checked.value.responseStatus, 'pending'); assert.deepEqual(checked.value.participationForms, []); assert.deepEqual(checked.value.sessionIds, []); assert.equal(Object.hasOwn(checked.value, 'admission'), false);
  assert.equal(hasNewContactAllocations(checked.value, original), false, 'affiliation alone never becomes an onsite duty');
  const legacy = clone(input); delete legacy.organizationMemberships;
  assert.deepEqual(validateContactOperations(legacy).value.organizationMemberships, []);
  const preserved = preserveContactOperationDefaults(legacy, checked.value); assert.deepEqual(preserved.organizationMemberships, checked.value.organizationMemberships);
  preserved.organizationMemberships[0].title = 'detached'; assert.equal(checked.value.organizationMemberships[0].title, '合成带队人');
  assert.deepEqual(preserveContactOperationDefaults({ ...legacy, organizationMemberships: [] }, checked.value).organizationMemberships, []);
  for (const value of [undefined, null, 'org-one', [membership(), membership()], [membership('')], [membership('org-one', 'speaker')], [{ organizationId: 'org-one', role: 'member' }],
    [{ ...membership(), attendee: true }], [membership('org-one', 'lead', 'x'.repeat(121))], [membership('org-one', 'lead', '合成\n称谓')], [membership('org-one', 'lead', '\ud800')],
    Array.from({ length: 21 }, (_, index) => membership('org-' + index))]) assert.equal(validateContactOperations({ ...original, organizationMemberships: value }).valid, false);
  const getter = { organizationId: 'org-one', role: 'member' }; Object.defineProperty(getter, 'title', { enumerable: true, get: () => assert.fail('membership getter cannot execute') });
  assert.equal(validateContactOperations({ ...original, organizationMemberships: [getter] }).valid, false);
  const source = { ...original }; Object.defineProperty(source, 'organizationMemberships', { enumerable: true, get: () => assert.fail('membership getter cannot execute') });
  assert.equal(validateContactOperations(source).valid, false);
});

test('membership reference checks accept saved identities including withdrawn history, preserve orphans and refuse invented IDs', () => {
  const current = { organizationMemberships: [membership('orphan')] };
  assert.equal(validateContactOrganizationMembershipChanges(current, current, []).valid, true);
  assert.equal(validateContactOrganizationMembershipChanges({ organizationMemberships: [membership('orphan', 'lead', '历史成员')] }, current, []).valid, true);
  assert.equal(validateContactOrganizationMembershipChanges({ organizationMemberships: [] }, current, []).valid, true);
  assert.equal(validateContactOrganizationMembershipChanges({ organizationMemberships: [membership()] }, current, []).valid, false);
  assert.equal(validateContactOrganizationMembershipChanges({ organizationMemberships: [membership()] }, current, [organization('org-one', { status: 'withdrawn' })]).valid, true);
  assert.equal(validateContactOrganizationMembershipChanges({ organizationMemberships: [] }, current, undefined).valid, false);
});

test('booth relations remain optional and private; syntax never guesses identities from company display text', () => {
  const old = content(); delete old.organizations;
  const normalized = validateContent(old); assert.equal(normalized.valid, true); assert.equal(Object.hasOwn(normalized.value.booths[0], 'organizationId'), false);
  assert.equal(Object.hasOwn(toPublicContent(old).booths[0], 'organizationId'), false);
  const linked = content({ booths: [booth({ organizationId: 'org-one' })] });
  assert.equal(validateContent(linked).valid, true); assert.equal(validateBoothOrganizationChanges(linked, old).valid, true);
  const orphan = content({ booths: [booth({ organizationId: 'missing' })] });
  assert.equal(validateContent(orphan).valid, true, 'orphan stored syntax remains readable'); assert.equal(validateBoothOrganizationChanges(orphan, old).valid, false);
  assert.equal(validateBoothOrganizationChanges(orphan, orphan).valid, true);
  for (const organizationId of [undefined, null, 123, 'bad/id', ' org-one ', '\ud800']) assert.equal(validateContent(content({ booths: [booth({ organizationId })] })).valid, false);
  const publicContent = toPublicContent(linked); assert.equal(Object.hasOwn(publicContent.booths[0], 'organizationId'), false); assert.equal(Object.hasOwn(publicContent.guests[0] ?? {}, 'contactId'), false);
  assert.deepEqual(toPublicContent(publicContent), publicContent);
  const planning = toContactPlanningContent(linked); assert.equal(planning.booths[0].organizationId, 'org-one'); assert.deepEqual(planning.organizations, [{ id: 'org-one', name: '合成组织', participation: 'attendee', status: 'confirmed' }]);
  assert.equal(JSON.stringify(planning).includes('SYNTHETIC_PRIVATE_ORG_NOTE'), false);
  const contact = { id: 'contact-one', profile: { ...profile, contactConsent: 'consented' }, operations: { ...createEmptyContactOperations(), organizationMemberships: [membership()] } };
  assert.equal(Object.hasOwn(guestPrefillFromContact(contact).value, 'organizationMemberships'), false);
});

for (const mode of ['local', 'cloud']) {
  test(`${mode} member saves preserve old-client omission and orphan history with explicit clearing and exact revision checks`, async t => {
    const f = await contactsFixture(mode, t), created = await f.store.createContact(0, profile, ACTOR), id = created.contact.id;
    const linked = await f.store.saveOperations(id, 1, { ...created.contact.operations, organizationMemberships: [membership('org-one', 'lead', '合成负责人')] }, ACTOR);
    assert.equal(linked.contact.operations.responseStatus, 'pending'); assert.deepEqual(linked.contact.operations.participationForms, []);
    const oldClient = { ...linked.contact.operations, notes: '合成联络记录' }; delete oldClient.organizationMemberships;
    const preserved = await f.make().saveOperations(id, 2, oldClient, ACTOR);
    assert.deepEqual(preserved.contact.operations.organizationMemberships, linked.contact.operations.organizationMemberships);
    f.current.content.organizations = [];
    const orphan = await f.make().saveOperations(id, 3, { ...oldClient, notes: '保留历史关系' }, ACTOR); assert.equal(orphan.contact.operations.organizationMemberships[0].organizationId, 'org-one');
    await assert.rejects(f.make().saveOperations(id, 4, { ...oldClient, organizationMemberships: [membership('unrecorded-org')] }, ACTOR), failure('VALIDATION_ERROR', 422));
    await assert.rejects(f.make().saveOperations(id, 4, { ...oldClient, organizationMemberships: undefined }, ACTOR), failure('VALIDATION_ERROR', 422));
    await assert.rejects(f.make().saveOperations(id, 1, oldClient, ACTOR), failure('REVISION_CONFLICT', 409));
    assert.equal((await f.make().read()).revision, 4);
    const cleared = await f.make().saveOperations(id, 4, { ...oldClient, organizationMemberships: [] }, ACTOR);
    assert.deepEqual((await f.make().read()).contacts[0].operations.organizationMemberships, []); assert.equal(cleared.revision, 5);
  });

  test(`${mode} content saves preserve omitted private IDs, support explicit unlink, and retain orphan relations on later edits`, async t => {
    const f = await contentFixture(mode, t), initial = await f.store.read();
    const candidate = clone(initial.draft.content); candidate.booths[0].organizationId = 'org-one';
    const saved = await f.store.save(0, candidate, ACTOR), legacy = clone(saved.content);
    delete legacy.booths[0].organizationId; delete legacy.guests[0].contactId; legacy.guests[0].ggjRole = '合成旧客户端更新';
    const preserved = await f.make().save(1, legacy, ACTOR); assert.equal(preserved.content.booths[0].organizationId, 'org-one'); assert.equal(preserved.content.guests[0].contactId, 'contact-one');
    const detached = clone(preserved.content); detached.organizations = [];
    const orphan = await f.make().save(2, detached, ACTOR); assert.equal(orphan.content.booths[0].organizationId, 'org-one');
    const unknown = clone(orphan.content); unknown.booths[0].organizationId = 'invented';
    await assert.rejects(f.make().save(3, unknown, ACTOR), failure('VALIDATION_ERROR', 422));
    const cleared = clone(orphan.content); cleared.booths[0].organizationId = ''; cleared.guests[0].contactId = '';
    const next = await f.make().save(3, cleared, ACTOR); assert.equal(next.content.booths[0].organizationId, ''); assert.equal(next.content.guests[0].contactId, '');
    const publication = await f.make().publish(4, ACTOR); assert.equal(Object.hasOwn(publication.content.booths[0], 'organizationId'), false);
    assert.equal(Object.hasOwn((await f.make().read()).draft.content.booths[0], 'organizationId'), true);
    await assert.rejects(f.make().save(3, cleared, ACTOR), failure('REVISION_CONFLICT', 409));
  });

  test(`${mode} old draft and publication without optional booth IDs keep exact persisted bytes on repeated reads`, async t => {
    const f = await contentFixture(mode, t), initial = (await f.store.read()).draft.content;
    const saved = await f.store.save(0, initial, ACTOR), publication = await f.store.publish(saved.revision, ACTOR), before = await f.raw();
    for (const store of [f.make(), f.make()]) {
      const read = await store.read(); assert.equal(Object.hasOwn(read.draft.content.booths[0], 'organizationId'), false);
      assert.equal(Object.hasOwn(read.published.content.booths[0], 'organizationId'), false); assert.deepEqual(read.published, publication);
    }
    assert.equal(await f.raw(), before);
  });

  test(`${mode} trusted content guard sees normalized preserved IDs once and rejection never saves or mutates the candidate`, async t => {
    const f = await contentFixture(mode, t), initial = (await f.store.read()).draft.content; await f.store.save(0, initial, ACTOR);
    const original = await f.raw(), legacy = clone(initial); delete legacy.guests[0].contactId; let calls = 0;
    const rejection = Object.assign(new Error('SYNTHETIC_GUARD_REJECTED'), { code: 'GUARD_REJECTED' });
    await assert.rejects(f.store.save(1, legacy, ACTOR, { beforeCommit: async ({ current, next }) => {
      calls++; assert.equal(current.guests[0].contactId, 'contact-one'); assert.equal(next.guests[0].contactId, 'contact-one');
      next.guests[0].contactId = 'never-written'; current.event.title = 'never-written'; throw rejection;
    } }), error => error === rejection);
    assert.equal(calls, 1); assert.equal(await f.raw(), original);
    const saved = await f.store.save(1, legacy, ACTOR, { beforeCommit: async ({ next }) => { calls++; next.guests[0].contactId = 'never-written'; } });
    assert.equal(saved.content.guests[0].contactId, 'contact-one'); assert.equal(calls, 2);
    await assert.rejects(f.store.save(1, legacy, ACTOR, { beforeCommit: () => assert.fail('stale revision cannot invoke guard') }), failure('REVISION_CONFLICT', 409));
    const invalid = clone(saved.content); invalid.booths[0].organizationId = 'not-saved';
    await assert.rejects(f.store.save(2, invalid, ACTOR, { beforeCommit: () => assert.fail('invalid relation cannot invoke guard') }), failure('VALIDATION_ERROR', 422));
    const getter = {}; Object.defineProperty(getter, 'beforeCommit', { enumerable: true, get: () => assert.fail('guard getter cannot execute') });
    await assert.rejects(f.store.save(2, saved.content, ACTOR, getter), TypeError);
    assert.equal((await f.make().read()).draft.revision, 2);
  });

  test(`${mode} guard receives a detached already-loaded publication envelope without modifying saved history`, async t => {
    const f = await contentFixture(mode, t), initial = (await f.store.read()).draft.content;
    await f.store.save(0, initial, ACTOR, { beforeCommit: ({ published }) => assert.equal(published, null) });
    const publication = await f.store.publish(1, ACTOR), before = await f.raw();
    const rejection = new Error('SYNTHETIC_PUBLICATION_GUARD_REJECTED');
    await assert.rejects(f.store.save(1, initial, ACTOR, { beforeCommit: ({ published }) => {
      assert.deepEqual(published, publication); published.content.booths[0].project = 'never-written'; published.revision = 999; throw rejection;
    } }), error => error === rejection);
    assert.equal(await f.raw(), before);
    const updated = clone(initial); updated.event.title = '合成后续草稿';
    await f.store.save(1, updated, ACTOR, { beforeCommit: ({ published, current, next }) => {
      assert.deepEqual(published, publication); assert.equal(current.event.title, initial.event.title); assert.equal(next.event.title, updated.event.title);
      published.content.booths[0].project = 'never-written'; published.publishedAt = 'never-written';
    } });
    assert.deepEqual((await f.make().read()).published, publication);
  });
}

test('including publication in a cloud guard uses the same exact OSS operations as an unguarded save', async t => {
  const observed = [];
  for (const guarded of [false, true]) {
    const f = await contentFixture('cloud', t), initial = (await f.store.read()).draft.content;
    await f.store.save(0, initial, ACTOR); await f.store.publish(1, ACTOR);
    const start = f.objects.calls.length, updated = clone(initial); updated.event.title = '合成同一份草稿更新';
    await f.store.save(1, updated, ACTOR, guarded ? { beforeCommit: ({ published }) => assert.equal(published.revision, 1) } : {});
    observed.push(f.objects.calls.slice(start));
  }
  assert.deepEqual(observed[1], observed[0]);
});

test('legacy contacts missing membership defaults read without rewriting local bytes or a cloud journal', async t => {
  const source = await contactsFixture('cloud', t), created = await source.store.createContact(0, profile, ACTOR), raw = await source.raw();
  delete raw.contacts[0].operations.organizationMemberships; delete raw.contacts[0].operations.sessionRoles; delete raw.contacts[0].operations.participationForms;
  const directory = await mkdtemp(join(tmpdir(), 'artdico-people-legacy-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const originalBytes = JSON.stringify(raw); await writeFile(join(directory, 'contacts.json'), originalBytes);
  const local = createFileContactsStore({ directory, contentStore: source.contentStore, now });
  assert.deepEqual((await local.read()).contacts[0].operations.organizationMemberships, []); assert.equal(await readFile(join(directory, 'contacts.json'), 'utf8'), originalBytes);
  const objects = memoryObjects(), journal = createObjectJournal({ objects, prefix: 'cms/v1/contacts' }); await journal.commit((await journal.read()).cursor, raw);
  const cloud = createOssContactsStore({ journal, contentStore: source.contentStore, now }), before = JSON.stringify([...objects.files].map(([key, value]) => [key, value.data.toString('base64')]));
  assert.deepEqual((await cloud.read()).contacts[0].operations.organizationMemberships, []); assert.equal(JSON.stringify([...objects.files].map(([key, value]) => [key, value.data.toString('base64')])), before);
  const normalized = (await cloud.read()).contacts[0]; await cloud.saveOperations(created.contact.id, 1, normalized.operations, ACTOR);
  assert.deepEqual((await journal.read()).value.contacts[0].operations.organizationMemberships, []);
});

test('old migration archive bytes survive import, later relationship edits, encrypted backup and isolated recovery', async t => {
  const source = await contactsFixture('cloud', t); await source.store.createContact(0, { ...profile, contactConsent: 'consented' }, ACTOR);
  const old = await source.raw(); delete old.contacts[0].operations.organizationMemberships;
  const snapshot = JSON.stringify(old), sha256 = contactHash(snapshot); assert.equal(Object.hasOwn(readContactSnapshot(snapshot).contacts[0].operations, 'organizationMemberships'), false);
  const f = await contactsFixture('cloud', t), actor = { id: ACTOR, roles: ['outreach'] }, importer = createIntentContactImporter({ contactsStore: f.store, now });
  const preview = await importer.preview({ kind: 'snapshot', snapshot, originalSha256: sha256, actor });
  const imported = await importer.commit({ kind: 'snapshot', snapshot, originalSha256: sha256, actor, expectedRevision: preview.expectedRevision, previewToken: preview.previewToken, confirmSource: true });
  const id = imported.contacts[0].id; assert.deepEqual(imported.contacts[0].operations.organizationMemberships, []);
  await f.make().saveOperations(id, 1, { ...imported.contacts[0].operations, organizationMemberships: [membership()] }, ACTOR);
  assert.equal((await f.raw()).migrationArchives[0].snapshot, snapshot); assert.equal((await f.make().read()).contacts[0].operations.organizationMemberships[0].organizationId, 'org-one');
  const keys = await collectJournalBackupKeys({ objects: f.objects, journalPrefixes: ['cms/v1/contacts'] }), key = generateBackupKey();
  const backup = await createEncryptedObjectBackup({ objects: f.objects, keys, key }), target = memoryObjects();
  assert.equal(backup.bundle.includes(Buffer.from('synthetic@example.invalid')), false);
  const restored = await restoreEncryptedBackupIsolated({ objects: target, bundle: backup.bundle, key, restoreId: 'synthetic-people-relationships' });
  const recovered = createOssContactsStore({ journal: createObjectJournal({ objects: target, prefix: restored.namespace + '/contacts' }), contentStore: f.contentStore, now });
  assert.deepEqual(await recovered.read(), await f.make().read()); assert.equal(restored.active, false);
  assert.equal((await createObjectJournal({ objects: target, prefix: restored.namespace + '/contacts' }).read()).value.migrationArchives[0].snapshot, snapshot);
});

test('a paused cloud guard stays in the same CAS attempt and cannot overwrite an independent winner', async t => {
  const f = await contentFixture('cloud', t), initial = (await f.store.read()).draft.content;
  let enter, release; const entered = new Promise(resolve => { enter = resolve; }), waiting = new Promise(resolve => { release = resolve; });
  const first = f.store.save(0, initial, ACTOR, { beforeCommit: async () => { enter(); await waiting; } }); await entered;
  const other = clone(initial); other.event.title = '合成获胜编辑'; const winner = await f.make().save(0, other, ACTOR); release();
  await assert.rejects(first, failure('REVISION_CONFLICT', 409)); assert.deepEqual((await f.make().read()).draft, winner);
});
