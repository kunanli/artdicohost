// Native Chromium over the actual isolated application. Every HTTP request is intercepted.
// No real people, accounts, publication, mail, or external storage are used.
import assert from 'node:assert/strict';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const project = fileURLToPath(new URL('../../', import.meta.url));
const source = resolve(process.env.ARTDICO_SOURCE_DIRECTORY || project);
const dist = resolve(process.env.ARTDICO_DIST_DIRECTORY || resolve(source, 'dist'));
const evidence = resolve(project, '.local-data/browser-evidence/games-publication');
const { peopleRuntimeFixture, PEOPLE_FIXTURE_API: API, PEOPLE_FIXTURE_PUBLIC: SITE } = await import(pathToFileURL(resolve(source, 'tests/helpers/people-runtime-fixture.mjs')));
const { createOssPortraitStore } = await import(pathToFileURL(resolve(source, 'functions/cloud-content/portrait-store.mjs')));
const { validateContent, toPublicContent } = await import(pathToFileURL(resolve(source, 'shared/content-schema.mjs')));
const { CLOUD_ADMIN_PAGE_ALIASES } = await import(pathToFileURL(resolve(source, 'functions/cloud-content/http-server.mjs')));
const aliases = new Map(CLOUD_ADMIN_PAGE_ALIASES);
const { chromium } = await import(process.env.ARTDICO_PLAYWRIGHT_MODULE || 'playwright-core');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0KFjAwMDAxMDAgKAAGOQBVgs9CEsAAAAASUVORK5CYII=';
const PRIVATE = 'SYNTHETIC_PRIVATE_GAME_INFORMATION_NEVER_PUBLIC';
const IDS = { guest: 'synthetic-games-guest', creator: 'synthetic-games-creator', occupant: 'synthetic-games-occupant', booth: 'synthetic-games-booth', legacy: 'synthetic-games-legacy', indie: 'synthetic-games-indie', team: 'synthetic-games-team' };
const AT = '2026-10-21T09:00:00.000Z';
const clone = value => structuredClone(value);
const mime = file => ({ html: 'text/html', mjs: 'text/javascript', js: 'text/javascript', css: 'text/css', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', woff2: 'font/woff2' })[extname(file).slice(1)] || 'application/octet-stream';
const json = (value, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(value), headers: { 'access-control-allow-origin': SITE } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const routeFor = key => '/admin/content/' + key + '/';
const publication = (page, kind, id) => page.locator('[data-content-panel]:visible [data-publication-record][data-publication-kind="' + kind + '"][data-publication-id="' + id + '"]');

async function seed(runtime, { published = true } = {}) {
  const actor = runtime.users[0], people = [];
  for (const [name, responseStatus, owner] of [['合成公开人物', 'pending', '合成跟进甲'], ['合成出席人物', 'attending', '合成跟进甲'], ['合成拒绝人物', 'declined', '合成跟进乙']]) {
    const contact = (await runtime.createContact({ name, background: PRIVATE })).contact;
    const head = await runtime.app.contactsStore.read();
    await runtime.app.contactsStore.saveOperations(contact.id, head.revision, { ...contact.operations, responseStatus, owner, participationForms: [people.length === 0 ? 'guest' : 'attendee'] }, actor.id);
    people.push(contact.id);
  }
  const photo = await createOssPortraitStore({ objects: runtime.objects }).upload({ contentType: 'image/png', dataBase64: PNG });
  const content = (await runtime.app.store.read()).draft.content;
  content.organizations = [
    { id: IDS.creator, name: '合成作品创作组织', logoId: '', website: 'https://example.invalid/creator', participation: 'attendee', status: 'confirmed', publicConsent: false, internalNotes: PRIVATE },
    { id: IDS.occupant, name: '合成展位占用组织', logoId: '', website: 'https://example.invalid/occupant', participation: 'exhibitor', status: 'confirmed', publicConsent: true, internalNotes: PRIVATE },
  ];
  content.guests = [{ id: IDS.guest, contactId: people[0], name: '合成公开人物', company: '合成创作机构', ggjRole: '', title: '', bio: '', portraitId: '', publicRoles: [], status: 'pending', publicConsent: false, internalNotes: PRIVATE }];
  content.booths = [{ id: IDS.booth, code: 'C-01', slotNumber: 1, zone: 'C', organization: '合成展位占用组织', organizationId: IDS.occupant, project: '合成多作品展位', website: '', description: '合成展位说明', contactName: PRIVATE, contactMethods: 'synthetic.private@example.invalid', status: 'confirmed', internalNotes: PRIVATE }];
  const work = (id, title, extras = {}) => ({ id, title, teamName: '合成创作者署名', school: PRIVATE, contactName: PRIVATE, email: 'synthetic.private@example.invalid', wechat: PRIVATE, memberCount: 7, participationForms: ['booth'], responseStatus: 'attending', materialLinks: 'https://example.invalid/' + PRIVATE, summary: '合成可公开介绍', coverId: photo.id, status: 'confirmed', publicConsent: false, sessionId: '', boothId: IDS.booth, internalNotes: PRIVATE, ...extras });
  content.showcases = [work(IDS.legacy, '合成原记录作品'), work(IDS.indie, '合成独立游戏', { kind: 'indie', organizationId: IDS.creator }), work(IDS.team, '合成团队作品', { kind: 'team', organizationId: IDS.creator })];
  const checked = validateContent(content); assert.equal(checked.valid, true, JSON.stringify(checked.errors));
  assert.equal(Object.hasOwn(checked.value.showcases[0], 'kind'), false, 'legacy kind must stay absent');
  await runtime.app.store.save(0, checked.value, actor.id);
  if (published) await runtime.app.store.publish(1, actor.id);
  return { content: clone(checked.value), people, coverId: photo.id };
}

async function fixture(browser, errors, { width = 1440, published = true, username = 'owner', ignorePublicAbort = false } = {}) {
  const runtime = await peopleRuntimeFixture({ capacity: 300, mail: false }), initial = await seed(runtime, { published });
  const context = await browser.newContext({ viewport: { width, height: 940 }, acceptDownloads: true });
  const calls = [], publicFetches = [], pages = [], held = [];
  let publicationBudget = 0, nextPublicFault = null, holdNext = false, expirePath = null, nextSaveFault = null;
  const auth = await runtime.login(username), [cookieName, ...cookieValue] = auth.Cookie.split('=');
  await context.addCookies([
    { domain: new URL(API).hostname, path: '/api/admin', name: cookieName, value: cookieValue.join('='), httpOnly: true, secure: true, sameSite: 'Strict' },
    { domain: new URL(API).hostname, path: '/', name: 'synthetic_staff', value: 'SYNTHETIC_STAFF_COOKIE_NEVER_PUBLIC', httpOnly: true, secure: true, sameSite: 'Strict' },
  ]);
  await context.addInitScript(({ ignorePublicAbort }) => {
    const original = fetch.bind(window); window.__publicFetchOptions = []; window.__publicFetchSettlements = [];
    window.fetch = (input, options = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.pathname === '/api/public/content') {
        const id = window.__publicFetchOptions.length + 1;
        window.__publicFetchOptions.push({ id, credentials: options.credentials, cache: options.cache, hasSignal: Boolean(options.signal) });
        const result = original(input, ignorePublicAbort ? { ...options, signal: undefined } : options);
        return result.then(response => { window.__publicFetchSettlements.push({ id, status: response.status }); return response; }, error => { window.__publicFetchSettlements.push({ id, error: error.name }); throw error; });
      }
      return original(input, options);
    };
  }, { ignorePublicAbort });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    assert.ok([SITE, API].includes(url.origin), 'every network origin stays intercepted');
    if (path.startsWith('/api/')) {
      assert.equal(url.origin, API, 'the static frontend uses the independent API origin');
      const headers = await request.allHeaders(), body = request.postData() ? JSON.parse(request.postData()) : null;
      const entry = { path, method: request.method(), body, rawBody: request.postData(), headers }; calls.push(entry);
      assert.equal(/\/(?:dispatch|send|sent|manual-sent|users)(?:\/|$)/u.test(path), false, 'this acceptance never sends or manages accounts');
      if (path === '/api/admin/content/publish') { assert.ok(publicationBudget > 0, 'publication requires an explicit synthetic test action'); publicationBudget--; }
      if (path === expirePath) { expirePath = null; return route.fulfill(json({ error: { code: 'UNAUTHORIZED' } }, 401)); }
      if (path === '/api/admin/content' && request.method() === 'PUT' && nextSaveFault === 'uncommitted') { nextSaveFault = null; entry.status = 503; return route.fulfill(json({ error: { code: 'STORAGE_UNAVAILABLE' } }, 503)); }
      if (path.startsWith('/api/public/')) {
        assert.equal(headers.cookie, undefined, 'anonymous content and image reads omit every staff cookie');
        assert.equal(headers.authorization, undefined); assert.equal(headers.origin, SITE);
        if (path.startsWith('/api/public/portraits/')) assert.equal(headers.referer, undefined);
      }
      const response = await runtime.app.handle(new Request(request.url(), { method: request.method(), headers, ...(['GET', 'HEAD'].includes(request.method()) ? {} : { body: request.postData() }) }));
      const responseHeaders = Object.fromEntries(response.headers); delete responseHeaders['content-length'];
      const payload = { status: response.status, headers: responseHeaders, body: Buffer.from(await response.arrayBuffer()) };
      entry.status = payload.status;
      if (path === '/api/public/content') {
        publicFetches.push(entry); entry.envelope = payload.status === 200 ? JSON.parse(payload.body) : null;
        assert.equal(response.headers.get('access-control-allow-origin'), SITE, 'actual runtime CORS grants only the public site');
        const fault = nextPublicFault; nextPublicFault = null;
        if (holdNext) { holdNext = false; const gate = deferred(), captured = { gate, entry, ready: true }; held.push(captured); await gate.promise; }
        if (fault) { await route.fulfill(typeof fault === 'function' ? fault(payload) : fault); entry.delivered = true; return; }
      }
      await route.fulfill(payload); entry.delivered = true; return;
    }
    if (url.origin === SITE && path === '/__synthetic-away__/') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>合成离开页</title><p>合成浏览器历史返回入口</p>' });
    const fromSource = url.origin === API && path.startsWith('/__test_source__/'), base = fromSource ? source : dist;
    const served = fromSource ? path.slice('/__test_source__'.length) : url.origin === API ? aliases.get(path) || path : path;
    const file = resolve(base, '.' + (served.endsWith('/') ? served + 'index.html' : served)); assert.ok(file.startsWith(base + '/'));
    try { return route.fulfill({ status: 200, body: await readFile(file), contentType: mime(file) }); }
    catch { return route.fulfill({ status: 404, body: '' }); }
  });
  async function page() { const result = await context.newPage(); pages.push(result); result.setDefaultTimeout(12000); await result.clock.setSystemTime(new Date(AT)); result.on('pageerror', error => errors.push(error.message)); result.on('dialog', dialog => dialog.accept()); return result; }
  const admin = await page(), front = await page();
  return { runtime, initial, context, admin, front, calls, publicFetches, pages,
    allowPublish: () => { publicationBudget++; }, faultPublic: fault => { nextPublicFault = fault; },
    holdPublic: () => { holdNext = true; }, expire: path => { expirePath = path; }, failNextSave: () => { nextSaveFault = 'uncommitted'; },
    async waitHeld() { for (let i = 0; i < 500 && !held.some(item => !item.released); i++) await front.waitForTimeout(10); const item = held.find(item => !item.released); assert.ok(item, 'public response reached the synthetic hold'); return item; },
    async release(item) { item.released = true; item.gate.resolve(); await until(front, async () => item.entry.delivered, 'the obsolete response is actually delivered despite abort'); const id = publicFetches.indexOf(item.entry) + 1; await front.waitForFunction(id => window.__publicFetchSettlements.some(item => item.id === id), id); await front.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))); },
    async close() { for (const item of held) item.gate.resolve(); await context.close(); },
  };
}

