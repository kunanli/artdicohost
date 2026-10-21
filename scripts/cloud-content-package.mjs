import { constants } from 'node:fs';
import { lstat, open, mkdir, writeFile, chmod, readdir, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, parse, posix, resolve, sep } from 'node:path';
import { verifyNodeBytes } from './prepare-fc-bootstrap.mjs';
import { assertFcCodeRequestFits, MAX_FC_ZIP_BYTES } from './fc-upload-limits.mjs';

export const CANDIDATE_KIND = 'fc-cloud-content-candidate';
export const CANDIDATE_ARCHIVE = 'artdicohost-cloud-content-candidate.zip';
export const CANDIDATE_NODE = Object.freeze({ version: 'v24.19.0', platform: 'linux', arch: 'x64', sha256: 'bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12' });
const MiB = 1024 * 1024;
const BUILD_SCOPES = ['src', 'shared', 'public', 'astro.config.mjs', 'package.json', 'pnpm-lock.yaml', 'tsconfig.json'];
export const CANDIDATE_SOURCES = Object.freeze([
  ['functions/cloud-content/bootstrap', 'bootstrap', '0755'],
  ...['launch.py', 'server.mjs', 'runtime.mjs', 'http-server.mjs', 'handler.mjs', 'auth.mjs', 'oss-client.mjs', 'object-journal.mjs', 'store.mjs', 'portrait-store.mjs', 'contacts-store.mjs', 'errors.mjs', 'acceptance.mjs', 'scoped-objects.mjs', 'user-store.mjs', 'user-handler.mjs', 'contact-admission-guard.mjs'].map(name => ['functions/cloud-content/' + name, 'functions/cloud-content/' + name, '0644']),
  ...['handler.mjs', 'launch.py'].map(name => ['functions/fc-api/' + name, 'functions/fc-api/' + name, '0644']),
  ...['auth.mjs', 'store.mjs', 'communications.mjs'].map(name => ['functions/content-api/' + name, 'functions/content-api/' + name, '0644']),
  ...['handler.mjs', 'policy.mjs', 'validation.mjs', 'tokens.mjs', 'rate-limit.mjs', 'repository.mjs', 'service.mjs', 'group-invite.mjs', 'group-invite-handler.mjs', 'admissions.mjs', 'admission-service.mjs'].map(name => ['functions/registration-api/' + name, 'functions/registration-api/' + name, '0644']),
  ...['handler.mjs', 'store.mjs', 'errors.mjs', 'maintenance.mjs', 'maintenance-handler.mjs', 'admissions-handler.mjs', 'xlsx-handler.mjs', 'xlsx-export.mjs'].map(name => ['functions/registration-admin/' + name, 'functions/registration-admin/' + name, '0644']),
  ...['tokens.mjs', 'repository.mjs', 'email-provider.mjs', 'service.mjs', 'handler.mjs', 'config-bundle.mjs'].map(name => ['functions/registration-confirmation/' + name, 'functions/registration-confirmation/' + name, '0644']),
  ...['der.mjs', 'pkpass.mjs', 'service.mjs', 'handler.mjs', 'bundle.mjs'].map(name => ['functions/apple-wallet/' + name, 'functions/apple-wallet/' + name, '0644']),
  ['functions/delivery-config/bundle.mjs', 'functions/delivery-config/bundle.mjs', '0644'],
  ...['handler.mjs', 'service.mjs', 'repository.mjs', 'email-provider.mjs', 'errors.mjs', 'importer.mjs', 'contact-snapshot.mjs', 'import-handler.mjs', 'batch.mjs'].map(name => ['functions/intent-invitations/' + name, 'functions/intent-invitations/' + name, '0644']),
  ['functions/organizer-tasks/handler.mjs', 'functions/organizer-tasks/handler.mjs', '0644'],
  ...['handler.mjs', 'projection.mjs', 'relationships.mjs'].map(name => ['functions/person-workspace/' + name, 'functions/person-workspace/' + name, '0644']),
  ['functions/people-operations/service.mjs', 'functions/people-operations/service.mjs', '0644'],
  ...['repository.mjs', 'planning.mjs', 'service.mjs', 'handler.mjs', 'xlsx.mjs'].map(name => ['functions/volunteers/' + name, 'functions/volunteers/' + name, '0644']),
  ...['content-schema.mjs', 'contacts-schema.mjs', 'contact-editor.mjs', 'arrangement-overview.mjs', 'portrait-codec.mjs', 'registration-schema.mjs', 'general-application.mjs', 'organizer-progress.mjs', 'volunteer-schema.mjs', 'xlsx-workbook.mjs', 'staff-permissions.mjs'].map(name => ['shared/' + name, 'shared/' + name, '0644']),
  ...['content.mjs', 'event.mjs'].map(name => ['src/config/' + name, 'src/config/' + name, '0644']),
]);
const FIXED_ASSETS = Object.freeze([
  ['/admin/', 'admin/index.html'], ['/admin/contacts/', 'admin/contacts/index.html'],
  ['/admin/registrations/', 'admin/registrations/index.html'], ['/admin/tasks/', 'admin/tasks/index.html'],
  ['/admin/settings/', 'admin/settings/index.html'], ['/admin/person/', 'admin/person/index.html'],
  ['/admin/volunteers/', 'admin/volunteers/index.html'],
  ['/invitations/template-blank.png', 'invitations/template-blank.png'],
  ['/invitations/ggj2026-poster-v2.webp', 'invitations/ggj2026-poster-v2.webp'],
]);
const ASSET = /^\/_astro\/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,200}\.(?:css|m?js|woff2?)$/u;
const HASH = /^[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const safeEnv = () => ({ PATH: process.env.PATH ?? '', LANG: 'C', LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', NODE_ENV: 'production', ASTRO_TELEMETRY_DISABLED: '1' });
export const candidateSha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };

export function exactKeys(value, names, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== names.length || names.some(key => !Object.hasOwn(value, key))) fail('Invalid candidate ' + label + ' schema');
}

export async function noCandidateLinks(path, allowMissing = false) {
  const absolute = resolve(path), root = parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = resolve(current, part);
    let info;
    try { info = await lstat(current); } catch (error) { if (allowMissing && error.code === 'ENOENT') return; throw error; }
    if (info.isSymbolicLink()) fail('Symbolic links are not allowed in candidate paths');
    if (current !== absolute && !info.isDirectory()) fail('Candidate parent must be a directory');
  }
}

