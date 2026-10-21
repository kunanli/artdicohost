import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { toPublicContent } from '../shared/content-schema.mjs';
import { createInitialContent } from '../src/config/content.mjs';

export const PUBLIC_CONTENT_URL = 'https://api.artdico.host/api/public/content';
export const PUBLIC_CONTENT_ORIGIN = 'https://artdico.host';
const MAX_BYTES = 1024 * 1024;
const MESSAGE = 'Anonymous public content verification failed.';
const failures = new WeakSet();
const codes = new Set(['INVALID_ARGUMENTS', 'INVALID_RESPONSE', 'TRANSPORT_ERROR', 'TIMEOUT', 'HTTP_STATUS', 'REDIRECT', 'RESPONSE_URL',
  'CONTENT_TYPE', 'CACHE_CONTROL', 'CONTENT_ENCODING', 'CORS_ORIGIN', 'VARY_ORIGIN', 'SET_COOKIE',
  'CONTENT_LENGTH', 'BODY_UNAVAILABLE', 'BODY_TOO_LARGE', 'BODY_CHUNK', 'BODY_READ_ERROR', 'BODY_ENCODING', 'INVALID_JSON',
  'INVALID_ENVELOPE', 'EVENT_MISMATCH', 'INVALID_PROJECTION']);
const validStatus = status => Number.isSafeInteger(status) && status >= 100 && status <= 599;
class VerificationFailure extends Error {
  constructor(code, status) {
    super(MESSAGE);
    Object.defineProperty(this, 'code', { value: codes.has(code) ? code : 'INVALID_RESPONSE', enumerable: true });
    if (validStatus(status)) Object.defineProperty(this, 'status', { value: status, enumerable: true });
    failures.add(this);
  }
}
const failure = (code = 'INVALID_RESPONSE', status) => new VerificationFailure(code, status);
const failureReport = error => ({ verified: false, failure: failures.has(error) ? error.code : 'INVALID_RESPONSE',
  ...(failures.has(error) && validStatus(error.status) ? { status: error.status } : {}) });
const exact = (value, names) => value && typeof value === 'object' && !Array.isArray(value)
  && isDeepStrictEqual(Object.keys(value).sort(), [...names].sort());

/** One fixed anonymous GET only. The returned report contains metadata and
 * counts, never content, names, provider messages, headers or configuration. */
