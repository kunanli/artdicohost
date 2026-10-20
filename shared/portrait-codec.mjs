import { inflateSync } from 'node:zlib';

export const MAX_PORTRAIT_BYTES = 512 * 1024;
export const PORTRAIT_TYPES = Object.freeze({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' });
export const PORTRAIT_ID_PATTERN = /^([a-f0-9]{64})\.(jpg|png|webp)$/u;

export class PortraitCodecError extends Error {
  constructor() {
    super('头像须为有效的静态 JPEG、PNG 或 WebP，尺寸不超过 2048 × 2048。');
    this.code = 'INVALID_PORTRAIT';
    this.status = 422;
  }
}
const invalid = () => new PortraitCodecError();
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

export function normalizePortraitBytes(data, contentType) {
  if (!Buffer.isBuffer(data) || !data.length || data.length > MAX_PORTRAIT_BYTES || !Object.hasOwn(PORTRAIT_TYPES, contentType)) throw invalid();
  try { return ({ 'image/png': png, 'image/jpeg': jpeg, 'image/webp': webp })[contentType](data); }
  catch { throw invalid(); }
}

