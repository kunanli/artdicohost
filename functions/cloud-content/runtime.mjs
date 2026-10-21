import { createHash } from 'node:crypto';
import { createOssObjectClient } from './oss-client.mjs';
import { createObjectJournal } from './object-journal.mjs';
import { createCloudAuth } from './auth.mjs';
import { createOssContentStore } from './store.mjs';
import { createOssPortraitStore } from './portrait-store.mjs';
import { createOssContactsStore } from './contacts-store.mjs';
import { createCloudContentApi, CLOUD_API_ORIGIN, PUBLIC_SITE_ORIGIN } from './handler.mjs';
import { createRegistrationService } from '../registration-api/service.mjs';
import { createRegistrationApi } from '../registration-api/handler.mjs';
import { validateRegistrationPolicy, parseTimestamp } from '../registration-api/policy.mjs';
import { createRegistrationReviewStore } from '../registration-admin/store.mjs';
import { createRegistrationAdminApi } from '../registration-admin/handler.mjs';
import { createInitialContent } from '../../src/config/content.mjs';
import { createCloudUserStore } from './user-store.mjs';
import { createCloudUserApi } from './user-handler.mjs';
import { createIntentInvitationRepository } from '../intent-invitations/repository.mjs';
import { createIntentInvitationService } from '../intent-invitations/service.mjs';
import { createIntentInvitationApi, isIntentInvitationPath } from '../intent-invitations/handler.mjs';
import { createInvitationEmailProvider } from '../intent-invitations/email-provider.mjs';
import { createGroupInviteService } from '../registration-api/group-invite.mjs';
import { createGroupInviteApi } from '../registration-api/group-invite-handler.mjs';
import { createMaintenanceApi, createMaintenanceAuditStore } from '../registration-admin/maintenance-handler.mjs';
import { createIntentContactImporter } from '../intent-invitations/importer.mjs';
import { createIntentContactImportApi, isIntentContactImportPath } from '../intent-invitations/import-handler.mjs';
import { createAdmissionsApi } from '../registration-admin/admissions-handler.mjs';
import { createOrganizerTasksApi } from '../organizer-tasks/handler.mjs';
import { createContactAdmissionGuard } from './contact-admission-guard.mjs';
import { createRegistrationConfirmationService } from '../registration-confirmation/service.mjs';
import { createRegistrationConfirmationApi } from '../registration-confirmation/handler.mjs';
import { createConfirmationEmailProvider } from '../registration-confirmation/email-provider.mjs';
import { loadEncryptedConfirmationMail, confirmationMailObjectKey } from '../registration-confirmation/config-bundle.mjs';
import { createAppleWalletService } from '../apple-wallet/service.mjs';
import { createAppleWalletApi, isAppleWalletPath } from '../apple-wallet/handler.mjs';
import { loadEncryptedSigningBundle, walletSigningObjectKey } from '../apple-wallet/bundle.mjs';
import { createRegistrationXlsxApi, createContactsXlsxApi } from '../registration-admin/xlsx-handler.mjs';
import { createPersonWorkspaceApi } from '../person-workspace/handler.mjs';
import { createVolunteerRepository } from '../volunteers/repository.mjs';
import { createVolunteerService } from '../volunteers/service.mjs';
import { createVolunteersApi, isVolunteersPath } from '../volunteers/handler.mjs';

