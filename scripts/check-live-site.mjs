import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_FILE_BYTES, sha256, validatePublicPath } from './prepare-oss-site.mjs';
import { contentType } from './deploy-oss.mjs';

const routes = new Map([['index.html', '/'], ['invitation/index.html', '/invitation/'], ['admin/index.html', '/admin/'], ['admin/contacts/index.html', '/admin/contacts/']]);
const MAX_RECEIPT_BYTES = 256 * 1024;

export function validateRelease(release, commit) {
  if (release?.schemaVersion !== 1 || release.commit !== commit || !Array.isArray(release.files) || !release.files.length || release.files.length > 500) throw new Error('Release receipt does not match the expected source commit');
  const seen = new Set();
  for (const file of release.files) {
    validatePublicPath(file.path);
    if (file.path === 'release.json' || seen.has(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > MAX_FILE_BYTES || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Invalid public object in release receipt');
    seen.add(file.path);
  }
  for (const path of [...routes.keys(), '404.html', 'invitations/template-blank.png', 'invitations/ggj2026-poster-v2.webp']) if (!seen.has(path)) throw new Error('Release receipt is missing a required public route');
  return release;
}

async function readBounded(response, limit) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body ?? []) {
    bytes += chunk.length;
    if (bytes > limit) throw new Error('Public response exceeds the expected size');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function checkType(response, path) {
  if ((response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() !== contentType(path)?.split(';')[0]) throw new Error('Unexpected Content-Type for ' + path);
  if (path.endsWith('.html') && /attachment/i.test(response.headers.get('content-disposition') ?? '')) throw new Error('HTML is offered as a download: ' + path);
}

export async function checkLiveSite({ origin, commit, fetchPublic = fetch } = {}) {
  const base = new URL(origin);
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('Provide an HTTPS origin without a path, credentials, query or fragment');
  if (!/^[a-f0-9]{40}$/.test(commit ?? '')) throw new Error('Provide the exact 40-character source commit from the successful deployment');
  const get = async path => {
    try {
      // TLS validation remains enabled. Redirects must be reviewed rather than followed.
      return await fetchPublic(new URL(path, base), { redirect: 'error', cache: 'no-store', headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(20_000) });
    } catch {
      throw new Error('HTTPS request failed for ' + path + '; check DNS, certificate, binding and network access');
    }
  };
  const receipt = await get('/release.json');
  if (receipt.status !== 200) throw new Error('Release receipt is unavailable (HTTP ' + receipt.status + ')');
  checkType(receipt, 'release.json');
  const receiptBytes = await readBounded(receipt, MAX_RECEIPT_BYTES);
  const release = validateRelease(JSON.parse(receiptBytes.toString('utf8')), commit);
  let checked = 0;
  const verify = async (path, file, status = 200) => {
    const response = await get(path);
    if (response.status !== status) throw new Error('Unexpected HTTP status for ' + path + ': ' + response.status);
    checkType(response, file.path);
    const data = await readBounded(response, file.bytes);
    if (data.length !== file.bytes || sha256(data) !== file.sha256) throw new Error('Public content differs from the release receipt: ' + path);
    checked++;
  };
  for (const file of release.files) {
    await verify('/' + file.path, file);
    if (routes.has(file.path)) await verify(routes.get(file.path), file);
  }
  await verify('/__artdico_missing_' + commit + '/', release.files.find(file => file.path === '404.html'), 404);
  // A concurrent deployment must not turn a mixed check into a successful receipt.
  const latest = await get('/release.json');
  if (latest.status !== 200 || sha256(await readBounded(latest, MAX_RECEIPT_BYTES)) !== sha256(receiptBytes)) throw new Error('Release changed during verification; retry against the latest deployment');
  return { origin: base.origin, commit, publicObjects: release.files.length, checkedResponses: checked + 2 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await checkLiveSite({ origin: process.argv[2], commit: process.argv[3] });
    console.log('Verified HTTPS, public hashes, directory routes and HTTP 404: ' + JSON.stringify(result));
    console.log('This verifies the static site only; it does not validate registration, private data, Wallet or email delivery.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