async function openAdmin(f, key) { await f.admin.bringToFront(); await f.admin.goto(API + routeFor(key), { waitUntil: 'networkidle' }); await f.admin.locator('[data-admin-workspace]:visible').waitFor(); await f.admin.locator('[data-content-panel="' + key + '"]:visible').waitFor(); }
async function openFront(f) { await f.front.bringToFront(); await f.front.goto(SITE + '/', { waitUntil: 'networkidle' }); assert.equal(await f.front.locator('meta[name=artdico-content-api]').getAttribute('content'), API + '/api/public/content'); }
async function anonymous(f) { const response = await f.runtime.app.handle(f.runtime.request('/api/public/content', { origin: SITE })); assert.equal(response.headers.get('access-control-allow-origin'), SITE); return { status: response.status, value: await response.json() }; }
async function saveAndClose(f, kind) { await f.admin.locator('[data-' + kind + '-submit]').click(); await f.admin.locator('[data-admin-savebar][data-save-state=saved]').waitFor({ state: 'attached' }); await f.admin.locator('[data-' + kind + '-dialog]').waitFor({ state: 'hidden' }); }
async function editGuest(f) { await openAdmin(f, 'guests'); await f.admin.locator('[data-guest-id="' + IDS.guest + '"] [data-row-action=edit]').click(); return f.admin.locator('[data-guest-form]'); }
async function editWork(f, id) { await openAdmin(f, 'showcases'); await f.admin.locator('[data-showcase-id="' + id + '"] [data-row-action=edit]').click(); return f.admin.locator('[data-showcase-form]'); }
async function editOrganization(f, id = IDS.creator) { await openAdmin(f, 'organizations'); await f.admin.locator('[data-organization-id="' + id + '"] [data-organization-action=edit]').click(); return f.admin.locator('[data-organization-form]'); }
async function until(page, predicate, message) { for (let i = 0; i < 500; i++) { if (await predicate()) return; await page.waitForTimeout(20); } assert.fail(message); }
async function publish(f) { await openAdmin(f, 'publish'); const before = (await f.runtime.app.store.read()).draft.revision; f.allowPublish(); await f.admin.locator('[data-admin-publish]:enabled').click(); await until(f.admin, async () => (await f.runtime.app.store.read()).published?.revision === before, 'the explicit publish reached durable storage'); await f.admin.locator('[data-admin-publish]:enabled').waitFor(); const head = await f.runtime.app.store.read(); assert.equal(head.published.revision, before); assert.deepEqual(head.published.content, toPublicContent(head.draft.content)); return head.published; }
async function returnToFront(f) { await f.front.waitForTimeout(1100); await f.front.bringToFront(); await f.front.evaluate(() => { dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); }); }
async function publicState(page, kind, id, state, label) { const status = publication(page, kind, id); await status.waitFor(); assert.equal(await status.getAttribute('data-publication-state'), state); assert.match(await status.textContent(), label); return status; }
async function noOverflow(page) { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no horizontal viewport overflow'); }
async function assertPrivate(f) { const envelope = await anonymous(f); assert.equal(envelope.status, 200); const value = JSON.stringify(envelope.value); assert.doesNotMatch(value, new RegExp(PRIVATE + '|synthetic.private|contactId|contactName|materialLinks|internalNotes|wechat|memberCount')); assert.equal(f.runtime.messages.length, 0); }
async function unchangedAdmissions(f, before) { const after = await f.runtime.app.registrationService.getAdmissions({ actor: f.runtime.users[0] }); assert.deepEqual(after, before, 'game/organization/publication changes do not allocate attendance places'); assert.equal(after.summary.capacity, 300); }
async function draftRecords(page) { return page.evaluate(() => new Promise((resolve, reject) => { const request = indexedDB.open('artdico-browser-drafts-v1', 1); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result, tx = db.transaction('drafts', 'readonly'), read = tx.objectStore('drafts').getAll(); read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error); tx.oncomplete = () => db.close(); }; })); }
async function proofControl(page, name) { const open = page.locator('dialog[open] [data-admin-' + name + ']:visible'); return await open.count() ? open.last() : page.locator('[data-admin-savebar] [data-admin-' + name + ']:visible'); }

