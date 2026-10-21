import { CONTACT_ID, REGISTRATION_ID, contactsSource, contactProjection, intentSource, registrationSource, admissionSource,
  contentSource, arrangementsProjection, publicProfileProjection, confirmationsSource, volunteersSource, communicationProjection, personPermissions } from './projection.mjs';

const ORIGIN = 'https://api.artdico.host';
const ROOT = '/api/admin/people/';
const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer', vary: 'Cookie, Origin' };
const json = (value, status = 200, extra = {}) => new Response(JSON.stringify(value), { status, headers: { ...headers, ...extra } });
const error = (code, message, status) => json({ error: { code, message } }, status);
const unavailable = () => error('PERSON_UNAVAILABLE', '人员资料暂时无法核对，请稍后重新读取。', 503);
export function isPersonWorkspacePath(path) { return typeof path === 'string' && path.startsWith(ROOT); }
const aborted = request => { if (request.signal.aborted) throw new Error('Person request ended.'); };

/** Read-only aggregate. Each trusted source is requested only after its own role gate.
 * Full original answers, capability links and provider configuration never enter the projection.
 */
export function createPersonWorkspaceApi({ authenticate, loadContacts, loadIntent, loadRegistration, loadAdmission, loadContent, loadConfirmations, loadVolunteers } = {}) {
  if (typeof authenticate !== 'function') throw new TypeError('Person authentication required.');
  for (const loader of [loadContacts, loadIntent, loadRegistration, loadAdmission, loadContent, loadConfirmations, loadVolunteers])
    if (loader !== undefined && typeof loader !== 'function') throw new TypeError('Trusted person source required.');
  return async function handle(request) {
    const url = new URL(request.url), origin = request.headers.get('origin');
    if (url.origin !== ORIGIN || url.username || url.password || url.search || url.hash) return error('NOT_FOUND', '接口不存在。', 404);
    const match = url.pathname.match(/^\/api\/admin\/people\/(contacts|registrations)\/([^/]+)$/u);
    if (!match) return error('NOT_FOUND', '接口不存在。', 404);
    if (origin !== null && origin !== ORIGIN) return error('FORBIDDEN', '此来源不能读取人员资料。', 403);
    if (request.method !== 'GET') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: '人员工作页只读取已保存记录。' } }, 405, { allow: 'GET' });
    try {
      aborted(request);
      const session = await authenticate(request), actor = session?.user;
      if (typeof actor?.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/u.test(actor.id) || !Array.isArray(actor.roles)) return error('AUTH_REQUIRED', '请先登录。', 401);
      const permissions = personPermissions(actor), kind = match[1] === 'contacts' ? 'contact' : 'registration', id = match[2];
      if (!permissions[kind]) return error('FORBIDDEN', '此账号没有读取这类人员资料的权限。', 403);
      if (!(kind === 'contact' ? CONTACT_ID : REGISTRATION_ID).test(id)) return error('INVALID_PERSON_ID', '人员编号无效。', 400);
      const availability = { contact: permissions.contact ? 'unlinked' : 'restricted', registration: permissions.registration ? 'unlinked' : 'restricted',
        admission: 'unlinked', arrangements: permissions.arrangements ? 'unlinked' : 'restricted',
        invitations: permissions.invitations ? 'unlinked' : 'restricted', confirmations: permissions.confirmations ? 'unlinked' : 'restricted',
        publicProfile: permissions.arrangements ? 'unlinked' : 'restricted', volunteers: permissions.volunteers ? 'unlinked' : 'restricted' };
      const revisions = { contacts: null, content: null, invitations: null, registration: null, admission: null, confirmations: null, volunteers: null };
      async function attempt(loader, args, validate) {
        aborted(request);
        if (!loader) return { state: 'unavailable', value: null };
        try {
          const loaded = await loader(...args); aborted(request);
          if (loaded === null || loaded === undefined) return { state: 'unavailable', value: null };
          return { state: 'available', value: validate(loaded) };
        } catch (failure) {
          aborted(request);
          if (failure?.status === 401 || failure?.code === 'AUTH_REQUIRED') throw failure;
          return { state: 'unavailable', value: null, notFound: failure?.status === 404 || failure?.code === 'NOT_FOUND' };
        }
      }
      let contactRaw = null, contact = null, registration = null, contactId = kind === 'contact' ? id : null,
        registrationId = kind === 'registration' ? id : null, linkageState = 'unlinked', intent = null, admission = null, content = null, confirmations = null;
      if (kind === 'contact') {
        const roster = await attempt(loadContacts, [actor], contactsSource);
        if (roster.state !== 'available') return unavailable();
        contactRaw = roster.value.contacts.find(item => item.id === id);
        if (!contactRaw) return error('PERSON_NOT_FOUND', '未找到这位人员。', 404);
        try { contact = contactProjection(contactRaw); } catch { return unavailable(); }
        availability.contact = 'available'; revisions.contacts = roster.value.revision;
      } else {
        const loaded = await attempt(loadRegistration, [id, actor], value => registrationSource(value, id));
        if (loaded.state !== 'available') return loaded.notFound ? error('PERSON_NOT_FOUND', '未找到这份报名。', 404) : unavailable();
        registration = loaded.value.registration;
        availability.registration = 'available'; revisions.registration = loaded.value.revision;
        if (loaded.value.sourceContactId) {
          if (permissions.contact) { contactId = loaded.value.sourceContactId; linkageState = 'linked'; }
          else linkageState = 'restricted';
        }
      }
      if (permissions.invitations && contactId) {
        const loaded = await attempt(loadIntent, [actor], intentSource);
        availability.invitations = loaded.state;
        if (loaded.value) {
          intent = loaded.value; revisions.invitations = intent.revision;
          const linked = intent.conversions.find(item => item.sourceContactId === contactId);
          if (kind === 'contact') { registrationId = linked?.registrationId ?? null; linkageState = linked ? 'linked' : 'unlinked'; }
          else if (linked && linked.registrationId !== registrationId) {
            linkageState = 'unavailable'; contactId = null; intent = null;
            availability.contact = availability.invitations = 'unavailable'; revisions.invitations = null;
          }
        } else if (kind === 'contact') linkageState = 'unavailable';
      }
      if (kind === 'registration' && permissions.contact && contactId) {
        const roster = await attempt(loadContacts, [actor], contactsSource);
        availability.contact = roster.state;
        if (roster.value) {
          contactRaw = roster.value.contacts.find(item => item.id === contactId);
          try { contact = contactRaw ? contactProjection(contactRaw) : null; } catch { contact = null; }
          if (contact) { revisions.contacts = roster.value.revision; availability.contact = 'available'; }
          else { availability.contact = 'unavailable'; linkageState = 'unavailable'; contactRaw = null; }
        } else linkageState = 'unavailable';
      }
      if (kind === 'contact' && registrationId && permissions.registration) {
        const loaded = await attempt(loadRegistration, [registrationId, actor], value => registrationSource(value, registrationId));
        availability.registration = loaded.state;
        if (loaded.value && loaded.value.sourceContactId === contactId) {
          registration = loaded.value.registration; revisions.registration = loaded.value.revision;
        } else {
          availability.registration = availability.invitations = 'unavailable'; linkageState = 'unavailable';
          registrationId = null; intent = null; revisions.invitations = null;
        }
      }
      if (registrationId && linkageState !== 'unavailable') {
        const loaded = await attempt(loadAdmission, [registrationId, actor], admissionSource);
        availability.admission = loaded.state;
        if (loaded.value) {
          admission = loaded.value; revisions.admission = admission.revision;
          if (registration?.review.status === 'withdrawn' || registration?.review.deletionRequested) admission = { ...admission, status: 'withdrawn' };
        }
        if (permissions.confirmations && registration) {
          const loadedNotices = await attempt(loadConfirmations, [registrationId, actor], confirmationsSource);
          availability.confirmations = loadedNotices.state;
          if (loadedNotices.value) { confirmations = loadedNotices.value; revisions.confirmations = confirmations.revision; }
        }
      } else if (linkageState === 'unavailable') {
        availability.admission = 'unavailable';
        if (permissions.registration && !registration) availability.registration = 'unavailable';
        if (permissions.confirmations) availability.confirmations = 'unavailable';
      }
      let arrangements = { sessions: [], booths: [] }, publicProfile = { state: availability.publicProfile, profiles: [], publishedRevision: null, publishedAt: null };
      if (permissions.arrangements && contact) {
        const loaded = await attempt(loadContent, [actor], contentSource);
        availability.arrangements = loaded.state;
        if (loaded.value) {
          try { content = loaded.value; arrangements = arrangementsProjection(contact, content); revisions.content = content.revision; }
          catch { availability.arrangements = 'unavailable'; content = null; }
          try { publicProfile = publicProfileProjection(contactId, loaded.value); }
          catch { publicProfile.state = 'unavailable'; }
          availability.publicProfile = publicProfile.state;
        }
        else availability.publicProfile = publicProfile.state = 'unavailable';
      } else if (permissions.arrangements && availability.contact === 'unavailable') {
        availability.arrangements = availability.publicProfile = publicProfile.state = 'unavailable';
      }
      let volunteers = { revision: null, entries: [] };
      if (permissions.volunteers) {
        if (linkageState === 'unavailable') availability.volunteers = 'unavailable';
        else {
          const loaded = await attempt(loadVolunteers, [{ actor, contactId: contact?.id ?? null, registrationId: registration?.id ?? null }], volunteersSource);
          availability.volunteers = loaded.state;
          if (loaded.value) {
            volunteers = loaded.value; revisions.volunteers = volunteers.revision;
            availability.volunteers = volunteers.entries.length ? 'available' : 'unlinked';
          }
        }
      }
      const profile = contact?.profile ?? registration?.fields;
      const person = Object.fromEntries(['name', 'displayName', 'organization', 'position', 'city'].map(key => [key, profile?.[key] ?? (key === 'displayName' ? profile?.name ?? '' : '')]));
      let communications;
      try { communications = communicationProjection({ contactRaw, contactId, registrationId, intent, confirmations }); }
      catch { return unavailable(); }
      aborted(request);
      return json({ schemaVersion: 1, selected: { kind, id }, person,
        linkage: { state: linkageState, contactId: permissions.contact ? contactId : null, registrationId },
        permissions, availability, revisions, contact, registration, admission, arrangements, publicProfile, communications, volunteers });
    } catch (failure) {
      if (failure?.status === 401 || failure?.code === 'AUTH_REQUIRED') return error('AUTH_REQUIRED', '会话已结束，请重新登录。', 401);
      return unavailable();
    }
  };
}
