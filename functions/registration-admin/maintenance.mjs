import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { validObjectKey, MAX_OSS_OBJECT_BYTES } from '../cloud-content/oss-client.mjs';
import { PORTRAIT_ID_PATTERN } from '../../shared/portrait-codec.mjs';

const MAGIC = Buffer.from('ARTDICO-BKP1\n');
const MAX_OBJECTS = 5000;
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 40 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/u;
const safe = new WeakSet();
const clone = value => structuredClone(value);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function fail(code = 'MAINTENANCE_FAILED') {
  const error = new Error(code === 'BACKUP_INVALID' ? '备份格式或完整性校验未通过。' : code === 'RESTORE_NOT_EMPTY' ? '隔离恢复位置已有资料，请选择新的恢复标识。' : '私有资料维护未完成。');
  error.code = code; safe.add(error); throw error;
}
async function guarded(action) { try { return await action(); } catch (error) { if (safe.has(error)) throw error; fail(); } }
function privateKey(key) { if (!(key instanceof Uint8Array) || key.byteLength !== 32) fail('BACKUP_INVALID'); return Buffer.from(key); }
function storageKey(key) {
  // Session and login windows are never backed up/restored: recovery must not resurrect revoked sessions.
  return typeof key === 'string' && validObjectKey(key) && key.startsWith('cms/v1/')
    && !/(?:^|\/)(?:sessions|limits|restores)(?:\/|$)/u.test(key);
}
function objectShape(value, key) {
  if (!value || !(value.data instanceof Uint8Array) || !value.data.byteLength || value.data.byteLength > MAX_OSS_OBJECT_BYTES
    || !['Normal', 'Appendable'].includes(value.objectType) || typeof value.contentType !== 'string' || value.contentType.length > 120
    || /[\u0000-\u001f\u007f]/u.test(value.contentType)) fail('BACKUP_INVALID');
  return { key, contentType: value.contentType, objectType: value.objectType, bytes: value.data.byteLength, sha256: hash(value.data), dataBase64: Buffer.from(value.data).toString('base64') };
}
function journalReferences(item) {
  if (!item.key.endsWith('/commits.jsonl')) return [];
  if (item.objectType !== 'Appendable') fail('BACKUP_INVALID');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(item.dataBase64, 'base64')); } catch { fail('BACKUP_INVALID'); }
  if (!text.endsWith('\n')) fail('BACKUP_INVALID');
  const prefix = item.key.slice(0, -'/commits.jsonl'.length), refs = [];
  let previousHash = null;
  for (const [index, line] of text.slice(0, -1).split('\n').entries()) {
    let value;
    try { if (Buffer.byteLength(line) > 512) fail('BACKUP_INVALID'); value = JSON.parse(line); } catch { fail('BACKUP_INVALID'); }
    if (!plain(value) || Object.keys(value).sort().join(',') !== 'hash,previousHash,schemaVersion,valueHash,version'
      || value.schemaVersion !== 1 || value.version !== index + 1 || value.previousHash !== previousHash || !HASH.test(value.valueHash) || !HASH.test(value.hash)) fail('BACKUP_INVALID');
    const fields = { schemaVersion: 1, version: value.version, previousHash, valueHash: value.valueHash };
    if (value.hash !== hash(JSON.stringify(fields)) || line !== JSON.stringify({ ...fields, hash: value.hash })) fail('BACKUP_INVALID');
    previousHash = value.hash;
    refs.push({ key: `${prefix}/blobs/${value.valueHash}.json`, hash: value.valueHash });
  }
  return refs;
}
function objectReferences(item) {
  if (item.key.endsWith('/commits.jsonl')) return journalReferences(item);
  if (item.objectType !== 'Normal' || !/\/blobs\/[a-f0-9]{64}\.json$/u.test(item.key)) return [];
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(item.dataBase64, 'base64'))); } catch { fail('BACKUP_INVALID'); }
  if (!plain(value)) fail('BACKUP_INVALID');
  const refs = [];
  if (value.kind === 'registration_index') {
    const location = item.key.match(/^cms\/v1\/registrations\/([A-Za-z0-9_-]{1,80})\/index\/blobs\/[a-f0-9]{64}\.json$/u);
    if (!location || value.eventId !== location[1] || !Array.isArray(value.entries) || value.entries.length > 1000) fail('BACKUP_INVALID');
    for (const entry of value.entries) {
      if (!plain(entry) || typeof entry.recordHash !== 'string' || !HASH.test(entry.recordHash)) fail('BACKUP_INVALID');
      refs.push({ key: `cms/v1/registrations/${location[1]}/records/${entry.recordHash}.json`, hash: entry.recordHash });
    }
  }
  if (value.kind === 'registration_group_invite') {
    const location = item.key.match(/^cms\/v1\/group-invites\/([A-Za-z0-9_-]{1,80})\/state\/blobs\/[a-f0-9]{64}\.json$/u);
    if (!location || value.eventId !== location[1] || !Array.isArray(value.audit)) fail('BACKUP_INVALID');
    const ids = [value.active?.imageId, ...value.audit.map(entry => entry?.imageId)].filter(value => value !== null && value !== undefined);
    for (const id of ids) {
      if (typeof id !== 'string' || !PORTRAIT_ID_PATTERN.test(id)) fail('BACKUP_INVALID');
      refs.push({ key: `cms/v1/group-invites/${location[1]}/images/${id}`, hash: id.slice(0, 64) });
    }
  }
  if (value.storageVersion === 1 && plain(value.draft) && plain(value.draft.content)) {
    const contents = [value.draft.content, value.published?.content].filter(Boolean);
    for (const content of contents) {
      if (!Array.isArray(content.guests)) fail('BACKUP_INVALID');
      const ids = [...content.guests.map(guest => guest?.portraitId), ...(content.showcases ?? []).map(showcase => showcase?.coverId)];
      for (const id of ids.filter(Boolean)) {
        if (typeof id !== 'string' || !PORTRAIT_ID_PATTERN.test(id)) fail('BACKUP_INVALID');
        refs.push({ key: 'cms/v1/portraits/' + id, hash: id.slice(0, 64) });
      }
    }
    if (!Array.isArray(value.audit)) fail('BACKUP_INVALID');
    for (const entry of value.audit.filter(entry => entry?.action === 'upload_portrait')) {
      if (typeof entry.portraitId !== 'string' || !PORTRAIT_ID_PATTERN.test(entry.portraitId)) fail('BACKUP_INVALID');
      refs.push({ key: 'cms/v1/portraits/' + entry.portraitId, hash: entry.portraitId.slice(0, 64) });
    }
  }
  return refs;
}
function validateManifest(input) {
  if (!plain(input) || Object.keys(input).sort().join(',') !== 'bucket,createdAt,kind,objects,region,schemaVersion' || input.schemaVersion !== 1
    || input.kind !== 'artdico-private-object-backup' || input.bucket !== 'artdicohost-data-hk' || input.region !== 'cn-hongkong'
    || typeof input.createdAt !== 'string' || !Number.isFinite(Date.parse(input.createdAt)) || new Date(input.createdAt).toISOString() !== input.createdAt
    || !Array.isArray(input.objects) || !input.objects.length || input.objects.length > MAX_OBJECTS) fail('BACKUP_INVALID');
  const names = new Set(), byName = new Map(); let total = 0;
  for (const item of input.objects) {
    if (!plain(item) || Object.keys(item).sort().join(',') !== 'bytes,contentType,dataBase64,key,objectType,sha256' || !storageKey(item.key) || names.has(item.key)
      || !['Normal', 'Appendable'].includes(item.objectType) || typeof item.contentType !== 'string' || !item.contentType || item.contentType.length > 120 || /[\u0000-\u001f\u007f]/u.test(item.contentType)
      || !Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > MAX_OSS_OBJECT_BYTES || !HASH.test(item.sha256) || typeof item.dataBase64 !== 'string'
      || item.dataBase64.length > Math.ceil(MAX_OSS_OBJECT_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(item.dataBase64)) fail('BACKUP_INVALID');
    const data = Buffer.from(item.dataBase64, 'base64');
    if (data.toString('base64') !== item.dataBase64 || data.byteLength !== item.bytes || hash(data) !== item.sha256) fail('BACKUP_INVALID');
    total += data.byteLength; if (total > MAX_TOTAL_BYTES) fail('BACKUP_INVALID');
    names.add(item.key); byName.set(item.key, item);
  }
  for (const item of input.objects) for (const ref of objectReferences(item)) {
    const blob = byName.get(ref.key);
    if (!blob || blob.objectType !== 'Normal' || blob.sha256 !== ref.hash) fail('BACKUP_INVALID');
  }
  return { manifest: input, totalBytes: total, objectCount: input.objects.length, manifestHash: hash(JSON.stringify(input)) };
}

export function generateBackupKey() { return randomBytes(32); }

/** The caller supplies an explicit object inventory; no List/Delete permission or data discovery is added. */
export async function createEncryptedObjectBackup({ objects, keys, key, clock = Date.now } = {}) {
  return guarded(async () => {
    if (typeof objects?.get !== 'function' || !Array.isArray(keys) || !keys.length || keys.length > MAX_OBJECTS || keys.some(value => !storageKey(value)) || new Set(keys).size !== keys.length || typeof clock !== 'function') fail('BACKUP_INVALID');
    const encryptionKey = privateKey(key), now = clock();
    if (!Number.isSafeInteger(now) || now < 0) fail('BACKUP_INVALID');
    const entries = []; let bytes = 0;
    for (const name of [...keys].sort()) {
      const item = objectShape(await objects.get(name, { maxBytes: MAX_OSS_OBJECT_BYTES }), name);
      bytes += item.bytes; if (bytes > MAX_TOTAL_BYTES) fail('BACKUP_INVALID'); entries.push(item);
    }
    // Detect concurrent journal or mutable object changes after the inventory read.
    for (const item of entries) {
      const again = objectShape(await objects.get(item.key, { maxBytes: MAX_OSS_OBJECT_BYTES }), item.key);
      if (again.sha256 !== item.sha256 || again.objectType !== item.objectType || again.contentType !== item.contentType) fail('BACKUP_INVALID');
    }
    const payload = { schemaVersion: 1, kind: 'artdico-private-object-backup', createdAt: new Date(now).toISOString(), bucket: 'artdicohost-data-hk', region: 'cn-hongkong', objects: entries };
    const checked = validateManifest(payload), plaintext = Buffer.from(JSON.stringify(payload));
    if (plaintext.length > MAX_BUNDLE_BYTES) fail('BACKUP_INVALID');
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce);
    cipher.setAAD(MAGIC);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const bundle = Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), encrypted]);
    return { bundle, objectCount: checked.objectCount, totalBytes: checked.totalBytes, manifestHash: checked.manifestHash,
      backupHash: hash(bundle), encrypted: true, independentBackup: false };
  });
}

