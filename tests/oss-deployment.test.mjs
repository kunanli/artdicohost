import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, basename } from 'node:path';
import { prepareOssSite, referencedAssets, validatePublicPath, sha256 } from '../scripts/prepare-oss-site.mjs';
import { requireDeploymentContext, verifyPublication, deploy, putObjectArgs, uploadOrder, contentType, assertCurrentMainHead } from '../scripts/deploy-oss.mjs';

const commit = 'a'.repeat(40);
const context = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'kunanli/artdicohost', GITHUB_SHA: commit, OSS_ACCESS_KEY_ID: 'test-id', OSS_ACCESS_KEY_SECRET: 'test-secret' };
const fetchHead = async () => ({ ok: true, json: async () => ({ object: { sha: commit } }) });

async function fixture(t) {
  const directory = await mkdtemp(resolve(tmpdir(), 'artdico-oss-test-'));
  t.after(async () => {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('artdico-oss-test-')) throw new Error('Unsafe test cleanup path');
    await rm(directory, { recursive: true, force: true });
  });
  const dist = resolve(directory, 'dist');
  const output = resolve(directory, 'publication');
  for (const part of ['_astro', 'invitation', 'invitations', 'registration/confirmation', 'admin/contacts', 'admin/settings', 'admin/person', 'admin/volunteers']) await mkdir(resolve(dist, part), { recursive: true });
  await writeFile(resolve(dist, 'index.html'), '<script type="module" src="/_astro/public.hash.js"></script><a href="/admin/">后台</a>');
  await writeFile(resolve(dist, '_astro/public.hash.js'), 'import "./shared.hash.js";');
  await writeFile(resolve(dist, '_astro/shared.hash.js'), 'console.log("public-only");');
  await writeFile(resolve(dist, '_astro/private.hash.js'), 'private-admin-code');
  await writeFile(resolve(dist, 'admin/contacts/index.html'), 'private-admin-form');
  await writeFile(resolve(dist, 'admin/settings/index.html'), 'private-settings-form');
  await writeFile(resolve(dist, 'admin/person/index.html'), 'private-person-workspace');
  await writeFile(resolve(dist, 'admin/volunteers/index.html'), 'private-volunteer-workspace');
  await writeFile(resolve(dist, 'invitation/index.html'), '<h1>图片邀请函</h1>');
  await writeFile(resolve(dist, 'registration/confirmation/index.html'), '<h1>报名确认</h1><script type="module" src="/_astro/receipt.hash.js"></script>');
  await writeFile(resolve(dist, '_astro/receipt.hash.js'), '/* Synthetic empty receipt controller; no participant data. */');
  await writeFile(resolve(dist, 'invitations/template-blank.png'), 'synthetic-test-image');
  await writeFile(resolve(dist, 'invitations/ggj2026-poster-v2.webp'), 'synthetic-test-image');
  await writeFile(resolve(dist, 'contacts.json'), 'synthetic-private-contact');
  return { directory, dist, output };
}

