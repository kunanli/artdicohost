import { createHash, sign } from 'node:crypto';

const fail = () => { throw new TypeError('Wallet signature could not be verified.'); };
const bytes = value => Buffer.isBuffer(value) ? value : value instanceof Uint8Array ? Buffer.from(value) : fail();

export function der(tag, value) {
  const body = bytes(value);
  if (!Number.isInteger(tag) || tag < 0 || tag > 255 || body.length > 1024 * 1024) fail();
  if (body.length < 128) return Buffer.concat([Buffer.from([tag, body.length]), body]);
  let size = body.length, length = [];
  while (size) { length.unshift(size & 255); size >>>= 8; }
  return Buffer.concat([Buffer.from([tag, 128 | length.length, ...length]), body]);
}
const concat = values => Buffer.concat(values.map(bytes));
const sequence = (...values) => der(0x30, concat(values));
const sorted = values => [...values].sort(Buffer.compare);
const set = (...values) => der(0x31, concat(sorted(values)));
const integer = value => der(2, Buffer.from([value]));
const nil = () => der(5, Buffer.alloc(0));

export function oid(value) {
  const parts = value.split('.').map(Number);
  if (parts.length < 2 || parts.some(value => !Number.isSafeInteger(value) || value < 0) || parts[0] > 2 || parts[0] < 2 && parts[1] > 39) fail();
  const output = [];
  for (let part of [40 * parts[0] + parts[1], ...parts.slice(2)]) {
    const encoded = [part % 128];
    while ((part = Math.floor(part / 128))) encoded.unshift(128 | part % 128);
    output.push(...encoded);
  }
  return der(6, Buffer.from(output));
}

/** Bounded DER TLV parsing is used only to preserve the certificate's exact issuer/serial encoding. */
export function derChildren(value, expectedTag = 0x30) {
  const data = bytes(value);
  function item(offset) {
    const start = offset, tag = data[offset++];
    if (tag === undefined || (tag & 31) === 31 || offset >= data.length) fail();
    let length = data[offset++];
    if (length & 128) {
      const count = length & 127;
      if (!count || count > 3 || offset + count > data.length || data[offset] === 0) fail();
      length = 0;
      for (let i = 0; i < count; i++) length = length * 256 + data[offset++];
      if (length < 128) fail();
    }
    const end = offset + length;
    if (end > data.length || end < offset) fail();
    return { tag, start, end, header: offset - start, data: data.subarray(start, end), body: data.subarray(offset, end) };
  }
  const outer = item(0);
  if (outer.tag !== expectedTag || outer.end !== data.length) fail();
  const result = []; let offset = outer.header;
  while (offset < outer.end) { const next = item(offset); result.push(next); offset = next.end; if (result.length > 64) fail(); }
  return result;
}

function issuerSerial(certificate) {
  const certificateParts = derChildren(certificate), tbs = certificateParts[0];
  if (certificateParts.length !== 3 || tbs?.tag !== 0x30) fail();
  const fields = derChildren(tbs.data), version = fields[0]?.tag === 0xa0 ? 1 : 0;
  const serial = fields[version], issuer = fields[version + 2];
  if (serial?.tag !== 2 || issuer?.tag !== 0x30 || !serial.body.length || serial.body.length > 32) fail();
  return sequence(issuer.data, serial.data);
}

function signingTime(now) {
  const date = new Date(now);
  if (!Number.isSafeInteger(now) || !Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1950 || date.getUTCFullYear() > 9999) fail();
  const value = date.toISOString().slice(0, 19).replace(/[-:T]/gu, '') + 'Z';
  return der(date.getUTCFullYear() < 2050 ? 0x17 : 0x18, Buffer.from(date.getUTCFullYear() < 2050 ? value.slice(2) : value, 'ascii'));
}

/** RFC 5652 detached SignedData, SHA-256, content-type/message-digest/signing-time signed attributes. */
export function signManifest({ manifest, certificate, wwdr, privateKey, now }) {
  const data = bytes(manifest);
  if (!data.length || data.length > 64 * 1024 || !['rsa', 'ec'].includes(privateKey?.asymmetricKeyType)) fail();
  const digestAlgorithm = sequence(oid('2.16.840.1.101.3.4.2.1'), nil());
  const attribute = (type, value) => sequence(oid(type), set(value));
  const attributes = set(
    attribute('1.2.840.113549.1.9.3', oid('1.2.840.113549.1.7.1')),
    attribute('1.2.840.113549.1.9.4', der(4, createHash('sha256').update(data).digest())),
    attribute('1.2.840.113549.1.9.5', signingTime(now)),
  );
  const signature = sign('sha256', attributes, privateKey);
  const implicitAttributes = Buffer.from(attributes); implicitAttributes[0] = 0xa0;
  const signatureAlgorithm = privateKey.asymmetricKeyType === 'rsa'
    ? sequence(oid('1.2.840.113549.1.1.1'), nil()) : sequence(oid('1.2.840.10045.4.3.2'));
  const signer = sequence(integer(1), issuerSerial(certificate), digestAlgorithm, implicitAttributes, signatureAlgorithm, der(4, signature));
  const signedData = sequence(integer(1), set(digestAlgorithm), sequence(oid('1.2.840.113549.1.7.1')),
    der(0xa0, concat(sorted([bytes(certificate), bytes(wwdr)]))), set(signer));
  return sequence(oid('1.2.840.113549.1.7.2'), der(0xa0, signedData));
}