// Group implementations are deliberately separate: a frozen bundle can run a focused
// refresh race again without repeating every save/publish scenario.
async function flowCases(browser, errors, reports) {
  for (const width of [320, 390, 1440]) {
    const f = await fixture(browser, errors, { width });
    try {
      const admissions = await f.runtime.app.registrationService.getAdmissions({ actor: f.runtime.users[0] });
      await openFront(f); const baseline = await anonymous(f); assert.equal(baseline.value.revision, 1);
      const form = await editGuest(f);
      await publicState(f.admin, 'guests', IDS.guest, 'unpublished', /未公开/u);
      await form.locator('[name=status]').selectOption('confirmed'); await form.locator('[name=publicConsent]').check();
      assert.equal(await form.locator('[name=portraitId]').inputValue(), ''); assert.equal(await form.locator('[name=publicRoles]:checked').count(), 0);
      await saveAndClose(f, 'guest');
      const ready = await publicState(f.admin, 'guests', IDS.guest, 'unpublished', /未公开/u); assert.equal(await ready.getAttribute('data-publication-change'), 'new');
      assert.deepEqual((await anonymous(f)).value, baseline.value, 'saving valid draft does not publish');
      assert.equal(f.calls.filter(call => call.path.endsWith('/publish')).length, 0);
      await publish(f); await openAdmin(f, 'guests'); await publicState(f.admin, 'guests', IDS.guest, 'published', /已公开/u);
      await returnToFront(f); const card = f.front.locator('[data-public-guests] [data-guest-id="' + IDS.guest + '"]'); await card.waitFor();
      assert.match(await card.textContent(), /合成公开人物/u); assert.equal(await card.locator('img').count(), 0); assert.equal(await card.locator('.ah-guest-initial').textContent(), '合');
      assert.equal(f.calls.some(call => call.path === '/api/public/portraits/' || call.path.endsWith('/undefined') || call.path.endsWith('/null')), false);
      await noOverflow(f.admin); await noOverflow(f.front);
      await f.admin.screenshot({ path: resolve(evidence, 'guest-published-' + width + '.png'), fullPage: true });
      await f.front.locator('#guests').screenshot({ path: resolve(evidence, 'guest-front-' + width + '.png') });
      await assertPrivate(f); await unchangedAdmissions(f, admissions);
      reports.push({ group: 'flow', width, noPhotoAndNoRolesReady: true, saveDoesNotPublish: true, explicitPublishRefreshesFront: true, initialWithoutImageRequest: true, capacity300Unchanged: true });
    } finally { await f.close(); }
  }
  {
    const f = await fixture(browser, errors);
    try {
      let form = await editGuest(f); await form.locator('[name=status]').selectOption('confirmed'); await form.locator('[name=publicConsent]').check(); await saveAndClose(f, 'guest'); await publish(f); await openFront(f);
      form = await editGuest(f); await form.locator('[name=company]').fill('合成更新机构');
      assert.equal(await form.locator('[name=publicConsent]').isChecked(), false, 'public identity change requires authorization again');
      await form.locator('[name=publicConsent]').check(); await saveAndClose(f, 'guest');
      let status = await publicState(f.admin, 'guests', IDS.guest, 'published', /已公开/u); assert.equal(await status.getAttribute('data-publication-change'), 'updated');
      assert.equal((await anonymous(f)).value.content.guests[0].company, '合成创作机构');
      await publish(f); await returnToFront(f); await f.front.locator('[data-guest-id="' + IDS.guest + '"]').filter({ hasText: '合成更新机构' }).waitFor();
      await openAdmin(f, 'guests'); const beforeWithdrawal = f.calls.filter(call => call.method === 'PUT').length; await f.admin.locator('[data-guest-id="' + IDS.guest + '"] [data-row-action=unpublish]').click();
      await f.admin.locator('[data-admin-savebar][data-save-state=saved]').waitFor({ state: 'attached' }); assert.equal(f.calls.filter(call => call.method === 'PUT').length, beforeWithdrawal + 1, 'withdrawal saves once in its own explicit action');
      status = await publicState(f.admin, 'guests', IDS.guest, 'published', /已公开/u); assert.equal(await status.getAttribute('data-publication-change'), 'removed');
      const draft = (await f.runtime.app.store.read()).draft.content.guests[0]; assert.equal(draft.status, 'confirmed'); assert.equal(draft.publicConsent, false);
      assert.equal((await anonymous(f)).value.content.guests.length, 1, 'draft withdrawal does not hide the already-published card');
      await publish(f); await returnToFront(f); await until(f.front, async () => await f.front.locator('[data-public-guests] [data-guest-id]').count() === 0, 'published withdrawal reaches frontend');
      await openAdmin(f, 'guests'); await publicState(f.admin, 'guests', IDS.guest, 'unpublished', /未公开/u);
      reports.push({ group: 'flow', changedDraftRetainsActualOldPublication: true, consentRechecked: true, withdrawalGreenUntilPublish: true, statusPreserved: true, publishedWithdrawalRemovesFrontCard: true });
    } finally { await f.close(); }
  }
  {
    const f = await fixture(browser, errors, { published: false });
    try {
      await openAdmin(f, 'organizations'); const state = await publicState(f.admin, 'organizations', IDS.occupant, 'unpublished', /未公开/u); assert.equal(await state.getAttribute('data-publication-change'), 'new');
      assert.equal((await anonymous(f)).status, 404); await openAdmin(f, 'publish'); assert.match(await f.admin.locator('[data-content-panel=publish]').textContent(), /尚未发布|初始/u);
      assert.equal(f.calls.some(call => call.method === 'POST' && call.path.endsWith('/publish')), false);
      reports.push({ group: 'flow', noPublicationNotMisreportedAsSynced: true, readOnlyUntilExplicitPublish: true });
    } finally { await f.close(); }
  }
}

