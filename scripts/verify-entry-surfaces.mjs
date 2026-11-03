import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPublication } from './deploy-oss.mjs';
import { validatePublicPath, MAX_FILE_BYTES } from './prepare-oss-site.mjs';

export const PUBLIC_ENTRY_URL = 'https://artdico.host/r/';
export const ENTRY_API_PREFIX = 'https://api.artdico.host/api/admin/registration/entry-links/';
const SITE = 'https://artdico.host';
const MAX_ENTRY_BYTES = 1024 * 1024, MAX_ERROR_BYTES = 4096;
const PUBLIC_RELEASE_URL = SITE + '/release.json';
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

    // The FC gateway adds canonical ACAC=true. This probe still omits all
    // credentials; the public capability route never authorizes via cookies.
    await request({ url: ENTRY_API_PREFIX + 'A'.repeat(22), method: 'OPTIONS', status: 204, maxBytes: 0,
      headers: { origin: SITE, 'access-control-request-method': 'GET' }, validate(headers) {
        if (headers.get('access-control-allow-origin') !== SITE || ![null, 'false', 'true'].includes(headers.get('access-control-allow-credentials'))
          || directives(headers.get('access-control-allow-methods')) !== 'get,head,options'
          || directives(headers.get('cache-control')) !== 'no-store,private') throw failed();
      } });

    const result = { verified: true, publicEntry: true, invalidEntry: true, cors: true, requests: 3, commit };
    report(result);
    return result;
  } catch { throw failed(); }
}

/** Observe only fixed public surfaces. Manual redirects are never followed and
 * their destinations are never read. Each phase emits allowlisted facts only;
 * failure in one phase does not hide the other independent probes. */