/** Return only a summary by default. Passing includeObjects exposes private bytes to the trusted caller. */
export function inspectEncryptedObjectBackup({ bundle, key, includeObjects = false } = {}) {
  try {
    if (!(bundle instanceof Uint8Array) || bundle.byteLength <= MAGIC.length + 28 || bundle.byteLength > MAX_BUNDLE_BYTES + MAGIC.length + 28 || typeof includeObjects !== 'boolean') fail('BACKUP_INVALID');
    const bytes = Buffer.from(bundle);
    if (!bytes.subarray(0, MAGIC.length).equals(MAGIC)) fail('BACKUP_INVALID');
    const nonce = bytes.subarray(MAGIC.length, MAGIC.length + 12), tag = bytes.subarray(MAGIC.length + 12, MAGIC.length + 28);
    const decipher = createDecipheriv('aes-256-gcm', privateKey(key), nonce); decipher.setAAD(MAGIC); decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(bytes.subarray(MAGIC.length + 28)), decipher.final()]);
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)); } catch { fail('BACKUP_INVALID'); }
    const checked = validateManifest(value);
    return { valid: true, objectCount: checked.objectCount, totalBytes: checked.totalBytes, createdAt: value.createdAt, manifestHash: checked.manifestHash,
      backupHash: hash(bytes), ...(includeObjects ? { objects: clone(value.objects) } : {}) };
  } catch (error) { if (safe.has(error)) throw error; fail('BACKUP_INVALID'); }
}

