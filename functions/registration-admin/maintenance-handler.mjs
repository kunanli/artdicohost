import { isDeepStrictEqual } from 'node:util';
import { equalToken } from '../content-api/auth.mjs';
import { CloudContentError } from '../cloud-content/errors.mjs';
import { createEncryptedObjectBackup, collectJournalBackupKeys, inspectEncryptedObjectBackup, restoreEncryptedBackupIsolated } from './maintenance.mjs';

export const MAX_MAINTENANCE_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_BROWSER_BACKUP_BYTES = 1_500_000;
const ORIGIN = 'https://api.artdico.host';
const SECURITY = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
const HASH = /^[a-f0-9]{64}$/u;
const ACTOR = /^[A-Za-z0-9_-]{1,80}$/u;
const RESTORE_ID = /^[a-z0-9][a-z0-9-]{7,79}$/u;
const JOURNAL_PREFIX = /^cms\/v1\/(?:content|contacts|intent-invitations|maintenance|registrations\/[A-Za-z0-9_-]{1,80}\/index|registration-reviews\/[A-Za-z0-9_-]{1,80}|group-invites\/[A-Za-z0-9_-]{1,80}\/state)$/u;
const EXTRA_KEY = /^cms\/v1\/(?:portraits\/[a-f0-9]{64}\.(?:png|jpg|webp)|group-invites\/[A-Za-z0-9_-]{1,80}\/images\/[a-f0-9]{64}\.(?:png|jpg|webp))$/u;
const safe = new WeakSet();
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const shape = (value, fields) => plain(value) && Object.keys(value).sort().join(',') === [...fields].sort().join(',');
function failure(code = 'MAINTENANCE_UNAVAILABLE') {
  const specs = {
    AUTH_REQUIRED: [401, '会话已结束，请重新登录。'], FORBIDDEN: [403, '当前账号没有此操作权限。'], ORIGIN_REJECTED: [403, '请求来源不被允许。'],
    CSRF_REJECTED: [403, '安全校验未通过，请重新载入后台。'], INVALID_REQUEST: [400, '维护请求格式无效。'],
    BACKUP_INVALID: [422, '备份密钥、格式或完整性校验未通过。'], RESTORE_NOT_EMPTY: [409, '隔离恢复位置已有资料，请选择新的恢复标识。'],
    MAINTENANCE_TOO_LARGE: [413, '资料超过浏览器维护上限，请使用受控离线维护工具。'], NOT_FOUND: [404, '维护接口不存在。'],
    NO_BACKUP_DATA: [409, '当前没有可备份的已保存资料。'], MAINTENANCE_NOT_READY: [503, '私有资料维护尚未开放。'],
    MAINTENANCE_UNAVAILABLE: [503, '私有资料维护未完成，请重新检查当前状态。'],
  };
  const [status, message] = specs[code] ?? specs.MAINTENANCE_UNAVAILABLE;
  const error = new Error(message); error.code = Object.hasOwn(specs, code) ? code : 'MAINTENANCE_UNAVAILABLE'; error.status = status; safe.add(error); return error;
}
function fail(code) { throw failure(code); }
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { ...SECURITY, 'content-type': 'application/json; charset=utf-8' } }); }
function timestamp(clock) { const value = clock(); if (!Number.isSafeInteger(value) || value < 0) fail(); return new Date(value).toISOString(); }
const canonicalTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

