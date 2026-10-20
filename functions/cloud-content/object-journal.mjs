import { createHash } from 'node:crypto';
import { CloudContentError } from './errors.mjs';
import { validObjectKey, MAX_OSS_OBJECT_BYTES } from './oss-client.mjs';

const HASH = /^[a-f0-9]{64}$/u;
const MAX_VALUE_BYTES = 1024 * 1024;
const MAX_RECORD_BYTES = 512;
const hash = data => createHash('sha256').update(data).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const safeErrors = new WeakSet();
function failure(code = 'STORAGE_UNAVAILABLE', status = 503) {
  const message = code === 'WRITE_CONFLICT' ? '资料已被更新，请重新载入后再决定。' : '云端储存暂时不可用，请稍后重新载入。';
  const error = new CloudContentError(code, message, status); safeErrors.add(error); return error;
}
function jsonBytes(value, maxBytes) {
  const seen = new WeakSet();
  let budget = 0;
  function visit(item, depth = 0) {
    if (depth > 64) throw failure();
    if (item === null || typeof item === 'string' || typeof item === 'boolean') { budget += typeof item === 'string' ? Buffer.byteLength(item) : 4; if (budget > maxBytes) throw failure(); return; }
    if (typeof item === 'number') { if (!Number.isFinite(item)) throw failure(); budget += String(item).length; if (budget > maxBytes) throw failure(); return; }
    if (typeof item !== 'object' || !(Array.isArray(item) || plain(item)) || seen.has(item)) throw failure();
    seen.add(item);
    if (Object.getOwnPropertySymbols(item).length) throw failure();
    if (Object.getOwnPropertyNames(item).length !== Object.keys(item).length + (Array.isArray(item) ? 1 : 0)) throw failure();
    for (const key of Object.keys(item)) {
      budget += Buffer.byteLength(key) + 2;
      if (budget > maxBytes) throw failure();
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !('value' in descriptor) || ['__proto__', 'constructor', 'prototype'].includes(key)) throw failure();
      visit(descriptor.value, depth + 1);
    }
    // JSON must not silently turn holes into null or omit named array properties.
    if (Array.isArray(item) && (Object.keys(item).length !== item.length || Object.keys(item).some(key => !/^(?:0|[1-9]\d*)$/u.test(key)))) throw failure();
    seen.delete(item);
  }
  if (!plain(value)) throw failure();
  visit(value);
  const bytes = Buffer.from(JSON.stringify(value), 'utf8');
  if (!bytes.byteLength || bytes.byteLength > maxBytes) throw failure();
  return bytes;
}
function parseJson(data, maxBytes) {
  if (!(data instanceof Uint8Array) || !data.byteLength || data.byteLength > maxBytes) throw failure();
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)); } catch { throw failure(); }
  jsonBytes(value, maxBytes);
  return value;
}
function validCursor(value) {
  return plain(value) && Object.keys(value).sort().join(',') === 'hash,position,version'
    && Object.keys(value).every(key => 'value' in Object.getOwnPropertyDescriptor(value, key))
    && Number.isSafeInteger(value.position) && value.position >= 0 && Number.isSafeInteger(value.version) && value.version >= 0
    && (value.version === 0 ? value.position === 0 && value.hash === null : value.position > 0 && typeof value.hash === 'string' && HASH.test(value.hash));
}
const emptyCursor = () => ({ position: 0, version: 0, hash: null });
const reference = (version, previousHash, valueHash) => ({ schemaVersion: 1, version, previousHash, valueHash });
const cursorMatches = (a, b) => a.position === b.position && a.version === b.version && a.hash === b.hash;

