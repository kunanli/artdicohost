import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateRawSync } from 'node:zlib';
import { prepareFcBootstrap } from '../scripts/prepare-fc-bootstrap.mjs';
import { verifyFcPublication } from '../scripts/verify-fc-package.mjs';
import { MAX_FC_ZIP_BYTES } from '../scripts/fc-upload-limits.mjs';

const OFFICIAL_SHA = 'bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12';
const NODE = { version: 'v24.19.0', platform: 'linux', arch: 'x64', sha256: OFFICIAL_SHA };
const PATHS = ['bootstrap', 'functions/fc-api/handler.mjs', 'functions/fc-api/server.mjs', 'functions/fc-api/launch.py', 'runtime/node/bin/node.xz', 'release.json'];
const SOURCES = ['functions/fc-api/bootstrap', ...PATHS.slice(1, 4)];
const ARCHIVE = 'artdicohost-fc-preflight.zip';
const MANIFEST = 'package-manifest.json';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const gitEnv = { PATH: process.env.PATH ?? '', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' };

function git(directory, args) {
  const result = spawnSync('git', ['--no-replace-objects', '-C', directory, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Publication Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { encoding: 'utf8', env: gitEnv });
  assert.equal(result.status, 0, 'synthetic git operation succeeds');
  return result.stdout.trim();
}

function elf() {
  const bytes = Buffer.alloc(64);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]).copy(bytes);
  bytes.writeUInt16LE(2, 16);
  bytes.writeUInt16LE(62, 18);
  bytes.writeUInt32LE(1, 20);
  return bytes;
}

function compress(bytes) {
  const result = spawnSync('python3', ['-I', '-S', '-c', 'import lzma,sys; sys.stdout.buffer.write(lzma.compress(sys.stdin.buffer.read(),format=lzma.FORMAT_XZ,check=lzma.CHECK_CRC64,preset=6))'], { input: bytes, env: gitEnv, timeout: 30_000, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, 'synthetic XZ compression succeeds');
  return result.stdout;
}

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'artdico-fc-publication-test-'));
  t.after(async () => {
    if (dirname(root) !== resolve(tmpdir()) || !basename(root).startsWith('artdico-fc-publication-test-')) throw new Error('Unsafe publication fixture cleanup');
    await rm(root, { recursive: true, force: true });
  });
  const repositoryDirectory = resolve(root, 'repository');
  await mkdir(resolve(repositoryDirectory, 'functions/fc-api'), { recursive: true });
  const sourceBytes = [Buffer.from('#!/bin/sh\nexec python3 -I -S /code/functions/fc-api/launch.py\n'), Buffer.from('export const handler = () => "synthetic";\n'), Buffer.from('export const server = "synthetic";\n'), Buffer.from('# Synthetic launcher fixture\n')];
  for (const [index, source] of SOURCES.entries()) await writeFile(resolve(repositoryDirectory, source), sourceBytes[index]);
  git(repositoryDirectory, ['init', '--quiet']);
  git(repositoryDirectory, ['add', '--', ...SOURCES]);
  git(repositoryDirectory, ['commit', '--quiet', '-m', 'Synthetic publication fixture']);
  const expectedCommit = git(repositoryDirectory, ['rev-parse', 'HEAD']);
  const directory = resolve(root, 'artifact');
  const code = resolve(root, 'synthetic-package-input');
  await mkdir(directory);
  for (const path of PATHS) await mkdir(dirname(resolve(code, path)), { recursive: true });
  const files = sourceBytes.map((bytes, index) => ({ path: PATHS[index], bytes: bytes.length, sha256: hash(bytes), mode: index ? '0644' : '0755' }));
  for (const [index, bytes] of sourceBytes.entries()) {
    await writeFile(resolve(code, PATHS[index]), bytes);
    await chmod(resolve(code, PATHS[index]), index ? 0o644 : 0o755);
  }
  const runtime = compress(elf());
  await writeFile(resolve(code, PATHS[4]), runtime, { mode: 0o644 });
  await chmod(resolve(code, PATHS[4]), 0o644);
  // A forged runtime claim allows tiny fixtures to reach earlier source checks.
  // Production must still reject the actual bytes; no verification override exists.
  files.push({ path: PATHS[4], bytes: runtime.length, sha256: hash(runtime), mode: '0644' });
  const release = { schemaVersion: 1, kind: 'fc-preflight', sourceCommit: expectedCommit, node: { ...NODE }, files: structuredClone(files) };
  const manifest = { schemaVersion: 1, kind: 'fc-preflight', sourceCommit: expectedCommit, node: { ...NODE }, files, archive: {}, verification: 'Synthetic fixture; must fail official runtime byte verification.' };
  const fixture = { root, repositoryDirectory, directory, code, expectedCommit, manifest, release };
  await rebuild(fixture);
  return fixture;
}

