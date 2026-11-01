import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInitialContent } from '../src/config/content.mjs';
import { validateImportedContact, validateStoredContact, createEmptyContactOperations } from '../shared/contacts-schema.mjs';
import { createGuestAttendancePublicationGuard } from '../functions/people-operations/service.mjs';
import { createFileContentStore, ContentError } from '../functions/content-api/store.mjs';
import { createOssContentStore } from '../functions/cloud-content/store.mjs';
import { createContentApi } from '../functions/content-api/handler.mjs';
import { createCloudContentApi } from '../functions/cloud-content/handler.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { CloudContentError } from '../functions/cloud-content/errors.mjs';
import { hashPassword } from '../functions/content-api/auth.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';

const AT = '2026-11-01T03:00:00.000Z', now = () => Date.parse(AT);
const PRIVATE = 'SYNTHETIC_P1B_PRIVATE_NEVER_PUBLIC', PASSWORD = 'synthetic-p1b-password';
const CSRF = 'synthetic-p1b-csrf', passwordHash = await hashPassword(PASSWORD);
const users = ['publisher', 'editor', 'outreach'].map(role => ({ id: 'synthetic-' + role, username: role, label: '合成同事', roles: [role], passwordHash }));
function contact(id, responseStatus) {
  const { sourceRowId, ...profile } = validateImportedContact({ sourceRowId: id, name: '合成联系人', organization: '合成机构',
    email: 'synthetic.p1b@example.invalid', wechat: PRIVATE, background: PRIVATE, contactConsent: 'consented' }).value;
  const value = { id, profile, source: { key: 'synthetic_p1b', rowId: sourceRowId, digest: 'a'.repeat(64), importedAt: AT },
    operations: { ...createEmptyContactOperations(), responseStatus },
    invitation: { settings: null, generatedAt: null, sentAt: null, sentGenerationAt: null, channel: null }, createdAt: AT, updatedAt: AT };
  assert.equal(validateStoredContact(value), true);
  return value;
}
const guest = (id, contactId, extra = {}) => ({ id, contactId, name: '合成嘉宾 ' + id, company: '合成机构', ggjRole: '', portraitId: '',
  status: 'confirmed', publicConsent: false, internalNotes: PRIVATE, ...extra });

