import { createHash, createPrivateKey, X509Certificate } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { derChildren, oid, signManifest } from './der.mjs';

// Apple publishes these SHA-256 roots at https://support.apple.com/en-us/126047 .
export const APPLE_ROOT_FINGERPRINTS = Object.freeze([
  'b0b1730ecbc7ff4505142c49f1295e6eda6bcaed7e2c68c5be91b5a11001f024',
  'c2b9b042dd57830e7d117d7ac55ac8a19407d38e41d88f3215bc3a890444a050',
  '63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179',
]);
export class WalletSigningError extends Error {
  constructor(code = 'WALLET_SIGNING_UNAVAILABLE') { super('Wallet signing configuration could not be verified.'); this.code = code; }
}
const fail = code => { throw new WalletSigningError(code); };
const line = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && value.isWellFormed() && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value);
const fingerprint = certificate => createHash('sha256').update(certificate.raw).digest('hex');
function certificate(value) {
  if (!(value instanceof Uint8Array) || value.length < 128 || value.length > 24 * 1024) fail('WALLET_CERTIFICATE_INVALID');
  try { return new X509Certificate(value); } catch { fail('WALLET_CERTIFICATE_INVALID'); }
}
function active(cert, now) { return Date.parse(cert.validFrom) <= now && now < Date.parse(cert.validTo); }
function subjectField(cert, key, expected) { return cert.subject.split('\n').some(value => value === key + '=' + expected); }
function passMarker(cert, identifier) {
  try {
    const tbs = derChildren(cert.raw)[0], extension = derChildren(tbs.data).find(value => value.tag === 0xa3);
    if (!extension) return false;
    const containers = derChildren(extension.data, 0xa3); if (containers.length !== 1 || containers[0].tag !== 0x30) return false;
    const marker = derChildren(containers[0].data).map(value => derChildren(value.data))
      .find(value => value[0]?.data.equals(oid('1.2.840.113635.100.6.1.16')));
    const encoded = marker?.at(-1); if (encoded?.tag !== 4) return false;
    const contains = (values, depth = 0) => depth <= 3 && values.some(value => [0x0c, 0x13, 0x16].includes(value.tag)
      ? new TextDecoder('utf-8', { fatal: true }).decode(value.body) === identifier
      : [0x30, 0x31].includes(value.tag) && contains(derChildren(value.data, value.tag), depth + 1));
    return contains(derChildren(encoded.data, 4));
  } catch { return false; }
}

/** Production roots are pinned. The explicit fingerprint argument exists only for offline synthetic certificate fixtures. */
export function validateSigningIdentity({ certificate: certData, key, wwdr: wwdrData, root: rootData, passphrase, teamId, passTypeIdentifier,
  now = Date.now(), trustedRootFingerprints = APPLE_ROOT_FINGERPRINTS } = {}) {
  if (!Number.isSafeInteger(now) || !/^[A-Z0-9]{10}$/u.test(teamId ?? '') || !/^pass\.[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)+$/u.test(passTypeIdentifier ?? '')
    || passTypeIdentifier.length > 200 || !Array.isArray(trustedRootFingerprints) || !trustedRootFingerprints.length) fail('WALLET_IDENTITY_INVALID');
  const cert = certificate(certData), wwdr = certificate(wwdrData), root = certificate(rootData);
  if (![cert, wwdr, root].every(cert => active(cert, now))) fail('WALLET_CERTIFICATE_EXPIRED');
  if (cert.ca || !wwdr.ca || !root.ca || !trustedRootFingerprints.includes(fingerprint(root))
    || !root.checkIssued(root) || !root.verify(root.publicKey) || !wwdr.checkIssued(root) || !wwdr.verify(root.publicKey)
    || !cert.checkIssued(wwdr) || !cert.verify(wwdr.publicKey)) fail('WALLET_CERTIFICATE_CHAIN_INVALID');
  if (!subjectField(cert, 'UID', passTypeIdentifier) || !subjectField(cert, 'OU', teamId)) fail('WALLET_CERTIFICATE_ID_MISMATCH');
  if (!passMarker(cert, passTypeIdentifier) || !cert.keyUsage?.includes('1.2.840.113635.100.4.14')) fail('WALLET_CERTIFICATE_TYPE_INVALID');
  if (!(key instanceof Uint8Array) || key.length < 128 || key.length > 24 * 1024
    || passphrase !== undefined && !line(passphrase, 1024)) fail('WALLET_PRIVATE_KEY_INVALID');
  let privateKey;
  try { privateKey = createPrivateKey({ key: Buffer.from(key), format: 'pem', ...(passphrase ? { passphrase } : {}) }); }
  catch { fail('WALLET_PRIVATE_KEY_INVALID'); }
  if (!['rsa', 'ec'].includes(privateKey.asymmetricKeyType) || !cert.checkPrivateKey(privateKey)
    || privateKey.asymmetricKeyType === 'rsa' && privateKey.asymmetricKeyDetails?.modulusLength < 2048
    || privateKey.asymmetricKeyType === 'ec' && !['prime256v1', 'secp384r1'].includes(privateKey.asymmetricKeyDetails?.namedCurve)) fail('WALLET_PRIVATE_KEY_INVALID');
  return Object.freeze({ certificate: cert.raw, wwdr: wwdr.raw, privateKey, teamId, passTypeIdentifier,
    expiresAt: new Date(Math.min(...[cert, wwdr, root].map(value => Date.parse(value.validTo)))).toISOString() });
}