async function gamesCases(browser, errors, reports) {
  const f = await fixture(browser, errors);
  try {
    const admissions = await f.runtime.app.registrationService.getAdmissions({ actor: f.runtime.users[0] }), baseline = await anonymous(f);
    let form = await editWork(f, IDS.legacy);
    assert.equal(await form.locator('[name=kind]').inputValue(), '', 'legacy display default is an explicit empty choice');
    assert.match(await form.locator('[name=kind] option:checked').textContent(), /学生/u);
    await form.locator('[name=title]').fill('合成原记录更新名称'); await form.locator('[name=publicConsent]').check(); await saveAndClose(f, 'showcase');
    let head = await f.runtime.app.store.read(); assert.equal(Object.hasOwn(head.draft.content.showcases[0], 'kind'), false); assert.equal(Object.hasOwn(head.draft.content.showcases[0], 'organizationId'), false);
    assert.deepEqual((await anonymous(f)).value, baseline.value);
    reports.push({ group: 'games', legacyStudentDisplayDoesNotWriteKind: true, unrelatedSavePreservesAbsentOrganizationField: true, saveNotPublication: true });
    for (const [id, kind] of [[IDS.indie, 'indie'], [IDS.team, 'team']]) {
      form = await editWork(f, id); await form.locator('[name=kind]').selectOption(kind); await form.locator('[name=organizationId]').selectOption(IDS.creator); await form.locator('[name=publicConsent]').check(); await saveAndClose(f, 'showcase');
      const status = await publicState(f.admin, 'showcases', id, 'unpublished', /未公开/u); assert.equal(await status.getAttribute('data-publication-change'), 'new');
    }
    head = await f.runtime.app.store.read(); assert.equal(head.draft.content.showcases.filter(work => work.boothId === IDS.booth).length, 3);
    assert.equal(head.draft.content.booths[0].organizationId, IDS.occupant); assert.equal(head.draft.content.showcases[1].organizationId, IDS.creator);
    assert.deepEqual((await anonymous(f)).value, baseline.value); await publish(f); await openFront(f);
    const grid = f.front.locator('[data-public-showcases]'); await grid.locator('[data-showcase-id]').first().waitFor(); assert.equal(await grid.locator('[data-showcase-id]').count(), 3);
    assert.deepEqual(await grid.locator('[data-showcase-id]').evaluateAll(nodes => nodes.map(node => node.dataset.showcaseId).sort()), [IDS.legacy, IDS.indie, IDS.team].sort());
    assert.equal(await grid.locator('.ah-showcase-organization a').count(), 0, 'unauthorized creator organization is not revealed by a work');
    assert.equal((await anonymous(f)).value.content.showcases.find(work => work.id === IDS.indie).organizationId ?? '', '', 'public relation requires independently authorized organization in the same snapshot');
    for (const [kind, count] of [['student', 1], ['indie', 1], ['team', 1], ['all', 3]]) {
      await f.front.locator('[data-public-works-filter]').selectOption(kind); assert.equal(await grid.locator('[data-showcase-id]:visible').count(), count);
    }
    assert.equal(await f.front.locator('#booth-' + IDS.booth + ' a[href^="#work-"]').count(), 3, 'one booth points to all distinct works');
    reports.push({ group: 'games', independentAndTeamKindsPersisted: true, threeWorksShareOneBooth: true, creatorAndOccupantIndependent: true, unauthorizedCreatorRelationOmitted: true, stableIdDedupeAndKindFilters: true });
    form = await editOrganization(f); await form.locator('[name=publicConsent]').check(); await saveAndClose(f, 'organization');
    assert.equal((await anonymous(f)).value.content.organizations.some(item => item.id === IDS.creator), false);
    await publish(f); await returnToFront(f);
    await grid.locator('[data-showcase-id="' + IDS.indie + '"] .ah-showcase-organization a[href="#organization-' + IDS.creator + '"]').waitFor();
    assert.equal(await f.front.locator('#organization-' + IDS.creator + ' a[href^="#work-"]').count(), 2);
    assert.equal(await f.front.locator('#booth-' + IDS.booth + ' a[href^="#work-"]').count(), 3);
    reports.push({ group: 'games', creatorRelationAppearsOnlyAfterOwnAuthorizationAndPublication: true, samePublishedSnapshotRelations: true });
    form = await editWork(f, IDS.indie); await form.locator('[name=organizationId]').selectOption(''); assert.equal(await form.locator('[name=publicConsent]').isChecked(), false); await form.locator('[name=publicConsent]').check(); await saveAndClose(f, 'showcase');
    head = await f.runtime.app.store.read(); assert.equal(head.draft.content.showcases.find(work => work.id === IDS.indie).organizationId, '');
    assert.equal((await anonymous(f)).value.content.showcases.find(work => work.id === IDS.indie).organizationId, IDS.creator);
    await publish(f); await returnToFront(f); await until(f.front, async () => await grid.locator('[data-showcase-id="' + IDS.indie + '"] .ah-showcase-organization a').count() === 0, 'explicit relation clear reaches frontend');
    reports.push({ group: 'games', explicitEmptyOrganizationClearsOnlyOwnRelation: true, oldPublishedRelationRetainedUntilPublish: true });
    await assertPrivate(f); const dom = await f.front.evaluate(() => document.body.innerHTML); assert.equal(dom.includes(PRIVATE), false); assert.equal(dom.includes('synthetic.private@example.invalid'), false);
    await unchangedAdmissions(f, admissions);
    for (const width of [320, 390, 1440]) { await f.front.setViewportSize({ width, height: 940 }); await noOverflow(f.front); await f.front.locator('#students').screenshot({ path: resolve(evidence, 'works-front-' + width + '.png') }); }
    reports.push({ group: 'games', privateContactMaterialsNotesNeverProjected: true, memberTotalsDoNotConsume300Places: true, desktopAndMobileNoOverflow: true });
    await openAdmin(f, 'showcases'); await f.admin.locator('[data-showcase-kind-filter]').selectOption('indie'); assert.equal(await f.admin.locator('[data-admin-showcases] [data-showcase-id]').count(), 1);
    await f.admin.locator('[data-showcase-kind-filter]').selectOption(''); await f.admin.locator('[data-showcase-publication-filter]').selectOption('published'); assert.equal(await f.admin.locator('[data-admin-showcases] [data-showcase-id]').count(), 3);
    reports.push({ group: 'games', adminKindAndActualPublicationFilters: true });
  } finally { await f.close(); }
  {
    const f = await fixture(browser, errors);
    try {
      const form = await editWork(f, IDS.legacy); await form.locator('[name=kind]').selectOption('student'); await saveAndClose(f, 'showcase');
      const value = (await f.runtime.app.store.read()).draft.content.showcases[0]; assert.equal(Object.hasOwn(value, 'kind'), true); assert.equal(value.kind, 'student');
      await openAdmin(f, 'showcases'); await f.admin.locator('[data-showcase-id="' + IDS.legacy + '"] [data-row-action=edit]').click(); assert.equal(await f.admin.locator('[data-showcase-form] [name=kind]').inputValue(), 'student');
      reports.push({ group: 'games', explicitlyChoosingStudentWritesKindAndSurvivesReload: true });
    } finally { await f.close(); }
  }
  {
    const f = await fixture(browser, errors);
    try {
      await openAdmin(f, 'showcases'); await f.admin.locator('[data-admin-add-showcase]').click(); assert.equal(await f.admin.locator('[data-showcase-form] [name=kind]').inputValue(), 'indie');
      assert.equal(await f.admin.locator('[data-showcase-form] [name=kind]').getAttribute('required') !== null, true); await f.admin.locator('[data-showcase-dialog] [data-close-dialog=showcase]').first().click();
      assert.equal(f.calls.some(call => call.method === 'PUT'), false); assert.equal((await f.runtime.app.store.read()).draft.content.showcases.length, 3);
      reports.push({ group: 'games', newWorkDefaultsExplicitIndie: true, openingAndCancelNeverWrites: true });
    } finally { await f.close(); }
  }
  {
    const f = await fixture(browser, errors);
    try {
      let form = await editWork(f, IDS.indie); await form.locator('[name=title]').fill('合成旧本机填写继续');
      await until(f.admin, async () => (await draftRecords(f.admin)).some(row => row.kind === 'editing' && row.value.forms?.showcase?.fields?.title === '合成旧本机填写继续'), 'the latest old raw form is durably cached');
      await f.admin.evaluate(async ({ actorId, eventId }) => {
        const { createBrowserDraftStore } = await import('/__test_source__/src/lib/browser-drafts.mjs'), { CONTENT_DRAFT_POLICY } = await import('/__test_source__/src/lib/content-local-drafts.mjs');
        const store = createBrowserDraftStore(), scope = { actorId, eventId, page: 'content', entityId: 'workspace' }, head = await store.read(scope, CONTENT_DRAFT_POLICY), value = structuredClone(head.record.value);
        delete value.forms.showcase.fields.kind; delete value.forms.showcase.fields.organizationId;
        await store.write(scope, { expectedRevision: head.revision, actorEpoch: head.actorEpoch, kind: 'editing', baseRevision: head.record.baseRevision, value }, CONTENT_DRAFT_POLICY); store.close();
      }, { actorId: f.runtime.users[0].id, eventId: f.initial.content.eventId });
      await f.admin.reload({ waitUntil: 'networkidle' }); await f.admin.locator('[data-admin-local-restore]:visible').click(); await f.admin.locator('[data-showcase-dialog][open]').waitFor(); form = f.admin.locator('[data-showcase-form]');
      assert.equal(await form.locator('[name=title]').inputValue(), '合成旧本机填写继续'); assert.equal(await form.locator('[name=kind]').inputValue(), 'indie'); assert.equal(await form.locator('[name=organizationId]').inputValue(), IDS.creator);
      await saveAndClose(f, 'showcase'); const saved = (await f.runtime.app.store.read()).draft.content.showcases.find(item => item.id === IDS.indie); assert.equal(saved.kind, 'indie'); assert.equal(saved.organizationId, IDS.creator);
      reports.push({ group: 'games', oldRawMissingNewMetadataFallsBackToSavedValues: true, actualNativeIndexedDbRecovery: true });
    } finally { await f.close(); }
  }
  {
    const f = await fixture(browser, errors);
    try {
      const form = await editWork(f, IDS.legacy); await form.locator('[name=title]').fill('合成旧未知请求'); f.failNextSave(); await f.admin.locator('[data-showcase-submit]').click();
      await f.admin.locator('[data-admin-savebar][data-save-state=unknown]').waitFor({ state: 'attached' });
      const original = f.calls.find(call => call.path === '/api/admin/content' && call.method === 'PUT'); assert.equal(Object.hasOwn(original.body.content.showcases[0], 'kind'), false);
      const row = (await draftRecords(f.admin)).find(row => row.kind === 'pending_submission'); assert.deepEqual(row.value.pendingSave, original.body);
      await f.admin.reload({ waitUntil: 'networkidle' }); await f.admin.locator('[data-admin-local-restore]:visible').click(); await f.admin.locator('[data-showcase-dialog][open]').waitFor(); await f.admin.locator('[data-admin-local-restore]').waitFor({ state: 'hidden' }); await (await proofControl(f.admin, 'check-save')).click(); await (await proofControl(f.admin, 'retry-save')).click();
      await f.admin.locator('[data-admin-savebar][data-save-state=saved]').waitFor({ state: 'attached' });
      const puts = f.calls.filter(call => call.path === '/api/admin/content' && call.method === 'PUT'); assert.equal(puts.length, 2); assert.equal(puts[1].rawBody, original.rawBody); assert.equal(Object.hasOwn((await f.runtime.app.store.read()).draft.content.showcases[0], 'kind'), false);
      reports.push({ group: 'games', oldPendingBodyNeverReceivesDefaultKind: true, refreshExplicitProofAndExactOriginalRetry: true });
    } finally { await f.close(); }
  }
  {
    const f = await fixture(browser, errors);
    try {
      const form = await editOrganization(f); await form.locator('[name=name]').fill('合成未知保存退出'); f.failNextSave(); await f.admin.locator('[data-organization-submit]').click(); await f.admin.locator('[data-admin-savebar][data-save-state=unknown]').waitFor({ state: 'attached' });
      assert.ok((await draftRecords(f.admin)).some(row => row.kind === 'pending_submission')); await f.admin.locator('[data-organization-dialog][open] [data-admin-proof-logout]').click(); await f.admin.locator('[data-admin-login-panel]:visible').waitFor();
      const privateDom = await f.admin.evaluate(() => document.body.textContent + [...document.querySelectorAll('input,textarea')].map(field => field.value).join(' ')); assert.equal(privateDom.includes('合成未知保存退出'), false); assert.equal(privateDom.includes(PRIVATE), false); await until(f.admin, async () => (await draftRecords(f.admin)).length === 0, 'explicit logout durably clears the old actor cache');
      assert.equal(f.calls.filter(call => call.path === '/api/admin/content' && call.method === 'PUT').length, 1); assert.equal((await f.runtime.app.store.read()).draft.content.organizations[0].name, f.initial.content.organizations[0].name);
      reports.push({ group: 'games', unknownProofDialogOffersExplicitLogout: true, logoutClearsActorCacheAndPrivateDom: true, noRetryOrUnsavedOverwrite: true });
    } finally { await f.close(); }
  }
}

