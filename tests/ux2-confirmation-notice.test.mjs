import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createRegistrationConfirmationService } from '../functions/registration-confirmation/service.mjs';
import { createConfirmationRepository, confirmationNoticeId, confirmationRequestHash } from '../functions/registration-confirmation/repository.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';
import { confirmationsSource, communicationProjection } from '../functions/person-workspace/projection.mjs';

const actor = { id: 'synthetic-owner', roles: ['superadmin'] }, other = { id: 'synthetic-other', roles: ['superadmin'] };
const event = { id: 'synthetic-ux2', title: '合成活动', date: { value: '2026-12-05' }, time: { label: '10:00–18:00', start: '09:30', timezone: 'Asia/Shanghai' }, venue: { address: '合成地点' } };
const operationId = () => randomBytes(24).toString('base64url');
const idFor = index => createHash('sha256').update('synthetic-ux2-' + index).digest('base64url');
const cursor = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function fixture(count = 1) {
  const objects = memoryObjects(), ids = Array.from({ length: count }, (_, i) => idFor(i));
  const state = { now: Date.parse('2026-11-01T00:00:00Z'), sourceRevision: 'a'.repeat(64), group: null, previewReads: 0,
    indexReads: 0, recordReads: 0, providerReads: 0, factReads: 0, providerReady: true, factsReady: true, messages: [], status: 'provider_accepted', permissions: new Map() };
  const records = new Map(ids.map((id, i) => [id, { id, fields: { name: '合成人员 ' + i, organization: '合成组织 ' + i, email: 'synthetic.' + i + '@example.invalid' }, provenance: { kind: 'public' }, consent: { accepted: true } }]));
  const registrationService = { repository: {
    readIndex: async () => { state.indexReads++; if (state.indexUnavailable) throw new Error('Synthetic index unavailable');
      return { value: { entries: ids.map(id => ({ id })), admissions: { personGroups: state.group ? [state.group] : [] } } }; },
    readRecord: async entry => { state.recordReads++; return records.get(entry.id); },
  }, getAdmissionStatus: async () => ({ status: 'confirmed', kind: 'attendee', revision: 1 }) };
  const aliases = id => state.group?.registrationIds.includes(id) ? state.group.registrationIds : [id];
  const journalFor = prefix => createObjectJournal({ objects, prefix });
  const service = createRegistrationConfirmationService({ registrationService, journalFor, event,
    tokenSecret: 'synthetic-ux2-notice-token-key-12345678901234567890', clock: () => state.now,
    emailProvider: { readiness: () => { state.providerReads++; return { ready: state.providerReady, enabled: true }; }, send: async input => { state.messages.push(input); return { status: state.status }; } },
    eventFactsReadiness: () => { state.factReads++; return { ready: state.factsReady, reason: 'EVENT_FACTS_MISMATCH', revision: 1, key: 'synthetic' }; },
    noticePreviewSource: async ({ registrationIds, offset, limit }) => {
      state.previewReads++;
      const selected = ids.filter(id => (!registrationIds || registrationIds.includes(id)) && (!state.group || !state.group.registrationIds.includes(id) || state.group.primaryRegistrationId === id));
      return { revision: state.sourceRevision, total: selected.length, rows: selected.slice(offset, offset + limit).map(id => ({ registrationId: id,
        name: records.get(id).fields.name, organization: records.get(id).fields.organization, relatedRegistrationIds: aliases(id),
        eligible: !state.permissions.has(id), reason: state.permissions.get(id) ?? 'ELIGIBLE' })) };
    },
  });
  const repo = createConfirmationRepository({ journal: journalFor(service.prefix), eventId: event.id, clock: () => state.now });
  const append = async (action, details, by = actor) => repo.append(await repo.read(), action, details, by.id);
  const start = async (registrationIds, by = actor, action = 'dispatch') => {
    const op = operationId(); await append(action + '_started', { operationId: op, requestHash: 'f'.repeat(64), registrationIds, retryRejected: false }, by); return op;
  };
  const notice = async (id, kind, status, admissionStatus = 'confirmed') => {
    await append('reserve', { registrationId: id, kind, admissionStatus, admissionRevision: 1, retryRejected: false });
    if (status !== 'reserved') await append('result', { noticeId: confirmationNoticeId(event.id, id, kind), status });
  };
  return { state, objects, ids, records, service, repo, append, start, notice };
}

