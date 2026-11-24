import test from 'node:test';
import assert from 'node:assert/strict';
import { publishApprovedAbAgenda } from '../scripts/publish-approved-ab-agenda.mjs';
import { createInitialContent } from '../src/config/content.mjs';
import { approvedMeetupAgenda } from '../src/config/event.mjs';
import { toPublicContent, validateContent } from '../shared/content-schema.mjs';

const origin = 'https://api.artdico.host';
const cookie = '__Secure-artdico_staff_session=' + Buffer.alloc(32, 1).toString('base64url');
const csrf = Buffer.alloc(32, 2).toString('base64url');
const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'kunanli/artdicohost', GITHUB_REF: 'refs/heads/main',
  GITHUB_EVENT_NAME: 'push', GITHUB_SHA: 'a'.repeat(40), ARTDICO_ADMIN_USERNAME: 'fixture', ARTDICO_ADMIN_PASSWORD: 'synthetic-fixture-only' };
const privateNote = '合成内部资料不应回传';

function fixture(options = {}) {
  const calls = [];
  const row = (id, zone, start, end) => ({ id, zone, start, end, title: '合成场次', format: 'other', status: 'scheduled',
    guestId: '', speakerName: '', speakerStatus: 'pending', internalNotes: privateNote });
  const initial = createInitialContent();
  initial.sessionOrder = 'manual';
  initial.guests = [{ id: 'synthetic-guest', name: '合成嘉宾', company: '合成机构', ggjRole: '', portraitId: '', status: 'confirmed',
    publicConsent: true, internalNotes: privateNote }];
  initial.sessions = [
    row('session-2000-c', 'C', '14:30', '15:00'),
    { ...row('session-ggj-talk-a', 'A', '10:15', '11:00'), guestId: 'synthetic-guest' },
    row('session-morning-break-b', 'B', '11:00', '11:15'),
    row('session-1000-c', 'C', '12:30', '13:00'),
    { ...row('session-private-b', 'B', '11:30', '12:00'), status: 'draft' },
  ];
  const checked = validateContent(initial);
  assert.equal(checked.valid, true, JSON.stringify(checked.errors));
  const attendance = { schemaVersion: 1, sourceRevision: 12, confirmedGuestIds: ['synthetic-guest'] };
  let published = { revision: options.revision ?? 128, publishedAt: '2026-11-13T08:53:40.455Z',
    content: toPublicContent(checked.value, { guestAttendance: attendance }) };
  let draft = { revision: published.revision, content: structuredClone(checked.value) };
  options.changeDraft?.(draft.content);
  const reply = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
  const writeCount = () => calls.filter(entry => entry === 'PUT /api/admin/content' || entry === 'POST /api/admin/content/publish').length;
  const fetchFn = async (url, request) => {
    const target = new URL(url), headers = new Headers(request.headers);
    assert.equal(target.origin, origin);
    assert.equal(target.search, '');
    assert.equal(request.redirect, 'error');
    assert.equal(request.cache, 'no-store');
    const operation = request.method + ' ' + target.pathname;
    const body = request.body ? JSON.parse(request.body) : null;
    calls.push(operation);
    if (target.pathname.startsWith('/api/admin/')) {
      assert.equal(headers.get('origin'), origin);
      if (operation !== 'POST /api/admin/login') assert.equal(headers.get('cookie'), cookie);
      if (request.method !== 'GET' && operation !== 'POST /api/admin/login') assert.equal(headers.get('x-csrf-token'), csrf);
    }
    switch (operation) {
      case 'GET /api/public/content':
        assert.equal(headers.has('cookie'), false);
        return reply(published);
      case 'POST /api/admin/login':
        assert.equal(headers.has('cookie'), false);
        assert.deepEqual(body, { username: env.ARTDICO_ADMIN_USERNAME, password: env.ARTDICO_ADMIN_PASSWORD });
        return reply({ user: { roles: ['editor', 'publisher'] }, csrfToken: csrf }, 200,
          { 'set-cookie': cookie + '; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=3600' });
      case 'GET /api/admin/content':
        return reply({ draft, published, attendancePreview: { status: 'ready', contentRevision: draft.revision, guestAttendance: attendance } });
      case 'PUT /api/admin/content':
        assert.equal(body.expectedRevision, draft.revision);
        if (options.conflict) return reply({ error: { message: privateNote } }, 409);
        draft = { revision: draft.revision + 1, content: body.content };
        if (options.attendanceChanged) attendance.confirmedGuestIds = [];
        if (options.loseSaveResponse) throw new Error(privateNote);
        return reply({ draft });
      case 'POST /api/admin/content/publish':
        assert.deepEqual(body, { expectedRevision: draft.revision, expectedContactsRevision: attendance.sourceRevision });
        if (options.rejectPublication) return reply({ error: { message: privateNote } }, 503);
        published = { revision: draft.revision, publishedAt: '2026-11-24T05:00:00.000Z',
          content: toPublicContent(draft.content, { guestAttendance: attendance }) };
        if (options.losePublishResponse) throw new Error(privateNote);
        return reply({ published });
      case 'POST /api/admin/logout': return reply({ ok: true });
      default: assert.fail('Unexpected request ' + operation);
    }
  };
  return { calls, initial: checked.value, writeCount, fetchFn, get draft() { return draft; }, get published() { return published; },
    run: () => publishApprovedAbAgenda({ env, fetchFn }) };
}

