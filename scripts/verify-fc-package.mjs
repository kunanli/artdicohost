import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, parse, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const MiB = 1024 * 1024;
const MAX_ARCHIVE_BYTES = 64 * MiB;
const ARCHIVE = 'artdicohost-fc-preflight.zip';
const MANIFEST = 'package-manifest.json';
const OFFICIAL_NODE_SHA256 = 'bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12';
const NODE = Object.freeze({ version: 'v24.19.0', platform: 'linux', arch: 'x64', sha256: OFFICIAL_NODE_SHA256 });
const FILES = Object.freeze([
  { path: 'bootstrap', source: 'functions/fc-api/bootstrap', mode: '0755', limit: MiB },
  { path: 'functions/fc-api/handler.mjs', source: 'functions/fc-api/handler.mjs', mode: '0644', limit: MiB },
  { path: 'functions/fc-api/server.mjs', source: 'functions/fc-api/server.mjs', mode: '0644', limit: MiB },
  { path: 'runtime/node/bin/node', mode: '0755', limit: 192 * MiB },
  { path: 'release.json', mode: '0644', limit: 64 * 1024 },
]);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const isSha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const childEnv = () => ({ PATH: process.env.PATH ?? '', LANG: 'C', LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' });

function exactKeys(value, names, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== names.length || names.some(name => !Object.hasOwn(value, name))) throw new Error('Invalid ' + label + ' schema');
}

function nodeRecord(value) {
  exactKeys(value, ['version', 'platform', 'arch', 'sha256'], 'Node runtime');
  if (Object.keys(NODE).some(key => value[key] !== NODE[key])) throw new Error('Node runtime must match the pinned official Linux x64 v24.19.0 binary');
}

function fileRecords(value, count) {
  if (!Array.isArray(value) || value.length !== count) throw new Error('Package files must match the exact allowlist');
  for (let index = 0; index < count; index++) {
    const item = value[index];
    const expected = FILES[index];
    exactKeys(item, ['path', 'bytes', 'sha256', 'mode'], 'file record');
    if (item.path !== expected.path || item.mode !== expected.mode || !isSha256(item.sha256)
      || !Number.isSafeInteger(item.bytes) || item.bytes <= 0 || item.bytes > expected.limit) throw new Error('Invalid allowlisted file record: ' + expected.path);
    if (item.path === 'runtime/node/bin/node' && item.sha256 !== OFFICIAL_NODE_SHA256) throw new Error('Runtime file must use the pinned official binary SHA-256');
  }
}

function decodeJson(bytes, label) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('Invalid ' + label + ' JSON'); }
}

async function noLinks(path) {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let current = root;
  const parts = absolute.slice(root.length).split(sep).filter(Boolean);
  for (let index = 0; index < parts.length; index++) {
    current = resolve(current, parts[index]);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new Error('Symbolic links are not allowed in publication paths');
    if (index < parts.length - 1 && !stat.isDirectory()) throw new Error('Publication parent must be a directory');
  }
}

async function regularBytes(path, limit) {
  await noLinks(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > limit) throw new Error('Publication file exceeds its size limit or is not a regular file');
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!result.bytesRead) throw new Error('Publication file changed while reading');
      offset += result.bytesRead;
    }
    if ((await handle.stat()).size !== bytes.length) throw new Error('Publication file changed while reading');
    return bytes;
  } finally { await handle.close(); }
}

function run(execute, command, args, limit, label, encoding) {
  let result;
  try { result = execute(command, args, { env: childEnv(), timeout: 30_000, maxBuffer: limit, stdio: 'pipe', ...(encoding ? { encoding } : {}) }); }
  catch { throw new Error(label + ' failed'); }
  if (result.error || result.status !== 0) throw new Error(label + ' failed');
  if (encoding) {
    if (typeof result.stdout !== 'string' || Buffer.byteLength(result.stdout) > limit) throw new Error(label + ' returned invalid output');
  } else if (!Buffer.isBuffer(result.stdout) || result.stdout.length > limit) throw new Error(label + ' returned invalid output');
  return result.stdout;
}

