import { createHash } from 'node:crypto';
import { MAX_PORTRAIT_BYTES, PORTRAIT_TYPES, PORTRAIT_ID_PATTERN, normalizePortraitBytes } from '../../shared/portrait-codec.mjs';
import { CloudContentError } from './errors.mjs';

export { MAX_PORTRAIT_BYTES } from '../../shared/portrait-codec.mjs';
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const PREFIX = 'cms/v1/portraits/';
const hash = data => createHash('sha256').update(data).digest('hex');
const invalid = () => new CloudContentError('INVALID_PORTRAIT', '头像须为有效的静态 JPEG、PNG 或 WebP，尺寸不超过 2048 × 2048。', 422);
const unavailable = () => new CloudContentError('PORTRAIT_UNAVAILABLE', '头像文件不可读取，请重新上传并保存。', 503);
function normalized(data, contentType) { try { return normalizePortraitBytes(data, contentType); } catch { throw invalid(); } }

/** Private objects only. HTTP callers must separately enforce current-publication and staff access. */
export function createOssPortraitStore({ objects } = {}) {
  if (!objects || typeof objects.get !== 'function' || typeof objects.putImmutable !== 'function') throw new TypeError('云端头像需要明确的私有对象存储。');
  async function read(id) {
    if (typeof id !== 'string' || !PORTRAIT_ID_PATTERN.test(id)) throw new CloudContentError('INVALID_PORTRAIT_ID', '头像标识无效。', 422);
    let result;
    try { result = await objects.get(PREFIX + id, { maxBytes: MAX_PORTRAIT_BYTES }); } catch { throw unavailable(); }
    if (result === null) throw new CloudContentError('NOT_FOUND', '头像不存在。', 404);
    try {
      const data = Buffer.isBuffer(result?.data) ? Buffer.from(result.data) : null;
      const contentType = Object.keys(PORTRAIT_TYPES).find(type => PORTRAIT_TYPES[type] === id.split('.')[1]);
      if (!data || !data.length || data.length > MAX_PORTRAIT_BYTES || result.objectType !== 'Normal' || result.contentType !== contentType
        || hash(data) !== id.slice(0, 64) || !normalized(data, contentType).equals(data)) throw unavailable();
      return { data, contentType, bytes: data.length };
    } catch { throw unavailable(); }
  }
  return {
    read,
    verify: async id => { const { contentType, bytes } = await read(id); return { id, contentType, bytes }; },
    upload: async ({ contentType, dataBase64 } = {}) => {
      if (typeof contentType !== 'string' || !Object.hasOwn(PORTRAIT_TYPES, contentType) || typeof dataBase64 !== 'string' || !dataBase64) throw invalid();
      if (dataBase64.length > Math.ceil(MAX_PORTRAIT_BYTES / 3) * 4) throw new CloudContentError('PORTRAIT_TOO_LARGE', '头像文件请控制在 512 KiB 以内。', 413);
      if (!BASE64.test(dataBase64)) throw invalid();
      const raw = Buffer.from(dataBase64, 'base64');
      if (raw.length > MAX_PORTRAIT_BYTES) throw new CloudContentError('PORTRAIT_TOO_LARGE', '头像文件请控制在 512 KiB 以内。', 413);
      if (raw.toString('base64') !== dataBase64) throw invalid();
      const data = normalized(raw, contentType), id = `${hash(data)}.${PORTRAIT_TYPES[contentType]}`;
      try { await objects.putImmutable(PREFIX + id, data, { contentType }); }
      catch { throw unavailable(); }
      const checked = await read(id);
      if (!checked.data.equals(data)) throw unavailable();
      return { id, contentType: checked.contentType, bytes: checked.bytes };
    },
  };
}
