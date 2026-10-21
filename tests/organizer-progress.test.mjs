import test from 'node:test';
import assert from 'node:assert/strict';
import { contactProgress, summarizeContactProgress, buildOrganizerTasks } from '../shared/organizer-progress.mjs';
import { createOrganizerTasksApi } from '../functions/organizer-tasks/handler.mjs';
import { eventConfig as event } from '../src/config/event.mjs';

const now = Date.parse('2026-10-22T02:00:00.000Z');
const contact = (id = 'synthetic-person', patch = {}) => ({ id,
  profile: { name: '合成人员', displayName: '合成人员', organization: '合成机构', contactConsent: 'consented', email: 'synthetic@example.invalid', ...patch.profile },
  operations: { owner: '合成同事', responseStatus: 'pending', sessionIds: [], boothIds: [], participationForms: [], followUpAt: '', ...patch.operations },
  invitation: { generatedAt: null, sentAt: null, settings: null, ...patch.invitation } });
const conversion = id => ({ sourceContactId: id, registrationId: 'synthetic-registration', referenceCode: 'synthetic-reference', admissionStatus: 'confirmed' });
const settings = { recipientName: '合成人员', date: event.date.value, time: event.time.start + '–' + event.time.end, venue: event.venue.address, confirmed: true };
const invitation = (id, status = 'manually_sent', patch = {}) => ({ id: 'synthetic-invitation', sourceContactId: id, registrationId: 'synthetic-registration',
  channel: status === 'manually_sent' ? 'manual' : 'email', status, createdAt: '2026-10-21T01:00:00.000Z', updatedAt: '2026-10-21T02:00:00.000Z',
  content: { eventId: event.id, title: event.title, registrationId: 'synthetic-registration', referenceCode: 'synthetic-reference', settings }, ...patch });
const intentFor = (person, invitations) => ({ revision: 3, conversions: [conversion(person.id)], invitations });
const options = { event, now, content: { sessions: [], booths: [] } };
const legacySent = { generatedAt: '2026-10-20T01:00:00.000Z', sentAt: '2026-10-20T02:00:00.000Z', sentGenerationAt: '2026-10-20T01:00:00.000Z', settings };

test('current manual invitations merge legacy and ledger once per person, separately from provider acknowledgement', () => {
  const person = contact('synthetic-person', { invitation: legacySent });
  const summary = summarizeContactProgress([person], { ...options, intent: intentFor(person, [invitation(person.id), invitation(person.id, 'provider_accepted', { id: 'synthetic-email' })]) });
  assert.equal(summary.manuallySent, 1);assert.equal(summary.providerAccepted, 1);assert.equal(summary.awaitingReply, 1);
  assert.equal(Object.hasOwn(summary, 'delivered'), false);
  const providerOnly = contactProgress(contact(), { ...options, intent: intentFor(person, [invitation(person.id, 'provider_accepted')]) });
  assert.equal(providerOnly.manuallySent, false);assert.equal(providerOnly.state, 'provider_accepted');assert.equal(providerOnly.response, 'pending');
});

test('legacy sent records require the current generated version and verified current facts', () => {
  const person = contact('synthetic-person', { invitation: legacySent });
  assert.equal(contactProgress(person, options).manuallySent, true);
  for (const patch of [{ generatedAt: '2026-10-21T01:00:00.000Z' }, { settings: { ...settings, date: '2026-12-04' } },
    { settings: { ...settings, confirmed: false } }, { settings: { ...settings, recipientName: '历史称呼' } },
    { sentAt: '2026-10-19T01:00:00.000Z' }]) {
    const result = contactProgress(contact('synthetic-person', { invitation: { ...legacySent, ...patch } }), options);
    assert.equal(result.manuallySent, false);assert.equal(result.stale, true);
  }
});

test('expired, stale registration, event facts and superseded invitation versions do not count as current sends', () => {
  const person = contact();
  for (const item of [invitation(person.id, 'manually_sent', { expiresAt: '2026-10-21T23:00:00.000Z' }),
    invitation(person.id, 'manually_sent', { registrationId: 'old-registration' }),
    invitation(person.id, 'manually_sent', { content: { ...invitation(person.id).content, title: '历史标题' } })]) {
    assert.equal(contactProgress(person, { ...options, intent: intentFor(person, [item]) }).manuallySent, false);
  }
  const old = invitation(person.id, 'manually_sent', { updatedAt: '2026-10-22T01:00:00.000Z' });
  const latest = invitation(person.id, 'prepared', { channel: 'manual', createdAt: '2026-10-21T12:00:00.000Z', updatedAt: '2026-10-21T12:00:00.000Z' });
  const result = contactProgress(person, { ...options, intent: intentFor(person, [latest, old]) });
  assert.equal(result.manuallySent, false);assert.equal(result.state, 'prepared');
});

