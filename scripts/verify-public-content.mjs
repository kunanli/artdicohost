import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { toPublicContent } from '../shared/content-schema.mjs';
import { createInitialContent } from '../src/config/content.mjs';

export const PUBLIC_CONTENT_URL = 'https://api.artdico.host/api/public/content';
export const PUBLIC_CONTENT_ORIGIN = 'https://artdico.host';
const MAX_BYTES = 1024 * 1024;
const failure = () => new Error('Anonymous public content verification failed.');
const exact = (value, names) => value && typeof value === 'object' && !Array.isArray(value)
  && isDeepStrictEqual(Object.keys(value).sort(), [...names].sort());

/** One fixed anonymous GET only. The returned report contains metadata and
 * counts, never content, names, provider messages, headers or configuration. */
export async function verifyPublicContent({ fetchFn = fetch, timeoutMs = 15_000 } = {}) {
  const controller = new AbortController(); let timer, response, reader;
  try {
    if (typeof fetchFn !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15_000) throw failure();
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(failure()); }, timeoutMs); });
    const bounded = promise => Promise.race([promise, timeout]);
    const fetching = Promise.resolve().then(() => fetchFn(PUBLIC_CONTENT_URL, {
      method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store', referrer: '', referrerPolicy: 'no-referrer',
      headers: { accept: 'application/json', origin: PUBLIC_CONTENT_ORIGIN, 'accept-encoding': 'identity' }, signal: controller.signal,
    })).then(value => {
      if (controller.signal.aborted) { try { value?.body?.cancel().catch(() => {}); } catch { /* Fixed diagnostics only. */ } throw failure(); }
      return value;
    });
    response = await bounded(fetching);
    if (!response || ![200, 404].includes(response.status) || response.redirected || response.url && response.url !== PUBLIC_CONTENT_URL
      || (response.headers.get('content-type') ?? '').trim().toLowerCase() !== 'application/json; charset=utf-8'
      || response.headers.get('cache-control') !== 'no-store' || ![null, 'identity'].includes(response.headers.get('content-encoding'))
      || response.headers.get('access-control-allow-origin') !== PUBLIC_CONTENT_ORIGIN
      || !(response.headers.get('vary') ?? '').split(',').some(value => value.trim().toLowerCase() === 'origin')
      || response.headers.has('access-control-allow-credentials') || response.headers.has('set-cookie')) throw failure();
    const declared = response.headers.get('content-length');
    if (declared !== null && (!/^(?:0|[1-9]\d*)$/u.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > MAX_BYTES)) throw failure();
    reader = response.body?.getReader();
    if (!reader) throw failure();
    const chunks = []; let bytes = 0;
    while (true) {
      const part = await bounded(reader.read());
      if (part.done) break;
      if (!(part.value instanceof Uint8Array) || (bytes += part.value.byteLength) > MAX_BYTES) throw failure();
      chunks.push(part.value);
    }
    if (controller.signal.aborted || declared !== null && Number(declared) !== bytes) throw failure();
    const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes)));
    if (response.status === 404) {
      if (!exact(data, ['error']) || !exact(data.error, ['code', 'message']) || data.error.code !== 'NOT_PUBLISHED' || typeof data.error.message !== 'string') throw failure();
      return { verified: true, cors: true, publication: 'none' };
    }
    if (!exact(data, ['revision', 'publishedAt', 'content']) || !Number.isSafeInteger(data.revision) || data.revision < 0
      || typeof data.publishedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(data.publishedAt)
      || new Date(data.publishedAt).toISOString() !== data.publishedAt
      || data.content?.eventId !== createInitialContent().eventId || !isDeepStrictEqual(toPublicContent(data.content), data.content)) throw failure();
    const counts = Object.fromEntries(['guests', 'organizations', 'showcases', 'booths', 'sessions'].map(name => [name, data.content[name]?.length ?? 0]));
    return { verified: true, cors: true, publication: 'published', revision: data.revision, publishedAt: data.publishedAt, counts };
  } catch { throw failure(); }
  finally {
    clearTimeout(timer); controller.abort();
    try { if (reader) { reader.cancel().catch(() => {}); reader.releaseLock(); } else response?.body?.cancel().catch(() => {}); } catch { /* Fixed diagnostics only. */ }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw failure();
    console.log('Anonymous public content HTTPS/CORS verified: ' + JSON.stringify(await verifyPublicContent()));
  } catch { console.error('Anonymous public content verification failed.'); process.exitCode = 1; }
}
