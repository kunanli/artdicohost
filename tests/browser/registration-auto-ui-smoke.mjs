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
const PUBLIC_REGISTRATION = 'https://9525102647817.huodongxing.com/event/8884819113200';
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

async function fixture({ width = 390, flag = false, omitFlag = false, omitSpeakerMetadata = false, mode = 'speaker_only', capacity = 3, fillCapacity = false, loseFirstAck = false, mail = false } = {}) {
  const initialReview = omitFlag || typeof flag !== 'boolean' ? true : flag;
  const runtime = await peopleRuntimeFixture({ capacity, mail, attendeeReviewRequired: initialReview });
  const initialMetadata = await runtime.app.registrationService.metadata();
  if (fillCapacity) await runtime.seedPublic({ intake: 'general-v2', name: '合成既有参与者', email: 'synthetic.first@example.invalid' });
  const context = await browser.newContext({locale:'zh-CN', viewport: { width, height: 940 } }), calls = [], navigations = [];
  let reviewFlag = initialReview, registrationMode = mode, privacyVersion = initialMetadata.privacy.version, lose = loseFirstAck, app, receiptProven = false;
  const reconfigure = () => { app = runtime.make({ policyOverride: { attendeeReviewRequired: reviewFlag,
    publicRegistrationMode: registrationMode, privacy: { ...initialMetadata.privacy, version: privacyVersion } } }); };
  reconfigure();
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    assert.ok([SITE, API].includes(url.origin), 'every request must remain intercepted');
    if(request.isNavigationRequest())navigations.push({origin:url.origin,path:url.pathname});
    if (url.origin === API) {
      assert.ok(url.pathname.startsWith('/api/'));
      const headers = await request.allHeaders(); assert.equal(headers.cookie, undefined);
      if (request.method() === 'OPTIONS') {
        const response = await app.handle(new Request(request.url(), { method: request.method(), headers }));
        return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: '' });
      }
      if(receiptProven&&request.method()==='POST'&&/\/registration\/(?:token|submit)$/u.test(url.pathname))assert.fail('a proven receipt never starts another registration POST');
      const call={ method: request.method(), path: url.pathname, body: request.postData(), headers };calls.push(call);
      const response = await app.handle(new Request(request.url(), { method: request.method(), headers,
        ...(['GET', 'HEAD'].includes(request.method()) ? {} : { body: request.postData() }) }));
      let bytes = Buffer.from(await response.arrayBuffer());
      if(url.pathname.endsWith('/registration/submit')&&[200,201].includes(response.status)){call.receipt=JSON.parse(bytes);call.status=response.status;}
      if (url.pathname === '/api/admin/registration/config' && (omitFlag || typeof flag !== 'boolean' || omitSpeakerMetadata)) {
        const metadata = JSON.parse(bytes);
        if (omitFlag) delete metadata.attendeeReviewRequired; else metadata.attendeeReviewRequired = flag;
        if (omitSpeakerMetadata) { delete metadata.speakerApplicationsEnabled; delete metadata.publicRegistrationMode; }
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
      assert.ok(relative === 'src/config/event.mjs' || /^(?:src\/lib|shared)\/[A-Za-z0-9_./-]+\.mjs$/u.test(relative), 'source imports are limited to browser libraries, shared schemas and the exact public event config');
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
  await page.goto(SITE + '/#speaker-application', { waitUntil: 'networkidle' });
  await form(page).locator('[data-submit]:enabled').waitFor();
  await page.locator('[data-registration-form][data-registration-mode=production]').waitFor();
  return { page, context, calls, navigations, width, runtime, proveReceipt:()=>{receiptProven=true;}, get app() { return app; }, initialPrivacyVersion: privacyVersion,
    setFlag: value => { reviewFlag = value; reconfigure(); }, setMode: value => { registrationMode = value; reconfigure(); },
    setPrivacyVersion: value => { privacyVersion = value; reconfigure(); } };
}
async function fill(page) {
  await form(page).locator('[name=name]').fill('合成报名人');
  await form(page).locator('[name=email]').fill('synthetic.auto-ui@example.invalid');
  await form(page).locator('[name=categories]').selectOption('student');
  await form(page).locator('[name="speaker.topic"]').fill('合成讲者主题');
  await form(page).locator('[name="speaker.summary"]').fill('合成讲者简介，供隔离浏览器回归核对。');
}
async function records(page) {
  return page.evaluate(() => new Promise((resolveRecords, reject) => {
    const request = indexedDB.open('artdico-browser-drafts-v1', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { const db = request.result, tx = db.transaction('drafts', 'readonly'), read = tx.objectStore('drafts').getAll();
      read.onsuccess = () => resolveRecords(read.result); read.onerror = () => reject(read.error); tx.oncomplete = () => db.close(); };
  }));
}
async function compactReceipt(f, previousURL, admission = 'pending_review', { speaker = true } = {}) {
  const labels = { confirmed: '报名成功', pending_review: '申请已收到，待审核', waitlisted: '候补登记已保存，尚未确认名额', rejected: '本次申请未通过审核' };
  const success = f.page.locator(speaker ? '[data-speaker-application-received]' : '[data-registration-success][data-registration-success-compact]');
  await success.waitFor({ state: 'visible' });
  await f.page.waitForFunction(selector => document.activeElement === document.querySelector(selector), speaker ? '[data-speaker-application-received]' : '[data-registration-success][data-registration-success-compact]');
  assert.equal(f.page.url(), previousURL, 'a proven result keeps the original origin, path, query and hash');
  assert.equal(await success.getAttribute('role'), 'status'); assert.equal(await success.getAttribute('tabindex'), '-1');
  assert.equal((await success.innerText()).trim(), speaker ? '讲者申请已收到。筹备团队将另行联系；讲者安排与入场资格尚未确认。' : labels[admission]);
  assert.equal(await form(f.page).isVisible(), false); assert.equal(await form(f.page).locator('[data-submit]').isDisabled(), true);
  assert.equal(await f.page.locator('[data-registration-preview]').isVisible(), false);
  assert.equal(await f.page.locator('[data-registration-success-details]').isVisible(), false);
  assert.equal(await f.page.locator('[data-registration-reference]').textContent(), '');
  assert.equal(await f.page.locator('[data-registration-group-status]').textContent(), '');
  assert.equal(await f.page.locator('[data-registration-group-image] img').count(), 0);
  assert.equal(f.navigations.some(item => item.path === '/registration/confirmation/'), false);
  assert.equal(f.calls.some(item => /\/registration\/confirmation(?:\/|$)/u.test(item.path)), false, 'completion does not request a private ticket page');
  const last = f.calls.filter(call => call.path.endsWith('/registration/submit')).at(-1);
  assert.ok(last && [200, 201].includes(last.status), 'success follows a genuine committed runtime receipt');
  assert.equal(last.receipt.admissionStatus, admission);
  if (speaker) { assert.equal(admission, 'pending_review'); assert.doesNotMatch(await success.innerText(), /报名成功|参会名额已确认/u); }
  f.proveReceipt(); const posts = f.calls.filter(call => call.method === 'POST').length, mail = f.runtime.messages.length;
  await form(f.page).evaluate(node => { node.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); node.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); node.querySelector('[data-submit]').click(); });
  assert.equal(f.calls.filter(call => call.method === 'POST').length, posts, 'completed form events never start another POST');
  assert.equal(f.runtime.messages.length, mail, 'completed form events never resend mail');
  assert.equal(f.page.url(), previousURL); return last.receipt;
}
async function submit(f) {
  const previousURL = f.page.url(); await form(f.page).locator('[name=consentAccepted]').check();
  await form(f.page).locator('[data-submit]').click(); return compactReceipt(f, previousURL);
}
async function assertSpeakerForm(page) {
  assert.equal(await form(page).getAttribute('id'), 'speaker-application');
  assert.equal(await page.locator('[data-registration-heading]').textContent(), '讲者申请');
  assert.equal(await form(page).locator('[data-submit]').textContent(), '提交讲者申请');
  assert.equal(await form(page).locator('[data-proposal-toggle]').count(), 0, 'the standalone speaker form has no attendance/proposal toggle');
  assert.equal(await form(page).locator('[data-speaker-proposal]').isVisible(), true);
  for (const name of ['speaker.topic', 'speaker.summary']) {
    const input = form(page).locator('[name="' + name + '"]');
    assert.equal(await input.isVisible(), true); assert.notEqual(await input.getAttribute('required'), null);
  }
  assert.match(await page.locator('[data-registration-notice]').textContent(), /不代表确认讲者或入场资格/u);
  assert.match(await page.locator('[data-registration-disclaimer]').textContent(), /仅表示已收到讲者申请/u);
  assert.match(await page.locator('#field-email-hint').textContent(), /讲者申请/u);
  const links = page.locator('[data-general-registration]'); assert.ok(await links.count() > 0);
  for (const link of await links.all()) assert.equal(await link.getAttribute('href'), PUBLIC_REGISTRATION, 'general registration always retains the external activities URL');
  assert.equal(await page.locator('[data-home-primary-apply-label]').first().textContent(), '前往活动行报名');
  assert.match(await page.locator('[data-faq-id=registration-status] .ah-faq-answer').textContent(), /活动行/u);
}
async function assertPendingSpeaker(f, receipt, { confirmed = 0, expectedMail } = {}) {
  const admissions = await f.app.registrationService.getAdmissions({ actor: f.runtime.users[0] });
  assert.equal(admissions.summary.confirmedCount, confirmed); assert.equal(admissions.summary.pendingReviewCount, 1);
  assert.equal(admissions.summary.waitlistCount, 0, 'speaker proposals never occupy a seat or enter the attendance waitlist');
  assert.equal(receipt.confirmation.email.status, 'not_applicable'); assert.equal(receipt.groupInvite, null);
  const view = await f.app.confirmationService.confirmation({ receiptToken: receipt.confirmation.receiptToken });
  assert.equal(view.admission.status, 'pending_review'); assert.equal(view.wallet.ready, false); assert.equal(view.invitation.ready, false); assert.equal(view.groupInvite, null);
  const formal = await f.app.confirmationService.staffHistory({ actor: f.runtime.users[0], registrationId: receipt.reference_code });
  assert.deepEqual(formal.notices, [], 'no formal confirmation notice is reserved for a new speaker proposal');
  if (expectedMail !== undefined) assert.equal(f.runtime.messages.length, expectedMail);
  for (const message of f.runtime.messages) {
    if (message.template_params.reference_code !== receipt.reference_code) continue;
    assert.match(message.template_params.invitation_text, /申请已收到/u);
    assert.doesNotMatch(message.template_params.invitation_text, /你的参会名额已确认/u);
    assert.doesNotMatch(message.template_params.confirmation_actions, /apple-wallet|entry\.png|group\.png/u);
  }
  assert.equal(await f.page.locator('[data-confirmation-group],[data-confirmation-wallet]').count(), 0);
}
function assertSpeakerTokenCalls(f) {
  const tokens = f.calls.filter(call => call.path.endsWith('/registration/token'));
  assert.ok(tokens.length > 0);
  for (const call of tokens) assert.deepEqual(Object.keys(JSON.parse(call.body)).sort(), ['eventId', 'idempotencyKey', 'speakerApplication'].sort());
  for (const call of tokens) assert.equal(JSON.parse(call.body).speakerApplication, true);
}
async function repeatOriginal(f, original, admission) {
  const mail = f.runtime.messages.length;
  const response = await f.app.handle(new Request(API + '/api/admin/registration/submit', { method: 'POST', headers: original.headers, body: original.body }));
  assert.equal(response.status, 200); const receipt = await response.json(); assert.equal(receipt.admissionStatus, admission);
  assert.equal(f.runtime.messages.length, mail, 'replaying a proven original never backfills mail'); return receipt;
}

