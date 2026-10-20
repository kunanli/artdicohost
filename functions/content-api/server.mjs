import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, stat, realpath, mkdir } from 'node:fs/promises';
import { resolve, relative, extname, sep, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createContentApi, MAX_BODY_BYTES } from './handler.mjs';
import { createFileContentStore } from './store.mjs';
import { createFileContactsStore } from './contacts-store.mjs';
import { createFilePortraitStore } from './portrait-store.mjs';
import { parseAdminUsers } from './auth.mjs';
import { createPreviewCommunications } from './communications.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8' };
const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};

function inside(root, candidate) {
  const path = relative(root, candidate);
  return path === '' || !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`);
}

function errorResponse(response, status, code, message) {
  response.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ error: { code, message } }));
}

async function requestBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) throw Object.assign(new Error('Body too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Loopback-only preview. It rejects production and never connects to FC or OSS. */
export async function startLocalContentServer({ env = process.env, users, port, distDirectory = resolve(ROOT, 'dist'), dataDirectory } = {}) {
  if (env.NODE_ENV === 'production' || (env.CONTENT_API_MODE ?? 'local') !== 'local') throw new TypeError('此服务仅限本地演示；生产 FC/OSS 和共享鉴权尚未接入。');
  const accounts = parseAdminUsers(users ?? env.ADMIN_USERS_JSON);
  const communications = createPreviewCommunications({ env });
  const localPort = port ?? Number(env.CONTENT_API_PORT ?? 8787);
  if (!Number.isInteger(localPort) || localPort < 0 || localPort > 65535) throw new TypeError('本地端口无效。');
  const dist = await realpath(resolve(distDirectory));
  const data = resolve(ROOT, dataDirectory ?? env.CONTENT_DATA_DIR ?? '.local-data/content');
  if (inside(dist, data)) throw new TypeError('内容数据目录必须位于 dist 之外。');
  await mkdir(data, { recursive: true, mode: 0o700 });
  if (inside(dist, await realpath(data))) throw new TypeError('内容数据目录不可通过链接指向 dist。');
  const portraitStore = createFilePortraitStore({ directory: data });
  const store = createFileContentStore({ directory: data, portraitStore });
  const contactsStore = createFileContactsStore({ directory: data, contentStore: store });
  let api;
  let origin;
  const server = createServer(async (request, response) => {
    try {
      if (!api || request.headers.host !== new URL(origin).host) return errorResponse(response, 421, 'HOST_REJECTED', '请使用本地服务给出的地址。');
      const url = new URL(request.url, origin);
      if (url.origin !== origin) return errorResponse(response, 403, 'ORIGIN_REJECTED', '请求来源不被允许。');
      if (url.pathname.startsWith('/api/')) {
        const headers = new Headers();
        for (const [key, value] of Object.entries(request.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        const payload = ['GET', 'HEAD'].includes(request.method) ? undefined : await requestBody(request);
        const result = await api(new Request(url, { method: request.method, headers, body: payload }), { clientAddress: request.socket.remoteAddress });
        const outgoing = { ...SECURITY_HEADERS };
        result.headers.forEach((value, key) => { if (key !== 'set-cookie') outgoing[key] = value; });
        const cookies = result.headers.getSetCookie();
        if (cookies.length) outgoing['set-cookie'] = cookies;
        response.writeHead(result.status, outgoing);
        response.end(Buffer.from(await result.arrayBuffer()));
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) return errorResponse(response, 405, 'METHOD_NOT_ALLOWED', '静态页面只接受读取。');
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); }
      catch { return errorResponse(response, 400, 'INVALID_PATH', '地址格式无效。'); }
      if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some((part) => part.startsWith('.'))) return errorResponse(response, 404, 'NOT_FOUND', '页面不存在。');
      let file = resolve(dist, `.${pathname}`);
      if (!inside(dist, file)) return errorResponse(response, 404, 'NOT_FOUND', '页面不存在。');
      let info;
      try {
        info = await stat(file);
        if (info.isDirectory()) { file = resolve(file, 'index.html'); info = await stat(file); }
        file = await realpath(file);
      } catch { return errorResponse(response, 404, 'NOT_FOUND', '页面不存在。'); }
      const mime = MIME[extname(file).toLowerCase()];
      if (!inside(dist, file) || !info.isFile() || !mime) return errorResponse(response, 404, 'NOT_FOUND', '页面不存在。');
      let contents = await readFile(file);
      const securityHeaders = { ...SECURITY_HEADERS };
      if (extname(file).toLowerCase() === '.html') {
        const html = contents.toString('utf8').replace('</head>', '<meta name="artdico-content-api" content="/api/public/content"></head>');
        // Astro may inline a compiled module. Permit only the exact static script,
        // preserving CSP protection for API-supplied content and event handlers.
        const hashes = new Set();
        for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)) {
          if (!/(?:^|\s)src\s*=/iu.test(script[1])) {
            hashes.add(`'sha256-${createHash('sha256').update(script[2].replace(/\r\n?/gu, '\n')).digest('base64')}'`);
          }
        }
        securityHeaders['content-security-policy'] = SECURITY_HEADERS['content-security-policy'].replace("script-src 'self'", `script-src 'self'${hashes.size ? ` ${[...hashes].join(' ')}` : ''}`);
        contents = Buffer.from(html);
      }
      response.writeHead(200, { ...securityHeaders, 'content-type': mime, 'content-length': contents.length });
      response.end(request.method === 'HEAD' ? undefined : contents);
    } catch (error) {
      if (!response.headersSent) errorResponse(response, error.status === 413 ? 413 : 500, error.status === 413 ? 'BODY_TOO_LARGE' : 'LOCAL_SERVER_ERROR', error.status === 413 ? '请求内容过大。' : '本地服务未完成操作。');
      else response.end();
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(localPort, '127.0.0.1', accept); });
  origin = `http://127.0.0.1:${server.address().port}`;
  api = createContentApi({ store, contactsStore, portraitStore, communications, users: accounts, allowedOrigin: origin });
  return { server, origin, close: () => new Promise((accept, reject) => { server.closeAllConnections(); server.close((error) => error ? reject(error) : accept()); }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { origin } = await startLocalContentServer();
    console.log(`本地工作后台：${origin}/admin/（仅本机；不接收真实报名）`);
  } catch (error) {
    console.error(error instanceof TypeError ? error.message : '本地后台无法启动；请检查配置、构建和数据目录权限。');
    process.exitCode = 1;
  }
}