test('publication selects reachable public assets and replaces local admin with notices', async t => {
  const { dist, output } = await fixture(t);
  const manifest = await prepareOssSite({ distDirectory: dist, outputDirectory: output, commit });
  assert.equal(manifest.files.length, 17);
  const receipt = JSON.parse(await readFile(resolve(output, 'release.json'), 'utf8'));
  assert.equal(receipt.commit, commit);
  assert.deepEqual(receipt.files, manifest.files.filter(item => item.path !== 'release.json'));
  assert.deepEqual(Object.keys(receipt), ['schemaVersion', 'commit', 'files']);
  assert.equal(manifest.files.some(item => /private|contacts\.json/.test(item.path)), false);
  assert.ok(manifest.files.some(item => item.path === 'registration/confirmation/index.html'));
  assert.ok(manifest.files.some(item => item.path === '_astro/receipt.hash.js'));
  assert.match(await readFile(resolve(output, 'admin/contacts/index.html'), 'utf8'), /https:\/\/api\.artdico\.host\/admin\//);
  assert.match(await readFile(resolve(output, 'admin/registrations/index.html'), 'utf8'), /工作人员后台入口/);
  assert.match(await readFile(resolve(output, 'admin/tasks/index.html'), 'utf8'), /工作人员后台入口/);
  for (const path of ['admin/settings/index.html', 'admin/person/index.html', 'admin/volunteers/index.html']) {
    const page = await readFile(resolve(output, path), 'utf8');
    assert.match(page, /工作人员后台入口/u);
    assert.match(page, /https:\/\/api\.artdico\.host\/admin\//u);
    assert.doesNotMatch(page, /private-settings-form|private-person-workspace|private-volunteer-workspace/u);
  }
  assert.doesNotMatch(await readFile(resolve(output, 'admin/contacts/index.html'), 'utf8'), /<form|private-admin-form/);
  assert.equal((await verifyPublication(output, commit)).commit, commit);
  await assert.rejects(prepareOssSite({ distDirectory: dist, outputDirectory: output, commit }), /must be empty/);
});

test('publication rejects added files, corrupt content and a mismatched commit before uploading', async t => {
  const { dist, output } = await fixture(t);
  await prepareOssSite({ distDirectory: dist, outputDirectory: output, commit });
  await assert.rejects(verifyPublication(output, 'b'.repeat(40)), /identity/);
  await writeFile(resolve(output, '.env'), 'synthetic');
  await assert.rejects(verifyPublication(output, commit), /file list/);
  await rm(resolve(output, '.env'));
  await writeFile(resolve(output, 'index.html'), 'changed');
  await assert.rejects(verifyPublication(output, commit), /checksum/);
});

test('path validation rejects private names, traversal, encoded extensions and unexpected routes', () => {
  for (const path of ['../index.html', '/index.html', '_astro/../index.html', '.env', 'contacts.json', 'data.xlsx', 'backup.html', 'private/index.html', '_astro/x.map', '_astro/x%2ejs']) assert.throws(() => validatePublicPath(path));
  assert.equal(validatePublicPath('admin/contacts/index.html'), 'admin/contacts/index.html');
  assert.equal(validatePublicPath('admin/settings/index.html'), 'admin/settings/index.html');
  assert.equal(validatePublicPath('admin/person/index.html'), 'admin/person/index.html');
  assert.equal(validatePublicPath('admin/volunteers/index.html'), 'admin/volunteers/index.html');
  assert.deepEqual(referencedAssets('import "./shared.hash.js";url("/_astro/style.hash.css")', '_astro/public.hash.js'), ['_astro/shared.hash.js', '_astro/style.hash.css']);
});

test('only an authenticated main push in the exact repository may deploy', () => {
  requireDeploymentContext(context);
  for (const patch of [{ GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_EVENT_NAME: 'workflow_dispatch' }, { GITHUB_REF: 'refs/heads/feature' }, { GITHUB_REPOSITORY: 'other/artdicohost' }, { GITHUB_ACTIONS: '' }, { GITHUB_SHA: 'main' }, { OSS_ACCESS_KEY_SECRET: '' }]) assert.throws(() => requireDeploymentContext({ ...context, ...patch }));
});

test('direct PutObject arguments pin destination, content type, cache and avoid deletes/ACL/config secrets', () => {
  const args = putObjectArgs('/publication', { path: '_astro/app.hash.js' });
  assert.deepEqual(args.slice(0, 5), ['api', 'put-object', '--bucket', 'artdicohost-web-hk', '--key']);
  assert.ok(args.includes('text/javascript; charset=utf-8'));
  assert.ok(args.includes('public,no-cache'));
  assert.equal(args.some(item => /--acl|delete|sync|test-secret|access-key/.test(item)), false);
  assert.equal(contentType('font.woff2'), 'font/woff2');
  assert.equal(contentType('release.json'), 'application/json; charset=utf-8');
  assert.deepEqual(uploadOrder([{ path: 'release.json' }, { path: 'index.html' }, { path: '404.html' }, { path: '_astro/a.js' }]).map(item => item.path), ['_astro/a.js', '404.html', 'index.html', 'release.json']);
});

test('upload verifies every object, writes the receipt after the homepage and stops after an asset failure', async t => {
  const { dist, output } = await fixture(t);
  const manifest = await prepareOssSite({ distDirectory: dist, outputDirectory: output, commit });
  const calls = [];
  const execute = (binary, args) => { calls.push(args[args.indexOf('--key') + 1]); return { status: 0 }; };
  const fetchObject = async url => ({ ok: true, arrayBuffer: () => readFile(resolve(output, new URL(url).pathname.slice(1))) });
  const result = await deploy({ directory: output, binary: 'fixture-ossutil', env: context, execute, fetchObject, fetchHead });
  assert.equal(result.files, manifest.files.length);
  assert.equal(calls.at(-2), 'index.html');
  assert.equal(calls.at(-1), 'release.json');
  let attempts = 0;
  await assert.rejects(deploy({ directory: output, binary: 'fixture-ossutil', env: context, execute: () => { attempts++; return { status: 1, stderr: 'secret must never be echoed' }; }, fetchObject, fetchHead }), /OSS upload failed/);
  assert.equal(attempts, 1);
});

test('a receipt cannot claim a different release even if its own manifest checksum is updated', async t => {
  const { dist, output } = await fixture(t);
  const manifest = await prepareOssSite({ distDirectory: dist, outputDirectory: output, commit });
  const receipt = JSON.parse(await readFile(resolve(output, 'release.json'), 'utf8'));
  receipt.commit = 'b'.repeat(40);
  const data = Buffer.from(JSON.stringify(receipt));
  await writeFile(resolve(output, 'release.json'), data);
  Object.assign(manifest.files.find(file => file.path === 'release.json'), { bytes: data.length, sha256: sha256(data) });
  await writeFile(resolve(output, 'publication-manifest.json'), JSON.stringify(manifest));
  await assert.rejects(verifyPublication(output, commit), /receipt differs/);
});

test('public readback mismatch aborts deployment before switching the homepage', async t => {
  const { dist, output } = await fixture(t);
  await prepareOssSite({ distDirectory: dist, outputDirectory: output, commit });
  const keys = [];
  await assert.rejects(deploy({ directory: output, binary: 'fixture-ossutil', env: context, execute: (binary, args) => { keys.push(args[args.indexOf('--key') + 1]); return { status: 0 }; }, fetchObject: async () => ({ ok: true, arrayBuffer: async () => Buffer.from('wrong') }), fetchHead }), /readback verification/);
  assert.equal(keys.includes('index.html'), false);
});

test('linked template directories cannot pull external files into the public site', async t => {
  const { directory, dist, output } = await fixture(t);
  const linkDirectory = resolve(dist, 'invitations');
  assert.equal(dirname(linkDirectory), resolve(directory, 'dist'));
  await rm(linkDirectory, { recursive: true });
  await mkdir(resolve(directory, 'external'));
  await writeFile(resolve(directory, 'external/template-blank.png'), 'external');
  try {
    await symlink(resolve(directory, 'external'), resolve(dist, 'invitations'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') {
      t.skip('This Windows sandbox disallows junction creation; Linux CI exercises this boundary.');
      return;
    }
    throw error;
  }
  await assert.rejects(prepareOssSite({ distDirectory: dist, outputDirectory: output, commit }), /Symbolic links/);
});

test('stale or unverifiable main commits cannot be redeployed', async () => {
  await assertCurrentMainHead(context, fetchHead);
  await assert.rejects(assertCurrentMainHead(context, async () => ({ ok: true, json: async () => ({ object: { sha: 'b'.repeat(40) } }) })), /older/);
  await assert.rejects(assertCurrentMainHead(context, async () => { throw new Error('network'); }), /Cannot verify/);
});