async function serverPublish(f, title) {
  const head = await f.runtime.app.store.read(), value = clone(head.draft.content); value.event.title = title;
  const checked = validateContent(value); assert.equal(checked.valid, true, JSON.stringify(checked.errors));
  await f.runtime.app.store.save(head.draft.revision, checked.value, f.runtime.users[0].id);
  return f.runtime.app.store.publish(head.draft.revision + 1, f.runtime.users[0].id);
}
async function titleIs(f, value) { await until(f.front, async () => (await f.front.title()).startsWith(value), 'frontend title reaches the expected actual publication'); }
async function refreshOnce(f) { const before = f.publicFetches.length; await returnToFront(f); await until(f.front, async () => f.publicFetches.length === before + 1, 'one return event burst schedules a content GET'); await f.front.waitForTimeout(250); return before; }

async function refreshCases(browser, errors, reports) {
  {
    const f = await fixture(browser, errors);
    try {
      await openFront(f); await f.front.goto(SITE + '/__synthetic-away__/', { waitUntil: 'load' }); const title = '合成真实历史返回发布'; await serverPublish(f, title);
      await f.front.goBack({ waitUntil: 'networkidle' }); await titleIs(f, title); assert.equal(new URL(f.front.url()).origin, SITE); assert.ok(f.publicFetches.length >= 2);
      reports.push({ group: 'refresh', actualBrowserHistoryReturnReadsCurrentPublishedVersion: true });
    } finally { await f.close(); }
  }
  {
    const f = await fixture(browser, errors);
    try {
      await openFront(f); const initialReads = f.publicFetches.length; assert.equal(initialReads, 1);
      await f.front.waitForTimeout(1100); await f.front.evaluate(() => { for (let i = 0; i < 20; i++) { dispatchEvent(new Event('focus')); dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); document.dispatchEvent(new Event('visibilitychange')); } });
      await until(f.front, async () => f.publicFetches.length === initialReads + 1, 'the return burst is debounced'); await f.front.waitForTimeout(1600); assert.equal(f.publicFetches.length, initialReads + 1, 'there is no periodic polling or queued duplicate');
      const options = await f.front.evaluate(() => window.__publicFetchOptions); assert.ok(options.length >= 2); for (const entry of options) { assert.equal(entry.credentials, 'omit'); assert.equal(entry.cache, 'no-store'); }
      assert.equal(f.calls.some(call => call.method !== 'GET'), false); assert.equal(f.runtime.messages.length, 0);
      reports.push({ group: 'refresh', lifecycleBurstDebounced: true, noPeriodicPolling: true, anonymousNoStoreCors: true, noBusinessWrite: true });
    } finally { await f.close(); }
  }
  for (const failure of ['success', '404', '503', 'malformed']) {
    const f = await fixture(browser, errors, { ignorePublicAbort: true });
    try {
      await openFront(f); f.holdPublic();
      if (failure === '404') f.faultPublic(json({ error: { code: 'NOT_PUBLISHED' } }, 404));
      if (failure === '503') f.faultPublic(json({ error: { code: 'UNAVAILABLE' } }, 503));
      if (failure === 'malformed') f.faultPublic({ ...json({}), body: '{' });
      await returnToFront(f); const old = await f.waitHeld();
      await f.front.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
      const title = '合成新发布版本 ' + failure; const newer = await serverPublish(f, title);
      await returnToFront(f); await titleIs(f, title); assert.ok(f.publicFetches.some(call => call.envelope?.revision === newer.revision));
      await f.release(old); assert.equal(await f.front.title(), title + '｜活动安排');
      assert.equal(await f.front.locator('[data-public-organizations] [data-organization-id="' + IDS.occupant + '"]').count(), 1);
      assert.equal(f.calls.some(call => call.method !== 'GET'), false);
      reports.push({ group: 'refresh', lateResponse: failure, deliveredDespiteAbort: true, pagehideInvalidatesOldGeneration: true, oldReplyNeverOverwritesNewPublishedDom: true });
    } finally { await f.close(); }
  }
  {
    const f = await fixture(browser, errors);
    try {
      await serverPublish(f, '合成已核实最新内容'); await openFront(f); await titleIs(f, '合成已核实最新内容');
      const known = clone((await anonymous(f)).value);
      for (const fault of ['lowerRevision', 'backwardTime', 'changedSameRevision', 'malformed', '503']) {
        f.faultPublic(payload => {
          if (fault === '503') return json({ error: { code: 'UNAVAILABLE' } }, 503);
          if (fault === 'malformed') return { ...payload, body: Buffer.from('{') };
          const value = clone(known); value.content.event.title = 'SYNTHETIC_OBSOLETE_RESPONSE_MUST_NOT_RENDER';
          if (fault === 'lowerRevision') value.revision--;
          if (fault === 'backwardTime') { value.revision++; value.publishedAt = '2026-10-20T00:00:00.000Z'; }
          return { ...payload, body: Buffer.from(JSON.stringify(value)) };
        });
        await refreshOnce(f); assert.equal(await f.front.title(), '合成已核实最新内容｜活动安排');
        assert.equal(await f.front.evaluate(() => document.body.textContent.includes('SYNTHETIC_OBSOLETE_RESPONSE_MUST_NOT_RENDER')), false);
      }
      reports.push({ group: 'refresh', lowerRevisionBackwardTimeAndSameRevisionMutationRejected: true, malformedAndFailedRefreshKeepLastVerifiedDom: true });
    } finally { await f.close(); }
  }
  {
    const f = await fixture(browser, errors, { ignorePublicAbort: true });
    try {
      await openFront(f); const oldTitle = await f.front.title(); await serverPublish(f, '合成期限外旧发布'); f.holdPublic(); await returnToFront(f); const held = await f.waitHeld(), reads = f.publicFetches.length;
      await f.front.evaluate(() => { for (let i = 0; i < 10; i++) dispatchEvent(new Event('focus')); }); await f.front.waitForTimeout(300); assert.equal(f.publicFetches.length, reads, 'in-flight lifecycle events do not enqueue a second read');
      await f.front.waitForTimeout(10200); await f.release(held); assert.equal(await f.front.title(), oldTitle, 'a response after the deadline is not applied');
      const title = '合成超时后明确恢复'; await serverPublish(f, title); await returnToFront(f); await titleIs(f, title);
      reports.push({ group: 'refresh', tenSecondDeadline: true, inflightEventsDoNotQueueReads: true, laterReturnRecoversWithoutAutomaticRetry: true });
    } finally { await f.close(); }
  }
  {
    const f = await fixture(browser, errors);
    try {
      await openFront(f); const observed = await f.front.evaluate(() => { window.__organizationReplacementCount = 0; const root = document.querySelector('[data-public-organizations]'); const observer = new MutationObserver(() => window.__organizationReplacementCount++); observer.observe(root, { childList: true, subtree: true }); return root.childElementCount; });
      assert.ok(observed > 0, 'the equality check observes a nonempty public list'); await refreshOnce(f); assert.equal(await f.front.evaluate(() => window.__organizationReplacementCount), 0, 'identical verified revision does not rebuild cards');
      assert.equal(await f.front.locator('[data-public-organizations]').evaluate(node => node.childElementCount), observed);
      reports.push({ group: 'refresh', identicalRevisionAndBodyDoesNotReplaceDom: true });
    } finally { await f.close(); }
  }
}