// Read ZIP metadata directly: never extract an artifact onto the filesystem.
function verifyCentralDirectory(bytes, records) {
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) { end = offset; break; }
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0
    || bytes.readUInt16LE(end + 8) !== FILES.length || bytes.readUInt16LE(end + 10) !== FILES.length) throw new Error('ZIP must contain exactly five entries in one disk');
  let offset = bytes.readUInt32LE(end + 16);
  const centralStart = offset;
  if (offset + bytes.readUInt32LE(end + 12) !== end) throw new Error('ZIP central directory is invalid');
  let previousEnd = 0;
  const entries = new Map();
  for (let index = 0; index < FILES.length; index++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid ZIP central entry');
    const nameLength = bytes.readUInt16LE(offset + 28);
    const next = offset + 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
    if (next > end) throw new Error('Invalid ZIP entry bounds');
    const expected = FILES[index];
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const flags = bytes.readUInt16LE(offset + 8);
    const compression = bytes.readUInt16LE(offset + 10);
    const mode = bytes.readUInt32LE(offset + 38) >>> 16;
    if (!name.equals(Buffer.from(expected.path)) || bytes[offset + 5] !== 3 || flags !== 0
      || bytes.readUInt16LE(offset + 6) > 20 || bytes.readUInt16LE(offset + 30) !== 0 || bytes.readUInt16LE(offset + 32) !== 0
      || ![0, 8].includes(compression) || mode !== (0o100000 | parseInt(expected.mode, 8))
      || bytes.readUInt16LE(offset + 34) !== 0 || bytes.readUInt32LE(offset + 24) !== records[index].bytes) throw new Error('ZIP allowlist, executable modes or file lengths do not match');
    const local = bytes.readUInt32LE(offset + 42);
    if (local !== previousEnd || local + 30 > centralStart || bytes.readUInt32LE(local) !== 0x04034b50) throw new Error('Invalid ZIP local entry');
    const localNameLength = bytes.readUInt16LE(local + 26);
    const contentStart = local + 30 + localNameLength + bytes.readUInt16LE(local + 28);
    const contentEnd = contentStart + bytes.readUInt32LE(offset + 20);
    if (contentEnd > centralStart || bytes.readUInt16LE(local + 4) > 20 || bytes.readUInt16LE(local + 28) !== 0
      || !bytes.subarray(local + 30, local + 30 + localNameLength).equals(name)
      || bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== compression
      || !bytes.subarray(local + 14, local + 26).equals(bytes.subarray(offset + 16, offset + 28))) throw new Error('ZIP local metadata does not match the central directory');
    previousEnd = contentEnd;
    entries.set(expected.path, { start: contentStart, end: contentEnd, compression });
    offset = next;
  }
  if (offset !== end || previousEnd !== centralStart) throw new Error('ZIP contains unlisted data or entries');
  return entries;
}

