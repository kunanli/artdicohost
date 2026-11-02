import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createConfirmationRepository } from '../functions/registration-confirmation/repository.mjs';
import { createRegistrationConfirmationService } from '../functions/registration-confirmation/service.mjs';
import { createRegistrationConfirmationApi } from '../functions/registration-confirmation/handler.mjs';
import { CloudContentError } from '../functions/cloud-content/errors.mjs';

const EVENT = 'synthetic-mail-repair', ID = 'a'.repeat(43), ALIAS = 'b'.repeat(43);
const actor = { id: 'synthetic-manager', roles: ['superadmin'] }, op = () => randomBytes(32).toString('base64url');
const event = { id: EVENT, title: '合成活動', date: { value: '2026-12-05' }, time: { label: '10:00–18:00', start: '09:30', timezone: 'Asia/Shanghai' }, venue: { address: '合成地址' } };
const clone = value => structuredClone(value);
function fixture() {
  const state = { value: null, version: 0, now: Date.parse('2026-10-21T00:00:00Z'), ticks: 0, identity: 'a'.repeat(64),
    ready: true, permission: true, facts: 'synthetic-v1', messages: [], result: { status: 'rejected', diagnostic: { code: 'PROVIDER_REJECTED', transportStarted: true, httpStatus: 400 } },
    aliases: [ID], primary: ID, admission: { status: 'confirmed', kind: 'attendee', revision: 1 }, onCommit: null, beforeTransport: null };
  const records = Object.fromEntries([ID, ALIAS].map(id => [id, { id, eventId: EVENT, accessRevision: 0,
    fields: { name: '合成人員', email: id[0] + '@example.invalid' }, provenance: { kind: 'public' } }]));
  const cursor = () => ({ version: state.version, position: state.version, hash: state.version ? 'synthetic' : null });
  const journal = { async read() { return { value: clone(state.value), cursor: cursor() }; }, async commit(expected, value) {
    if (expected.version !== state.version) throw new CloudContentError('WRITE_CONFLICT', 'Synthetic conflict', 409);
    state.value = clone(value); state.version++;
    const ack = { value: clone(value), cursor: cursor() };
    await state.onCommit?.(value.audit.at(-1));
    return ack;
  } };
  const registrationService = { repository: { async readIndex() { return { value: { entries: [ID, ALIAS].map(id => ({ id, committedAt: new Date(state.now).toISOString() })) } }; }, async readRecord(entry) { if (state.failRead) throw new Error('PRIVATE-GUARD'); return clone(records[entry.id]); } },
    async getAdmissionStatus() { return clone(state.admission); } };
  const provider = { readiness: async () => ({ ready: state.ready, enabled: true, reason: state.ready ? 'CONFIGURED_PROVIDER_NOT_DELIVERY_PROOF' : 'EMAIL_CONFIGURATION_INVALID',
    missing: [], invalid: state.ready ? [] : ['EMAIL_FROM_ADDRESS', 'PRIVATE-SECRET'] }), configurationIdentity: async () => state.identity,
    async send(input) {
      await state.beforeTransport?.(input);
      if (input.expectedConfigurationIdentity && input.expectedConfigurationIdentity !== state.identity) return { status: 'rejected', diagnostic: { code: 'EMAIL_CONFIGURATION_CHANGED', transportStarted: false } };
      if (!await input.canStart()) return { status: 'rejected', diagnostic: { code: 'DELIVERY_GUARD_BLOCKED', transportStarted: false } };
      state.messages.push(input); return clone(state.result);
    } };
  const make = extra => createRegistrationConfirmationService({ registrationService, journalFor: () => journal, event,
    tokenSecret: 'SYNTHETIC-MAIL-RECOVERY-SECRET-ONLY-1234567890', emailProvider: provider,
    clock: () => state.now, monotonicNow: () => state.ticks, personDeliveryPermission: async () => ({ eligible: state.permission, reason: 'CONTACT_DECLINED' }),
    deliveryAliases: async () => ({ registrationIds: clone(state.aliases), primaryRegistrationId: state.primary }),
    eventFactsReadiness: async () => ({ ready: state.facts !== null, key: state.facts, revision: 1 }), ...extra });
  const repository = createConfirmationRepository({ journal, eventId: EVENT, clock: () => state.now });
  const service = make();
  const summary = () => service.staffDeliveryState({ actor, registrationId: state.primary });
  const command = async (recover = true) => { const current = await summary(); return { actor, expectedRevision: current.revision, operationId: op(), registrationIds: [state.primary],
    expectedAccessRevisions: { [state.primary]: current.accessRevision }, retryRejected: true, ...(recover ? { recoverRejected: true } : {}) }; };
  const seed = async (count = 5) => { for (let i = 0; i < count; i++) await service.dispatch(await command(false)); };
  return { state, records, journal, repository, provider, service, make, summary, command, seed };
}
const rejected = error => error.code === 'REVISION_CONFLICT';

