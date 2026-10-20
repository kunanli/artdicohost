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

const credentialFields = ['ALIBABA_CLOUD_ACCESS_KEY_ID', 'ALIBABA_CLOUD_ACCESS_KEY_SECRET', 'ALIBABA_CLOUD_SECURITY_TOKEN'];
const PUBLIC_ALIASES = new Map([
  ['/api/admin/registration/config', '/api/registration/config'],
  ['/api/admin/registration/token', '/api/registration/token'],
  ['/api/admin/registration/submit', '/api/registrations'],
]);
function registrationPolicy(env) {
  try {
    if (!['true', 'false'].includes(env.ARTDICO_REGISTRATION_ENABLED)
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

function withJson(result, value) {
  const body = JSON.stringify(value), headers = new Headers(result.headers);
  headers.set('content-length', String(Buffer.byteLength(body)));
  return new Response(body, { status: result.status, headers });
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
  const contentHandle = createCloudContentApi({ enabled: true, store, portraitStore, auth, contactsStore });
  const importHandle = createIntentContactImportApi({ importer: createIntentContactImporter({ contactsStore, now }), authenticate: request => auth.authenticate(request) });
  let registrationService, reviewStore, intentService, groupService;
  const policy = registrationPolicy(env);
  if (policy) {
    const isWithdrawn = id => reviewStore.isWithdrawn(id);
    groupService = createGroupInviteService({ objects, journalFor, eventId: policy.eventId, tokenSecret: env.ARTDICO_REGISTRATION_TOKEN_SECRET,
      apiOrigin: CLOUD_API_ORIGIN, clock: now, isWithdrawn });
    registrationService = createRegistrationService({ objects, journalFor, policy, capacity: policy.capacity,
      tokenSecret: env.ARTDICO_REGISTRATION_TOKEN_SECRET, allowedOrigins: [PUBLIC_SITE_ORIGIN], clock: now,
      isWithdrawn, groupInviteProvider: input => groupService.forReceipt(input) });
    reviewStore = createRegistrationReviewStore({ journal: journalFor(`cms/v1/registration-reviews/${policy.eventId}`),
      loadRegistrations: () => registrationService.repository.list(), eventId: policy.eventId, clock: now });
    intentService = createIntentInvitationService({ registrationService, contactsStore, contentStore: store,
      repository: createIntentInvitationRepository({ journal: journalFor('cms/v1/intent-invitations') }),
      emailProvider: createInvitationEmailProvider({ env, fetchFn }), now,
      isRegistrationActive: async ({ registrationId }) => !await isWithdrawn(registrationId) });
  }
  const registrationHandle = createRegistrationApi({ allowedOrigins: [PUBLIC_SITE_ORIGIN], submissionService: registrationService, allowedGroupInviteOrigins: [CLOUD_API_ORIGIN], clock: now });
  const groupHandle = createGroupInviteApi({ service: groupService, auth, apiOrigin: CLOUD_API_ORIGIN, publicOrigins: [PUBLIC_SITE_ORIGIN] });
  const reviewHandle = createRegistrationAdminApi({ enabled: Boolean(reviewStore), auth, store: reviewStore });
  const intentHandle = intentService ? createIntentInvitationApi({ service: intentService, authenticate: request => auth.authenticate(request) }) : null;
  const eventId = createInitialContent().eventId;
  const maintenanceHandle = createMaintenanceApi({ enabled: true, auth, objects, clock: now,
    audit: createMaintenanceAuditStore({ journal: journalFor('cms/v1/maintenance'), clock: now }),
    journalPrefixes: ['cms/v1/content', 'cms/v1/contacts', 'cms/v1/intent-invitations', 'cms/v1/maintenance',
      `cms/v1/registrations/${eventId}/index`, `cms/v1/registration-reviews/${eventId}`, `cms/v1/group-invites/${eventId}/state`] });
  const registrationEnabled = Boolean(policy?.enabled);
  const handle = async request => {
    const url = new URL(request.url);
    if (url.origin !== CLOUD_API_ORIGIN || url.username || url.password) return contentHandle(request);
    if (url.pathname === '/api/admin/group-invite' || url.pathname === '/api/admin/group-invite/image'
      || url.pathname.startsWith('/api/registration/group-invite/') || url.pathname.startsWith('/api/admin/registration/group-invite/')) return groupHandle(request);
    const alias = publicRegistrationPath(url.pathname);
    if (alias) return registrationHandle(remap(request, alias));
    if (['/api/registration/config', '/api/registration/token', '/api/registrations'].includes(url.pathname)) return registrationHandle(request);
    if (url.pathname === '/api/admin/users') return userHandle(request);
    if (isIntentContactImportPath(url.pathname)) return importHandle(request);
    if (url.pathname === '/api/admin/maintenance' || url.pathname.startsWith('/api/admin/maintenance/')) return maintenanceHandle(request);
    if (url.pathname === '/api/admin/registrations' || url.pathname.startsWith('/api/admin/registrations/')) return reviewHandle(request);
    if (isIntentInvitationPath(url.pathname) && intentHandle) return intentHandle(request);
    const result = await contentHandle(request);
    if (result.status === 200 && url.pathname === '/api/admin/environment' && request.method === 'GET' && registrationEnabled) {
      return withJson(result, { ...await result.json(), registration: 'enabled' });
    }
    if (result.status === 200 && url.pathname === '/api/admin/planning' && request.method === 'GET') {
      const value = await result.json();
      return withJson(result, { ...value, features: { ...value.features, contactImport: true, protectedContactImport: true, intentInvitations: Boolean(intentService) } });
    }
    return result;
  };
  return { handle, store, contactsStore, userStore, auth, registrationService, reviewStore, intentService, groupService, registrationEnabled };
}
