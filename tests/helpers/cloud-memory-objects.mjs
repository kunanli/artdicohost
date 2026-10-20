import { CloudContentError } from '../../functions/cloud-content/errors.mjs';

/** Synthetic object-service contract fixture only; never imported by application code. */
export function memoryObjects() {
  const files = new Map();
  const calls = [];
  let failure = null;
  const fail = operation => { if (failure === operation) throw new Error('SYNTHETIC_PRIVATE_PROVIDER_DETAIL'); };
  return {
    files, calls,
    setFailure(value) { failure = value; },
    async get(key, { maxBytes = 1024 * 1024 } = {}) {
      calls.push({ operation: 'get', key }); fail('get');
      const item = files.get(key);
      if (!item) return null;
      if (item.data.length > maxBytes) throw new CloudContentError('STORAGE_UNAVAILABLE', '私有储存暂不可用。');
      return { ...item, data: Buffer.from(item.data) };
    },
    async putImmutable(key, data, { contentType = 'application/json' } = {}) {
      calls.push({ operation: 'putImmutable', key }); fail('putImmutable');
      const item = files.get(key);
      if (item && !item.data.equals(data)) throw new CloudContentError('STORAGE_UNAVAILABLE', '私有储存暂不可用。');
      if (!item) files.set(key, { data: Buffer.from(data), contentType, objectType: 'Normal' });
      return {};
    },
    async append(key, position, data) {
      calls.push({ operation: 'append', key }); fail('append');
      const old = files.get(key);
      if ((old?.data.length ?? 0) !== position) throw new CloudContentError('WRITE_CONFLICT', '内容已被更新，请重新载入。', 409);
      files.set(key, { data: Buffer.concat([old?.data ?? Buffer.alloc(0), data]), objectType: 'Appendable', contentType: 'application/x-ndjson' });
      return { nextPosition: position + data.length };
    },
  };
}