/** Minimal durable operation audit: never stores request bodies, encryption keys or private object names. */
export function createMaintenanceAuditStore({ journal, clock = Date.now } = {}) {
  if (!journal || !['read', 'commit'].every(name => typeof journal[name] === 'function') || typeof clock !== 'function') throw new TypeError('维护审计依赖未配置。');
  async function read() {
    try {
      const state = await journal.read();
      const value = state.value ?? { schemaVersion: 1, revision: 0, entries: [] };
      if (!shape(value, ['schemaVersion', 'revision', 'entries']) || value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0
        || !Array.isArray(value.entries) || value.entries.length !== value.revision || value.entries.length > 1000 || state.cursor?.version !== value.revision) fail();
      let previous = ''; const pending = new Map();
      for (const [index, entry] of value.entries.entries()) {
        if (!shape(entry, ['revision', 'action', 'phase', 'actorId', 'at', 'manifestHash', 'backupHash', 'objectCount', 'restoreId'])
          || entry.revision !== index + 1 || !['backup', 'restore'].includes(entry.action) || !['started', 'completed'].includes(entry.phase)
          || entry.action === 'backup' && entry.phase !== 'completed' || typeof entry.actorId !== 'string' || !ACTOR.test(entry.actorId) || !canonicalTime(entry.at) || entry.at < previous
          || typeof entry.manifestHash !== 'string' || !HASH.test(entry.manifestHash) || typeof entry.backupHash !== 'string' || !HASH.test(entry.backupHash)
          || !Number.isSafeInteger(entry.objectCount) || entry.objectCount < 1 || entry.objectCount > 5000
          || entry.action === 'backup' && entry.restoreId !== null || entry.action === 'restore' && (typeof entry.restoreId !== 'string' || !RESTORE_ID.test(entry.restoreId))) fail();
        previous = entry.at;
        if (entry.action === 'restore') {
          const operation = [entry.restoreId, entry.manifestHash, entry.backupHash, entry.actorId].join(':');
          const count = pending.get(operation) ?? 0;
          if (entry.phase === 'completed' && !count) fail();
          pending.set(operation, count + (entry.phase === 'started' ? 1 : -1));
        }
      }
      return { value, cursor: state.cursor };
    } catch (error) { if (safe.has(error)) throw error; fail(); }
  }
  return Object.freeze({
    async record(input) {
      try {
        if (!shape(input, ['action', 'phase', 'actorId', 'manifestHash', 'backupHash', 'objectCount', 'restoreId'])) fail('INVALID_REQUEST');
        const state = await read();
        if (state.value.entries.length >= 1000) fail();
        const at = timestamp(clock);
        if (at < (state.value.entries.at(-1)?.at ?? '')) fail();
        const entry = { revision: state.value.revision + 1, ...input, at };
        const next = { schemaVersion: 1, revision: entry.revision, entries: [...state.value.entries, entry] };
        // Validate the newly assembled state with the same reader before committing it.
        const checked = createMaintenanceAuditStore({ journal: { read: async () => ({ value: next, cursor: { version: next.revision } }), commit() {} }, clock });
        await checked.readSafe();
        const saved = await journal.commit(state.cursor, next);
        if (!isDeepStrictEqual(saved?.value, next) || saved.cursor?.version !== next.revision) fail();
        return { revision: next.revision };
      } catch (error) { if (safe.has(error)) throw error; fail(); }
    },
    async readSafe() {
      const { value } = await read();
      return { count: value.revision, lastBackupAt: value.entries.findLast(entry => entry.action === 'backup' && entry.phase === 'completed')?.at ?? null,
        lastRestoreAt: value.entries.findLast(entry => entry.action === 'restore' && entry.phase === 'completed')?.at ?? null,
        incompleteRestoreCount: value.entries.filter(entry => entry.action === 'restore' && entry.phase === 'started').length - value.entries.filter(entry => entry.action === 'restore' && entry.phase === 'completed').length };
    },
  });
}

