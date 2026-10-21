import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { hashPassword } from '../functions/content-api/auth.mjs';
import { createContentApi } from '../functions/content-api/handler.mjs';
import { createCloudContentApi, CLOUD_API_ORIGIN, PUBLIC_SITE_ORIGIN } from '../functions/cloud-content/handler.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { collectJournalBackupKeys, createEncryptedObjectBackup, generateBackupKey, inspectEncryptedObjectBackup, restoreEncryptedBackupIsolated } from '../functions/registration-admin/maintenance.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const bytes = Buffer.from('SYNTHETIC-ORGANIZATION-LOGO');
const id = digest(bytes) + '.png', imagePath = '/api/public/portraits/' + id;
const publicOrganization = () => ({ id: 'synthetic-org', name: '合成参与组织', participation: 'attendee', website: 'https://example.invalid/organization', logoUrl: imagePath });
const content = organizations => ({ guests: [], showcases: [], organizations });
const user = { id: 'synthetic-org-editor', username: 'org-editor', label: '合成工作人员', roles: ['editor'], passwordHash: await hashPassword('synthetic-organization-test-password') };
const noop = async () => assert.fail('Only the public image boundary is used by this fixture.');

for (const mode of ['local', 'cloud']) {
  test(`${mode} organization logos require a current exact public reference and withdrawal revokes anonymous image access`, async () => {
    let published = null, reads = 0;
    const store = { read: async () => ({ draft: { content: content([{ logoId: id }]) }, published }), save: noop, publish: noop, recordPortraitUpload: noop };
    const portraits = { upload: noop, read: async supplied => { assert.equal(supplied, id); reads++; return { data: bytes, bytes: bytes.length, contentType: 'image/png' }; } };
    const origin = mode === 'local' ? 'http://127.0.0.1:8787' : CLOUD_API_ORIGIN;
    const api = mode === 'local'
      ? createContentApi({ store, portraitStore: portraits, users: [user], allowedOrigin: origin })
      : createCloudContentApi({ enabled: true, store, portraitStore: portraits, auth: { login: noop, logout: noop, authenticate: noop } });
    const read = (path = imagePath, method = 'GET') => api(new Request(origin + path, {
      method, headers: { origin: mode === 'cloud' ? PUBLIC_SITE_ORIGIN : origin, cookie: 'synthetic-staff-cookie=must-not-authorize' },
    }));

    assert.equal((await read()).status, 404, 'a private draft never authorizes a logo');
    published = { content: content([]) };
    assert.equal((await read()).status, 404);
    published = { content: content([publicOrganization()]) };
    const accepted = await read();
    assert.equal(accepted.status, 200);
    assert.equal(accepted.headers.get('cache-control'), 'no-store');
    assert.equal(accepted.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await accepted.arrayBuffer()), bytes);
    if (mode === 'cloud') {
      const head = await read(imagePath, 'HEAD');
      assert.equal(head.status, 200); assert.equal(await head.text(), '');
      assert.equal(head.headers.get('access-control-allow-origin'), PUBLIC_SITE_ORIGIN);
      assert.equal(head.headers.get('access-control-allow-credentials'), null);
    }
    const successfulReads = reads;
    for (const logoUrl of ['https://example.invalid' + imagePath, imagePath + '?download=1', '/api/admin/portraits/' + id, '', '/api/public/portraits/' + 'f'.repeat(64) + '.png']) {
      published = { content: content([{ ...publicOrganization(), logoUrl }]) };
      assert.equal((await read()).status, 404, 'only the exact current publication route qualifies');
    }
    published = { content: content([]) };
    assert.equal((await read()).status, 404, 'withdrawn organizations no longer authorize their stored logo');
    assert.equal(reads, successfulReads, 'rejected requests never read private image bytes');
  });
}