test('formal preview pages 100 named people and binds source, notice revision, purpose and selected scope without writes', async () => {
  const f = fixture(105), first = await f.service.staffConfirmationPreview({ actor });
  assert.equal(first.kind, 'registration'); assert.match(first.sourceRevision, /^[a-f0-9]{64}$/u);
  assert.equal(first.total, 105); assert.equal(first.rows.length, 100);
  assert.deepEqual(Object.keys(JSON.parse(Buffer.from(first.nextCursor, 'base64url'))).sort(), ['kind', 'noticeRevision', 'offset', 'source']);
  assert.ok(first.rows.every(row => row.name && row.organization && row.eligible && row.status === 'not_sent'));
  const second = await f.service.staffConfirmationPreview({ actor, cursor: first.nextCursor });
  assert.equal(second.rows.length, 5); assert.equal(second.nextCursor, null); assert.equal(second.sourceRevision, first.sourceRevision);
  assert.equal(new Set([...first.rows, ...second.rows].map(row => row.registrationId)).size, 105);
  assert.doesNotMatch(JSON.stringify(first), /@example|receiptToken|confirmationUrl|relatedRegistrationIds|#r=/u);
  assert.match(first.message.text, /\[私人参会页链接\]/u);
  await assert.rejects(f.service.staffConfirmationPreview({ actor, cursor: first.nextCursor, registrationIds: [f.ids[0]] }), error => error.code === 'REVISION_CONFLICT');
  const selected = f.ids.slice(0, 2), scoped = await f.service.staffConfirmationPreview({ actor, registrationIds: selected });
  const scopedCursor = cursor({ kind: 'registration', source: scoped.sourceRevision, noticeRevision: scoped.revision, offset: 0 });
  assert.equal((await f.service.staffConfirmationPreview({ actor, registrationIds: [...selected].reverse(), cursor: scopedCursor })).sourceRevision, scoped.sourceRevision);
  await assert.rejects(f.service.staffConfirmationPreview({ actor, registrationIds: [f.ids[2]], cursor: scopedCursor }), error => error.code === 'REVISION_CONFLICT');
  f.state.sourceRevision = 'b'.repeat(64);
  await assert.rejects(f.service.staffConfirmationPreview({ actor, cursor: first.nextCursor }), error => error.code === 'REVISION_CONFLICT');
  f.state.sourceRevision = 'a'.repeat(64); await f.append('settings', { operationId: operationId(), requestHash: 'e'.repeat(64), enabled: false });
  await assert.rejects(f.service.staffConfirmationPreview({ actor, cursor: first.nextCursor }), error => error.code === 'REVISION_CONFLICT');
  assert.equal(f.state.indexReads, 0); assert.equal(f.state.recordReads, 0); assert.equal(f.state.messages.length, 0);
  assert.equal((await f.repo.read()).value.revision, 1, 'only the explicit fixture settings mutation wrote');
});

test('formal and reminder cursors cannot cross purposes while old three-field reminder pages stay byte-shape compatible', async () => {
  const f = fixture(101), formal = await f.service.staffConfirmationPreview({ actor }), reminder = await f.service.staffReminderPreview({ actor });
  assert.deepEqual(Object.keys(JSON.parse(Buffer.from(reminder.nextCursor, 'base64url'))).sort(), ['noticeRevision', 'offset', 'source']);
  assert.equal(Object.hasOwn(reminder, 'sourceRevision'), false);
  assert.equal((await f.service.staffReminderPreview({ actor, cursor: reminder.nextCursor })).rows.length, 1);
  for (const [method, invalid] of [['staffConfirmationPreview', reminder.nextCursor], ['staffReminderPreview', formal.nextCursor],
    ['staffConfirmationPreview', cursor({ kind: 'pre_event_reminder', source: formal.sourceRevision, noticeRevision: 0, offset: 0 })],
    ['staffConfirmationPreview', cursor({ kind: 'registration', source: formal.sourceRevision, noticeRevision: 0, offset: -1 })]]) {
    const before = f.state.previewReads;
    await assert.rejects(f.service[method]({ actor, cursor: invalid }), error => error.code === 'INVALID_REQUEST');
    assert.equal(f.state.previewReads, before, 'invalid purpose/cursor rejected before private source I/O');
  }
  f.state.now = Date.parse('2026-12-06T00:00:00Z');
  assert.equal((await f.service.staffConfirmationPreview({ actor })).rows[0].eligible, true, 'formal confirmation has no reminder time window');
  assert.equal((await f.service.staffReminderPreview({ actor })).rows[0].reason, 'REMINDER_WINDOW_CLOSED');
});

test('formal preview reads current permission, provider, published facts and pause before allowing a selection', async () => {
  const f = fixture(), check = async reason => {
    const row = (await f.service.staffConfirmationPreview({ actor })).rows[0];
    assert.equal(row.reason, reason); assert.equal(row.eligible, reason === 'ELIGIBLE');
  };
  await check('ELIGIBLE'); f.state.permissions.set(f.ids[0], 'CONTACT_DECLINED'); await check('CONTACT_DECLINED');
  f.state.permissions.clear(); f.state.providerReady = false; await check('EMAIL_NOT_READY');
  f.state.providerReady = true; f.state.factsReady = false; await check('EVENT_FACTS_MISMATCH');
  f.state.factsReady = true; await f.append('settings', { operationId: operationId(), requestHash: 'e'.repeat(64), enabled: false });
  await check('EMAIL_PAUSED'); assert.equal(f.state.messages.length, 0); assert.equal((await f.repo.read()).value.revision, 1);
});

test('formal preview and delivery conservatively expose another operator unfinished batch before any notice, including explicit aliases', async () => {
  const f = fixture(3); f.state.group = { registrationIds: f.ids.slice(0, 2), primaryRegistrationId: f.ids[1] };
  f.records.get(f.ids[2]).fields.email = f.records.get(f.ids[1]).fields.email;
  f.records.get(f.ids[2]).fields.name = f.records.get(f.ids[1]).fields.name;
  const op = await f.start([f.ids[0]], other), before = f.objects.calls.length;
  const preview = await f.service.staffConfirmationPreview({ actor }), row = preview.rows.find(item => item.registrationId === f.ids[1]);
  assert.equal(row.status, 'unknown'); assert.equal(row.reason, 'DELIVERY_UNKNOWN'); assert.equal(row.eligible, false);
  assert.equal(preview.rows.find(item => item.registrationId === f.ids[2]).eligible, true, 'same mailbox/name never creates aliases');
  const delivery = await f.service.staffDeliveryState({ actor, registrationId: f.ids[1] });
  assert.equal(delivery.status, 'unknown'); assert.equal(delivery.reason, 'DELIVERY_UNKNOWN'); assert.equal(delivery.ready, false);
  const history = await f.service.staffHistory({ actor, registrationId: f.ids[1], relatedRegistrationIds: f.ids.slice(0, 2) });
  assert.equal(history.notices.length, 0, 'no invented notice or original operation'); assert.equal(history.unresolvedConfirmations, true);
  const directory = await f.service.staffDirectory({ actor });
  assert.deepEqual(directory.notices, [{ registrationId: f.ids[1], status: 'unknown',historicalUnknown:true }]);
  await assert.rejects(f.service.confirmationOperation({ actor, operationId: op }), error => error.code === 'CONFIRMATION_NOT_FOUND');
  assert.ok(f.objects.calls.slice(before).every(call => call.operation === 'get')); assert.equal(f.state.messages.length, 0);
  await f.append('dispatch_completed', { operationId: op, results: [{ registrationId: f.ids[0], status: 'not_attempted' }] }, other);
  assert.equal((await f.service.staffDeliveryState({ actor, registrationId: f.ids[1] })).status, 'not_sent');
  assert.notEqual((await f.service.staffHistory({ actor, registrationId: f.ids[1], relatedRegistrationIds: f.ids.slice(0, 2) })).unresolvedConfirmations, true);
});

test('history keeps notice facts and totals while optional batch uncertainty reaches the existing person communication flag', () => {
  const legacy = confirmationsSource({ revision: 0, notices: [] });
  assert.equal(Object.hasOwn(legacy, 'unresolvedConfirmations'), false);
  const source = confirmationsSource({ revision: 1, notices: [], unresolvedConfirmations: true });
  const communications = communicationProjection({ contactRaw: null, contactId: null, registrationId: idFor(0), intent: null, confirmations: source });
  assert.equal(communications.unresolvedConfirmations, true); assert.equal(communications.confirmationTotal, 0);
  assert.equal(communications.timelineTotal, 0); assert.deepEqual(communications.confirmations, []); assert.deepEqual(communications.timeline, []);
  for (const invalid of [null, 'unknown', 1, {}]) assert.throws(() => confirmationsSource({ revision: 1, notices: [], unresolvedConfirmations: invalid }));
});

test('directory resolves started aliases with accepted confirmed proof, retains actual unknown priority and fails closed on unavailable identity', async () => {
  const f = fixture(3); f.state.group = { registrationIds: f.ids.slice(0, 2), primaryRegistrationId: f.ids[1] };
  await f.notice(f.ids[1], 'registration', 'provider_accepted'); await f.start([f.ids[0]], other);
  const accepted = await f.service.staffDirectory({ actor });
  assert.deepEqual(accepted.notices, [{ registrationId: f.ids[1], status: 'provider_accepted',historicalUnknown:true }]);
  assert.equal((await f.service.staffHistory({ actor, registrationId: f.ids[1], relatedRegistrationIds: f.ids.slice(0, 2) })).unresolvedConfirmations, true,'current accepted evidence never hides an unfinished canonical dispatch');
  const delivery=await f.service.staffDeliveryState({actor,registrationId:f.ids[1]});assert.equal(delivery.status,'provider_accepted');assert.equal(delivery.ready,false,'an accepted current recipient cannot be sent again while the original batch is checked');
  await f.notice(f.ids[0], 'registration', 'unknown');
  assert.ok((await f.service.staffDirectory({ actor })).notices.some(item => item.registrationId === f.ids[1] && item.status === 'unknown'));
  f.state.indexUnavailable = true;
  await assert.rejects(f.service.staffDirectory({ actor })); assert.equal(f.state.messages.length, 0);
});

test('an unrelated started batch preserves the existing directory status fold for actual accepted and rejected notice rows', async () => {
  const f = fixture(3);
  await f.notice(f.ids[2], 'registration', 'provider_accepted', 'waitlisted');
  await f.notice(f.ids[2], 'promotion', 'rejected');
  const before = await f.service.staffDirectory({ actor });
  const fold = source => {
    const statuses = new Map();
    for (const row of source.notices) if (statuses.get(row.registrationId) !== 'unknown') statuses.set(row.registrationId, row.status);
    return statuses;
  };
  assert.equal(fold(before).get(f.ids[2]), 'rejected');
  await f.start([f.ids[0]], other);
  const after = await f.service.staffDirectory({ actor });
  assert.equal(fold(after).get(f.ids[2]), fold(before).get(f.ids[2]), 'unrelated actual notice ordering retains the existing downstream fold');
  assert.equal(fold(after).get(f.ids[0]), 'unknown'); assert.equal(fold(after).has(f.ids[1]), false);
});

test('formal preview isolates receipt/reminder kinds and uses accepted or uncertain formal alias evidence', async () => {
  for (const status of ['reserved', 'unknown', 'provider_accepted', 'rejected']) {
    const f = fixture(3); f.state.group = { registrationIds: f.ids.slice(0, 2), primaryRegistrationId: f.ids[1] };
    await f.notice(f.ids[1], 'application_received', 'unknown', 'pending_review');
    await f.notice(f.ids[1], 'pre_event_reminder', 'provider_accepted');
    await f.start([f.ids[2]], actor, 'reminder_dispatch');
    let preview = await f.service.staffConfirmationPreview({ actor });
    assert.ok(preview.rows.every(row => row.status === 'not_sent' && row.eligible));
    await f.notice(f.ids[0], 'registration', 'provider_accepted', 'waitlisted');
    await f.notice(f.ids[0], 'promotion', status); preview = await f.service.staffConfirmationPreview({ actor });
    const row = preview.rows.find(item => item.registrationId === f.ids[1]);
    assert.equal(row.status, status === 'reserved' ? 'unknown' : status);
    assert.equal(row.eligible, status === 'rejected'); assert.equal(row.retryRejected, status === 'rejected');
    assert.equal(preview.rows.find(item => item.registrationId === f.ids[2]).eligible, true);
    if (status === 'provider_accepted') {
      await f.start([f.ids[0]], other);
      assert.equal((await f.service.staffDeliveryState({ actor, registrationId: f.ids[1] })).status, 'provider_accepted', 'accepted provider evidence stays accepted, never claims delivery');
    }
  }
});

test('read-only formal operation lookup binds original actor and dispatch action and returns complete original row order without provider/source reads', async () => {
  const f = fixture(2), op = await f.start([...f.ids].reverse());
  const baseline = { provider: f.state.providerReads, facts: f.state.factReads, source: f.state.previewReads, index: f.state.indexReads, record: f.state.recordReads };
  const before = f.objects.calls.length, unknown = await f.service.confirmationOperation({ actor, operationId: op });
  assert.equal(unknown.kind, 'registration'); assert.equal(unknown.status, 'unknown'); assert.equal(unknown.checkedAt, new Date(f.state.now).toISOString());
  assert.deepEqual(unknown.results, [...f.ids].reverse().map(registrationId => ({ registrationId, status: 'unknown' })));
  assert.ok(f.objects.calls.slice(before).every(call => call.operation === 'get'));
  await f.notice(f.ids[1], 'registration', 'provider_accepted');
  assert.deepEqual((await f.service.confirmationOperation({ actor, operationId: op })).results, unknown.results, 'latest accepted notice cannot finish an original started operation');
  const results = [{ registrationId: f.ids[1], status: 'provider_accepted' }, { registrationId: f.ids[0], status: 'unavailable' }];
  await f.append('dispatch_completed', { operationId: op, results });
  f.state.now += 1000; const found = await f.service.confirmationOperation({ actor, operationId: op });
  assert.deepEqual(found.results, results); assert.equal(found.status, 'partial'); assert.equal(found.checkedAt, new Date(f.state.now).toISOString());
  assert.deepEqual(Object.keys(found).sort(), ['checkedAt', 'kind', 'operationId', 'outcome', 'results', 'revision', 'status']);
  await assert.rejects(f.service.confirmationOperation({ actor: other, operationId: op }), error => error.code === 'CONFIRMATION_NOT_FOUND');
  const reminder = await f.start([f.ids[0]], actor, 'reminder_dispatch');
  const settings = operationId(); await f.append('settings', { operationId: settings, requestHash: 'e'.repeat(64), enabled: true });
  for (const missing of [reminder, settings, operationId()]) await assert.rejects(f.service.confirmationOperation({ actor, operationId: missing }), error => error.code === 'CONFIRMATION_NOT_FOUND');
  assert.deepEqual({ provider: f.state.providerReads, facts: f.state.factReads, source: f.state.previewReads, index: f.state.indexReads, record: f.state.recordReads }, baseline);
  assert.equal(f.state.messages.length, 0);
  const afterFixture = f.objects.calls.length; await f.service.confirmationOperation({ actor, operationId: op });
  assert.ok(f.objects.calls.slice(afterFixture).every(call => call.operation === 'get'));
});

test('formal operation lookup returns all 100 original rows and stored result statuses without truncation or later-state inference', async () => {
  const f = fixture(100), op = await f.start(f.ids), statuses = ['provider_accepted', 'rejected', 'unknown', 'disabled', 'not_configured',
    'not_applicable', 'not_public', 'withdrawn', 'unavailable', 'not_attempted'];
  const pending = await f.service.confirmationOperation({ actor, operationId: op }); assert.equal(pending.results.length, 100);
  const results = f.ids.map((registrationId, i) => ({ registrationId, status: statuses[i % statuses.length] }));
  await f.append('dispatch_completed', { operationId: op, results });
  const before = f.objects.calls.length, found = await f.service.confirmationOperation({ actor, operationId: op });
  assert.deepEqual(found.results, results); assert.equal(found.status, 'partial');
  assert.ok(f.objects.calls.slice(before).every(call => call.operation === 'get')); assert.equal(f.state.messages.length, 0);
});

test('formal preview and operation lookup reject roles and malformed bounds before private reads', async () => {
  const f = fixture(), reviewer = { id: 'synthetic-reviewer', roles: ['reviewer'] };
  for (const method of ['staffConfirmationPreview', 'confirmationOperation']) {
    await assert.rejects(f.service[method]({ actor: reviewer, operationId: operationId() }), error => error.code === 'FORBIDDEN');
  }
  for (const input of [{ registrationIds: [] }, { registrationIds: Array(101).fill(f.ids[0]) }, { registrationIds: [f.ids[0], f.ids[0]] }, { cursor: 'bad cursor' }]) {
    await assert.rejects(f.service.staffConfirmationPreview({ actor, ...input }), error => error.code === 'INVALID_REQUEST');
  }
  await assert.rejects(f.service.confirmationOperation({ actor, operationId: 'invalid' }), error => error.code === 'INVALID_REQUEST');
  assert.equal(f.objects.calls.length, 0); assert.equal(f.state.previewReads, 0); assert.equal(f.state.providerReads, 0);
});

test('named preview matches actual formal text while original dispatch body hash and old response stay unchanged', async () => {
  const f = fixture(), preview = await f.service.staffConfirmationPreview({ actor }), op = operationId();
  const command = { actor, expectedRevision: preview.revision, operationId: op, registrationIds: f.ids, retryRejected: false };
  const result = await f.service.dispatch(command);
  assert.deepEqual(Object.keys(result).sort(), ['operationId', 'outcome', 'results', 'revision', 'status']);
  assert.equal(result.results[0].status, 'provider_accepted'); assert.equal(f.state.messages.length, 1);
  const message = f.state.messages[0], record = f.records.get(f.ids[0]);
  const expected = preview.message.text.replace('[称呼]', record.fields.name).replace('[登记编号]', f.ids[0]).replace('[私人参会页链接]', message.templateVariables.invitation_text.match(/https:\/\/artdico.host\/registration\/confirmation\/#r=\S+/u)[0]);
  assert.equal(message.subject, preview.message.subject); assert.equal(message.text, expected);
  const saved = await f.repo.read(), operation = saved.value.operations.find(item => item.operationId === op);
  assert.equal(operation.requestHash, confirmationRequestHash({ actorId: actor.id, registrationIds: f.ids, retryRejected: false }));
  assert.equal((await f.service.dispatch(command)).outcome, 'replayed'); assert.equal(f.state.messages.length, 1);
});