/** Immutable values plus one bounded atomic append commit point. No mutable head or local lock. */
export function createObjectJournal({ objects, prefix, maxValueBytes = MAX_VALUE_BYTES, maxLogBytes = 2 * 1024 * 1024 } = {}) {
  if (!objects || !['get', 'putImmutable', 'append'].every(name => typeof objects[name] === 'function')
    || !validObjectKey(prefix) || !validObjectKey(prefix + '/commits.jsonl') || !validObjectKey(prefix + '/blobs/' + 'a'.repeat(64) + '.json')
    || !Number.isSafeInteger(maxValueBytes) || maxValueBytes < 1 || maxValueBytes > MAX_VALUE_BYTES
    || !Number.isSafeInteger(maxLogBytes) || maxLogBytes < 1 || maxLogBytes > MAX_OSS_OBJECT_BYTES) throw failure();
  const logKey = prefix + '/commits.jsonl';
  async function storage(operation) {
    try { return await operation(); }
    catch (error) { if (safeErrors.has(error)) throw error; if (error instanceof CloudContentError && error.code === 'WRITE_CONFLICT' && error.status === 409) throw failure('WRITE_CONFLICT', 409); throw failure(); }
  }
  async function log() {
    const object = await storage(() => objects.get(logKey, { maxBytes: maxLogBytes }));
    if (object === null) return { cursor: emptyCursor(), entries: [] };
    if (!object || object.objectType !== 'Appendable' || !(object.data instanceof Uint8Array) || !object.data.byteLength || object.data.byteLength > maxLogBytes) throw failure();
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(object.data); } catch { throw failure(); }
    if (!text.endsWith('\n') || !Buffer.from(text).equals(object.data)) throw failure();
    const lines = text.slice(0, -1).split('\n'), entries = [];
    let previous = null;
    for (let index = 0; index < lines.length; index++) {
      const bytes = Buffer.from(lines[index]);
      if (bytes.byteLength > MAX_RECORD_BYTES) throw failure();
      const entry = parseJson(bytes, MAX_RECORD_BYTES);
      if (Object.keys(entry).sort().join(',') !== 'hash,previousHash,schemaVersion,valueHash,version'
        || entry.schemaVersion !== 1 || entry.version !== index + 1 || entry.previousHash !== previous
        || typeof entry.valueHash !== 'string' || !HASH.test(entry.valueHash) || typeof entry.hash !== 'string' || !HASH.test(entry.hash)
        || entry.hash !== hash(JSON.stringify(reference(entry.version, entry.previousHash, entry.valueHash)))) throw failure();
      if (lines[index] !== JSON.stringify({ ...reference(entry.version, entry.previousHash, entry.valueHash), hash: entry.hash })) throw failure();
      previous = entry.hash; entries.push(entry);
    }
    return { cursor: { position: object.data.byteLength, version: entries.length, hash: previous }, entries };
  }
  async function read() {
    return storage(async () => {
      const current = await log();
      if (!current.entries.length) return { value: null, cursor: Object.freeze(current.cursor) };
      const latest = current.entries.at(-1), blob = await objects.get(`${prefix}/blobs/${latest.valueHash}.json`, { maxBytes: maxValueBytes });
      if (!blob || !(blob.data instanceof Uint8Array) || hash(blob.data) !== latest.valueHash) throw failure();
      return { value: parseJson(blob.data, maxValueBytes), cursor: Object.freeze(current.cursor) };
    });
  }
  return {
    read,
    async commit(cursor, value) {
      return storage(async () => {
        if (!validCursor(cursor) || cursor.position > maxLogBytes || cursor.version >= Number.MAX_SAFE_INTEGER) throw failure('WRITE_CONFLICT', 409);
        const expected = { position: cursor.position, version: cursor.version, hash: cursor.hash };
        const data = jsonBytes(value, maxValueBytes), valueHash = hash(data);
        // Re-read before staging a value so fabricated or already stale cursors
        // cannot append a broken chain; the append position handles later races.
        const before = await read();
        if (!cursorMatches(expected, before.cursor)) throw failure('WRITE_CONFLICT', 409);
        const fields = reference(expected.version + 1, expected.hash, valueHash), entry = { ...fields, hash: hash(JSON.stringify(fields)) };
        const record = Buffer.from(JSON.stringify(entry) + '\n');
        if (record.byteLength > MAX_RECORD_BYTES || expected.position + record.byteLength > maxLogBytes) throw failure();
        const blobKey = `${prefix}/blobs/${valueHash}.json`;
        await objects.putImmutable(blobKey, data, { contentType: 'application/json' });
        const saved = await objects.get(blobKey, { maxBytes: maxValueBytes });
        if (!saved || !(saved.data instanceof Uint8Array) || saved.data.byteLength !== data.byteLength || hash(saved.data) !== valueHash) throw failure();
        const ack = await objects.append(logKey, expected.position, record);
        const nextPosition = expected.position + record.byteLength;
        if (ack?.nextPosition !== nextPosition) throw failure();
        const after = await log(), committed = after.entries[expected.version];
        // Later writers may have committed too. Verify our exact entry rather
        // than claiming their newer value or requiring ourselves to stay latest.
        if (!committed || committed.hash !== entry.hash || after.cursor.position < nextPosition) throw failure();
        return { value: parseJson(data, maxValueBytes), cursor: Object.freeze({ position: nextPosition, version: entry.version, hash: entry.hash }) };
      });
    },
  };
}
