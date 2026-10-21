import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, unlink, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { loadCloudContentRelease, createProductionCloudServer } from '../functions/cloud-content/server.mjs';
import { hashPassword } from '../functions/content-api/auth.mjs';

const SOURCE = 'd'.repeat(40);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const NODE = { version: 'v24.19.0', platform: 'linux', arch: 'x64', sha256: 'bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12' };
const syntheticAssets = [
  { url: '/admin/', path: 'admin-assets/admin/index.html', data: '<!doctype html><p>synthetic content editor</p>' },
  { url: '/admin/contacts/', path: 'admin-assets/admin/contacts/index.html', data: '<!doctype html><p>synthetic contacts editor</p>' },
  { url: '/admin/registrations/', path: 'admin-assets/admin/registrations/index.html', data: '<!doctype html><p>synthetic registration review</p>' },
  { url: '/admin/tasks/', path: 'admin-assets/admin/tasks/index.html', data: '<!doctype html><p>synthetic organizer tasks</p>' },
  { url: '/admin/settings/', path: 'admin-assets/admin/settings/index.html', data: '<!doctype html><p>synthetic settings</p>' },
  { url: '/admin/person/', path: 'admin-assets/admin/person/index.html', data: '<!doctype html><p>synthetic person workspace</p>' },
  { url: '/invitations/template-blank.png', path: 'admin-assets/invitations/template-blank.png', data: 'synthetic blank image' },
  { url: '/_astro/staff-test.js', path: 'admin-assets/_astro/staff-test.js', data: 'export const synthetic=true;' },
];

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'artdico-cloud-entry-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const assets = [];
  for (const item of syntheticAssets) {
    const data = Buffer.from(item.data), path = join(directory, item.path);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, data, { flag: 'wx', mode: 0o644 });
    await chmod(path, 0o644);
    assets.push({ url: item.url, path: item.path, bytes: data.length, sha256: sha256(data), mode: '0644' });
  }
  const release = { schemaVersion: 1, kind: 'fc-cloud-content-candidate', sourceCommit: SOURCE, node: NODE,
    files: assets.map(({ url: _url, ...record }) => record), assets };
  const writeRelease = async () => {
    const path = join(directory, 'release.json');
    await writeFile(path, JSON.stringify(release), { mode: 0o644 });
    await chmod(path, 0o644);
  };
  await writeRelease();
  return { directory, release, writeRelease };
}

async function rejects(fixture) {
  await assert.rejects(loadCloudContentRelease({ codeDirectory: fixture.directory }), { message: 'Cloud content package verification failed.' });
}

function send(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port, path, headers: { host: 'api.artdico.host', connection: 'close', ...headers }, agent: false }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    request.setTimeout(3000, () => request.destroy(new Error('Synthetic entry request timed out')));
    request.on('error', reject); request.end();
  });
}

