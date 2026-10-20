import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword } from '../functions/content-api/auth.mjs';
import { createContentApi } from '../functions/content-api/handler.mjs';
import { createFileContentStore } from '../functions/content-api/store.mjs';
import { createFileContactsStore } from '../functions/content-api/contacts-store.mjs';
import { createCloudContentApi, CLOUD_API_ORIGIN } from '../functions/cloud-content/handler.mjs';
import { createCloudAuth } from '../functions/cloud-content/auth.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { createOssContentStore } from '../functions/cloud-content/store.mjs';
import { createOssContactsStore } from '../functions/cloud-content/contacts-store.mjs';
import { createOssPortraitStore } from '../functions/cloud-content/portrait-store.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';

const PASSWORD = 'synthetic-arrangement-password-only';
const passwordHash = await hashPassword(PASSWORD);
const users = [
  { id: 'both', username: 'both', roles: ['editor', 'outreach'] },
  { id: 'editor', username: 'editor', roles: ['editor'] },
  { id: 'outreach', username: 'outreach', roles: ['outreach'] },
  { id: 'publisher', username: 'publisher', roles: ['publisher'] },
].map(user => ({ ...user, label: '合成工作人员', passwordHash }));

for (const mode of ['local', 'cloud']) {
  test(`${mode} saved arrangement overview needs both roles and exposes only operational fields`, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'artdico-arrangement-synthetic-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const origin = mode === 'cloud' ? CLOUD_API_ORIGIN : 'http://127.0.0.1:8787';
    const objects = memoryObjects();
    const journalFor = prefix => createObjectJournal({ objects, prefix });
    const portraitStore = createOssPortraitStore({ objects });
    const store = mode === 'cloud' ? createOssContentStore({ journal: journalFor('cms/v1/content'), portraitStore }) : createFileContentStore({ directory });
    const contactsStore = mode === 'cloud' ? createOssContactsStore({ journal: journalFor('cms/v1/contacts'), contentStore: store }) : createFileContactsStore({ directory, contentStore: store });
    const api = mode === 'cloud' ? createCloudContentApi({ enabled: true, store, contactsStore, portraitStore, auth: createCloudAuth({ users, journalFor }) }) : createContentApi({ store, contactsStore, users, allowedOrigin: origin });
    const request = (path, { method = 'GET', headers = {}, body, suppliedOrigin = origin } = {}) => new Request(origin + path, {
      method, headers: { Origin: suppliedOrigin, ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const call = (path, options) => api(request(path, options));
    const login = async username => {
      const response = await call('/api/admin/login', { method: 'POST', body: { username, password: PASSWORD } });
      assert.equal(response.status, 200);
      return { Cookie: response.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': (await response.json()).csrfToken };
    };
    const created = await contactsStore.createContact(0, {
      name: '合成人员', displayName: '合成邀约对象', organization: '合成社群', contactConsent: 'consented',
      email: 'hidden@example.invalid', wechat: 'HIDDEN_WECHAT', phone: 'HIDDEN_PHONE', background: 'HIDDEN_QUESTIONNAIRE',
    }, 'both');
    const { draft } = await store.read();
    const session = draft.content.sessions.find(item => item.zone === 'B');
    session.format = 'workshop';
    session.internalNotes = 'HIDDEN_SESSION_NOTE';
    draft.content.guests = [{ id: 'synthetic-guest', contactId: created.contact.id, name: '合成关联嘉宾', company: '合成机构', ggjRole: '', portraitId: '', status: 'pending', publicConsent: false, internalNotes: 'HIDDEN_GUEST_NOTE' }];
    session.guestId = 'synthetic-guest';
    draft.content.booths = [{ id: 'synthetic-booth', slotNumber: 1, code: 'SYN-01', organization: '合成展位', project: '合成项目', zone: 'C', status: 'pending', internalNotes: 'HIDDEN_BOOTH_NOTE' }];
    await store.save(0, draft.content, 'both');
    await contactsStore.saveOperations(created.contact.id, created.revision, { ...created.contact.operations, responseStatus: 'attending', participationForms: ['host'], sessionIds: [session.id], boothIds: ['synthetic-booth'], notes: 'HIDDEN_FOLLOWUP_NOTE' }, 'both');
    assert.equal((await call('/api/admin/arrangements')).status, 401);
    for (const username of ['editor', 'outreach', 'publisher']) {
      const headers = await login(username);
      assert.equal((await call('/api/admin/arrangements', { headers })).status, 403);
    }
    const headers = await login('both');
    const response = await call('/api/admin/arrangements', { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    const text = await response.text();
    assert.match(text, /合成关联嘉宾/u);
    assert.match(text, /合成展位/u);
    assert.match(text, /attending/u);
    assert.doesNotMatch(text, /HIDDEN_|hidden@example|contactConsent|sourceProfile|sourceRowId|materialLinks|"email"|"wechat"|"phone"|internalNotes/u);
    const overview = JSON.parse(text);
    assert.deepEqual(overview.revisions, { content: 1, contacts: 2 });
    assert.equal(overview.boothRows.length, 15);
    assert.equal((await call('/api/admin/arrangements', { headers, suppliedOrigin: 'https://untrusted.invalid' })).status, 403);
    assert.equal((await call('/api/admin/arrangements?extra=1', { headers })).status, 404);
    assert.equal((await call('/api/public/arrangements')).status, 404);
    assert.equal((await call('/api/admin/arrangements', { method: 'POST', headers, body: {} })).status, 404);
  });
}
