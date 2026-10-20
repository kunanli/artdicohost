/** Small, uncompressed private ZIPs. No network, storage, or download side effects. */
export const PRIVATE_INVITATION_ZIP_LIMIT = 64 * 1024 * 1024;
export const PRIVATE_INVITATION_ZIP_MAX_ENTRIES = 102; // 100 PNGs + two private checklists.
const encoder = new TextEncoder();
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export function crc32(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('ZIP bytes required.');
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** The counter and stable ID keep repeated/sanitized names distinct on Windows too. */
export function privateInvitationFilename(recipientName, contactId, index) {
  if (typeof recipientName !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(contactId)
    || !Number.isSafeInteger(index) || index < 0 || index >= 100) throw new TypeError('Invalid invitation filename input.');
  const name = Array.from(recipientName.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>:"/\\|?*]/gu, '_')
    .replace(/\.+/gu, '_').replace(/\s+/gu, ' ').trim()).slice(0, 60).join('') || '邀请函';
  return String(index + 1).padStart(3, '0') + '-' + name + '-' + contactId + '.png';
}
function nameBytes(name) {
  if (typeof name !== 'string' || !name || name.length > 240 || name !== name.normalize('NFKC')
    || /^[. ]|[. ]$/u.test(name) || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>:"/\\|?*]/u.test(name)
    || /(^|\.)\.{2}(\.|$)/u.test(name) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name)) throw new TypeError('Unsafe ZIP filename.');
  const bytes = encoder.encode(name);
  if (bytes.length > 1024) throw new RangeError('ZIP filename is too long.');
  return bytes;
}
function sizeOf(data) {
  if (data instanceof Blob) return data.size;
  if (data instanceof Uint8Array) return data.byteLength;
  throw new TypeError('ZIP entry must be a Blob or Uint8Array.');
}
export function privateZipEntryBytes(name, dataSize) {
  if (!Number.isSafeInteger(dataSize) || dataSize < 0 || dataSize > PRIVATE_INVITATION_ZIP_LIMIT) throw new RangeError('ZIP entry is too large.');
  return 30 + 46 + nameBytes(name).length * 2 + dataSize;
}
function header(length) { const bytes = new Uint8Array(length); return { bytes, view: new DataView(bytes.buffer) }; }

/** Bounds every entry before reading data. Uses immutable Blob pieces, one CRC buffer at a time. */
export async function createPrivateInvitationZip(entries, { maxBytes = PRIVATE_INVITATION_ZIP_LIMIT } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 22 || maxBytes > PRIVATE_INVITATION_ZIP_LIMIT) throw new RangeError('Invalid private ZIP limit.');
  if (!Array.isArray(entries) || entries.length > PRIVATE_INVITATION_ZIP_MAX_ENTRIES) throw new RangeError('Too many ZIP entries.');
  const names = new Set();
  let estimated = 22;
  const checked = entries.map(entry => {
    if (!entry || typeof entry !== 'object') throw new TypeError('Invalid ZIP entry.');
    const name = nameBytes(entry.name), normalized = entry.name.toLowerCase();
    if (names.has(normalized)) throw new TypeError('Duplicate ZIP filename.');
    names.add(normalized);
    const size = sizeOf(entry.data);
    estimated += privateZipEntryBytes(entry.name, size);
    if (estimated > maxBytes) throw new RangeError('Private ZIP size limit exceeded.');
    return { ...entry, name, size };
  });
  const chunks = [], central = [];
  let offset = 0, centralSize = 0;
  for (const entry of checked) {
    // Clone mutable arrays before an await; Blob data is immutable.
    const bytes = entry.data instanceof Uint8Array ? entry.data.slice() : new Uint8Array(await entry.data.arrayBuffer());
    if (bytes.length !== entry.size) throw new TypeError('ZIP entry size changed.');
    const checksum = crc32(bytes), local = header(30), directory = header(46);
    local.view.setUint32(0, 0x04034b50, true); local.view.setUint16(4, 20, true); local.view.setUint16(6, 0x0800, true);
    local.view.setUint16(12, 33, true); // 1980-01-01; deterministic, no private local timestamp.
    local.view.setUint32(14, checksum, true); local.view.setUint32(18, entry.size, true); local.view.setUint32(22, entry.size, true);
    local.view.setUint16(26, entry.name.length, true);
    directory.view.setUint32(0, 0x02014b50, true); directory.view.setUint16(4, 0x0314, true); directory.view.setUint16(6, 20, true);
    directory.view.setUint16(8, 0x0800, true); directory.view.setUint16(14, 33, true); directory.view.setUint32(16, checksum, true);
    directory.view.setUint32(20, entry.size, true); directory.view.setUint32(24, entry.size, true); directory.view.setUint16(28, entry.name.length, true);
    directory.view.setUint32(38, (0o100600 << 16) >>> 0, true); directory.view.setUint32(42, offset, true);
    chunks.push(local.bytes, entry.name, new Blob([bytes])); central.push(directory.bytes, entry.name);
    offset += local.bytes.length + entry.name.length + entry.size;
    centralSize += directory.bytes.length + entry.name.length;
  }
  const end = header(22);
  end.view.setUint32(0, 0x06054b50, true); end.view.setUint16(8, checked.length, true); end.view.setUint16(10, checked.length, true);
  end.view.setUint32(12, centralSize, true); end.view.setUint32(16, offset, true);
  const blob = new Blob([...chunks, ...central, end.bytes], { type: 'application/zip' });
  if (blob.size !== estimated || blob.size > maxBytes) throw new RangeError('Private ZIP size limit exceeded.');
  return blob;
}