test('five ordinary rejections keep their cap and an explicit manual resend reserves attempt six atomically', async () => {
  const f = fixture(); await f.seed();
  const capped = await f.summary(); assert.equal(capped.reason, 'RETRY_LIMIT'); assert.equal(capped.ready, false); assert.equal(capped.canRecover, true);
  assert.deepEqual(capped.diagnostic, { code: 'PROVIDER_REJECTED', transportStarted: true, httpStatus: 400 });
  await f.service.dispatch(await f.command(false)); assert.equal(f.state.messages.length, 5);
  f.state.result = { status: 'provider_accepted' }; const input = await f.command(), before = f.state.value.audit.length;
  const result = await f.service.dispatch(input); assert.equal(result.results[0].status, 'provider_accepted'); assert.equal(f.state.messages.length, 6);
  assert.equal(f.state.messages.at(-1).expectedConfigurationIdentity, f.state.identity);
  assert.deepEqual(f.state.value.audit.slice(before).map(item => item.action), ['recovery_reserved', 'result', 'dispatch_completed']);
  const stored = await f.repository.read(); assert.equal(stored.value.notices[0].attempt, 6); assert.equal(stored.value.notices[0].diagnostic, undefined);
  assert.equal((await f.summary()).reason, 'ALREADY_ACCEPTED');
  const replay = await f.make().dispatch(input); assert.equal(replay.outcome, 'replayed'); assert.deepEqual(replay.results, result.results);
  const checked = await f.service.confirmationOperation({ actor, operationId: input.operationId }); assert.deepEqual(checked.results, result.results);
  assert.equal(f.state.messages.length, 6);
  assert.doesNotMatch(JSON.stringify([result, replay, checked, await f.summary(), await f.service.staffHistory({ actor, registrationId: ID }), await f.service.staffDirectory({ actor })]), /configurationIdentity|recipientDigest|requestHash|synthetic-v1|PRIVATE-SECRET/u);
});

test('each known rejected manual resend allows a fresh explicit operation while ordinary sends remain capped', async () => {
  const f = fixture(); await f.seed(); const sixth = await f.command(); await f.service.dispatch(sixth);
  assert.equal((await f.summary()).reason, 'RETRY_LIMIT'); assert.equal((await f.summary()).canRecover, true); assert.equal((await f.summary()).ready, false);
  const ordinaryReservations = f.state.value.audit.filter(item => item.action === 'reserve').length;
  await f.service.dispatch(await f.command(false));
  await f.service.notifyApproved({ registrationIds: [ID] });
  await f.make().dispatch(sixth);
  assert.equal(f.state.messages.length, 6); assert.equal(f.state.value.notices[0].attempt, 6);
  for (const enabled of [false, true]) await f.service.setSettings({ actor, expectedRevision: f.state.version, operationId: op(), enabled });
  f.state.identity = 'b'.repeat(64);
  await assert.rejects(f.make().dispatch({ ...sixth, operationId: op() }), rejected);
  assert.equal(f.state.messages.length, 6);
  const seventh = await f.command(); f.state.result = { status: 'provider_accepted' };
  const result = await f.make().dispatch(seventh); assert.equal(result.results[0].status, 'provider_accepted');
  assert.equal(f.state.messages.length, 7); assert.equal(f.state.value.notices[0].attempt, 7);
  assert.equal(f.state.messages.at(-1).expectedConfigurationIdentity, f.state.identity);
  await f.service.dispatch(seventh); await f.service.dispatch(sixth); assert.equal(f.state.messages.length, 7);
  assert.equal(f.state.value.audit.filter(item => item.action === 'reserve').length, ordinaryReservations);
  assert.equal(f.state.value.audit.filter(item => item.action === 'recovery_reserved').length, 2);
  assert.equal((await f.summary()).reason, 'ALREADY_ACCEPTED'); assert.equal((await f.summary()).canRecover, undefined);
});

