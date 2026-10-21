import { guestPrefillFromContact } from '../../shared/contact-editor.mjs';
import { CONTACT_ID, contactsSource, contentSource, publicProfileProjection, organizationLookupProjection, organizationMemberships, revisionValue, timestamp } from './projection.mjs';

const ORIGIN = 'https://api.artdico.host', ROOT = '/api/admin/people/';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer', vary: 'Cookie, Origin' };
const errors = new WeakSet();
function fail(code = 'RELATIONSHIPS_UNAVAILABLE', status = 503) { const error = new Error(code); error.code = code; error.status = status; errors.add(error); throw error; }
const messages = { RELATIONSHIPS_UNAVAILABLE: '人员关联资料暂时无法核对，请稍后重新读取。', AUTH_REQUIRED: '会话已结束，请重新登录。',
  FORBIDDEN: '此账号没有读取这部分人员关联资料的权限。', NOT_FOUND: '未找到这项关联资料。', INVALID_REQUEST: '人员关联请求格式无效。',
  METHOD_NOT_ALLOWED: '人员关联接口只读取已保存记录。' };
function json(value, status = 200, extra = {}) {
  const body = JSON.stringify(value); if (Buffer.byteLength(body) > 2 * 1024 * 1024) fail();
  return new Response(body, { status, headers: { ...headers, ...extra } });
}
function text(value, maximum, required = false) {
  if (typeof value !== 'string' || !value.isWellFormed() || [...value].length > maximum || /[\u0000-\u001f\u007f]/u.test(value) || required && !value.trim()) fail();
  return value;
}
function records(value, maximum = 200) {
  if (!Array.isArray(value) || value.length > maximum) fail();
  const ids = new Set();
  for (const row of value) { if (!plain(row) || typeof row.id !== 'string' || !CONTACT_ID.test(row.id) || ids.has(row.id)) fail(); ids.add(row.id); }
  return value;
}

/** This lookup contains no profile text, contact details or private roster data. */
export function personRelationshipsProjection(value) {
  if (plain(value?.content) && Object.hasOwn(value.content, 'guests') && !Array.isArray(value.content.guests)) fail();
  const source = contentSource(value), organizations = organizationLookupProjection(source), guests = records(source.content.guests ?? []),
    booths = source.content.booths, seenIds = new Set(), seenContacts = new Set();
  for (const row of [...source.content.sessions, ...booths, ...guests, ...organizations]) {
    if (seenIds.has(row.id)) fail(); seenIds.add(row.id);
  }
  if (!source.hasPublished || source.published !== null && (!plain(source.published) || !plain(source.published.content))) fail();
  const saved = source.published === null ? [] : records(source.published.content.guests);
  const publishedRevision = source.published === null ? null : revisionValue(source.published.revision);
  if (publishedRevision !== null && publishedRevision > source.revision) fail();
  if (source.published !== null) timestamp(source.published.publishedAt, false);
  const profiles = [];
  for (const guest of guests) {
    if (guest.contactId !== undefined && (typeof guest.contactId !== 'string' || guest.contactId && !CONTACT_ID.test(guest.contactId))) fail();
    if (!guest.contactId) continue;
    if (seenContacts.has(guest.contactId)) fail(); seenContacts.add(guest.contactId);
    const result = publicProfileProjection(guest.contactId, source), profile = result.profiles.find(item => item.id === guest.id);
    if (!profile) fail();
    profiles.push({ id: profile.id, contactId: guest.contactId, publicRoles: profile.publicRoles, status: profile.status,
      publicConsent: profile.publicConsent, hasPortrait: profile.hasPortrait, published: profile.published, publishedMatchesDraft: profile.publishedMatchesDraft });
  }
  const boothOrganizations = booths.flatMap(booth => {
    if (!Object.hasOwn(booth, 'organizationId')) return [];
    if (typeof booth.organizationId !== 'string' || booth.organizationId && !CONTACT_ID.test(booth.organizationId)) fail();
    return booth.organizationId ? [{ boothId: booth.id, organizationId: booth.organizationId }] : [];
  });
  return { schemaVersion: 1, contentRevision: source.revision, publishedRevision, organizations, profiles, boothOrganizations,
    publicationAttributionUnavailable: saved.some(item => !guests.some(guest => guest.id === item.id && Boolean(guest.contactId))) };
}

