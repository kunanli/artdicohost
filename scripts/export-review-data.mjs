// Optional review aid: export only the built public HTML/CSS/JS, never environment files or local data.
import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const dist = resolve(root, 'dist');
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.isFile() && /\.(?:html|css|js)$/u.test(entry.name)) {
      const data = (await readFile(path)).toString('base64');
      const total = Math.ceil(data.length / 12000);
      for (let index = 0; index < total; index += 1) {
        console.log('ARTDICO_REVIEW ' + JSON.stringify({ path: relative(root, path).replaceAll('\\', '/'), index, total, data: data.slice(index * 12000, (index + 1) * 12000) }));
      }
    }
  }
}
await walk(dist);