test('production entry import has no filesystem, network, listen or configuration side effects', () => {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(new URL('../functions/cloud-content/server.mjs', import.meta.url).href)}); process.stdout.write('import-only');`],
    { env: { PATH: process.env.PATH, LANG: 'C' }, encoding: 'utf8', timeout: 3000 });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, 'import-only');
  assert.equal(child.stderr, '');
});

test('entry reads only explicit hashed static assets and ignores unlisted private-looking files', async t => {
  const f = await fixture(t);
  await writeFile(join(f.directory, 'unlisted-private.json'), 'PRIVATE-SYNTHETIC-NOT-PUBLIC');
  const loaded = await loadCloudContentRelease({ codeDirectory: f.directory });
  assert.equal(loaded.sourceCommit, SOURCE);
  assert.equal(loaded.assets.size, syntheticAssets.length);
  for (const asset of syntheticAssets) assert.equal(loaded.assets.get(asset.url).toString('utf8'), asset.data);
  assert.equal([...loaded.assets.values()].some(bytes => bytes.includes(Buffer.from('PRIVATE-'))), false);
});

test('entry rejects changed, missing, nonregular, incorrectly-moded and symlinked assets', async t => {
  for (const mutation of ['changed', 'missing', 'directory', 'mode', 'symlink', 'parent-symlink', 'release-symlink']) {
    await t.test(mutation, async t => {
      const f = await fixture(t), path = join(f.directory, syntheticAssets[0].path);
      if (mutation === 'changed') await writeFile(path, 'changed asset');
      if (mutation === 'missing') await unlink(path);
      if (mutation === 'directory') { await unlink(path); await mkdir(path); }
      if (mutation === 'mode') await chmod(path, 0o600);
      if (mutation === 'symlink') { await unlink(path); await symlink(join(f.directory, syntheticAssets[1].path), path); }
      if (mutation === 'parent-symlink') {
        const target = join(f.directory, 'replacement-admin');
        await mkdir(target); await writeFile(join(target, 'index.html'), syntheticAssets[0].data, { mode: 0o644 });
        await rm(dirname(path), { recursive: true }); await symlink(target, dirname(path));
      }
      if (mutation === 'release-symlink') {
        const releasePath = join(f.directory, 'release.json');
        await writeFile(join(f.directory, 'other-release.json'), await readFile(releasePath), { mode: 0o644 });
        await unlink(releasePath); await symlink(join(f.directory, 'other-release.json'), releasePath);
      }
      await rejects(f);
    });
  }
});

test('entry rejects unreviewed manifest schema, identity, static URLs, paths and unmatched file records', async t => {
  const cases = {
    unknownField: release => { release.secret = 'PRIVATE-SYNTHETIC-MARKER'; },
    oldPackage: release => { release.kind = 'fc-preflight'; },
    shortSource: release => { release.sourceCommit = 'd'.repeat(7); },
    arraySource: release => { release.sourceCommit = [SOURCE]; },
    differentNode: release => { release.node = { ...release.node, version: 'v24.0.0' }; },
    missingContactsPage: release => { release.assets.splice(1, 1); },
    missingSettingsPage: release => { release.assets = release.assets.filter(asset => asset.url !== '/admin/settings/'); },
    missingPersonPage: release => { release.assets = release.assets.filter(asset => asset.url !== '/admin/person/'); },
    duplicateUrl: release => { release.assets.push({ ...release.assets[0] }); },
    duplicateFile: release => { release.files.push({ ...release.files[0] }); },
    publicHomepage: release => { release.assets[0].url = '/'; },
    queriedUrl: release => { release.assets[0].url = '/admin/?preview=1'; },
    hiddenSource: release => { release.assets[0].path = '.env.local'; },
    traversal: release => { release.assets[0].path = 'admin-assets/../../private.json'; },
    wrongBackingPath: release => { release.assets[0].path = release.assets[1].path; },
    missingRecord: release => { release.files.shift(); },
    mismatchHash: release => { release.files[0].sha256 = 'a'.repeat(64); },
    arrayHash: release => { release.files[0].sha256 = [release.files[0].sha256]; },
    mismatchLength: release => { release.assets[0].bytes++; },
    wrongAssetMode: release => { release.assets[0].mode = '0755'; },
    unknownAssetField: release => { release.assets[0].config = 'PRIVATE-SYNTHETIC-MARKER'; },
    malformedJson: null,
  };
  for (const [name, mutate] of Object.entries(cases)) await t.test(name, async t => {
    const f = await fixture(t);
    if (mutate) { mutate(f.release); await f.writeRelease(); }
    else await writeFile(join(f.directory, 'release.json'), '{invalid PRIVATE-SYNTHETIC-MARKER', { mode: 0o644 });
    await rejects(f);
  });
});

test('closed production factory preserves exact process health while serving no admin or invitation bytes', async t => {
  const f = await fixture(t);
  let calls = 0;
  const server = await createProductionCloudServer({ codeDirectory: f.directory, env: {}, fetchFn: async () => { calls++; throw new Error('Unexpected synthetic network'); } });
  assert.equal(server.listening, false);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const port = server.address().port;
  const health = await send(port, '/healthz', { host: 'synthetic-fc-signature-gateway.invalid' });
  assert.equal(health.status, 200);
  assert.deepEqual(JSON.parse(health.text), { status: 'ok', scope: 'process-only', sourceCommit: SOURCE });
  for (const path of ['/admin/', '/admin/contacts/', '/admin/settings/', '/admin/person/', '/invitations/template-blank.png', '/api/admin/environment', '/api/admin/session', '/api/registrations']) {
    const result = await send(port, path);
    assert.equal(result.status, 503, path);
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.equal(result.text.includes('synthetic'), false);
    assert.equal(result.headers['set-cookie'], undefined);
  }
  assert.equal(calls, 0);
});

test('an acceptance setting always closes the business runtime and refuses to test an enabled configuration', async t => {
  const f = await fixture(t);
  let calls = 0;
  const users = [{ id: 'synthetic-owner', username: 'synthetic.owner', label: '合成账号', roles: ['editor'], passwordHash: await hashPassword('synthetic-acceptance-password') }];
  const env = { NODE_ENV: 'production', ARTDICO_CLOUD_CONTENT_ENABLED: 'true', ARTDICO_CLOUD_ACCEPTANCE_RUN_ID: 'r123-a1-' + 'c'.repeat(16) + '-' + SOURCE,
    ARTDICO_CONTENT_API_ORIGIN: 'https://api.artdico.host', ARTDICO_PUBLIC_SITE_ORIGIN: 'https://artdico.host',
    ARTDICO_CONTENT_BUCKET: 'artdicohost-data-hk', ARTDICO_CONTENT_REGION: 'cn-hongkong', ADMIN_USERS_JSON: JSON.stringify(users),
    ALIBABA_CLOUD_ACCESS_KEY_ID: 'SyntheticRoleId', ALIBABA_CLOUD_ACCESS_KEY_SECRET: 'SyntheticRoleSecret', ALIBABA_CLOUD_SECURITY_TOKEN: 'SyntheticRoleToken' };
  const server = await createProductionCloudServer({ codeDirectory: f.directory, env, fetchFn: async () => { calls++; throw new Error('PRIVATE_NETWORK'); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const port = server.address().port;
  const health = JSON.parse((await send(port, '/healthz')).text);
  assert.equal(health.scope, 'process-only'); assert.equal(health.acceptance.status, 'rejected');
  assert.equal(health.acceptance.requests, 0); assert.equal(calls, 0);
  for (const path of ['/admin/', '/api/admin/session', '/api/admin/content']) assert.equal((await send(port, path)).status, 503);
});
