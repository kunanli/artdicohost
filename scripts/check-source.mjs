import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', '.git', '.astro', 'dist'].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(path); else files.push(path);
  }
}
await walk(root);
let count = 0;
for (const path of files) {
  const text = await readFile(path, 'utf8');
  if (/\.(mjs|js)$/.test(path)) execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' });
  if (/(ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|LTAI[A-Za-z0-9]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/.test(text)) {
    if (!path.endsWith('check-source.mjs')) throw new Error('Possible secret in ' + relative(root,path));
  }
  if (path.includes('/src/scripts/') || path.includes('\\src\\scripts\\')) {
    if (/\b(fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage)\b/.test(text)) throw new Error('Mock must not transmit or persist: ' + relative(root,path));
  }
  count++;
}
console.log('Source syntax and frontend no-transport scan passed (' + count + ' files).');