export async function candidateBytes(path, limit) {
  await noCandidateLinks(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || !info.size || info.size > limit) fail('Candidate input must be a bounded nonempty regular file');
    const bytes = await handle.readFile();
    if (bytes.length !== info.size || (await handle.stat()).size !== bytes.length) fail('Candidate input changed while reading');
    return bytes;
  } finally { await handle.close(); }
}

function run(execute, command, args, { cwd, input, limit = 4 * MiB, timeout = 30_000, text = false } = {}) {
  const result = execute(command, args, { cwd, input, env: safeEnv(), timeout, maxBuffer: limit, stdio: 'pipe', ...(text ? { encoding: 'utf8' } : {}) });
  if (result.error || result.status !== 0 || (text ? typeof result.stdout !== 'string' : !Buffer.isBuffer(result.stdout))) fail('Candidate subprocess failed');
  return result.stdout;
}

async function writeKnown(path, bytes, mode = '0644') {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, bytes, { flag: 'wx', mode: parseInt(mode, 8) });
  await chmod(path, parseInt(mode, 8));
}

export function candidateAssetPath(url) {
  const known = FIXED_ASSETS.find(item => item[0] === url);
  if (known) return 'admin-assets/' + known[1];
  if (typeof url !== 'string' || !ASSET.test(url) || url.includes('..')) fail('Unexpected candidate asset URL');
  return 'admin-assets' + url;
}

