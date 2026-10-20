import { constants } from 'node:fs';
import { mkdir, lstat, realpath, open, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { ContentError } from './store.mjs';

export const MAX_PORTRAIT_BYTES = 512 * 1024;
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const ID = /^([a-f0-9]{64})\.(jpg|png|webp)$/u;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const hash = data => createHash('sha256').update(data).digest('hex');
const invalid = () => new ContentError('INVALID_PORTRAIT', '头像须为有效的静态 JPEG、PNG 或 WebP，尺寸不超过 2048 × 2048。', 422);
const unavailable = () => new ContentError('PORTRAIT_UNAVAILABLE', '头像文件不可读取，请重新上传并保存。', 503);
function dimensions(width, height) { if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 2048 || height > 2048) throw invalid(); }
const crcTable = Array.from({ length: 256 }, (_, value) => { for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1; return value >>> 0; });
function crc32(data) { let value = 0xffffffff; for (const byte of data) value = crcTable[(value ^ byte) & 255] ^ value >>> 8; return (value ^ 0xffffffff) >>> 0; }

// Validate static image structure and dimensions; this is not a full image codec.
// Rebuild only rendering chunks/segments, dropping EXIF, comments and other metadata.
function png(data) {
  if (!data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw invalid();
  let offset = 8, width, height, channels, seenData = false, ended = false, palette = false;
  const output = [data.subarray(0, 8)], compressed = [];
  while (offset < data.length) {
    if (offset + 12 > data.length) throw invalid();
    const length = data.readUInt32BE(offset), end = offset + length + 12;
    if (end > data.length) throw invalid();
    const type = data.toString('ascii', offset + 4, offset + 8), body = data.subarray(offset + 8, end - 4);
    if (!/^[A-Za-z]{4}$/u.test(type) || crc32(data.subarray(offset + 4, end - 4)) !== data.readUInt32BE(end - 4)) throw invalid();
    if (offset === 8 && type !== 'IHDR' || ['acTL','fcTL','fdAT'].includes(type)) throw invalid();
    if (type === 'IHDR') {
      if (width !== undefined || length !== 13 || body[8] !== 8 || body[10] || body[11] || body[12]) throw invalid();
      width = body.readUInt32BE(0); height = body.readUInt32BE(4); dimensions(width, height);
      channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[body[9]];
      if (!channels) throw invalid();
    } else if (type === 'PLTE') { if (seenData || !length || length % 3 || length > 768 || palette) throw invalid(); palette = true; }
    else if (type === 'IDAT') { if (!length || ended || data[25] === 3 && !palette) throw invalid(); seenData = true; compressed.push(body); }
    else if (type === 'IEND') { if (length || !seenData || end !== data.length) throw invalid(); ended = true; }
    else if (type === 'tRNS') { if (seenData || !length || length > 256) throw invalid(); }
    else if (type[0] === type[0].toUpperCase()) throw invalid();
    if (['IHDR','PLTE','tRNS','IDAT','IEND'].includes(type)) output.push(data.subarray(offset, end));
    offset = end;
  }
  if (!ended) throw invalid();
  const row = width * channels + 1, expected = row * height;
  let raw;
  try { raw = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected }); } catch { throw invalid(); }
  if (raw.length !== expected) throw invalid();
  for (let line = 0; line < height; line++) if (raw[line * row] > 4) throw invalid();
  return Buffer.concat(output);
}

