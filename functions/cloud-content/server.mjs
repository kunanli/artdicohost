import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, parse, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCloudContentRuntime } from './runtime.mjs';
import { createCloudContentServer, isCloudAdminAssetUrl } from './http-server.mjs';

const MiB = 1024 * 1024;
const NODE = Object.freeze({ version: 'v24.19.0', platform: 'linux', arch: 'x64', sha256: 'bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12' });
const REQUIRED = ['/admin/', '/admin/contacts/', '/invitations/template-blank.png'];
const failure = () => new Error('Cloud content package verification failed.');
const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const safePath = path => typeof path === 'string' && path.length <= 256 && /^[A-Za-z0-9_.\/-]+$/u.test(path)
  && !path.startsWith('/') && path.split('/').every(segment => segment && segment !== '.' && segment !== '..');

function validRecord(record) {
  return exactKeys(record, ['path', 'bytes', 'sha256', 'mode']) && safePath(record.path)
    && Number.isSafeInteger(record.bytes) && record.bytes > 0 && record.bytes <= 36_000_000
    && typeof record.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(record.sha256) && ['0644', '0755'].includes(record.mode);
}

/** Reads only a fixed regular path, rejecting symlinks in every parent. */
async function regularBytes(path, limit, mode) {
  const absolute = resolve(path), root = parse(absolute).root;
  let current = root;
  const parts = absolute.slice(root.length).split(sep).filter(Boolean);
  for (let index = 0; index < parts.length; index++) {
    current = resolve(current, parts[index]);
    const info = await lstat(current);
    if (info.isSymbolicLink() || index < parts.length - 1 && !info.isDirectory()) throw failure();
  }
  const file = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size <= 0 || info.size > limit || mode && (info.mode & 0o777) !== parseInt(mode, 8)) throw failure();
    const bytes = await file.readFile();
    const after = await file.stat();
    if (bytes.length !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs) throw failure();
    return bytes;
  } finally { await file.close(); }
}

function assetPath(url) {
  if (url === '/admin/') return 'admin-assets/admin/index.html';
  if (url === '/admin/contacts/') return 'admin-assets/admin/contacts/index.html';
  return 'admin-assets' + url;
}

/** Read a verified package's explicit static manifest. Never enumerate a directory or read configuration files. */
export async function loadCloudContentRelease({ codeDirectory } = {}) {
  try {
    if (typeof codeDirectory !== 'string' || !codeDirectory) throw failure();
    const root = resolve(codeDirectory);
    const release = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await regularBytes(resolve(root, 'release.json'), 64 * 1024, '0644')));
    if (!exactKeys(release, ['schemaVersion', 'kind', 'sourceCommit', 'node', 'files', 'assets'])
      || release.schemaVersion !== 1 || release.kind !== 'fc-cloud-content-candidate' || typeof release.sourceCommit !== 'string' || !/^[a-f0-9]{40}$/u.test(release.sourceCommit)
      || !exactKeys(release.node, Object.keys(NODE)) || Object.keys(NODE).some(key => release.node[key] !== NODE[key])
      || !Array.isArray(release.files) || release.files.length > 100 || !release.files.every(validRecord)
      || new Set(release.files.map(file => file.path)).size !== release.files.length
      || !Array.isArray(release.assets) || release.assets.length > 40 || release.assets.length < REQUIRED.length) throw failure();
    const records = new Map(release.files.map(file => [file.path, file]));
    const assets = new Map(); let total = 0;
    for (const asset of release.assets) {
      if (!exactKeys(asset, ['url', 'path', 'bytes', 'sha256', 'mode']) || !isCloudAdminAssetUrl(asset.url)
        || asset.path !== assetPath(asset.url) || asset.mode !== '0644' || assets.has(asset.url)
        || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || asset.bytes > 2 * MiB || (total += asset.bytes) > 8 * MiB
        || typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(asset.sha256)) throw failure();
      const record = records.get(asset.path);
      if (!record || ['path', 'bytes', 'sha256', 'mode'].some(key => record[key] !== asset[key])) throw failure();
      const bytes = await regularBytes(resolve(root, asset.path), asset.bytes, '0644');
      if (bytes.length !== asset.bytes || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw failure();
      assets.set(asset.url, bytes);
    }
    if (REQUIRED.some(path => !assets.has(path))) throw failure();
    return { sourceCommit: release.sourceCommit, assets };
  } catch { throw failure(); }
}

/** Factory only: importing this module never reads files, creates credentials or opens a port. */
export async function createProductionCloudServer({ codeDirectory, env = process.env, fetchFn } = {}) {
  const { sourceCommit, assets } = await loadCloudContentRelease({ codeDirectory });
  const runtime = createCloudContentRuntime({ env, fetchFn });
  return createCloudContentServer({ runtime, sourceCommit, assets });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const server = await createProductionCloudServer({ codeDirectory: resolve(dirname(fileURLToPath(import.meta.url)), '../..') });
    server.on('error', () => { process.stderr.write('Cloud content server could not start.\n'); process.exitCode = 1; });
    server.listen(9000, '0.0.0.0');
  } catch { process.stderr.write('Cloud content package verification failed.\n'); process.exitCode = 1; }
}
