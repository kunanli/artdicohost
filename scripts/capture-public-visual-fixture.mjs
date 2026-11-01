import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPublicContent, PUBLIC_CONTENT_URL, PUBLIC_CONTENT_ORIGIN } from './verify-public-content.mjs';
import { organizationReferenceKey } from '../shared/organization-display.mjs';

export const PUBLIC_VISUAL_FIXTURE_DIRECTORY = fileURLToPath(new URL('../.local-data/public-visual-fixture', import.meta.url));
const MAX_SNAPSHOT_BYTES = 1024 * 1024, MAX_MEDIA_BYTES = 2 * 1024 * 1024, MAX_TOTAL_MEDIA_BYTES = 8 * 1024 * 1024;
const MAX_MEDIA = 30, TOTAL_TIMEOUT_MS = 60_000;
const MEDIA_PATH = /^\/api\/public\/portraits\/([a-f0-9]{64})\.(png|jpg|webp)$/u;
const TYPES = Object.freeze({ png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' });
const MESSAGE = 'Public visual fixture capture failed.';
const CODES = new Set(['INVALID_ARGUMENTS', 'OUTPUT_EXISTS', 'OUTPUT_UNAVAILABLE', 'PUBLIC_CONTENT_UNAVAILABLE', 'NOT_PUBLISHED',
  'SNAPSHOT_UNAVAILABLE', 'MEDIA_LIMIT', 'MEDIA_RESPONSE', 'MEDIA_CONTENT_TYPE', 'MEDIA_BODY', 'MEDIA_HASH', 'TIMEOUT', 'WRITE_FAILED']);
const failures = new WeakSet();
const sha256 = value => createHash('sha256').update(value).digest('hex');
function failure(code) {
  const error = new Error(MESSAGE);
  Object.defineProperty(error, 'code', { value: CODES.has(code) ? code : 'PUBLIC_CONTENT_UNAVAILABLE', enumerable: true });
  failures.add(error); return error;
}
function cancel(response) { try { response?.body?.cancel().catch(() => {}); } catch { /* Fixed diagnostics only. */ } }
async function deadline(ms, work, signal) {
  const controller = new AbortController(); let timer, abort;
  const expiry = new Promise((_, reject) => {
    abort = () => { controller.abort(); reject(failure('PUBLIC_CONTENT_UNAVAILABLE')); };
    timer = setTimeout(() => { controller.abort(); reject(failure('TIMEOUT')); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
  try { return await work({ signal: controller.signal, wait: value => Promise.race([value, expiry]) }); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort(); }
}
async function readBody(response, maximum, wait) {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^(?:0|[1-9]\d*)$/u.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > maximum)) throw failure('MEDIA_BODY');
  const reader = response.body?.getReader();
  if (!reader) throw failure('MEDIA_BODY');
  const chunks = []; let length = 0;
  try {
    while (true) {
      const part = await wait(reader.read()); if (part.done) break;
      if (!(part.value instanceof Uint8Array) || (length += part.value.byteLength) > maximum) throw failure('MEDIA_BODY');
      chunks.push(Buffer.from(part.value));
    }
    if (!length || declared !== null && length !== Number(declared)) throw failure('MEDIA_BODY');
    return Buffer.concat(chunks, length);
  } finally { try { reader.cancel().catch(() => {}); reader.releaseLock(); } catch { /* Never wait on an uncooperative body. */ } }
}
async function mediaBytes(path, fetchFn, maximum, timeoutMs) {
  const url = new URL(path, PUBLIC_CONTENT_URL).href; let response;
  try {
    return await deadline(timeoutMs, async ({ signal, wait }) => {
      const fetching = Promise.resolve().then(() => fetchFn(url, { method: 'GET', redirect: 'error', credentials: 'omit',
        cache: 'no-store', referrer: '', referrerPolicy: 'no-referrer', headers: { accept: 'image/png,image/jpeg,image/webp',
          origin: PUBLIC_CONTENT_ORIGIN, 'accept-encoding': 'identity' }, signal })).then(value => {
        if (signal.aborted) { cancel(value); throw failure('TIMEOUT'); } return value;
      });
      response = await wait(fetching);
      if (response?.status !== 200 || response.redirected || response.url && response.url !== url
        || ![null, 'identity'].includes(response.headers.get('content-encoding')) || response.headers.has('set-cookie')) throw failure('MEDIA_RESPONSE');
      const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (contentType !== TYPES[MEDIA_PATH.exec(path)[2]]) throw failure('MEDIA_CONTENT_TYPE');
      const bytes = await readBody(response, maximum, wait);
      if (sha256(bytes) !== MEDIA_PATH.exec(path)[1]) throw failure('MEDIA_HASH');
      return { bytes, contentType };
    });
  } finally { cancel(response); }
}

/** Capture only a validated public publication and its explicitly referenced
 * organization logos. URL selection is fixed; injectable I/O exists for tests. */
export async function capturePublicVisualFixture({ fetchFn = fetch, outputDirectory = PUBLIC_VISUAL_FIXTURE_DIRECTORY,
  timeoutMs = 15_000, sourceCommit = process.env.GITHUB_SHA ?? null, clock = Date.now } = {}) {
  let created = false, complete = false, snapshotClone;
  const snapshotAbort = new AbortController(), started = performance.now();
  const remaining = () => { const ms = Math.ceil(TOTAL_TIMEOUT_MS - (performance.now() - started)); if (ms < 1) throw failure('TIMEOUT'); return Math.min(ms, timeoutMs); };
  try {
    if (typeof fetchFn !== 'function' || typeof outputDirectory !== 'string' || !outputDirectory || !Number.isSafeInteger(timeoutMs)
      || timeoutMs < 1 || timeoutMs > 15_000 || typeof clock !== 'function'
      || sourceCommit !== null && (typeof sourceCommit !== 'string' || !/^[a-f0-9]{40}$/u.test(sourceCommit))) throw failure('INVALID_ARGUMENTS');
    const capturedAt = new Date(clock()).toISOString();
    await mkdir(dirname(resolve(outputDirectory)), { recursive: true });
    try { await mkdir(outputDirectory, { mode: 0o700 }); created = true; }
    catch (error) { throw failure(error.code === 'EEXIST' ? 'OUTPUT_EXISTS' : 'OUTPUT_UNAVAILABLE'); }
    let captured, requests = 0;
    const verified = await verifyPublicContent({ timeoutMs: remaining(), fetchFn: async (url, options) => {
      if (++requests !== 1 || url !== PUBLIC_CONTENT_URL) throw failure('PUBLIC_CONTENT_UNAVAILABLE');
      const response = await fetchFn(url, options);
      try { snapshotClone = response.clone(); } catch { cancel(response); throw failure('SNAPSHOT_UNAVAILABLE'); }
      // Read the clone concurrently to keep both tee branches bounded. Nothing
      // is retained on disk until the original verifier accepts this response.
      captured = deadline(remaining(), ({ wait }) => readBody(snapshotClone, MAX_SNAPSHOT_BYTES, wait), snapshotAbort.signal)
        .then(bytes => ({ bytes }), error => ({ error }));
      return response;
    } });
    if (verified.publication !== 'published') throw failure('NOT_PUBLISHED');
    const observed = await captured;
    if (!observed?.bytes) throw failures.has(observed?.error) ? observed.error : failure('SNAPSHOT_UNAVAILABLE');
    const snapshot = observed.bytes, data = JSON.parse(snapshot.toString('utf8'));
    const paths = [...new Set((data.content.organizations ?? []).map(item => item.logoUrl).filter(Boolean))];
    if (paths.length > MAX_MEDIA || paths.some(path => typeof path !== 'string' || !MEDIA_PATH.test(path))) throw failure('MEDIA_LIMIT');
    const media = []; let totalBytes = 0;
    for (const path of paths) {
      const image = await mediaBytes(path, fetchFn, Math.min(MAX_MEDIA_BYTES, MAX_TOTAL_MEDIA_BYTES - totalBytes), remaining());
      totalBytes += image.bytes.length;
      media.push({ file: 'media/' + path.split('/').at(-1), path, sha256: sha256(image.bytes), bytes: image.bytes.length,
        contentType: image.contentType, data: image.bytes });
    }
    const manifest = { schemaVersion: 1, capturedAt, source: PUBLIC_CONTENT_URL, sourceCommit, anonymous: true,
      snapshot: { file: 'snapshot.json', bytes: snapshot.length, sha256: sha256(snapshot), revision: verified.revision, publishedAt: verified.publishedAt },
      counts: verified.counts, guestAttendance: verified.guestAttendance, media: media.map(({ data: _, ...item }) => item) };
    try {
      await mkdir(resolve(outputDirectory, 'media'));
      await writeFile(resolve(outputDirectory, 'snapshot.json'), snapshot, { mode: 0o600 });
      for (const image of media) await writeFile(resolve(outputDirectory, image.file), image.data, { mode: 0o600 });
      await writeFile(resolve(outputDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
    } catch { throw failure('WRITE_FAILED'); }
    const referenceLogoSources = (data.content.organizations ?? []).flatMap(card => {
      const key = organizationReferenceKey(card), image = MEDIA_PATH.exec(card.logoUrl ?? '');
      return key && image ? [{ key, sha256: image[1] }] : [];
    });
    // Count public subtitle field availability, without copying any caption.
    // Priority mirrors the presentation contract; no unpublished helper import.
    const guestCaptionCoverage = { title: 0, role: 0, company: 0, empty: 0 };
    for (const guest of data.content.guests) {
      const kind = typeof guest.title === 'string' && guest.title.trim() ? 'title'
        : typeof guest.ggjRole === 'string' && guest.ggjRole.trim() ? 'role'
          : typeof guest.company === 'string' && guest.company.trim() ? 'company' : 'empty';
      guestCaptionCoverage[kind]++;
    }
    complete = true;
    return { captured: true, revision: verified.revision, snapshotSha256: manifest.snapshot.sha256, snapshotBytes: snapshot.length,
      organizations: verified.counts.organizations, media: media.length, mediaBytes: totalBytes, referenceLogoSources, guestCaptionCoverage };
  } catch (error) { throw failures.has(error) ? error : failure('PUBLIC_CONTENT_UNAVAILABLE'); }
  finally {
    snapshotAbort.abort(); cancel(snapshotClone);
    if (created && !complete) try { await rm(outputDirectory, { recursive: true, force: true }); } catch { /* Capture still fails; never report partial output as ready. */ }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw failure('INVALID_ARGUMENTS');
    console.log('Public visual fixture captured: ' + JSON.stringify(await capturePublicVisualFixture()));
  } catch (error) {
    console.error(MESSAGE + ' ' + JSON.stringify({ captured: false, failure: failures.has(error) ? error.code : 'PUBLIC_CONTENT_UNAVAILABLE' }));
    process.exitCode = 1;
  }
}
