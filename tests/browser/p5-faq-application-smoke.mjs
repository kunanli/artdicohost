// Current built homepage, synthetic public publication and the real isolated
// application runtime. Every request is intercepted before page navigation.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const project = fileURLToPath(new URL('../../', import.meta.url));
const source = resolve(process.env.ARTDICO_SOURCE_DIRECTORY || project), dist = resolve(process.env.ARTDICO_DIST_DIRECTORY || resolve(source, 'dist'));
const evidence = resolve(process.env.ARTDICO_FAQ_EVIDENCE_DIRECTORY || resolve(project, '.local-data/browser-evidence/p5-faq-application'));
const { peopleRuntimeFixture, PEOPLE_FIXTURE_API: API, PEOPLE_FIXTURE_PUBLIC: SITE } = await import(pathToFileURL(resolve(source, 'tests/helpers/people-runtime-fixture.mjs')));
const { createInitialContent } = await import(pathToFileURL(resolve(source, 'src/config/content.mjs')));
const { toPublicContent } = await import(pathToFileURL(resolve(source, 'shared/content-schema.mjs')));
const { contentSaveSnapshot } = await import(pathToFileURL(resolve(source, 'src/lib/admin-save-state.mjs')));
const { CONTENT_FORM_FIELDS } = await import(pathToFileURL(resolve(source, 'src/lib/content-local-drafts.mjs')));
const { CLOUD_ADMIN_PAGE_ALIASES } = await import(pathToFileURL(resolve(source, 'functions/cloud-content/http-server.mjs')));
const { chromium } = await import(process.env.ARTDICO_PLAYWRIGHT_MODULE || 'playwright-core');
const html = await readFile(resolve(dist, 'index.html')), errors = [], reports = [];
const housing = '本次活动提供少量外地来宾住宿支持。有需要的朋友，欢迎提前通过 support@artdico.co 联系主办方了解安排；名额有限，住宿安排将另行确认。';
const initialTime = Date.parse('2026-10-21T09:00:00.000Z');
const browser = await chromium.launch({ executablePath: process.env.ARTDICO_CHROMIUM_BINARY || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const mime = file => ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' })[extname(file)] || 'application/octet-stream';
function publication(revision) {
  const content = createInitialContent(); content.sessions = []; content.guests = []; content.showcases = []; content.booths = []; content.organizations = [];
  content.event.presentation.contactEmail = revision === 1 ? 'synthetic.old@example.invalid' : '';
  content.event.presentation.faqItems = [
    { id: 'registration-status', question: '报名服务现在开放吗？', answer: 'SYNTHETIC_STALE_OPEN_ANSWER' },
    { id: 'custom-experience', question: '合成交流问题', answer: revision === 1 ? '合成初始回答' : '合成更新回答' },
    { question: '现在可以报名吗？自订说明', answer: '合成自订回答不会被服务状态覆写' },
    { question: '报名成功就有住宿吗？', answer: 'SYNTHETIC_STALE_LODGING_ANSWER' },
    { id: 'data-rights', question: '资料如何处理？', answer: 'SYNTHETIC_STALE_RIGHTS_ANSWER' },
  ];
  if (revision > 1) content.event.presentation.faqItems.reverse();
  if (revision === 4) delete content.event.presentation;
  return { revision, publishedAt: new Date(initialTime + revision * 1000).toISOString(), content: toPublicContent(content) };
}
async function fixture(width, mode = 'ready', lostAck = false) {
  const runtime = await peopleRuntimeFixture({ capacity: 300, mail: false }), calls = [], context = await browser.newContext({ viewport: { width, height: 940 } });
  let revision = 1, lose = lostAck, now = initialTime;
  await context.addInitScript(() => {
    window.syntheticFaqEmails = [];
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.syntheticFaqEmails.push(value); } }, configurable: true });
  });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()); assert.ok([API, SITE].includes(url.origin), 'no real origin is contacted');
    if (url.pathname.startsWith('/api/')) {
      assert.equal(url.origin, API); const headers = await request.allHeaders(); assert.equal(headers.cookie, undefined);
      calls.push({ method: request.method(), path: url.pathname, body: request.postData(), headers });
      if (url.pathname === '/api/public/content') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(publication(revision)) });
      assert.ok(['/api/admin/registration/config', '/api/admin/registration/token', '/api/admin/registration/submit'].includes(url.pathname), 'only public application reads and explicit synthetic submission');
      if (url.pathname.endsWith('/config') && mode === 'unavailable') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE' } }) });
      const response = await runtime.app.handle(new Request(request.url(), { method: request.method(), headers,
        ...(['GET', 'HEAD'].includes(request.method()) ? {} : { body: request.postData() }) }));
      let body = Buffer.from(await response.arrayBuffer());
      if (url.pathname.endsWith('/config') && mode === 'closed') { const metadata = JSON.parse(body); metadata.enabled = false; metadata.reason = 'closed'; body = Buffer.from(JSON.stringify(metadata)); }
      if (url.pathname.endsWith('/submit') && lose) { lose = false; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE' } }) }); }
      const responseHeaders = Object.fromEntries(response.headers); delete responseHeaders['content-length'];
      return route.fulfill({ status: response.status, headers: responseHeaders, body });
    }
    const file = resolve(dist, '.' + (url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname)); assert.ok(file.startsWith(dist + '/'));
    try { return route.fulfill({ status: 200, contentType: mime(file), body: await readFile(file) }); } catch { return route.fulfill({ status: 404, body: '' }); }
  });
  const page = await context.newPage(); page.setDefaultTimeout(15000); await page.clock.setFixedTime(new Date(now));
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(SITE + '/#faq', { waitUntil: 'networkidle' });
  await page.locator('[data-faq-id="custom-experience"]').waitFor();
  await page.locator('[data-registration-form][data-registration-mode="' + (mode === 'ready' ? 'production' : mode) + '"]').waitFor();
  return { runtime, context, page, calls, width, mode, async refresh() {
    revision++; now += 2000; await page.clock.setFixedTime(new Date(now));
    const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/public/content');
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await response;
    if (revision === 4) await page.locator('[data-faq-id="custom-experience"]').waitFor({ state: 'detached' });
    else await page.locator('[data-faq-id="custom-experience"] .ah-faq-answer').filter({ hasText: '合成更新回答' }).waitFor({ state: 'attached' });
  } };
}
const form = page => page.locator('[data-registration-form]');
async function records(page) {
  return page.evaluate(() => new Promise((resolve, reject) => { const request = indexedDB.open('artdico-browser-drafts-v1', 1);
    request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result, transaction = db.transaction('drafts', 'readonly'), read = transaction.objectStore('drafts').getAll();
      read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error); transaction.oncomplete = () => db.close(); }; }));
}
async function fill(page, name = '合成申请人') {
  await form(page).locator('[name=name]').fill(name); await form(page).locator('[name=email]').fill('synthetic.faq@example.invalid');
  await form(page).locator('[name=categories]').selectOption('student');
}
async function legacyStaffRecovery(mode) {
  const runtime = await peopleRuntimeFixture({ capacity: 300, mail: false }), context = await browser.newContext({ viewport: { width: 390, height: 940 } });
  const initial = (await runtime.app.store.read()).draft.content;
  initial.event.presentation.faqItems = [{ id: 'faq-original-stable', question: '合成旧编辑器问题', answer: '合成原答案' }];
  const base = await runtime.app.store.save(0, initial, runtime.users[0].id), pendingContent = structuredClone(base.content);
  pendingContent.event.presentation.faqItems = [{ question: '合成旧编辑器问题', answer: '合成旧提交新答案' }];
  const submitted = contentSaveSnapshot(1, pendingContent), original = JSON.stringify(submitted);
  const fields = Object.fromEntries(CONTENT_FORM_FIELDS.event.map(key => [key, pendingContent.event[key] ?? pendingContent.event.presentation[key]]));
  const value = { schemaVersion: 1, roleKey: [...runtime.users[0].roles].sort().join(','), section: 'event', content: submitted.content,
    forms: { event: { fields, faqItems: structuredClone(submitted.content.event.presentation.faqItems) } }, pendingSave: submitted, uncertain: true };
  if (mode === 'pending-only') await runtime.app.store.save(1, submitted.content, runtime.users[0].id);
  const auth = await runtime.login(), [name, ...cookie] = auth.Cookie.split('=');
  await context.addCookies([{ domain: new URL(API).hostname, path: '/api/admin', name, value: cookie.join('='), httpOnly: true, secure: true, sameSite: 'Strict' }]);
  const calls = [], aliases = new Map(CLOUD_ADMIN_PAGE_ALIASES);
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()); assert.equal(url.origin, API);
    if (url.pathname.startsWith('/api/')) {
      assert.equal(request.method(), 'GET', 'restoring and checking a saved legacy request never starts a second write');
      calls.push({ path: url.pathname, method: request.method() });
      const response = await runtime.app.handle(new Request(request.url(), { headers: await request.allHeaders() }));
      const headers = Object.fromEntries(response.headers); delete headers['content-length'];
      return route.fulfill({ status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) });
    }
    if (url.pathname.startsWith('/__test_source__/')) {
      const file = resolve(source, '.' + url.pathname.slice('/__test_source__'.length));
      assert.ok(file.startsWith(source + '/')); assert.match(url.pathname, /\/(?:src\/lib|shared)\/.+\.mjs$/u);
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: await readFile(file) });
    }
    const path = aliases.get(url.pathname) || url.pathname, file = resolve(dist, '.' + (path.endsWith('/') ? path + 'index.html' : path)); assert.ok(file.startsWith(dist + '/'));
    try { return route.fulfill({ status: 200, contentType: mime(file), body: await readFile(file) }); } catch { return route.fulfill({ status: 404, body: '' }); }
  });
  const page = await context.newPage(); page.setDefaultTimeout(15000); await page.clock.setFixedTime(new Date(initialTime));
  page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => { void dialog.accept(); });
  await page.goto(API + '/admin/content/event/', { waitUntil: 'networkidle' }); await page.locator('[data-admin-workspace]:visible').waitFor();
  await page.evaluate(async ({ actorId, eventId, value }) => {
    const { createBrowserDraftStore } = await import('/__test_source__/src/lib/browser-drafts.mjs');
    const { CONTENT_DRAFT_POLICY } = await import('/__test_source__/src/lib/content-local-drafts.mjs');
    const store = createBrowserDraftStore(), scope = { actorId, eventId, page: 'content', entityId: 'workspace' }, head = await store.read(scope, CONTENT_DRAFT_POLICY);
    await store.write(scope, { expectedRevision: head.revision, actorEpoch: head.actorEpoch, kind: 'pending_submission', baseRevision: 1, value }, CONTENT_DRAFT_POLICY); store.close();
  }, { actorId: runtime.users[0].id, eventId: submitted.content.eventId, value });
  await page.reload({ waitUntil: 'networkidle' }); await page.locator('[data-admin-local-restore]:visible').click();
  await page.locator('[data-admin-check-save]:visible').waitFor();
  const before = (await records(page)).find(row => row.scope.page === 'content'); assert.equal(JSON.stringify(before.value.pendingSave), original);
  if (mode === 'same-base-form') {
    assert.equal(await page.locator('[data-event-faq] [name=faqAnswer]').inputValue(), '合成旧提交新答案');
    await runtime.app.store.save(1, submitted.content, runtime.users[0].id);
  }
  await page.locator('[data-admin-check-save]:visible').click();
  await page.locator('[data-admin-savebar][data-save-state="saved"]').waitFor({ state: 'attached' });
  await page.waitForFunction(async () => { const db = await new Promise((resolve, reject) => { const request = indexedDB.open('artdico-browser-drafts-v1', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try { return await new Promise((resolve, reject) => { const request = db.transaction('drafts').objectStore('drafts').getAll(); request.onsuccess = () => resolve(!request.result.some(row => row.scope.page === 'content')); request.onerror = () => reject(request.error); }); } finally { db.close(); } });
  assert.equal(await page.locator('[data-admin-savebar]').isVisible(), false, 'a clean saved page hides the redundant save bar');
  assert.equal(await page.locator('[data-admin-save]').isDisabled(), true); assert.equal(await page.locator('[data-admin-check-save]:visible').count(), 0);
  assert.equal(await page.locator('[data-event-faq] fieldset').getAttribute('data-faq-id'), 'faq-original-stable');
  assert.equal(await page.locator('[data-event-faq] [name=faqAnswer]').inputValue(), '合成旧提交新答案');
  assert.equal((await runtime.app.store.read()).draft.revision, 2); assert.equal(runtime.messages.length, 0); assert.equal(JSON.stringify(submitted), original);
  await page.screenshot({ path: resolve(evidence, 'legacy-' + mode + '.png'), fullPage: true });
  reports.push({ legacyStaffRecovery: mode, originalPendingUntouched: true, readOnlyGetAcknowledgement: true, adoptedServerFaqId: true, noPhantomDirtyOrSecondPut: true, calls: calls.length });
  await context.close();
}
try {
  await mkdir(evidence, { recursive: true });
  for (const width of [320, 390, 1440]) for (const mode of ['ready', 'closed', 'unavailable']) {
    const f = await fixture(width, mode), { page } = f;
    const primaryLabel = page.locator('[data-home-primary-apply-label]');
    assert.equal(await primaryLabel.textContent(), mode === 'ready' ? '申请参加' : '查看申请说明');
    const status = page.locator('[data-faq-id="registration-status"] .ah-faq-answer');
    assert.match(await status.textContent(), mode === 'ready' ? /可以提交参会申请/u : mode === 'closed' ? /停止接收新申请/u : /服务暂时无法/u);
    assert.equal(await page.locator('[data-faq-id="lodging-support"] .ah-faq-answer').textContent(), housing);
    assert.equal(await page.locator('[data-faq-id="lodging-support"] a').getAttribute('href'), 'mailto:support@artdico.co');
    assert.doesNotMatch(await page.locator('[data-public-faq]').textContent(), /SYNTHETIC_STALE|一晚住宿须单独申请/u);
    if (mode === 'unavailable') assert.equal(await page.locator('[data-faq-id="data-rights"] a').textContent(), 'synthetic.old@example.invalid');
    const custom = page.locator('[data-faq-id="custom-experience"]'); assert.equal(await custom.evaluate(row => row.open), true);
    await custom.locator('summary').click(); assert.equal(await custom.evaluate(row => row.open), false);
    await custom.locator('summary').click(); assert.equal(await custom.evaluate(row => row.open), true); await custom.locator('summary').focus();
    await f.refresh();
    if (mode === 'unavailable') assert.equal(await page.locator('[data-faq-id="data-rights"] a').textContent(), 'support@artdico.co', 'explicitly cleared publication email cannot retain an old contact');
    assert.equal(await custom.evaluate(row => row.open), true);
    assert.equal(await page.evaluate(() => document.activeElement.closest('[data-faq-id]')?.dataset.faqId), 'custom-experience');
    assert.match(await status.textContent(), mode === 'ready' ? /可以提交参会申请/u : mode === 'closed' ? /停止接收新申请/u : /服务暂时无法/u);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('artdico:registration-policy', { detail: { privacy: { processor: '合成处理者', contactEmail: 'synthetic.rights@example.invalid', purpose: '合成测试', storageRegion: '合成地区', retention: '合成期限', rightsRequest: '合成最新权利核对方式', sharing: '合成范围', version: 'synthetic-faq-v2' } } })));
    assert.equal(await primaryLabel.textContent(), mode === 'ready' ? '申请参加' : '查看申请说明', 'a content refresh does not override current application availability');
    assert.equal(await page.locator('[data-faq-id="data-rights"] .ah-faq-answer').textContent(), '合成最新权利核对方式');
    await f.refresh(); assert.equal(await page.locator('[data-faq-id="data-rights"] .ah-faq-answer').textContent(), '合成最新权利核对方式');
    assert.equal(await page.locator('[data-faq-id="data-rights"] a').textContent(), 'synthetic.rights@example.invalid');
    const lodging = page.locator('[data-faq-id="lodging-support"]'); assert.equal(await lodging.evaluate(row=>row.open),true); await lodging.locator('[data-faq-copy-email]').click();
    await lodging.getByText('邮箱已复制', { exact: true }).waitFor(); assert.deepEqual(await page.evaluate(() => window.syntheticFaqEmails), ['support@artdico.co']);
    await f.refresh(); await page.locator('[data-faq-id="custom-experience"]').waitFor({ state: 'detached' });
    assert.equal(await page.locator('[data-faq-id="data-rights"] .ah-faq-answer').textContent(), '合成最新权利核对方式');
    assert.equal(await page.locator('[data-faq-id="lodging-support"] .ah-faq-answer').textContent(), housing);
    if (mode === 'ready') {
      await form(page).locator('[data-submit]:enabled').waitFor(); await fill(page);
      await page.locator('a[data-recruit="speaker"]').click();
      assert.equal(await form(page).locator('[data-proposal-toggle]').isChecked(), true);
      assert.equal(await form(page).locator('[data-speaker-proposal]').isVisible(), true);
      assert.equal(await form(page).locator('[name=name]').inputValue(), '合成申请人'); assert.equal(await form(page).locator('[name=email]').inputValue(), 'synthetic.faq@example.invalid');
      await form(page).locator('[name="speaker.topic"]').fill('合成分享主题'); await form(page).locator('[name="speaker.summary"]').fill('合成主题简介');
      await form(page).locator('[data-application-draft-status]').filter({ hasText: /本机已暂存/u }).waitFor();
      const saved = await records(page); assert.equal(saved[0].value.proposal, true); assert.equal(saved[0].value.name, '合成申请人');
    }
    assert.equal(await page.locator('[data-recruit="site"], [data-recruit="booth"], [data-recruit="work"]').count(), 0);
    assert.equal(f.calls.some(call => call.method === 'POST'), false); assert.equal(f.runtime.messages.length, 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no overflow at ' + width);
    await page.screenshot({ path: resolve(evidence, mode + '-' + width + '.png'), fullPage: true });
    reports.push({ width, mode, liveStateSurvivesRefresh: true, privacySurvivesRefresh: true, faqOpenAndFocusPreserved: true, mailtoAndCopy: true,
      proposalRetainsInput: mode === 'ready', writes: 0 }); await f.context.close();
  }
  await legacyStaffRecovery('pending-only'); await legacyStaffRecovery('same-base-form');
  {
    const f = await fixture(390, 'ready', true), { page } = f; await form(page).locator('[data-submit]:enabled').waitFor(); await fill(page, '合成未知申请');
    await form(page).locator('[name=consentAccepted]').check(); await form(page).locator('[data-submit]').click();
    await form(page).locator('[data-submit]').filter({ hasText: /再次确认申请结果/u }).waitFor();
    assert.equal(await page.locator('[data-home-primary-apply-label]').textContent(), '核对原申请结果');
    const before = (await records(page))[0]; assert.equal(before.kind, 'pending_submission');
    await page.locator('a[data-recruit="speaker"]').click(); const after = (await records(page))[0];
    assert.equal(after.value.payloadJson, before.value.payloadJson); assert.equal(after.value.idempotencyKey, before.value.idempotencyKey);
    assert.equal(await form(page).locator('[data-proposal-toggle]').isChecked(), false); assert.equal(await form(page).locator('[data-speaker-proposal]').isVisible(), false);
    assert.equal(f.calls.filter(call => call.path.endsWith('/submit')).length, 1); assert.equal((await f.runtime.app.registrationService.repository.list()).registrations.length, 1); assert.equal(f.runtime.messages.length, 0);
    reports.push({ width: 390, pendingProposalClickLeavesExactRequestUntouched: true, savedApplications: 1, syntheticProviderCalls: 0 }); await f.context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(evidence, 'report.json'), JSON.stringify({ htmlSha256: createHash('sha256').update(html).digest('hex'), dist, reports, pageErrors: errors, realNetworkRequests: 0 }, null, 2));
  console.log(JSON.stringify({ cases: reports.length, widths: [320, 390, 1440], pageErrors: errors, report: resolve(evidence, 'report.json') }));
} finally { await browser.close(); }
