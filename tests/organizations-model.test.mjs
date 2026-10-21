import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createInitialContent } from '../src/config/content.mjs';
import { validateContent, toPublicContent } from '../shared/content-schema.mjs';
import { createFileContentStore } from '../functions/content-api/store.mjs';
import { createFilePortraitStore } from '../functions/content-api/portrait-store.mjs';
import { createOssContentStore } from '../functions/cloud-content/store.mjs';
import { createOssPortraitStore } from '../functions/cloud-content/portrait-store.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';

const now = () => Date.parse('2026-10-21T01:00:00.000Z'), actor = 'synthetic-org-editor';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0KFjAwMDAxMDAgKAAGOQBVgs9CEsAAAAASUVORK5CYII=';
const organization = changes => ({ id: 'synthetic-organization', name: '合成组织', logoId: '', website: 'https://example.invalid/organization',
  participation: 'attendee', status: 'confirmed', publicConsent: true, internalNotes: 'PRIVATE-ORG-NOTE', ...changes });
function contentWith(organizations) { return { ...createInitialContent(), organizations }; }

test('historical organization absence stays absent while an explicit empty publication stays empty', () => {
  const legacy = createInitialContent(), normalized = validateContent(legacy).value, published = toPublicContent(legacy);
  assert.equal(Object.hasOwn(legacy, 'organizations'), false);
  assert.equal(Object.hasOwn(normalized, 'organizations'), false);
  assert.equal(Object.hasOwn(published, 'organizations'), false);
  assert.deepEqual(toPublicContent(published), published);
  assert.deepEqual(validateContent(contentWith([])).value.organizations, []);
  assert.deepEqual(toPublicContent(contentWith([])).organizations, []);
  assert.deepEqual(toPublicContent(toPublicContent(contentWith([]))), toPublicContent(contentWith([])));
});

test('organizations publish independently of booth allocation and only with explicit confirmation and consent', () => {
  const content = contentWith([
    organization({ id: 'synthetic-attendee' }), organization({ id: 'synthetic-exhibitor', participation: 'exhibitor' }),
    organization({ id: 'synthetic-undecided', participation: 'undecided' }), organization({ id: 'synthetic-pending', status: 'pending' }),
    organization({ id: 'synthetic-withdrawn', status: 'withdrawn' }), organization({ id: 'synthetic-private', publicConsent: false }),
  ]);
  const before = structuredClone(content), published = toPublicContent(content);
  assert.deepEqual(published.organizations.map(row => row.participation), ['attendee', 'exhibitor', 'undecided']);
  assert.equal(published.booths.length, 0, 'an organization never occupies a booth merely by being listed');
  assert.equal(published.organizations[0].logoUrl, '', 'an existing public name does not need an invented logo');
  assert.doesNotMatch(JSON.stringify(published), /PRIVATE-ORG-NOTE|internalNotes/u);
  assert.deepEqual(toPublicContent(published), published, 'the public snapshot survives actual store re-validation');
  assert.deepEqual(toPublicContent(validateContent(published).value), published);
  assert.deepEqual(content, before);
});

test('organization shapes, IDs, approval flags, bounded text and external links fail closed', () => {
  const invalid = [null, 12, {}, { ...organization(), status: undefined }, { ...organization(), publicConsent: undefined },
    organization({ name: '' }), organization({ name: '字'.repeat(161) }), organization({ name: 'bad\nname' }),
    organization({ status: 'scheduled' }), organization({ participation: 'sponsor' }), organization({ publicConsent: 'yes' }),
    organization({ logoId: 'https://example.invalid/logo.png' }), organization({ website: 'javascript:alert(1)' }),
    organization({ website: 'https://user:password@example.invalid/' }), organization({ website: 'https://example.invalid/\ntrack' }),
    organization({ internalNotes: 'x'.repeat(4001) }), organization({ internalNotes: 'bad\u0000note' }),
    { ...organization(), logoUrl: 'https://example.invalid/logo.png' }, { ...organization(), unexpected: 'PRIVATE' }];
  for (const row of invalid) {
    const input = contentWith([row]);
    assert.equal(validateContent(input).valid, false, JSON.stringify(row));
    assert.throws(() => toPublicContent(input));
  }
  for (const value of [null, undefined, {}, 'organizations']) assert.equal(validateContent(contentWith(value)).valid, false);
  assert.equal(validateContent(contentWith(Array.from({ length: 201 }, (_, index) => organization({ id: 'org-' + index })))).valid, false);
  assert.equal(validateContent(contentWith([organization(), organization()])).valid, false);
  const reused = contentWith([organization({ id: createInitialContent().sessions[0].id })]);
  assert.equal(validateContent(reused).valid, false, 'stable IDs do not collide with another content type');
  const publicOnly = { id: 'org', name: '合成', participation: 'attendee', website: '', logoUrl: '' };
  assert.equal(validateContent(contentWith([publicOnly])).valid, false, 'a five-field public-looking payload cannot grant approval');
  const accessor = organization(); Object.defineProperty(accessor, 'publicConsent', { enumerable: true, get() { assert.fail('organization accessors must not run'); } });
  assert.equal(validateContent(contentWith([accessor])).valid, false);
  const root = createInitialContent(); Object.defineProperty(root, 'organizations', { enumerable: true, get() { assert.fail('root accessors must not run'); } });
  assert.equal(validateContent(root).valid, false);
});

