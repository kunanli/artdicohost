import { equalToken } from '../content-api/auth.mjs';
import { readIntentBody } from './handler.mjs';
import { failure, IntentInvitationError } from './errors.mjs';

const ORIGIN = 'https://api.artdico.host';
const PATH = '/api/admin/contacts/import';
export const MAX_CONTACT_IMPORT_BODY_BYTES = 3 * 1024 * 1024;
export const isIntentContactImportPath = path => path === PATH || path === PATH + '/preview';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: {
  'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff',
} });

export function createIntentContactImportApi({ importer, authenticate } = {}) {
  if (!importer || !['preview', 'commit'].every(key => typeof importer[key] === 'function') || typeof authenticate !== 'function') throw new TypeError('Protected importer and authentication required.');
  return async request => {
    try {
      const url = new URL(request.url);
      if (url.origin !== ORIGIN || url.search || url.hash || !isIntentContactImportPath(url.pathname)) return json({ error: { code: 'NOT_FOUND', message: '接口不存在。' } }, 404);
      if (request.method !== 'POST') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: '导入只接受明确提交。' } }, 405);
      if (request.headers.get('origin') !== ORIGIN) throw failure('FORBIDDEN', 403);
      const session = await authenticate(request), actor = session?.user;
      if (!actor || !Array.isArray(actor.roles) || !actor.roles.some(role => ['outreach', 'superadmin'].includes(role))
        || !equalToken(request.headers.get('x-csrf-token'), session.csrfToken)) throw failure('FORBIDDEN', 403);
      const input = await readIntentBody(request, MAX_CONTACT_IMPORT_BODY_BYTES);
      const fields = input.kind === 'snapshot' ? ['kind', 'snapshot', 'originalSha256'] : input.kind === 'rows' ? ['kind', 'sourceKey', 'rows', 'sourceFileBase64', 'originalSha256'] : [];
      const commit = url.pathname === PATH;
      const allowed = [...fields, ...(commit ? ['expectedRevision', 'previewToken', 'allowPossibleDuplicates', 'confirmSource'] : [])];
      if (!fields.length || Object.keys(input).some(key => !allowed.includes(key))) throw failure('INVALID_INPUT', 400);
      return json(await importer[commit ? 'commit' : 'preview']({ ...input, actor }));
    } catch (error) {
      if (error instanceof IntentInvitationError) return json({ error: { code: error.code, message: error.message } }, error.status);
      if (error?.code === 'AUTH_REQUIRED' && error?.status === 401) return json({ error: { code: 'AUTH_REQUIRED', message: '请先登录。' } }, 401);
      return json({ error: { code: 'STORAGE_UNAVAILABLE', message: '导入结果未确认，请重新载入并核对原来源，不要盲目重复上传。' } }, 503);
    }
  };
}
