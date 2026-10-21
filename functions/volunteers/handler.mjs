import { equalToken } from '../content-api/auth.mjs';
import { CloudContentError } from '../cloud-content/errors.mjs';
import { XLSX_MIME, MAX_XLSX_BYTES } from '../../shared/xlsx-workbook.mjs';
import { canManageVolunteers, isVolunteerFailure } from './service.mjs';

const ORIGIN = 'https://api.artdico.host', ROOT = '/api/admin/volunteers';
export const MAX_VOLUNTEER_BODY_BYTES = 64 * 1024;
const MAX_VIEW_BYTES = 2 * 1024 * 1024;
const SECURITY = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
const specs = {
  AUTH_REQUIRED: [401, '会话已结束，请重新登录。'], FORBIDDEN: [403, '当前账号没有志愿者管理权限。'],
  ORIGIN_REJECTED: [403, '请求来源不被允许。'], CSRF_REJECTED: [403, '安全校验未通过，请重新载入后台。'],
  INVALID_REQUEST: [400, '志愿者请求格式无效。'], NOT_FOUND: [404, '志愿者接口不存在。'], METHOD_NOT_ALLOWED: [405, '此接口不接受该方法。'],
  BODY_TOO_LARGE: [413, '请求内容过大。'], UNSUPPORTED_MEDIA_TYPE: [415, '请发送 UTF-8 JSON 请求。'],
  CAPACITY_EXCEEDED: [409, '志愿者记录已达到维护上限，请保留资料并联系管理员。'], CONFLICT: [409, '资料已更新或操作结果待核对，请保留输入并重新载入。'], PLAN_CONFLICT: [422, '安排存在时间、可参与时段或需求人数冲突，请检查后再保存。'],
  SOURCE_NOT_ELIGIBLE: [422, '来源记录目前不可用于新的参与安排，请先核对同意与出席状态。'],
  DUPLICATE_SOURCE: [409, '此人员已有志愿者记录，请使用原记录调整。'], UNAVAILABLE: [503, '志愿者资料暂不可用，请稍后重新检查。'],
};
const safe = new WeakSet();
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, fields) => plain(value) && Object.keys(value).sort().join(',') === [...fields].sort().join(',');
function fail(code = 'UNAVAILABLE') { const error = new Error(code); error.code = code; safe.add(error); throw error; }
function json(value, status = 200, extra = {}) {
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body) > MAX_VIEW_BYTES) fail();
  return new Response(body, { status, headers: { ...SECURITY, ...extra, 'content-type': 'application/json; charset=utf-8' } });
}
async function inputBody(request) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/iu.test(request.headers.get('content-type') ?? '') || ![null, 'identity'].includes(request.headers.get('content-encoding'))) fail('UNSUPPORTED_MEDIA_TYPE');
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/u.test(declared) || !Number.isSafeInteger(Number(declared)))) fail('INVALID_REQUEST');
  if (Number(declared) > MAX_VOLUNTEER_BODY_BYTES) fail('BODY_TOO_LARGE');
  const reader = request.body?.getReader(), chunks = [], timeout = new AbortController(), signal = AbortSignal.any([request.signal, timeout.signal]);
  let bytes = 0, onAbort;
  const aborted = new Promise((_, reject) => { onAbort = () => { reader?.cancel().catch(() => {}); reject(new Error()); }; signal.addEventListener('abort', onAbort, { once: true }); });
  const timer = setTimeout(() => timeout.abort(), 10_000); timer.unref();
  try {
    if (signal.aborted) fail('INVALID_REQUEST');
    if (reader) while (true) {
      const next = await Promise.race([reader.read(), aborted]);
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_VOLUNTEER_BODY_BYTES) fail('BODY_TOO_LARGE');
      chunks.push(next.value);
    }
    if (declared !== null && Number(declared) !== bytes) fail('INVALID_REQUEST');
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    if (!plain(value)) fail('INVALID_REQUEST');
    return value;
  } catch (error) { if (safe.has(error)) throw error; fail('INVALID_REQUEST'); }
  finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); if (reader) { reader.cancel().catch(() => {}); reader.releaseLock(); } }
}
function sourceQuery(url) {
  const keys = ['query', 'kind', 'id', 'cursor', 'limit'];
  for (const key of url.searchParams.keys()) if (!keys.includes(key) || url.searchParams.getAll(key).length !== 1) fail('INVALID_REQUEST');
  const integer = (key, fallback) => {
    if (!url.searchParams.has(key)) return fallback;
    const value = url.searchParams.get(key);
    if (!/^(0|[1-9][0-9]*)$/u.test(value) || !Number.isSafeInteger(Number(value))) fail('INVALID_REQUEST');
    return Number(value);
  };
  return { query: url.searchParams.get('query') ?? '', kind: url.searchParams.get('kind') ?? '', id: url.searchParams.get('id') ?? '', cursor: integer('cursor', 0), limit: integer('limit', 100) };
}
export function isVolunteersPath(path) { return typeof path === 'string' && (path === ROOT || path.startsWith(ROOT + '/')); }

