// Built-page regression over the actual isolated runtime and admission CAS.
// Every request is intercepted; only synthetic memory OSS/provider data is used.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const project = fileURLToPath(new URL('../../', import.meta.url));
const source = resolve(process.env.ARTDICO_SOURCE_DIRECTORY || project);
const dist = resolve(process.env.ARTDICO_DIST_DIRECTORY || resolve(source, 'dist'));
const evidence = resolve(process.env.ARTDICO_EVIDENCE_DIRECTORY || resolve(source, '.local-data/browser-evidence/registration-auto-ui'));
const { chromium } = await import(process.env.ARTDICO_PLAYWRIGHT_MODULE || 'playwright-core');
const { peopleRuntimeFixture } = await import(pathToFileURL(resolve(source, 'tests/helpers/people-runtime-fixture.mjs')));
const SITE = 'https://artdico.host', API = 'https://api.artdico.host', EVENT = 'ggj-cn-2026';
const NOW = '2026-10-21T09:00:00.000Z', reports = [], errors = [];
const html = await readFile(resolve(dist, 'index.html'));
const publicHtmlSha256 = createHash('sha256').update(html).digest('hex');
const scriptSha256 = createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex');
const sourceCommit = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8',
  env: { PATH: process.env.PATH ?? '', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' } }).trim();
assert.match(sourceCommit, /^[a-f0-9]{40}$/u);
const servedAssets = new Map();
const mime = file => ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml',
  '.woff': 'font/woff', '.woff2': 'font/woff2' })[extname(file)] || 'application/octet-stream';