function pagination(url, { candidates = false } = {}) {
  const allowed = candidates ? ['query', 'id', 'cursor', 'limit'] : ['cursor', 'limit'];
  for (const key of url.searchParams.keys()) if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) fail('INVALID_REQUEST', 400);
  const integer = (key, fallback, maximum) => {
    if (!url.searchParams.has(key)) return fallback;
    const input = url.searchParams.get(key);
    if (!/^(?:0|[1-9]\d*)$/u.test(input) || !Number.isSafeInteger(Number(input)) || Number(input) > maximum) fail('INVALID_REQUEST', 400);
    return Number(input);
  };
  const cursor = integer('cursor', 0, 5000), limit = integer('limit', 100, 200);
  if (limit < 1) fail('INVALID_REQUEST', 400);
  const id = url.searchParams.get('id') ?? '', query = url.searchParams.get('query') ?? '';
  if (candidates && (url.searchParams.has('id') && (!CONTACT_ID.test(id) || url.searchParams.has('query') || url.searchParams.has('cursor'))
    || !query.isWellFormed() || [...query].length > 200 || /[\u0000-\u001f\u007f]/u.test(query))) fail('INVALID_REQUEST', 400);
  return { cursor, limit, id, query: query.trim().toLocaleLowerCase('zh-CN') };
}
function page(rows, { cursor, limit }) { return { total: rows.length, nextCursor: cursor + limit < rows.length ? String(cursor + limit) : null }; }
function minimalContact(row) {
  if (!plain(row.profile) || !plain(row.operations)) fail();
  return { id: row.id, name: text(row.profile.displayName || row.profile.name, 120, true), organization: text(row.profile.organization, 300) };
}

export function isPersonRelationshipsPath(path) { return typeof path === 'string' &&
  (path === ROOT + 'relationships' || path === ROOT + 'candidates' || path.startsWith(ROOT + 'organizations/')); }

/** Gates precede content/roster reads. Every response is a bounded private projection. */
export function createPersonRelationshipsApi({ authenticate, loadContent, loadContacts } = {}) {
  if (typeof authenticate !== 'function' || [loadContent, loadContacts].some(loader => loader !== undefined && typeof loader !== 'function')) throw new TypeError('Trusted relationship dependencies required.');
  return async request => {
    let allow;
    try {
      const url = new URL(request.url), origin = request.headers.get('origin');
      if (url.origin !== ORIGIN || url.username || url.password || url.hash) fail('NOT_FOUND', 404);
      const catalog = url.pathname === ROOT + 'relationships', candidates = url.pathname === ROOT + 'candidates',
        member = url.pathname.match(/^\/api\/admin\/people\/organizations\/([^/]+)\/members$/u);
      if (!catalog && !candidates && !member) fail('NOT_FOUND', 404);
      if (origin !== null && origin !== ORIGIN) fail('FORBIDDEN', 403);
      if (request.method !== 'GET') { allow = 'GET'; fail('METHOD_NOT_ALLOWED', 405); }
      const aborted = () => { if (request.signal.aborted) fail(); }; aborted();
      const session = await authenticate(request), actor = session?.user; aborted();
      if (typeof actor?.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/u.test(actor.id) || !Array.isArray(actor.roles)) fail('AUTH_REQUIRED', 401);
      if (!actor.roles.includes('outreach') || candidates && !actor.roles.includes('editor')) fail('FORBIDDEN', 403);
      if (catalog && url.search) fail('INVALID_REQUEST', 400);
      const paging = catalog ? null : pagination(url, { candidates });
      if (member && !CONTACT_ID.test(member[1])) fail('INVALID_REQUEST', 400);
      async function load(loader) { if (!loader) fail(); const value = await loader(actor); aborted(); return value; }
      let body;
      if (catalog) body = personRelationshipsProjection(await load(loadContent));
      else if (candidates) {
        const snapshot = contactsSource(await load(loadContacts)), rows = snapshot.contacts.map(row => ({ ...minimalContact(row), eligible: guestPrefillFromContact(row).valid }))
          .filter(row => (!paging.id || row.id === paging.id) && (!paging.query || [row.name, row.organization, row.id].some(value => value.toLocaleLowerCase('zh-CN').includes(paging.query))));
        body = { schemaVersion: 1, contactsRevision: snapshot.revision, candidates: rows.slice(paging.cursor, paging.cursor + paging.limit), ...page(rows, paging) };
      } else {
        const source = contentSource(await load(loadContent));
        if (!organizationLookupProjection(source).some(row => row.id === member[1])) fail('NOT_FOUND', 404);
        const snapshot = contactsSource(await load(loadContacts)), rows = snapshot.contacts.flatMap(row => {
          const membership = organizationMemberships(row.operations).find(item => item.organizationId === member[1]);
          return membership ? [{ contactId: row.id, name: minimalContact(row).name, role: membership.role, title: membership.title }] : [];
        });
        body = { schemaVersion: 1, organizationId: member[1], contentRevision: source.revision, contactsRevision: snapshot.revision,
          members: rows.slice(paging.cursor, paging.cursor + paging.limit), ...page(rows, paging) };
      }
      aborted(); return json(body);
    } catch (failure) {
      const trusted = errors.has(failure), auth = failure?.status === 401 || failure?.code === 'AUTH_REQUIRED',
        code = auth ? 'AUTH_REQUIRED' : trusted ? failure.code : 'RELATIONSHIPS_UNAVAILABLE', status = auth ? 401 : trusted ? failure.status : 503;
      return json({ error: { code, message: messages[code] } }, status, allow ? { allow } : {});
    }
  };
}