/** Derive all immutable journal snapshots from verified append logs, without bucket listing. */
export async function collectJournalBackupKeys({ objects, journalPrefixes, additionalKeys = [] } = {}) {
  return guarded(async () => {
    if (typeof objects?.get !== 'function' || !Array.isArray(journalPrefixes) || !journalPrefixes.length || journalPrefixes.length > 100
      || journalPrefixes.some(prefix => !storageKey(prefix + '/commits.jsonl')) || new Set(journalPrefixes).size !== journalPrefixes.length
      || !Array.isArray(additionalKeys) || additionalKeys.some(value => !storageKey(value))) fail('BACKUP_INVALID');
    const keys = new Set(additionalKeys);
    for (const prefix of journalPrefixes) {
      const name = prefix + '/commits.jsonl';
      const object = await objects.get(name, { maxBytes: MAX_OSS_OBJECT_BYTES });
      if (object === null) continue;
      const item = objectShape(object, name); keys.add(name);
      for (const ref of journalReferences(item)) keys.add(ref.key);
    }
    // Follow current and historical snapshot references to accepted records and portraits.
    // Do not infer objects by listing the bucket or by arbitrary JSON URL fields.
    let examined = 0, totalBytes = 0;
    const pending = [...keys], visited = new Set();
    while (pending.length) {
      const name = pending.shift();
      if (visited.has(name)) continue;
      if (++examined > MAX_OBJECTS) fail('BACKUP_INVALID');
      visited.add(name);
      const item = objectShape(await objects.get(name, { maxBytes: MAX_OSS_OBJECT_BYTES }), name);
      totalBytes += item.bytes; if (totalBytes > MAX_TOTAL_BYTES) fail('BACKUP_INVALID');
      for (const ref of objectReferences(item)) if (!keys.has(ref.key)) { keys.add(ref.key); pending.push(ref.key); }
    }
    if (!keys.size) fail('NO_BACKUP_DATA');
    if (keys.size > MAX_OBJECTS) fail('BACKUP_INVALID');
    return [...keys].sort();
  });
}