function contactRow(page, id) { return page.locator('[data-contacts-rows] tr').filter({ has: page.locator('[data-contact-relationships="' + id + '"]') }); }
async function openPeople(f) { await f.admin.goto(API + '/admin/contacts/', { waitUntil: 'networkidle' }); await f.admin.locator('[data-contacts-workspace]:visible').waitFor(); await f.admin.locator('[data-contacts-rows] tr').first().waitFor(); }
async function openPerson(f, id) { await f.admin.goto(API + '/admin/person/#contact=' + id, { waitUntil: 'networkidle' }); await f.admin.locator('[data-person-record]:visible').waitFor(); }
async function peopleCases(browser, errors, reports) {
  for (const width of [320, 390, 1440]) {
    const f = await fixture(browser, errors, { width });
    try {
      const before = await f.runtime.app.registrationService.getAdmissions({ actor: f.runtime.users[0] }); await openPeople(f);
      for (const [index, state, label, tone] of [[0, 'pending', '未确认出席', 'negative'], [1, 'attending', '已确认出席', 'positive'], [2, 'declined', '不出席', 'negative']]) {
        const status = contactRow(f.admin, f.initial.people[index]).locator('[data-attendance-status="' + state + '"]'); assert.equal(await status.textContent(), label); assert.equal(await status.getAttribute('data-status-tone'), tone);
        await openPerson(f, f.initial.people[index]); const personStatus = f.admin.locator('[data-person-admission] [data-attendance-status="' + state + '"]'); assert.equal(await personStatus.textContent(), label); assert.equal(await personStatus.getAttribute('data-status-tone'), tone);
        if (state === 'attending') { assert.match(await f.admin.locator('[data-person-admission]').textContent(), /尚未|未登记|未关联|无.*报名/u); assert.doesNotMatch(await f.admin.locator('[data-person-admission]').textContent(), /名额已确认|已确认名额/u); }
        await openPeople(f);
      }
      await noOverflow(f.admin); await f.admin.screenshot({ path: resolve(evidence, 'people-status-' + width + '.png'), fullPage: true });
      assert.equal(f.calls.some(call => call.method !== 'GET'), false); await unchangedAdmissions(f, before);
      reports.push({ group: 'people', width, attendanceLabelsAndColorAgreeAcrossListAndPerson: true, declineDistinctFromPending: true, responseDoesNotImplyFormalPlace: true, readOnlyAndNoOverflow: true });
    } finally { await f.close(); }
  }
  {
    const f = await fixture(browser, errors);
    try {
      const form = await editGuest(f); await form.locator('[name=status]').selectOption('confirmed'); await form.locator('[name=publicConsent]').check(); await saveAndClose(f, 'guest');
      await openPerson(f, f.initial.people[0]); assert.equal(await f.admin.locator('[data-person-step=public]').getAttribute('data-step-state'), 'pending');
      const badge = f.admin.locator('[data-profile-publication="' + IDS.guest + '"]'); assert.equal(await badge.getAttribute('data-publication-state'), 'unpublished');
      await publish(f); await openPerson(f, f.initial.people[0]); assert.equal(await f.admin.locator('[data-person-step=public]').getAttribute('data-step-state'), 'complete');
      assert.equal(await badge.getAttribute('data-publication-state'), 'published');
      const auth = await f.runtime.login(), response = await f.runtime.app.handle(f.runtime.request('/api/admin/people/contacts/' + f.initial.people[0], { headers: auth }));
      assert.equal(response.status, 200); const value = await response.json(); const profile = value.publicProfile.profiles.find(item => item.id === IDS.guest); assert.equal(profile.hasPortrait, false); assert.deepEqual(profile.publicRoles, []); assert.equal(profile.publishedMatchesDraft, true);
      reports.push({ group: 'people', noPhotoAndNoPublicRolesDoNotBlockReadiness: true, personProjectionMatchesActualPublicSnapshot: true });
    } finally { await f.close(); }
  }
  {
    const f = await fixture(browser, errors, { width: 390 });
    try {
      const unassigned = (await f.runtime.createContact({ name: '合成尚未分配' })).contact;
      await openPeople(f);
      const owner = id => f.admin.locator('[data-contact-owner="' + id + '"]');
      const first = await owner(f.initial.people[0]).getAttribute('data-owner-tone'); assert.match(first, /^[0-5]$/u);
      assert.equal(await owner(f.initial.people[1]).getAttribute('data-owner-tone'), first); assert.equal(await owner(unassigned.id).getAttribute('data-owner-tone'), 'neutral'); assert.equal(await owner(unassigned.id).textContent(), '待分配');
      assert.equal(await owner(f.initial.people[0]).textContent(), '合成跟进甲');
      await f.admin.locator('[data-contacts-owner]').selectOption('合成跟进甲'); assert.equal(await f.admin.locator('[data-contacts-rows] tr').count(), 2); assert.equal(await owner(f.initial.people[0]).getAttribute('data-owner-tone'), first);
      await f.admin.reload({ waitUntil: 'networkidle' }); await f.admin.locator('[data-contacts-workspace]:visible').waitFor(); assert.equal(await owner(f.initial.people[1]).getAttribute('data-owner-tone'), first);
      const colors = await owner(f.initial.people[0]).evaluate(node => ({ color: getComputedStyle(node).color, background: getComputedStyle(node).backgroundColor }));
      const luminance = value => { const channels = value.match(/[\d.]+/gu).slice(0, 3).map(Number).map(channel => { const s = channel / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }); return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722; };
      const foreground = luminance(colors.color), background = luminance(colors.background); assert.ok((Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05) >= 4.5, 'owner label text has WCAG AA contrast');
      await openPerson(f, f.initial.people[0]); assert.equal(await f.admin.locator('[data-person-owner]').getAttribute('data-owner-tone'), first); assert.equal(await f.admin.locator('[data-person-owner]').textContent(), '合成跟进甲');
      assert.equal(f.calls.some(call => call.method !== 'GET'), false);
      reports.push({ group: 'people', sameOwnerKeepsColorAcrossRowsFilterReloadAndPerson: true, unassignedNeutral: true, originalNameAndAaContrast: true, noOwnerDataMutation: true });
    } finally { await f.close(); }
  }
}

