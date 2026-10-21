import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLOUD_ADMIN_PAGE_ALIASES } from '../functions/cloud-content/http-server.mjs';
import { CANDIDATE_ARCHIVE, CANDIDATE_KIND, CANDIDATE_NODE, candidateBytes, candidateFileRecords,
  candidateSha256, candidateZipEntries, exactKeys, validateCandidateAssets } from './cloud-content-package.mjs';
import { assertFcCodeRequestFits, MAX_FC_ZIP_BYTES } from './fc-upload-limits.mjs';

export const CLOUD_ADMIN_ORIGIN = 'https://api.artdico.host';
const HTML_LIMIT = 2 * 1024 * 1024;
const failed = () => new Error('Cloud admin page verification failed.');
const decode = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));

function identity(value, commit) {
  if (value.schemaVersion !== 1 || value.kind !== CANDIDATE_KIND || value.sourceCommit !== commit) throw failed();
  exactKeys(value.node, Object.keys(CANDIDATE_NODE), 'Node');
  if (Object.keys(CANDIDATE_NODE).some(key => value.node[key] !== CANDIDATE_NODE[key])) throw failed();
}

function csp(bytes) {
  const html = new TextDecoder('utf-8', { fatal: true }).decode(bytes), hashes = new Set();
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)) {
    if (!/(?:^|\s)src\s*=/iu.test(script[1])) hashes.add(`'sha256-${createHash('sha256').update(script[2].replace(/\r\n?/gu, '\n')).digest('base64')}'`);
  }
  return `default-src 'self'; script-src 'self'${hashes.size ? ' ' + [...hashes].join(' ') : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`;
}

/** The lifecycle has already verified/deployed this artifact. Recheck its exact
 * identity, complete bounded ZIP and asset graph before any public request;
 * this check does not execute or decompress the packaged Node runtime. */
async function expectedPages(directory, commit) {
  const names = await readdir(directory);
  if (names.length !== 2 || !names.includes('package-manifest.json') || !names.includes(CANDIDATE_ARCHIVE)) throw failed();
  const manifest = decode(await candidateBytes(resolve(directory, 'package-manifest.json'), 64 * 1024));
  exactKeys(manifest, ['schemaVersion', 'kind', 'sourceCommit', 'node', 'files', 'archive', 'verification'], 'manifest');
  identity(manifest, commit); candidateFileRecords(manifest.files);
  if (typeof manifest.verification !== 'string' || manifest.verification.length > 1024) throw failed();
  exactKeys(manifest.archive, ['path', 'bytes', 'sha256'], 'archive');
  if (manifest.archive.path !== CANDIDATE_ARCHIVE || !Number.isSafeInteger(manifest.archive.bytes) || manifest.archive.bytes < 1
    || manifest.archive.bytes > MAX_FC_ZIP_BYTES || !/^[a-f0-9]{64}$/u.test(manifest.archive.sha256 ?? '')) throw failed();
  assertFcCodeRequestFits(manifest.archive.bytes);
  const zip = await candidateBytes(resolve(directory, CANDIDATE_ARCHIVE), MAX_FC_ZIP_BYTES);
  if (zip.length !== manifest.archive.bytes || candidateSha256(zip) !== manifest.archive.sha256) throw failed();
  const contents = candidateZipEntries(zip, manifest.files), release = decode(contents.get('release.json'));
  exactKeys(release, ['schemaVersion', 'kind', 'sourceCommit', 'node', 'files', 'assets'], 'release');
  identity(release, commit);
  if (JSON.stringify(release.files) !== JSON.stringify(manifest.files.filter(file => file.path !== 'release.json'))) throw failed();
  validateCandidateAssets(release, contents);
  const pages = new Map();
  for (const source of new Set(CLOUD_ADMIN_PAGE_ALIASES.map(([, source]) => source))) {
    const item = release.assets.find(asset => asset.url === source), bytes = item && contents.get(item.path);
    if (!item || !bytes || bytes.length < 1 || bytes.length > HTML_LIMIT || candidateSha256(bytes) !== item.sha256) throw failed();
    pages.set(source, { bytes: item.bytes, sha256: item.sha256, csp: csp(bytes) });
  }
  return pages;
}