function jpeg(data) {
  if (data.length < 4 || data.readUInt16BE(0) !== 0xffd8) throw invalid();
  const output = [data.subarray(0, 2)];
  let offset = 2, frame = false, scan = false, segments = 0;
  while (offset < data.length && ++segments < 4096) {
    const start = offset;
    if (data[offset++] !== 255) throw invalid();
    while (data[offset] === 255) offset++;
    const marker = data[offset++];
    if (marker === 0xd9) { if (!frame || !scan || offset !== data.length) throw invalid(); output.push(Buffer.from([255, marker])); return Buffer.concat(output); }
    if (![0xc0,0xc2,0xc4,0xdb,0xdd,0xda,0xfe].includes(marker) && !(marker >= 0xe0 && marker <= 0xef)) throw invalid();
    if (offset + 2 > data.length) throw invalid();
    const segment = offset, length = data.readUInt16BE(offset), end = offset + length;
    if (length < 2 || end > data.length) throw invalid();
    if (marker === 0xc0 || marker === 0xc2) {
      if (frame || length < 11 || data[offset + 2] !== 8 || ![1,3].includes(data[offset + 7]) || length !== 8 + 3 * data[offset + 7]) throw invalid();
      dimensions(data.readUInt16BE(offset + 5), data.readUInt16BE(offset + 3)); frame = true;
    }
    if (!(marker >= 0xe0 && marker <= 0xef) && marker !== 0xfe) output.push(data.subarray(start, end));
    offset = end;
    if (marker === 0xda) {
      if (!frame || length < 8 || length !== 6 + 2 * data[segment + 2]) throw invalid();
      scan = true;
      const entropy = offset;
      while (offset < data.length) {
        if (data[offset] === 255 && data[offset + 1] !== 0 && !(data[offset + 1] >= 0xd0 && data[offset + 1] <= 0xd7)) break;
        offset += data[offset] === 255 ? 2 : 1;
      }
      if (offset === entropy) throw invalid();
      output.push(data.subarray(entropy, offset));
    }
  }
  throw invalid();
}

function webp(data) {
  if (data.length < 20 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WEBP' || data.readUInt32LE(4) + 8 !== data.length) throw invalid();
  const output = [], uint24 = (body, offset) => body[offset] | body[offset + 1] << 8 | body[offset + 2] << 16;
  let offset = 12, frame = false, extended, size;
  while (offset < data.length) {
    if (offset + 8 > data.length) throw invalid();
    const type = data.toString('ascii', offset, offset + 4), length = data.readUInt32LE(offset + 4), end = offset + 8 + length + (length & 1);
    if (end > data.length) throw invalid();
    const body = Buffer.from(data.subarray(offset + 8, offset + 8 + length));
    if (type === 'VP8X') {
      if (offset !== 12 || length !== 10 || body[0] & 0xc3 || body[1] || body[2] || body[3]) throw invalid();
      extended = [uint24(body, 4) + 1, uint24(body, 7) + 1]; dimensions(...extended); body[0] &= 0x10;
    } else if (type === 'VP8 ') {
      if (frame || length < 10 || body[0] & 1 || !body.subarray(3, 6).equals(Buffer.from([157,1,42]))) throw invalid();
      size = [body.readUInt16LE(6) & 0x3fff, body.readUInt16LE(8) & 0x3fff]; frame = true;
    } else if (type === 'VP8L') {
      if (frame || length < 5 || body[0] !== 47 || body.readUInt32LE(1) >>> 29) throw invalid();
      const bits = body.readUInt32LE(1); size = [(bits & 0x3fff) + 1, (bits >>> 14 & 0x3fff) + 1]; frame = true;
    } else if (type === 'ALPH') { if (!extended || frame || !length) throw invalid(); }
    else if (!['ICCP','EXIF','XMP '].includes(type)) throw invalid();
    if (!['ICCP','EXIF','XMP '].includes(type)) { const header = Buffer.alloc(8); header.write(type); header.writeUInt32LE(length, 4); output.push(header, body, ...(length & 1 ? [Buffer.from([0])] : [])); }
    offset = end;
  }
  if (!frame) throw invalid();
  dimensions(...size);
  if (extended && extended.some((dimension, index) => dimension !== size[index])) throw invalid();
  const bytes = Buffer.concat(output), header = Buffer.from('RIFF\0\0\0\0WEBP'); header.writeUInt32LE(bytes.length + 4, 4);
  return Buffer.concat([header, bytes]);
}

function normalize(data, contentType) {
  try { return ({ 'image/png': png, 'image/jpeg': jpeg, 'image/webp': webp })[contentType](data); }
  catch { throw invalid(); }
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
