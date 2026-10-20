import { createHash } from 'node:crypto';
import { OSS_ORIGIN } from '../functions/cloud-content/oss-client.mjs';

export const fakeCredentials = { accessKeyId: 'ExampleId', accessKeySecret: 'ExampleSecretForOnlyFixtures', securityToken: 'ExampleToken' };
export const fixedClock = () => new Date('2026-10-20T00:00:00Z');
export const sha256 = data => createHash('sha256').update(data).digest('hex');
export function xmlError(status, code) { return new Response(`<Error><Code>${code}</Code><Message>PRIVATE_PROVIDER_DETAIL</Message></Error>`, { status, headers: { 'content-type': 'application/xml' } }); }
export function objectResponse(data, contentType = 'application/json', objectType = 'Normal') {
  return new Response(data, { headers: { 'content-length': String(data.byteLength), 'content-type': contentType, 'x-oss-object-type': objectType } });
}
/** Isolated synthetic OSS HTTP fixture; no real endpoint or credentials. */
export function objectFixture() {
  const stored = new Map(), calls = [];
  async function fetchFn(raw, options) {
    const url = new URL(raw), key = url.pathname.slice(1);
    calls.push({ key, url: raw, method: options.method, headers: { ...options.headers }, body: options.body ? Buffer.from(options.body) : null });
    if (url.origin !== OSS_ORIGIN || options.redirect !== 'error' || options.cache !== 'no-store') throw new Error('Fixture target drift');
    const current = stored.get(key);
    if (options.method === 'GET') return current ? objectResponse(Buffer.from(current.data), current.contentType, current.objectType) : xmlError(404, 'NoSuchKey');
    const body = Buffer.from(options.body);
    if (options.headers['content-length'] !== String(body.byteLength) || options.headers['content-md5'] !== createHash('md5').update(body).digest('base64')) return xmlError(400, 'BadDigest');
    if (options.method === 'PUT') {
      if (options.headers['x-oss-forbid-overwrite'] !== 'true') throw new Error('Unconditional immutable write');
      if (current) return xmlError(409, 'FileAlreadyExists');
      stored.set(key, { data: Buffer.from(body), contentType: options.headers['content-type'], objectType: 'Normal' });
      return new Response(null, { status: 200 });
    }
    if (options.method === 'POST') {
      if (!/^\?append&position=(?:0|[1-9]\d*)$/u.test(url.search)) throw new Error('Bad append query');
      const position = Number(url.searchParams.get('position'));
      if (current && current.objectType !== 'Appendable') return xmlError(409, 'ObjectNotAppendable');
      if (position !== (current?.data.byteLength ?? 0)) return xmlError(409, 'PositionNotEqualToLength');
      stored.set(key, { data: Buffer.concat([current?.data ?? Buffer.alloc(0), body]), contentType: options.headers['content-type'], objectType: 'Appendable' });
      return new Response(null, { headers: { 'x-oss-next-append-position': String(position + body.byteLength) } });
    }
    throw new Error('Unsupported fixture operation');
  }
  return { stored, calls, fetchFn };
}