/** Generated references are traversed only from the selected admin pages, never by scanning dist. */
export function candidateReferences(bytes, url) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const found = new Set();
  const add = ref => {
    if (/[?#\\]/u.test(ref)) fail('Candidate asset references must be exact paths');
    const resolved = ref.startsWith('/') ? ref : ref.startsWith('_astro/') ? '/' + ref : posix.normalize(posix.join(posix.dirname(url), ref));
    candidateAssetPath(resolved); found.add(resolved);
  };
  for (const match of text.matchAll(/["'`(](\/?_astro\/[^"'`\s)<>]+|\.{1,2}\/[^"'`\s)<>]+\.(?:m?js|css|woff2?)(?:[?#][^"'`\s)<>]+)?)(?:["'`)])/gu)) {
    const ref = match[1];
    add(ref);
  }
  if (/\.m?js$/u.test(url)) for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["']([^"']+)["']/gu)) add(match[1]);
  // HTML executable/style references cannot quietly bypass the asset graph.
  if (url.endsWith('/')) {
    for (const match of text.matchAll(/<(?:script|link)\b[^>]*(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>/giu)) {
      const ref = match[1];
      if (!ref.startsWith('#') && /\.(?:m?js|css)(?:[?#]|$)/u.test(ref)) {
        candidateAssetPath(ref); found.add(ref);
      }
    }
  }
  return [...found].sort();
}

function record(path, bytes, mode = '0644') { return { path, bytes: bytes.length, sha256: candidateSha256(bytes), mode }; }
function assetRecord(url, bytes) { return { url, ...record(candidateAssetPath(url), bytes) }; }

async function sourceInputs(repository, sourceCommit, execute) {
  if (run(execute, 'git', ['--no-replace-objects', '-C', repository, 'cat-file', '-t', sourceCommit], { text: true }).trim() !== 'commit') fail('Candidate source must identify a commit');
  const result = [];
  for (const [input, path, mode] of CANDIDATE_SOURCES) {
    const bytes = await candidateBytes(resolve(repository, input), MiB);
    const committed = run(execute, 'git', ['--no-replace-objects', '-C', repository, 'show', '--no-ext-diff', '--no-textconv', sourceCommit + ':' + input], { limit: MiB });
    if (!bytes.equals(committed)) fail('Candidate source differs from the exact commit: ' + input);
    result.push({ path, mode, bytes });
  }
  const paths = new Set(CANDIDATE_SOURCES.map(item => item[0]));
  for (const [input] of CANDIDATE_SOURCES.filter(item => item[0].endsWith('.mjs'))) {
    const bytes = result[CANDIDATE_SOURCES.findIndex(item => item[0] === input)].bytes;
    for (const match of bytes.toString('utf8').matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/gu)) {
      const specifier = match[1];
      if (!specifier.startsWith('node:') && (!specifier.startsWith('.') || !paths.has(posix.normalize(posix.join(posix.dirname(input), specifier))))) fail('Candidate source import is outside the explicit allowlist');
    }
  }
  return result;
}

async function buildAssets({ repository, sourceCommit, output, nodeBinary, execute }) {
  const buildSource = resolve(output, 'build-source'), dist = resolve(output, 'build-dist');
  await mkdir(buildSource, { mode: 0o700 });
  const tree = run(execute, 'git', ['--no-replace-objects', '-C', repository, 'ls-tree', '-r', '-z', '--full-tree', sourceCommit, '--', ...BUILD_SCOPES], { limit: MiB });
  const rows = tree.toString('utf8').split('\0').filter(Boolean);
  if (rows.length < 7 || rows.length > 500) fail('Candidate build input list is invalid');
  let total = 0;
  const seen = new Set();
  for (const row of rows) {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/u.exec(row);
    if (!match) fail('Candidate build input must be a committed regular file');
    const [, mode, object, path] = match;
    if (path.startsWith('/') || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.')) || !BUILD_SCOPES.some(scope => path === scope || path.startsWith(scope + '/')) || seen.has(path)) fail('Invalid candidate build source path');
    seen.add(path);
    const bytes = run(execute, 'git', ['--no-replace-objects', '-C', repository, 'cat-file', 'blob', object], { limit: 24 * MiB });
    if (!bytes.length || (total += bytes.length) > 128 * MiB) fail('Candidate build input capacity exceeded');
    await writeKnown(resolve(buildSource, path), bytes, mode === '100755' ? '0755' : '0644');
  }
  for (const path of BUILD_SCOPES.filter(path => path.includes('.'))) if (!seen.has(path)) fail('Missing fixed candidate build configuration');
  // Only installed locked dependencies are shared with the isolated build. No .env,
  // ignored source, local contact file, or workspace build output is copied.
  const dependencies = resolve(repository, 'node_modules');
  if (!(await lstat(dependencies)).isDirectory()) fail('Install locked build dependencies before preparing a candidate');
  await symlink(dependencies, resolve(buildSource, 'node_modules'), 'dir');
  run(execute, nodeBinary, [resolve(dependencies, 'astro/bin/astro.mjs'), 'build', '--root', buildSource, '--outDir', dist], { cwd: buildSource, limit: 2 * MiB, timeout: 120_000 });
  const selected = new Map(), pending = FIXED_ASSETS.map(item => item[0]);
  let capacity = 0;
  while (pending.length) {
    const url = pending.pop();
    if (selected.has(url)) continue;
    const path = candidateAssetPath(url).slice('admin-assets/'.length);
    const bytes = await candidateBytes(resolve(dist, path), 2 * MiB);
    if (selected.size >= 40 || (capacity += bytes.length) > 8 * MiB) fail('Candidate static asset capacity exceeded');
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|github_pat_[A-Za-z0-9_]{30,}|ghp_[A-Za-z0-9]{30,}/u.test(bytes.toString('utf8'))) fail('Possible secret in candidate static output');
    selected.set(url, bytes);
    if (url.endsWith('/') || /\.(?:css|m?js)$/u.test(url)) pending.push(...candidateReferences(bytes, url));
  }
  return [...selected].sort(([left], [right]) => left.localeCompare(right));
}

const COMPRESS = `import lzma,sys\nc=lzma.LZMACompressor(format=lzma.FORMAT_XZ,check=lzma.CHECK_CRC64,preset=6)\nwhile True:\n b=sys.stdin.buffer.read(65536)\n if not b:break\n sys.stdout.buffer.write(c.compress(b))\nsys.stdout.buffer.write(c.flush())\n`;
export const INSPECT_CANDIDATE_NODE = `import hashlib,json,lzma,sys\nd=lzma.LZMADecompressor(format=lzma.FORMAT_XZ,memlimit=96*1024*1024);h=hashlib.sha256();n=0;header=b''\nwhile True:\n b=sys.stdin.buffer.read(65536)\n if not b:break\n if d.eof:raise ValueError('trailing runtime')\n while True:\n  o=d.decompress(b,max_length=65536);b=b'';n+=len(o);h.update(o);header=(header+o)[:64]\n  if n>192*1024*1024:raise ValueError('runtime limit')\n  if d.eof:\n   if d.unused_data:raise ValueError('trailing runtime')\n   break\n  if d.needs_input:break\nif not d.eof or d.check!=lzma.CHECK_CRC64:raise ValueError('incomplete runtime')\nprint(json.dumps({'bytes':n,'sha256':h.hexdigest(),'header':header.hex()}))\n`;

/** Candidate-only builder. It never updates FC, changes configuration, or reads credentials. */
export async function prepareCloudContentCandidate({ repositoryDirectory, nodeBinary, expectedNodeSha256, sourceCommit, outputDirectory, execute = spawnSync } = {}) {
  if (typeof sourceCommit !== 'string' || !COMMIT.test(sourceCommit) || expectedNodeSha256 !== CANDIDATE_NODE.sha256) fail('Candidate requires the full source SHA and pinned official Node checksum');
  if (![repositoryDirectory, nodeBinary, outputDirectory].every(value => typeof value === 'string' && value.length)) fail('Explicit candidate paths are required');
  const repository = resolve(repositoryDirectory), output = resolve(outputDirectory), binary = resolve(nodeBinary);
  await noCandidateLinks(repository); await noCandidateLinks(output, true);
  await mkdir(output, { recursive: true, mode: 0o700 });
  if ((await readdir(output)).length) fail('Candidate output directory must be empty; no files were removed');
  const source = await sourceInputs(repository, sourceCommit, execute);
  const node = await candidateBytes(binary, 192 * MiB);
  verifyNodeBytes(node, expectedNodeSha256);
  if (run(execute, binary, ['--version'], { text: true, limit: 4096, timeout: 10_000 }).trim() !== CANDIDATE_NODE.version) fail('Candidate requires exactly Node v24.19.0');
  const assets = await buildAssets({ repository, sourceCommit, output, nodeBinary: binary, execute });
  const runtime = run(execute, 'python3', ['-I', '-S', '-c', COMPRESS], { input: node, limit: 36 * MiB, timeout: 120_000 });
  const files = [], code = resolve(output, 'code');
  for (const item of source) { await writeKnown(resolve(code, item.path), item.bytes, item.mode); files.push(record(item.path, item.bytes, item.mode)); }
  await writeKnown(resolve(code, 'runtime/node/bin/node.xz'), runtime); files.push(record('runtime/node/bin/node.xz', runtime));
  for (const [url, bytes] of assets) { const path = candidateAssetPath(url); await writeKnown(resolve(code, path), bytes); files.push(record(path, bytes)); }
  const release = { schemaVersion: 1, kind: CANDIDATE_KIND, sourceCommit, node: CANDIDATE_NODE, files: [...files], assets: assets.map(([url, bytes]) => assetRecord(url, bytes)) };
  const releaseBytes = Buffer.from(JSON.stringify(release, null, 2) + '\n');
  if (releaseBytes.length > 64 * 1024 || files.length >= 128) fail('Candidate manifest capacity exceeded');
  await writeKnown(resolve(code, 'release.json'), releaseBytes); files.push(record('release.json', releaseBytes));
  const publication = resolve(output, 'publication'); await mkdir(publication, { mode: 0o700 });
  const archive = resolve(publication, CANDIDATE_ARCHIVE);
  run(execute, 'zip', ['-X', '-q', '-0', archive, ...files.map(item => item.path)], { cwd: code, limit: 4096, timeout: 120_000 });
  const zip = await candidateBytes(archive, MAX_FC_ZIP_BYTES); assertFcCodeRequestFits(zip.length);
  const manifest = { schemaVersion: 1, kind: CANDIDATE_KIND, sourceCommit, node: CANDIDATE_NODE, files, archive: { path: CANDIDATE_ARCHIVE, bytes: zip.length, sha256: candidateSha256(zip) }, verification: 'Candidate only. Committed allowlisted server sources and an isolated locked Astro build are packaged; hashes are checked locally. Generated assets are not an independent reproducible-build attestation. No cloud persistence or deployment is claimed.' };
  await writeKnown(resolve(publication, 'package-manifest.json'), Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
  return manifest;
}

export function candidateFileRecords(value) {
  if (!Array.isArray(value) || value.length < CANDIDATE_SOURCES.length + 5 || value.length > 128) fail('Invalid candidate file list');
  const expected = new Map(CANDIDATE_SOURCES.map(([, path, mode]) => [path, mode]));
  expected.set('runtime/node/bin/node.xz', '0644'); expected.set('release.json', '0644');
  const seen = new Set();
  for (const item of value) {
    exactKeys(item, ['path', 'bytes', 'sha256', 'mode'], 'file');
    let mode = expected.get(item.path);
    if (!mode && typeof item.path === 'string' && item.path.startsWith('admin-assets/')) {
      const url = FIXED_ASSETS.find(([, path]) => item.path === 'admin-assets/' + path)?.[0]
        ?? '/' + item.path.slice('admin-assets/'.length);
      if (candidateAssetPath(url) !== item.path) fail('Unexpected candidate asset file');
      mode = '0644';
    }
    const limit = item.path === 'runtime/node/bin/node.xz' ? MAX_FC_ZIP_BYTES : item.path === 'release.json' ? 64 * 1024 : item.path.startsWith('admin-assets/') ? 2 * MiB : MiB;
    if (!mode || mode !== item.mode || seen.has(item.path) || !Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > limit || !HASH.test(item.sha256 ?? '')) fail('Invalid candidate file record');
    seen.add(item.path);
  }
  if ([...expected.keys()].some(path => !seen.has(path))) fail('Missing explicit candidate source or runtime');
}

/** Strict ZIP inspection; no artifact member is extracted to the filesystem. */
export function candidateZipEntries(bytes, records) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 22) fail('Invalid candidate ZIP');
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) { end = offset; break; }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || bytes.readUInt16LE(end + 8) !== records.length || bytes.readUInt16LE(end + 10) !== records.length || bytes.readUInt16LE(end + 20)) fail('Candidate ZIP must contain exactly the declared entries in one disk');
  let offset = bytes.readUInt32LE(end + 16), previousEnd = 0;
  const central = offset, contents = new Map();
  if (central + bytes.readUInt32LE(end + 12) !== end) fail('Invalid candidate ZIP central directory');
  for (const item of records) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) fail('Invalid candidate ZIP central entry');
    const length = bytes.readUInt16LE(offset + 28), next = offset + 46 + length;
    const name = bytes.subarray(offset + 46, next), method = bytes.readUInt16LE(offset + 10), local = bytes.readUInt32LE(offset + 42), size = bytes.readUInt32LE(offset + 24);
    if (next > end || !name.equals(Buffer.from(item.path)) || bytes[offset + 5] !== 3 || bytes.readUInt16LE(offset + 6) > 20 || bytes.readUInt16LE(offset + 8) || method !== 0 || bytes.readUInt16LE(offset + 30) || bytes.readUInt16LE(offset + 32) || bytes.readUInt16LE(offset + 34) || (bytes.readUInt32LE(offset + 38) >>> 16) !== (0o100000 | parseInt(item.mode, 8)) || size !== item.bytes || local !== previousEnd || local + 30 > central || bytes.readUInt32LE(local) !== 0x04034b50) fail('Candidate ZIP metadata differs from the exact file list');
    const start = local + 30 + bytes.readUInt16LE(local + 26), finish = start + bytes.readUInt32LE(offset + 20);
    if (finish > central || bytes.readUInt16LE(local + 4) > 20 || bytes.readUInt16LE(local + 6) || bytes.readUInt16LE(local + 8) !== method || bytes.readUInt16LE(local + 28) || !bytes.subarray(local + 30, start).equals(name) || !bytes.subarray(local + 14, local + 26).equals(bytes.subarray(offset + 16, offset + 28))) fail('Candidate ZIP local entry differs from its directory');
    // Our producer uses zip -0. Stored-only members make every archived byte
    // part of its declared file hash; deflate streams may ignore trailing data.
    const data = bytes.subarray(start, finish);
    if (data.length !== item.bytes || candidateSha256(data) !== item.sha256) fail('Candidate ZIP content hash mismatch');
    contents.set(item.path, data); previousEnd = finish; offset = next;
  }
  if (offset !== end || previousEnd !== central) fail('Candidate ZIP contains unlisted bytes');
  return contents;
}