test('both contact opt-out and attendance decline are excluded from send, reply and daily task counts', () => {
  for (const patch of [{ profile: { contactConsent: 'declined' } }, { operations: { responseStatus: 'declined' } }]) {
    const person = contact('synthetic-person', { ...patch, invitation: legacySent });
    const source = { contacts: [person], ...options, intent: intentFor(person, [invitation(person.id, 'provider_accepted')]) };
    const summary = summarizeContactProgress(source.contacts, source);
    assert.equal(summary.excluded, 1);assert.equal(summary.manuallySent, 0);assert.equal(summary.providerAccepted, 0);assert.equal(summary.awaitingReply, 0);
    assert.equal(buildOrganizerTasks(source).tasks.some(task => task.contactId === person.id), false);
  }
});

test('unknown or interrupted email acknowledgement produces review task without suggesting a resend', () => {
  const person = contact();
  for (const status of ['unknown', 'issuing']) {
    const result = buildOrganizerTasks({ contacts: [person], ...options, intent: intentFor(person, [invitation(person.id, status)]) });
    assert.equal(result.metrics.manuallySent, 0);assert.equal(result.metrics.providerAccepted, 0);assert.equal(result.metrics.unknown, 1);
    assert.ok(result.tasks.some(task => task.kind === 'invitation_unknown'));assert.ok(!result.tasks.some(task => task.kind === 'unsent'));
  }
});

test('replies remain authoritative and arrangements are needed only for confirmed participation requiring one', () => {
  const attendee = contact('synthetic-attendee', { operations: { responseStatus: 'attending', participationForms: ['attendee'] } });
  const speaker = contact('synthetic-speaker', { operations: { responseStatus: 'attending', participationForms: ['speaker'], sessionIds: ['cancelled-session'] } });
  const source = { contacts: [attendee, speaker], ...options, content: { sessions: [{ id: 'cancelled-session', status: 'cancelled' }], booths: [] } };
  const tasks = buildOrganizerTasks(source).tasks.filter(task => task.kind === 'unassigned');
  assert.deepEqual(tasks.map(task => task.contactId), [speaker.id]);
  source.content.sessions[0].status = 'scheduled';assert.equal(buildOrganizerTasks(source).tasks.some(task => task.kind === 'unassigned'), false);
});

test('missing booth detail tasks include fixed empty positions without publishing private contact methods', () => {
  const result = buildOrganizerTasks({ ...options, contacts: [], content: { sessions: [], booths: [{ id: 'synthetic-booth', code: 'C01', slotNumber: 1, status: 'pending', organization: '合成机构', project: '合成项目', contactName: '合成负责人', contactMethods: 'private-synthetic-method' }] } });
  assert.equal(result.tasks.length, 15);assert.equal(result.tasks[0].kind, 'missing_booth_details');
  assert.ok(result.tasks.find(task => task.boothId === 'synthetic-booth').detail.includes('展示内容'));
  assert.equal(JSON.stringify(result).includes('private-synthetic-method'), false);
  assert.equal(result.tasks.filter(task => task.slotNumber).length, 14);
});

test('unavailable ledger does not create fake unconverted tasks, and inactive registrations suppress invitation tasks', () => {
  const person = contact();
  const unavailable = buildOrganizerTasks({ contacts: [person], ...options, intent: null });
  assert.equal(unavailable.available.registrationProgress, false);assert.ok(!unavailable.tasks.some(task => task.kind === 'unconverted'));
  const result = buildOrganizerTasks({ contacts: [person], ...options, intent: intentFor(person, [invitation(person.id)]), inactiveRegistrationIds: ['synthetic-registration'] });
  assert.ok(!result.tasks.some(task => task.contactId));assert.equal(result.metrics.manuallySent, 0);
});

test('current admission snapshot overrides conversion metadata and keeps waitlisting distinct from withdrawal', () => {
  const person = contact('synthetic-person', { operations: { responseStatus: 'attending', participationForms: ['speaker'] } });
  const intent = intentFor(person, []);
  const waitlisted = buildOrganizerTasks({ contacts: [person], ...options, intent,
    admissionStatuses: [{ registrationId: 'synthetic-registration', status: 'waitlisted' }] });
  const pending = waitlisted.tasks.filter(task => task.contactId === person.id);
  assert.deepEqual(pending.map(task => task.kind), ['admission_pending']);assert.match(pending[0].detail, /候补登记，名额尚未确认/u);
  assert.equal(waitlisted.metrics.waitlisted, 1);assert.equal(waitlisted.metrics.converted, 1);
  const progress = contactProgress(person, { ...options, intent, admissionStatuses: [{ registrationId: 'synthetic-registration', status: 'waitlisted' }] });
  assert.equal(progress.state, 'waitlisted');assert.equal(progress.inactive, false);
  const withdrawn = contactProgress(person, { ...options, intent, admissionStatuses: [{ registrationId: 'synthetic-registration', status: 'withdrawn' }] });
  assert.equal(withdrawn.state, 'inactive');assert.equal(withdrawn.admissionPending, false);
  const deleted = contactProgress(person, { ...options, intent, admissionStatuses: [{ registrationId: 'synthetic-registration', status: 'confirmed' }], inactiveRegistrationIds: ['synthetic-registration'] });
  assert.equal(deleted.admissionStatus, 'withdrawn');assert.equal(deleted.state, 'inactive');
});