export async function verifyPublicContent(options = {}) {
  const controller = new AbortController(); let timer, response, reader, status;
  try {
    const { fetchFn = fetch, timeoutMs = 15_000 } = options;
    if (typeof fetchFn !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15_000) throw failure('INVALID_ARGUMENTS');
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(failure('TIMEOUT', status)); }, timeoutMs); });
    const bounded = promise => Promise.race([promise, timeout]);
    const fetching = Promise.resolve().then(() => fetchFn(PUBLIC_CONTENT_URL, {
      method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store', referrer: '', referrerPolicy: 'no-referrer',
      headers: { accept: 'application/json', origin: PUBLIC_CONTENT_ORIGIN, 'accept-encoding': 'identity' }, signal: controller.signal,
    })).then(value => {
      if (controller.signal.aborted) { try { value?.body?.cancel().catch(() => {}); } catch { /* Fixed diagnostics only. */ } throw failure('TIMEOUT', status); }
      return value;
    }, () => { throw failure(controller.signal.aborted ? 'TIMEOUT' : 'TRANSPORT_ERROR', status); });
    response = await bounded(fetching);
    if (!response) throw failure('INVALID_RESPONSE');
    const receivedStatus = response.status; if (validStatus(receivedStatus)) status = receivedStatus;
    if (![200, 404].includes(receivedStatus)) throw failure('HTTP_STATUS', status);
    if (response.redirected) throw failure('REDIRECT', status);
    if (response.url && response.url !== PUBLIC_CONTENT_URL) throw failure('RESPONSE_URL', status);
    if ((response.headers.get('content-type') ?? '').trim().toLowerCase() !== 'application/json; charset=utf-8') throw failure('CONTENT_TYPE', status);
    if (response.headers.get('cache-control') !== 'no-store') throw failure('CACHE_CONTROL', status);
    if (![null, 'identity'].includes(response.headers.get('content-encoding'))) throw failure('CONTENT_ENCODING', status);
    if (response.headers.get('access-control-allow-origin') !== PUBLIC_CONTENT_ORIGIN) throw failure('CORS_ORIGIN', status);
    if (!(response.headers.get('vary') ?? '').split(',').some(value => value.trim().toLowerCase() === 'origin')) throw failure('VARY_ORIGIN', status);
    // Fetch consults Access-Control-Allow-Credentials only for credentials: include;
    // this fixed anonymous request always uses omit.
    if (response.headers.has('set-cookie')) throw failure('SET_COOKIE', status);
    const declared = response.headers.get('content-length');
    if (declared !== null && (!/^(?:0|[1-9]\d*)$/u.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > MAX_BYTES)) throw failure('CONTENT_LENGTH', status);
    reader = response.body?.getReader();
    if (!reader) throw failure('BODY_UNAVAILABLE', status);
    const chunks = []; let bytes = 0;
    while (true) {
      let part;
      try { part = await bounded(reader.read()); } catch (error) { throw failures.has(error) ? error : failure('BODY_READ_ERROR', status); }
      if (part.done) break;
      if (!(part.value instanceof Uint8Array)) throw failure('BODY_CHUNK', status);
      if ((bytes += part.value.byteLength) > MAX_BYTES) throw failure('BODY_TOO_LARGE', status);
      chunks.push(part.value);
    }
    if (controller.signal.aborted) throw failure('TIMEOUT', status);
    if (declared !== null && Number(declared) !== bytes) throw failure('CONTENT_LENGTH', status);
    let text, data;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes)); } catch { throw failure('BODY_ENCODING', status); }
    try { data = JSON.parse(text); } catch { throw failure('INVALID_JSON', status); }
    if (response.status === 404) {
      if (!exact(data, ['error']) || !exact(data.error, ['code', 'message']) || data.error.code !== 'NOT_PUBLISHED' || typeof data.error.message !== 'string') throw failure('INVALID_ENVELOPE', status);
      return { verified: true, cors: true, publication: 'none' };
    }
    if (!exact(data, ['revision', 'publishedAt', 'content']) || !Number.isSafeInteger(data.revision) || data.revision < 0
      || typeof data.publishedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(data.publishedAt)
      || !Number.isFinite(Date.parse(data.publishedAt))
      || new Date(data.publishedAt).toISOString() !== data.publishedAt
      || !data.content || typeof data.content !== 'object' || Array.isArray(data.content)) throw failure('INVALID_ENVELOPE', status);
    if (data.content.eventId !== createInitialContent().eventId) throw failure('EVENT_MISMATCH', status);
    let projection; try { projection = toPublicContent(data.content); } catch { throw failure('INVALID_PROJECTION', status); }
    if (!isDeepStrictEqual(projection, data.content)) throw failure('INVALID_PROJECTION', status);
    const counts = Object.fromEntries(['guests', 'organizations', 'showcases', 'booths', 'sessions'].map(name => [name, data.content[name]?.length ?? 0]));
    return { verified: true, cors: true, publication: 'published', revision: data.revision, publishedAt: data.publishedAt, counts };
  } catch (error) { throw failures.has(error) ? error : failure('INVALID_RESPONSE', status); }
  finally {
    clearTimeout(timer); controller.abort();
    try { if (reader) { reader.cancel().catch(() => {}); reader.releaseLock(); } else response?.body?.cancel().catch(() => {}); } catch { /* Fixed diagnostics only. */ }
  }
}

/** Nonblocking read-only observation. A failed response exposes only a fixed
 * failure code and, when received, a valid numeric HTTP status. */
export async function observePublicContent(options) {
  try { return await verifyPublicContent(options); } catch (error) { return failureReport(error); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), observe = args.length === 1 && args[0] === '--observe';
    if (args.length !== 0 && !observe) throw failure('INVALID_ARGUMENTS');
    const result = observe ? await observePublicContent() : await verifyPublicContent();
    console.log((observe ? 'Anonymous public content observation: ' : 'Anonymous public content HTTPS/CORS verified: ') + JSON.stringify(result));
  } catch (error) { console.error(MESSAGE + ' ' + JSON.stringify(failureReport(error))); process.exitCode = 1; }
}