async function readBody(request, limit) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/iu.test(request.headers.get('content-type') ?? '') || ![null, 'identity'].includes(request.headers.get('content-encoding'))) fail('INVALID_REQUEST');
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/u.test(length) || !Number.isSafeInteger(Number(length)))) fail('INVALID_REQUEST');
  if (Number(length) > limit) fail('MAINTENANCE_TOO_LARGE');
  const reader = request.body?.getReader(), chunks = [];
  let bytes = 0, onAbort;
  const timeout = new AbortController(), signal = AbortSignal.any([request.signal, timeout.signal]);
  const aborted = new Promise((_, reject) => { onAbort = () => { reader?.cancel().catch(() => {}); reject(failure('INVALID_REQUEST')); }; signal.addEventListener('abort', onAbort, { once: true }); });
  const timer = setTimeout(() => timeout.abort(), 10_000); timer.unref();
  try {
    if (signal.aborted) fail('INVALID_REQUEST');
    if (reader) while (true) {
      const next = await Promise.race([reader.read(), aborted]);
      if (next.done) break;
      bytes += next.value.byteLength; if (bytes > limit) fail('MAINTENANCE_TOO_LARGE'); chunks.push(next.value);
    }
    if (length !== null && Number(length) !== bytes) fail('INVALID_REQUEST');
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    if (!plain(value)) fail('INVALID_REQUEST'); return value;
  } catch (error) { if (safe.has(error)) throw error; fail('INVALID_REQUEST'); }
  finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); if (reader) { reader.cancel().catch(() => {}); reader.releaseLock(); } }
}
function encryptionKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(value)) fail('BACKUP_INVALID');
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== 32 || bytes.toString('base64url') !== value) fail('BACKUP_INVALID'); return bytes;
}

