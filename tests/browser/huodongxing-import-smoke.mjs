// Compiled staff UI over isolated memory OSS. Every browser request is
// intercepted; workbook content, identities and provider responses are synthetic.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { peopleRuntimeFixture, PEOPLE_FIXTURE_API as API, PEOPLE_FIXTURE_EVENT as EVENT } from '../helpers/people-runtime-fixture.mjs';
import { CLOUD_ADMIN_PAGE_ALIASES } from '../../functions/cloud-content/http-server.mjs';
import { createXlsxWorkbook } from '../../shared/xlsx-workbook.mjs';
import { HUODONGXING_IMPORT_HEADERS as HEADERS } from '../../shared/contact-import.mjs';
import { HUODONGXING_JOURNAL_PREFIX } from '../../shared/contacts-schema.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const dist = resolve(process.env.ARTDICO_DIST_DIRECTORY || resolve(project, 'dist'));
const evidence = resolve(process.env.ARTDICO_HUODONGXING_EVIDENCE_DIRECTORY || resolve(project, '.local-data/browser-evidence/huodongxing-import'));
const { chromium } = await import(process.env.ARTDICO_PLAYWRIGHT_MODULE || 'playwright-core');
const aliases = new Map(CLOUD_ADMIN_PAGE_ALIASES), reports = [], errors = [];
let fixtureOrdinal = 0;
const sourceCommit = process.env.ARTDICO_SOURCE_COMMIT || process.env.GITHUB_SHA || (await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: project, encoding: 'utf8', maxBuffer: 4096 })).stdout.trim();
assert.match(sourceCommit, /^[a-f0-9]{40}$/u);
const sourceTreeClean = !(await promisify(execFile)('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: project, encoding: 'utf8', maxBuffer: 128 * 1024 })).stdout.trim();
const IMPORT = '/api/admin/contacts/import', PREVIEW = IMPORT + '/preview';
const MAIL = '/api/admin/registration-confirmation/dispatch', MAIL_PREVIEW = '/api/admin/registration-confirmation/preview';
const mime = file => ({ html: 'text/html', mjs: 'text/javascript', js: 'text/javascript', css: 'text/css', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml', woff2: 'font/woff2' })[extname(file).slice(1)] || 'application/octet-stream';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const writes = f => f.runtime.objects.calls.filter(call => call.operation !== 'get').length;
function ticket(index, { name = '合成活动行来宾' + index, email = 'synthetic.hdx.' + index + '@example.invalid', status = '有效票' } = {}) {
  return ['synthetic-hdx-' + String(index).padStart(4, '0'), '000' + index, '000-order-' + index, '合成免费票', '0', '2026-12-05', name, email,
    '001388000' + String(index).padStart(3, '0'), '2026-10-20 09:15:00', '', status, 'PRIVATE_SYNTHETIC_METHOD', 'PRIVATE_SYNTHETIC_NOTE', '', '', '', '', 'synthetic_wechat_' + index];
}
function workbook(rows, headers = [...HEADERS]) {
  return { name: 'synthetic-huodongxing.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(createXlsxWorkbook([{ name: 'Synthetic tickets', headers, rows }])) };
}
async function fixture(browser, { width = 390, role = 'owner', existing = false, partialAck = false, capacity = 20 } = {}) {
  const controls = { mailOutcome: 'accepted', partialAck, ledgerAppends: 0, lostLedgerAck: false };
  const runtime = await peopleRuntimeFixture({ capacity, mail: true, attendeeReviewRequired: false, mailResult: () => controls.mailOutcome });
  const settings = await runtime.app.confirmationService.settings({ actor: runtime.users[0] });
  const paused = await runtime.app.confirmationService.setSettings({ actor: runtime.users[0], expectedRevision: settings.revision, operationId: 'h'.repeat(43), enabled: false });
  const prior = existing ? await runtime.seedPublic({ intake: 'general-v2', name: '合成网站报名', email: 'shared.synthetic@example.invalid' }) : null;
  await runtime.app.confirmationService.setSettings({ actor: runtime.users[0], expectedRevision: paused.revision, operationId: 'j'.repeat(43), enabled: true });
  assert.equal(runtime.messages.length, 0, 'synthetic setup does not auto-send or backfill');
  const append = runtime.objects.append.bind(runtime.objects);
  runtime.objects.append = async (...args) => {
    const result = await append(...args);
    if (args[0] === HUODONGXING_JOURNAL_PREFIX + '/commits.jsonl') {
      controls.ledgerAppends++;
      // The selected row's registration and result have committed, but the
      // caller loses the second ledger acknowledgment before final completion.
      if (controls.partialAck && controls.ledgerAppends === 2) { controls.partialAck = false; controls.lostLedgerAck = true; throw new Error('SYNTHETIC_LOST_LEDGER_ACK'); }
    }
    return result;
  };
  const context = await browser.newContext({ viewport: { width, height: 960 } }), calls = [];
  const auth = await runtime.login(role), [name, ...value] = auth.Cookie.split('=');
  await context.addCookies([{ domain: new URL(API).hostname, path: '/api/admin', name, value: value.join('='), httpOnly: true, secure: true, sameSite: 'Strict' }]);
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()); assert.equal(url.origin, API, 'all browser requests stay intercepted at the synthetic API origin');
    if (url.pathname.startsWith('/api/')) {
      const call = { method: request.method(), path: url.pathname, body: request.postData() }; calls.push(call);
      assert.ok(call.method === 'GET' || call.method === 'POST' && [PREVIEW, IMPORT, MAIL_PREVIEW, MAIL, '/api/admin/logout'].includes(call.path), 'only explicitly exercised synthetic staff mutations are allowed');
      const response = await runtime.app.handle(new Request(request.url(), { method: request.method(), headers: await request.allHeaders(), ...(request.method() === 'GET' ? {} : { body: request.postData() }) }));
      call.status = response.status; const body = Buffer.from(await response.arrayBuffer());
      if ([PREVIEW, IMPORT, MAIL_PREVIEW, MAIL].includes(call.path) || call.path.startsWith(IMPORT + '/operations/')) {
        try { call.result = JSON.parse(body.toString('utf8')); } catch { /* UI must reject malformed replies. */ }
      }
      const headers = Object.fromEntries(response.headers); delete headers['content-length'];
      return route.fulfill({ status: response.status, headers, body });
    }
    const path = aliases.get(url.pathname) || url.pathname, file = resolve(dist, '.' + (path.endsWith('/') ? path + 'index.html' : path));
    assert.ok(file.startsWith(dist + '/')); return route.fulfill({ status: 200, contentType: mime(file), body: await readFile(file) });
  });
  const page = await context.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
  return { runtime, context, page, calls, controls, width, prior, auth, ordinal: ++fixtureOrdinal };
}
async function closeFixture(f) {
  // This is a diagnostic of the last UI state, not a passing receipt. Capture
  // it before closing even when a preceding assertion throws.
  try { if (!f.page.isClosed()) await f.page.screenshot({ path: resolve(evidence, 'diagnostic-final-' + f.ordinal + '-' + f.width + '.png'), fullPage: false }); } catch { /* Preserve the original test failure. */ }
  await f.context.close();
}
const posts = (f, path) => f.calls.filter(call => call.method === 'POST' && call.path === path);
async function idle(page) { await page.locator('[data-hdx-open]:enabled').waitFor({ state: 'attached' }); }
async function loaded(page) { await page.locator('[data-directory-status]').filter({ hasText: '符合筛选' }).waitFor(); }
async function open(f) {
  await f.page.goto(API + '/admin/contacts/', { waitUntil: 'networkidle' }); await loaded(f.page);
  await f.page.locator('[data-hdx-open]').click(); await f.page.locator('[data-hdx-dialog]').waitFor({ state: 'visible' });
}
async function pick(f, file) { await f.page.locator('[data-hdx-file]').setInputFiles(file); await f.page.locator('[data-hdx-preview]').waitFor({ state: 'visible' }); await idle(f.page); }
const checkbox = (page, tid) => page.locator('[data-hdx-tid="' + tid + '"]');
const rowFor = (page, tid) => page.locator('[data-hdx-rows] li').filter({ has: checkbox(page, tid) });
async function attest(page) { await page.locator('[data-hdx-source-confirm]').check(); assert.equal(await page.locator('[data-hdx-commit]').isDisabled(), true, 'one attestation is insufficient'); await page.locator('[data-hdx-permission-confirm]').check(); }
async function completed(f) { await f.page.locator('[data-hdx-status]').filter({ hasText: '本批已核对' }).waitFor(); await idle(f.page); }
async function noOverflow(page) { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true); assert.equal(await page.locator('[data-hdx-dialog]').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true); }
async function closeClean(f, privateTexts) {
  await f.page.locator('[data-hdx-close]').first().click();
  assert.equal(await f.page.locator('[data-hdx-dialog]').isVisible(), false);
  const text = await f.page.locator('[data-hdx-dialog]').textContent(); for (const privateText of privateTexts.filter(Boolean)) assert.equal(text.includes(privateText), false, 'closed import dialog clears previously displayed private fields');
  for (const selector of ['rows', 'results', 'mail-rows', 'mail-results', 'mail-subject', 'mail-text']) assert.equal(await f.page.locator('[data-hdx-' + selector + ']').textContent(), '');
  assert.equal(await f.page.locator('[data-hdx-file]').inputValue(), '');
}
async function screenshot(f, name) { const path = resolve(evidence, name + '.png'); await f.page.screenshot({ path, fullPage: false }); return path; }

await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.ARTDICO_CHROMIUM_BINARY || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  for (const width of [390, 1440]) {
    const f = await fixture(browser, { width, existing: true });
    try {
      await open(f);
      const rows = [ticket(1), ticket(2, { name: '合成共享邮箱不同人', email: 'shared.synthetic@example.invalid' }), ticket(3, { name: '合成关联已有报名', email: 'shared.synthetic@example.invalid' }), ticket(4, { status: '已取消' }), ticket(5, { name: '', email: '' })];
      const file = workbook(rows), baseline = writes(f); await pick(f, file);
      assert.equal(writes(f), baseline, 'preview is read-only'); assert.equal(f.runtime.messages.length, 0);
      assert.equal(await f.page.locator('[data-hdx-tid]:checked').count(), 0);
      for (const selector of ['source-confirm', 'permission-confirm']) assert.equal(await f.page.locator('[data-hdx-' + selector + ']').isChecked(), false);
      assert.match(await f.page.locator('[data-hdx-summary]').textContent(), /新增 1 · 已有 0 · 需核对 4/u);
      assert.equal(await f.page.locator('[data-hdx-rows] input').first().getAttribute('data-hdx-tid'), rows[1][0], 'reviewable rows precede ordinary new rows');
      assert.equal(await checkbox(f.page, rows[3][0]).isDisabled(), true); assert.equal(await checkbox(f.page, rows[4][0]).isDisabled(), true);
      assert.match(await rowFor(f.page, rows[3][0]).textContent(), /原票务状态需核对/u); assert.match(await rowFor(f.page, rows[4][0]).textContent(), /缺少姓名/u);
      assert.equal(await checkbox(f.page, rows[1][0]).isDisabled(), true, 'a matching email cannot silently select a person');
      assert.equal(await rowFor(f.page, rows[1][0]).locator('select').inputValue(), '');
      await rowFor(f.page, rows[1][0]).locator('select').selectOption('separate'); await checkbox(f.page, rows[1][0]).check();
      await rowFor(f.page, rows[2][0]).locator('select').selectOption(f.prior.reference_code); await checkbox(f.page, rows[2][0]).check(); await checkbox(f.page, rows[0][0]).check();
      assert.equal(await f.page.locator('[data-hdx-commit]').isDisabled(), true); await attest(f.page); await noOverflow(f.page);
      const previewShot = await screenshot(f, 'preview-' + width); await f.page.locator('[data-hdx-commit]').click(); await completed(f);
      const committed = posts(f, IMPORT); assert.equal(committed.length, 1); const receipt = committed[0].result;
      assert.equal(receipt.finished, true); assert.equal(receipt.registrationIds.length, 3); assert.equal(new Set(receipt.registrationIds).size, 3);
      assert.equal(receipt.results.find(row => row.tid === rows[2][0]).registrationId, f.prior.reference_code, 'explicit canonical linking reuses the existing participant');
      const command = JSON.parse(committed[0].body); assert.deepEqual(command.separateTids, [rows[1][0]]); assert.deepEqual(command.links, [{ tid: rows[2][0], registrationId: f.prior.reference_code }]);
      assert.equal(command.confirmSource, true); assert.equal(command.confirmPermission, true); assert.equal(f.runtime.messages.length, 0, 'synchronization never sends mail');
      const links = await f.page.locator('[data-hdx-results] a').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
      assert.ok(links.every(href => /^\/admin\/person\/#registration=[A-Za-z0-9_-]{43}$/u.test(href)));
      const admission = await f.runtime.app.registrationService.getAdmissions({ actor: f.runtime.users[0] }); assert.equal(admission.people.filter(person => person.status === 'confirmed').length, 3, 'shared email does not merge a different person or double-count an explicit link');
      await f.page.locator('[data-hdx-mail-preview]').click(); await f.page.locator('section[data-hdx-mail]').waitFor({ state: 'visible' }); await idle(f.page);
      assert.equal(await f.page.locator('input[data-hdx-mail]:checked').count(), 0); assert.equal(await f.page.locator('[data-hdx-mail-send]').isDisabled(), true); assert.equal(f.runtime.messages.length, 0);
      await f.page.locator('[data-hdx-mail-select]').click(); const eligible = await f.page.locator('input[data-hdx-mail]:checked').count(); assert.ok(eligible >= 1 && eligible <= 3);
      assert.equal(f.runtime.messages.length, 0, 'selecting recipients is not sending'); await f.page.locator('[data-hdx-mail-send]').click(); await f.page.locator('[data-hdx-status]').filter({ hasText: '已取得本批寄送回执' }).waitFor(); await idle(f.page);
      assert.equal(f.runtime.messages.length, eligible); assert.equal(posts(f, MAIL).length, 1);
      const resultShot = await screenshot(f, 'completed-' + width); await noOverflow(f.page);
      await closeClean(f, rows.map(row => row[6]).concat(rows.map(row => row[7]))); await f.page.locator('[data-hdx-open]').click();
      assert.equal(await f.page.locator('[data-hdx-preview]').isVisible(), false); const after = writes(f); await pick(f, file);
      assert.match(await f.page.locator('[data-hdx-summary]').textContent(), /已有 3/u); assert.equal(await f.page.locator('[data-hdx-tid]:checked').count(), 0); assert.equal(writes(f), after, 'same-source reimport preview never creates more registrations');
      await closeClean(f, rows.map(row => row[6]));
      reports.push({ case: 'explicit-import-and-formal-mail', width, defaultSelection: 0, independentAttestations: true, problemsFirst: true, sharedEmailExplicitSeparateAndCanonicalLink: true, importedRows: 3, canonicalPeople: 3, importMessages: 0, mockMessages: eligible, reimportReadOnly: true, closeClearsPrivateDOM: true, screenshots: [previewShot, resultShot] });
    } finally { await closeFixture(f); }
  }

  {
    const f = await fixture(browser, { capacity: 1 });
    try {
      await open(f); const rows = [ticket(61), ticket(62)], file = workbook(rows); await pick(f, file);
      await checkbox(f.page, rows[0][0]).check(); await checkbox(f.page, rows[1][0]).check(); await attest(f.page);
      await f.page.locator('[data-hdx-commit]').click(); await completed(f);
      assert.equal(posts(f, IMPORT).length, 1); const receipt = posts(f, IMPORT)[0].result;
      assert.equal(receipt.status, 'partial'); assert.equal(receipt.finished, true); assert.equal(receipt.registrationIds.length, 1);
      assert.equal(receipt.results.filter(row => row.status === 'imported').length, 1);
      const failed = receipt.results.find(row => row.status === 'capacity_conflict'); assert.ok(failed); assert.equal(failed.registrationId, null);
      assert.equal(await f.page.locator('[data-hdx-results] li').count(), 2);
      assert.match(await f.page.locator('[data-hdx-results]').textContent(), /已导入/u); assert.match(await f.page.locator('[data-hdx-results]').textContent(), /名额需核对/u);
      assert.doesNotMatch(await f.page.locator('[data-hdx-status]').textContent(), /全部(?:导入|成功)|2人(?:均|已)成功/u);
      assert.equal(await f.page.locator('[data-hdx-results] a').count(), 1); assert.equal(await f.page.locator('[data-hdx-pending]').isVisible(), false, 'a finished capacity conflict is not an ambiguous operation to resume');
      await f.page.locator('[data-hdx-mail-preview]').click(); await f.page.locator('section[data-hdx-mail]').waitFor({ state: 'visible' }); await idle(f.page);
      assert.equal(posts(f, MAIL_PREVIEW).length, 1); assert.deepEqual(JSON.parse(posts(f, MAIL_PREVIEW)[0].body).registrationIds, receipt.registrationIds);
      assert.equal(await f.page.locator('input[data-hdx-mail]').count(), 1); assert.equal(await f.page.locator('input[data-hdx-mail]:checked').count(), 0);
      assert.equal(posts(f, IMPORT).length, 1); assert.equal(posts(f, MAIL).length, 0); assert.equal(f.runtime.messages.length, 0); await noOverflow(f.page);
      reports.push({ case: 'finished-capacity-conflict', width: 390, capacity: 1, selected: 2, imported: 1, failedResultNullCanonical: true, knownPartialNotResumed: true, mailPreviewOnlyConfirmed: 1, importPosts: 1, mockMessages: 0, screenshot: await screenshot(f, 'capacity-partial') });
    } finally { await closeFixture(f); }
  }

  {
    const f = await fixture(browser, { partialAck: true });
    try {
      await open(f); const row = ticket(11), peer = ticket(12), file = workbook([row, peer]); await pick(f, file); await checkbox(f.page, row[0]).check(); await checkbox(f.page, peer[0]).check(); await attest(f.page); await f.page.locator('[data-hdx-commit]').click();
      await f.page.locator('[data-hdx-pending]').waitFor({ state: 'visible' }); await idle(f.page); assert.equal(f.controls.lostLedgerAck, true); assert.equal(posts(f, IMPORT).length, 1); assert.equal(f.runtime.messages.length, 0);
      const original = posts(f, IMPORT)[0].body, saved = await f.page.evaluate(event => sessionStorage.getItem('artdico:huodongxing:v1:' + event), EVENT);
      assert.ok(saved); assert.equal(saved.includes('sourceFileBase64'), false); assert.equal(saved.includes(row[6]), false); assert.equal(saved.includes(row[7]), false, 'recovery metadata does not persist participant content');
      await f.page.reload({ waitUntil: 'networkidle' }); await loaded(f.page); await f.page.locator('[data-hdx-open]').click(); await f.page.locator('[data-hdx-pending]').waitFor({ state: 'visible' }); await idle(f.page);
      assert.equal(posts(f, IMPORT).length, 1, 'reopening pending import never posts'); assert.equal(await f.page.locator('[data-hdx-resume]').isDisabled(), true, 'reload requires the same original file before resuming');
      const beforeLookup = writes(f); await f.page.locator('[data-hdx-lookup]').click(); await idle(f.page); assert.equal(writes(f), beforeLookup, 'lookup performs no business write'); assert.equal(posts(f, IMPORT).length, 1);
      await f.page.locator('[data-hdx-file]').setInputFiles(file); await f.page.locator('[data-hdx-resume]:enabled').waitFor(); await idle(f.page); assert.equal(posts(f, IMPORT).length, 1);
      await f.page.locator('[data-hdx-resume]').click(); await completed(f); assert.equal(posts(f, IMPORT).length, 2); assert.equal(posts(f, IMPORT)[1].body, original, 'only an explicit exact-body same-operation resume may post again');
      assert.equal((await f.runtime.app.registrationService.getAdmissions({ actor: f.runtime.users[0] })).people.filter(person => person.status === 'confirmed').length, 2); assert.equal(f.runtime.messages.length, 0);
      assert.ok(f.calls.some(call => call.method === 'GET' && call.path.startsWith(IMPORT + '/operations/'))); await noOverflow(f.page);
      reports.push({ case: 'cross-journal-lost-ack', width: 390, reloadPosts: 0, lookupWrites: 0, explicitSameFileResume: true, exactOriginalBody: true, canonicalPeople: 2, mockMessages: 0, screenshot: await screenshot(f, 'import-unknown') });
    } finally { await closeFixture(f); }
  }

  {
    const f = await fixture(browser);
    try {
      await open(f); const row = ticket(21), file = workbook([row]); await pick(f, file); await checkbox(f.page, row[0]).check(); await attest(f.page); await f.page.locator('[data-hdx-commit]').click(); await completed(f);
      await f.page.locator('[data-hdx-mail-preview]').click(); await f.page.locator('section[data-hdx-mail]').waitFor({ state: 'visible' }); await idle(f.page); await f.page.locator('[data-hdx-mail-select]').click(); f.controls.mailOutcome = 'unknown';
      await f.page.locator('[data-hdx-mail-send]').click(); await f.page.locator('[data-hdx-mail-pending]').waitFor({ state: 'visible' }); await idle(f.page); assert.equal(f.runtime.messages.length, 1); assert.equal(posts(f, MAIL).length, 1);
      const before = writes(f); await f.page.locator('[data-hdx-mail-lookup]').click(); await idle(f.page); assert.equal(writes(f), before); assert.equal(f.runtime.messages.length, 1); assert.equal(posts(f, MAIL).length, 1);
      await closeClean(f, [row[6], row[7]]); await f.page.locator('[data-hdx-open]').click(); await f.page.locator('[data-hdx-mail-pending]').waitFor({ state: 'visible' }); await idle(f.page); await f.page.locator('[data-hdx-mail-lookup]').click(); await idle(f.page); assert.equal(posts(f, MAIL).length, 1); assert.equal(f.runtime.messages.length, 1);
      await closeClean(f, [row[6], row[7]]); await f.page.locator('[data-contacts-logout]').click(); await f.page.locator('[data-contacts-login-panel]').waitFor({ state: 'visible' });
      assert.equal(await f.page.evaluate(event => sessionStorage.getItem('artdico:huodongxing:v1:' + event), EVENT), null); assert.equal(await f.page.locator('[data-hdx-dialog]').textContent().then(text => text.includes(row[7])), false);
      reports.push({ case: 'unknown-mail-read-only', width: 390, providerRequests: 1, dispatchPosts: 1, repeatedLookupWrites: 0, closeClearsPrivateDOM: true, logoutClearsPending: true, realMail: 0 });
    } finally { await closeFixture(f); }
  }

  {
    const f = await fixture(browser, { role: 'reviewer' });
    try {
      const before = writes(f); await f.page.goto(API + '/admin/contacts/', { waitUntil: 'networkidle' }); await loaded(f.page);
      assert.equal(await f.page.locator('[data-hdx-open]').isVisible(), false); await f.page.locator('[data-hdx-open]').evaluate(el => el.click()); await f.page.locator('[data-hdx-file]').setInputFiles(workbook([ticket(31)]));
      await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(posts(f, PREVIEW).length, 0); assert.equal(posts(f, IMPORT).length, 0); assert.equal(f.calls.some(call => call.path === '/api/admin/contacts'), false); assert.equal(writes(f), before); assert.equal(f.runtime.messages.length, 0);
      reports.push({ case: 'reviewer-cannot-import', width: 390, hiddenEntry: true, forcedDOMEventPosts: 0, contactReads: 0, businessWrites: 0, mockMessages: 0 });
    } finally { await closeFixture(f); }
  }

  {
    const f = await fixture(browser);
    try {
      await open(f); const row = ticket(41), headers = [...HEADERS]; headers[7] = 'unverified-email-header'; const before = writes(f);
      await f.page.locator('[data-hdx-file]').setInputFiles(workbook([row], headers)); await f.page.locator('[data-hdx-error]').waitFor({ state: 'visible' }); await idle(f.page); assert.equal(posts(f, PREVIEW).length, 0); assert.equal(writes(f), before);
      const sameFilePeer = ticket(42, { email: row[7] }); await pick(f, workbook([row, sameFilePeer])); assert.equal(posts(f, PREVIEW).length, 1);
      const sourcePreview = posts(f, PREVIEW)[0].result; assert.ok(sourcePreview.rows.every(item => item.reason === 'POSSIBLE_DUPLICATE' && item.candidates.length === 0));
      for (const ticketRow of [row, sameFilePeer]) {
        assert.equal(await checkbox(f.page, ticketRow[0]).isDisabled(), true, 'matching source rows require an explicit different-person choice even without existing candidates');
        assert.equal(await rowFor(f.page, ticketRow[0]).locator('select').inputValue(), '');
        await rowFor(f.page, ticketRow[0]).locator('select').selectOption('separate'); assert.equal(await checkbox(f.page, ticketRow[0]).isDisabled(), false);
      }
      assert.equal(await f.page.locator('[data-hdx-tid]:checked').count(), 0); await f.page.keyboard.press('Escape');
      assert.equal(await f.page.locator('[data-hdx-dialog]').isVisible(), false); assert.equal(await f.page.locator('[data-hdx-rows]').textContent(), ''); assert.equal(await f.page.locator('[data-hdx-file]').inputValue(), '');
      await f.page.locator('[data-hdx-open]').click(); assert.equal(await f.page.locator('[data-hdx-preview]').isVisible(), false); assert.equal(await f.page.locator('[data-hdx-summary]').textContent(), ''); assert.equal(f.runtime.messages.length, 0);
      reports.push({ case: 'invalid-source-and-escape', width: 390, exactHeadersRequired: true, invalidSourcePosts: 0, previewReadOnly: true, sameFilePeersNeedExplicitChoiceWithoutExistingCandidates: true, escapeClearsPrivateDOM: true, reopenedEmpty: true, mockMessages: 0 });
    } finally { await closeFixture(f); }
  }
  assert.equal(reports.length, 7); assert.deepEqual(errors, []);
  const result = { ok: true, cases: reports.length, sourceCommit, sourceTreeClean, sourceQualification: sourceTreeClean ? 'clean-checkout' : 'local-working-tree-not-exact-commit-proof', scriptSha256: hash(await readFile(fileURLToPath(import.meta.url))), publicHtmlSha256: hash(await readFile(resolve(dist, 'index.html'))), contactsHtmlSha256: hash(await readFile(resolve(dist, 'admin/contacts/index.html'))), reports, pageErrors: errors, realMail: 0, realBusinessWrites: 0, uninterceptedNetwork: 0 };
  await writeFile(resolve(evidence, 'report.json'), JSON.stringify(result, null, 2) + '\n');
  process.stdout.write('Huodongxing import browser verified: ' + JSON.stringify({ ...result, reports: undefined }) + '\n');
} finally { await browser.close(); }