async function fixture(mode, t) {
  if (mode === 'local') {
    const directory = await mkdtemp(join(tmpdir(), 'artdico-organizations-')); t.after(() => rm(directory, { recursive: true, force: true }));
    const portraits = createFilePortraitStore({ directory });
    return { portraits, make: () => createFileContentStore({ directory, portraitStore: portraits, now }),
      removeImage: id => unlink(join(directory, 'portraits', id)) };
  }
  const objects = memoryObjects(), portraits = createOssPortraitStore({ objects });
  return { portraits, make: () => createOssContentStore({ portraitStore: portraits, now, journal: createObjectJournal({ objects, prefix: 'cms/v1/content' }) }),
    removeImage: async id => objects.files.delete('cms/v1/portraits/' + id) };
}

for (const mode of ['local', 'cloud']) {
  test(`${mode} organization drafts survive publication restart, legacy omissions, reorder and explicit withdrawal`, async t => {
    const { make, portraits } = await fixture(mode, t), first = make();
    const legacy = await first.publish(0, actor); assert.equal(Object.hasOwn(legacy.content, 'organizations'), false);
    assert.deepEqual((await make().read()).published, legacy);
    const receipt = await portraits.upload({ contentType: 'image/png', dataBase64: PNG });
    const input = (await first.read()).draft.content;
    input.organizations = [organization({ logoId: receipt.id }), organization({ id: 'synthetic-exhibitor', participation: 'exhibitor' })];
    const saved = await first.save(0, input, actor), published = await first.publish(saved.revision, actor);
    assert.equal(published.content.organizations[0].logoUrl, '/api/public/portraits/' + receipt.id);
    assert.doesNotMatch(JSON.stringify(published), /PRIVATE-ORG-NOTE/u);
    assert.deepEqual((await make().read()).published, published, 'a fresh store validates and reads the eight-field public profile');

    const oldClient = structuredClone(saved.content); delete oldClient.organizations; oldClient.event.title += ' 更新';
    const preserved = await make().save(saved.revision, oldClient, actor);
    assert.deepEqual(preserved.content.organizations, saved.content.organizations, 'a legacy client cannot silently erase the new list');
    assert.deepEqual((await make().read()).published, published, 'saving a draft does not change the public list');
    await assert.rejects(first.save(saved.revision, saved.content, actor), error => error.code === 'REVISION_CONFLICT');
    await assert.rejects(first.publish(saved.revision, actor), error => error.code === 'REVISION_CONFLICT');
    const omittedNotes = structuredClone(preserved.content); delete omittedNotes.organizations[0].internalNotes;
    const notesRetained = await make().save(preserved.revision, omittedNotes, actor);
    assert.equal(notesRetained.content.organizations[0].internalNotes, 'PRIVATE-ORG-NOTE', 'omitting an optional private note cannot clear it');

    const stopped = structuredClone(notesRetained.content); stopped.organizations.reverse();
    Object.assign(stopped.organizations[1], { status: 'withdrawn', publicConsent: false });
    const withdrawn = await make().save(notesRetained.revision, stopped, actor), live = await make().publish(withdrawn.revision, actor);
    assert.deepEqual(live.content.organizations.map(row => row.id), ['synthetic-exhibitor']);
    const original = (await make().read()).draft.content.organizations[1];
    assert.equal(original.logoId, receipt.id); assert.equal(original.website, organization().website); assert.equal(original.internalNotes, 'PRIVATE-ORG-NOTE');
    const clearing = structuredClone(withdrawn.content); clearing.organizations = [];
    const empty = await make().save(withdrawn.revision, clearing, actor); await make().publish(empty.revision, actor);
    assert.deepEqual((await make().read()).published.content.organizations, []);
  });

  test(`${mode} every referenced organization logo is verified on save and again before publication`, async t => {
    const { make, portraits, removeImage } = await fixture(mode, t), store = make(), input = (await store.read()).draft.content;
    input.organizations = [organization({ status: 'pending', publicConsent: false, logoId: 'a'.repeat(64) + '.png' })];
    await assert.rejects(store.save(0, input, actor), error => error.code === 'VALIDATION_ERROR' && Boolean(error.fields['organizations.0.logoId']));
    assert.equal((await store.read()).draft.revision, 0);
    const image = await portraits.upload({ contentType: 'image/png', dataBase64: PNG });
    input.organizations[0].logoId = image.id;
    const saved = await store.save(0, input, actor);
    await removeImage(image.id);
    await assert.rejects(make().publish(saved.revision, actor), error => error.code === 'VALIDATION_ERROR' && Boolean(error.fields['organizations.0.logoId']));
    assert.equal((await store.read()).published, null);
    assert.equal((await store.read()).draft.content.organizations[0].logoId, image.id, 'a failed publish retains the private record');
  });

  test(`${mode} two editors cannot overwrite a concurrent organization edit`, async t => {
    const { make } = await fixture(mode, t), left = contentWith([organization({ name: '合成左组织' })]), right = contentWith([organization({ name: '合成右组织' })]);
    const outcomes = await Promise.allSettled([make().save(0, left, 'left-editor'), make().save(0, right, 'right-editor')]);
    assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(outcomes.find(row => row.status === 'rejected').reason.code, 'REVISION_CONFLICT');
    const current = (await make().read()).draft;
    assert.equal(current.revision, 1); assert.equal(current.content.organizations.length, 1);
    assert.ok(['合成左组织', '合成右组织'].includes(current.content.organizations[0].name));
  });
}