async function saveManifest(fixture) {
  await writeFile(resolve(fixture.directory, MANIFEST), JSON.stringify(fixture.manifest));
}

async function rebuild(fixture, paths = PATHS) {
  const releaseBytes = Buffer.from(JSON.stringify(fixture.release));
  await writeFile(resolve(fixture.code, 'release.json'), releaseBytes, { mode: 0o644 });
  await chmod(resolve(fixture.code, 'release.json'), 0o644);
  fixture.manifest.files = [...fixture.manifest.files.slice(0, 5), { path: 'release.json', bytes: releaseBytes.length, sha256: hash(releaseBytes), mode: '0644' }];
  const archive = resolve(fixture.directory, ARCHIVE);
  await rm(archive, { force: true });
  const result = spawnSync('/usr/bin/zip', ['-X', '-q', '-0', archive, ...paths], { cwd: fixture.code, env: gitEnv, encoding: 'utf8' });
  assert.equal(result.status, 0, 'synthetic ZIP creation succeeds');
  const zipBytes = await readFile(archive);
  fixture.manifest.archive = { path: ARCHIVE, bytes: zipBytes.length, sha256: hash(zipBytes) };
  await saveManifest(fixture);
}

async function writeArchive(fixture, bytes) {
  await writeFile(resolve(fixture.directory, ARCHIVE), bytes);
  fixture.manifest.archive.bytes = bytes.length;
  fixture.manifest.archive.sha256 = hash(bytes);
  await saveManifest(fixture);
}

// Reassemble real stored ZIP records so duplicate-name coverage is a valid ZIP,
// rather than relying on a truncated name or a corrupted central-directory size.
function rewriteZipEntries(bytes, mutate) {
  const end = bytes.length - 22;
  let offset = bytes.readUInt32LE(end + 16);
  const entries = [];
  for (let index = 0; index < PATHS.length; index++) {
    const length = 46 + bytes.readUInt16LE(offset + 28) + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    const localLength = 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28) + bytes.readUInt32LE(offset + 20);
    entries.push({ central: Buffer.from(bytes.subarray(offset, offset + length)), local: bytes.subarray(local, local + localLength) });
    offset += length;
  }
  mutate(entries);
  let localOffset = 0;
  for (const entry of entries) { entry.central.writeUInt32LE(localOffset, 42); localOffset += entry.local.length; }
  const central = Buffer.concat(entries.map(entry => entry.central));
  const endRecord = Buffer.from(bytes.subarray(end));
  endRecord.writeUInt32LE(central.length, 12);
  endRecord.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...entries.map(entry => entry.local), central, endRecord]);
}