/** Private same-origin module; authorization precedes all source and journal I/O. */
export function createVolunteersApi({ authenticate, service } = {}) {
  if (typeof authenticate !== 'function' || !['read', 'sources', 'operate', 'exportXlsx'].every(name => typeof service?.[name] === 'function')) throw new TypeError('Volunteer API dependencies unavailable.');
  return async request => {
    let allow;
    try {
      const url = new URL(request.url), reading = [ROOT, ROOT + '/sources'].includes(url.pathname), exporting = url.pathname === ROOT + '/export.xlsx';
      if (url.origin !== ORIGIN || url.username || url.password || url.hash) fail('ORIGIN_REJECTED');
      if (!reading && !exporting && url.pathname !== ROOT + '/operations') fail('NOT_FOUND');
      const method = reading ? 'GET' : 'POST';
      if (request.method !== method) { allow = method; fail('METHOD_NOT_ALLOWED'); }
      const origin = request.headers.get('origin');
      if (origin !== null && origin !== ORIGIN || !reading && origin !== ORIGIN) fail('ORIGIN_REJECTED');
      const session = await authenticate(request);
      if (!session?.user) fail('AUTH_REQUIRED');
      if (!canManageVolunteers(session.user)) fail('FORBIDDEN');
      if (url.pathname !== ROOT + '/sources' && url.search) fail('INVALID_REQUEST');
      if (reading) return json(url.pathname === ROOT ? await service.read({ actor: session.user }) : await service.sources({ actor: session.user, ...sourceQuery(url) }));
      if (!equalToken(request.headers.get('x-csrf-token'), session.csrfToken)) fail('CSRF_REJECTED');
      const body = await inputBody(request);
      if (!exact(body, exporting ? ['expectedRevision', 'operationId', 'volunteerIds', 'includeContact'] : ['expectedRevision', 'operationId', 'action', 'payload'])) fail('INVALID_REQUEST');
      if (!exporting) return json(await service.operate({ ...body, actor: session.user }));
      const result = await service.exportXlsx({ ...body, actor: session.user });
      if (!(result.workbook instanceof Uint8Array) || result.workbook.byteLength > MAX_XLSX_BYTES || !Number.isSafeInteger(result.revision)
        || !Number.isSafeInteger(result.count) || !/^[a-f0-9]{64}$/u.test(result.sha256)) fail();
      return new Response(result.workbook, { status: 200, headers: { ...SECURITY, 'content-type': XLSX_MIME, 'content-length': String(result.workbook.byteLength),
        'content-disposition': 'attachment; filename="artdico-volunteers.xlsx"', 'x-volunteer-operation-id': body.operationId,
        'x-volunteer-revision': String(result.revision), 'x-export-count': String(result.count), 'x-export-sha256': result.sha256 } });
    } catch (error) {
      let code = safe.has(error) || isVolunteerFailure(error) ? error.code : 'UNAVAILABLE';
      if (error instanceof CloudContentError && error.code === 'AUTH_REQUIRED' && error.status === 401) code = 'AUTH_REQUIRED';
      if (!Object.hasOwn(specs, code)) code = 'UNAVAILABLE';
      const [status, message] = specs[code];
      return json({ error: { code, message } }, status, allow ? { allow } : {});
    }
  };
}
