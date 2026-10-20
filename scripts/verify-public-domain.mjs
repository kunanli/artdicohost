import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentType, verifyPublication } from './deploy-oss.mjs';

export const PUBLIC_SITE_ORIGIN = 'https://artdico.host';
const failed = () => new Error('Public domain release verification failed.');

/** Read-only, credential-free verification of the exact checked publication through its real HTTPS domain. */
export async function verifyPublicDomain({ directory, commit = process.env.GITHUB_SHA, fetchFn = fetch, timeoutMs = 20_000, report = () => {} } = {}) {
  try {
    if (typeof directory !== 'string' || !directory || typeof commit !== 'string' || !/^[a-f0-9]{40}$/u.test(commit)
      || typeof fetchFn !== 'function' || typeof report !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20_000) throw failed();
    // Verify bytes, complete allowlist and the release receipt before the first network request.
    const manifest = await verifyPublication(directory, commit);
    for (const item of manifest.files) {
      const url = PUBLIC_SITE_ORIGIN + '/' + item.path.split('/').map(encodeURIComponent).join('/') + '?release=' + commit;
      const controller = new AbortController();
      let rejectTimeout, response, reader;
      const timeout = new Promise((_, reject) => { rejectTimeout = reject; });
      const timer = setTimeout(() => { controller.abort(); rejectTimeout(failed()); }, timeoutMs); timer.unref();
      try {
        response = await Promise.race([Promise.resolve().then(() => fetchFn(url, { method: 'GET', redirect: 'error', cache: 'no-store', credentials: 'omit',
          headers: { accept: '*/*', 'accept-encoding': 'identity', 'cache-control': 'no-cache', pragma: 'no-cache' }, signal: controller.signal })), timeout]);
        if (response?.status !== 200 || response.redirected || response.url && response.url !== url || ![null, 'identity'].includes(response.headers.get('content-encoding'))) throw failed();
        const expectedType = contentType(item.path)?.split(';')[0];
        const actualType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
        if (!expectedType || actualType !== expectedType || item.path.endsWith('.html') && /^\s*attachment(?:\s*;|$)/iu.test(response.headers.get('content-disposition') ?? '')) throw failed();
        const declared = response.headers.get('content-length');
        if (declared !== null && (!/^(?:0|[1-9]\d*)$/u.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) !== item.bytes)) throw failed();
        reader = response.body?.getReader();
        let length = 0; const hash = createHash('sha256');
        if (reader) while (true) {
          const part = await Promise.race([reader.read(), timeout]);
          if (part.done) break;
          if (!(part.value instanceof Uint8Array) || (length += part.value.byteLength) > item.bytes) throw failed();
          hash.update(part.value);
        }
        if (length !== item.bytes || hash.digest('hex') !== item.sha256) throw failed();
        report('Verified HTTPS public object ' + item.path);
      } finally {
        clearTimeout(timer); controller.abort();
        try { if (reader) { reader.cancel().catch(() => {}); reader.releaseLock(); } else response?.body?.cancel().catch(() => {}); } catch { /* Fixed diagnostics only. */ }
      }
    }
    return { verified: true, origin: PUBLIC_SITE_ORIGIN, commit, files: manifest.files.length };
  } catch { throw failed(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw failed();
    const result = await verifyPublicDomain({ directory: resolve(process.argv[2]), report: line => console.log(line) });
    console.log('Verified ' + result.files + ' exact public objects over HTTPS at ' + result.origin + ' for commit ' + result.commit + '.');
  } catch { console.error('Public domain release verification failed.'); process.exitCode = 1; }
}