test('the real producer artifact verifies from only two files and binds every source to its exact commit', { skip: process.platform !== 'linux' || process.arch !== 'x64' ? 'Official runtime check requires Linux x64 CI.' : false }, async t => {
  assert.equal(process.version, NODE.version, 'CI runs the pinned patch version');
  const runtime = await readFile(process.execPath);
  assert.equal(hash(runtime), OFFICIAL_SHA, 'CI uses the pinned official Node binary');
  const fixtureData = await fixture(t);
  const outputDirectory = resolve(fixtureData.root, 'producer-output');
  const produced = await prepareFcBootstrap({ repositoryDirectory: fixtureData.repositoryDirectory, sourceCommit: fixtureData.expectedCommit, nodeBinary: process.execPath, expectedNodeSha256: OFFICIAL_SHA, outputDirectory });
  await assert.rejects(verifyFcPublication({ ...fixtureData, directory: outputDirectory }), /only the manifest and ZIP/);
  for (const path of [MANIFEST, ARCHIVE]) await copyFile(resolve(outputDirectory, path), resolve(fixtureData.directory, path));
  const calls = [];
  const checked = await verifyFcPublication({ ...fixtureData, execute(command, args, options) {
    calls.push([command, args]);
    if (calls.length === 1) writeFileSync(resolve(fixtureData.directory, ARCHIVE), 'SYNTHETIC-PATHNAME-REPLACEMENT');
    assert.ok(options.timeout > 0 && options.timeout <= 30_000);
    assert.ok(options.maxBuffer < 200 * 1024 * 1024);
    assert.ok(['git', 'python3'].includes(command), 'verification only reads git objects or executes a fixed isolated XZ inspector');
    if (command === 'python3') {
      assert.deepEqual(args.slice(0, 3), ['-I', '-S', '-c']);
      assert.ok(Buffer.isBuffer(options.input), 'the inspector receives only the immutable compressed bytes');
      assert.equal(options.maxBuffer, 4096);
    }
    return spawnSync(command, args, options);
  } });
  assert.deepEqual(checked.manifest, produced);
  assert.equal(hash(checked.zipBytes), produced.archive.sha256);
  assert.equal(await readFile(resolve(fixtureData.directory, ARCHIVE), 'utf8'), 'SYNTHETIC-PATHNAME-REPLACEMENT', 'returned bytes stay bound to the verified snapshot after an archive pathname change');
  assert.equal(calls.length, 6, 'one object-type check, four immutable source reads and one bounded XZ inspection');
  assert.equal(calls.filter(([command, args]) => command === 'git' && args.includes('show') && args.includes('--no-textconv') && args.includes('--no-ext-diff') && args.includes('--no-replace-objects')).length, 4);
});

test('untrusted manifests cannot choose a runtime, path, file set, commit or oversized archive', async t => {
  const item = await fixture(t);
  const pristine = structuredClone(item.manifest);
  const cases = [
    value => { value.kind = 'fc-production'; },
    value => { value.sourceCommit = '0'.repeat(40); },
    value => { value.node.version = 'v24.20.0'; },
    value => { value.node.sha256 = '0'.repeat(64); },
    value => { value.node.extra = true; },
    value => { value.files.push(value.files[0]); },
    value => { value.files[0].path = '../bootstrap'; },
    value => { value.files[0].mode = '0644'; },
    value => { value.files[4].sha256 = 'not-a-sha256'; },
    value => { value.files[4].mode = '0755'; },
    value => { value.archive.path = '../runtime.zip'; },
    value => { value.archive.bytes = MAX_FC_ZIP_BYTES + 1; },
    value => { value.archive.bytes = 1.5; },
    value => { value.privateData = 'synthetic-only'; },
  ];
  for (const mutate of cases) {
    item.manifest = structuredClone(pristine);
    mutate(item.manifest);
    await saveManifest(item);
    await assert.rejects(verifyFcPublication({ ...item, execute() { assert.fail('Invalid manifest must fail before child execution'); } }));
  }
  await assert.rejects(verifyFcPublication({ ...item, expectedCommit: 'main' }), /exact 40-character/);
});

