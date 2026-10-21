import { createHash } from 'node:crypto';
import { equalToken } from '../content-api/auth.mjs';
import { CloudContentError } from '../cloud-content/errors.mjs';
import { ContentError } from '../content-api/store.mjs';
import { RegistrationAdminError, isRegistrationAdminError } from './errors.mjs';
import { registrationFilters } from './store.mjs';
import { registrationWorkbook, contactsWorkbook } from './xlsx-export.mjs';
import { XLSX_MIME } from '../../shared/xlsx-workbook.mjs';

const ORIGIN = 'https://api.artdico.host', MAX_BODY = 16 * 1024;
const SECURITY = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', vary: 'Cookie, Origin' };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = code => { throw new RegistrationAdminError(code); };
const validRevision = value => Number.isSafeInteger(value) && value >= 0;
const has = (user, role) => user.roles.includes(role);
const reviewRole = user => user.roles.some(role => ['reviewer', 'superadmin'].includes(role));
const contactRole = user => user.roles.some(role => ['outreach', 'superadmin'].includes(role));
const planningRole = user => has(user, 'superadmin') || has(user, 'reviewer') && has(user, 'outreach');
function errorResponse(error) {
  if (error instanceof CloudContentError && error.code === 'AUTH_REQUIRED' && error.status === 401) error = new RegistrationAdminError('AUTH_REQUIRED');
  if ((error instanceof CloudContentError || error instanceof ContentError) && ['REVISION_CONFLICT', 'WRITE_CONFLICT'].includes(error.code) && error.status === 409) error = new RegistrationAdminError('REVISION_CONFLICT');
  const safe = isRegistrationAdminError(error) ? error : new RegistrationAdminError();
  return new Response(JSON.stringify({ error: { code: safe.code, message: safe.message } }), { status: safe.status, headers: { ...SECURITY, 'content-type': 'application/json; charset=utf-8' } });
}
function exactKeys(input, allowed, required) {
  if (!plain(input) || Object.keys(input).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(input, key))) fail('INVALID_REQUEST');
}
async function readBody(request) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/iu.test(request.headers.get('content-type') ?? '') || ![null, 'identity'].includes(request.headers.get('content-encoding'))) fail('UNSUPPORTED_MEDIA_TYPE');
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/u.test(length) || !Number.isSafeInteger(Number(length)))) fail('INVALID_REQUEST');
  if (Number(length) > MAX_BODY) fail('BODY_TOO_LARGE');
  const reader = request.body?.getReader(), chunks = []; let size = 0;
  const controller = new AbortController(), signal = AbortSignal.any([request.signal, controller.signal]);
  let onAbort;
  const aborted = new Promise((_, reject) => { onAbort = () => { reader?.cancel().catch(() => {}); reject(new RegistrationAdminError('INVALID_REQUEST')); }; signal.addEventListener('abort', onAbort, { once: true }); });
  const timer = setTimeout(() => controller.abort(), 10_000); timer.unref?.();
  try {
    if (signal.aborted) fail('INVALID_REQUEST');
    if (reader) for (;;) { const part = await Promise.race([reader.read(), aborted]); if (part.done) break; size += part.value.byteLength; if (size > MAX_BODY) fail('BODY_TOO_LARGE'); chunks.push(part.value); }
    if (length !== null && Number(length) !== size) fail('INVALID_REQUEST');
    const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    if (!plain(input)) fail('INVALID_REQUEST');
    return input;
  } catch (error) { if (isRegistrationAdminError(error)) throw error; fail('INVALID_REQUEST'); }
  finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); if (reader) { reader.cancel().catch(() => {}); reader.releaseLock(); } }
}
async function authorize(request, auth, role, path, enabled) {
  const url = new URL(request.url);
  if (url.pathname !== path || url.search || url.hash || url.origin !== ORIGIN || url.username || url.password) fail('NOT_FOUND');
  if (!enabled) fail('REVIEW_NOT_READY');
  if (request.method !== 'POST') fail('NOT_FOUND');
  if (request.headers.get('origin') !== ORIGIN) fail('ORIGIN_REJECTED');
  const session = await auth.authenticate(request);
  if (!session?.user) fail('AUTH_REQUIRED');
  if (!Array.isArray(session.user.roles) || !role(session.user)) fail('FORBIDDEN');
  if (!equalToken(request.headers.get('x-csrf-token'), session.csrfToken)) fail('CSRF_REJECTED');
  return session.user;
}
function binary(workbook, filename, revision, count, hash, extra = {}) {
  return new Response(workbook, { headers: { ...SECURITY, 'content-type': XLSX_MIME, 'content-length': String(workbook.length), 'content-disposition': 'attachment; filename="' + filename + '"',
    'x-review-revision': String(revision), 'x-export-count': String(count), 'x-export-sha256': hash, ...extra } });
}

