import test from 'node:test';
import assert from 'node:assert/strict';
import { createContactAdmissionGuard } from '../functions/cloud-content/contact-admission-guard.mjs';
import { createCloudContentApi } from '../functions/cloud-content/handler.mjs';
import { CloudContentError } from '../functions/cloud-content/errors.mjs';

const id = 'c_synthetic', registrationId = 'A'.repeat(43), actor = { id: 'synthetic-outreach', roles: ['outreach'] };
const operations = { sessionIds: ['old-session'], boothIds: ['old-booth'], participationForms: ['attendee'], notes: '', responseStatus: 'pending' };
function fixture({ status = 'waitlisted', linked = true, consent = 'consented', response = 'pending' } = {}) {
  const calls = [];
  const contact = { id, profile: { contactConsent: consent }, operations: { ...operations, responseStatus: response } };
  const guard = createContactAdmissionGuard({ contactsStore: { read: async () => { calls.push('contacts'); return { revision: 2, contacts: [contact] }; } },
    lookupRegistration: async () => { calls.push('lookup'); return linked ? registrationId : null; },
    getAdmissionStatus: async () => { calls.push('admission'); if (status === 'unknown') throw new Error('PRIVATE'); return { status }; } });
  return { calls, guard, contact };
}
const change = (operations, expectedRevision = 2, action = 'operations') => ({ contactId: id, actor, action, input: { expectedRevision, operations } });

test('linked waitlisted, withdrawn and unknown admissions cannot bypass confirmed assignments or invitation records', async () => {
  for (const status of ['waitlisted', 'withdrawn', 'unknown']) {
    const f = fixture({ status });
    for (const input of [change({ ...operations, boothIds: ['new-booth'] }), change(undefined, 2, 'invitation')]) {
      await assert.rejects(f.guard(input), error => error instanceof CloudContentError && error.status === (status === 'unknown' ? 503 : 422) && !error.message.includes('PRIVATE'));
    }
  }
  for (const options of [{ status: 'confirmed' }, { linked: false }]) {
    const f = fixture(options); await f.guard(change({ ...operations, boothIds: ['new-booth'] }));
  }
});

test('notes, unchanged historical assignments and removals remain editable without reading admission status', async () => {
  for (const state of [{ status: 'waitlisted' }, { status: 'withdrawn', consent: 'declined' }, { status: 'unknown', response: 'declined' }]) {
    const f = fixture(state);
    await f.guard(change({ ...operations, notes: '合成跟进记录' }));
    await f.guard(change({ ...operations, sessionIds: [], boothIds: [], participationForms: [] }));
    assert.deepEqual(f.calls, ['contacts', 'contacts']);
  }
});

test('declined contacts cannot gain allocations and stale comparisons stop before conversion or admission reads', async () => {
  for (const state of [{ consent: 'declined' }, { response: 'declined' }]) {
    const f = fixture(state); await assert.rejects(f.guard(change({ ...operations, sessionIds: ['new-session'] })), error => error.code === 'CONTACT_DECLINED');
    assert.deepEqual(f.calls, ['contacts']);
  }
  const f = fixture(); await assert.rejects(f.guard(change({ ...operations, boothIds: ['new-booth'] }, 1)), error => error.code === 'REVISION_CONFLICT');
  assert.deepEqual(f.calls, ['contacts']);
});

test('legacy HTTP hooks run after staff authorization and CSRF, before the original store CAS', async () => {
  const calls = [], noop = () => {}, guard = fixture().guard;
  const contactsStore = Object.fromEntries(['read', 'createContact', 'saveProfile', 'saveOperations', 'recordGenerated', 'recordSent', 'guestPrefill'].map(name => [name, async () => { calls.push(name); return {}; }]));
  const api = createCloudContentApi({ enabled: true, contactsStore, beforeContactMutation: guard,
    store: Object.fromEntries(['read', 'save', 'publish', 'recordPortraitUpload'].map(name => [name, noop])), portraitStore: { read: noop, upload: noop },
    auth: { login: noop, logout: noop, authenticate: async () => ({ user: actor, csrfToken: 'synthetic-csrf' }) } });
  const request = (path, method, csrf = 'synthetic-csrf', adding = true) => new Request('https://api.artdico.host/api/admin/contacts/' + id + path, { method,
    headers: { Origin: 'https://api.artdico.host', 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ expectedRevision: 2, operations: { ...operations, boothIds: adding ? ['new-booth'] : [] } }) });
  assert.equal((await api(request('', 'PUT', 'wrong'))).status, 403);
  assert.equal((await api(request('', 'PUT'))).status, 422);
  assert.equal((await api(request('/invitation/generated', 'POST'))).status, 422);
  assert.equal((await api(request('/invitation/sent', 'POST'))).status, 422);
  assert.deepEqual(calls, []);
  assert.equal((await api(request('', 'PUT', 'synthetic-csrf', false))).status, 200);
  assert.deepEqual(calls, ['saveOperations']);
});
