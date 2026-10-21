import { equalToken } from '../content-api/auth.mjs';
import { ContentError } from '../content-api/store.mjs';
import { PORTRAIT_ID_PATTERN } from '../../shared/content-schema.mjs';
import { CloudContentError } from './errors.mjs';
import { createPreviewCommunications } from '../content-api/communications.mjs';
import { toContactPlanningContent } from '../../shared/contact-editor.mjs';
import { buildArrangementOverview } from '../../shared/arrangement-overview.mjs';

export const CLOUD_API_ORIGIN = 'https://api.artdico.host';
export const PUBLIC_SITE_ORIGIN = 'https://artdico.host';
export const MAX_CLOUD_BODY_BYTES = 1024 * 1024;
const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SECURITY = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };

function json(value, status = 200, extra = {}, head = false) {
  const body = JSON.stringify(value);
  return new Response(head ? null : body, { status, headers: { ...SECURITY, 'content-type': 'application/json; charset=utf-8', 'content-length': String(Buffer.byteLength(body)), ...extra } });
}

async function inputBody(request) {
  if (!/^application\/json(?:\s*;|$)/iu.test(request.headers.get('content-type') ?? '')) throw new CloudContentError('UNSUPPORTED_MEDIA_TYPE', '请发送 JSON 请求。', 415);
  const encoding = request.headers.get('content-encoding');
  if (encoding !== null && encoding !== 'identity') throw new CloudContentError('UNSUPPORTED_ENCODING', '请求编码不受支持。', 415);
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/u.test(length) || !Number.isSafeInteger(Number(length)))) throw new CloudContentError('INVALID_JSON', '请求格式无效。', 400);
  if (length !== null && Number(length) > MAX_CLOUD_BODY_BYTES) throw new CloudContentError('BODY_TOO_LARGE', '请求内容过大。', 413);
  const chunks = []; let bytes = 0;
  const reader = request.body?.getReader();
  let timedOut = false, rejectAbort;
  const controller = new AbortController();
  const signal = AbortSignal.any([request.signal, controller.signal]);
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 10_000);
  timer.unref();
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  const onAbort = () => {
    reader?.cancel().catch(() => {});
    rejectAbort(new CloudContentError(timedOut ? 'REQUEST_TIMEOUT' : 'INVALID_JSON', timedOut ? '请求读取超时。' : '请求格式无效。', timedOut ? 408 : 400));
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    if (signal.aborted) throw new CloudContentError('INVALID_JSON', '请求格式无效。', 400);
    if (reader) while (true) {
      const part = await Promise.race([reader.read(), aborted]);
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_CLOUD_BODY_BYTES) throw new CloudContentError('BODY_TOO_LARGE', '请求内容过大。', 413);
      chunks.push(part.value);
    }
    if (length !== null && Number(length) !== bytes) throw new CloudContentError('INVALID_JSON', '请求格式无效。', 400);
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch (error) {
    if (error instanceof CloudContentError) throw error;
    throw new CloudContentError('INVALID_JSON', '请求格式无效。', 400);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
    if (reader) { reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
}

function requireRole(session, roles) {
  if (!session.user.roles.some(role => roles.includes(role))) throw new CloudContentError('FORBIDDEN', '当前账号没有此操作权限。', 403);
}

/** Production Request boundary. The caller must supply shared, persistent implementations. */
export function createCloudContentApi({ enabled = false, store, portraitStore, auth, contactsStore, communications = createPreviewCommunications(), beforeContactMutation } = {}) {
  if (typeof enabled !== 'boolean') throw new TypeError('云端内容服务开关必须为布尔值。');
  if (enabled && (!['read', 'save', 'publish', 'recordPortraitUpload'].every(key => typeof store?.[key] === 'function')
    || !['read', 'upload'].every(key => typeof portraitStore?.[key] === 'function')
    || !['login', 'authenticate', 'logout'].every(key => typeof auth?.[key] === 'function'))) throw new TypeError('云端内容服务依赖未配置。');
  if (contactsStore && !['read', 'createContact', 'saveProfile', 'saveOperations', 'recordGenerated', 'recordSent', 'guestPrefill'].every(key => typeof contactsStore[key] === 'function')) throw new TypeError('云端私密名单依赖未配置。');
  if (beforeContactMutation !== undefined && typeof beforeContactMutation !== 'function') throw new TypeError('联系人写入核对配置无效。');
  return async function handle(request) {
    let cors = {}, head = false;
    try {
      const url = new URL(request.url);
      head = request.method === 'HEAD';
      if (url.origin !== CLOUD_API_ORIGIN || url.username || url.password) throw new CloudContentError('ORIGIN_REJECTED', '请求来源不被允许。', 403);
      if (!enabled) return json({ error: { code: 'CONTENT_NOT_READY', message: '云端内容后台尚未开放。' } }, 503, {}, head);
      const isPublic = url.pathname === '/api/public/content' || url.pathname.startsWith('/api/public/portraits/');
      const givenOrigin = request.headers.get('origin');
      if (isPublic && givenOrigin === PUBLIC_SITE_ORIGIN) cors = { 'access-control-allow-origin': PUBLIC_SITE_ORIGIN, vary: 'Origin' };
      if (givenOrigin !== null && givenOrigin !== CLOUD_API_ORIGIN && !(isPublic && givenOrigin === PUBLIC_SITE_ORIGIN)) throw new CloudContentError('ORIGIN_REJECTED', '请求来源不被允许。', 403);
      if (url.search || url.hash) throw new CloudContentError('NOT_FOUND', '接口不存在。', 404);
      if (request.method === 'OPTIONS' && isPublic && givenOrigin === PUBLIC_SITE_ORIGIN) {
        const method = request.headers.get('access-control-request-method');
        const headers = request.headers.get('access-control-request-headers');
        if (!['GET', 'HEAD'].includes(method) || headers && headers.toLowerCase() !== 'accept') throw new CloudContentError('CORS_REJECTED', '请求来源不被允许。', 403);
        return new Response(null, { status: 204, headers: { ...SECURITY, ...cors, 'access-control-allow-methods': 'GET, HEAD', ...(headers ? { 'access-control-allow-headers': 'Accept' } : {}) } });
      }
      if (WRITES.has(request.method) && givenOrigin !== CLOUD_API_ORIGIN) throw new CloudContentError('ORIGIN_REJECTED', '请求来源不被允许。', 403);
      if (url.pathname === '/api/public/content' && ['GET', 'HEAD'].includes(request.method)) {
        const { published } = await store.read();
        return published ? json(published, 200, cors, head) : json({ error: { code: 'NOT_PUBLISHED', message: '内容尚未发布。' } }, 404, cors, head);
      }
      const publicPortrait = url.pathname.startsWith('/api/public/portraits/') ? url.pathname.slice('/api/public/portraits/'.length) : '';
      if (publicPortrait && ['GET', 'HEAD'].includes(request.method) && PORTRAIT_ID_PATTERN.test(publicPortrait)) {
        const { published } = await store.read();
        const inGuest = published?.content.guests.some(guest => guest.portraitId === publicPortrait && guest.status === 'confirmed' && guest.publicConsent === true);
        const inShowcase = published?.content.showcases?.some(showcase => showcase.coverId === publicPortrait && showcase.status === 'confirmed' && showcase.responseStatus === 'attending' && showcase.publicConsent === true);
        const inOrganization = published?.content.organizations?.some(organization => organization.logoUrl === '/api/public/portraits/' + publicPortrait);
        if (!inGuest && !inShowcase && !inOrganization) throw new CloudContentError('NOT_FOUND', '图片不存在。', 404);
        const portrait = await portraitStore.read(publicPortrait);
        return new Response(head ? null : portrait.data, { headers: { ...SECURITY, ...cors, 'content-type': portrait.contentType, 'content-length': String(portrait.bytes) } });
      }
      if (url.pathname === '/api/admin/environment' && request.method === 'GET') return json({ mode: 'cloud', scope: contactsStore ? 'content-and-outreach' : 'content-only', registration: 'closed' });
      if (url.pathname === '/api/admin/login' && request.method === 'POST') {
        const input = await inputBody(request);
        const login = await auth.login({ identifier: input.username, password: input.password });
        return json({ user: login.user, csrfToken: login.csrfToken }, 200, { 'set-cookie': login.cookie });
      }
      if (url.pathname === '/api/registrations' || url.pathname.startsWith('/api/registrations/')) return json({ error: { code: 'REGISTRATION_CLOSED', message: '本站正式报名尚未接通。' } }, 503, {}, head);
      if (!url.pathname.startsWith('/api/admin/')) throw new CloudContentError('NOT_FOUND', '接口不存在。', 404);
      const session = await auth.authenticate(request);
      if (WRITES.has(request.method) && !equalToken(request.headers.get('x-csrf-token'), session.csrfToken)) throw new CloudContentError('CSRF_REJECTED', '安全校验未通过，请重新载入后台。', 403);
      if (url.pathname === '/api/admin/session' && request.method === 'GET') return json({ user: session.user, csrfToken: session.csrfToken });
      if (url.pathname === '/api/admin/logout' && request.method === 'POST') {
        const logout = await auth.logout(session);
        return json({ ok: true }, 200, { 'set-cookie': logout.cookie });
      }
      if (url.pathname === '/api/admin/planning' && request.method === 'GET') {
        requireRole(session, ['outreach']);
        const { draft } = await store.read();
        return json({ content: toContactPlanningContent(draft.content), features: { contactImport: false, communicationsPreview: true } });
      }
      if (url.pathname === '/api/admin/arrangements' && request.method === 'GET' && !url.search) {
        requireRole(session, ['editor']);
        requireRole(session, ['outreach']);
        if (!contactsStore) throw new CloudContentError('CONTACTS_UNAVAILABLE', '私密联系人模块尚未配置，不能读取完整人员安排。', 503);
        const [{ draft }, roster] = await Promise.all([store.read(), contactsStore.read()]);
        return json(buildArrangementOverview({ content: draft.content, contacts: roster.contacts, contentRevision: draft.revision, contactsRevision: roster.revision }));
      }
      if (url.pathname === '/api/admin/communications' && request.method === 'GET') {
        requireRole(session, ['outreach']);
        return json(communications.readiness());
      }
      if (url.pathname === '/api/admin/contacts' || url.pathname.startsWith('/api/admin/contacts/')) {
        requireRole(session, ['outreach']);
        if (!contactsStore) throw new CloudContentError('CONTACTS_UNAVAILABLE', '私密联系人模块尚未配置。', 503);
        if (url.pathname === '/api/admin/contacts' && request.method === 'GET') return json(await contactsStore.read());
        if (url.pathname === '/api/admin/contacts' && request.method === 'POST') {
          const input = await inputBody(request);
          return json(await contactsStore.createContact(input.expectedRevision, input.profile, session.user.id), 201);
        }
        if (['/api/admin/contacts/import', '/api/admin/contacts/import/preview'].includes(url.pathname)) throw new CloudContentError('CONTACT_IMPORT_UNAVAILABLE', '云端 Excel 导入尚未开放，请勿上传来源文件。', 503);
        const contactRoute = url.pathname.match(/^\/api\/admin\/contacts\/([A-Za-z0-9][A-Za-z0-9_-]{0,79})(?:\/(profile|guest-prefill|invitation\/(?:generated|sent)|(?:email|wallet)\/preview))?$/u);
        const id = contactRoute?.[1], action = contactRoute?.[2];
        if (id && action === 'guest-prefill' && request.method === 'GET') {
          requireRole(session, ['editor']);
          return json(await contactsStore.guestPrefill(id));
        }
        if (id && action === 'profile' && request.method === 'PUT') {
          const input = await inputBody(request);
          return json(await contactsStore.saveProfile(id, input.expectedRevision, input.profile, session.user.id));
        }
        if (id && !action && request.method === 'PUT') {
          const input = await inputBody(request);
          await beforeContactMutation?.({ contactId: id, actor: session.user, action: 'operations', input });
          return json(await contactsStore.saveOperations(id, input.expectedRevision, input.operations, session.user.id));
        }
        if (id && action === 'invitation/generated' && request.method === 'POST') {
          const input = await inputBody(request);
          await beforeContactMutation?.({ contactId: id, actor: session.user, action: 'invitation', input });
          return json(await contactsStore.recordGenerated(id, input.expectedRevision, input.settings, session.user.id));
        }
        if (id && action === 'invitation/sent' && request.method === 'POST') {
          const input = await inputBody(request);
          await beforeContactMutation?.({ contactId: id, actor: session.user, action: 'invitation', input });
          return json(await contactsStore.recordSent(id, input.expectedRevision, input.channel, input.generatedAt, input.settings, session.user.id));
        }
        if (id && ['email/preview', 'wallet/preview'].includes(action) && request.method === 'POST') {
          const input = await inputBody(request), { contacts } = await contactsStore.read();
          const contact = contacts.find(item => item.id === id);
          return json(action === 'email/preview' ? communications.emailPreview(contact, input.settings) : communications.walletPreview(contact, input.settings));
        }
        throw new CloudContentError('NOT_FOUND', '联系人接口或方法不存在。', 404);
      }
      if (url.pathname === '/api/admin/content' && request.method === 'GET') {
        requireRole(session, ['editor', 'publisher']);
        return json(await store.read());
      }
      if (url.pathname === '/api/admin/content' && request.method === 'PUT') {
        requireRole(session, ['editor']);
        const input = await inputBody(request);
        return json({ draft: await store.save(input.expectedRevision, input.content, session.user.id) });
      }
      if (url.pathname === '/api/admin/content/publish' && request.method === 'POST') {
        requireRole(session, ['publisher']);
        const input = await inputBody(request);
        return json({ published: await store.publish(input.expectedRevision, session.user.id) });
      }
      if (url.pathname === '/api/admin/portraits' && request.method === 'POST') {
        requireRole(session, ['editor']);
        const input = await inputBody(request);
        const portrait = await portraitStore.upload({ contentType: input.contentType, dataBase64: input.dataBase64 });
        await store.recordPortraitUpload(portrait.id, session.user.id);
        return json({ portrait }, 201);
      }
      const privatePortrait = url.pathname.startsWith('/api/admin/portraits/') ? url.pathname.slice('/api/admin/portraits/'.length) : '';
      if (privatePortrait && request.method === 'GET' && PORTRAIT_ID_PATTERN.test(privatePortrait)) {
        requireRole(session, ['editor', 'publisher']);
        const portrait = await portraitStore.read(privatePortrait);
        return new Response(portrait.data, { headers: { ...SECURITY, 'content-type': portrait.contentType, 'content-length': String(portrait.bytes) } });
      }
      throw new CloudContentError('NOT_FOUND', '接口或方法不存在。', 404);
    } catch (error) {
      if (error instanceof CloudContentError || error instanceof ContentError) return json({ error: { code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) } }, error.status, { ...cors,
        ...(error.status === 429 && Number.isSafeInteger(error.retryAfter) && error.retryAfter > 0 && error.retryAfter <= 900 ? { 'retry-after': String(error.retryAfter) } : {}),
      }, head);
      return json({ error: { code: 'SERVICE_UNAVAILABLE', message: '操作未确认完成，请重新载入后核对。' } }, 503, cors, head);
    }
  };
}