const table = Array.from({ length: 256 }, (_, value) => { for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1; return value >>> 0; });
function crc32(data) { let value = 0xffffffff; for (const byte of data) value = table[(value ^ byte) & 255] ^ value >>> 8; return (value ^ 0xffffffff) >>> 0; }
function pngChunk(type, body) {
  const name = Buffer.from(type, 'ascii'), output = Buffer.alloc(body.length + 12);
  output.writeUInt32BE(body.length); name.copy(output, 4); body.copy(output, 8); output.writeUInt32BE(crc32(Buffer.concat([name, body])), output.length - 4); return output;
}
/** Small local brand monogram, not an Apple badge or external image request. */
function icon(size) {
  const bitmap = ['01110', '11011', '11011', '11111', '11011', '11011', '11011'];
  const data = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const cellX = Math.floor((x / size - .2) / .6 * 5), cellY = Math.floor((y / size - .15) / .7 * 7);
    const white = cellX >= 0 && cellX < 5 && cellY >= 0 && cellY < 7 && bitmap[cellY][cellX] === '1';
    const at = y * (size * 4 + 1) + 1 + x * 4;
    data.set(white ? [255,255,255,255] : [20,72,239,255], at);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(data)), pngChunk('IEND', Buffer.alloc(0))]);
}

/** Fixed top-level files only, stored ZIP entries with checked CRC and regular file modes. */
export function createPassArchive(files, now) {
  if (!Array.isArray(files) || files.length < 4 || files.length > 12 || !Number.isSafeInteger(now)) fail();
  const date = new Date(now), year = date.getUTCFullYear();
  if (year < 1980 || year > 2107) fail();
  const dosDate = (year - 1980) << 9 | (date.getUTCMonth() + 1) << 5 | date.getUTCDate();
  const dosTime = date.getUTCHours() << 11 | date.getUTCMinutes() << 5 | Math.floor(date.getUTCSeconds() / 2);
  const local = [], central = [], names = new Set(); let offset = 0;
  for (const file of files) {
    if (!file || !/^(?:pass\.json|manifest\.json|signature|icon(?:@2x|@3x)?\.png)$/u.test(file.name ?? '') || names.has(file.name)
      || !(file.data instanceof Uint8Array) || !file.data.length || file.data.length > 256 * 1024) fail();
    names.add(file.name); const name = Buffer.from(file.name), data = Buffer.from(file.data), crc = crc32(data);
    const header = Buffer.alloc(30 + name.length); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(dosTime, 10); header.writeUInt16LE(dosDate, 12); header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26); name.copy(header, 30);
    const directory = Buffer.alloc(46 + name.length); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(0x0314, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x0800, 8);
    directory.writeUInt16LE(dosTime, 12); directory.writeUInt16LE(dosDate, 14); directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(0o100644 * 65536, 38); directory.writeUInt32LE(offset, 42); name.copy(directory, 46);
    local.push(header, data); central.push(directory); offset += header.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  const archive = Buffer.concat([...local, directory, end]); if (archive.length > 1024 * 1024) fail(); return archive;
}