export function validateCandidateAssets(release, contents) {
  if (!Array.isArray(release.assets) || release.assets.length < FIXED_ASSETS.length || release.assets.length > 40) fail('Invalid candidate asset map');
  const urls = new Set(), paths = new Set(); let total = 0;
  for (const item of release.assets) {
    exactKeys(item, ['url', 'path', 'bytes', 'sha256', 'mode'], 'asset');
    if (candidateAssetPath(item.url) !== item.path || urls.has(item.url) || paths.has(item.path) || item.mode !== '0644' || !Number.isSafeInteger(item.bytes) || item.bytes <= 0 || item.bytes > 2 * MiB || !HASH.test(item.sha256 ?? '') || (total += item.bytes) > 8 * MiB) fail('Invalid candidate asset record');
    const file = release.files.find(record => record.path === item.path), bytes = contents.get(item.path);
    if (!file || ['path', 'bytes', 'sha256', 'mode'].some(key => file[key] !== item[key]) || !bytes || candidateSha256(bytes) !== item.sha256) fail('Candidate asset does not match its file record');
    urls.add(item.url); paths.add(item.path);
  }
  if (FIXED_ASSETS.some(([url]) => !urls.has(url)) || release.files.some(item => item.path.startsWith('admin-assets/') && !paths.has(item.path))) fail('Incomplete candidate static file map');
  const reachable = new Set(), pending = FIXED_ASSETS.map(([url]) => url);
  while (pending.length) {
    const url = pending.pop(); if (reachable.has(url)) continue;
    if (!urls.has(url)) fail('Candidate referenced asset is missing');
    reachable.add(url);
    if (url.endsWith('/') || /\.(?:css|m?js)$/u.test(url)) pending.push(...candidateReferences(contents.get(candidateAssetPath(url)), url));
  }
  if (reachable.size !== urls.size) fail('Candidate contains unreferenced static assets');
}