test('missing or explicitly unknown admission fails closed for formal invitation tasks without hiding unknown send ACKs', () => {
  const person = contact(), intent = intentFor(person, [invitation(person.id, 'unknown')]);
  delete intent.conversions[0].admissionStatus;
  for(const admissionStatuses of [[],[{registrationId:'synthetic-registration',status:'unknown'}]]){
    const result = buildOrganizerTasks({ contacts: [person], ...options, intent, admissionStatuses });
    assert.equal(result.metrics.admissionUnknown, 1);assert.ok(result.tasks.some(task => task.kind === 'admission_pending'));
    assert.ok(result.tasks.some(task => task.kind === 'invitation_unknown'));assert.ok(!result.tasks.some(task => ['unsent','unreplied','unassigned'].includes(task.kind)));
    const progress = contactProgress(person, { ...options, intent, admissionStatuses });assert.equal(progress.state,'admission_unknown');assert.equal(progress.inactive,false);
  }
  intent.conversions[0].admissionStatus='waitlisted';
  assert.equal(contactProgress(person,{...options,intent}).state,'waitlisted');
  intent.conversions[0].admissionStatus='confirmed';
  assert.ok(buildOrganizerTasks({contacts:[person],...options,intent:{...intent,invitations:[]}}).tasks.some(task=>task.kind==='unsent'));
});

const source = () => ({ contacts: [contact()], contactRevision: 4, content: { sessions: [], booths: [] }, contentRevision: 2,
  intent: { revision: 0, conversions: [], invitations: [] } });
const get = (query = '', init = {}) => new Request('https://api.artdico.host/api/admin/tasks' + query, init);
test('tasks API requires the full server role gate before reading any private source or count', async () => {
  let reads = 0;
  for (const roles of [['editor'], ['outreach'], ['reviewer'], ['editor', 'publisher']]) {
    const handle = createOrganizerTasksApi({ authenticate: async () => ({ user: { id: 'synthetic-staff', roles } }), getSources: async () => { reads++;return source(); }, now: () => now });
    const result = await handle(get());assert.equal(result.status, 403);assert.equal((await result.text()).includes('合成人员'), false);
  }
  const anonymous = createOrganizerTasksApi({ authenticate: async () => null, getSources: async () => { reads++;return source(); } });
  assert.equal((await anonymous(get())).status, 401);assert.equal(reads, 0);
});

test('authorized task API filters responsible people and task kinds, paginates, and returns private no-store responses', async () => {
  for (const roles of [['outreach', 'reviewer'], ['superadmin']]) {
    const handle = createOrganizerTasksApi({ authenticate: async () => ({ user: { id: 'synthetic-staff', roles } }), getSources: async () => source(), now: () => now });
    const result = await handle(get('?owner='+encodeURIComponent('合成同事')+'&kind=unconverted&limit=1'));
    assert.equal(result.status, 200);assert.equal(result.headers.get('cache-control'), 'no-store');
    const body = await result.json();assert.equal(body.total, 1);assert.equal(body.tasks.length, 1);assert.equal(body.tasks[0].contactId, 'synthetic-person');
    assert.equal(JSON.stringify(body).includes('synthetic@example.invalid'), false);assert.equal(body.byKind.missing_booth_details, 0);
    const page = await (await handle(get('?kind=missing_booth_details&limit=2'))).json();assert.equal(page.total, 15);assert.equal(page.tasks.length, 2);assert.equal(page.nextCursor, '2');
  }
});

test('tasks API rejects cross-origin, malformed filters, unsupported writes and missing source snapshots without false zeros', async () => {
  let reads = 0;
  const handle = createOrganizerTasksApi({ authenticate: async () => ({ user: { id: 'synthetic-staff', roles: ['superadmin'] } }), getSources: async () => { reads++;throw new Error('private synthetic source failure'); } });
  for(const query of ['?limit=201','?cursor=-1','?kind=invalid','?owner=a&owner=b','?unknown=1'])assert.equal((await handle(get(query))).status,400);
  assert.equal((await handle(get('',{headers:{Origin:'https://other.example.invalid'}}))).status,403);
  assert.equal((await handle(get('',{method:'POST'}))).status,405);assert.equal(reads,0);
  const failure = await handle(get());assert.equal(failure.status,503);assert.equal((await failure.text()).includes('private synthetic'),false);
});

test('a seminar organizer needs a saved session just as a speaker or host, without implying public confirmation', () => {
  const person=contact('synthetic-organizer',{operations:{participationForms:['organizer'],responseStatus:'attending'}});
  const result=buildOrganizerTasks({...options,contacts:[person],intent:intentFor(person,[])});
  assert.equal(result.tasks.some(task=>task.kind==='unassigned'&&task.contactId===person.id),true);
  assert.equal(result.metrics.attending,1);assert.equal(result.metrics.manuallySent,0);
});
