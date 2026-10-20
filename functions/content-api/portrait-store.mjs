import { constants } from 'node:fs';
import { mkdir, lstat, realpath, open, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { MAX_PORTRAIT_BYTES, normalizePortraitBytes } from '../../shared/portrait-codec.mjs';
export { MAX_PORTRAIT_BYTES } from '../../shared/portrait-codec.mjs';
import { ContentError } from './store.mjs';

const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const ID = /^([a-f0-9]{64})\.(jpg|png|webp)$/u;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const hash = data => createHash('sha256').update(data).digest('hex');
const invalid = () => new ContentError('INVALID_PORTRAIT', '头像须为有效的静态 JPEG、PNG 或 WebP，尺寸不超过 2048 × 2048。', 422);
const unavailable = () => new ContentError('PORTRAIT_UNAVAILABLE', '头像文件不可读取，请重新上传并保存。', 503);
function normalize(data, contentType) {
  try { return normalizePortraitBytes(data, contentType); } catch { throw invalid(); }
}

/** Local files only. The API must separately enforce draft/publication authorization. */
export function createFilePortraitStore({ directory }) {
  if (typeof directory !== 'string' || !directory) throw new TypeError('必须指定本地头像目录。');
  const root = resolve(directory, 'portraits');
  async function checkedRoot() {
    try { await mkdir(root, { recursive: true, mode: 0o700 }); const info = await lstat(root); if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o077 || await realpath(root) !== root) throw unavailable(); }
    catch { throw unavailable(); }
  }
  async function read(id) {
    if (typeof id !== 'string' || !ID.test(id)) throw new ContentError('INVALID_PORTRAIT_ID', '头像标识无效。', 422);
    await checkedRoot();
    let handle;
    try {
      handle = await open(join(root, id), constants.O_RDONLY | constants.O_NOFOLLOW);
      const info = await handle.stat();
      if (!info.isFile() || info.mode & 0o077 || info.size < 1 || info.size > MAX_PORTRAIT_BYTES) throw unavailable();
      const bounded = Buffer.alloc(MAX_PORTRAIT_BYTES + 1); let length = 0;
      while (length < bounded.length) { const part = await handle.read(bounded, length, bounded.length - length, length); if (!part.bytesRead) break; length += part.bytesRead; }
      const data = bounded.subarray(0, length), contentType = Object.keys(TYPES).find(type => TYPES[type] === id.split('.')[1]);
      if (data.length !== info.size || hash(data) !== id.slice(0, 64) || !normalize(data, contentType).equals(data)) throw unavailable();
      return { data, contentType, bytes: data.length };
    } catch (error) {
      if (error.code === 'ENOENT') throw new ContentError('NOT_FOUND', '头像不存在。', 404);
      throw unavailable();
    } finally { await handle?.close().catch(() => {}); }
  }
  return {
    read,
    verify: async id => { const { contentType, bytes } = await read(id); return { id, contentType, bytes }; },
    upload: async ({ contentType, dataBase64 } = {}) => {
      if (typeof contentType !== 'string' || !Object.hasOwn(TYPES, contentType) || typeof dataBase64 !== 'string' || !dataBase64) throw invalid();
      if (dataBase64.length > Math.ceil(MAX_PORTRAIT_BYTES / 3) * 4) throw new ContentError('PORTRAIT_TOO_LARGE', '头像文件请控制在 512 KiB 以内。', 413);
      if (!BASE64.test(dataBase64)) throw invalid();
      const raw = Buffer.from(dataBase64, 'base64');
      if (raw.length > MAX_PORTRAIT_BYTES) throw new ContentError('PORTRAIT_TOO_LARGE', '头像文件请控制在 512 KiB 以内。', 413);
      if (raw.toString('base64') !== dataBase64) throw invalid();
      const data = normalize(raw, contentType), id = `${hash(data)}.${TYPES[contentType]}`;
      await checkedRoot();
      let handle, created = false, complete = false;
      try { handle = await open(join(root, id), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); created = true; await handle.writeFile(data); await handle.sync(); complete = true; }
      catch (error) { if (error.code !== 'EEXIST') throw unavailable(); }
      finally { await handle?.close().catch(() => {}); if (created && !complete) await unlink(join(root, id)).catch(() => {}); }
      const checked = await read(id);
      return { id, contentType: checked.contentType, bytes: checked.bytes };
    },
  };
}