/** No data source is called before the complete role, Origin, CSRF and scope gate. */
export function createRegistrationXlsxApi({ enabled = false, auth, store, loadAdmissions, loadArrangements, canExport = user => has(user, 'superadmin') } = {}) {
  if (typeof enabled !== 'boolean' || typeof canExport !== 'function' || enabled && (typeof auth?.authenticate !== 'function' || typeof store?.exportXlsx !== 'function' || typeof loadAdmissions !== 'function')
    || loadArrangements !== undefined && typeof loadArrangements !== 'function') throw new TypeError('Workbook export dependencies are unavailable.');
  return async function handle(request) {
    try {
      const user = await authorize(request, auth, reviewRole, '/api/admin/registrations/export.xlsx', enabled);
      if (!await canExport(user)) fail('FORBIDDEN');
      const input = await readBody(request);
      exactKeys(input, ['expectedRevision', 'filters', 'includeContact', 'includeAnswers', 'includeArrangements'], ['expectedRevision']);
      const { includeContact = false, includeAnswers = false, includeArrangements = false } = input;
      if (!validRevision(input.expectedRevision) || [includeContact, includeAnswers, includeArrangements].some(flag => typeof flag !== 'boolean')) fail('INVALID_REQUEST');
      const filters = registrationFilters(input.filters ?? {});
      if (includeContact && !has(user, 'superadmin') || includeArrangements && !planningRole(user)) fail('FORBIDDEN');
      if (includeArrangements && typeof loadArrangements !== 'function') fail('STORAGE_UNAVAILABLE');
      const [admissions, arrangements] = await Promise.all([loadAdmissions(user), includeArrangements ? loadArrangements(user) : null]);
      const result = await store.exportXlsx(input.expectedRevision, filters, user.id, { includeContact, includeAnswers, includeArrangements,
        build: current => registrationWorkbook({ ...current, admissions, arrangements, includeContact, includeAnswers, includeArrangements }) });
      return binary(result.workbook, 'artdico-registration-attendance.xlsx', result.revision, result.count, result.workbookSha256, { 'x-admission-revision': String(result.sourceRevisions.admissions) });
    } catch (error) { return errorResponse(error); }
  };
}

/** This separate full-roster export includes unconverted and declined contacts explicitly. */
export function createContactsXlsxApi({ enabled = false, auth, contactsStore, loadContent, clock = Date.now } = {}) {
  if (typeof enabled !== 'boolean' || typeof clock !== 'function' || enabled && (typeof auth?.authenticate !== 'function' || typeof contactsStore?.read !== 'function' || typeof contactsStore?.recordExport !== 'function' || typeof loadContent !== 'function')) throw new TypeError('Contact workbook export dependencies are unavailable.');
  return async function handle(request) {
    try {
      const user = await authorize(request, auth, contactRole, '/api/admin/contacts/export.xlsx', enabled);
      const input = await readBody(request); exactKeys(input, ['expectedRevision', 'includeContact', 'includeAnswers'], ['expectedRevision']);
      const { includeContact = false, includeAnswers = false } = input;
      if (!validRevision(input.expectedRevision) || typeof includeContact !== 'boolean' || typeof includeAnswers !== 'boolean') fail('INVALID_REQUEST');
      const [roster, draft] = await Promise.all([contactsStore.read(), loadContent(user)]);
      if (!roster || !validRevision(roster.revision) || !Array.isArray(roster.contacts) || !draft || !validRevision(draft.revision)) fail('STORAGE_UNAVAILABLE');
      if (roster.revision !== input.expectedRevision) fail('REVISION_CONFLICT');
      const now = clock(); if (!Number.isSafeInteger(now) || now < 0) fail('STORAGE_UNAVAILABLE');
      const workbook = contactsWorkbook({ contacts: roster.contacts, content: draft.content, contactRevision: roster.revision, contentRevision: draft.revision, includeContact, includeAnswers, exportedAt: new Date(now).toISOString() });
      const workbookSha256 = createHash('sha256').update(workbook).digest('hex');
      const result = await contactsStore.recordExport(roster.revision, user.id, { count: roster.contacts.length, includeContact, includeAnswers, workbookSha256 });
      if (!result || result.revision !== roster.revision + 1) fail('STORAGE_UNAVAILABLE');
      return binary(workbook, 'artdico-all-contacts.xlsx', result.revision, roster.contacts.length, workbookSha256, { 'x-contact-revision': String(result.revision) });
    } catch (error) { return errorResponse(error); }
  };
}
