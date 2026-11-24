import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { orderedSessions, toPublicContent, validateContent } from '../shared/content-schema.mjs';
import { approvedMeetupAgenda, eventConfig } from '../src/config/event.mjs';
import { publicContentEnvelope } from '../src/lib/public-content-refresh.mjs';

const API = 'https://api.artdico.host';
const LOGIN = '/api/admin/login', LOGOUT = '/api/admin/logout', DRAFT = '/api/admin/content';
const PUBLISH = DRAFT + '/publish', PUBLIC = '/api/public/content';
const COOKIE = '__Secure-artdico_staff_session';
const SESSION_COOKIE = /^__Secure-artdico_staff_session=([A-Za-z0-9_-]{43}); Path=\/api\/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=([1-9][0-9]{0,4})$/u;
const BASELINE_REVISION = 128, MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const legacySlots = {
  A: ['arrival', 'opening', 'ggj-talk', 'morning-break', 'speaker-one', 'recognition', 'lunch', 'speaker-two',
    'afternoon-break', 'speaker-three', 'transition', 'student-showcase', 'student-feedback', 'ecosystem', 'closing'],
  B: ['arrival', 'morning-break', 'speaker-one', 'recognition', 'lunch', 'speaker-two', 'afternoon-break',
    'speaker-three', 'transition', 'student-showcase', 'student-feedback', 'ecosystem', 'closing'],
};
const legacyZones = new Map(Object.entries(legacySlots).flatMap(([zone, slots]) =>
  slots.map(slot => [`session-${slot}-${zone.toLowerCase()}`, zone])));
const isAB = row => row.zone === 'A' || row.zone === 'B';
const revision = value => Number.isSafeInteger(value) && value >= 0;
const token = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(value)
  && Buffer.from(value, 'base64url').toString('base64url') === value;
class AgendaPublicationError extends Error {}
function fail(code) { throw new AgendaPublicationError(code); }

function publicRecord(value) {
  if (!publicContentEnvelope(value, { eventId: eventConfig.id })) fail('INVALID_PUBLIC_SNAPSHOT');
  return value;
}

function currentSchedule(content, zone) {
  return orderedSessions(content.sessions.filter(row => row.zone === zone && row.status !== 'draft'), content.sessionOrder)
    .map(({ id, zone, start, end, title, format, status }) => ({ id, zone, start, end, title, format: format ?? 'other', status }));
}

function matchesAgenda(content) {
  return ['A', 'B'].every(zone => isDeepStrictEqual(currentSchedule(content, zone),
    approvedMeetupAgenda.filter(row => row.zone === zone).map(row => ({ ...row, status: 'scheduled' }))));
}

function outsideAgenda({ sessions, guestAttendance, ...content }) {
  return { ...content, sessions: sessions.filter(row => !isAB(row)), ...(guestAttendance ? {
    guestAttendance: { schemaVersion: guestAttendance.schemaVersion, confirmedGuestIds: guestAttendance.confirmedGuestIds },
  } : {}) };
}

const speakers = row => [row?.guestId ?? '', row?.speakerName ?? '', row?.speakerStatus ?? 'pending', row?.participants ?? []];

function publicProjection(content, state, baseline) {
  const preview = state.attendancePreview;
  if (preview?.status !== 'ready' || preview.contentRevision !== state.draft.revision
    || !revision(preview.guestAttendance?.sourceRevision)) fail('ATTENDANCE_UNAVAILABLE');
  let projected;
  try { projected = toPublicContent(content, { guestAttendance: preview.guestAttendance }); }
  catch { fail('INVALID_PUBLIC_PROJECTION'); }
  if (!isDeepStrictEqual(outsideAgenda(projected), outsideAgenda(baseline.content))) fail('UNRELATED_PUBLIC_CHANGES');
  const before = new Map(baseline.content.sessions.map(row => [row.id, row]));
  if (projected.sessions.some(row => isAB(row) && !isDeepStrictEqual(speakers(row), speakers(before.get(row.id))))) {
    fail('UNRELATED_PUBLIC_CHANGES');
  }
  if (!matchesAgenda(projected)) fail('INVALID_APPROVED_AGENDA');
  return projected;
}

function nextDraft(content, baseline) {
  const approved = new Map(approvedMeetupAgenda.map(row => [row.id, row]));
  if (approved.size !== 22 || approvedMeetupAgenda.length !== 22
    || approvedMeetupAgenda.filter(row => row.zone === 'A').length !== 13
    || approvedMeetupAgenda.some(row => !isAB(row) || !/^session-[a-z0-9-]+$/u.test(row.id))) fail('INVALID_APPROVED_AGENDA');
  const old = new Map(content.sessions.map(row => [row.id, row]));
  for (const row of [...content.sessions, ...baseline.content.sessions]) {
    const target = approved.get(row.id);
    if (target && target.zone !== row.zone || isAB(row) && row.status !== 'draft' && !target && legacyZones.get(row.id) !== row.zone) {
      fail('UNKNOWN_AB_SESSION');
    }
  }
  const replacement = approvedMeetupAgenda.map(row => ({
    ...(old.get(row.id) ?? { guestId: '', speakerName: '', speakerStatus: 'pending', internalNotes: '' }), ...row, status: 'scheduled',
  }));
  const retained = content.sessions.filter(row => !approved.has(row.id))
    .map(row => isAB(row) && row.status !== 'draft' ? { ...row, status: 'draft' } : row);
  const next = { ...content, sessions: [...retained, ...replacement] };
  const checked = validateContent(next);
  if (!checked.valid || !isDeepStrictEqual(checked.value, next)) fail('INVALID_DRAFT_CHANGE');
  return next;
}