test('publishes exactly the approved A/B schedule and preserves draft metadata and unrelated public data', async () => {
  const f = fixture(), prior = f.published;
  assert.deepEqual(await f.run(), { ok: true, status: 'published', revision: 129, draftWrites: 1, publishWrites: 1 });
  assert.deepEqual(f.calls, ['GET /api/public/content', 'POST /api/admin/login', 'GET /api/admin/content', 'PUT /api/admin/content',
    'GET /api/admin/content', 'POST /api/admin/content/publish', 'GET /api/public/content', 'POST /api/admin/logout']);
  const { sessions, ...otherContent } = f.published.content;
  const { sessions: oldSessions, ...oldContent } = prior.content;
  assert.deepEqual(otherContent, oldContent);
  assert.deepEqual(sessions.filter(row => row.zone === 'C'), oldSessions.filter(row => row.zone === 'C'));
  assert.deepEqual(sessions.filter(row => row.zone !== 'C').map(({ id, zone, start, end, title, format = 'other' }) =>
    ({ id, zone, start, end, title, format })), approvedMeetupAgenda);
  assert.deepEqual(f.draft.content.sessions.find(row => row.id === 'session-morning-break-b'),
    { ...f.initial.sessions.find(row => row.id === 'session-morning-break-b'), status: 'draft' });
  assert.equal(f.draft.content.sessions.find(row => row.id === 'session-ggj-talk-a').guestId, 'synthetic-guest');
  assert.equal(f.draft.content.sessions.find(row => row.id === 'session-ggj-talk-a').internalNotes, privateNote);
  f.calls.length = 0;
  assert.deepEqual(await f.run(), { ok: true, status: 'already_published', revision: 129, draftWrites: 0, publishWrites: 0 });
  assert.deepEqual(f.calls, ['GET /api/public/content']);
});

test('detects moved baselines, unexpected A/B and unrelated draft changes before any business write', async () => {
  for (const [options, failure] of [
    [{ revision: 129 }, 'PUBLIC_BASELINE_CHANGED'],
    [{ changeDraft: value => { value.event.title = '另一项尚未发布的修改'; } }, 'UNRELATED_PUBLIC_CHANGES'],
    [{ changeDraft: value => { value.sessions.find(row => row.zone === 'A').id = 'session-other-a'; } }, 'UNKNOWN_AB_SESSION'],
  ]) {
    const f = fixture(options);
    const result = await f.run();
    assert.equal(result.ok, false);
    assert.equal(result.failure, failure);
    assert.equal(f.writeCount(), 0);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(privateNote, 'u'));
  }
  const f = fixture();
  assert.equal((await publishApprovedAbAgenda({ env: { ...env, GITHUB_REF: 'refs/heads/other' }, fetchFn: f.fetchFn })).failure,
    'INVALID_RELEASE_CONTEXT');
  assert.deepEqual(f.calls, []);
});

test('recovers lost acknowledgments through reads and resumes a saved draft without repeating the save', async () => {
  const lost = fixture({ loseSaveResponse: true, losePublishResponse: true });
  assert.deepEqual(await lost.run(), { ok: true, status: 'published', revision: 129, draftWrites: 1, publishWrites: 1 });
  assert.equal(lost.writeCount(), 2);
  const options = { rejectPublication: true };
  const delayed = fixture(options);
  assert.equal((await delayed.run()).failure, 'PUBLISH_UNCONFIRMED');
  options.rejectPublication = false;
  assert.deepEqual(await delayed.run(), { ok: true, status: 'published', revision: 129, draftWrites: 0, publishWrites: 1 });
});

test('does not repeat a conflicting write or publish if staff attendance changed during save', async () => {
  for (const [options, failure] of [[{ conflict: true }, 'DRAFT_WRITE_UNCONFIRMED'],
    [{ attendanceChanged: true }, 'UNRELATED_PUBLIC_CHANGES']]) {
    const f = fixture(options);
    assert.equal((await f.run()).failure, failure);
    assert.equal(f.writeCount(), 1);
    assert.equal(f.published.revision, 128);
    assert.equal(f.calls.at(-1), 'POST /api/admin/logout');
  }
});