/** Never selects a live prefix or activates recovered data. Partial/unknown writes fail without retry. */
export async function restoreEncryptedBackupIsolated({ objects, bundle, key, restoreId } = {}) {
  return guarded(async () => {
    if (!objects || !['get', 'putImmutable', 'append'].every(name => typeof objects[name] === 'function') || typeof restoreId !== 'string' || !/^[a-z0-9][a-z0-9-]{7,79}$/u.test(restoreId)) fail('BACKUP_INVALID');
    const checked = inspectEncryptedObjectBackup({ bundle, key, includeObjects: true });
    const namespace = `cms/v1/restores/${restoreId}`;
    const entries = checked.objects.map(item => ({ ...item, destination: namespace + '/' + item.key.slice('cms/v1/'.length) }));
    for (const item of entries) if (await objects.get(item.destination, { maxBytes: MAX_OSS_OBJECT_BYTES }) !== null) fail('RESTORE_NOT_EMPTY');
    // Immutable snapshots first; append logs commit the restored view last.
    entries.sort((a, b) => Number(a.objectType === 'Appendable') - Number(b.objectType === 'Appendable') || a.destination.localeCompare(b.destination));
    for (const item of entries) {
      const data = Buffer.from(item.dataBase64, 'base64');
      if (item.objectType === 'Appendable') {
        const ack = await objects.append(item.destination, 0, data);
        if (ack?.nextPosition !== data.length) fail();
      } else await objects.putImmutable(item.destination, data, { contentType: item.contentType });
      const result = await objects.get(item.destination, { maxBytes: MAX_OSS_OBJECT_BYTES });
      if (!result || !(result.data instanceof Uint8Array) || result.objectType !== item.objectType || hash(result.data) !== item.sha256) fail();
    }
    return { restored: true, active: false, sessionsRestored: false, namespace, objectCount: entries.length, manifestHash: checked.manifestHash };
  });
}
