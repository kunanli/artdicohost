import qrcode from './vendor/qrcode.mjs';
import { crc32, deflateSync } from 'node:zlib';

const chunk = (kind, bytes) => {
  const type = Buffer.from(kind, 'ascii'), size = Buffer.alloc(4), crc = Buffer.alloc(4);
  size.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(Buffer.concat([type, bytes])) >>> 0);
  return Buffer.concat([size, type, bytes, crc]);
};

/** Local QR generation: private capabilities never reach an external image service. */
export function encodeQrPng(value) {
  if (typeof value !== 'string' || value.length > 256 || !/^https:\/\/(?:api\.)?artdico\.host\/[\x21-\x7e]+$/u.test(value)) throw new Error('Invalid entry QR URL');
  const target = new URL(value);
  if (target.username || target.password || target.port || !['artdico.host', 'api.artdico.host'].includes(target.hostname)) throw new Error('Invalid entry QR URL');
  const qr = qrcode(0, 'M'); qr.addData(value, 'Byte'); qr.make();
  const count = qr.getModuleCount(), scale = 8, quiet = 4, width = (count + 2 * quiet) * scale;
  if (width > 800) throw new Error('Entry QR exceeds image budget');
  const pixels = Buffer.alloc((width + 1) * width, 255);
  for (let y = 0; y < width; y++) {
    pixels[y * (width + 1)] = 0;
    const row = Math.floor(y / scale) - quiet;
    for (let x = 0; x < width; x++) {
      const col = Math.floor(x / scale) - quiet;
      if (row >= 0 && row < count && col >= 0 && col < count && qr.isDark(row, col)) pixels[y * (width + 1) + x + 1] = 0;
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(width, 4); header[8] = 8;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