/** Superadmin operation boundary; the browser retains its separately saved key and receives encrypted bytes only. */
export function createMaintenanceApi({ enabled = false, auth, objects, journalPrefixes = [], additionalKeys = [], audit, clock = Date.now } = {}) {
  if (typeof enabled !== 'boolean' || typeof clock !== 'function' || !Array.isArray(journalPrefixes) || journalPrefixes.some(prefix => typeof prefix !== 'string' || !JOURNAL_PREFIX.test(prefix))
    || !Array.isArray(additionalKeys) || additionalKeys.some(key => typeof key !== 'string' || !EXTRA_KEY.test(key))) throw new TypeError('维护配置无效。');
  if (enabled && (!journalPrefixes.length || typeof auth?.authenticate !== 'function' || !objects || !['get', 'putImmutable', 'append'].every(name => typeof objects[name] === 'function')
    || !['record', 'readSafe'].every(name => typeof audit?.[name] === 'function'))) throw new TypeError('维护依赖未配置。');
  journalPrefixes = Object.freeze([...journalPrefixes]);
  additionalKeys = Object.freeze([...additionalKeys]);
  const allowedRestoreKey = key => journalPrefixes.some(prefix => key === prefix + '/commits.jsonl' || key.startsWith(prefix + '/blobs/') && /^[a-f0-9]{64}\.json$/u.test(key.slice((prefix + '/blobs/').length))
    || prefix.endsWith('/index') && key.startsWith(prefix.slice(0, -'/index'.length) + '/records/') && /^[a-f0-9]{64}\.json$/u.test(key.slice((prefix.slice(0, -'/index'.length) + '/records/').length))
    || prefix.includes('/group-invites/') && prefix.endsWith('/state') && key.startsWith(prefix.slice(0, -'/state'.length) + '/images/') && /^[a-f0-9]{64}\.(?:png|jpg|webp)$/u.test(key.slice((prefix.slice(0, -'/state'.length) + '/images/').length)))
    || /^cms\/v1\/portraits\/[a-f0-9]{64}\.(?:png|jpg|webp)$/u.test(key) || additionalKeys.includes(key);
  return async function handle(request) {
    let key;
    try {
      const url = new URL(request.url);
      if (url.origin !== ORIGIN || url.username || url.password || url.hash || url.search) fail('ORIGIN_REJECTED');
      if (!enabled) fail('MAINTENANCE_NOT_READY');
      const origin = request.headers.get('origin');
      if (origin !== null && origin !== ORIGIN || request.method === 'POST' && origin !== ORIGIN) fail('ORIGIN_REJECTED');
      const session = await auth.authenticate(request);
      if (!session?.user?.roles?.includes('superadmin')) fail('FORBIDDEN');
      if (request.method === 'POST' && !equalToken(request.headers.get('x-csrf-token'), session.csrfToken)) fail('CSRF_REJECTED');
      if (url.pathname === '/api/admin/maintenance' && request.method === 'GET') return json({ enabled: true,
        backup: { available: true, maxEncryptedBytes: MAX_BROWSER_BACKUP_BYTES, confirmation: 'CREATE_ENCRYPTED_BACKUP', journalCount: journalPrefixes.length, accountDirectoryIncluded: false },
        restore: { isolatedOnly: true, maxEncryptedBytes: MAX_BROWSER_BACKUP_BYTES, confirmation: 'RESTORE_TO_ISOLATED_NAMESPACE' }, sessionsRestored: false, audit: await audit.readSafe() });
      if (!['/api/admin/maintenance/backup', '/api/admin/maintenance/restore'].includes(url.pathname) || request.method !== 'POST') fail('NOT_FOUND');
      const restoring = url.pathname.endsWith('/restore');
      const input = await readBody(request, restoring ? MAX_MAINTENANCE_BODY_BYTES : 4096);
      if (!shape(input, restoring ? ['encryptionKey', 'bundleBase64', 'restoreId', 'confirmation'] : ['encryptionKey', 'confirmation'])
        || input.confirmation !== (restoring ? 'RESTORE_TO_ISOLATED_NAMESPACE' : 'CREATE_ENCRYPTED_BACKUP')) fail('INVALID_REQUEST');
      key = encryptionKey(input.encryptionKey);
      if (!restoring) {
        const keys = await collectJournalBackupKeys({ objects, journalPrefixes, additionalKeys });
        const result = await createEncryptedObjectBackup({ objects, keys, key, clock });
        if (result.bundle.length > MAX_BROWSER_BACKUP_BYTES) fail('MAINTENANCE_TOO_LARGE');
        await audit.record({ action: 'backup', phase: 'completed', actorId: session.user.id, manifestHash: result.manifestHash, backupHash: result.backupHash, objectCount: result.objectCount, restoreId: null });
        return new Response(result.bundle, { headers: { ...SECURITY, 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="artdico-private-backup.bin"',
          'content-length': String(result.bundle.length), 'x-backup-sha256': result.backupHash, 'x-backup-manifest-sha256': result.manifestHash, 'x-backup-object-count': String(result.objectCount) } });
      }
      if (typeof input.restoreId !== 'string' || !RESTORE_ID.test(input.restoreId) || typeof input.bundleBase64 !== 'string' || !input.bundleBase64
        || input.bundleBase64.length > Math.ceil(MAX_BROWSER_BACKUP_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(input.bundleBase64)) fail('BACKUP_INVALID');
      const bundle = Buffer.from(input.bundleBase64, 'base64');
      if (bundle.toString('base64') !== input.bundleBase64 || bundle.length > MAX_BROWSER_BACKUP_BYTES) fail('BACKUP_INVALID');
      const inspection = inspectEncryptedObjectBackup({ bundle, key, includeObjects: true });
      if (inspection.objects.some(object => !allowedRestoreKey(object.key))) fail('BACKUP_INVALID');
      const log = { action: 'restore', actorId: session.user.id, manifestHash: inspection.manifestHash, backupHash: inspection.backupHash, objectCount: inspection.objectCount, restoreId: input.restoreId };
      await audit.record({ ...log, phase: 'started' });
      const result = await restoreEncryptedBackupIsolated({ objects, bundle, key, restoreId: input.restoreId });
      await audit.record({ ...log, phase: 'completed' });
      return json(result);
    } catch (error) {
      if (error instanceof CloudContentError && error.code === 'AUTH_REQUIRED' && error.status === 401) error = failure('AUTH_REQUIRED');
      if (!safe.has(error) && ['BACKUP_INVALID', 'RESTORE_NOT_EMPTY', 'NO_BACKUP_DATA'].includes(error?.code)) error = failure(error.code);
      const safeError = safe.has(error) ? error : failure();
      return json({ error: { code: safeError.code, message: safeError.message } }, safeError.status);
    } finally { key?.fill(0); }
  };
}
