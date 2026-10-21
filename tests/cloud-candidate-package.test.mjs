import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm, symlink, readdir } from 'node:fs/promises';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { CANDIDATE_SOURCES, CANDIDATE_NODE, CANDIDATE_KIND, CANDIDATE_ARCHIVE,
  candidateAssetPath, candidateReferences, candidateFileRecords, candidateZipEntries,
  candidateSha256, validateCandidateAssets, parseCandidateArguments,
  prepareCloudContentCandidate, verifyCloudContentCandidate } from '../scripts/cloud-content-package.mjs';
import { verifyFcPublication } from '../scripts/verify-fc-package.mjs';

const gitEnv = { PATH: process.env.PATH ?? '', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' };
function git(directory, args) {
  const result = spawnSync('git', ['--no-replace-objects', '-C', directory, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Candidate Fixture', '-c', 'user.email=candidate@example.invalid', ...args], { encoding: 'utf8', env: gitEnv });
  assert.equal(result.status, 0); return result.stdout.trim();
}

async function fixture(t) {
  const directory = await mkdtemp(resolve(tmpdir(), 'artdico-cloud-candidate-'));
  t.after(async () => {
    assert.equal(dirname(directory), resolve(tmpdir())); assert.ok(basename(directory).startsWith('artdico-cloud-candidate-'));
    await rm(directory, { recursive: true, force: true });
  });
  const repositoryDirectory = resolve(directory, 'repository'); await mkdir(repositoryDirectory);
  for (const [source, , mode] of CANDIDATE_SOURCES) {
    await mkdir(dirname(resolve(repositoryDirectory, source)), { recursive: true });
    await writeFile(resolve(repositoryDirectory, source), source.endsWith('.py') ? '# Synthetic Python\n' : mode === '0755' ? '#!/bin/sh\nexit 0\n' : 'export const synthetic = true;\n', { mode: parseInt(mode, 8) });
  }
  for (const file of ['astro.config.mjs', 'package.json', 'pnpm-lock.yaml', 'tsconfig.json']) await writeFile(resolve(repositoryDirectory, file), file.endsWith('.json') ? '{}\n' : '# Synthetic fixed build input\n');
  await mkdir(resolve(repositoryDirectory, 'public/invitations'), { recursive: true });
  await writeFile(resolve(repositoryDirectory, 'public/invitations/template-blank.png'), 'SYNTHETIC-PNG-BYTES');
  await writeFile(resolve(repositoryDirectory, 'public/invitations/ggj2026-poster-v2.webp'), 'SYNTHETIC-PNG-BYTES');
  await mkdir(resolve(repositoryDirectory, 'node_modules/astro/bin'), { recursive: true });
  await writeFile(resolve(repositoryDirectory, 'node_modules/astro/bin/astro.mjs'), '// synthetic installed Astro CLI\n');
  await writeFile(resolve(repositoryDirectory, '.env.local'), 'SYNTHETIC_SECRET=never-copy\n');
  await writeFile(resolve(repositoryDirectory, 'contacts.json'), 'SYNTHETIC-PRIVATE-CONTACTS\n');
  git(repositoryDirectory, ['init', '--quiet']);
  git(repositoryDirectory, ['add', '--', ...CANDIDATE_SOURCES.map(item => item[0]), 'public', 'astro.config.mjs', 'package.json', 'pnpm-lock.yaml', 'tsconfig.json']);
  git(repositoryDirectory, ['commit', '--quiet', '-m', 'Synthetic candidate source']);
  const sourceCommit = git(repositoryDirectory, ['rev-parse', 'HEAD']);
  const outputDirectory = resolve(directory, 'candidate');
  const execute = (command, args, options) => {
    if (args[0]?.endsWith('/node_modules/astro/bin/astro.mjs')) {
      const source = args[args.indexOf('--root') + 1], output = args[args.indexOf('--outDir') + 1];
      assert.equal(existsSync(resolve(source, '.env.local')), false);
      assert.equal(existsSync(resolve(source, 'contacts.json')), false);
      assert.equal(Object.hasOwn(options.env, 'ADMIN_USERS_JSON'), false);
      assert.equal(Object.hasOwn(options.env, 'ARTDICO_CLOUD_CONTENT_ENABLED'), false);
      assert.equal(Object.hasOwn(options.env, 'PUBLIC_CONTENT_API_ORIGIN'), false);
      for (const [path, body] of [
        ['admin/index.html', '<html><script type="module" src="/_astro/admin.hash.js"></script><link rel="stylesheet" href="/_astro/admin.hash.css"></html>'],
        ['admin/contacts/index.html', '<html><script type="module" src="/_astro/contacts.hash.js"></script></html>'],
        ['admin/registrations/index.html', '<html><script type="module" src="/_astro/contacts.hash.js"></script></html>'],
        ['admin/tasks/index.html', '<html><script type="module" src="/_astro/contacts.hash.js"></script></html>'],
        ['admin/settings/index.html', '<html><script type="module" src="/_astro/settings.hash.js"></script></html>'],
        ['admin/person/index.html', '<html><script type="module" src="/_astro/person.hash.js"></script></html>'],
        ['admin/volunteers/index.html', '<html><script type="module" src="/_astro/volunteers.hash.js"></script></html>'],
        ['invitations/template-blank.png', 'SYNTHETIC-PNG-BYTES'],
        ['invitations/ggj2026-poster-v2.webp', 'SYNTHETIC-WEBP-BYTES'],
        ['_astro/admin.hash.js', 'export const version = 1;'],
        ['_astro/admin.hash.css', '@font-face{src:url("./font.hash.woff2")}'],
        ['_astro/font.hash.woff2', 'SYNTHETIC-FONT-BYTES'],
        ['_astro/contacts.hash.js', 'export async function read(){return import("./xlsx.hash.js")}'],
        ['_astro/xlsx.hash.js', 'export const reader = true;'],
        ['_astro/settings.hash.js', 'export const settings = true;'],
        ['_astro/person.hash.js', 'import "./contacts.hash.js";export const person = true;'],
        ['_astro/volunteers.hash.js', 'import "./contacts.hash.js";export const volunteers = true;'],
        ['index.html', 'SYNTHETIC-PUBLIC-HOMEPAGE-NOT-PACKAGED'],
        ['_astro/unreferenced.hash.js', 'SYNTHETIC-UNREFERENCED-NOT-PACKAGED'],
      ]) { mkdirSync(dirname(resolve(output, path)), { recursive: true }); writeFileSync(resolve(output, path), body); }
      return { status: 0, stdout: Buffer.alloc(0) };
    }
    return spawnSync(command, args, options);
  };
  return { directory, repositoryDirectory, sourceCommit, outputDirectory, nodeBinary: process.execPath, expectedNodeSha256: CANDIDATE_NODE.sha256, execute };
}

test('candidate CLI requires exact distinct arguments and isolated candidate asset paths', () => {
  const args = ['--node-binary', '/node', '--node-sha256', 'a'.repeat(64), '--source-commit', 'b'.repeat(40), '--out', '/output'];
  assert.equal(parseCandidateArguments(args).sourceCommit, 'b'.repeat(40));
  for (const invalid of [[], args.slice(0, -2), [...args, '--out', '/other'], [...args, '--dist', '/untrusted']]) assert.throws(() => parseCandidateArguments(invalid));
  assert.equal(candidateAssetPath('/admin/contacts/'), 'admin-assets/admin/contacts/index.html');
  assert.equal(candidateAssetPath('/admin/settings/'), 'admin-assets/admin/settings/index.html');
  assert.equal(candidateAssetPath('/admin/person/'), 'admin-assets/admin/person/index.html');
  assert.equal(candidateAssetPath('/admin/volunteers/'), 'admin-assets/admin/volunteers/index.html');
  assert.equal(candidateAssetPath('/_astro/chunk.hash.js'), 'admin-assets/_astro/chunk.hash.js');
  for (const path of ['/admin/index.html', '/_astro/../secret.js', '/_astro/.secret.js', '/_astro/file.js.map', '/_astro/nested/file.js', '/invitations/group.png', '/_astro/x.js?token=1', '/_astro/x..js']) assert.throws(() => candidateAssetPath(path));
});

test('candidate asset closure follows dynamic chunks, CSS fonts and exact paths without accepting unsafe references', () => {
  assert.deepEqual(candidateReferences(Buffer.from('import("./xlsx.hash.js");import "./shared.hash.mjs";'), '/_astro/contacts.hash.js'), ['/_astro/shared.hash.mjs', '/_astro/xlsx.hash.js']);
  assert.deepEqual(candidateReferences(Buffer.from('@font-face{src:url("./font.woff2")}'), '/_astro/a.css'), ['/_astro/font.woff2']);
  for (const [body, path] of [
    ['import "../private.mjs";', '/_astro/a.js'],
    ['import "./x.js?secret=1";', '/_astro/a.js'],
    ['<script src="https://example.invalid/leak.js"></script>', '/admin/'],
    ['<link rel="stylesheet" href="/private.css">', '/admin/'],
  ]) assert.throws(() => candidateReferences(Buffer.from(body), path));
});

test('candidate builder rejects changed source, symlinks, wrong runtime pin and nonempty destination before build', async t => {
  const options = await fixture(t);
  const source = resolve(options.repositoryDirectory, CANDIDATE_SOURCES[2][0]);
  await writeFile(source, 'export const altered = true;\n');
  await assert.rejects(prepareCloudContentCandidate(options), /differs from the exact commit/);
  await writeFile(source, 'export const synthetic = true;\n');
  const external = resolve(options.directory, 'external.mjs'); await writeFile(external, 'export const synthetic = true;\n');
  await rm(source); await symlink(external, source);
  await assert.rejects(prepareCloudContentCandidate({ ...options, outputDirectory: resolve(options.directory, 'linked-source-output') }), /Symbolic links/);
  await assert.rejects(prepareCloudContentCandidate({ ...options, expectedNodeSha256: '0'.repeat(64) }), /pinned official/);
  await writeFile(resolve(options.outputDirectory, 'keep'), 'preserve');
  await assert.rejects(prepareCloudContentCandidate(options), /must be empty/);
  assert.equal(await readFile(resolve(options.outputDirectory, 'keep'), 'utf8'), 'preserve');
});

test('candidate ZIP inspection rejects unknown data, path traversal, duplicate entries, mode changes and hash tampering', () => {
  assert.throws(() => candidateZipEntries(Buffer.alloc(0), []));
  const record = { path: 'release.json', bytes: 1, sha256: candidateSha256(Buffer.from('x')), mode: '0644' };
  const body = Buffer.from('x'), name = Buffer.from(record.path);
  function zip(mode = 0o100644, zipName = name) {
    const local = Buffer.alloc(30 + zipName.length); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(10, 4); local.writeUInt32LE(1, 18); local.writeUInt32LE(1, 22); local.writeUInt16LE(zipName.length, 26); zipName.copy(local, 30);
    const central = Buffer.alloc(46 + zipName.length); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x031e, 4); central.writeUInt16LE(10, 6); central.writeUInt32LE(1, 20); central.writeUInt32LE(1, 24); central.writeUInt16LE(zipName.length, 28); central.writeUInt32LE(mode * 65536, 38); zipName.copy(central, 46);
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(local.length + body.length, 16);
    return Buffer.concat([local, body, central, end]);
  }
  const valid = zip(); assert.equal(candidateZipEntries(valid, [record]).get('release.json').toString(), 'x');
  assert.throws(() => candidateZipEntries(zip(0o120644), [record]));
  assert.throws(() => candidateZipEntries(zip(0o100644, Buffer.from('../secret')), [record]));
  assert.throws(() => candidateZipEntries(valid, [record, record]));
  const deflated = Buffer.from(valid);
  deflated.writeUInt16LE(8, 8); deflated.writeUInt16LE(8, 30 + name.length + body.length + 10);
  assert.throws(() => candidateZipEntries(deflated, [record]), /metadata/);
  const altered = Buffer.from(valid); altered[30 + name.length] = 121;
  assert.throws(() => candidateZipEntries(altered, [record]), /hash mismatch/);
  assert.throws(() => candidateZipEntries(Buffer.concat([valid, Buffer.from('unlisted')]), [record]));
});

test('the real candidate archive binds source, isolates its build and remains rejected by the preflight deploy verifier', { timeout: 180_000 }, async t => {
  assert.equal(process.version, CANDIDATE_NODE.version);
  const options = await fixture(t);
  const manifest = await prepareCloudContentCandidate(options);
  assert.equal(manifest.kind, CANDIDATE_KIND);
  assert.equal(manifest.archive.path, CANDIDATE_ARCHIVE);
  candidateFileRecords(manifest.files);
  const publication = resolve(options.outputDirectory, 'publication');
  assert.deepEqual((await readdir(publication)).sort(), [CANDIDATE_ARCHIVE, 'package-manifest.json'].sort());
  const result = await verifyCloudContentCandidate({ directory: publication, expectedCommit: options.sourceCommit, repositoryDirectory: options.repositoryDirectory });
  assert.equal(result.manifest.sourceCommit, options.sourceCommit);
  assert.ok(result.release.assets.some(item => item.url === '/_astro/xlsx.hash.js'));
  assert.ok(result.release.assets.some(item => item.url === '/_astro/font.hash.woff2'));
  for (const url of ['/admin/settings/', '/admin/person/', '/admin/volunteers/', '/_astro/settings.hash.js', '/_astro/person.hash.js', '/_astro/volunteers.hash.js']) {
    assert.ok(result.release.assets.some(item => item.url === url), url);
  }
  for (const source of ['functions/person-workspace/handler.mjs', 'functions/person-workspace/projection.mjs', 'shared/volunteer-schema.mjs',
    ...['repository', 'planning', 'service', 'handler', 'xlsx'].map(name => 'functions/volunteers/' + name + '.mjs')]) {
    assert.ok(result.manifest.files.some(item => item.path === source), source);
  }
  assert.equal(result.manifest.files.some(item => /contacts\.json|\.env|unreferenced|^index\.html$/u.test(item.path)), false);
  const contents = candidateZipEntries(result.zipBytes, result.manifest.files);
  validateCandidateAssets(result.release, contents);
  await assert.rejects(verifyFcPublication({ directory: publication, expectedCommit: options.sourceCommit, repositoryDirectory: options.repositoryDirectory }));
  const original = await readFile(resolve(publication, 'package-manifest.json'));
  const altered = structuredClone(manifest); altered.kind = 'fc-preflight';
  await writeFile(resolve(publication, 'package-manifest.json'), JSON.stringify(altered));
  await assert.rejects(verifyCloudContentCandidate({ directory: publication, expectedCommit: options.sourceCommit, repositoryDirectory: options.repositoryDirectory }), /identity/);
  await writeFile(resolve(publication, 'package-manifest.json'), original);
  const missing = structuredClone(result.release); missing.assets = missing.assets.filter(item => !item.url.endsWith('xlsx.hash.js'));
  assert.throws(() => validateCandidateAssets(missing, contents), /Incomplete|missing/);
  for (const url of ['/admin/settings/', '/admin/person/', '/admin/volunteers/']) {
    const missingPage = structuredClone(result.release); missingPage.assets = missingPage.assets.filter(item => item.url !== url);
    assert.throws(() => validateCandidateAssets(missingPage, contents), /Incomplete/);
  }
  const extra = structuredClone(result.release); extra.assets.push({ url: '/_astro/extra.js', path: 'admin-assets/_astro/extra.js', bytes: 1, sha256: candidateSha256(Buffer.from('x')), mode: '0644' }); extra.files.push({ ...extra.assets.at(-1) }); delete extra.files.at(-1).url;
  const withExtra = new Map(contents); withExtra.set('admin-assets/_astro/extra.js', Buffer.from('x'));
  assert.throws(() => validateCandidateAssets(extra, withExtra), /unreferenced/);
  const changedSource = resolve(options.repositoryDirectory, CANDIDATE_SOURCES[1][0]);
  await writeFile(changedSource, '# another synthetic commit\n'); git(options.repositoryDirectory, ['add', '--', CANDIDATE_SOURCES[1][0]]); git(options.repositoryDirectory, ['commit', '--quiet', '-m', 'Different expected source']);
  const next = git(options.repositoryDirectory, ['rev-parse', 'HEAD']);
  await assert.rejects(verifyCloudContentCandidate({ directory: publication, expectedCommit: next, repositoryDirectory: options.repositoryDirectory }), /identity/);
});