const browser = await chromium.launch({ executablePath: process.env.ARTDICO_CHROMIUM_BINARY || '/usr/bin/chromium',
  headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const cors = { 'access-control-allow-origin': SITE, 'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'Content-Type,Idempotency-Key,X-Registration-Token' };
const json = (value, status = 200) => ({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(value) });
const form = page => page.locator('[data-registration-form]');

async function fixture({ width = 390, flag = false, omitFlag = false, capacity = 3, fillCapacity = false, loseFirstAck = false, restoreBrowserCheckbox = false } = {}) {
  const initialReview = omitFlag || typeof flag !== 'boolean' ? true : flag;
  const runtime = await peopleRuntimeFixture({ capacity, mail: false, attendeeReviewRequired: initialReview });
  const initialMetadata = await runtime.app.registrationService.metadata();
  if (fillCapacity) await runtime.seedPublic({ intake: 'general-v2', name: '合成既有参与者', email: 'synthetic.first@example.invalid' });
  const context = await browser.newContext({ viewport: { width, height: 940 } }), calls = [];
  let reviewFlag = initialReview, privacyVersion = initialMetadata.privacy.version, lose = loseFirstAck, app = runtime.app;
  const reconfigure = () => { app = runtime.make({ policyOverride: { attendeeReviewRequired: reviewFlag,
    privacy: { ...initialMetadata.privacy, version: privacyVersion } } }); };
  if (restoreBrowserCheckbox) await context.addInitScript(() => {
    const observer = new MutationObserver(() => {
      const proposal = document.querySelector('[data-proposal-toggle]');
      if (!proposal) return;
      proposal.checked = true; window.syntheticRestoredCheckbox = true; observer.disconnect();
    });
    observer.observe(document, { subtree: true, childList: true });
  });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    assert.ok([SITE, API].includes(url.origin), 'every request must remain intercepted');
    if (url.origin === API) {
      assert.ok(url.pathname.startsWith('/api/'));
      const headers = await request.allHeaders(); assert.equal(headers.cookie, undefined);
      if (request.method() === 'OPTIONS') {
        const response = await app.handle(new Request(request.url(), { method: request.method(), headers }));
        return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: '' });
      }
      calls.push({ method: request.method(), path: url.pathname, body: request.postData(), headers });
      const response = await app.handle(new Request(request.url(), { method: request.method(), headers,
        ...(['GET', 'HEAD'].includes(request.method()) ? {} : { body: request.postData() }) }));
      let bytes = Buffer.from(await response.arrayBuffer());
      if (url.pathname === '/api/admin/registration/config' && (omitFlag || typeof flag !== 'boolean')) {
        const metadata = JSON.parse(bytes);
        if (omitFlag) delete metadata.attendeeReviewRequired; else metadata.attendeeReviewRequired = flag;
        bytes = Buffer.from(JSON.stringify(metadata));
      }
      if (url.pathname === '/api/admin/registration/submit') {
        // The real service has committed before its acknowledgement is lost.
        if (lose) { lose = false; return route.fulfill(json({ error: { code: 'UNAVAILABLE' } }, 503)); }
      }
      const responseHeaders = Object.fromEntries(response.headers); delete responseHeaders['content-length'];
      return route.fulfill({ status: response.status, headers: responseHeaders, body: bytes });
    }
    if (url.pathname.startsWith('/__test_source__/')) {
      const relative = url.pathname.slice('/__test_source__/'.length);
      assert.match(relative, /^(?:src\/lib|shared)\/[A-Za-z0-9_./-]+\.mjs$/u);
      const file = resolve(source, relative); assert.ok(file.startsWith(source + '/'));
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: await readFile(file) });
    }
    const file = resolve(dist, '.' + (url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname));
    assert.ok(file.startsWith(dist + '/'));
    try {
      const bytes = await readFile(file);
      servedAssets.set(url.pathname, { path: url.pathname, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      return route.fulfill({ status: 200, contentType: mime(file), body: bytes });
    }
    catch { return route.fulfill({ status: 404, body: '' }); }
  });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  await page.clock.setFixedTime(new Date(NOW));
  page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => { void dialog.accept(); });
  await page.goto(SITE + '/#registration', { waitUntil: 'networkidle' });
  await form(page).locator('[data-submit]:enabled').waitFor();
  await page.locator('[data-registration-form][data-registration-mode=production]').waitFor();
  return { page, context, calls, width, runtime, get app() { return app; }, initialPrivacyVersion: privacyVersion,
    setFlag: value => { reviewFlag = value; reconfigure(); }, setPrivacyVersion: value => { privacyVersion = value; reconfigure(); } };
}
async function fill(page) {
  await form(page).locator('[name=name]').fill('合成报名人');
  await form(page).locator('[name=email]').fill('synthetic.auto-ui@example.invalid');
  await form(page).locator('[name=categories]').selectOption('student');
}
async function records(page) {
  return page.evaluate(() => new Promise((resolveRecords, reject) => {
    const request = indexedDB.open('artdico-browser-drafts-v1', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { const db = request.result, tx = db.transaction('drafts', 'readonly'), read = tx.objectStore('drafts').getAll();
      read.onsuccess = () => resolveRecords(read.result); read.onerror = () => reject(read.error); tx.oncomplete = () => db.close(); };
  }));
}
async function submit(page) {
  await form(page).locator('[name=consentAccepted]').check(); await form(page).locator('[data-submit]').click();
  await page.waitForURL(url => url.origin === SITE && url.pathname === '/registration/confirmation/' && url.hash.startsWith('#r='));
  await page.locator('[data-confirmation-content]:visible').waitFor();
}
async function assertAutomatic(page) {
  assert.equal(await page.locator('[data-registration-heading]').textContent(), '报名参加。');
  assert.equal(await form(page).locator('[data-submit]').textContent(), '提交报名');
  assert.equal(await page.locator('[data-home-primary-apply-label]').first().textContent(), '报名参加');
  assert.doesNotMatch(await page.locator('[data-registration-notice]').textContent(), /人工审核|主办方审核/u);
  assert.doesNotMatch(await page.locator('[data-registration-disclaimer]').textContent(), /等待审核/u);
  assert.match(await page.locator('[data-registration-disclaimer]').textContent(), /名额用完将登记候补/u);
  assert.doesNotMatch(await page.locator('#field-email-hint').textContent(), /审核后/u);
  assert.match(await page.locator('[data-faq-id=registration-status] .ah-faq-answer').textContent(), /直接在本站报名.*分享提案另行审选/u);
}

try {
  await mkdir(evidence, { recursive: true });
  for (const width of [320, 390, 768, 1440]) {
    const f = await fixture({ width, restoreBrowserCheckbox: true }); await assertAutomatic(f.page);
    assert.equal(await f.page.evaluate(() => window.syntheticRestoredCheckbox), true);
    assert.equal(await form(f.page).locator('[data-proposal-toggle]').isChecked(), false, 'new forms reset browser-restored checkbox state');
    assert.equal(await form(f.page).locator('[data-speaker-proposal]').isVisible(), false);
    await fill(f.page);
    assert.equal(await form(f.page).locator('[data-proposal-toggle]').isChecked(), false, 'changing identity does not select a proposal');
    await submit(f.page);
    assert.match(await f.page.locator('[data-confirmation-heading]').textContent(), /参会名额已确认/u);
    const sent = JSON.parse(f.calls.find(call => call.path.endsWith('/submit')).body);
    assert.deepEqual(sent.fields.participationInterests, ['attend']); assert.equal(Object.hasOwn(sent.fields, 'speaker'), false);
    const admissions = await f.app.registrationService.getAdmissions({ actor: f.runtime.users[0] });
    assert.equal(admissions.summary.confirmedCount, 1); assert.equal(admissions.summary.pendingReviewCount, 0);
    assert.equal((await f.app.registrationService.repository.list()).registrations.length, 1);
    assert.equal(f.runtime.messages.length, 0, 'mail remains disabled in this UI fixture');
    assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await f.page.screenshot({ path: resolve(evidence, 'automatic-confirmed-' + width + '.png'), fullPage: true });
    reports.push({ width, mode: 'automatic', receipt: 'confirmed', freshProposal: false, realNetworkRequests: 0 }); await f.context.close();
  }
  for (const options of [{ flag: true }, { omitFlag: true }, { flag: 'false' }]) {
    const f = await fixture(options);
    assert.equal(await f.page.locator('[data-registration-mode-label]').textContent(), '人工审核');
    assert.equal(await form(f.page).locator('[data-submit]').textContent(), '提交参会申请');
    assert.match(await f.page.locator('[data-faq-id=registration-status] .ah-faq-answer').textContent(), /人工审核/u);
    await fill(f.page); await submit(f.page);
    assert.match(await f.page.locator('[data-confirmation-heading]').textContent(), /待审核/u);
    assert.equal(await f.page.locator('[data-confirmation-group]').isVisible(), false);
    assert.equal(await f.page.locator('[data-confirmation-wallet]').isVisible(), false);
    assert.equal((await f.app.registrationService.getAdmissions({ actor: f.runtime.users[0] })).summary.pendingReviewCount, 1);
    reports.push({ mode: 'review-fallback', flag: options.omitFlag ? 'missing' : options.flag, receipt: 'pending_review' }); await f.context.close();
  }
  {
    const f = await fixture({ capacity: 1, fillCapacity: true }); await assertAutomatic(f.page); await fill(f.page); await submit(f.page);
    assert.match(await f.page.locator('[data-confirmation-heading]').textContent(), /候补/u);
    assert.doesNotMatch(await f.page.locator('[data-confirmation-intro]').textContent(), /名额已确认|报名成功/u);
    assert.equal(await f.page.locator('[data-confirmation-group]').isVisible(), false);
    assert.equal(await f.page.locator('[data-confirmation-wallet]').isVisible(), false);
    const admissions = await f.app.registrationService.getAdmissions({ actor: f.runtime.users[0] });
    assert.equal(admissions.summary.confirmedCount, 1); assert.equal(admissions.summary.waitlistCount, 1);
    reports.push({ mode: 'automatic', receipt: 'waitlisted', fabricatedTicket: false }); await f.context.close();
  }
  {
    const f = await fixture(); await fill(f.page);
    await f.page.locator('a[data-recruit=speaker]').click();
    assert.equal(await form(f.page).locator('[data-proposal-toggle]').isChecked(), true);
    await form(f.page).locator('[name="speaker.topic"]').fill('合成分享主题');
    await form(f.page).locator('[name="speaker.summary"]').fill('合成分享简介');
    await form(f.page).locator('[data-application-draft-status]').filter({ hasText: '本机已暂存' }).waitFor();
    await f.page.reload({ waitUntil: 'networkidle' }); await form(f.page).locator('[data-submit]:enabled').waitFor();
    assert.equal(await form(f.page).locator('[data-proposal-toggle]').isChecked(), true, 'an intentional editing draft restores its selection');
    assert.match(await form(f.page).locator('[data-application-draft-status]').textContent(), /已恢复本机草稿.*分享提案/u);
    assert.equal(await form(f.page).locator('[name="speaker.topic"]').inputValue(), '合成分享主题');
    await submit(f.page);
    const sent = JSON.parse(f.calls.find(call => call.path.endsWith('/submit')).body);
    assert.deepEqual(sent.fields.participationInterests, ['attend', 'talk']);
    assert.match(await f.page.locator('[data-confirmation-heading]').textContent(), /名额已确认/u);
    assert.equal((await f.app.registrationService.getAdmissions({ actor: f.runtime.users[0] })).summary.confirmedCount, 1);
    reports.push({ explicitProposalRestored: true, automaticAttendanceIndependentFromProposalSelection: true }); await f.context.close();
  }
  {
    const f = await fixture({ flag: true, loseFirstAck: true }); await fill(f.page);
    await f.page.locator('a[data-recruit=speaker]').click();
    await form(f.page).locator('[name="speaker.topic"]').fill('合成原提案'); await form(f.page).locator('[name="speaker.summary"]').fill('合成原提案简介');
    await form(f.page).locator('[name=consentAccepted]').check(); await form(f.page).locator('[data-submit]').click();
    await form(f.page).locator('[data-submit]').filter({ hasText: '再次确认申请结果' }).waitFor();
    const original = (await records(f.page)).find(row => row.kind === 'pending_submission'); assert.ok(original);
    assert.equal((await f.app.registrationService.getAdmissions({ actor: f.runtime.users[0] })).summary.pendingReviewCount, 1);
    const first = f.calls.find(call => call.path.endsWith('/submit'));
    f.setFlag(false); f.setPrivacyVersion('notice-auto-ui-v2');
    const beforeReload = f.calls.length;
    await f.page.reload({ waitUntil: 'networkidle' }); await form(f.page).locator('[data-submit]:enabled').waitFor();
    assert.equal(await form(f.page).locator('[data-proposal-toggle]').isChecked(), true);
    assert.equal(await form(f.page).locator('[data-proposal-toggle]').isDisabled(), true);
    await f.page.locator('a[data-recruit=speaker]').click();
    const recovered = (await records(f.page)).find(row => row.kind === 'pending_submission');
    assert.equal(recovered.value.payloadJson, original.value.payloadJson); assert.equal(recovered.value.idempotencyKey, original.value.idempotencyKey);
    assert.equal(f.calls.filter(call => call.path.endsWith('/submit')).length, 1, 'reload and CTA do not submit');
    assert.equal(f.calls.slice(beforeReload).every(call => call.method === 'GET'), true, 'pending restoration only reads settings and publication');
    await form(f.page).locator('[data-submit]').click();
    await f.page.waitForURL(url => url.pathname === '/registration/confirmation/' && url.hash.startsWith('#r='));
    await f.page.locator('[data-confirmation-content]:visible').waitFor();
    const replay = f.calls.filter(call => call.path.endsWith('/submit')).at(-1);
    assert.equal(replay.body, first.body); assert.equal(replay.headers['idempotency-key'], first.headers['idempotency-key']);
    assert.equal(JSON.parse(replay.body).consent.version, f.initialPrivacyVersion);
    assert.match(await f.page.locator('[data-confirmation-heading]').textContent(), /待审核/u);
    assert.equal(await f.page.locator('[data-confirmation-group]').isVisible(), false);
    assert.equal((await f.app.registrationService.repository.list()).registrations.length, 1);
    const admissions = await f.app.registrationService.getAdmissions({ actor: f.runtime.users[0] });
    assert.equal(admissions.summary.confirmedCount, 0); assert.equal(admissions.summary.pendingReviewCount, 1);
    reports.push({ modeChangedToAutomatic: true, originalPendingProposalLocked: true, originalBodyAndKeyPreserved: true, receipt: 'pending_review' });
    await f.context.close();
  }
  assert.deepEqual(errors, []);
  assert.equal(reports.length, 10, 'all ten automatic registration UI cases must complete');
  const proof = { ok: true, cases: reports.length, expectedCases: 10, sourceCommit, publicHtmlSha256, scriptSha256,
    pageErrorCount: errors.length, realBusinessWrites: 0, realMail: 0, realNetwork: 0 };
  await writeFile(resolve(evidence, 'report.json'), JSON.stringify({ ...proof, source, dist, reports, pageErrors: errors,
    servedAssets: [...servedAssets.values()].sort((a, b) => a.path.localeCompare(b.path)) }, null, 2));
  console.log('Automatic registration UI browser verified: ' + JSON.stringify(proof));
} finally { await browser.close(); }
