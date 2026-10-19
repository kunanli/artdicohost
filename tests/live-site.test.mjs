import test from 'node:test';
import assert from 'node:assert/strict';
import { checkLiveSite, validateRelease } from '../scripts/check-live-site.mjs';
import { sha256 } from '../scripts/prepare-oss-site.mjs';
import { contentType } from '../scripts/deploy-oss.mjs';

const commit = 'a'.repeat(40);
const origin = 'https://preview.example.invalid';

function fixture(change = () => {}) {
  const objects = new Map(['index.html', 'invitation/index.html', 'admin/index.html', 'admin/contacts/index.html', '404.html', 'invitations/template-blank.png', '_astro/public.js'].map(path => [path, Buffer.from('synthetic public ' + path)]));
  const release = { schemaVersion: 1, commit, files: [...objects].map(([path, data]) => ({ path, bytes: data.length, sha256: sha256(data) })) };
  objects.set('release.json', Buffer.from(JSON.stringify(release)));
  const fetchPublic = async (url, options) => {
    assert.equal(url.origin, origin);
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    let path = url.pathname.slice(1);
    if (!path || path.endsWith('/')) path += 'index.html';
    const status = objects.has(path) ? 200 : 404;
    const file = status === 200 ? path : '404.html';
    const reply = { body: objects.get(file), status, headers: { 'content-type': contentType(file) } };
    change(url.pathname, reply, objects);
    return new Response(reply.body, { status: reply.status, headers: reply.headers });
  };
  return { release, fetchPublic };
}

test('live verification checks exact public bytes, HTTPS origin, directory pages and a genuine 404', async () => {
  const result = await checkLiveSite({ origin, commit, ...fixture() });
  assert.equal(result.publicObjects, 7);
  assert.equal(result.checkedResponses, 14);
});

test('unsafe origins and missing exact commits fail before any network request', async () => {
  const fetchPublic = () => assert.fail('No network request allowed');
  for (const value of ['http://preview.example.invalid', origin + '/path', 'https://user:password@preview.example.invalid', origin + '?x=1', origin + '#x']) await assert.rejects(checkLiveSite({ origin: value, commit, fetchPublic }), /HTTPS origin/);
  await assert.rejects(checkLiveSite({ origin, commit: 'main', fetchPublic }), /exact/);
});

test('receipt rejects unexpected private paths, duplicates and wrong versions', () => {
  const { release } = fixture();
  assert.throws(() => validateRelease(release, 'b'.repeat(40)), /expected source/);
  for (const path of ['contacts.json', '_astro/private.json', '../index.html', 'release.json']) assert.throws(() => validateRelease({ ...release, files: [...release.files, { path, bytes: 1, sha256: 'a'.repeat(64) }] }, commit));
  assert.throws(() => validateRelease({ ...release, files: [...release.files, release.files[0]] }, commit), /Invalid public/);
});

test('download headers, wrong MIME, missing subdirectory indexes and SPA fallback cannot pass', async () => {
  for (const change of [
    (path, reply) => { if (path === '/') reply.headers['content-disposition'] = 'attachment'; },
    (path, reply) => { if (path.endsWith('.js')) reply.headers['content-type'] = 'text/html'; },
    (path, reply) => { if (path === '/invitation/') reply.status = 404; },
    (path, reply) => { if (path.startsWith('/__artdico_missing_')) reply.status = 200; },
    (path, reply) => { if (path === '/index.html') reply.body = Buffer.from('stale homepage'); },
    (path, reply) => { if (path === '/index.html') reply.body = Buffer.alloc(100_000); }
  ]) await assert.rejects(checkLiveSite({ origin, commit, ...fixture(change) }));
});

test('TLS/network failure and a receipt changing during verification fail explicitly', async () => {
  await assert.rejects(checkLiveSite({ origin, commit, fetchPublic: async () => { throw new Error('certificate invalid'); } }), /HTTPS request failed/);
  let receipts = 0;
  await assert.rejects(checkLiveSite({ origin, commit, ...fixture((path, reply) => {
    if (path === '/release.json' && ++receipts === 2) reply.body = Buffer.from('{}');
  }) }), /Release changed/);
});