const credentialFields = ['ALIBABA_CLOUD_ACCESS_KEY_ID', 'ALIBABA_CLOUD_ACCESS_KEY_SECRET', 'ALIBABA_CLOUD_SECURITY_TOKEN'];
const PUBLIC_ALIASES = new Map([
  ['/api/admin/registration/config', '/api/registration/config'],
  ['/api/admin/registration/token', '/api/registration/token'],
  ['/api/admin/registration/submit', '/api/registrations'],
]);
function registrationPolicy(env) {
  try {
    if (!['true', 'false'].includes(env.ARTDICO_REGISTRATION_ENABLED)
      || env.ARTDICO_REGISTRATION_WAITLIST_ENABLED !== undefined && !['true', 'false'].includes(env.ARTDICO_REGISTRATION_WAITLIST_ENABLED)
      || typeof env.ARTDICO_REGISTRATION_POLICY_JSON !== 'string' || Buffer.byteLength(env.ARTDICO_REGISTRATION_POLICY_JSON) > 16 * 1024
      || typeof env.ARTDICO_REGISTRATION_CAPACITY !== 'string' || !/^[1-9][0-9]{0,3}$/u.test(env.ARTDICO_REGISTRATION_CAPACITY)
      || typeof env.ARTDICO_REGISTRATION_TOKEN_SECRET !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/u.test(env.ARTDICO_REGISTRATION_TOKEN_SECRET)) return null;
    const policy = JSON.parse(env.ARTDICO_REGISTRATION_POLICY_JSON), capacity = Number(env.ARTDICO_REGISTRATION_CAPACITY);
    if (capacity > 1000 || policy?.capacity !== capacity || policy.enabled !== (env.ARTDICO_REGISTRATION_ENABLED === 'true')
      || policy.eventId !== createInitialContent().eventId) return null;
    // Validate complete notice/window syntax at its own opening instant without
    // inventing dates or requiring a currently open registration window.
    const checked = validateRegistrationPolicy({ ...policy, enabled: true }, { now: parseTimestamp(policy.opensAt) });
    return checked.valid ? { ...checked.value, enabled: policy.enabled, capacity } : null;
  } catch { return null; }
}

function publicRegistrationPath(path) {
  return PUBLIC_ALIASES.get(path) ?? null;
}

function remap(request, path) {
  const url = new URL(request.url); url.pathname = path;
  return new Request(url, request);
}

function withJson(result, value, status = result.status) {
  const body = JSON.stringify(value), headers = new Headers(result.headers);
  headers.set('content-length', String(Buffer.byteLength(body)));
  return new Response(body, { status, headers });
}

/** Construct only from server-side configuration and FC's platform role environment.
 * No deployment key aliases, request headers, implicit account or public write defaults.
 * `configured` describes configuration, never successful cloud persistence.
 */
export function createCloudContentRuntime({ env = process.env, fetchFn, now = () => Date.now(), clock = () => new Date(now()) } = {}) {
  const unavailable = () => ({ handle: createCloudContentApi({ enabled: false }), configured: false, storageVerified: false, registrationEnabled: false });
  if (env.ARTDICO_CLOUD_CONTENT_ENABLED !== 'true') return unavailable();
  if (env.NODE_ENV !== 'production' || env.ARTDICO_CONTENT_API_ORIGIN !== CLOUD_API_ORIGIN
    || env.ARTDICO_PUBLIC_SITE_ORIGIN !== PUBLIC_SITE_ORIGIN || env.ARTDICO_CONTENT_BUCKET !== 'artdicohost-data-hk'
    || env.ARTDICO_CONTENT_REGION !== 'cn-hongkong' || typeof env.ADMIN_USERS_JSON !== 'string'
    || !credentialFields.every(key => typeof env[key] === 'string' && env[key].length > 0)) return unavailable();
  try {
    const objects = createOssObjectClient({ credentials: async () => ({
      accessKeyId: env.ALIBABA_CLOUD_ACCESS_KEY_ID,
      accessKeySecret: env.ALIBABA_CLOUD_ACCESS_KEY_SECRET,
      securityToken: env.ALIBABA_CLOUD_SECURITY_TOKEN,
    }), fetchFn, clock });
    const application = createCloudApplication({ objects, env, fetchFn, now });
    return { handle: application.handle, configured: true, storageVerified: false, registrationEnabled: application.registrationEnabled };
  } catch { return unavailable(); }
}


/** Trusted server-only composition. Objects are supplied by the platform runtime
 * or the private acceptance scope; no HTTP value selects an object store.
 * The production facade returns only handle/readiness, never these components.
 */