async function verifyPage(path, expected, { fetchFn, signal, timeoutMs }) {
  const controller = new AbortController(), active = AbortSignal.any([signal, controller.signal]);
  let rejectTimeout, response, reader;
  const timeout = new Promise((_, reject) => { rejectTimeout = reject; });
  const abort = () => rejectTimeout(failed());
  active.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (active.aborted) throw failed();
    const url = CLOUD_ADMIN_ORIGIN + path;
    const fetching = Promise.resolve().then(() => fetchFn(url, { method: 'GET', redirect: 'error', cache: 'no-store', credentials: 'omit',
      referrer: '', referrerPolicy: 'no-referrer', headers: { accept: 'text/html', 'accept-encoding': 'identity', 'cache-control': 'no-cache', pragma: 'no-cache' }, signal: active }))
      .then(value => {
        if (active.aborted) { try { value?.body?.cancel().catch(() => {}); } catch { /* Fixed diagnostics only. */ } throw failed(); }
        return value;
      });
    response = await Promise.race([fetching, timeout]);
    if (response?.status !== 200 || response.redirected || response.url && response.url !== url
      || (response.headers.get('content-type') ?? '').trim().toLowerCase() !== 'text/html; charset=utf-8'
      || ![null, 'identity'].includes(response.headers.get('content-encoding'))
      || response.headers.get('cache-control') !== 'no-store' || response.headers.get('content-security-policy') !== expected.csp
      || response.headers.has('set-cookie') || /^\s*attachment(?:\s*;|$)/iu.test(response.headers.get('content-disposition') ?? '')) throw failed();
    const declared = response.headers.get('content-length');
    if (declared !== null && (!/^(?:0|[1-9]\d*)$/u.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) !== expected.bytes)) throw failed();
    reader = response.body?.getReader();
    let length = 0; const hash = createHash('sha256');
    if (!reader) throw failed();
    while (true) {
      const part = await Promise.race([reader.read(), timeout]);
      if (part.done) break;
      if (!(part.value instanceof Uint8Array) || (length += part.value.byteLength) > expected.bytes || length > HTML_LIMIT) throw failed();
      hash.update(part.value);
    }
    if (length !== expected.bytes || hash.digest('hex') !== expected.sha256) throw failed();
  } finally {
    clearTimeout(timer); controller.abort(); active.removeEventListener('abort', abort);
    try { if (reader) { reader.cancel().catch(() => {}); reader.releaseLock(); } else response?.body?.cancel().catch(() => {}); } catch { /* Fixed diagnostics only. */ }
  }
}

/** Fixed anonymous GETs only; no login, cookie, query, redirect or fallback. */
export async function verifyCloudAdminPages({ directory, commit = process.env.GITHUB_SHA, fetchFn = fetch,
  timeoutMs = 15_000, overallTimeoutMs = 45_000, report = () => {} } = {}) {
  const controller = new AbortController(); let timer;
  try {
    if (typeof directory !== 'string' || !directory || typeof commit !== 'string' || !/^[a-f0-9]{40}$/u.test(commit)
      || typeof fetchFn !== 'function' || typeof report !== 'function'
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15_000
      || !Number.isSafeInteger(overallTimeoutMs) || overallTimeoutMs < 1 || overallTimeoutMs > 45_000) throw failed();
    const deadline = performance.now() + overallTimeoutMs;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(failed()); }, overallTimeoutMs); });
    const bounded = async promise => {
      const value = await Promise.race([promise, timeout]);
      if (controller.signal.aborted || performance.now() >= deadline) throw failed();
      return value;
    };
    const pages = await bounded(expectedPages(resolve(directory), commit));
    for (const [path, source] of CLOUD_ADMIN_PAGE_ALIASES) {
      await bounded(verifyPage(path, pages.get(source), { fetchFn, signal: controller.signal, timeoutMs }));
      report('Verified HTTPS admin page ' + path);
    }
    return { verified: true, origin: CLOUD_ADMIN_ORIGIN, commit, pages: CLOUD_ADMIN_PAGE_ALIASES.length };
  } catch { throw failed(); }
  finally { clearTimeout(timer); controller.abort(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw failed();
    const result = await verifyCloudAdminPages({ directory: resolve(process.argv[2]), report: line => console.log(line) });
    console.log('Verified ' + result.pages + ' exact cloud admin pages over HTTPS for commit ' + result.commit + '.');
  } catch { console.error('Cloud admin page verification failed.'); process.exitCode = 1; }
}