test('organization backup follows all historical private IDs and public logo routes, then restores only into isolation', async () => {
  const objects = memoryObjects(), prefix = 'cms/v1/content', journal = createObjectJournal({ objects, prefix });
  const images = ['HISTORICAL-PRIVATE-ORG-LOGO', 'CURRENT-PRIVATE-ORG-LOGO', 'HISTORICAL-PUBLIC-ORG-LOGO'].map(value => Buffer.from('SYNTHETIC-' + value));
  const ids = images.map(value => digest(value) + '.png'), imageKeys = ids.map(value => 'cms/v1/portraits/' + value);
  for (let index = 0; index < images.length; index++) await objects.putImmutable(imageKeys[index], images[index], { contentType: 'image/png' });
  const state = (draftOrganizations, publicOrganizations = null) => ({ storageVersion: 1,
    draft: { content: content(draftOrganizations) }, published: publicOrganizations === null ? null : { content: content(publicOrganizations) }, audit: [] });
  await journal.commit((await journal.read()).cursor, state([{ id: 'private-old', logoId: ids[0], status: 'pending', publicConsent: false }]));
  await journal.commit((await journal.read()).cursor, state([{ id: 'private-current', logoId: ids[1], website: 'https://example.invalid/no-fetch' }], [{ ...publicOrganization(), logoUrl: '/api/public/portraits/' + ids[2] }]));
  await journal.commit((await journal.read()).cursor, state([], []));

  const keys = await collectJournalBackupKeys({ objects, journalPrefixes: [prefix] });
  assert.equal(keys.length, 7);
  for (const name of imageKeys) assert.ok(keys.includes(name), 'historical and private logos belong to the backup closure');
  const key = generateBackupKey(), backup = await createEncryptedObjectBackup({ objects, keys, key });
  const inspection = inspectEncryptedObjectBackup({ bundle: backup.bundle, key, includeObjects: true });
  assert.equal(inspection.objectCount, 7);
  assert.equal(backup.bundle.includes(Buffer.from('PRIVATE-ORG-LOGO')), false);
  const target = memoryObjects(), restoreId = 'synthetic-organization-restore';
  const restored = await restoreEncryptedBackupIsolated({ objects: target, bundle: backup.bundle, key, restoreId });
  assert.equal(restored.active, false); assert.equal(restored.sessionsRestored, false);
  for (let index = 0; index < imageKeys.length; index++) {
    const result = await target.get(restored.namespace + '/' + imageKeys[index].slice('cms/v1/'.length));
    assert.deepEqual(result.data, images[index]);
  }
  const recovered = createObjectJournal({ objects: target, prefix: restored.namespace + '/content' });
  assert.deepEqual((await recovered.read()).value, (await journal.read()).value);
  assert.ok([...target.files.keys()].every(name => name.startsWith(restored.namespace + '/')));
  await assert.rejects(createEncryptedObjectBackup({ objects, keys: keys.filter(name => name !== imageKeys[0]), key }), error => error.code === 'BACKUP_INVALID');
});

test('malformed or missing organization logo references fail backup closure validation without fetching external URLs', async () => {
  for (const organizations of [{}, [{ logoId: 123 }], [{ logoId: 'bad-private-id' }], [{ logoUrl: 'https://example.invalid/logo.png' }], [{ logoUrl: imagePath + '?download=1' }], [{ logoUrl: '/api/public/portraits/' + 'f'.repeat(64) + '.png' }]]) {
    const objects = memoryObjects(), prefix = 'cms/v1/content', journal = createObjectJournal({ objects, prefix });
    await journal.commit((await journal.read()).cursor, { storageVersion: 1, draft: { content: content(organizations) }, published: null, audit: [] });
    await assert.rejects(collectJournalBackupKeys({ objects, journalPrefixes: [prefix] }), error => error.code === 'BACKUP_INVALID');
    assert.ok(objects.calls.every(call => call.key.startsWith('cms/v1/')), 'no external source lookup is introduced');
  }
});