test('publication paths reject extra files, symbolic links and real archive size overflow', async t => {
  const item = await fixture(t);
  const extra = resolve(item.directory, 'unreviewed.txt');
  await writeFile(extra, 'synthetic unreviewed data');
  await assert.rejects(verifyFcPublication(item), /only the manifest and ZIP/);
  await rm(extra);
  const linkedDirectory = resolve(item.root, 'artifact-link');
  await symlink(item.directory, linkedDirectory, 'dir');
  await assert.rejects(verifyFcPublication({ ...item, directory: linkedDirectory }), /Symbolic links/);
  const manifestPath = resolve(item.directory, MANIFEST);
  const elsewhere = resolve(item.root, 'manifest-copy.json');
  await copyFile(manifestPath, elsewhere);
  await rm(manifestPath);
  await symlink(elsewhere, manifestPath);
  await assert.rejects(verifyFcPublication(item), /Symbolic links/);
  await rm(manifestPath);
  await copyFile(elsewhere, manifestPath);
  await truncate(resolve(item.directory, ARCHIVE), MAX_FC_ZIP_BYTES + 1);
  await assert.rejects(verifyFcPublication(item), /size limit/);
});

test('self-consistent source forgery is rejected against the committed blobs even with replacement refs', async t => {
  const item = await fixture(t);
  const forged = Buffer.from('export const handler = () => "forged!!!";\n');
  await writeFile(resolve(item.code, PATHS[1]), forged);
  await writeFile(resolve(item.repositoryDirectory, SOURCES[1]), forged);
  git(item.repositoryDirectory, ['add', '--', SOURCES[1]]);
  git(item.repositoryDirectory, ['commit', '--quiet', '-m', 'Synthetic forged source']);
  const replacement = git(item.repositoryDirectory, ['rev-parse', 'HEAD']);
  git(item.repositoryDirectory, ['replace', item.expectedCommit, replacement]);
  item.manifest.files[1].bytes = forged.length;
  item.manifest.files[1].sha256 = hash(forged);
  item.release.files[1] = { ...item.manifest.files[1] };
  await rebuild(item);
  await assert.rejects(verifyFcPublication(item), /source differs from the expected commit/);
});

test('a tree object cannot impersonate the expected source commit', async t => {
  const item = await fixture(t);
  const tree = git(item.repositoryDirectory, ['rev-parse', item.expectedCommit + '^{tree}']);
  git(item.repositoryDirectory, ['replace', '--force', tree, item.expectedCommit]);
  item.expectedCommit = tree;
  item.manifest.sourceCommit = tree;
  item.release.sourceCommit = tree;
  await rebuild(item);
  await assert.rejects(verifyFcPublication(item), /must identify a commit object/);
});

test('ZIP names, order, duplicate entries, executable modes and unlisted data are checked independently of its digest', async t => {
  await t.test('wrong executable mode', async t => {
    const item = await fixture(t);
    await chmod(resolve(item.code, 'bootstrap'), 0o644);
    await rebuild(item);
    await assert.rejects(verifyFcPublication(item), /executable modes/);
  });
  await t.test('wrong order', async t => {
    const item = await fixture(t);
    await rebuild(item, [PATHS[1], PATHS[0], ...PATHS.slice(2)]);
    await assert.rejects(verifyFcPublication(item), /ZIP allowlist/);
  });
  await t.test('extra entry', async t => {
    const item = await fixture(t);
    await writeFile(resolve(item.code, 'extra.txt'), 'synthetic');
    await rebuild(item, [...PATHS, 'extra.txt']);
    await assert.rejects(verifyFcPublication(item), /exactly six entries/);
  });
  for (const replacement of ['../escape', 'bootstrap']) await t.test(replacement === 'bootstrap' ? 'duplicate name' : 'unsafe name', async t => {
    const item = await fixture(t);
    let bytes = await readFile(resolve(item.directory, ARCHIVE));
    if (replacement === 'bootstrap') {
      bytes = rewriteZipEntries(bytes, entries => { entries[1] = { central: Buffer.from(entries[0].central), local: entries[0].local }; });
      await writeArchive(item, bytes);
      const listed = spawnSync('/usr/bin/unzip', ['-Z', '-1', resolve(item.directory, ARCHIVE)], { encoding: 'utf8' });
      assert.equal(listed.status, 0, 'fixture remains a structurally valid ZIP');
      assert.equal(listed.stdout.split('\n').filter(name => name === 'bootstrap').length, 2);
    } else {
      let offset = 0;
      while ((offset = bytes.indexOf(Buffer.from('bootstrap'), offset)) !== -1) { bytes.write(replacement, offset); offset += 9; }
    }
    await writeArchive(item, bytes);
    await assert.rejects(verifyFcPublication(item), /ZIP/);
  });
});

