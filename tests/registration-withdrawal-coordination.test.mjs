import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistrationAdminApi } from '../functions/registration-admin/handler.mjs';
import { createRegistrationReviewStore } from '../functions/registration-admin/store.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';

const id = 'A'.repeat(43), eventId = 'ggj-cn-2026', at = '2026-10-20T07:00:00.000Z';
const actor = { id: 'synthetic-reviewer', roles: ['reviewer'] };
function fixture(unknownAck = false) {
  const objects = memoryObjects(), journal = createObjectJournal({ objects, prefix: 'cms/v1/registration-reviews/' + eventId });
  const source = { id, eventId, submittedAt: at, referenceCode: id,
    fields: { name: '合成参会者', organization: '合成团队', city: '合成城市', position: '合成角色', categories: ['industry'], participationInterests: ['attend'], attendance: 'expected', accommodationChoice: 'not_needed' },
    consent: { accepted: true, version: 'synthetic-notice', acceptedAt: at }, provenance: { kind: 'public' } };
  const store = createRegistrationReviewStore({ journal: unknownAck ? { ...journal, async commit(...args) { await journal.commit(...args); throw new Error('PRIVATE_UNKNOWN_ACK'); } } : journal,
    loadRegistrations: async () => ({ registrations: [source], revision: 1 }), eventId, clock: () => Date.parse(at) });
  return { store };
}
async function withdrawal(store) {
  const review = (await store.detail(id)).review;
  delete review.deletionRequested; review.status = 'withdrawn';
  return new Request('https://api.artdico.host/api/admin/registrations/' + id + '/review', { method: 'PATCH',
    headers: { Origin: 'https://api.artdico.host', 'Content-Type': 'application/json', 'X-CSRF-Token': 'synthetic-csrf' },
    body: JSON.stringify({ expectedRevision: 0, review }) });
}
const auth = { authenticate: async () => ({ user: actor, csrfToken: 'synthetic-csrf' }) };

test('seat release happens only after the review commit is proven and exposes only a bounded confirmation', async () => {
  const { store } = fixture(), calls = [];
  const api = createRegistrationAdminApi({ enabled: true, auth, store, onWithdrawalCommitted: async input => {
    calls.push(input); assert.equal(await store.isWithdrawn(id), true);
    return { status: 'released', promotedCount: 1, privateDetails: 'PRIVATE' };
  } });
  const response = await api(await withdrawal(store)), saved = await response.json();
  assert.equal(response.status, 200); assert.equal(saved.review.status, 'withdrawn');
  assert.deepEqual(saved.admissionRelease, { status: 'released', promotedCount: 1 });
  assert.deepEqual(calls, [{ registrationId: id, reviewRevision: 1, actor }]);
  assert.doesNotMatch(JSON.stringify(saved), /PRIVATE/u);
});

test('unknown review acknowledgement never releases capacity, even when a later read observes the saved withdrawal', async () => {
  const { store } = fixture(true); let releases = 0;
  const api = createRegistrationAdminApi({ enabled: true, auth, store, onWithdrawalCommitted: async () => { releases++; } });
  const response = await api(await withdrawal(store));
  assert.equal(response.status, 503); assert.equal(releases, 0); assert.equal(await store.isWithdrawn(id), true);
  assert.doesNotMatch(await response.text(), /PRIVATE/u);
});

test('unknown release outcomes preserve the saved review and report pending without a blind retry', async () => {
  const { store } = fixture(); let releases = 0;
  const api = createRegistrationAdminApi({ enabled: true, auth, store, onWithdrawalCommitted: async () => { releases++; throw new Error('PRIVATE_RELEASE_ACK'); } });
  const response = await api(await withdrawal(store)), result = await response.json();
  assert.equal(response.status, 200); assert.equal(result.review.status, 'withdrawn'); assert.deepEqual(result.admissionRelease, { status: 'pending' });
  assert.equal(releases, 1); assert.equal(await store.isWithdrawn(id), true); assert.doesNotMatch(JSON.stringify(result), /PRIVATE/u);
});