export function createCloudApplication({ objects, env, fetchFn, now = () => Date.now() } = {}) {
  const portraitStore = createOssPortraitStore({ objects });
  const journalFor = prefix => createObjectJournal({ objects, prefix });
  const store = createOssContentStore({ journal: journalFor('cms/v1/content'), portraitStore, now });
  const contactsStore = createOssContactsStore({ journal: journalFor('cms/v1/contacts'), contentStore: store, now });
  const userStore = createCloudUserStore({ journal: journalFor('cms/v1/users'), bootstrapUsers: env.ADMIN_USERS_JSON, now });
  const auth = createCloudAuth({ users: env.ADMIN_USERS_JSON, usersProvider: () => userStore.users(), journalFor, now });
  const userHandle = createCloudUserApi({ enabled: true, auth, store: userStore });
  let registrationService, reviewStore, intentService, groupService, confirmationService, walletService;
  // Notification is optional after a proven admission commit. Unknown mail
  // acknowledgements remain in the outbox; remaining people require explicit
  // administrator dispatch and must never turn a saved mutation into a failure.
  const notifyPromoted = async (registrationIds, timeoutMs = 5000) => {
    if (!Array.isArray(registrationIds) || !registrationIds.length) return undefined;
    let result;
    try { result = await confirmationService?.notifyPromoted({ registrationIds: registrationIds.slice(0, 100), timeoutMs }); } catch { /* Saved admissions remain authoritative. */ }
    const attemptedCount = Array.isArray(result?.results) ? result.results.filter(item => !['not_attempted', 'unavailable'].includes(item.status)).length : 0;
    const pendingCount = Math.max(0, registrationIds.length - attemptedCount);
    const uncertain = result?.results?.some(item => ['unknown', 'unavailable'].includes(item.status));
    return { status: result?.status === 'not_configured' ? 'not_configured' : uncertain || pendingCount ? 'pending' : 'completed', attemptedCount, pendingCount };
  };
  const beforeContactMutation = createContactAdmissionGuard({ contactsStore,
    lookupRegistration: async ({ contactId, actor }) => {
      if (!intentService) throw new Error('Registration linkage is unavailable.');
      const intent = await intentService.read({ actor });
      return intent.conversions.find(value => value.sourceContactId === contactId)?.registrationId ?? null;
    }, getAdmissionStatus: id => {
      if (!registrationService) throw new Error('Admission state is unavailable.');
      return registrationService.getAdmissionStatus(id);
    } });
  const contentHandle = createCloudContentApi({ enabled: true, store, portraitStore, auth, contactsStore, beforeContactMutation });
  const importHandle = createIntentContactImportApi({ importer: createIntentContactImporter({ contactsStore, now }), authenticate: request => auth.authenticate(request) });
  const policy = registrationPolicy(env);
  if (policy) {
    const isWithdrawn = id => reviewStore.isWithdrawn(id);
    groupService = createGroupInviteService({ objects, journalFor, eventId: policy.eventId, tokenSecret: env.ARTDICO_REGISTRATION_TOKEN_SECRET,
      apiOrigin: CLOUD_API_ORIGIN, clock: now, isWithdrawn: async id => {
        // getAdmissionStatus verifies the immutable record and the review guard.
        // The registration service itself receives only the review-only hook.
        const admission = await registrationService.getAdmissionStatus(id);
        if (!['confirmed', 'waitlisted', 'withdrawn'].includes(admission?.status)) throw new Error('Admission state is unavailable.');
        return admission.status !== 'confirmed';
      } });
    registrationService = createRegistrationService({ objects, journalFor, policy, capacity: policy.capacity,
      tokenSecret: env.ARTDICO_REGISTRATION_TOKEN_SECRET, allowedOrigins: [PUBLIC_SITE_ORIGIN], clock: now,
      isWithdrawn, getWithdrawnIds: () => reviewStore.inactiveRegistrationIds(),
      waitlistEnabled: env.ARTDICO_REGISTRATION_WAITLIST_ENABLED === 'true', staffReserve: 0,
      onSaved: async ({ receipt, promotedIds }) => {
        const started = performance.now();
        const confirmation = await confirmationService.forSavedReceipt({ receipt, notify: true });
        const remaining = Math.floor(5000 - (performance.now() - started));
        if (remaining > 0) await notifyPromoted(promotedIds, remaining);
        return confirmation;
      },
      groupInviteProvider: input => groupService.forReceipt(input) });
    reviewStore = createRegistrationReviewStore({ journal: journalFor(`cms/v1/registration-reviews/${policy.eventId}`),
      loadRegistrations: () => registrationService.repository.list(), eventId: policy.eventId, clock: now });
    intentService = createIntentInvitationService({ registrationService, contactsStore, contentStore: store,
      repository: createIntentInvitationRepository({ journal: journalFor('cms/v1/intent-invitations') }),
      emailProvider: createInvitationEmailProvider({ env, fetchFn }), now,
      isRegistrationActive: async ({ registrationId }) => !await isWithdrawn(registrationId),
      getAdmissionStatus: id => registrationService.getAdmissionStatus(id) });
    walletService = createAppleWalletService({ env, tokenSecret: env.ARTDICO_REGISTRATION_TOKEN_SECRET, clock: now,
      authorize: input => confirmationService.authorize(input),
      authorizedRegistration: id => confirmationService.authorizedRegistration(id),
      loadSigningBundle: ({ bundleId }) => loadEncryptedSigningBundle({ objects, secret: env.ARTDICO_REGISTRATION_TOKEN_SECRET, eventId: policy.eventId, bundleId }) });
    confirmationService = createRegistrationConfirmationService({ registrationService, journalFor,
      tokenSecret: env.ARTDICO_REGISTRATION_TOKEN_SECRET, clock: now, batchTimeoutMs: 5000,
      emailProvider: createConfirmationEmailProvider({ env, fetchFn, timeoutMs: 4000,
        ...(env.ARTDICO_CONFIRMATION_EMAIL_BUNDLE_ID ? { loadConfiguration: () => loadEncryptedConfirmationMail({ objects,
          secret: env.ARTDICO_REGISTRATION_TOKEN_SECRET, eventId: policy.eventId, bundleId: env.ARTDICO_CONFIRMATION_EMAIL_BUNDLE_ID }) } : {}) }),
      walletReadiness: () => walletService.readiness(), groupInviteProvider: input => groupService.forReceipt(input) });
  }
  const registrationHandle = createRegistrationApi({ allowedOrigins: [PUBLIC_SITE_ORIGIN], submissionService: registrationService, allowedGroupInviteOrigins: [CLOUD_API_ORIGIN], clock: now });
  const confirmationHandle = createRegistrationConfirmationApi({ service: confirmationService, auth, apiOrigin: CLOUD_API_ORIGIN, publicOrigins: [PUBLIC_SITE_ORIGIN] });
  const walletHandle = createAppleWalletApi({ service: walletService ?? { download: async () => ({ outcome: 'not_ready' }), verify: async () => ({ valid: false }) }, apiOrigin: CLOUD_API_ORIGIN, publicOrigins: [PUBLIC_SITE_ORIGIN] });
  const registrationXlsxHandle = createRegistrationXlsxApi({ enabled: Boolean(reviewStore), auth, store: reviewStore,
    loadAdmissions: () => registrationService.repository.getAdmissions(), loadArrangements: async actor => {
      const [roster, { draft }, intent] = await Promise.all([contactsStore.read(), store.read(), intentService.read({ actor })]);
      return { contactRevision: roster.revision, contentRevision: draft.revision, contacts: roster.contacts, content: draft.content, conversions: intent.conversions };
    } });
  const contactsXlsxHandle = createContactsXlsxApi({ enabled: true, auth, contactsStore, clock: now, loadContent: async () => (await store.read()).draft });
  const groupHandle = createGroupInviteApi({ service: groupService, auth, apiOrigin: CLOUD_API_ORIGIN, publicOrigins: [PUBLIC_SITE_ORIGIN] });
  const reviewHandle = createRegistrationAdminApi({ enabled: Boolean(reviewStore), auth, store: reviewStore,
    onWithdrawalCommitted: registrationService ? async ({ registrationId, reviewRevision, actor }) => {
      const current = await registrationService.getAdmissions({ actor });
      if (!Number.isSafeInteger(current.revision)) return { status: 'pending' };
      const operationId = createHash('sha256').update('review-withdraw\0' + registrationId + '\0' + reviewRevision).digest('hex');
      const saved = await registrationService.withdrawAdmission({ actor, registrationId, expectedRevision: current.revision, operationId });
      if (!['updated', 'replayed'].includes(saved.outcome) || !Array.isArray(saved.promotedIds)) return { status: 'pending' };
      return { status: 'released', promotedCount: saved.promotedIds.length, promotionEmail: await notifyPromoted(saved.promotedIds) };
    } : undefined });
  const admissionsHandle = createAdmissionsApi({ enabled: Boolean(registrationService), auth, service: registrationService,
    onCommitted: async ({ result }) => notifyPromoted(result.promotedIds) });
  const eventId = createInitialContent().eventId;
  const volunteerRepository = createVolunteerRepository({ journal: journalFor(`cms/v1/volunteers/${eventId}`), eventId, clock: now });
  const volunteerService = createVolunteerService({ repository: volunteerRepository, clock: now,
    getSources: async actor => {
      if (!registrationService || !reviewStore || !intentService) throw new Error('Volunteer sources are unavailable.');
      const [contacts, intent, registrations, admissions, { draft }, inactiveRegistrationIds] = await Promise.all([
        contactsStore.read(), intentService.read({ actor }), registrationService.repository.list(),
        registrationService.getAdmissions({ actor }), store.read(), reviewStore.inactiveRegistrationIds(),
      ]);
      return { contacts, intent: { revision: intent.revision, conversions: intent.conversions }, registrations, admissions,
        content: draft, inactiveRegistrationIds };
    } });
  const volunteerHandle = createVolunteersApi({ authenticate: request => auth.authenticate(request), service: volunteerService });
  const tasksHandle = createOrganizerTasksApi({ authenticate: request => auth.authenticate(request), now,
    getSources: async actor => {
      const [roster, { draft }, intent, admissions, withdrawnIds] = await Promise.all([
        contactsStore.read(), store.read(), intentService ? intentService.read({ actor }) : null,
        registrationService ? registrationService.getAdmissions({ actor }) : null,
        reviewStore ? reviewStore.inactiveRegistrationIds() : [],
      ]);
      if (admissions && !Array.isArray(admissions.people)) throw new Error('Admission state is unavailable.');
      return { contacts: roster.contacts, contactRevision: roster.revision, intent, content: draft.content, contentRevision: draft.revision,
        inactiveRegistrationIds: withdrawnIds,
        admissionStatuses: (admissions?.people ?? []).map(({ registrationId, status }) => ({ registrationId, status })) };
    } });
  const personHandle = createPersonWorkspaceApi({ authenticate: request => auth.authenticate(request),
    loadContacts: () => contactsStore.read(),
    loadIntent: intentService ? actor => intentService.read({ actor }) : undefined,
    loadRegistration: reviewStore ? id => reviewStore.detail(id) : undefined,
    loadAdmission: registrationService ? id => registrationService.getAdmissionStatus(id) : undefined,
    loadContent: async () => { const snapshot = await store.read(); return { ...snapshot.draft, published: snapshot.published }; },
    loadVolunteers: input => volunteerService.readPerson(input),
    loadConfirmations: confirmationService ? (id, actor) => confirmationService.staffHistory({ actor, registrationId: id }) : undefined });
  const intentHandle = intentService ? createIntentInvitationApi({ service: intentService, authenticate: request => auth.authenticate(request) }) : null;
  const configurationKeys = [];
  for (const [name, keyFor] of [['APPLE_WALLET_BUNDLE_ID', walletSigningObjectKey], ['ARTDICO_CONFIRMATION_EMAIL_BUNDLE_ID', confirmationMailObjectKey]]) {
    if (typeof env[name] === 'string' && /^[a-f0-9]{64}$/u.test(env[name])) configurationKeys.push(keyFor({ eventId, bundleId: env[name] }));
  }
  const maintenanceHandle = createMaintenanceApi({ enabled: true, auth, objects, clock: now,
    additionalKeys: configurationKeys,
    audit: createMaintenanceAuditStore({ journal: journalFor('cms/v1/maintenance'), clock: now }),
    journalPrefixes: ['cms/v1/content', 'cms/v1/contacts', 'cms/v1/intent-invitations', 'cms/v1/maintenance',
      `cms/v1/registrations/${eventId}/index`, `cms/v1/registration-reviews/${eventId}`, `cms/v1/registration-confirmations/${eventId}`,
      `cms/v1/volunteers/${eventId}`, `cms/v1/group-invites/${eventId}/state`] });
  const registrationEnabled = Boolean(policy?.enabled);
  const handle = async request => {
    const url = new URL(request.url);
    if (url.origin !== CLOUD_API_ORIGIN || url.username || url.password) return contentHandle(request);
    if (['/api/registration/confirmation', '/api/admin/registration/confirmation', '/api/admin/registration-confirmation/settings', '/api/admin/registration-confirmation/dispatch'].includes(url.pathname)) return confirmationHandle(request);
    if (isAppleWalletPath(url.pathname)) return walletHandle(request);
    if (url.pathname === '/api/admin/registrations/export.xlsx') return registrationXlsxHandle(request);
    if (url.pathname === '/api/admin/contacts/export.xlsx') return contactsXlsxHandle(request);
    if (url.pathname === '/api/admin/group-invite' || url.pathname === '/api/admin/group-invite/image'
      || url.pathname.startsWith('/api/registration/group-invite/') || url.pathname.startsWith('/api/admin/registration/group-invite/')) return groupHandle(request);
    const alias = publicRegistrationPath(url.pathname);
    if (alias) return registrationHandle(remap(request, alias));
    if (['/api/registration/config', '/api/registration/token', '/api/registrations'].includes(url.pathname)) return registrationHandle(request);
    if (url.pathname === '/api/admin/users') return userHandle(request);
    if (isVolunteersPath(url.pathname)) return volunteerHandle(request);
    if (url.pathname === '/api/admin/people' || url.pathname.startsWith('/api/admin/people/')) return personHandle(request);
    if (url.pathname === '/api/admin/tasks') return tasksHandle(request);
    if (url.pathname === '/api/admin/admissions' || url.pathname.startsWith('/api/admin/admissions/')) return admissionsHandle(request);
    if (isIntentContactImportPath(url.pathname)) return importHandle(request);
    if (url.pathname === '/api/admin/maintenance' || url.pathname.startsWith('/api/admin/maintenance/')) return maintenanceHandle(request);
    if (url.pathname === '/api/admin/registrations' || url.pathname.startsWith('/api/admin/registrations/')) return reviewHandle(request);
    if (isIntentInvitationPath(url.pathname) && intentHandle) {
      const result = await intentHandle(request);
      if (result.status !== 200 || request.method !== 'GET' || url.pathname !== '/api/admin/intent-invitations') return result;
      try {
        // This response was already authorized for outreach. Add only each
        // existing conversion's status, never the private admission roster/counts.
        const [admissions, inactiveIds] = await Promise.all([registrationService.repository.getAdmissions(), reviewStore.inactiveRegistrationIds()]);
        const states = new Map(admissions.people.map(value => [value.registrationId, value.status])), inactive = new Set(inactiveIds);
        const value = await result.json();
        return withJson(result, { ...value, conversions: value.conversions.map(conversion => ({ ...conversion,
          admissionStatus: inactive.has(conversion.registrationId) ? 'withdrawn' : states.get(conversion.registrationId) ?? 'unknown' })) });
      } catch { return withJson(result, { error: { code: 'ADMISSION_STATUS_UNAVAILABLE', message: '人员名额状态暂时无法核对，请稍后刷新。' } }, 503); }
    }
    const result = await contentHandle(request);
    if (result.status === 200 && url.pathname === '/api/admin/environment' && request.method === 'GET' && registrationEnabled) {
      return withJson(result, { ...await result.json(), registration: 'enabled' });
    }
    if (result.status === 200 && url.pathname === '/api/admin/planning' && request.method === 'GET') {
      const value = await result.json();
      return withJson(result, { ...value, features: { ...value.features, contactImport: true, protectedContactImport: true, intentInvitations: Boolean(intentService), batchInvitations: Boolean(intentService),
        contactXlsxExport: true, registrationXlsxExport: Boolean(reviewStore), registrationConfirmation: Boolean(confirmationService), appleWallet: Boolean(walletService) } });
    }
    return result;
  };
  return { handle, store, contactsStore, userStore, auth, registrationService, reviewStore, intentService, groupService, confirmationService, walletService,
    volunteerRepository, volunteerService, registrationEnabled };
}