test('compressed data cannot inflate beyond the reviewed file length', async t => {
  const item = await fixture(t);
  const original = await readFile(resolve(item.directory, ARCHIVE));
  const oversized = deflateRawSync(Buffer.alloc(1024 * 1024, 65));
  const bytes = rewriteZipEntries(original, entries => {
    const entry = entries[0];
    const headerLength = 30 + entry.local.readUInt16LE(26) + entry.local.readUInt16LE(28);
    const header = Buffer.from(entry.local.subarray(0, headerLength));
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(oversized.length, 18);
    entry.central.writeUInt16LE(8, 10);
    entry.central.writeUInt32LE(oversized.length, 20);
    entry.local = Buffer.concat([header, oversized]);
  });
  await writeArchive(item, bytes);
  await assert.rejects(verifyFcPublication(item), /compressed file is invalid or exceeds its declared size: bootstrap/);
});

test('manifest hashes do not vouch for release metadata or for a substituted runtime', async t => {
  const cases = [
    [release => { release.sourceCommit = '0'.repeat(40); }, /Release does not match/],
    [release => { release.node.sha256 = '0'.repeat(64); }, /pinned official/],
    [release => { release.files[0].sha256 = '0'.repeat(64); }, /records differ/],
    [release => { release.extra = true; }, /release schema/],
  ];
  for (const [mutate, error] of cases) {
    const item = await fixture(t);
    mutate(item.release);
    await rebuild(item);
    await assert.rejects(verifyFcPublication(item), error);
  }
  const runtime = await fixture(t);
  await assert.rejects(verifyFcPublication(runtime), /Compressed runtime does not contain the pinned official Node binary/);
});

test('self-consistent compressed runtime records cannot admit malformed, trailing, concatenated or oversized XZ output', async t => {
  const oversized = spawnSync('python3', ['-I', '-S', '-c', `import lzma,sys
c=lzma.LZMACompressor(format=lzma.FORMAT_XZ,check=lzma.CHECK_CRC64,preset=0)
for _ in range(193):
    sys.stdout.buffer.write(c.compress(b'X' * (1024 * 1024)))
sys.stdout.buffer.write(c.flush())`], { env: gitEnv, timeout: 30_000, maxBuffer: 1024 * 1024 });
  assert.equal(oversized.status, 0);
  const valid = compress(elf());
  for (const bytes of [Buffer.from('not-XZ'), valid.subarray(0, -1), Buffer.concat([valid, Buffer.from([0])]), Buffer.concat([valid, valid]), oversized.stdout]) {
    const item = await fixture(t);
    await writeFile(resolve(item.code, PATHS[4]), bytes);
    item.manifest.files[4] = { path: PATHS[4], bytes: bytes.length, sha256: hash(bytes), mode: '0644' };
    item.release.files[4] = { ...item.manifest.files[4] };
    await rebuild(item);
    await assert.rejects(verifyFcPublication(item), /Compressed runtime inspection failed/);
  }
});

test('child failures are bounded and never expose stderr', async t => {
  const item = await fixture(t);
  const syntheticSecret = 'SYNTHETIC-CHILD-STDERR-DO-NOT-ECHO';
  await assert.rejects(verifyFcPublication({ ...item, execute(command, args, options) {
    assert.equal(command, 'git');
    assert.ok(args.includes('cat-file'));
    assert.ok(options.timeout > 0 && options.maxBuffer < 200 * 1024 * 1024);
    return { status: 2, stderr: syntheticSecret, stdout: '' };
  } }), error => error.message === 'Source commit lookup failed' && !error.message.includes(syntheticSecret));
});