test('parallel recovery commands and same-operation replay never send twice', async () => {
  const f = fixture(); await f.seed(); const input = await f.command();
  const results = await Promise.allSettled([f.service.dispatch(input), f.make().dispatch({ ...input, operationId: op() })]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(results.find(item => item.status === 'rejected').reason.code, 'REVISION_CONFLICT');
  await f.service.dispatch(input); assert.equal(f.state.messages.length, 6);
  assert.equal(f.state.value.audit.filter(item => item.action === 'recovery_reserved').length, 1);
  await assert.rejects(f.service.dispatch({ ...input, actor: { id: 'other-manager', roles: ['superadmin'] } }), rejected);
  await assert.rejects(f.service.dispatch({ ...input, recoverRejected: false }), rejected);
});

test('lost reservation, result or completion ACK is read through the original operation without resend', async () => {
  for (const action of ['recovery_reserved', 'result', 'dispatch_completed']) {
    const f = fixture(); await f.seed(); const input = await f.command();
    let lost = false; f.state.onCommit = audit => { if (!lost && audit.action === action) { lost = true; throw new Error('PRIVATE-LOST-ACK'); } };
    const first = await Promise.allSettled([f.service.dispatch(input)]); assert.equal(lost, true);
    const count = f.state.messages.length;
    const checked = await f.make().confirmationOperation({ actor, operationId: input.operationId });
    const replay = await f.make().dispatch(input); assert.deepEqual(replay.results, checked.results); assert.equal(f.state.messages.length, count);
    if (action === 'recovery_reserved') { assert.equal(count, 5); assert.equal(checked.status, 'unknown'); assert.equal(first[0].status, 'rejected'); }
    if (action === 'result') { assert.equal(count, 6); assert.equal(checked.results[0].status, 'unknown'); }
    if (action === 'dispatch_completed') assert.equal(first[0].status, 'rejected');
  }
});

test('current recipient scope, admission, permission, readiness and explicit request fields gate recovery before reservation', async () => {
  for (const mutation of [f => { f.records[ID].accessRevision++; }, f => { f.state.permission = false; }, f => { f.state.ready = false; },
    f => { f.state.facts = null; }, f => { f.state.identity = null; }, f => { f.state.admission.status = 'withdrawn'; }]) {
    const f = fixture(); await f.seed(); const input = await f.command(); mutation(f);
    await assert.rejects(f.service.dispatch(input), rejected); assert.equal(f.state.messages.length, 5);
    assert.equal(f.state.value.audit.some(item => item.action === 'recovery_reserved'), false);
    assert.notEqual((await f.summary()).canRecover, true);
  }
  const f = fixture(); await f.seed(); const input = await f.command();
  await assert.rejects(f.service.dispatch({ ...input, expectedRevision: input.expectedRevision - 1 }), rejected);
  await assert.rejects(f.service.dispatch({ ...input, actor: { id: 'review-only', roles: ['reviewer'] } }), error => error.code === 'FORBIDDEN');
  for (const patch of [{ retryRejected: false }, { expectedAccessRevisions: undefined }, { registrationIds: [ID, ALIAS], expectedAccessRevisions: { [ID]: 0, [ALIAS]: 0 } }])
    await assert.rejects(f.service.dispatch({ ...input, ...patch }), error => error.code === 'INVALID_REQUEST');
});

test('changes after atomic reservation block the provider and persist safe no-start evidence without refund', async () => {
  for (const mutation of [f => { f.records[ID].fields.email = 'corrected@example.invalid'; }, f => { f.records[ID].accessRevision++; },
    f => { f.state.permission = false; }, f => { f.state.admission.revision++; }, f => { f.state.facts = 'synthetic-v2'; },
    f => { f.state.identity = 'b'.repeat(64); }, f => { f.state.ticks = 30_000; }]) {
    const f = fixture(); await f.seed(); const input = await f.command();
    f.state.onCommit = audit => { if (audit.action === 'recovery_reserved') mutation(f); };
    await f.service.dispatch(input); assert.equal(f.state.messages.length, 5);
    const notice = f.state.value.notices.find(item => item.registrationId === ID); assert.equal(notice.attempt, 6); assert.equal(notice.status, 'rejected');
    assert.equal(notice.diagnostic.transportStarted, false);
    assert.ok(['DELIVERY_GUARD_BLOCKED', 'EMAIL_CONFIGURATION_CHANGED', 'DELIVERY_WINDOW_EXPIRED'].includes(notice.diagnostic.code));
  }
});

test('a throwing service pre-send guard is durable known rejection with safe diagnostic', async () => {
  const f = fixture(); await f.seed(); const input = await f.command();
  f.state.onCommit = audit => { if (audit.action === 'recovery_reserved') f.state.failRead = true; };
  await f.service.dispatch(input); assert.equal(f.state.messages.length, 5);
  assert.equal(f.state.value.notices[0].status, 'rejected'); assert.deepEqual(f.state.value.notices[0].diagnostic, { code: 'DELIVERY_GUARD_UNAVAILABLE', transportStarted: false });
  assert.doesNotMatch(JSON.stringify(f.state.value), /PRIVATE-GUARD/u);
});

async function addNotice(f, { registrationId = ALIAS, kind = 'registration', admissionStatus = 'confirmed', status = 'rejected' } = {}) {
  let current = await f.repository.read();
  current = await f.repository.append(current, 'reserve', { registrationId, kind, admissionStatus, admissionRevision: 1, retryRejected: false }, actor.id);
  const notice = current.value.notices.find(item => item.registrationId === registrationId && item.kind === kind);
  if (status !== 'reserved') await f.repository.append(current, 'result', { noticeId: notice.id, status }, actor.id);
}

test('related aliases and promotion notices permit repeated explicit sends after known rejection and retain the strongest accepted block', async () => {
  const f = fixture(); await f.seed(4); await addNotice(f); f.state.aliases = [ID, ALIAS];
  assert.equal((await f.summary()).canRecover, true); await f.service.dispatch(await f.command());
  const audit = f.state.value.audit.find(item => item.action === 'recovery_reserved'); assert.deepEqual(audit.details.relatedRegistrationIds, [ID, ALIAS]);
  f.state.primary = ALIAS; assert.equal((await f.summary()).reason, 'RETRY_LIMIT'); assert.equal((await f.summary()).canRecover, true);
  f.state.result = { status: 'provider_accepted' }; await f.service.dispatch(await f.command());
  assert.equal(f.state.messages.length, 6); assert.equal(f.state.value.notices.find(item => item.registrationId === ALIAS).attempt, 2);
  f.state.primary = ID; assert.equal((await f.summary()).reason, 'ALREADY_ACCEPTED'); assert.equal((await f.summary()).canRecover, undefined);
  const promotion = fixture(); await addNotice(promotion, { registrationId: ID, admissionStatus: 'waitlisted', status: 'provider_accepted' }); await promotion.seed();
  assert.equal(promotion.state.value.notices.find(item => item.admissionStatus === 'confirmed').kind, 'promotion');
  await promotion.service.dispatch(await promotion.command());
  assert.equal(promotion.state.value.notices.find(item => item.kind === 'promotion').attempt, 6);
  assert.equal((await promotion.summary()).reason, 'RETRY_LIMIT'); assert.equal((await promotion.summary()).canRecover, true);
  promotion.state.result = { status: 'provider_accepted' }; await promotion.service.dispatch(await promotion.command());
  assert.equal(promotion.state.value.notices.find(item => item.kind === 'promotion').attempt, 7);
  assert.equal((await promotion.summary()).reason, 'ALREADY_ACCEPTED');
});

test('any related accepted, unknown, reserved or unfinished batch blocks recovery, including an older recipient scope', async () => {
  for (const status of ['provider_accepted', 'unknown', 'reserved', 'unfinished']) {
    const f = fixture(); await f.seed();
    if (status === 'unfinished') await f.repository.append(await f.repository.read(), 'dispatch_started', { operationId: op(), requestHash: 'c'.repeat(64), registrationIds: [ALIAS], retryRejected: false }, actor.id);
    else await addNotice(f, { status });
    f.state.aliases = [ID, ALIAS]; f.records[ALIAS].accessRevision = 1;
    assert.notEqual((await f.summary()).canRecover, true); await assert.rejects(f.service.dispatch(await f.command()), rejected);
    assert.equal(f.state.messages.length, 5);
  }
});

test('legacy result events replay; new result ownership and diagnostic/status combinations are strict', async () => {
  const f = fixture(); await addNotice(f, { registrationId: ID }); assert.equal((await f.repository.read()).value.notices[0].status, 'rejected');
  let current = await f.repository.read(); current = await f.repository.append(current, 'reserve', { registrationId: ID, kind: 'registration', admissionStatus: 'confirmed', admissionRevision: 1, retryRejected: true }, actor.id);
  const notice = current.value.notices[0];
  for (const details of [{ noticeId: notice.id, status: 'rejected', attempt: 1 },
    { noticeId: notice.id, status: 'provider_accepted', attempt: 2, diagnostic: { code: 'DELIVERY_GUARD_BLOCKED', transportStarted: false } },
    { noticeId: notice.id, status: 'rejected', attempt: 2, diagnostic: { code: 'DELIVERY_UNKNOWN', transportStarted: true } },
    { noticeId: notice.id, status: 'unknown', attempt: 2, diagnostic: { code: 'DELIVERY_GUARD_BLOCKED', transportStarted: false } },
    { noticeId: notice.id, status: 'rejected', attempt: 2, diagnostic: { code: 'PRIVATE-SECRET', transportStarted: false } }])
    await assert.rejects(f.repository.append(current, 'result', details, actor.id));
  await assert.rejects(f.repository.append(current, 'result', { noticeId: notice.id, status: 'rejected', attempt: 2 }, 'other-manager'));
  assert.equal((await f.repository.read()).value.notices[0].status, 'reserved');
  await f.repository.append(current, 'result', { noticeId: notice.id, status: 'rejected', attempt: 2, diagnostic: { code: 'DELIVERY_GUARD_BLOCKED', transportStarted: false } }, actor.id);
});

test('settings preserve only fixed reason and missing/invalid names; malformed provider diagnostics never escape', async () => {
  const f = fixture(); f.state.ready = false;
  f.provider.readiness = async () => ({ ready: false, reason: 'EMAIL_CONFIGURATION_INVALID', enabled: true, missing: ['EMAILJS_SERVICE_ID', 'PRIVATE-SECRET'], invalid: ['EMAIL_FROM_ADDRESS', 'PRIVATE-SECRET'] });
  const settings = await f.service.settings({ actor }); assert.equal(settings.email.reason, 'EMAIL_CONFIGURATION_INVALID');
  assert.deepEqual(settings.email.missing, ['EMAILJS_SERVICE_ID']); assert.deepEqual(settings.email.invalid, ['EMAIL_FROM_ADDRESS']);
  f.state.ready = true; f.provider.readiness = async () => ({ ready: true });
  f.state.result = { status: 'rejected', diagnostic: { code: 'PROVIDER_REJECTED', transportStarted: true, httpStatus: 400, raw: 'PRIVATE-SECRET' } };
  await f.seed(1); assert.equal((await f.summary()).diagnostic, undefined); assert.doesNotMatch(JSON.stringify(f.state.value), /PRIVATE-SECRET/u);
});

test('single-person HTTP requires exact recovery body, manager, origin and CSRF while bulk/reminder reject the flag', async () => {
  const f = fixture(); await f.seed(); const csrf = 'synthetic-csrf', API = 'https://api.artdico.host';
  let user = actor;
  const handle = createRegistrationConfirmationApi({ service: f.service, auth: { authenticate: async () => ({ user, csrfToken: csrf }) } });
  const request = (path, body, headers = {}) => new Request(API + '/api/admin/registration-confirmation/' + path, { method: 'POST', headers: { origin: API, 'content-type': 'application/json', 'x-csrf-token': csrf, ...headers }, body: JSON.stringify(body) });
  const input = await f.command(), body = { expectedRevision: input.expectedRevision, operationId: input.operationId, retryRejected: true, recoverRejected: true, expectedAccessRevision: 0 };
  for (const extra of [{ expectedAccessRevision: undefined }, { retryRejected: false }, { recoverRejected: 'true' }, { actor }])
    assert.equal((await handle(request('send/' + ID, { ...body, ...extra }))).status, 400);
  for (const path of ['dispatch', 'reminder-dispatch']) for (const recoverRejected of [true, false])
    assert.equal((await handle(request(path, { expectedRevision: input.expectedRevision, operationId: op(), registrationIds: [ID], retryRejected: true, recoverRejected }))).status, 400);
  assert.equal((await handle(request('send/' + ID, body, { origin: 'https://foreign.example.invalid' }))).status, 403);
  assert.equal((await handle(request('send/' + ID, body, { 'x-csrf-token': 'wrong' }))).status, 403);
  user = { id: 'synthetic-reader', roles: ['reviewer'] }; assert.equal((await handle(request('send/' + ID, body))).status, 403); user = actor;
  const result = await handle(request('send/' + ID, body)); assert.equal(result.status, 200); assert.equal(f.state.messages.length, 6);
  const replay = await handle(request('send/' + ID, body)); assert.equal((await replay.json()).outcome, 'replayed'); assert.equal(f.state.messages.length, 6);
});

test('stale ordinary or earlier manual acknowledgements cannot overwrite a newer reservation and replay rejects a forged duplicate operation', async () => {
  const f = fixture(); await f.seed(); const input = await f.command(); let staleRejected = false;
  f.state.onCommit = async audit => {
    if (audit.action !== 'recovery_reserved') return;
    const current = await f.repository.read(), notice = current.value.notices[0];
    for (const details of [{ noticeId: notice.id, status: 'provider_accepted', attempt: 5 }, { noticeId: notice.id, status: 'provider_accepted' }]) {
      await assert.rejects(f.repository.append(current, 'result', details, actor.id)); staleRejected = true;
    }
  };
  await f.service.dispatch(input); assert.equal(staleRejected, true); assert.equal(f.state.value.notices[0].status, 'rejected');
  f.state.onCommit = async audit => {
    if (audit.action !== 'recovery_reserved') return;
    const current = await f.repository.read(), notice = current.value.notices[0];
    await assert.rejects(f.repository.append(current, 'result', { noticeId: notice.id, status: 'provider_accepted', attempt: 6 }, actor.id));
  };
  await f.service.dispatch(await f.command()); assert.equal(f.state.value.notices[0].attempt, 7);
  f.state.onCommit = null;
  const prior = f.state.value.audit.find(item => item.action === 'recovery_reserved'), details = clone(prior.details);
  const forged = clone(f.state.value); forged.revision++;
  forged.audit.push({ ...clone(prior), revision: forged.revision, details });
  Object.assign(forged.notices[0], { status: 'reserved', attempt: 8 }); delete forged.notices[0].diagnostic;
  forged.operations.push({ operationId: details.operationId, requestHash: details.requestHash, actorId: actor.id,
    recipientScopes: { [ID]: { accessRevision: details.accessRevision, recipientDigest: details.recipientDigest } },
    action: 'dispatch', at: prior.at, status: 'started', registrationIds: [ID], retryRejected: true, results: [] });
  f.state.value = forged; f.state.version = forged.revision;
  await assert.rejects(f.repository.read(), error => error.code === 'CONFIRMATION_UNAVAILABLE');
});

test('provider asynchronous configuration window rechecks scope, permission, event facts and configuration before transport', async () => {
  for (const mutate of [f => { f.records[ID].fields.email = 'later@example.invalid'; }, f => { f.records[ID].accessRevision++; },
    f => { f.state.permission = false; }, f => { f.state.admission.status = 'withdrawn'; }, f => { f.state.facts = 'later-facts'; },
    f => { f.state.identity = 'b'.repeat(64); }, f => { f.state.aliases = [ID, ALIAS]; }]) {
    const f = fixture(); await f.seed(); const input = await f.command(); f.state.beforeTransport = () => mutate(f);
    await f.service.dispatch(input); assert.equal(f.state.messages.length, 5); assert.equal(f.state.value.notices[0].attempt, 6);
    assert.equal(f.state.value.notices[0].status, 'rejected'); assert.equal(f.state.value.notices[0].diagnostic.transportStarted, false);
  }
});