/** Verify an immutable two-file CI artifact; this function never deploys or writes. */
export async function verifyFcPublication({ directory, expectedCommit, repositoryDirectory, execute = spawnSync } = {}) {
  if (!/^[a-f0-9]{40}$/.test(expectedCommit ?? '')) throw new Error('Expected commit must be an exact 40-character SHA');
  if (![directory, repositoryDirectory].every(value => typeof value === 'string' && value.length)) throw new Error('Publication and repository directories are required');
  const artifact = resolve(directory);
  const repository = resolve(repositoryDirectory);
  await noLinks(artifact);
  await noLinks(repository);
  const names = await readdir(artifact);
  if (names.length !== 2 || !names.includes(MANIFEST) || !names.includes(ARCHIVE)) throw new Error('Publication directory must contain only the manifest and ZIP');
  const manifest = decodeJson(await regularBytes(resolve(artifact, MANIFEST), 64 * 1024), 'manifest');
  exactKeys(manifest, ['schemaVersion', 'kind', 'sourceCommit', 'node', 'files', 'archive', 'verification'], 'manifest');
  if (manifest.schemaVersion !== 1 || manifest.kind !== 'fc-preflight' || manifest.sourceCommit !== expectedCommit) throw new Error('Manifest does not match the expected commit or package kind');
  if (typeof manifest.verification !== 'string' || manifest.verification.length > 1024) throw new Error('Invalid manifest verification note');
  nodeRecord(manifest.node);
  fileRecords(manifest.files, FILES.length);
  exactKeys(manifest.archive, ['path', 'bytes', 'sha256'], 'archive record');
  if (manifest.archive.path !== ARCHIVE || !Number.isSafeInteger(manifest.archive.bytes)
    || manifest.archive.bytes <= 0 || manifest.archive.bytes > MAX_ARCHIVE_BYTES || !isSha256(manifest.archive.sha256)) throw new Error('Invalid archive name, size or digest');
  const archivePath = resolve(artifact, ARCHIVE);
  const zipBytes = await regularBytes(archivePath, MAX_ARCHIVE_BYTES);
  if (zipBytes.length !== manifest.archive.bytes || digest(zipBytes) !== manifest.archive.sha256) throw new Error('ZIP bytes do not match the manifest');
  const entries = verifyCentralDirectory(zipBytes, manifest.files);
  const objectType = run(execute, 'git', ['--no-replace-objects', '-C', repository, 'cat-file', '-t', expectedCommit], 4096, 'Source commit lookup', 'utf8');
  if (objectType.trim() !== 'commit') throw new Error('Expected source SHA must identify a commit object');
  const contents = new Map();
  for (const expected of [...FILES.filter(item => item.source), FILES[4], FILES[3]]) {
    const record = manifest.files.find(item => item.path === expected.path);
    const entry = entries.get(expected.path);
    const compressed = zipBytes.subarray(entry.start, entry.end);
    let bytes;
    try {
      bytes = entry.compression === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: record.bytes });
    } catch { throw new Error('ZIP compressed file is invalid or exceeds its declared size: ' + expected.path); }
    if (bytes.length !== record.bytes || digest(bytes) !== record.sha256) throw new Error('ZIP file bytes do not match the manifest: ' + expected.path);
    contents.set(expected.path, bytes);
    if (expected.source) {
      const committed = run(execute, 'git', ['--no-replace-objects', '-C', repository, '--no-pager', 'show', '--no-ext-diff', '--no-textconv', expectedCommit + ':' + expected.source], MiB, 'Committed source lookup');
      if (!committed.equals(bytes)) throw new Error('ZIP source differs from the expected commit: ' + expected.path);
    }
    if (expected.path === 'release.json') {
      const release = decodeJson(bytes, 'release');
      exactKeys(release, ['schemaVersion', 'kind', 'sourceCommit', 'node', 'files'], 'release');
      if (release.schemaVersion !== 1 || release.kind !== 'fc-preflight' || release.sourceCommit !== expectedCommit) throw new Error('Release does not match the expected commit or package kind');
      nodeRecord(release.node);
      fileRecords(release.files, 4);
      for (let index = 0; index < 4; index++) {
        const actual = release.files[index];
        const manifestFile = manifest.files[index];
        if (['path', 'bytes', 'sha256', 'mode'].some(key => actual[key] !== manifestFile[key])) throw new Error('Release file records differ from the manifest');
      }
    }
  }
  const runtime = contents.get('runtime/node/bin/node');
  if (runtime.length < 64 || !runtime.subarray(0, 7).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]))
    || runtime.readUInt16LE(18) !== 62 || runtime.readUInt32LE(20) !== 1) throw new Error('Official runtime must be Linux ELF64 little-endian x86_64');
  // Return the verified bytes rather than asking callers to re-read a mutable path.
  return { zipBytes, manifest };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) throw new Error('Usage: node scripts/verify-fc-package.mjs ARTIFACT_DIRECTORY EXPECTED_COMMIT_SHA');
  const { manifest, zipBytes } = await verifyFcPublication({ directory: process.argv[2], expectedCommit: process.argv[3], repositoryDirectory: resolve(dirname(fileURLToPath(import.meta.url)), '..') });
  console.log('Verified FC publication: ' + manifest.files.length + ' allowlisted files, ' + zipBytes.length + ' ZIP bytes. No cloud resources were changed.');
}
