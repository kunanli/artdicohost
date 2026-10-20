import { equalToken } from '../content-api/auth.mjs';
import { IntentInvitationError, failure, plainData } from './errors.mjs';

const ORIGIN = 'https://api.artdico.host';
const SECURITY = { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: SECURITY });
export function isIntentInvitationPath(path) {
  return path === '/api/admin/contacts/invitations/preview' || path === '/api/admin/contacts/invitations/prepare-batch'
    || path === '/api/admin/contacts/convert' || path === '/api/admin/contacts/convert/preview' || path === '/api/admin/intent-invitations'
    || /^\/api\/admin\/contacts\/[A-Za-z0-9][A-Za-z0-9_-]{0,79}\/(?:invitation|assignments)$/u.test(path)
    || /^\/api\/admin\/intent-invitations\/[A-Za-z0-9][A-Za-z0-9_-]{0,99}\/manual-sent$/u.test(path);
}
export async function readIntentBody(request, maxBytes = 32 * 1024) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(request.headers.get('content-type') ?? '')
    || request.headers.has('content-encoding')) throw failure('INVALID_INPUT', 400);
  const reader = request.body?.getReader(); let size = 0; const chunks = [];
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10_000); timer.unref?.();
  const signal = AbortSignal.any([request.signal, controller.signal]);
  let onAbort;
  const abort = new Promise((_, reject) => { onAbort = () => reject(failure('INVALID_INPUT', 400)); signal.addEventListener('abort', onAbort, { once: true }); });
  abort.catch(() => {});
  try {
    if (signal.aborted) throw failure('INVALID_INPUT', 400);
    if (reader) while (true) {
      const part = await Promise.race([reader.read(), abort]); if (part.done) break;
      if (!(part.value instanceof Uint8Array) || (size += part.value.byteLength) > maxBytes) throw failure('INVALID_INPUT', 400);
      chunks.push(part.value);
    }
    const declared = request.headers.get('content-length');
    if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) !== size)) throw failure('INVALID_INPUT', 400);
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    if (!plainData(value)) throw failure('INVALID_INPUT', 400);
    return value;
  } catch { throw failure('INVALID_INPUT', 400); }
  finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); if (reader) { reader.cancel().catch(() => {}); reader.releaseLock(); } }
}
function shape(input, names) { if (Object.keys(input).some(key => !names.includes(key))) throw failure('INVALID_INPUT', 400); return input; }

/** The caller supplies authenticated persistent sessions. Direct role and CSRF
 * checks remain here so composing this router cannot bypass staff boundaries. */
export function createIntentInvitationApi({ service, authenticate, permissionReference = '用户授权将既有意向名单转为本次活动报名；保留原始来源和联系同意。' } = {}) {
  if (!service || !['read', 'convertContacts', 'issueInvitation', 'markManualSent', 'assignContact'].every(key => typeof service[key] === 'function')
    || typeof authenticate !== 'function') throw new TypeError('Invitation service and authentication required.');
  return async function handle(request) {
    try {
      const url = new URL(request.url), origin = request.headers.get('origin');
      if (url.origin !== ORIGIN || url.search || url.hash || !isIntentInvitationPath(url.pathname)) return json({ error: { code: 'NOT_FOUND', message: '接口不存在。' } }, 404);
      if (origin !== null && origin !== ORIGIN || request.method !== 'GET' && origin !== ORIGIN) throw failure('FORBIDDEN', 403);
      const session = await authenticate(request), actor = session?.user;
      if (!actor || !Array.isArray(actor.roles) || !actor.roles.some(role => ['outreach', 'superadmin'].includes(role))) throw failure('FORBIDDEN', 403);
      if (request.method !== 'GET' && !equalToken(request.headers.get('x-csrf-token'), session.csrfToken)) throw failure('FORBIDDEN', 403);
      if (url.pathname === '/api/admin/intent-invitations' && request.method === 'GET') return json(await service.read({ actor }));
      if (request.method !== 'POST') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: '此操作只接受明确提交。' } }, 405);
      const input = await readIntentBody(request);
      if (['/api/admin/contacts/invitations/preview', '/api/admin/contacts/invitations/prepare-batch'].includes(url.pathname)) {
        shape(input, url.pathname.endsWith('/preview') ? ['contactIds', 'expectedContactRevision']
          : ['contactIds', 'expectedContactRevision', 'previewToken', 'confirmPrepare']);
        const operation = url.pathname.endsWith('/preview') ? service.previewInvitations : service.prepareInvitations;
        if (typeof operation !== 'function') throw failure();
        return json(await operation({ ...input, actor }));
      }
      if (['/api/admin/contacts/convert', '/api/admin/contacts/convert/preview'].includes(url.pathname)) {
        shape(input, ['contactIds', 'expectedContactRevision']);
        return json(await service[url.pathname.endsWith('/preview') ? 'previewConversions' : 'convertContacts']({ ...input, actor, permissionReference }));
      }
      const match = url.pathname.match(/^\/api\/admin\/contacts\/([A-Za-z0-9][A-Za-z0-9_-]{0,79})\/(invitation|assignments)$/u);
      if (match) {
        shape(input, match[2] === 'invitation' ? ['expectedContactRevision', 'channel', 'expectedRegistrationId', 'confirmEmail'] : ['expectedContactRevision', 'sessionIds', 'boothIds']);
        return json(await service[match[2] === 'invitation' ? 'issueInvitation' : 'assignContact']({ ...input, contactId: match[1], actor }));
      }
      const manual = url.pathname.match(/^\/api\/admin\/intent-invitations\/([A-Za-z0-9][A-Za-z0-9_-]{0,99})\/manual-sent$/u);
      if (manual) { shape(input, ['channel']); return json(await service.markManualSent({ ...input, invitationId: manual[1], actor })); }
      return json({ error: { code: 'NOT_FOUND', message: '接口不存在。' } }, 404);
    } catch (error) {
      if (error instanceof IntentInvitationError) return json({ error: { code: error.code, message: error.message } }, error.status);
      if (error?.code === 'AUTH_REQUIRED' && error?.status === 401) return json({ error: { code: 'AUTH_REQUIRED', message: '请先登录。' } }, 401);
      return json({ error: { code: 'STORAGE_UNAVAILABLE', message: '操作未确认完成，请重新载入后核对。' } }, 503);
    }
  };
}