try {
  await mkdir(evidence, { recursive: true });
  for (const width of [320, 390, 768, 1440]) {
    const f = await fixture({ width, mail: true }); await assertSpeakerForm(f.page); await fill(f.page);
    for (const name of ['phone', 'wechat']) {
      const input = form(f.page).locator('[name=' + name + ']');
      assert.equal(await input.isVisible(), true, 'contacts are visible without opening optional details');
      assert.equal(await input.getAttribute('required'), null); assert.equal(await input.locator('xpath=ancestor::details').count(), 0);
    }
    assert.equal(await form(f.page).locator('[name=phone]').getAttribute('type'), 'tel');
    assert.equal(await form(f.page).locator('[name=phone]').getAttribute('inputmode'), 'tel');
    await form(f.page).locator('[name=phone]').fill('+852 0012 3456'); await form(f.page).locator('[name=wechat]').fill('synthetic-contact');
    if (width === 320) {
      // The attached saved-state barrier waits for the actual IDB commit; an
      // async waitForFunction predicate would treat its Promise as truthy.
      await form(f.page).locator('[data-application-draft-status]').filter({ hasText: '本机已暂存' }).waitFor({ state: 'attached' });
      const persisted = (await records(f.page)).find(row => row.kind === 'editing');
      assert.equal(persisted?.value.phone, '+852 0012 3456'); assert.equal(persisted?.value.wechat, 'synthetic-contact'); assert.equal(persisted?.value.proposal, true);
      await f.page.reload({ waitUntil: 'networkidle' }); await form(f.page).locator('[data-submit]:enabled').waitFor();
      assert.equal(await form(f.page).locator('[name=phone]').inputValue(), '+852 0012 3456');
      assert.equal(await form(f.page).locator('[name=wechat]').inputValue(), 'synthetic-contact');
      assert.equal(await form(f.page).locator('[name="speaker.topic"]').inputValue(), '合成讲者主题');
    }
    const receipt = await submit(f), original = f.calls.find(call => call.path.endsWith('/registration/submit')), sent = JSON.parse(original.body);
    assert.deepEqual(sent.fields.participationInterests, ['talk']);
    assert.deepEqual(sent.fields.speaker, { topic: '合成讲者主题', summary: '合成讲者简介，供隔离浏览器回归核对。' });
    assert.equal(sent.fields.phone, '+852 0012 3456'); assert.equal(sent.fields.wechat, 'synthetic-contact'); assertSpeakerTokenCalls(f);
    assert.equal((await f.app.registrationService.repository.list()).registrations.length, 1);
    const stored = (await f.app.registrationService.repository.list()).registrations[0];
    assert.equal(stored.fields.phone, sent.fields.phone); assert.equal(stored.fields.wechat, sent.fields.wechat);
    const detail = await f.app.reviewStore.detail(receipt.reference_code); assert.equal(detail.registration.fields.phone, sent.fields.phone);
    await assertPendingSpeaker(f, receipt, { expectedMail: 1 });
    await repeatOriginal(f, original, 'pending_review');
    assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await f.page.screenshot({ path: resolve(evidence, 'speaker-received-' + width + '.png'), fullPage: true });
    reports.push({ width, mode: 'speaker_only', receipt: 'pending_review', visibleOptionalContacts: true, phoneStringPreserved: true,
      contactDraftRefresh: width === 320, compactFocusedSamePage: true, noPrivateConfirmationRequest: true,
      externalGeneralRegistration: true, noAttendanceTicket: true, syntheticApplicationMail: 1, syntheticFormalMail: 0, syntheticReceiptReplayNoExtraMail: true, realNetworkRequests: 0 });
    await f.context.close();
  }
  for (const options of [{ flag: true }, { omitFlag: true }, { flag: 'false', omitSpeakerMetadata: true }]) {
    const f = await fixture({ ...options, mode: 'legacy' }); await assertSpeakerForm(f.page);
    if (options.omitFlag) {
      // A historical editable attendance draft is still an editing snapshot,
      // never an instruction to submit or to silently add attendance to a new
      // speaker request. Persist it through the same native CAS wrapper.
      await f.page.evaluate(async () => {
        const [{ createApplicationDraft }, { createBrowserDraftStore }] = await Promise.all([
          import('/__test_source__/src/lib/application-draft.mjs'), import('/__test_source__/src/lib/browser-drafts.mjs'),
        ]);
        const store = createBrowserDraftStore({ indexedDB, BroadcastChannel: null });
        try {
          const draft = createApplicationDraft({ store, eventId: 'ggj-cn-2026' }); await draft.read();
          await draft.save({ intake: 'general-v2', name: '合成旧草稿人', email: 'synthetic.old-draft@example.invalid', category: 'student',
            organization: '合成旧草稿机构', city: '合成旧草稿城市', phone: '+852 0012 3456', wechat: 'synthetic-old-draft', proposal: false, topic: '', summary: '' });
        } finally { store.close(); }
      });
      assert.equal((await records(f.page)).find(row => row.kind === 'editing')?.value.proposal, false);
      const beforeReload = f.calls.length;
      await f.page.reload({ waitUntil: 'networkidle' }); await form(f.page).locator('[data-submit]:enabled').waitFor(); await assertSpeakerForm(f.page);
      assert.equal((await records(f.page)).find(row => row.kind === 'editing')?.value.proposal, false, 'reading an old editing draft does not rewrite its stored selection');
      for (const [name, value] of [['name', '合成旧草稿人'], ['email', 'synthetic.old-draft@example.invalid'], ['phone', '+852 0012 3456'], ['wechat', 'synthetic-old-draft']]) assert.equal(await form(f.page).locator('[name=' + name + ']').inputValue(), value);
      for (const name of ['speaker.topic', 'speaker.summary']) assert.equal(await form(f.page).locator('[name="' + name + '"]').inputValue(), '');
      assert.equal(f.calls.slice(beforeReload).every(call => call.method === 'GET'), true, 'an old editing draft reload only reads settings and publication');
      assert.equal(f.calls.some(call => call.method === 'POST'), false, 'restoring an attendance-only editing draft never auto-submits');
      await form(f.page).locator('[name=consentAccepted]').check(); await form(f.page).locator('[data-submit]').click();
      assert.match(await form(f.page).locator('[data-form-error]').textContent(), /当前没有提交申请/u);
      for (const name of ['speaker.topic', 'speaker.summary']) assert.equal(await form(f.page).locator('[name="' + name + '"]').getAttribute('aria-invalid'), 'true');
      assert.equal(f.calls.some(call => call.method === 'POST'), false, 'an explicit incomplete speaker request is blocked before token issuance');
      await form(f.page).locator('[name="speaker.topic"]').fill('合成从旧草稿明确申请的主题');
      await form(f.page).locator('[name="speaker.summary"]').fill('合成从旧草稿明确填写的主题简介');
    } else await fill(f.page);
    const receipt = await submit(f); assertSpeakerTokenCalls(f); await assertPendingSpeaker(f, receipt, { expectedMail: 0 });
    const sent = JSON.parse(f.calls.find(call => call.path.endsWith('/registration/submit')).body);
    assert.deepEqual(sent.fields.participationInterests, ['talk']);
    if (options.omitFlag) { assert.equal(sent.fields.email, 'synthetic.old-draft@example.invalid'); assert.equal(sent.fields.phone, '+852 0012 3456'); assert.equal(sent.fields.wechat, 'synthetic-old-draft'); }
    reports.push({ mode: 'legacy-metadata', reviewFlag: options.omitFlag ? 'missing' : options.flag,
      speakerMetadata: options.omitSpeakerMetadata ? 'missing' : 'present', oldAttendanceOnlyEditingDraftRestored: options.omitFlag === true,
      receipt: 'pending_review', externalGeneralRegistration: true });
    await f.context.close();
  }
  {
    const f = await fixture({ capacity: 1, fillCapacity: true }); await assertSpeakerForm(f.page); await fill(f.page);
    const receipt = await submit(f); await assertPendingSpeaker(f, receipt, { confirmed: 1, expectedMail: 0 }); assertSpeakerTokenCalls(f);
    assert.equal((await f.app.registrationService.repository.list()).registrations.length, 2);
    reports.push({ mode: 'speaker_only', fullAttendanceCapacity: true, receipt: 'pending_review', consumesCapacity: false, fabricatedTicket: false });
    await f.context.close();
  }
  {
    const f = await fixture({ loseFirstAck: true }); await fill(f.page);
    await form(f.page).locator('[name="speaker.topic"]').fill('合成恢复讲者主题');
    await form(f.page).locator('[name="speaker.summary"]').fill('合成恢复讲者简介');
    await form(f.page).locator('[data-application-draft-status]').filter({ hasText: '本机已暂存' }).waitFor({ state: 'attached' });
    const draft = (await records(f.page)).find(row => row.kind === 'editing'); assert.equal(draft?.value.proposal, true);
    assert.equal(await form(f.page).locator('[data-application-draft-status]').isVisible(), false);
    await f.page.reload({ waitUntil: 'networkidle' }); await form(f.page).locator('[data-submit]:enabled').waitFor();
    assert.match(await form(f.page).locator('[data-application-draft-status]').textContent(), /已恢复讲者主题草稿/u);
    assert.equal(await form(f.page).locator('[name="speaker.topic"]').inputValue(), '合成恢复讲者主题');
    assert.equal(await form(f.page).locator('[name="speaker.summary"]').inputValue(), '合成恢复讲者简介');
    await form(f.page).locator('[name=consentAccepted]').check(); await form(f.page).locator('[data-submit]').click();
    await form(f.page).locator('[data-submit]').filter({ hasText: '再次确认原申请结果' }).waitFor();
    const original = (await records(f.page)).find(row => row.kind === 'pending_submission'); assert.ok(original?.value.attempted); assert.equal(original.value.uncertain, true);
    const first = f.calls.find(call => call.path.endsWith('/registration/submit')); assert.deepEqual(JSON.parse(first.body).fields.participationInterests, ['talk']);
    assert.equal(Object.hasOwn(JSON.parse(first.body).fields, 'phone'), false, 'an empty optional phone is omitted from a new frozen body');
    assert.equal(first.receipt.admissionStatus, 'pending_review', 'the server committed before the synthetic ACK loss');
    const beforeReload = f.calls.length;
    await f.page.reload({ waitUntil: 'networkidle' }); await form(f.page).locator('[data-submit]:enabled').waitFor();
    await f.page.locator('a[data-recruit=speaker]').click();
    const recovered = (await records(f.page)).find(row => row.kind === 'pending_submission');
    assert.equal(recovered.value.payloadJson, original.value.payloadJson); assert.equal(recovered.value.idempotencyKey, original.value.idempotencyKey);
    assert.equal(recovered.value.attempted, true); assert.equal(recovered.value.uncertain, true);
    for (const input of await form(f.page).locator('input,select,textarea').all()) assert.equal(await input.isDisabled(), true, 'all frozen original inputs remain locked');
    assert.equal(f.calls.slice(beforeReload).every(call => call.method === 'GET'), true, 'restoring an unknown result never resubmits automatically');
    const replayURL = f.page.url(); await form(f.page).locator('[data-submit]').click(); const receipt = await compactReceipt(f, replayURL);
    const replay = f.calls.filter(call => call.path.endsWith('/registration/submit')).at(-1);
    assert.equal(replay.body, first.body); assert.equal(replay.headers['idempotency-key'], first.headers['idempotency-key']); assertSpeakerTokenCalls(f);
    assert.equal(f.calls.filter(call => call.path.endsWith('/registration/submit')).length, 2);
    assert.equal((await f.app.registrationService.repository.list()).registrations.length, 1); await assertPendingSpeaker(f, receipt, { expectedMail: 0 });
    assert.equal((await records(f.page)).some(row => row.kind === 'pending_submission'), false);
    reports.push({ editingSpeakerDraftRestored: true, unknownNewProposalLocked: true, originalBodyAndKeyPreserved: true, receipt: 'pending_review', automaticReplay: false });
    await f.context.close();
  }
  {
    const f = await fixture({ mode: 'legacy', loseFirstAck: true });
    // Produce a real pre-migration general-client pending operation through its
    // native CAS store. The new UI must recover it, never reinterpret it as a
    // fresh talk-only submission or manufacture a different idempotency key.
    const oldResult = await f.page.evaluate(async () => {
      const [{ createRegistrationClient }, { createApplicationDraft }, { createBrowserDraftStore }] = await Promise.all([
        import('/__test_source__/src/lib/registration-client.mjs'), import('/__test_source__/src/lib/application-draft.mjs'), import('/__test_source__/src/lib/browser-drafts.mjs'),
      ]);
      const store = createBrowserDraftStore({ indexedDB, BroadcastChannel: null });
      try {
        const draft = createApplicationDraft({ store, eventId: 'ggj-cn-2026' }); await draft.read();
        const client = createRegistrationClient({ apiOrigin: 'https://api.artdico.host', pageOrigin: location.origin, pendingStore: draft.pendingStore });
        await client.configure();
        try { await client.submit({ intake: 'general-v2', name: '合成历史待核对人', email: 'synthetic.old-pending@example.invalid', categories: ['student'], participationInterests: ['attend', 'talk'], speaker: { topic: '合成历史分享主题', summary: '合成历史分享简介' } }); return { unexpectedSuccess: true }; }
        catch (error) { return { code: error.code, uncertain: error.uncertain, pending: client.pendingSnapshot }; }
      } finally { store.close(); }
    });
    assert.equal(oldResult.code, 'UNCONFIRMED'); assert.equal(oldResult.uncertain, true);
    const original = (await records(f.page)).find(row => row.kind === 'pending_submission'); assert.ok(original); assert.equal(original.value.uncertain, true);
    assert.equal(original.value.payloadJson, oldResult.pending.payloadJson); assert.equal(original.value.idempotencyKey, oldResult.pending.idempotencyKey);
    assert.equal(Object.hasOwn(JSON.parse(original.value.payloadJson).fields, 'phone'), false, 'old omitted phone stays absent in the frozen body');
    const first = f.calls.find(call => call.path.endsWith('/registration/submit')); assert.equal(first.receipt.admissionStatus, 'confirmed');
    assert.deepEqual(JSON.parse(f.calls.find(call => call.path.endsWith('/registration/token')).body), { eventId: EVENT, idempotencyKey: original.value.idempotencyKey });
    f.setMode('speaker_only'); f.setFlag(true); f.setPrivacyVersion('notice-speaker-ui-v2');
    const beforeReload = f.calls.length;
    await f.page.reload({ waitUntil: 'networkidle' }); await form(f.page).locator('[data-submit]:enabled').waitFor();
    assert.equal(await form(f.page).locator('[data-application-recovery]').isVisible(), true);
    assert.match(await form(f.page).locator('[data-application-recovery-person]').textContent(), /合成历史待核对人/u);
    for (const input of await form(f.page).locator('input,select,textarea').all()) assert.equal(await input.isDisabled(), true, 'all historical original inputs remain locked');
    assert.equal(await form(f.page).locator('[name=phone]').inputValue(), '');
    assert.equal(await form(f.page).locator('[name="speaker.topic"]').inputValue(), '合成历史分享主题');
    await f.page.locator('a[data-recruit=speaker]').click();
    const recovered = (await records(f.page)).find(row => row.kind === 'pending_submission');
    assert.equal(recovered.value.payloadJson, original.value.payloadJson); assert.equal(recovered.value.idempotencyKey, original.value.idempotencyKey);
    assert.equal(recovered.value.attempted, true); assert.equal(recovered.value.uncertain, true);
    assert.equal(f.calls.filter(call => call.path.endsWith('/registration/submit')).length, 1, 'reload and speaker CTA do not post');
    assert.equal(f.calls.slice(beforeReload).every(call => call.method === 'GET'), true);
    const replayURL = f.page.url(); await form(f.page).locator('[data-submit]').click(); await compactReceipt(f, replayURL, 'confirmed', { speaker: false });
    const replay = f.calls.filter(call => call.path.endsWith('/registration/submit')).at(-1);
    assert.equal(replay.body, first.body); assert.equal(replay.headers['idempotency-key'], first.headers['idempotency-key']);
    assert.equal(JSON.parse(replay.body).consent.version, f.initialPrivacyVersion);
    assert.deepEqual(JSON.parse(replay.body).fields.participationInterests, ['attend', 'talk']);
    const tokens = f.calls.filter(call => call.path.endsWith('/registration/token')); assert.equal(tokens.length, 2);
    for (const call of tokens) assert.deepEqual(JSON.parse(call.body), { eventId: EVENT, idempotencyKey: original.value.idempotencyKey }, 'legacy token requests are not upgraded to speakerApplication');
    assert.notEqual(first.headers['x-registration-token'], replay.headers['x-registration-token'], 'an explicit original-operation retry obtains a fresh token');
    assert.equal(f.calls.filter(call => call.path.endsWith('/registration/submit')).length, 2);
    assert.equal(f.runtime.messages.length, 0, 'historical restoration/replay never backfills formal mail');
    assert.equal((await f.app.registrationService.repository.list()).registrations.length, 1);
    const admissions = await f.app.registrationService.getAdmissions({ actor: f.runtime.users[0] });
    assert.equal(admissions.summary.confirmedCount, 1); assert.equal(admissions.summary.pendingReviewCount, 0);
    reports.push({ modeChangedToSpeakerOnly: true, originalPendingAttendanceLocked: true, originalBodyAndKeyPreserved: true, receipt: 'confirmed', historicalMailBackfill: false });
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
