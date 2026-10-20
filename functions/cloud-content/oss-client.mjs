import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { CloudContentError } from './errors.mjs';

export const OSS_BUCKET = 'artdicohost-data-hk';
export const OSS_REGION = 'cn-hongkong';
export const OSS_ORIGIN = `https://${OSS_BUCKET}.oss-cn-hongkong.aliyuncs.com`;
export const MAX_OSS_OBJECT_BYTES = 4 * 1024 * 1024;
const MAX_WRITE_BYTES = 1024 * 1024;
const MAX_ERROR_BYTES = 16 * 1024;
const TYPES = new Set(['application/json', 'application/x-ndjson', 'application/octet-stream', 'image/jpeg', 'image/png', 'image/webp']);
const IMMUTABLE_TYPES = { json: 'application/json', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const OBJECT_TYPES = new Set(['Normal', 'Appendable', 'Multipart']);
const safeErrors = new WeakSet();
const hash = data => createHash('sha256').update(data).digest('hex');
function failure(code = 'STORAGE_UNAVAILABLE', status = 503) {
  const message = code === 'WRITE_CONFLICT' ? '资料已被更新，请重新载入后再决定。' : '云端储存暂时不可用，请稍后重新载入。';
  const error = new CloudContentError(code, message, status);
  safeErrors.add(error);
  return error;
}
export function validObjectKey(key) {
  return typeof key === 'string' && key.length <= 1024 && !key.includes('..')
    && /^cms\/v1\/(?:[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/)*[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(key);
}
function checkedKey(key) { if (!validObjectKey(key)) throw failure(); return key; }
function checkedBytes(data) {
  if (!(data instanceof Uint8Array) || data.byteLength < 1 || data.byteLength > MAX_WRITE_BYTES) throw failure();
  return Buffer.from(data);
}
function own(value, key) { const field = Object.getOwnPropertyDescriptor(value, key); return field && 'value' in field ? field.value : undefined; }
function credentialsValue(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw failure();
  const accessKeyId = own(input, 'accessKeyId'), accessKeySecret = own(input, 'accessKeySecret'), securityToken = own(input, 'securityToken');
  if (typeof accessKeyId !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/u.test(accessKeyId)
    || typeof accessKeySecret !== 'string' || !/^[\x21-\x7e]{1,1024}$/u.test(accessKeySecret)
    || typeof securityToken !== 'string' || !/^[\x21-\x7e]{1,8192}$/u.test(securityToken)) throw failure();
  return { accessKeyId, accessKeySecret, securityToken };
}
function timestamp(clock) {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw failure();
  return value.toISOString().replace(/[-:]|\.\d{3}/gu, '');
}
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
// OSS V4, independently checked against ali-oss@6.23.0 official signer vectors.
// https://help.aliyun.com/en/oss/developer-reference/recommend-to-use-signature-version-4
function signedHeaders(method, key, query, input, credentials, clock) {
  const date = timestamp(clock), day = date.slice(0, 8);
  const headers = { ...input, 'x-oss-content-sha256': 'UNSIGNED-PAYLOAD', 'x-oss-date': date, 'x-oss-security-token': credentials.securityToken };
  const names = Object.keys(headers).filter(name => ['content-md5', 'content-type'].includes(name) || name.startsWith('x-oss-')).sort();
  const canonicalHeaders = names.map(name => `${name}:${headers[name].trim()}\n`).join('');
  const canonical = `${method}\n/${OSS_BUCKET}/${key}\n${query}\n${canonicalHeaders}\n\nUNSIGNED-PAYLOAD`;
  const scope = `${day}/${OSS_REGION}/oss/aliyun_v4_request`;
  const signingKey = hmac(hmac(hmac(hmac('aliyun_v4' + credentials.accessKeySecret, day), OSS_REGION), 'oss'), 'aliyun_v4_request');
  const signature = createHmac('sha256', signingKey).update(`OSS4-HMAC-SHA256\n${date}\n${scope}\n${hash(canonical)}`).digest('hex');
  headers.authorization = `OSS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope},Signature=${signature}`;
  return headers;
}
async function abortable(promise, signal) {
  if (signal.aborted) { Promise.resolve(promise).catch(() => {}); throw failure(); }
  return new Promise((accept, reject) => {
    const abort = () => reject(failure());
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(value => { signal.removeEventListener('abort', abort); accept(value); }, () => { signal.removeEventListener('abort', abort); reject(failure()); });
  });
}
async function readBounded(response, maxBytes, signal) {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^(?:0|[1-9]\d*)$/u.test(declared) || Number(declared) > maxBytes || !Number.isSafeInteger(Number(declared)))) throw failure();
  const encoding = response.headers.get('content-encoding');
  if (encoding !== null && encoding !== 'identity') throw failure();
  if (!response.body) { if (declared !== null && declared !== '0') throw failure(); return Buffer.alloc(0); }
  const reader = response.body.getReader(), chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      if (!(value instanceof Uint8Array) || (length += value.byteLength) > maxBytes) throw failure();
      chunks.push(Buffer.from(value));
    }
    if (declared !== null && length !== Number(declared)) throw failure();
    return Buffer.concat(chunks, length);
  } finally { try { reader.cancel().catch(() => {}); } catch { /* No stream details escape. */ } try { reader.releaseLock(); } catch { /* No stream details escape. */ } }
}
function providerCode(response, data) {
  if (!/^(?:application|text)\/xml(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? '')) return null;
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { return null; }
  if (text.includes('<!') || !/^\s*(?:<\?xml[^<>]{0,150}\?>\s*)?<Error(?:\s+[^<>]{0,200})?>[\s\S]*<\/Error>\s*$/u.test(text)) return null;
  const code = /^\s*(?:<\?xml[^<>]{0,150}\?>\s*)?<Error(?:\s+[^<>]{0,200})?>\s*<Code>([A-Za-z][A-Za-z0-9]{0,79})<\/Code>/u.exec(text)?.[1];
  if (!code || [...text.matchAll(/<Code>/gu)].length !== 1) return null;
  return ['NoSuchKey', 'FileAlreadyExists', 'PositionNotEqualToLength'].includes(code) ? code : null;
}
function sameBytes(left, right) { return left.byteLength === right.byteLength && timingSafeEqual(left, right); }