async function readResponse(response, url) {
  if (response?.status !== 200 || response.redirected || response.url && response.url !== url
    || !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(response.headers.get('content-type') ?? '')
    || !/(?:^|,)\s*no-store\s*(?:,|$)/iu.test(response.headers.get('cache-control') ?? '')
    || ![null, 'identity'].includes(response.headers.get('content-encoding')) || !response.body) {
    await response?.body?.cancel();
    throw new Error('Unexpected response');
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) throw new Error('Response too large');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes)));
}

/** Apply the checked A/B schedule once through the existing content API. */
export async function publishApprovedAbAgenda({ env = process.env, fetchFn = fetch } = {}) {
  const output = { ok: false, revision: null, draftWrites: 0, publishWrites: 0 };
  let session, failure = 'INVALID_RELEASE_CONTEXT';
  async function request(path, method = 'GET', body) {
    const url = API + path, authenticated = path !== PUBLIC && path !== LOGIN;
    const response = await fetchFn(url, {
      method, redirect: 'error', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: 'application/json', 'Accept-Encoding': 'identity', ...(path === PUBLIC ? {} : { Origin: API }),
        ...(authenticated ? { Cookie: session.cookie, ...(method === 'GET' ? {} : { 'x-csrf-token': session.csrf }) } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json; charset=utf-8' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await readResponse(response, url);
    if (path !== LOGIN && path !== LOGOUT && response.headers.has('set-cookie')) throw new Error('Unexpected cookie');
    return { data, headers: response.headers };
  }
  async function readDraft(baseline) {
    const { data } = await request(DRAFT);
    const checked = validateContent(data?.draft?.content);
    if (!revision(data?.draft?.revision) || data.draft.revision < baseline.revision || !checked.valid
      || !isDeepStrictEqual(checked.value, data.draft.content) || !isDeepStrictEqual(data.published, baseline)) fail('DRAFT_OR_PUBLICATION_CHANGED');
    return data;
  }
  try {
    if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== 'kunanli/artdicohost'
      || env.GITHUB_REF !== 'refs/heads/main' || env.GITHUB_EVENT_NAME !== 'push'
      || !/^[a-f0-9]{40}$/u.test(env.GITHUB_SHA ?? '') || typeof fetchFn !== 'function') fail(failure);
    failure = 'PUBLIC_READ_UNAVAILABLE';
    const baseline = publicRecord((await request(PUBLIC)).data);
    output.revision = baseline.revision;
    if (matchesAgenda(baseline.content)) return { ...output, ok: true, status: 'already_published' };
    if (baseline.revision !== BASELINE_REVISION) fail('PUBLIC_BASELINE_CHANGED');
    failure = 'AUTHENTICATION_UNAVAILABLE';
    const username = env.ARTDICO_ADMIN_USERNAME, password = env.ARTDICO_ADMIN_PASSWORD;
    if (typeof username !== 'string' || !username.trim() || username.length > 320 || /[\u0000-\u001f\u007f]/u.test(username)
      || typeof password !== 'string' || Buffer.byteLength(password) < 12 || Buffer.byteLength(password) > 1024) fail(failure);
    const { data: login, headers } = await request(LOGIN, 'POST', { username, password });
    const cookies = headers.getSetCookie();
    const cookieValue = cookies.length === 1 && SESSION_COOKIE.exec(cookies[0]);
    if (!cookieValue || !token(cookieValue[1]) || Number(cookieValue[2]) > 86400 || !token(login?.csrfToken)) fail(failure);
    session = { cookie: COOKIE + '=' + cookieValue[1], csrf: login.csrfToken };
    const roles = login.user?.roles;
    if (!Array.isArray(roles) || !['editor', 'publisher'].every(role => roles.includes(role))) fail('STAFF_ROLE_UNAVAILABLE');

    failure = 'DRAFT_READ_UNAVAILABLE';
    let state = await readDraft(baseline);
    const next = nextDraft(state.draft.content, baseline);
    publicProjection(next, state, baseline);
    if (!isDeepStrictEqual(state.draft.content, next)) {
      const expectedRevision = state.draft.revision;
      failure = 'DRAFT_WRITE_UNCONFIRMED';
      output.draftWrites++;
      try { await request(DRAFT, 'PUT', { expectedRevision, content: next }); } catch { /* Verify via GET below. */ }
      state = await readDraft(baseline);
      if (state.draft.revision !== expectedRevision + 1 || !isDeepStrictEqual(state.draft.content, next)) fail(failure);
    }

    const projected = publicProjection(state.draft.content, state, baseline);
    failure = 'PUBLISH_UNCONFIRMED';
    output.publishWrites++;
    try { await request(PUBLISH, 'POST', { expectedRevision: state.draft.revision,
      expectedContactsRevision: state.attendancePreview.guestAttendance.sourceRevision }); } catch { /* Verify via GET below. */ }
    const live = publicRecord((await request(PUBLIC)).data);
    if (live.revision !== state.draft.revision || !isDeepStrictEqual(live.content, projected)) fail(failure);
    output.revision = live.revision;
    output.ok = true;
    output.status = 'published';
    failure = null;
  } catch (error) {
    if (error instanceof AgendaPublicationError) failure = error.message;
  } finally {
    if (session) {
      try { if ((await request(LOGOUT, 'POST', {})).data?.ok !== true) throw new Error('Logout failed'); }
      catch { failure ??= 'LOGOUT_UNAVAILABLE'; }
    }
  }
  return failure ? { ...output, ok: false, failure } : output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = process.argv.length === 2 ? await publishApprovedAbAgenda() : { ok: false, failure: 'INVALID_RELEASE_CONTEXT' };
  console.log('Approved A/B schedule publication ' + JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}
