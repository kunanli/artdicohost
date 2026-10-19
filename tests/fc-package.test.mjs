import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { NODE_VERSION, PACKAGE_PATHS, parseArguments, prepareFcBootstrap, sha256, verifyNodeBytes } from '../scripts/prepare-fc-bootstrap.mjs';

const sources = ['functions/fc-api/bootstrap', 'functions/fc-api/handler.mjs', 'functions/fc-api/server.mjs'];
const gitEnv = { PATH: process.env.PATH ?? '', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' };

function git(directory, args) {
  const result = spawnSync('git', ['--no-replace-objects', '-C', directory, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Package Fixture', '-c', 'user.email=package@example.invalid', ...args], { encoding: 'utf8', env: gitEnv });
  assert.equal(result.status, 0, 'fixture git operation succeeds');
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

async function fixture(t) {
  const directory = await mkdtemp(resolve(tmpdir(), 'artdico-fc-package-test-'));
  t.after(async () => {
    if (dirname(directory) !== resolve(tmpdir()) || !basename(directory).startsWith('artdico-fc-package-test-')) throw new Error('Unsafe package fixture cleanup');
    await rm(directory, { recursive: true, force: true });
  });
  const repositoryDirectory = resolve(directory, 'repository');
  await mkdir(resolve(repositoryDirectory, 'functions/fc-api'), { recursive: true });
  for (const [index, path] of sources.entries()) await writeFile(resolve(repositoryDirectory, path), index ? 'export const synthetic = true;\n' : '#!/bin/sh\nexec /code/runtime/node/bin/node /code/functions/fc-api/server.mjs\n');
  git(repositoryDirectory, ['init', '--quiet']);
  git(repositoryDirectory, ['add', '--', ...sources]);
  git(repositoryDirectory, ['commit', '--quiet', '-m', 'Synthetic package fixture']);
  const sourceCommit = git(repositoryDirectory, ['rev-parse', 'HEAD']);
  const nodeBinary = resolve(directory, 'synthetic-node');
  const bytes = elf();
  await writeFile(nodeBinary, bytes, { mode: 0o755 });
  const outputDirectory = resolve(directory, 'output');
  const execute = (command, args, options) => command === nodeBinary ? { status: 0, stdout: NODE_VERSION + '\n' } : spawnSync(command, args, options);
  return { directory, repositoryDirectory, sourceCommit, nodeBinary, expectedNodeSha256: sha256(bytes), outputDirectory, execute };
}

// Inspect ZIP central-directory names and Unix modes without inflating the Node binary.
function archiveEntries(bytes) {
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  assert.ok(end >= 0, 'ZIP end record exists');
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  const entries = [];
  for (let index = 0; index < count; index++) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    const length = bytes.readUInt16LE(offset + 28);
    entries.push({ path: bytes.subarray(offset + 46, offset + 46 + length).toString('utf8'), mode: (bytes.readUInt32LE(offset + 38) >>> 16) & 0o777 });
    offset += 46 + length + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  return entries;
}

test('runtime checks reject a mismatched checksum, non-ELF and wrong ELF architecture', () => {
  const valid = elf();
  verifyNodeBytes(valid, sha256(valid));
  assert.throws(() => verifyNodeBytes(valid, '0'.repeat(64)), /SHA-256 mismatch/);
  assert.throws(() => verifyNodeBytes(valid, undefined), /explicitly/);
  for (const mutate of [bytes => { bytes[0] = 0; }, bytes => { bytes[4] = 1; }, bytes => { bytes[5] = 2; }, bytes => bytes.writeUInt16LE(183, 18)]) {
    const bytes = Buffer.from(valid);
    mutate(bytes);
    assert.throws(() => verifyNodeBytes(bytes, sha256(bytes)), /Linux ELF64/);
  }
});

test('packaging rejects the wrong Node patch version before copying any code', async t => {
  const options = await fixture(t);
  await assert.rejects(prepareFcBootstrap({ ...options, execute: () => ({ status: 0, stdout: 'v24.18.0\n' }) }), /exactly v24.19.0/);
  await assert.rejects(stat(resolve(options.outputDirectory, 'code')), { code: 'ENOENT' });
});

test('only the explicit complete CLI arguments and full source SHA are accepted', async t => {
  const args = ['--node-binary', '/node', '--node-sha256', 'a'.repeat(64), '--source-commit', 'b'.repeat(40), '--out', '/output'];
  assert.equal(parseArguments(args).sourceCommit, 'b'.repeat(40));
  for (const invalid of [[], args.slice(0, -2), [...args, '--out', '/other'], [...args, '--extra', 'value']]) assert.throws(() => parseArguments(invalid));
  const options = await fixture(t);
  await assert.rejects(prepareFcBootstrap({ ...options, sourceCommit: 'main' }), /exact 40-character/);
});

test('a nonempty output is preserved and never reused', async t => {
  const options = await fixture(t);
  await mkdir(options.outputDirectory);
  const sentinel = resolve(options.outputDirectory, 'keep.txt');
  await writeFile(sentinel, 'preserve');
  await assert.rejects(prepareFcBootstrap(options), /must be empty/);
  assert.equal(await readFile(sentinel, 'utf8'), 'preserve');
});

test('source bytes must match the supplied commit before packaging', async t => {
  const options = await fixture(t);
  await writeFile(resolve(options.repositoryDirectory, sources[1]), 'export const synthetic = false;\n');
  await assert.rejects(prepareFcBootstrap(options), /does not match the exact source commit/);
  await assert.rejects(stat(resolve(options.outputDirectory, 'code')), { code: 'ENOENT' });
});

test('a tree SHA cannot stand in for a commit even through a replacement ref', async t => {
  const options = await fixture(t);
  const tree = git(options.repositoryDirectory, ['rev-parse', options.sourceCommit + '^{tree}']);
  git(options.repositoryDirectory, ['replace', '--force', tree, options.sourceCommit]);
  await assert.rejects(prepareFcBootstrap({ ...options, sourceCommit: tree }), /must identify a commit object/);
  await assert.rejects(stat(resolve(options.outputDirectory, 'code')), { code: 'ENOENT' });
});

test('local replacement refs cannot substitute different source bytes for a commit', async t => {
  const options = await fixture(t);
  await writeFile(resolve(options.repositoryDirectory, sources[1]), 'export const synthetic = false;\n');
  git(options.repositoryDirectory, ['add', '--', sources[1]]);
  git(options.repositoryDirectory, ['commit', '--quiet', '-m', 'Replacement source fixture']);
  const replacement = git(options.repositoryDirectory, ['rev-parse', 'HEAD']);
  git(options.repositoryDirectory, ['replace', options.sourceCommit, replacement]);
  await assert.rejects(prepareFcBootstrap({ ...options, execute: (command, args, settings) => {
    assert.notEqual(command, 'zip', 'replacement bytes must be rejected before ZIP creation');
    return options.execute(command, args, settings);
  } }), /does not match the exact source commit/);
  await assert.rejects(stat(resolve(options.outputDirectory, 'code')), { code: 'ENOENT' });
});

test('input files, parent directories and output paths cannot be symbolic links', async t => {
  const options = await fixture(t);
  const nodeLink = resolve(options.directory, 'linked-node');
  await symlink(options.nodeBinary, nodeLink);
  await assert.rejects(prepareFcBootstrap({ ...options, nodeBinary: nodeLink }), /Symbolic links/);
  const source = resolve(options.repositoryDirectory, sources[1]);
  const external = resolve(options.directory, 'external.mjs');
  await writeFile(external, 'export const synthetic = true;\n');
  await rm(source);
  await symlink(external, source);
  await assert.rejects(prepareFcBootstrap(options), /Symbolic links/);
  const parentLink = resolve(options.directory, 'linked-repository');
  await symlink(options.repositoryDirectory, parentLink, 'dir');
  await assert.rejects(prepareFcBootstrap({ ...options, repositoryDirectory: parentLink }), /Symbolic links/);
  const outputLink = resolve(options.directory, 'linked-output');
  await symlink(options.outputDirectory, outputLink, 'dir');
  await assert.rejects(prepareFcBootstrap({ ...options, outputDirectory: outputLink }), /Symbolic links/);
});

test('one real ZIP contains exactly the reviewed files, verified runtime and executable startup', { skip: process.platform !== 'linux' || process.arch !== 'x64' ? 'The real runtime ZIP check runs on Linux x64 CI.' : false }, async t => {
  assert.equal(process.version, NODE_VERSION, 'CI uses the pinned Node patch');
  const options = await fixture(t);
  // Extra synthetic files are deliberately outside the allowlist and are never read.
  await writeFile(resolve(options.repositoryDirectory, '.env'), 'SYNTHETIC_PRIVATE_VALUE=never-package\n');
  await writeFile(resolve(options.repositoryDirectory, 'contacts.json'), '{"synthetic":true}\n');
  const nodeBytes = await readFile(process.execPath);
  const calls = [];
  const manifest = await prepareFcBootstrap({ ...options, nodeBinary: process.execPath, expectedNodeSha256: sha256(nodeBytes), execute: (command, args, settings) => { calls.push(command); return spawnSync(command, args, settings); } });
  assert.equal(calls.filter(command => command === 'zip').length, 1);
  assert.deepEqual(manifest.files.map(item => item.path), PACKAGE_PATHS);
  assert.deepEqual(Object.keys(manifest.node), ['version', 'platform', 'arch', 'sha256']);
  assert.match(manifest.verification, /provenance must be verified separately/);
  const zipBytes = await readFile(resolve(options.outputDirectory, manifest.archive.path));
  assert.equal(sha256(zipBytes), manifest.archive.sha256);
  assert.deepEqual(archiveEntries(zipBytes), PACKAGE_PATHS.map(path => ({ path, mode: path === 'bootstrap' || path === 'runtime/node/bin/node' ? 0o755 : 0o644 })));
  const release = JSON.parse(await readFile(resolve(options.outputDirectory, 'code/release.json'), 'utf8'));
  assert.equal(release.sourceCommit, options.sourceCommit);
  assert.deepEqual(release.files, manifest.files.filter(item => item.path !== 'release.json'));
  for (const item of manifest.files) {
    const path = resolve(options.outputDirectory, 'code', item.path);
    assert.equal((await stat(path)).mode & 0o777, parseInt(item.mode, 8));
    assert.equal(sha256(await readFile(path)), item.sha256);
  }
  assert.deepEqual(JSON.parse(await readFile(resolve(options.outputDirectory, 'package-manifest.json'), 'utf8')), manifest);
  await assert.rejects(prepareFcBootstrap(options), /must be empty/);
});
