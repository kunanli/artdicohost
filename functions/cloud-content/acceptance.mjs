import { createHash, randomBytes } from 'node:crypto';
import { createOssObjectClient } from './oss-client.mjs';
import { createObjectJournal } from './object-journal.mjs';
import { createAcceptanceObjects, ACCEPTANCE_RUN_PATTERN } from './scoped-objects.mjs';
import { createOssContentStore } from './store.mjs';
import { CLOUD_API_ORIGIN, PUBLIC_SITE_ORIGIN } from './handler.mjs';
import { hashPassword } from '../content-api/auth.mjs';
import { createInitialContent } from '../../src/config/content.mjs';
import { createCloudApplication } from './runtime.mjs';
import { inspectEncryptedObjectBackup } from '../registration-admin/maintenance.mjs';

const DEADLINE_MS = 90_000;
const REQUEST_LIMIT = 1000;
const SHA = /^[a-f0-9]{40}$/u;
const STAGES = Object.freeze(['object-readback', 'atomic-conflict', 'login-permissions', 'private-contacts', 'content-portrait', 'lost-ack', 'registration-intake', 'registration-review', 'session-revocation', 'shared-login-budget']);
// Generated solid 2 x 3 pixels; never a real person's photograph.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0KFjAwMDAxMDAgKAAGOQBVgs9CEsAAAAASUVORK5CYII=';
const fail = () => new Error('Cloud acceptance was not verified.');
const requireThat = value => { if (!value) throw fail(); };
const hash = data => createHash('sha256').update(data).digest('hex');
const request = (path, { method = 'GET', headers = {}, body, origin = ['GET', 'HEAD'].includes(method) ? undefined : CLOUD_API_ORIGIN } = {}) => new Request(CLOUD_API_ORIGIN + path, {
  method, headers: { ...(origin === undefined ? {} : { Origin: origin }), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

/** Safe result projection used by the signed process health response only. */
export function acceptanceHealthProof(value) {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || value.schemaVersion !== 1 || !['running', 'passed', 'failed', 'rejected'].includes(value.status)
    || typeof value.runId !== 'string' || !ACCEPTANCE_RUN_PATTERN.test(value.runId)
    || typeof value.sourceCommit !== 'string' || !SHA.test(value.sourceCommit)
    || typeof value.instanceId !== 'string' || !/^[a-f0-9]{32}$/u.test(value.instanceId)
    || !Array.isArray(value.completed) || value.completed.length > STAGES.length || Array.from(value.completed).some((name, index) => name !== STAGES[index])
    || !Number.isSafeInteger(value.requests) || value.requests < 0 || value.requests > REQUEST_LIMIT
    || !Number.isSafeInteger(value.touchedObjects) || value.touchedObjects < 0 || value.touchedObjects > REQUEST_LIMIT
    || value.independentClients !== 2 || value.fcProcesses !== 1 || value.cleanupPerformed !== false
    || value.status === 'passed' && value.completed.length !== STAGES.length) throw fail();
  return Object.freeze({ schemaVersion: 1, status: value.status, runId: value.runId, sourceCommit: value.sourceCommit,
    instanceId: value.instanceId, completed: Object.freeze([...value.completed]), requests: value.requests,
    touchedObjects: value.touchedObjects, independentClients: 2, fcProcesses: 1, cleanupPerformed: false });
}

/** Starts once during production process construction, never from an HTTP request.
 * No account values, credentials, cookies, CSRF tokens, object bodies, provider
 * errors or synthetic secrets are returned. The real content switch stays false.
 */
export function startCloudAcceptance({ env = process.env, sourceCommit, fetchFn = fetch, now = () => Date.now(), deadlineMs = DEADLINE_MS } = {}) {
  const runId = env.ARTDICO_CLOUD_ACCEPTANCE_RUN_ID;
  if (runId === undefined || runId === '') return { snapshot: () => null, completion: Promise.resolve(null) };
  if (typeof runId !== 'string' || !ACCEPTANCE_RUN_PATTERN.test(runId) || typeof sourceCommit !== 'string' || !SHA.test(sourceCommit)) throw fail();
  const instanceId = randomBytes(16).toString('hex'), completed = [], touched = new Set();
  let status = 'running', requests = 0;
  const snapshot = () => acceptanceHealthProof({ schemaVersion: 1, status, runId, sourceCommit, instanceId,
    completed, requests, touchedObjects: touched.size, independentClients: 2, fcProcesses: 1, cleanupPerformed: false });
  const validEnvironment = env.ARTDICO_CLOUD_CONTENT_ENABLED === 'false' && env.NODE_ENV === 'production'
    && env.ARTDICO_CONTENT_API_ORIGIN === CLOUD_API_ORIGIN && env.ARTDICO_PUBLIC_SITE_ORIGIN === PUBLIC_SITE_ORIGIN
    && env.ARTDICO_CONTENT_BUCKET === 'artdicohost-data-hk' && env.ARTDICO_CONTENT_REGION === 'cn-hongkong'
    && ['ALIBABA_CLOUD_ACCESS_KEY_ID', 'ALIBABA_CLOUD_ACCESS_KEY_SECRET', 'ALIBABA_CLOUD_SECURITY_TOKEN'].every(key => typeof env[key] === 'string' && env[key].length)
    && runId.endsWith('-' + sourceCommit) && typeof fetchFn === 'function' && typeof now === 'function'
    && Number.isSafeInteger(deadlineMs) && deadlineMs >= 1 && deadlineMs <= DEADLINE_MS;
  if (!validEnvironment) { status = 'rejected'; return { snapshot, completion: Promise.resolve(snapshot()) }; }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs); timer.unref();
  const safeFetch = async (url, settings) => {
    if (controller.signal.aborted || requests >= REQUEST_LIMIT) throw fail();
    requests++;
    return new Promise((accept, reject) => {
      const abort = () => reject(fail());
      controller.signal.addEventListener('abort', abort, { once: true });
      Promise.resolve().then(() => fetchFn(url, { ...settings, signal: AbortSignal.any([controller.signal, settings.signal]) }))
        .then(value => { controller.signal.removeEventListener('abort', abort); accept(value); }, () => { controller.signal.removeEventListener('abort', abort); reject(fail()); });
    });
  };
  const objects = () => createAcceptanceObjects({ runId, instanceId, onOperation: (_operation, key) => touched.add(key),
    objects: createOssObjectClient({ credentials: async () => ({ accessKeyId: env.ALIBABA_CLOUD_ACCESS_KEY_ID,
      accessKeySecret: env.ALIBABA_CLOUD_ACCESS_KEY_SECRET, securityToken: env.ALIBABA_CLOUD_SECURITY_TOKEN }), fetchFn: safeFetch,
    clock: () => new Date(now()), requestTimeoutMs: 10_000 }) });
  async function stage(name, operation) {
    if (controller.signal.aborted || name !== STAGES[completed.length]) throw fail();
    await operation();
    if (controller.signal.aborted) throw fail();
    completed.push(name);
  }
  const execution = (async () => {
    try {
      const aObjects = objects(), bObjects = objects();
      await stage('object-readback', async () => {
        const bytes = Buffer.from(JSON.stringify({ kind: 'synthetic_acceptance_probe', schemaVersion: 1 }));
        const key = `cms/v1/probes/${hash(bytes)}.json`;
        await aObjects.putImmutable(key, bytes);
        const read = await bObjects.get(key);
        requireThat(read?.objectType === 'Normal' && read.contentType === 'application/json' && hash(read.data) === hash(bytes) && read.data.equals(bytes));
      });
      await stage('atomic-conflict', async () => {
        const a = createObjectJournal({ objects: aObjects, prefix: 'cms/v1/probes/race' });
        const b = createObjectJournal({ objects: bObjects, prefix: 'cms/v1/probes/race' });
        const before = await a.read(); requireThat(before.value === null && before.cursor.version === 0);
        const results = await Promise.allSettled([a.commit(before.cursor, { synthetic: 'left' }), b.commit(before.cursor, { synthetic: 'right' })]);
        requireThat(results.filter(value => value.status === 'fulfilled').length === 1);
        const rejected = results.find(value => value.status === 'rejected');
        requireThat(rejected.reason?.code === 'WRITE_CONFLICT' && rejected.reason?.status === 409);
        const read = await b.read();
        requireThat(read.cursor.version === 1 && ['left', 'right'].includes(read.value.synthetic));
      });
      const password = randomBytes(32).toString('base64url'), passwordHash = await hashPassword(password);
      const users = [{ id: 'synthetic-owner', username: 'synthetic.acceptance', email: 'synthetic.acceptance@artdico.co', label: '合成验收账号', roles: ['editor', 'publisher', 'outreach', 'reviewer', 'superadmin'], passwordHash },
        { id: 'synthetic-editor', username: 'synthetic.editor', label: '合成编辑账号', roles: ['editor'], passwordHash }];
      const at = now(), eventId = createInitialContent().eventId;
      const policy = { enabled: true, eventId, capacity: 3, opensAt: new Date(at - 60_000).toISOString(), closesAt: new Date(at + 3_600_000).toISOString(),
        privacy: { version: 'synthetic-notice-acceptance-v1', processor: '合成验收处理者', contactEmail: 'synthetic@example.invalid', purpose: '隔离合成报名验收',
          storageRegion: '合成私有验收位置', retention: '合成验收保留规则', rightsRequest: '合成权利申请流程', sharing: '合成资料不分享' } };
      const syntheticEnv = { ADMIN_USERS_JSON: JSON.stringify(users), ARTDICO_REGISTRATION_ENABLED: 'true', ARTDICO_REGISTRATION_CAPACITY: '3',
        ARTDICO_REGISTRATION_POLICY_JSON: JSON.stringify(policy), ARTDICO_REGISTRATION_TOKEN_SECRET: randomBytes(48).toString('base64url'), ARTDICO_INVITATION_EMAIL_ENABLED: 'false' };
      const make = target => {
        const application = createCloudApplication({ objects: target, env: syntheticEnv, now });
        return { ...application, api: application.handle };
      };
      const first = make(aObjects), second = make(bObjects);
      async function call(api, path, options, expected) {
        if (controller.signal.aborted) throw fail();
        const result = await api(request(path, options)); requireThat(result.status === expected); return result;
      }
      async function login(api, identifier) {
        const result = await call(api, '/api/admin/login', { method: 'POST', body: { username: identifier, password } }, 200);
        const body = await result.json();
        requireThat(!JSON.stringify(body).includes('scrypt$') && typeof body.csrfToken === 'string');
        return { Cookie: result.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': body.csrfToken };
      }
      let owner, alias, editor, contactId, savedSubmission, registrationId, groupUrl, secondGroupUrl, staffRegistrationId;
      await stage('login-permissions', async () => {
        await call(first.api, '/api/admin/content', {}, 401);
        owner = await login(first.api, users[0].username);
        alias = await login(second.api, users[0].email);
        editor = await login(first.api, users[1].username);
        await call(second.api, '/api/admin/content', { headers: owner }, 200);
        await call(first.api, '/api/admin/content', { headers: alias }, 200);
        await call(second.api, '/api/admin/content/publish', { method: 'POST', headers: editor, body: { expectedRevision: 0 } }, 403);
        await call(first.api, '/api/admin/content/publish', { method: 'POST', headers: { Cookie: owner.Cookie }, body: { expectedRevision: 0 } }, 403);
        await call(first.api, '/api/admin/content', { headers: owner, origin: PUBLIC_SITE_ORIGIN }, 403);
        await call(first.api, '/api/admin/login', { method: 'POST', body: { username: users[0].username, password: 'synthetic-wrong-password' } }, 401);
      });
      await stage('private-contacts', async () => {
        await call(second.api, '/api/admin/contacts', { headers: editor }, 403);
        const saved = await first.contactsStore.createContact(0, { name: '合成验收联络人', organization: '合成机构', email: 'synthetic@example.invalid' }, users[0].id);
        contactId = saved.contact.id;
        const observed = await second.contactsStore.read();
        requireThat(observed.revision === 1 && observed.contacts.length === 1 && observed.contacts[0].id === saved.contact.id);
        const encryptionKey = randomBytes(32);
        try {
          const backup = await call(first.api, '/api/admin/maintenance/backup', { method: 'POST', headers: owner,
            body: { encryptionKey: encryptionKey.toString('base64url'), confirmation: 'CREATE_ENCRYPTED_BACKUP' } }, 200);
          const bundle = Buffer.from(await backup.arrayBuffer());
          requireThat(backup.headers.get('content-type') === 'application/octet-stream' && backup.headers.get('x-backup-sha256') === hash(bundle));
          const inspection = inspectEncryptedObjectBackup({ bundle, key: encryptionKey, includeObjects: true });
          requireThat(inspection.objects.some(value => value.key.startsWith('cms/v1/contacts/'))
            && !inspection.objects.some(value => /^cms\/v1\/(?:users|sessions|limits)\//u.test(value.key)));
          const restoreId = 'synthetic-' + randomBytes(16).toString('hex');
          const restored = await call(second.api, '/api/admin/maintenance/restore', { method: 'POST', headers: alias,
            body: { encryptionKey: encryptionKey.toString('base64url'), bundleBase64: bundle.toString('base64'), restoreId, confirmation: 'RESTORE_TO_ISOLATED_NAMESPACE' } }, 200);
          const recovery = await restored.json();
          requireThat(recovery.restored === true && recovery.active === false && recovery.sessionsRestored === false
            && recovery.namespace === 'cms/v1/restores/' + restoreId && recovery.objectCount === inspection.objectCount);
          const recoveredContacts = await createObjectJournal({ objects: bObjects, prefix: recovery.namespace + '/contacts' }).read();
          requireThat(recoveredContacts.cursor.version === 1 && recoveredContacts.value.revision === 1);
          const maintenance = await call(first.api, '/api/admin/maintenance', { headers: owner }, 200);
          const readiness = await maintenance.json();
          requireThat(readiness.audit.count === 3 && readiness.audit.incompleteRestoreCount === 0 && readiness.audit.lastRestoreAt !== null);
        } finally { encryptionKey.fill(0); }
        await call(first.api, '/api/admin/contacts', {}, 401);
      });
      await stage('content-portrait', async () => {
        const upload = await call(first.api, '/api/admin/portraits', { method: 'POST', headers: owner, body: { contentType: 'image/png', dataBase64: PNG } }, 201);
        const { portrait } = await upload.json(), path = '/api/public/portraits/' + portrait.id;
        await call(second.api, path, { origin: PUBLIC_SITE_ORIGIN }, 404);
        const content = createInitialContent();
        content.event.title = '合成云端验收活动';
        content.guests = [{ id: 'synthetic-guest', name: '合成验收嘉宾', company: '合成机构', ggjRole: '', portraitId: portrait.id, status: 'confirmed', publicConsent: true, internalNotes: 'PRIVATE_SYNTHETIC_ACCEPTANCE_NOTE' }];
        await call(first.api, '/api/admin/content', { method: 'PUT', headers: owner, body: { expectedRevision: 0, content } }, 200);
        await call(second.api, '/api/admin/content/publish', { method: 'POST', headers: alias, body: { expectedRevision: 1 } }, 200);
        const publicResult = await call(first.api, '/api/public/content', { origin: PUBLIC_SITE_ORIGIN }, 200);
        const text = await publicResult.text(); requireThat(text.includes('合成验收嘉宾') && !/PRIVATE_SYNTHETIC|passwordHash|csrfToken|example\.invalid/u.test(text));
        await call(second.api, path, { origin: PUBLIC_SITE_ORIGIN }, 200);
        const left = structuredClone(content), right = structuredClone(content);
        left.event.title = '合成左编辑'; right.event.title = '合成右编辑';
        const outcomes = await Promise.all([first.api(request('/api/admin/content', { method: 'PUT', headers: owner, body: { expectedRevision: 1, content: left } })),
          second.api(request('/api/admin/content', { method: 'PUT', headers: alias, body: { expectedRevision: 1, content: right } }))]);
        requireThat(outcomes.filter(value => value.status === 200).length === 1 && outcomes.filter(value => value.status === 409).length === 1);
        const restarted = make(objects());
        const read = await restarted.store.read(); requireThat(read.draft.revision === 2 && read.published.revision === 1);
        read.draft.content.guests[0].publicConsent = false;
        await call(restarted.api, '/api/admin/content', { method: 'PUT', headers: owner, body: { expectedRevision: 2, content: read.draft.content } }, 200);
        await call(first.api, '/api/admin/content/publish', { method: 'POST', headers: alias, body: { expectedRevision: 3 } }, 200);
        await call(second.api, path, { origin: PUBLIC_SITE_ORIGIN }, 404);
        await call(restarted.api, '/api/admin/portraits/' + portrait.id, { headers: owner }, 200);
      });
      await stage('lost-ack', async () => {
        let appends = 0;
        const lost = { ...aObjects, async append(...args) { appends++; await aObjects.append(...args); throw fail(); } };
        const journal = createObjectJournal({ objects: lost, prefix: 'cms/v1/probes/lost-ack' });
        const store = createOssContentStore({ journal, now });
        let rejected = false;
        try { await store.save(0, createInitialContent(), 'synthetic-owner'); } catch (error) { rejected = error.code === 'STORAGE_ERROR' && error.status === 503; }
        requireThat(rejected && appends === 1);
        const observed = await createOssContentStore({ journal: createObjectJournal({ objects: bObjects, prefix: 'cms/v1/probes/lost-ack' }), now }).read();
        requireThat(observed.draft.revision === 1 && appends === 1);
      });
      await stage('registration-intake', async () => {
        const config = await call(first.api, '/api/admin/registration/config', { origin: PUBLIC_SITE_ORIGIN }, 200);
        const metadata = await config.json();
        requireThat(metadata.enabled === true && metadata.eventId === eventId && metadata.capacity === 3 && metadata.privacy.version === policy.privacy.version
          && config.headers.get('access-control-allow-origin') === PUBLIC_SITE_ORIGIN && config.headers.get('access-control-allow-credentials') === null);
        await call(first.api, '/api/admin/registration/config', { origin: 'https://synthetic-foreign.invalid' }, 403);
        await call(first.api, '/api/admin/group-invite', { method: 'POST', headers: owner,
          body: { expectedRevision: 0, contentType: 'image/png', dataBase64: PNG, expiresAt: new Date(now() + 3_600_000).toISOString() } }, 200);
        const payload = { eventId, fields: { name: '合成公开报名人', city: '合成城市', organization: '合成团队', position: '合成开发者', email: 'synthetic.public@example.invalid',
          categories: ['industry'], participationInterests: ['attend'], background: '隔离验收合成经历', attendance: 'expected', accommodationChoice: 'not_needed', cooperationInterest: 'none' },
        consent: { accepted: true, version: policy.privacy.version } };
        async function prepare(input) {
          const idempotencyKey = randomBytes(32).toString('base64url');
          const issued = await call(first.api, '/api/admin/registration/token', { method: 'POST', origin: PUBLIC_SITE_ORIGIN, body: { eventId, idempotencyKey } }, 200);
          const token = await issued.json();
          return { method: 'POST', origin: PUBLIC_SITE_ORIGIN, headers: { 'Idempotency-Key': idempotencyKey, 'X-Registration-Token': token.submissionToken }, body: input };
        }
        savedSubmission = await prepare(payload);
        const results = await Promise.all([first.api(request('/api/admin/registration/submit', savedSubmission)), second.api(request('/api/admin/registration/submit', savedSubmission))]);
        requireThat(results.filter(value => value.status === 201).length === 1 && results.filter(value => value.status === 200).length === 1);
        const [left, right] = await Promise.all(results.map(value => value.json()));
        requireThat(left.reference_code === right.reference_code && /^[A-Za-z0-9_-]{43}$/u.test(left.reference_code));
        requireThat(left.groupInvite?.qrImageUrl?.startsWith(CLOUD_API_ORIGIN + '/api/admin/registration/group-invite/'));
        registrationId = left.reference_code; groupUrl = new URL(left.groupInvite.qrImageUrl).pathname;
        await call(second.api, groupUrl, { origin: PUBLIC_SITE_ORIGIN }, 200);
        await call(second.api, '/api/admin/registration/submit', { ...savedSubmission, body: { ...payload, fields: { ...payload.fields, name: '合成冲突名字' } } }, 409);
        const secondInput = await prepare({ ...payload, fields: { ...payload.fields, name: '合成第二位报名人' } });
        const secondResult = await call(second.api, '/api/admin/registration/submit', secondInput, 201);
        secondGroupUrl = new URL((await secondResult.json()).groupInvite.qrImageUrl).pathname;
        const conversion = await call(first.api, '/api/admin/contacts/convert', { method: 'POST', headers: owner, body: { contactIds: [contactId], expectedContactRevision: 1 } }, 200);
        const converted = await conversion.json();
        requireThat(converted.status === 'completed' && converted.registrations.length === 1 && converted.failures.length === 0);
        staffRegistrationId = converted.registrations[0].registrationId;
        const repeated = await call(second.api, '/api/admin/contacts/convert', { method: 'POST', headers: alias, body: { contactIds: [contactId], expectedContactRevision: 1 } }, 200);
        requireThat((await repeated.json()).registrations[0].registrationId === staffRegistrationId);
        const fourthKey = randomBytes(32).toString('base64url');
        await call(first.api, '/api/admin/registration/token', { method: 'POST', origin: PUBLIC_SITE_ORIGIN, body: { eventId, idempotencyKey: fourthKey } }, 409);
        const durable = await second.registrationService.repository.list();
        requireThat(durable.registrations.length === 3 && durable.revision === 3);
        const staff = durable.registrations.find(value => value.id === staffRegistrationId);
        requireThat(staff.provenance.kind === 'staff_assisted' && staff.provenance.sourceContactId === contactId
          && staff.consent.accepted === false && staff.consent.acceptedAt === null && staff.consent.version === null);
      });
      await stage('registration-review', async () => {
        await call(first.api, '/api/admin/registrations', { headers: editor }, 403);
        const listing = await call(second.api, '/api/admin/registrations', { headers: owner }, 200);
        const listed = await listing.json();
        requireThat(listed.total === 3 && listed.overallTotal === 3 && !JSON.stringify(listed.registrations).includes('synthetic.public@example.invalid'));
        const detail = await call(first.api, '/api/admin/registrations/' + registrationId, { headers: owner }, 200);
        const item = await detail.json(), review = { ...item.review, status: 'in_review' }; delete review.deletionRequested;
        await call(second.api, '/api/admin/registrations/' + registrationId + '/review', { method: 'PATCH', headers: { Cookie: owner.Cookie }, body: { expectedRevision: 0, review } }, 403);
        await call(second.api, '/api/admin/registrations/' + registrationId + '/review', { method: 'PATCH', headers: owner, body: { expectedRevision: 0, review } }, 200);
        const exported = await call(first.api, '/api/admin/registrations/export', { method: 'POST', headers: alias, body: { expectedRevision: 1, includeContact: false } }, 200);
        requireThat(exported.headers.get('x-review-revision') === '2' && !(await exported.text()).includes('example.invalid'));
        await call(second.api, '/api/admin/registrations/' + registrationId + '/review', { method: 'PATCH', headers: owner, body: { expectedRevision: 2, review: { ...review, status: 'withdrawn' } } }, 200);
        await call(first.api, '/api/admin/registration/submit', savedSubmission, 410);
        await call(second.api, groupUrl, { origin: PUBLIC_SITE_ORIGIN }, 404);
        const deletion = await call(first.api, '/api/admin/registrations/' + staffRegistrationId + '/deletion-request', { method: 'POST', headers: owner, body: { expectedRevision: 3, reason: 'request' } }, 200);
        const deleted = await deletion.json(); requireThat(deleted.erased === false && deleted.maintenanceRequired === true);
        const directory = await call(second.api, '/api/admin/users', { headers: owner }, 200);
        requireThat(!(await directory.text()).includes('passwordHash'));
        const created = await call(first.api, '/api/admin/users', { method: 'POST', headers: owner, body: { expectedRevision: 0, username: 'synthetic.additional', label: '合成附加账号', roles: ['editor'], password } }, 200);
        const createdUser = (await created.json()).users.find(value => !value.protected);
        requireThat(createdUser?.active === true);
        const additional = await login(second.api, 'synthetic.additional');
        await call(first.api, '/api/admin/users', { method: 'POST', headers: owner, body: { expectedRevision: 1, id: createdUser.id, active: false } }, 200);
        await call(second.api, '/api/admin/content', { headers: additional }, 401);
        await call(first.api, '/api/admin/users', { method: 'POST', headers: owner, body: { expectedRevision: 2, id: users[0].id, active: false } }, 422);
        await call(first.api, secondGroupUrl, { origin: PUBLIC_SITE_ORIGIN }, 200);
        await call(second.api, '/api/admin/group-invite', { method: 'PUT', headers: alias, body: { expectedRevision: 1, enabled: false } }, 200);
        await call(first.api, secondGroupUrl, { origin: PUBLIC_SITE_ORIGIN }, 404);
      });
      await stage('session-revocation', async () => {
        await call(second.api, '/api/admin/logout', { method: 'POST', headers: owner, body: {} }, 200);
        await call(first.api, '/api/admin/content', { headers: owner }, 401);
        await call(first.api, '/api/admin/logout', { method: 'POST', headers: alias, body: {} }, 200);
        await call(second.api, '/api/admin/content', { headers: alias }, 401);
        await call(first.api, '/api/admin/logout', { method: 'POST', headers: editor, body: {} }, 200);
      });
      await stage('shared-login-budget', async () => {
        let limited = false;
        for (let attempt = 0; attempt < 12; attempt++) {
          const result = await first.api(request('/api/admin/login', { method: 'POST', body: { username: 'synthetic-unknown', password: 'synthetic-wrong-password' } }));
          if (result.status === 429) { requireThat(/^[1-9][0-9]*$/u.test(result.headers.get('retry-after') ?? '')); limited = true; break; }
          requireThat(result.status === 401);
        }
        requireThat(limited);
        await call(second.api, '/api/admin/login', { method: 'POST', body: { username: users[0].email, password } }, 429);
      });
      status = 'passed';
    } catch { status = 'failed'; }
    finally { clearTimeout(timer); controller.abort(); }
    return snapshot();
  })();
  // Bound the observable result too, including a non-conforming transport whose
  // response stream ignores abort. No later operation may promote an aborted
  // run: each stage checks the controller before recording completion.
  const stopped = new Promise(resolve => controller.signal.addEventListener('abort', () => {
    if (status === 'running') status = 'failed';
    resolve(snapshot());
  }, { once: true }));
  const completion = Promise.race([execution, stopped]);
  return { snapshot, completion };
}