/** Server-only, fixed private bucket. The provider must supply all three FC role credentials. */
export function createOssObjectClient({ credentials, fetchFn = fetch, clock = () => new Date(), requestTimeoutMs = 20_000 } = {}) {
  if (typeof credentials !== 'function' || typeof fetchFn !== 'function' || typeof clock !== 'function'
    || !Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 20_000) throw failure();
  async function request(method, key, { query = '', data, contentType, maxBytes = MAX_ERROR_BYTES, appendPosition } = {}) {
    checkedKey(key);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    let response;
    try {
      const value = credentialsValue(await abortable(Promise.resolve().then(() => credentials()), controller.signal));
      const input = {};
      if (data) {
        input['content-type'] = contentType;
        input['content-md5'] = createHash('md5').update(data).digest('base64');
        input['content-length'] = String(data.byteLength);
      }
      if (method === 'PUT') input['x-oss-forbid-overwrite'] = 'true';
      if (method === 'PUT' || appendPosition === 0) input['x-oss-server-side-encryption'] = 'AES256';
      // Byte counts, hashes and immutable readback must use the stored bytes.
      // Node fetch otherwise negotiates compression and transparently decodes
      // the body while retaining the compressed response length/encoding.
      const headers = { ...signedHeaders(method, key, query, input, value, clock), 'accept-encoding': 'identity' };
      const url = `${OSS_ORIGIN}/${key}${query ? '?' + query : ''}`;
      response = await abortable(Promise.resolve().then(() => fetchFn(url, { method, headers, ...(data ? { body: data } : {}), redirect: 'error', cache: 'no-store', signal: controller.signal })), controller.signal);
      if (!response || !Number.isInteger(response.status) || response.redirected || response.url && response.url !== url
        || typeof response.headers?.get !== 'function') throw failure();
      const bytes = await readBounded(response, response.status === 200 ? maxBytes : MAX_ERROR_BYTES, controller.signal);
      return { status: response.status, data: bytes, headers: response.headers, code: response.status === 200 ? null : providerCode(response, bytes) };
    } catch (error) { throw safeErrors.has(error) ? error : failure(); }
    finally { clearTimeout(timer); controller.abort(); try { if (response?.body && !response.body.locked) response.body.cancel().catch(() => {}); } catch { /* No remote cleanup error escapes. */ } }
  }
  async function get(key, { maxBytes = MAX_WRITE_BYTES } = {}) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_OSS_OBJECT_BYTES) throw failure();
    const result = await request('GET', key, { maxBytes });
    if (result.status === 404 && result.code === 'NoSuchKey') return null;
    if (result.status !== 200) throw failure();
    const objectType = result.headers.get('x-oss-object-type');
    const contentType = (result.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!OBJECT_TYPES.has(objectType) || !TYPES.has(contentType)) throw failure();
    return { data: result.data, objectType, contentType };
  }
  return {
    get,
    async putImmutable(key, input, { contentType = 'application/json' } = {}) {
      checkedKey(key);
      const data = checkedBytes(input), basename = key.split('/').at(-1);
      if (!/^([a-f0-9]{64})\.(?:json|jpg|png|webp)$/u.test(basename) || IMMUTABLE_TYPES[basename.split('.').at(-1)] !== contentType || basename.slice(0, 64) !== hash(data)) throw failure();
      const existing = await get(key, { maxBytes: data.byteLength });
      if (existing) { if (!sameBytes(existing.data, data) || existing.contentType !== contentType) throw failure(); return existing; }
      const result = await request('PUT', key, { data, contentType });
      if (!(result.status === 200 && result.data.byteLength === 0 || result.status === 409 && result.code === 'FileAlreadyExists')) throw failure();
      const saved = await get(key, { maxBytes: data.byteLength });
      if (!saved || !sameBytes(saved.data, data) || hash(saved.data) !== basename.slice(0, 64) || saved.contentType !== contentType) throw failure();
      return saved;
    },
    async append(key, position, input) {
      checkedKey(key);
      const data = checkedBytes(input);
      if (!Number.isSafeInteger(position) || position < 0 || position + data.byteLength > MAX_OSS_OBJECT_BYTES) throw failure();
      const result = await request('POST', key, { query: `append&position=${position}`, data, contentType: 'application/x-ndjson', appendPosition: position });
      if (result.status === 409 && result.code === 'PositionNotEqualToLength') throw failure('WRITE_CONFLICT', 409);
      const next = result.headers.get('x-oss-next-append-position');
      if (result.status !== 200 || result.data.byteLength !== 0 || !/^(?:0|[1-9]\d*)$/u.test(next ?? '') || Number(next) !== position + data.byteLength) throw failure();
      return { nextPosition: Number(next) };
    },
  };
}