export async function runGamesPublicationBrowser({ groups = ['flow', 'games', 'refresh', 'people'] } = {}) {
  const errors = [], reports = [];
  const append = reports.push.bind(reports); reports.push = value => { process.stderr.write('passed ' + JSON.stringify(value) + '\n'); return append(value); };
  await mkdir(evidence, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.ARTDICO_CHROMIUM_BINARY || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    if (groups.includes('flow')) await flowCases(browser, errors, reports);
    if (groups.includes('games')) await gamesCases(browser, errors, reports);
    if (groups.includes('refresh')) await refreshCases(browser, errors, reports);
    if (groups.includes('people')) await peopleCases(browser, errors, reports);
    assert.deepEqual(errors, []);
    const html = await readFile(resolve(dist, 'index.html'));
    return { groups, cases: reports.length, reports, pageErrors: errors, syntheticOnly: true, actualRuntime: true,
      provenance: { sourceDirectory: source, distDirectory: dist, publicHtmlSha256: createHash('sha256').update(html).digest('hex'), publicHtmlModifiedAt: (await stat(resolve(dist, 'index.html'))).mtime.toISOString() } };
  } finally { await browser.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const groups = process.env.ARTDICO_BROWSER_GROUPS?.split(',').filter(Boolean);
  console.log(JSON.stringify(await runGamesPublicationBrowser(groups ? { groups } : {}), null, 2));
}