async function fixture(t, kind) {
  const directory = await mkdtemp(join(tmpdir(), 'artdico-p1b-attendance-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const objects = memoryObjects(), journal = createObjectJournal({ objects, prefix: 'cms/v1/content' });
  let portraitHook = () => {}, roster = { revision: 7, contacts: [contact('contact_attending', 'attending'), contact('contact_pending', 'pending'), contact('contact_declined', 'declined'), contact('contact_private', 'attending')] };
  let reads = 0, failRead = false, sourceHook = () => {};
  const unused = async () => { throw new Error('Unexpected synthetic capability'); };
  const portraits = { read: unused, upload: unused, verify: async id => { await portraitHook(); return { id }; } };
  const make = () => kind === 'cloud' ? createOssContentStore({ journal, portraitStore: portraits, now }) : createFileContentStore({ directory, portraitStore: portraits, now });
  const store = make(), contactsStore = { createContact: unused, saveProfile: unused, saveOperations: unused, recordGenerated: unused, recordSent: unused, guestPrefill: unused, read: async () => {
    reads++; if (failRead) throw new Error(PRIVATE);
    const captured = structuredClone(roster); await sourceHook(); return captured;
  } };
  const errorFactory = (...args) => kind === 'cloud' ? new CloudContentError(...args) : new ContentError(...args);
  const preparePublication = createGuestAttendancePublicationGuard({ contactsStore, errorFactory });
  const content = createInitialContent();
  content.guests = [guest('guest_attending', 'contact_attending', { status: 'pending' }), guest('guest_pending', 'contact_pending'),
    guest('guest_declined', 'contact_declined'), guest('guest_unlinked', ''), guest('guest_missing', 'contact_missing'),
    guest('guest_private', 'contact_private', { visibility: 'private' })];
  content.guestAttendance = { schemaVersion: 1, sourceRevision: 9999, confirmedGuestIds: ['guest_declined', 'guest_pending', 'guest_unlinked'] };
  await store.save(0, content, 'synthetic-editor');
  const origin = kind === 'cloud' ? 'https://api.artdico.host' : 'http://127.0.0.1:8799';
  const api = kind === 'cloud' ? createCloudContentApi({ enabled: true, store, portraitStore: portraits, contactsStore,
    auth: { login: async () => {}, logout: async () => {}, authenticate: async request => {
      const user = users.find(user => request.headers.get('cookie') === user.username);
      if (!user) throw new CloudContentError('AUTH_REQUIRED', '请登录。', 401);
      return { user, csrfToken: CSRF };
    } } }) : createContentApi({ store, contactsStore, portraitStore: portraits, users, allowedOrigin: origin, now });
  const request = (path, { method = 'GET', body, session, headers = {} } = {}) => api(new Request(origin + path, { method,
    headers: { Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  async function login(username) {
    if (kind === 'cloud') return { cookie: username, csrfToken: CSRF };
    const response = await request('/api/admin/login', { method: 'POST', body: { username, password: PASSWORD } });
    assert.equal(response.status, 200); return { ...(await response.json()), cookie: response.headers.get('set-cookie').split(';')[0] };
  }
  return { directory, objects, store, make, contactsStore, preparePublication, request, login,
    get reads() { return reads; }, get roster() { return roster; }, setRoster: value => { roster = value; },
    failSource: value => { failRead = value; }, portraitHook: value => { portraitHook = value; }, sourceHook: value => { sourceHook = value; } };
}
async function published(f) { return f.store.publish((await f.store.read()).draft.revision, 'synthetic-publisher', { preparePublication: f.preparePublication }); }
async function saveAgain(f, patch = {}) {
  const { draft } = await f.store.read(); return f.store.save(draft.revision, { ...draft.content, ...patch }, 'synthetic-editor');
}

for (const kind of ['local', 'cloud']) {
  test(kind + ' derives attendance from saved replies and ignores forged draft proof without allocating places', async t => {
    const f = await fixture(t, kind);
    assert.equal(Object.hasOwn((await f.store.read()).draft.content, 'guestAttendance'), false);
    const result = await published(f);
    assert.deepEqual(result.content.guestAttendance, { schemaVersion: 1, sourceRevision: 7, confirmedGuestIds: ['guest_attending'] });
    assert.equal(result.content.guests.find(guest => guest.id === 'guest_attending').status, 'pending', 'profile confirmation remains separate from attendance');
    assert.doesNotMatch(JSON.stringify(result), /contactId|email|wechat|contactConsent|internalNotes|SYNTHETIC_P1B_PRIVATE/u);
    assert.equal(f.reads, 2, 'source is captured and rechecked before committing');
    const before = f.reads;
    assert.deepEqual((await f.make().read()).published, result, 'restart preserves the verified frozen projection');
    assert.equal(f.reads, before, 'stored snapshot reads do not load private contacts');
    assert.equal(f.objects.calls.some(call => /registrations|intent-invitations/u.test(call.key)), false);
  });

  test(kind + ' empty or entirely unlinked profiles produce explicit unknown attendance without private I/O', async t => {
    const f = await fixture(t, kind);
    await saveAgain(f, { guests: [guest('guest_unlinked', ''), guest('guest_private', 'contact_attending', { visibility: 'private' })] });
    f.failSource(true);
    const result = await published(f);
    assert.deepEqual(result.content.guestAttendance, { schemaVersion: 1, sourceRevision: null, confirmedGuestIds: [] });
    assert.equal(f.reads, 0);
  });

  test(kind + ' historical publications remain frozen on reads and need a saved revision for policy upgrade', async t => {
    const f = await fixture(t, kind), legacy = await f.store.publish(1, 'synthetic-publisher');
    assert.equal(Object.hasOwn(legacy.content, 'guestAttendance'), false);
    const before = kind === 'local' ? await readFile(join(f.directory, 'content.json'), 'utf8') : new Map([...f.objects.files].map(([key, value]) => [key, value.data.toString('hex')]));
    assert.deepEqual((await f.make().read()).published, legacy);
    assert.equal(f.reads, 0);
    const after = kind === 'local' ? await readFile(join(f.directory, 'content.json'), 'utf8') : new Map([...f.objects.files].map(([key, value]) => [key, value.data.toString('hex')]));
    assert.deepEqual(after, before);
    await assert.rejects(() => published(f), error => error.code === 'PUBLICATION_SAVE_REQUIRED' && error.status === 409);
    assert.deepEqual((await f.store.read()).published, legacy);
    await saveAgain(f); assert.deepEqual((await published(f)).content.guestAttendance.confirmedGuestIds, ['guest_attending']);
  });

  test(kind + ' source failure and a source change during image validation preserve the previous publication', async t => {
    const f = await fixture(t, kind), old = await published(f);
    const content = (await f.store.read()).draft.content; content.guests[0].portraitId = 'b'.repeat(64) + '.png';
    await saveAgain(f, content);
    f.failSource(true);
    await assert.rejects(() => published(f), error => error.code === 'ATTENDANCE_UNAVAILABLE' && error.status === 503 && !error.message.includes(PRIVATE));
    assert.deepEqual((await f.store.read()).published, old);
    f.failSource(false); let once = true;
    f.portraitHook(() => { if (once) { once = false; f.setRoster({ ...f.roster, revision: f.roster.revision + 1 }); } });
    await assert.rejects(() => published(f), error => error.code === 'ATTENDANCE_SOURCE_CHANGED' && error.status === 409);
    assert.deepEqual((await f.store.read()).published, old);
  });

  test(kind + ' unrelated contact revisions replay frozen proof while changed attendance requires a new content revision', async t => {
    const f = await fixture(t, kind), old = await published(f);
    f.setRoster({ ...f.roster, revision: 8 });
    assert.deepEqual(await published(f), old, 'unrelated source changes do not rewrite or relabel the public version');
    f.setRoster({ revision: 9, contacts: f.roster.contacts.map(contact => contact.id === 'contact_attending' ? { ...contact, operations: { ...contact.operations, responseStatus: 'declined' } } : contact) });
    await assert.rejects(() => published(f), error => error.code === 'PUBLICATION_SAVE_REQUIRED');
    assert.deepEqual((await f.store.read()).published, old);
    await saveAgain(f);
    const next = await published(f); assert.equal(next.revision, old.revision + 1); assert.deepEqual(next.content.guestAttendance.confirmedGuestIds, []);
    assert.equal(next.content.guestAttendance.sourceRevision, 9);
  });

  test(kind + ' attendance API permissions precede private reads and publisher receives only a minimal preview', async t => {
    const f = await fixture(t, kind), editor = await f.login('editor'), publisher = await f.login('publisher'), outreach = await f.login('outreach');
    assert.equal((await f.request('/api/admin/content')).status, 401);
    assert.equal((await f.request('/api/admin/content', { session: outreach })).status, 403);
    assert.equal((await f.request('/api/admin/content/publish', { method: 'POST', session: editor, body: { expectedRevision: 1 } })).status, 403);
    assert.equal(f.reads, 0);
    const response = await f.request('/api/admin/content', { session: publisher }); assert.equal(response.status, 200);
    const value = await response.json(); assert.equal(value.attendancePreview.status, 'ready'); assert.equal(value.attendancePreview.contentRevision, 1);
    assert.deepEqual(value.attendancePreview.guestAttendance.confirmedGuestIds, ['guest_attending']);
    assert.doesNotMatch(JSON.stringify(value.attendancePreview), /contactId|@example|wechat|contactConsent|合成联系人|SYNTHETIC_P1B_PRIVATE/u);
    const count = f.reads;
    assert.equal((await f.request('/api/admin/contacts', { session: publisher })).status, 403); assert.equal(f.reads, count);
    const result = await f.request('/api/admin/content/publish', { method: 'POST', session: publisher,
      body: { expectedRevision: 1, guestAttendance: { schemaVersion: 1, sourceRevision: 999, confirmedGuestIds: ['guest_pending'] } } });
    assert.equal(result.status, 200); assert.deepEqual((await result.json()).published.content.guestAttendance.confirmedGuestIds, ['guest_attending']);
  });

  test(kind + ' unavailable attendance preview keeps draft readable and anonymous GET serves the frozen publication without private reads', async t => {
    const f = await fixture(t, kind), publisher = await f.login('publisher'), old = await published(f);
    f.failSource(true);
    const response = await f.request('/api/admin/content', { session: publisher }); assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).attendancePreview, { status: 'unavailable', contentRevision: 1 });
    const count = f.reads, anonymous = await f.request('/api/public/content'); assert.equal(anonymous.status, 200);
    assert.deepEqual(await anonymous.json(), old); assert.equal(f.reads, count);
    const failed = await f.request('/api/admin/content/publish', { method: 'POST', session: publisher, body: { expectedRevision: 1 } });
    assert.equal(failed.status, 503); assert.equal((await failed.json()).error.code, 'ATTENDANCE_UNAVAILABLE');
    assert.deepEqual((await f.store.read()).published, old);
  });

  test(kind + ' a stale confirmed impact preview cannot publish different attendance', async t => {
    const f = await fixture(t, kind), publisher = await f.login('publisher');
    const preview = await (await f.request('/api/admin/content', { session: publisher })).json();
    f.setRoster({ ...f.roster, revision: 8 });
    const stale = await f.request('/api/admin/content/publish', { method: 'POST', session: publisher,
      body: { expectedRevision: 1, expectedContactsRevision: preview.attendancePreview.guestAttendance.sourceRevision } });
    assert.equal(stale.status, 409); assert.equal((await stale.json()).error.code, 'ATTENDANCE_SOURCE_CHANGED');
    assert.equal((await f.store.read()).published, null);
    const before = f.reads;
    const invalid = await f.request('/api/admin/content/publish', { method: 'POST', session: publisher,
      body: { expectedRevision: 1, expectedContactsRevision: '8' } });
    assert.equal(invalid.status, 400); assert.equal(f.reads, before, 'invalid intent revision is rejected before private reads');
    const fresh = await f.request('/api/admin/content/publish', { method: 'POST', session: publisher,
      body: { expectedRevision: 1, expectedContactsRevision: 8 } });
    assert.equal(fresh.status, 200);
  });

  test(kind + ' older content clients preserve saved participants but explicit empty participants can clear them', async t => {
    const f = await fixture(t, kind), content = (await f.store.read()).draft.content;
    content.sessions[0].participants = [{ guestId: 'guest_attending', roles: ['moderator', 'speaker'] }];
    await saveAgain(f, content);
    const older = (await f.store.read()).draft.content;
    delete older.sessions[0].participants; older.sessions[0].internalNotes = PRIVATE + ' UPDATED';
    await saveAgain(f, older);
    assert.deepEqual((await f.make().read()).draft.content.sessions[0].participants, [{ guestId: 'guest_attending', roles: ['moderator', 'speaker'] }]);
    const clear = (await f.store.read()).draft.content; clear.sessions[0].participants = [];
    await saveAgain(f, clear);
    assert.deepEqual((await f.make().read()).draft.content.sessions[0].participants, []);
  });
}

test('cloud lost publication ACK remains unknown and explicit replay preserves exact attendance evidence without another write', async t => {
  const f = await fixture(t, 'cloud'), original = f.objects.append; let lose = true, writes = 0;
  f.objects.append = async (...args) => { const ack = await original(...args); writes++; if (lose) { lose = false; throw new Error(PRIVATE); } return ack; };
  await assert.rejects(() => published(f), error => error.code === 'STORAGE_ERROR' && error.status === 503);
  const snapshot = (await f.make().read()).published; assert.deepEqual(snapshot.content.guestAttendance.confirmedGuestIds, ['guest_attending']);
  assert.equal(writes, 1); assert.deepEqual(await published(f), snapshot); assert.equal(writes, 1);
});
