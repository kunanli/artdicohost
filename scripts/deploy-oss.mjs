import { readFile, readdir, lstat, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sha256, validatePublicPath, MAX_FILE_BYTES, PUBLIC_ADMIN_PAGE_ALIASES } from './prepare-oss-site.mjs';

export const OSS_BUCKET = 'artdicohost-web-hk';
export const OSS_ENDPOINT = 'https://oss-cn-hongkong.aliyuncs.com';
export const OSS_REGION = 'cn-hongkong';

export function requireDeploymentContext(env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF !== 'refs/heads/main' || env.GITHUB_REPOSITORY !== 'kunanli/artdicohost' || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '')) throw new Error('Only a main push in kunanli/artdicohost may deploy');
  if (!env.OSS_ACCESS_KEY_ID || !env.OSS_ACCESS_KEY_SECRET) throw new Error('Set ARTDICO_OSS_ACCESS_KEY_ID and ARTDICO_OSS_ACCESS_KEY_SECRET in GitHub Actions secrets');
}

export function contentType(path) {
  const extension = path.split('.').pop().toLowerCase();
  return { html: 'text/html; charset=utf-8', json: 'application/json; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', png: 'image/png', svg: 'image/svg+xml', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', woff: 'font/woff', woff2: 'font/woff2', ico: 'image/x-icon' }[extension];
}

export function uploadOrder(files) {
  const rank = path => path === 'release.json' ? 3 : path === 'index.html' ? 2 : path.endsWith('.html') ? 1 : 0;
  return [...files].sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path));
}

export async function verifyPublication(directory, expectedCommit) {
  const manifest = JSON.parse(await readFile(resolve(directory, 'publication-manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.commit !== expectedCommit || manifest.bucket !== OSS_BUCKET || manifest.region !== OSS_REGION || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Publication identity does not match this checked commit');
  const actual = [];
  async function walk(path, prefix = '') {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isSymbolicLink()) throw new Error('Publication contains a symbolic link');
      if (entry.isDirectory()) await walk(resolve(path, entry.name), relative + '/');
      else if (entry.isFile()) actual.push(relative);
      else throw new Error('Unexpected publication entry');
    }
  }
  await walk(directory);
  const expected = manifest.files.map(item => validatePublicPath(item.path));
  if (new Set(expected).size !== expected.length || JSON.stringify(actual.sort()) !== JSON.stringify([...expected, 'publication-manifest.json'].sort())) throw new Error('Publication file list differs from manifest');
  for (const item of manifest.files) {
    const stat = await lstat(resolve(directory, item.path));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES || stat.size !== item.bytes || sha256(await readFile(resolve(directory, item.path))) !== item.sha256) throw new Error('Publication checksum mismatch');
  }
  for (const path of ['index.html', '404.html', 'invitation/index.html', 'registration/confirmation/index.html', 'admin/index.html', 'admin/contacts/index.html', 'invitations/template-blank.png', 'invitations/ggj2026-poster-v2.webp', 'release.json',
    ...PUBLIC_ADMIN_PAGE_ALIASES.map(route => route.slice(1) + 'index.html')]) if (!expected.includes(path)) throw new Error('Required public route missing');
  const release = JSON.parse(await readFile(resolve(directory, 'release.json'), 'utf8'));
  if (release.schemaVersion !== 1 || release.commit !== expectedCommit || JSON.stringify(release.files) !== JSON.stringify(manifest.files.filter(item => item.path !== 'release.json'))) throw new Error('Public release receipt differs from publication');
  return manifest;
}

export function putObjectArgs(directory, item) {
  return ['api', 'put-object', '--bucket', OSS_BUCKET, '--key', item.path, '--body', 'file://' + resolve(directory, item.path), '--content-type', contentType(item.path), '--cache-control', 'public,no-cache', '--region', OSS_REGION, '--endpoint', OSS_ENDPOINT];
}

export async function assertCurrentMainHead(env, fetchHead = fetch) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (env.GITHUB_TOKEN) headers.Authorization = 'Bearer ' + env.GITHUB_TOKEN;
  let head;
  try {
    const response = await fetchHead('https://api.github.com/repos/kunanli/artdicohost/git/ref/heads/main', { headers, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error('Head unavailable');
    head = (await response.json()).object?.sha;
  } catch {
    throw new Error('Cannot verify the current main commit; no objects were uploaded');
  }
  if (head !== env.GITHUB_SHA) throw new Error('This run is older than the current main commit; no objects were uploaded');
}

export async function deploy({ directory, binary, env = process.env, execute = spawnSync, fetchObject = fetch, fetchHead = fetch } = {}) {
  requireDeploymentContext(env);
  const manifest = await verifyPublication(directory, env.GITHUB_SHA);
  await assertCurrentMainHead(env, fetchHead);
  const { GITHUB_TOKEN, ...uploadEnv } = env;
  for (const item of uploadOrder(manifest.files)) {
    const result = execute(binary, putObjectArgs(directory, item), { env: uploadEnv, encoding: 'utf8', timeout: 120_000, stdio: 'pipe' });
    // Never echo raw CLI diagnostics: authentication errors may contain request details.
    if (result.error || result.status !== 0) throw new Error('OSS upload failed for ' + item.path + '; inspect the RAM policy and secret configuration.');
    const url = 'https://' + OSS_BUCKET + '.oss-cn-hongkong.aliyuncs.com/' + item.path.split('/').map(encodeURIComponent).join('/');
    let verified = false;
    for (let attempt = 0; attempt < 3 && !verified; attempt++) {
      try {
        const response = await fetchObject(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20_000) });
        verified = response.ok && sha256(Buffer.from(await response.arrayBuffer())) === item.sha256;
      } catch { /* Retry transient public readback failures without logging request data. */ }
    }
    if (!verified) throw new Error('Public readback verification failed for ' + item.path);
    console.log('Verified ' + item.path);
  }
  const summary = 'Published and SHA-256 verified ' + manifest.files.length + ' public objects in `' + OSS_BUCKET + '` from commit `' + env.GITHUB_SHA + '`.\n\nBrowser access still requires a bound custom domain and valid HTTPS; the default OSS endpoint may download HTML. No backend or private data was deployed.\n';
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, summary);
  return { commit: env.GITHUB_SHA, files: manifest.files.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await deploy({ directory: resolve(process.argv[2] ?? '.local-data/oss-publish'), binary: process.argv[3] ?? 'ossutil' });
