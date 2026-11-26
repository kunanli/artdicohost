import test from 'node:test';
import assert from 'node:assert/strict';
import { publishApprovedAgenda } from '../scripts/publish-approved-agenda.mjs';
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
    publicConsent: true, internalNotes: privateNote }, { id: 'synthetic-panelist', name: '合成参与者', company: '合成机构',
    status: 'confirmed', publicConsent: true }];
  initial.sessions = [
    row('session-arrival-c', 'C', '09:30', '10:00'),
    { ...row('session-ggj-talk-a', 'A', '10:15', '11:00'), guestId: 'synthetic-guest',
      participants: [{ guestId: 'synthetic-panelist', roles: ['panelist'] }] },
    row('session-free-discussion-b', 'B', '17:05', '17:10'),
    row('session-ecosystem-c', 'C', '17:00', '17:45'),
    { ...row('session-private-b', 'B', '11:30', '12:00'), status: 'draft' },
  ];
  initial.showcases = [{ id: 'synthetic-showcase', title: '合成作品', teamName: '合成团队', status: 'confirmed', publicConsent: true,
    participationForms: ['share'], sessionId: options.showcaseSession ?? 'session-arrival-c' }];
  const checked = validateContent(initial);
  assert.equal(checked.valid, true, JSON.stringify(checked.errors));
  const attendance = { schemaVersion: 1, sourceRevision: 12, confirmedGuestIds: ['synthetic-guest'] };
  let published = { revision: options.revision ?? 129, publishedAt: '2026-11-24T05:29:55.000Z',
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
        published = { revision: draft.revision, publishedAt: '2026-11-26T05:00:00.000Z',
          content: toPublicContent(draft.content, { guestAttendance: attendance }) };
        if (options.losePublishResponse) throw new Error(privateNote);
        return reply({ published });
      case 'POST /api/admin/logout': return reply({ ok: true });
      default: assert.fail('Unexpected request ' + operation);
    }
  };
  return { calls, initial: checked.value, writeCount, fetchFn, get draft() { return draft; }, get published() { return published; },
    run: () => publishApprovedAgenda({ env, fetchFn }) };
}

test('publishes the approved three-zone schedule and preserves draft metadata and unrelated public data', async () => {
  const f = fixture(), prior = f.published;
  assert.deepEqual(await f.run(), { ok: true, status: 'published', revision: 130, draftWrites: 1, publishWrites: 1 });
  assert.deepEqual(f.calls, ['GET /api/public/content', 'POST /api/admin/login', 'GET /api/admin/content', 'PUT /api/admin/content',
    'GET /api/admin/content', 'POST /api/admin/content/publish', 'GET /api/public/content', 'POST /api/admin/logout']);
  const { sessions, ...otherContent } = f.published.content;
  const { sessions: oldSessions, ...oldContent } = prior.content;
  assert.deepEqual(otherContent, oldContent);
  assert.deepEqual(sessions.map(({ id, zone, start, end, title, format = 'other' }) =>
    ({ id, zone, start, end, title, format })), approvedMeetupAgenda);
  for (const id of ['session-free-discussion-b', 'session-ecosystem-c', 'session-private-b']) {
    assert.deepEqual(f.draft.content.sessions.find(row => row.id === id),
      { ...f.initial.sessions.find(row => row.id === id), status: 'draft' });
  }
  assert.equal(otherContent.showcases[0].sessionId, 'session-arrival-c');
  assert.equal(f.draft.content.sessions.find(row => row.id === 'session-ggj-talk-a').guestId, 'synthetic-guest');
  assert.equal(f.draft.content.sessions.find(row => row.id === 'session-ggj-talk-a').internalNotes, privateNote);
  assert.deepEqual(sessions.find(row => row.id === 'session-ggj-talk-a').participants,
    oldSessions.find(row => row.id === 'session-ggj-talk-a').participants);
  f.calls.length = 0;
  assert.deepEqual(await f.run(), { ok: true, status: 'already_published', revision: 130, draftWrites: 0, publishWrites: 0 });
  assert.deepEqual(f.calls, ['GET /api/public/content']);
});

test('detects moved baselines, unexpected sessions and unrelated draft changes before any business write', async () => {
  for (const [options, failure] of [
    [{ revision: 130 }, 'PUBLIC_BASELINE_CHANGED'],
    [{ changeDraft: value => { value.event.title = '另一项尚未发布的修改'; } }, 'UNRELATED_PUBLIC_CHANGES'],
    [{ changeDraft: value => { value.sessions.find(row => row.id === 'session-ggj-talk-a').guestId = ''; } }, 'UNRELATED_PUBLIC_CHANGES'],
    [{ changeDraft: value => { value.sessions.find(row => row.id === 'session-ggj-talk-a').participants = []; } }, 'UNRELATED_PUBLIC_CHANGES'],
    [{ showcaseSession: 'session-ecosystem-c' }, 'UNRELATED_PUBLIC_CHANGES'],
    [{ changeDraft: value => { value.sessions.find(row => row.id === 'session-ecosystem-c').id = 'session-other-c'; } }, 'UNKNOWN_AGENDA_SESSION'],
  ]) {
    const f = fixture(options);
    const result = await f.run();
    assert.equal(result.ok, false);
    assert.equal(result.failure, failure);
    assert.equal(f.writeCount(), 0);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(privateNote, 'u'));
  }
  const f = fixture();
  assert.equal((await publishApprovedAgenda({ env: { ...env, GITHUB_REF: 'refs/heads/other' }, fetchFn: f.fetchFn })).failure,
    'INVALID_RELEASE_CONTEXT');
  assert.deepEqual(f.calls, []);
});

test('recovers lost acknowledgments through reads and resumes a saved draft without repeating the save', async () => {
  const lost = fixture({ loseSaveResponse: true, losePublishResponse: true });
  assert.deepEqual(await lost.run(), { ok: true, status: 'published', revision: 130, draftWrites: 1, publishWrites: 1 });
  assert.equal(lost.writeCount(), 2);
  const options = { rejectPublication: true };
  const delayed = fixture(options);
  assert.equal((await delayed.run()).failure, 'PUBLISH_UNCONFIRMED');
  options.rejectPublication = false;
  assert.deepEqual(await delayed.run(), { ok: true, status: 'published', revision: 130, draftWrites: 0, publishWrites: 1 });
});

test('does not repeat a conflicting write or publish if staff attendance changed during save', async () => {
  for (const [options, failure] of [[{ conflict: true }, 'DRAFT_WRITE_UNCONFIRMED'],
    [{ attendanceChanged: true }, 'UNRELATED_PUBLIC_CHANGES']]) {
    const f = fixture(options);
    assert.equal((await f.run()).failure, failure);
    assert.equal(f.writeCount(), 1);
    assert.equal(f.published.revision, 129);
    assert.equal(f.calls.at(-1), 'POST /api/admin/logout');
  }
});
