import { createServer } from 'node:http';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { handleFcRequest } from './handler.mjs';

export function parseFcPort(value = '9000') {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[1-9]\d{0,4}$/u.test(value))) throw new TypeError('FC 预检端口无效。');
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new TypeError('FC 预检端口无效。');
  return port;
}

/** Only the fixed release identity is public; the rest of the manifest is never returned. */
export function sourceCommitFromRelease(release) {
  return release !== null && typeof release === 'object' && !Array.isArray(release) && release.schemaVersion === 1
    && release.kind === 'fc-preflight' && typeof release.sourceCommit === 'string' && /^[a-f0-9]{40}$/u.test(release.sourceCommit) ? release.sourceCommit : null;
}

async function releaseCommit() {
  let file;
  try {
    file = await open(new URL('../../release.json', import.meta.url), constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await file.stat();
    if (!info.isFile() || info.size > 64 * 1024) return null;
    return sourceCommitFromRelease(JSON.parse(await file.readFile('utf8')));
  } catch { return null; }
  finally { if (file) await file.close().catch(() => {}); }
}

function parserFailure(code) {
  const [status, reason] = code === 'HPE_HEADER_OVERFLOW' ? [431, 'Request Header Fields Too Large']
    : code === 'ERR_HTTP_REQUEST_TIMEOUT' ? [408, 'Request Timeout'] : [400, 'Bad Request'];
  const body = JSON.stringify({ error: { code: 'INVALID_HTTP_REQUEST', message: '请求未完成。' } });
  return `HTTP/1.1 ${status} ${reason}\r\nContent-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
}

/** Creates an unbound startup-preflight server. Incoming bodies are never accumulated or parsed. */
export function createFcServer({ sourceCommit = null } = {}) {
  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 10_000, headersTimeout: 5_000, keepAliveTimeout: 1_000, connectionsCheckingInterval: 1_000 }, (request, response) => {
    request.on('error', () => response.destroy());
    request.on('aborted', () => response.destroy());
    response.on('error', () => request.socket.destroy());
    // Every preflight response closes the connection, including requests with unfinished bodies.
    response.setHeader('connection', 'close');
    try {
      const result = handleFcRequest({ method: request.method ?? '', url: new URL(request.url ?? '/', 'http://fc-preflight.invalid').href }, { sourceCommit });
      result.headers.forEach((value, key) => response.setHeader(key, value));
      response.statusCode = result.status;
      if (request.method === 'HEAD') { response.end(); return; }
      result.text().then(body => { if (!response.destroyed) response.end(body); }).catch(() => response.destroy());
    } catch {
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      response.end(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: '请求未完成。' } }));
    }
  });
  server.maxHeadersCount = 32;
  server.maxRequestsPerSocket = 25;
  server.setTimeout(10_000, socket => socket.destroy());
  server.on('clientError', (error, socket) => {
    socket.on('error', () => socket.destroy());
    if (socket.writable && !socket.destroyed && socket.bytesWritten === 0) socket.end(parserFailure(error.code));
    else socket.destroy();
  });
  return server;
}

/** Uses the FC port only; it never starts or imports the local staff/content server. */
export async function startFcServer({ env = process.env, port, host = '0.0.0.0' } = {}) {
  const configuredPort = port === undefined ? env.ARTDICO_FC_PORT : port;
  const selectedPort = parseFcPort(configuredPort === undefined ? '9000' : configuredPort);
  const server = createFcServer({ sourceCommit: await releaseCommit() });
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(selectedPort, host, () => { server.off('error', reject); accept(); });
  });
  return { server, host, port: selectedPort, close: () => new Promise((accept, reject) => {
    server.close(error => error ? reject(error) : accept());
    server.closeAllConnections();
  }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { port } = await startFcServer();
    console.log(`ARTDiCO FC startup preflight listening on port ${port}; registration remains closed.`);
  } catch {
    console.error('ARTDiCO FC startup preflight could not start.');
    process.exitCode = 1;
  }
}