/** Validates a candidate artifact only. The existing deploy-fc path accepts fc-preflight, never this kind. */
export async function verifyCloudContentCandidate({ directory, expectedCommit, repositoryDirectory, execute = spawnSync } = {}) {
  if (typeof expectedCommit !== 'string' || !COMMIT.test(expectedCommit) || ![directory, repositoryDirectory].every(value => typeof value === 'string' && value.length)) fail('Explicit candidate artifact, repository and exact source SHA are required');
  const artifact = resolve(directory), repository = resolve(repositoryDirectory);
  await noCandidateLinks(artifact); await noCandidateLinks(repository);
  const names = await readdir(artifact);
  if (names.length !== 2 || !names.includes('package-manifest.json') || !names.includes(CANDIDATE_ARCHIVE)) fail('Candidate publication must contain only its ZIP and manifest');
  const decode = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const manifest = decode(await candidateBytes(resolve(artifact, 'package-manifest.json'), 64 * 1024));
  exactKeys(manifest, ['schemaVersion', 'kind', 'sourceCommit', 'node', 'files', 'archive', 'verification'], 'manifest');
  const checkIdentity = value => {
    if (value.schemaVersion !== 1 || value.kind !== CANDIDATE_KIND || value.sourceCommit !== expectedCommit) fail('Candidate identity does not match the expected source');
    exactKeys(value.node, ['version', 'platform', 'arch', 'sha256'], 'Node');
    if (Object.keys(CANDIDATE_NODE).some(key => value.node[key] !== CANDIDATE_NODE[key])) fail('Candidate Node runtime is not the pinned official binary');
  };
  checkIdentity(manifest); candidateFileRecords(manifest.files);
  if (typeof manifest.verification !== 'string' || manifest.verification.length > 1024) fail('Invalid candidate verification description');
  exactKeys(manifest.archive, ['path', 'bytes', 'sha256'], 'archive');
  if (manifest.archive.path !== CANDIDATE_ARCHIVE || !Number.isSafeInteger(manifest.archive.bytes) || manifest.archive.bytes <= 0 || manifest.archive.bytes > MAX_FC_ZIP_BYTES || !HASH.test(manifest.archive.sha256 ?? '')) fail('Invalid candidate archive record');
  const zipBytes = await candidateBytes(resolve(artifact, CANDIDATE_ARCHIVE), MAX_FC_ZIP_BYTES); assertFcCodeRequestFits(zipBytes.length);
  if (zipBytes.length !== manifest.archive.bytes || candidateSha256(zipBytes) !== manifest.archive.sha256) fail('Candidate archive hash mismatch');
  const contents = candidateZipEntries(zipBytes, manifest.files), release = decode(contents.get('release.json'));
  exactKeys(release, ['schemaVersion', 'kind', 'sourceCommit', 'node', 'files', 'assets'], 'release'); checkIdentity(release);
  if (JSON.stringify(release.files) !== JSON.stringify(manifest.files.filter(item => item.path !== 'release.json'))) fail('Candidate release files differ from publication');
  validateCandidateAssets(release, contents);
  if (run(execute, 'git', ['--no-replace-objects', '-C', repository, 'cat-file', '-t', expectedCommit], { text: true, limit: 4096 }).trim() !== 'commit') fail('Candidate source must identify a commit');
  for (const [source, path] of CANDIDATE_SOURCES) {
    const committed = run(execute, 'git', ['--no-replace-objects', '-C', repository, 'show', '--no-ext-diff', '--no-textconv', expectedCommit + ':' + source], { limit: MiB });
    if (!committed.equals(contents.get(path))) fail('Candidate packaged code differs from the expected source');
  }
  const inspection = decode(Buffer.from(run(execute, 'python3', ['-I', '-S', '-c', INSPECT_CANDIDATE_NODE], { input: contents.get('runtime/node/bin/node.xz'), text: true, limit: 4096 })));
  exactKeys(inspection, ['bytes', 'sha256', 'header'], 'runtime inspection');
  if (inspection.sha256 !== CANDIDATE_NODE.sha256 || !Number.isSafeInteger(inspection.bytes) || inspection.bytes < 64 || inspection.bytes > 192 * MiB || typeof inspection.header !== 'string' || !/^[a-f0-9]{128}$/u.test(inspection.header)) fail('Candidate compressed runtime differs from pinned Node');
  verifyNodeBytes(Buffer.from(inspection.header, 'hex'), candidateSha256(Buffer.from(inspection.header, 'hex')));
  return { zipBytes, manifest, release };
}

export function parseCandidateArguments(args) {
  const names = { '--node-binary': 'nodeBinary', '--node-sha256': 'expectedNodeSha256', '--source-commit': 'sourceCommit', '--out': 'outputDirectory' }, result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = names[args[index]], value = args[index + 1];
    if (!key || Object.hasOwn(result, key) || !value || value.startsWith('--')) fail('Usage: --node-binary PATH --node-sha256 HEX --source-commit SHA --out EMPTY_DIRECTORY');
    result[key] = value;
  }
  if (Object.keys(result).length !== 4) fail('All four candidate arguments are required');
  return result;
}
