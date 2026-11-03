import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPublication } from './deploy-oss.mjs';

export const PUBLIC_ENTRY_URL = 'https://artdico.host/r/';
export const ENTRY_API_PREFIX = 'https://api.artdico.host/api/admin/registration/entry-links/';
const SITE = 'https://artdico.host';
const MAX_ENTRY_BYTES = 1024 * 1024, MAX_ERROR_BYTES = 4096;
const failed = () => new Error('Entry surfaces release verification failed.');
const directives = value => typeof value === 'string' ? value.split(',').map(part => part.trim().toLowerCase()).sort().join(',') : null;
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');

/** These fixed GET/OPTIONS probes cannot resolve a real entry capability:
 * invalid fails route syntax and the synthetic-shaped code is used only for
 * preflight, which returns before authentication, storage or service calls. */
export async function verifyEntrySurfaces({ directory, commit = process.env.GITHUB_SHA, fetchFn = fetch, timeoutMs = 20_000, report = () => {} } = {}) {
  try {
    if (typeof directory !== 'string' || !directory || typeof commit !== 'string' || !/^[a-f0-9]{40}$/u.test(commit)
      || typeof fetchFn !== 'function' || typeof report !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20_000) throw failed();
    // Validate the complete publication and source receipt before any request.
    const manifest = await verifyPublication(directory, commit);
    const entry = manifest.files.find(item => item.path === 'r/index.html');
    if (!entry || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > MAX_ENTRY_BYTES) throw failed();

    async function request({ url, method = 'GET', headers = {}, status, maxBytes, validate }) {
      const controller = new AbortController(); let timer, response, reader;
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(failed()); }, timeoutMs); timer.unref(); });
      const bounded = value => Promise.race([value, timeout]);
      try {
        const fetching = Promise.resolve().then(() => fetchFn(url, {
          method, redirect: 'error', cache: 'no-store', credentials: 'omit', referrer: '', referrerPolicy: 'no-referrer',
          headers: { accept: '*/*', 'accept-encoding': 'identity', 'cache-control': 'no-cache', pragma: 'no-cache', ...headers }, signal: controller.signal,
        })).then(value => {
          if (controller.signal.aborted) {
            try { value?.body?.cancel().catch(() => {}); } catch { /* Fixed diagnostics only. */ }
            throw failed();
          }
          return value;
        });
        response = await bounded(fetching);
        if (response?.status !== status || response.redirected || response.url && response.url !== url
          || ![null, 'identity'].includes(response.headers.get('content-encoding')) || response.headers.has('set-cookie')) throw failed();
        validate(response.headers);
        const declared = response.headers.get('content-length');
        if (declared !== null && (!/^(?:0|[1-9]\d*)$/u.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > maxBytes)) throw failed();
        reader = response.body?.getReader(); let bytes = 0; const chunks = [];
        if (reader) while (true) {
          const part = await bounded(reader.read()); if (part.done) break;
          if (!(part.value instanceof Uint8Array) || (bytes += part.value.byteLength) > maxBytes) throw failed();
          chunks.push(Buffer.from(part.value));
        }
        if (controller.signal.aborted || declared !== null && Number(declared) !== bytes) throw failed();
        return Buffer.concat(chunks, bytes);
      } finally {
        clearTimeout(timer); controller.abort();
        try { if (reader) { reader.cancel().catch(() => {}); reader.releaseLock(); } else response?.body?.cancel().catch(() => {}); } catch { /* Fixed diagnostics only. */ }
      }
    }

    // Probe the deployed directory route rather than just its backing object.
    const publicBytes = await request({ url: PUBLIC_ENTRY_URL, status: 200, maxBytes: entry.bytes, validate(headers) {
      if ((headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() !== 'text/html'
        || /^\s*attachment(?:\s*;|$)/iu.test(headers.get('content-disposition') ?? '')
        || directives(headers.get('cache-control')) !== 'no-cache,public') throw failed();
    } });
    if (publicBytes.length !== entry.bytes || createHash('sha256').update(publicBytes).digest('hex') !== entry.sha256) throw failed();

    const invalidBytes = await request({ url: ENTRY_API_PREFIX + 'invalid', status: 404, maxBytes: MAX_ERROR_BYTES,
      headers: { accept: 'application/json' }, validate(headers) {
        if ((headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() !== 'application/json'
          || directives(headers.get('cache-control')) !== 'no-store,private') throw failed();
      } });
    const invalid = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(invalidBytes));
    if (!exactKeys(invalid, ['error']) || !exactKeys(invalid.error, ['code', 'message'])
      || invalid.error.code !== 'ENTRY_NOT_FOUND' || typeof invalid.error.message !== 'string') throw failed();

    await request({ url: ENTRY_API_PREFIX + 'A'.repeat(22), method: 'OPTIONS', status: 204, maxBytes: 0,
      headers: { origin: SITE, 'access-control-request-method': 'GET' }, validate(headers) {
        if (headers.get('access-control-allow-origin') !== SITE || headers.has('access-control-allow-credentials')
          || directives(headers.get('access-control-allow-methods')) !== 'get,head,options'
          || directives(headers.get('cache-control')) !== 'no-store,private') throw failed();
      } });

    const result = { verified: true, publicEntry: true, invalidEntry: true, cors: true, requests: 3, commit };
    report(result);
    return result;
  } catch { throw failed(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw failed();
    const result = await verifyEntrySurfaces({ directory: resolve(process.argv[2]) });
    console.log('Entry surfaces release verification: ' + JSON.stringify(result));
  } catch { console.error('Entry surfaces release verification failed.'); process.exitCode = 1; }
}
