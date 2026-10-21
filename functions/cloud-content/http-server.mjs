import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { handleFcRequest } from '../fc-api/handler.mjs';
import { CLOUD_API_ORIGIN, MAX_CLOUD_BODY_BYTES } from './handler.mjs';
import { acceptanceHealthProof } from './acceptance.mjs';

const SECURITY = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' };
const MIME = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.woff': 'font/woff', '.woff2': 'font/woff2' };

export function isCloudAdminAssetUrl(path) {
  return ['/admin/', '/admin/contacts/', '/admin/registrations/', '/admin/tasks/', '/admin/settings/', '/admin/person/', '/invitations/template-blank.png'].includes(path)
    || typeof path === 'string' && /^\/_astro\/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,200}\.(?:css|js|mjs|woff|woff2)$/u.test(path) && !path.includes('..');
}

function staticAssets(input) {
  if (!(input instanceof Map) || input.size > 40) throw new TypeError('后台静态资源清单无效。');
  const result = new Map(); let total = 0;
  for (const [path, bytes] of input) {
    const html = ['/admin/', '/admin/contacts/', '/admin/registrations/', '/admin/tasks/', '/admin/settings/', '/admin/person/'].includes(path);
    const invitation = path === '/invitations/template-blank.png';
    const suffix = typeof path === 'string' ? /\.[a-z0-9]+$/u.exec(path)?.[0] : null;
    if (!isCloudAdminAssetUrl(path)) throw new TypeError('后台静态资源路径无效。');
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > 2 * 1024 * 1024 || (total += bytes.byteLength) > 8 * 1024 * 1024) throw new TypeError('后台静态资源容量无效。');
    const data = Buffer.from(bytes);
    const headers = { ...SECURITY, 'content-type': html ? 'text/html; charset=utf-8' : invitation ? 'image/png' : MIME[suffix], 'content-length': String(data.length) };
    if (html) {
      const hashes = new Set();
      for (const script of data.toString('utf8').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)) {
        if (!/(?:^|\s)src\s*=/iu.test(script[1])) hashes.add(`'sha256-${createHash('sha256').update(script[2].replace(/\r\n?/gu, '\n')).digest('base64')}'`);
      }
      headers['content-security-policy'] = `default-src 'self'; script-src 'self'${hashes.size ? ' ' + [...hashes].join(' ') : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`;
    }
    result.set(path, { data, headers });
  }
  return result;
}

function fixedError(response, status, code, message) {
  if (response.headersSent) return response.destroy();
  response.writeHead(status, { ...SECURITY, 'content-type': 'application/json; charset=utf-8', connection: 'close' });
  response.end(JSON.stringify({ error: { code, message } }));
}

/** Unbound HTTP adapter. A verified candidate package supplies the explicit admin asset map.
 * It never reads a filesystem, discovers routes, opens a port on import or trusts proxy headers.
 */