export async function observeEntrySurfaces({ fetchFn = fetch, timeoutMs = 10_000, report = () => {} } = {}) {
  if (typeof fetchFn !== 'function' || typeof report !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) throw failed();
  async function probe(phase, url, maxBytes, method = 'GET', headers = {}) {
    const facts = { phase, status: null, transport: false, redirect: false, url: false, encoding: false, cookie: false, declared: false, body: false, bytes: 0 };
    if (phase === 'release') Object.assign(facts, { mime: false, cache: false, receipt: false });
    if (phase === 'public-entry') Object.assign(facts, { mime: false, cache: false, attachment: false, size: false, hash: false });
    if (phase === 'invalid-entry') Object.assign(facts, { mime: false, cache: false, errorCode: 'UNREADABLE', envelope: false });
    if (phase === 'preflight') Object.assign(facts, { cache: false, origin: false, methods: false, credentials: false, credentialsValue: 'absent', empty: false });
    const controller = new AbortController(); let timer, response, reader;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(failed()); }, timeoutMs); timer.unref(); });
    const bounded = value => Promise.race([value, timeout]);
    try {
      const fetching = Promise.resolve().then(() => fetchFn(url, {
        method, redirect: 'manual', cache: 'no-store', credentials: 'omit', referrer: '', referrerPolicy: 'no-referrer',
        headers: { accept: phase === 'release' || phase === 'invalid-entry' ? 'application/json' : '*/*', 'accept-encoding': 'identity',
          'cache-control': 'no-cache', pragma: 'no-cache', ...headers }, signal: controller.signal,
      })).then(value => {
        if (controller.signal.aborted) { try { value?.body?.cancel().catch(() => {}); } catch {} throw failed(); }
        return value;
      });
      response = await bounded(fetching);
      if (!response) throw failed();
      facts.transport = true;
      if (Number.isInteger(response.status) && response.status >= 100 && response.status <= 599) facts.status = response.status;
      facts.redirect = Boolean(response.redirected || facts.status >= 300 && facts.status <= 399);
      facts.url = !response.url || response.url === url;
      facts.encoding = [null, 'identity'].includes(response.headers.get('content-encoding'));
      facts.cookie = response.headers.has('set-cookie');
      facts.cache = directives(response.headers.get('cache-control')) === (phase === 'release' || phase === 'public-entry' ? 'no-cache,public' : 'no-store,private');
      if (phase !== 'preflight') facts.mime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() === (phase === 'public-entry' ? 'text/html' : 'application/json');
      if (phase === 'public-entry') facts.attachment = /^\s*attachment(?:\s*;|$)/iu.test(response.headers.get('content-disposition') ?? '');
      if (phase === 'preflight') {
        facts.origin = response.headers.get('access-control-allow-origin') === SITE;
        facts.methods = directives(response.headers.get('access-control-allow-methods')) === 'get,head,options';
        facts.credentials = response.headers.has('access-control-allow-credentials');
        const credentialsHeader = response.headers.get('access-control-allow-credentials');
        facts.credentialsValue = credentialsHeader === null ? 'absent' : ['true','false'].includes(credentialsHeader) ? credentialsHeader : 'other';
      }
      const declared = response.headers.get('content-length');
      facts.declared = declared === null || /^(?:0|[1-9]\d*)$/u.test(declared) && Number.isSafeInteger(Number(declared)) && Number(declared) <= maxBytes;
      if (!facts.declared || !facts.encoding || facts.redirect || !facts.url) throw failed();
      reader = response.body?.getReader(); const chunks = [];
      if (reader) while (true) {
        const part = await bounded(reader.read()); if (part.done) break;
        if (!(part.value instanceof Uint8Array) || facts.bytes + part.value.byteLength > maxBytes) throw failed();
        facts.bytes += part.value.byteLength; chunks.push(Buffer.from(part.value));
      }
      if (controller.signal.aborted || declared !== null && Number(declared) !== facts.bytes) throw failed();
      facts.body = true;
      if (phase === 'preflight') facts.empty = facts.bytes === 0;
      return { facts, bytes: Buffer.concat(chunks, facts.bytes) };
    } catch { return { facts, bytes: null }; }
    finally {
      clearTimeout(timer); controller.abort();
      try { if (reader) { reader.cancel().catch(() => {}); reader.releaseLock(); } else response?.body?.cancel().catch(() => {}); } catch { /* Fixed diagnostics only. */ }
    }
  }
  const [release, entry, invalid, preflight] = await Promise.all([
    probe('release', PUBLIC_RELEASE_URL, MAX_ENTRY_BYTES), probe('public-entry', PUBLIC_ENTRY_URL, MAX_ENTRY_BYTES),
    probe('invalid-entry', ENTRY_API_PREFIX + 'invalid', MAX_ERROR_BYTES),
    probe('preflight', ENTRY_API_PREFIX + 'A'.repeat(22), 0, 'OPTIONS', { origin: SITE, 'access-control-request-method': 'GET' }),
  ]);
  let commit = null, expected;
  try {
    if (release.facts.status !== 200 || !release.facts.body || !release.facts.mime) throw failed();
    const receipt = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(release.bytes));
    if (!exactKeys(receipt, ['schemaVersion', 'commit', 'files']) || receipt.schemaVersion !== 1 || !/^[a-f0-9]{40}$/u.test(receipt.commit)
      || !Array.isArray(receipt.files) || receipt.files.length < 1 || receipt.files.length > 2048) throw failed();
    const paths = new Set();
    for (const item of receipt.files) {
      if (!exactKeys(item, ['path', 'bytes', 'sha256']) || typeof item.path !== 'string' || item.path === 'release.json' || paths.has(validatePublicPath(item.path))
        || !Number.isSafeInteger(item.bytes) || item.bytes < 0 || item.bytes > MAX_FILE_BYTES || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(item.sha256)) throw failed();
      paths.add(item.path);
      if (item.path === 'r/index.html') expected = item;
    }
    if (!expected || expected.bytes < 1 || expected.bytes > MAX_ENTRY_BYTES) throw failed();
    release.facts.receipt = true; commit = receipt.commit;
  } catch { expected = undefined; }
  if (expected && entry.bytes) {
    entry.facts.size = entry.bytes.length === expected.bytes;
    entry.facts.hash = createHash('sha256').update(entry.bytes).digest('hex') === expected.sha256;
  }
  try {
    if (!invalid.bytes) throw failed();
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(invalid.bytes));
    const code = value?.error?.code;
    invalid.facts.errorCode = new Set(['ENTRY_NOT_FOUND', 'AUTH_REQUIRED', 'FORBIDDEN', 'NOT_FOUND', 'ORIGIN_REJECTED', 'ENTRY_UNAVAILABLE']).has(code) ? code : 'OTHER';
    invalid.facts.envelope = Boolean(exactKeys(value, ['error']) && exactKeys(value.error, ['code', 'message']) && typeof code === 'string' && typeof value.error.message === 'string');
  } catch { /* Never report raw body or parser errors. */ }
  const result = { observed: true, requests: 4, commit, phases: [release.facts, entry.facts, invalid.facts, preflight.facts] };
  try { report(result); } catch { throw failed(); }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw failed();
    const observe = process.argv[2] === '--observe';
    const result = observe ? await observeEntrySurfaces() : await verifyEntrySurfaces({ directory: resolve(process.argv[2]) });
    console.log((observe ? 'Entry surfaces observation: ' : 'Entry surfaces release verification: ') + JSON.stringify(result));
  } catch { console.error('Entry surfaces release verification failed.'); process.exitCode = 1; }
}