export function buildAppleWalletPass({ identity, attendee, organizationName, verificationUrl, now = Date.now() } = {}) {
  const event = attendee?.event;
  if (!identity?.privateKey || attendee?.admissionStatus !== 'confirmed' || !/^[A-Za-z0-9_-]{43}$/u.test(attendee.registrationId ?? '')
    || attendee.referenceCode !== attendee.registrationId
    || !line(attendee.name, 160) || !line(organizationName, 80) || !line(event?.id, 80) || !line(event?.title, 300)
    || !/^\d{4}-\d{2}-\d{2}$/u.test(event?.date ?? '') || !line(event?.time, 100) || !line(event?.venue, 500)
    || !['Asia/Shanghai', 'Asia/Taipei', 'Asia/Hong_Kong'].includes(event?.timezone) || !line(verificationUrl, 2048)) fail('WALLET_PASS_INPUT_INVALID');
  let url;
  try { url = new URL(verificationUrl); } catch { fail('WALLET_PASS_INPUT_INVALID'); }
  if (url.origin !== 'https://api.artdico.host' || !['/api/registration/wallet/verify/', '/api/admin/registration/wallet/verify/'].some(prefix => url.pathname.startsWith(prefix)) || url.search || url.hash || url.username || url.password) fail('WALLET_PASS_INPUT_INVALID');
  const start = /^([01]\d|2[0-3]):[0-5]\d/u.exec(event.time)?.[0]; if (!start) fail('WALLET_PASS_INPUT_INVALID');
  const relevantDate = event.date + 'T' + start + ':00+08:00';
  if (!Number.isFinite(Date.parse(relevantDate)) || new Date(Date.parse(event.date + 'T00:00:00Z')).toISOString().slice(0, 10) !== event.date) fail('WALLET_PASS_INPUT_INVALID');
  const pass = { formatVersion: 1, passTypeIdentifier: identity.passTypeIdentifier, serialNumber: event.id + '-' + attendee.registrationId,
    teamIdentifier: identity.teamId, organizationName, description: event.title + '参会凭证', logoText: organizationName,
    foregroundColor: 'rgb(255,255,255)', backgroundColor: 'rgb(20,72,239)', labelColor: 'rgb(222,232,255)', relevantDate,
    expirationDate: event.date + 'T23:59:59+08:00', sharingProhibited: true,
    barcodes: [{ format: 'PKBarcodeFormatQR', message: verificationUrl, messageEncoding: 'iso-8859-1' }],
    eventTicket: {
      headerFields: [{ key: 'status', label: '参会名额', value: '已确认' }],
      primaryFields: [{ key: 'event', label: '活动', value: event.title }],
      secondaryFields: [{ key: 'name', label: '参加人', value: attendee.name }],
      auxiliaryFields: [{ key: 'date', label: '日期', value: event.date }, { key: 'time', label: '时间', value: event.time }],
      backFields: [{ key: 'venue', label: '地点', value: event.venue }, { key: 'reference', label: '报名编号', value: attendee.referenceCode },
        { key: 'notice', label: '说明', value: '此凭证仅表示参会名额。讲者、展位及住宿另行确认；请以在线核对结果为准。' }],
    } };
  const files = [{ name: 'pass.json', data: Buffer.from(JSON.stringify(pass)) }, { name: 'icon.png', data: icon(29) }, { name: 'icon@2x.png', data: icon(58) }];
  const manifest = Buffer.from(JSON.stringify(Object.fromEntries(files.map(file => [file.name, createHash('sha1').update(file.data).digest('hex')]))));
  files.push({ name: 'manifest.json', data: manifest }, { name: 'signature', data: signManifest({ manifest, ...identity, now }) });
  return createPassArchive(files, now);
}
