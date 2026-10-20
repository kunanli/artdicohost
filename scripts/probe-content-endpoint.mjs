import { resolveCname } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONTENT_PROBE_HOST = 'api.artdico.host';
export const CONTENT_PROBE_CNAME = '1954121651395178.cn-hongkong.fc.aliyuncs.com';
const MAX_BODY_BYTES = 16 * 1024;
const DEADLINE_MS = 10_000;
const APPLICATION_CODES = new Set(['INVALID_HTTP_REQUEST', 'CONTENT_NOT_READY', 'HOST_REJECTED', 'ORIGIN_REJECTED', 'NOT_FOUND', 'SERVICE_UNAVAILABLE']);
const base = () => ({ observation: 'read-only-endpoint', dnsMatched: false, httpsVerified: false, status: null, applicationError: null, failure: null });

function applicationCode(bytes) {
  try {
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      if (body.status === 'not_ready') return 'not_ready';
      if (typeof body.error?.code === 'string') return APPLICATION_CODES.has(body.error.code) ? body.error.code : 'UNRECOGNIZED';
    }
  } catch { /* The body is never returned or logged, including HTML and error pages. */ }
  return null;
}

async function fixedCname(resolveCnameFn, signal) {
  let abort;
  const deadline = new Promise((_, reject) => { abort = () => reject(new Error('Endpoint probe deadline')); signal.addEventListener('abort', abort, { once: true }); });
  try {
    if (signal.aborted) throw new Error('Endpoint probe deadline');
    return await Promise.race([Promise.resolve().then(() => resolveCnameFn(CONTENT_PROBE_HOST)), deadline]);
  } finally { signal.removeEventListener('abort', abort); }
}

function readFixedEndpoint(requestFn, signal) {
  return new Promise(resolveObservation => {
    let request, response, finished = false, httpsVerified = false, status = null, size = 0, chunks = [];
    const finish = (failure, applicationError = null) => {
      if (finished) return;
      finished = true; chunks = [];
      signal.removeEventListener('abort', onAbort);
      resolveObservation({ httpsVerified, status, applicationError, failure });
    };
    const stop = failure => { finish(failure); response?.destroy(); request?.destroy(); };
    const onAbort = () => stop('TIMEOUT');
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) { onAbort(); return; }
    try {
      request = requestFn({
        protocol: 'https:', hostname: CONTENT_PROBE_HOST, port: 443, path: '/admin/', method: 'GET',
        servername: CONTENT_PROBE_HOST, rejectUnauthorized: true, minVersion: 'TLSv1.2',
        agent: false, maxHeaderSize: 8192,
        headers: { host: CONTENT_PROBE_HOST, accept: 'application/json', 'user-agent': 'ARTDiCO-Endpoint-Probe/1' },
      }, incoming => {
        response = incoming;
        if (finished) { incoming.destroy(); return; }
        httpsVerified = incoming.socket?.encrypted === true && incoming.socket?.authorized === true;
        if (!httpsVerified) { stop('TLS_NOT_VERIFIED'); return; }
        if (!Number.isInteger(incoming.statusCode) || incoming.statusCode < 100 || incoming.statusCode > 599) { stop('INVALID_HTTP_RESPONSE'); return; }
        status = incoming.statusCode;
        // Redirect headers and bodies are neither inspected nor followed.
        if (status >= 300 && status <= 399) { stop('REDIRECT_NOT_FOLLOWED'); return; }
        incoming.on('error', () => finish(signal.aborted ? 'TIMEOUT' : 'RESPONSE_FAILED'));
        incoming.on('aborted', () => finish('RESPONSE_FAILED'));
        incoming.on('data', chunk => {
          if (finished) return;
          if (!(chunk instanceof Uint8Array)) { stop('INVALID_HTTP_RESPONSE'); return; }
          if ((size += chunk.byteLength) > MAX_BODY_BYTES) { stop('BODY_TOO_LARGE'); return; }
          chunks.push(Buffer.from(chunk));
        });
        incoming.on('end', () => { if (!finished) finish(null, applicationCode(Buffer.concat(chunks, size))); });
      });
      request.on('error', () => finish(signal.aborted ? 'TIMEOUT' : 'HTTPS_FAILED'));
      request.end();
    } catch { stop(signal.aborted ? 'TIMEOUT' : 'HTTPS_FAILED'); }
  });
}

/** Fixed read-only observation, never a business-readiness or persistence test.
 * Dependencies are injectable for isolated tests; no caller-selected URL, headers,
 * credentials, redirects, environment configuration or response text is accepted.
 */
export async function probeContentEndpoint({ resolveCnameFn = resolveCname, requestFn = httpsRequest, schedule = setTimeout, cancel = clearTimeout } = {}) {
  const report = base();
  if (![resolveCnameFn, requestFn, schedule, cancel].every(value => typeof value === 'function')) return { ...report, failure: 'INVALID_PROBE_DEPENDENCY' };
  const controller = new AbortController();
  const timer = schedule(() => controller.abort(), DEADLINE_MS);
  try {
    let targets;
    try { targets = await fixedCname(resolveCnameFn, controller.signal); }
    catch { return { ...report, failure: controller.signal.aborted ? 'TIMEOUT' : 'DNS_FAILED' }; }
    report.dnsMatched = Array.isArray(targets) && targets.length === 1 && typeof targets[0] === 'string'
      && targets[0].toLowerCase().replace(/\.$/u, '') === CONTENT_PROBE_CNAME;
    if (!report.dnsMatched) return { ...report, failure: 'DNS_TARGET_MISMATCH' };
    return { ...report, ...await readFixedEndpoint(requestFn, controller.signal) };
  } catch { return { ...report, failure: controller.signal.aborted ? 'TIMEOUT' : 'PROBE_FAILED' }; }
  finally { cancel(timer); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Observation failures do not gate unrelated code-quality checks. Every outcome
  // remains explicit in the bounded structured report and contains no raw errors.
  const report = process.argv.length === 2 ? await probeContentEndpoint() : { ...base(), failure: 'INVALID_PROBE_ARGUMENTS' };
  console.log(JSON.stringify(report));
}