export function createCloudContentServer({ runtime, sourceCommit = null, assets = new Map(), readAcceptance = () => null } = {}) {
  if (!runtime || typeof runtime.handle !== 'function' || typeof runtime.configured !== 'boolean') throw new TypeError('云端 HTTP 服务需要明确的运行时。');
  if (typeof readAcceptance !== 'function') throw new TypeError('云端验收状态读取无效。');
  const knownAssets = staticAssets(assets);
  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 15_000, headersTimeout: 5_000, keepAliveTimeout: 1_000, connectionsCheckingInterval: 1_000 }, async (incoming, outgoing) => {
    incoming.on('error', () => outgoing.destroy());
    incoming.on('aborted', () => outgoing.destroy());
    outgoing.on('error', () => incoming.destroy());
    outgoing.setHeader('connection', 'close');
    try {
      const method = incoming.method ?? '';
      const url = new URL(incoming.url ?? '/', CLOUD_API_ORIGIN);
      if (url.origin !== CLOUD_API_ORIGIN) return fixedError(outgoing, 403, 'ORIGIN_REJECTED', '请求来源不被允许。');
      // This path remains behind the unchanged signed FC trigger. Custom domain
      // routes must explicitly exclude it; it never proves business readiness.
      if (url.pathname === '/healthz') {
        const result = handleFcRequest({ method: method === 'HEAD' ? 'GET' : method, url: url.href }, { sourceCommit });
        let body = await result.text();
        if (result.status === 200) {
          const acceptance = acceptanceHealthProof(readAcceptance());
          if (acceptance !== null) body = JSON.stringify({ ...JSON.parse(body), acceptance });
        }
        result.headers.forEach((value, key) => outgoing.setHeader(key, value)); outgoing.statusCode = result.status;
        outgoing.setHeader('content-length', String(Buffer.byteLength(body)));
        outgoing.end(method === 'HEAD' ? undefined : body); return;
      }
      if (incoming.headers.host !== new URL(CLOUD_API_ORIGIN).host) return fixedError(outgoing, 421, 'HOST_REJECTED', '请使用指定的后台地址。');
      if (!url.pathname.startsWith('/api/')) {
        if (!runtime.configured) return fixedError(outgoing, 503, 'CONTENT_NOT_READY', '云端内容后台尚未开放。');
        if (!['GET', 'HEAD'].includes(method)) return fixedError(outgoing, 405, 'METHOD_NOT_ALLOWED', '页面只接受读取。');
        if (['/admin', '/admin/contacts', '/admin/registrations', '/admin/tasks', '/admin/settings', '/admin/person'].includes(url.pathname) && !url.search) { outgoing.writeHead(308, { ...SECURITY, location: url.pathname + '/' }); outgoing.end(); return; }
        const file = !url.search && knownAssets.get(url.pathname);
        if (!file) return fixedError(outgoing, 404, 'NOT_FOUND', '页面不存在。');
        outgoing.writeHead(200, file.headers); outgoing.end(method === 'HEAD' ? undefined : file.data); return;
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      const rawLength = headers.get('content-length');
      const bodyLimit = ['/api/admin/contacts/import', '/api/admin/contacts/import/preview'].includes(url.pathname) ? 3 * 1024 * 1024
        : url.pathname === '/api/admin/maintenance/restore' ? 2 * 1024 * 1024
          : ['/api/registration/wallet', '/api/admin/registration/wallet'].includes(url.pathname) ? 8192
            : ['/api/registration/confirmation', '/api/admin/registration/confirmation', '/api/admin/registration-confirmation/settings', '/api/admin/registration-confirmation/dispatch',
              '/api/admin/registrations/export.xlsx', '/api/admin/contacts/export.xlsx'].includes(url.pathname) ? 16 * 1024 : MAX_CLOUD_BODY_BYTES;
      if (rawLength !== null && (!/^\d+$/u.test(rawLength) || !Number.isSafeInteger(Number(rawLength)) || Number(rawLength) > bodyLimit)) return fixedError(outgoing, 413, 'BODY_TOO_LARGE', '请求内容过大。');
      const parts = []; let length = 0;
      if (!['GET', 'HEAD'].includes(method)) for await (const chunk of incoming) {
        if ((length += chunk.length) > bodyLimit) return fixedError(outgoing, 413, 'BODY_TOO_LARGE', '请求内容过大。');
        parts.push(chunk);
      }
      const request = new Request(url, { method, headers, ...(!['GET', 'HEAD'].includes(method) ? { body: Buffer.concat(parts, length) } : {}) });
      const result = await runtime.handle(request);
      const responseHeaders = { ...SECURITY };
      result.headers.forEach((value, key) => { if (key !== 'set-cookie') responseHeaders[key] = value; });
      const cookies = result.headers.getSetCookie();
      if (cookies.length) responseHeaders['set-cookie'] = cookies;
      outgoing.writeHead(result.status, responseHeaders);
      outgoing.end(method === 'HEAD' ? undefined : Buffer.from(await result.arrayBuffer()));
    } catch { fixedError(outgoing, 503, 'SERVICE_UNAVAILABLE', '操作未确认完成，请重新载入后核对。'); }
  });
  server.maxHeadersCount = 40;
  server.maxRequestsPerSocket = 20;
  server.setTimeout(15_000, socket => socket.destroy());
  server.on('clientError', (_error, socket) => {
    socket.on('error', () => socket.destroy());
    if (socket.writable && !socket.destroyed && socket.bytesWritten === 0) socket.end('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
    else socket.destroy();
  });
  return server;
}
