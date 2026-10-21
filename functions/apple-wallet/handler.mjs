const API = 'https://api.artdico.host', SITE = 'https://artdico.host';
const PATHS = ['/api/registration/wallet', '/api/admin/registration/wallet'];
const VERIFY = PATHS.map(path => path + '/verify/');
const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'vary': 'Origin' };
const errorBody = (code, message) => ({ error: { code, message } });
export function isAppleWalletPath(path) { return PATHS.includes(path) || VERIFY.some(prefix => path.startsWith(prefix)); }

/** Capability endpoints intentionally ignore staff cookies and never expose account data or credential state. */
export function createAppleWalletApi({ service, apiOrigin = API, publicOrigins = [SITE] } = {}) {
  if (!service || typeof service.download !== 'function' || typeof service.verify !== 'function' || apiOrigin !== API
    || !Array.isArray(publicOrigins) || publicOrigins.length !== 1 || publicOrigins[0] !== SITE) throw new TypeError('Trusted Wallet API dependencies required.');
  return async function handle(request) {
    const url = new URL(request.url), origin = request.headers.get('origin');
    const cors = origin === SITE ? { 'access-control-allow-origin': SITE } : {};
    const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { ...headers, ...cors, 'content-type': 'application/json; charset=utf-8' } });
    if (url.origin !== API || url.username || url.password || url.search || url.hash || !isAppleWalletPath(url.pathname)) return json(errorBody('NOT_FOUND', '接口不存在。'), 404);
    const download = PATHS.includes(url.pathname), verifyPrefix = VERIFY.find(prefix => url.pathname.startsWith(prefix));
    if (origin !== null && origin !== SITE || download && origin !== SITE) return json(errorBody('FORBIDDEN', '此来源不能读取票券。'), 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, ...cors,
      'access-control-allow-methods': download ? 'POST, OPTIONS' : 'GET, HEAD, OPTIONS',
      'access-control-allow-headers': 'Content-Type', 'access-control-max-age': '0' } });
    if (download && request.method !== 'POST' || !download && !['GET', 'HEAD'].includes(request.method)) return json(errorBody('METHOD_NOT_ALLOWED', '请求方法不支持。'), 405);
    try {
      if (!download) {
        const token = url.pathname.slice(verifyPrefix.length);
        if (!/^[A-Za-z0-9_-]{20,2048}\.[A-Za-z0-9_-]{43}$/u.test(token)) return json({ valid: false }, 404);
        const value = await service.verify({ token });
        if (value?.valid !== true) return json({ valid: false }, 404);
        const body = { valid: true, eventId: value.eventId, admissionStatus: 'confirmed', verifiedAt: value.verifiedAt };
        const response = json(body, 200); return request.method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response;
      }
      const mime = request.headers.get('content-type') ?? '', length = request.headers.get('content-length');
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(mime) || length !== null && (!/^(?:0|[1-9]\d*)$/u.test(length) || Number(length) > 8192)) return json(errorBody('INVALID_INPUT', '票券请求格式无效。'), 400);
      const reader = request.body?.getReader(); if (!reader) return json(errorBody('INVALID_INPUT', '票券请求格式无效。'), 400);
      const chunks = []; let size = 0;
      try { for (;;) { const part = await reader.read(); if (part.done) break; if (!(part.value instanceof Uint8Array) || (size += part.value.byteLength) > 8192) return json(errorBody('INVALID_INPUT', '票券请求过大。'), 413); chunks.push(Buffer.from(part.value)); } }
      finally { try { await reader.cancel(); } catch {} reader.releaseLock(); }
      if (length !== null && Number(length) !== size) return json(errorBody('INVALID_INPUT', '票券请求格式无效。'), 400);
      let body;
      try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))); } catch { return json(errorBody('INVALID_INPUT', '票券请求格式无效。'), 400); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body.receiptToken !== 'string') return json(errorBody('INVALID_INPUT', '票券请求格式无效。'), 400);
      const result = await service.download({ receiptToken: body.receiptToken });
      if (result?.outcome === 'issued' && result.data instanceof Uint8Array && result.data.length > 0 && result.data.length <= 1024 * 1024
        && result.contentType === 'application/vnd.apple.pkpass' && /^artdico-[A-Za-z0-9_-]{12}\.pkpass$/u.test(result.filename ?? '')) {
        return new Response(result.data, { status: 200, headers: { ...headers, ...cors, 'content-type': result.contentType,
          'content-disposition': 'attachment; filename="' + result.filename + '"', 'content-length': String(result.data.length) } });
      }
      if (result?.outcome === 'not_ready') return json(errorBody('WALLET_NOT_READY', 'Apple Wallet 尚未完成设置，请保存或打印报名确认页。'), 503);
      if (['invalid', 'inactive'].includes(result?.outcome)) return json(errorBody('WALLET_UNAVAILABLE', '当前登记不能签发参会票券。'), 404);
      return json(errorBody('WALLET_UNAVAILABLE', '票券暂时无法核对，请稍后重试。'), 503);
    } catch { return json(errorBody('WALLET_UNAVAILABLE', '票券暂时无法核对，请稍后重试。'), 503); }
  };
}
