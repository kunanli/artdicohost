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

async function fixture({ width = 390, flag = false, omitFlag = false, capacity = 3, fillCapacity = false, loseFirstAck = false, restoreBrowserCheckbox = false, mail = false } = {}) {
  const initialReview = omitFlag || typeof flag !== 'boolean' ? true : flag;
  const runtime = await peopleRuntimeFixture({ capacity, mail, attendeeReviewRequired: initialReview });
  const initialMetadata = await runtime.app.registrationService.metadata();
  if (fillCapacity) await runtime.seedPublic({ intake: 'general-v2', name: '合成既有参与者', email: 'synthetic.first@example.invalid' });
  const context = await browser.newContext({ viewport: { width, height: 940 } }), calls = [], navigations = [];
  let reviewFlag = initialReview, privacyVersion = initialMetadata.privacy.version, lose = loseFirstAck, app = runtime.app, receiptProven = false;
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
  return { page, context, calls, navigations, width, runtime, proveReceipt:()=>{receiptProven=true;}, get app() { return app; }, initialPrivacyVersion: privacyVersion,
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
async function compactReceipt(f,previousURL,admission='confirmed') {
  const labels={confirmed:'报名成功',pending_review:'申请已收到，待审核',waitlisted:'候补登记已保存，尚未确认名额',rejected:'本次申请未通过审核'};
  const success=f.page.locator('[data-registration-success][data-registration-success-compact]');await success.waitFor({state:'visible'});
  await f.page.waitForFunction(()=>document.activeElement===document.querySelector('[data-registration-success][data-registration-success-compact]'));
  assert.equal(f.page.url(),previousURL,'the form origin, path, query and hash remain unchanged after a genuine receipt');
  assert.equal(await success.getAttribute('role'),'status');assert.equal(await success.getAttribute('tabindex'),'-1');
  assert.equal((await success.innerText()).trim(),labels[admission],'the compact result shows only the accurate completion message');
  assert.equal(await form(f.page).isVisible(),false);assert.equal(await form(f.page).locator('[data-submit]').isDisabled(),true);
  assert.equal(await f.page.locator('[data-registration-preview]').isVisible(),false);assert.equal(await success.locator('[data-registration-success-details]').isVisible(),false);
  assert.equal(await success.locator('[data-registration-reference]').textContent(),'');assert.equal(await success.locator('[data-registration-group-status]').textContent(),'');assert.equal(await success.locator('[data-registration-group-image] img').count(),0);
  assert.equal(f.navigations.some(item=>item.path==='/registration/confirmation/'),false,'completion never opens the private confirmation document');
  assert.equal(f.calls.some(item=>/\/registration\/confirmation(?:\/|$)/u.test(item.path)),false,'completion never requests the private confirmation API');
  const submits=f.calls.filter(call=>call.path.endsWith('/registration/submit')),last=submits.at(-1);assert.ok(last&&[200,201].includes(last.status),'success follows a real committed runtime receipt');assert.equal(last.receipt.admissionStatus,admission);
  if(admission==='waitlisted')assert.doesNotMatch(await success.innerText(),/报名成功|名额已确认/u);
  f.proveReceipt();const posts=f.calls.filter(call=>call.method==='POST').length,mail=f.runtime.messages.length;
  await form(f.page).evaluate(node=>{node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));node.querySelector('[data-submit]').click();});
  assert.equal(f.calls.filter(call=>call.method==='POST').length,posts,'completed form events do not start another POST');assert.equal(f.runtime.messages.length,mail,'completed form events never resend mail');
  assert.equal(f.page.url(),previousURL);return last.receipt;
}
async function submit(f,admission='confirmed') {
  const previousURL=f.page.url();await form(f.page).locator('[name=consentAccepted]').check();await form(f.page).locator('[data-submit]').click();return compactReceipt(f,previousURL,admission);
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
    const f = await fixture({ width, restoreBrowserCheckbox: true, mail: true }); await assertAutomatic(f.page);
    assert.equal(await f.page.evaluate(() => window.syntheticRestoredCheckbox), true);
    assert.equal(await form(f.page).locator('[data-proposal-toggle]').isChecked(), false, 'new forms reset browser-restored checkbox state');
    assert.equal(await form(f.page).locator('[data-speaker-proposal]').isVisible(), false);
    await fill(f.page);
    for(const name of ['phone','wechat']){
      const input=form(f.page).locator('[name='+name+']');assert.equal(await input.isVisible(),true,'contact fields are visible without opening optional details');
      assert.equal(await input.getAttribute('required'),null);assert.equal(await input.locator('xpath=ancestor::details').count(),0);
    }
    assert.equal(await form(f.page).locator('[name=phone]').getAttribute('type'),'tel');
    assert.equal(await form(f.page).locator('[name=phone]').getAttribute('inputmode'),'tel');
    await form(f.page).locator('[name=phone]').fill('+852 0012 3456');await form(f.page).locator('[name=wechat]').fill('synthetic-contact');
    if(width===320){
      // waitForFunction treats an async predicate's Promise as truthy. Use the
      // latest-input saved-state barrier, then independently read native IDB.
      await form(f.page).locator('[data-application-draft-status]').filter({hasText:'本机已暂存'}).waitFor({state:'attached'});
      const persisted=(await records(f.page)).find(row=>row.kind==='editing');assert.equal(persisted?.value.phone,'+852 0012 3456');assert.equal(persisted?.value.wechat,'synthetic-contact');
      await f.page.reload({waitUntil:'networkidle'});await form(f.page).locator('[data-submit]:enabled').waitFor();
      assert.equal(await form(f.page).locator('[name=phone]').inputValue(),'+852 0012 3456');assert.equal(await form(f.page).locator('[name=wechat]').inputValue(),'synthetic-contact');
    }
    assert.equal(await form(f.page).locator('[data-proposal-toggle]').isChecked(), false, 'changing identity does not select a proposal');
    const receipt=await submit(f);
    const sent = JSON.parse(f.calls.find(call => call.path.endsWith('/submit')).body);
    assert.deepEqual(sent.fields.participationInterests, ['attend']); assert.equal(Object.hasOwn(sent.fields, 'speaker'), false);
    assert.equal(sent.fields.phone,'+852 0012 3456');assert.equal(sent.fields.wechat,'synthetic-contact');
    const admissions = await f.app.registrationService.getAdmissions({ actor: f.runtime.users[0] });
    assert.equal(admissions.summary.confirmedCount, 1); assert.equal(admissions.summary.pendingReviewCount, 0);
    assert.equal((await f.app.registrationService.repository.list()).registrations.length, 1);
    const stored=(await f.app.registrationService.repository.list()).registrations[0];assert.equal(stored.fields.phone,sent.fields.phone);assert.equal(stored.fields.wechat,sent.fields.wechat);
    const detail=await f.app.reviewStore.detail(receipt.reference_code);assert.equal(detail.registration.fields.phone,sent.fields.phone);
    assert.equal(receipt.confirmation.email.status,'provider_accepted','the actual runtime records the synthetic provider acknowledgement');
    assert.equal(f.runtime.messages.length,1,'a newly confirmed automatic intake starts exactly one synthetic formal email');
    assert.equal(f.runtime.messages[0].template_params.reference_code,receipt.reference_code);assert.match(f.runtime.messages[0].template_params.invitation_text,/参会名额已确认/u);assert.match(f.runtime.messages[0].template_params.invitation_text,/https:\/\/artdico\.host\/r\/#[A-Za-z0-9_-]{22}/u);
    const original=f.calls.find(call=>call.path.endsWith('/registration/submit')),replayed=await f.app.handle(new Request(API+'/api/admin/registration/submit',{method:'POST',headers:original.headers,body:original.body}));
    assert.equal(replayed.status,200);assert.equal((await replayed.json()).admissionStatus,'confirmed');assert.equal(f.runtime.messages.length,1,'an explicit synthetic replay does not send another formal email');
    assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await f.page.screenshot({ path: resolve(evidence, 'automatic-confirmed-' + width + '.png'), fullPage: true });
    reports.push({ width, mode: 'automatic', receipt: 'confirmed', freshProposal: false, visibleOptionalContacts:true, phoneStringPreserved:true, contactDraftRefresh:width===320, compactFocusedSamePage:true, noPrivateConfirmationRequest:true, syntheticFormalMail:1, syntheticReceiptReplayNoExtraMail:true, realNetworkRequests: 0 }); await f.context.close();
  }
  for (const options of [{ flag: true }, { omitFlag: true }, { flag: 'false' }]) {
    const f = await fixture(options);
    assert.equal(await f.page.locator('[data-registration-mode-label]').textContent(), '人工审核');
    assert.equal(await form(f.page).locator('[data-submit]').textContent(), '提交参会申请');
    assert.match(await f.page.locator('[data-faq-id=registration-status] .ah-faq-answer').textContent(), /人工审核/u);
    await fill(f.page); await submit(f,'pending_review');
    assert.equal(await f.page.locator('[data-confirmation-group],[data-confirmation-wallet]').count(),0);
    assert.equal((await f.app.registrationService.getAdmissions({ actor: f.runtime.users[0] })).summary.pendingReviewCount, 1);
    reports.push({ mode: 'review-fallback', flag: options.omitFlag ? 'missing' : options.flag, receipt: 'pending_review' }); await f.context.close();
  }
  {
    const f = await fixture({ capacity: 1, fillCapacity: true }); await assertAutomatic(f.page); await fill(f.page); await submit(f,'waitlisted');
    assert.equal(await f.page.locator('[data-confirmation-group],[data-confirmation-wallet]').count(),0);
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
    await form(f.page).locator('[data-application-draft-status]').filter({ hasText: '本机已暂存' }).waitFor({state:'attached'});
    assert.equal(await form(f.page).locator('[data-application-draft-status]').isVisible(),false);
    await f.page.reload({ waitUntil: 'networkidle' }); await form(f.page).locator('[data-submit]:enabled').waitFor();
    assert.equal(await form(f.page).locator('[data-proposal-toggle]').isChecked(), true, 'an intentional editing draft restores its selection');
    assert.match(await form(f.page).locator('[data-application-draft-status]').textContent(), /已恢复本机草稿.*分享提案/u);
    assert.equal(await form(f.page).locator('[name="speaker.topic"]').inputValue(), '合成分享主题');
    await submit(f);
    const sent = JSON.parse(f.calls.find(call => call.path.endsWith('/submit')).body);
    assert.deepEqual(sent.fields.participationInterests, ['attend', 'talk']);
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
    assert.equal(Object.hasOwn(JSON.parse(original.value.payloadJson).fields,'phone'),false,'an omitted phone remains absent in the frozen original body');
    assert.equal((await f.app.registrationService.getAdmissions({ actor: f.runtime.users[0] })).summary.pendingReviewCount, 1);
    const first = f.calls.find(call => call.path.endsWith('/submit'));
    f.setFlag(false); f.setPrivacyVersion('notice-auto-ui-v2');
    const beforeReload = f.calls.length;
    await f.page.reload({ waitUntil: 'networkidle' }); await form(f.page).locator('[data-submit]:enabled').waitFor();
    assert.equal(await form(f.page).locator('[data-proposal-toggle]').isChecked(), true);
    assert.equal(await form(f.page).locator('[data-proposal-toggle]').isDisabled(), true);
    await f.page.locator('a[data-recruit=speaker]').click();
    const recovered = (await records(f.page)).find(row => row.kind === 'pending_submission');
    assert.equal(await form(f.page).locator('[name=phone]').inputValue(),'');assert.equal(await form(f.page).locator('[name=phone]').isDisabled(),true);
    assert.equal(recovered.value.payloadJson, original.value.payloadJson); assert.equal(recovered.value.idempotencyKey, original.value.idempotencyKey);
    assert.equal(f.calls.filter(call => call.path.endsWith('/submit')).length, 1, 'reload and CTA do not submit');
    assert.equal(f.calls.slice(beforeReload).every(call => call.method === 'GET'), true, 'pending restoration only reads settings and publication');
    const replayURL=f.page.url();await form(f.page).locator('[data-submit]').click();
    await compactReceipt(f,replayURL,'pending_review');
    const replay = f.calls.filter(call => call.path.endsWith('/submit')).at(-1);
    assert.equal(replay.body, first.body); assert.equal(replay.headers['idempotency-key'], first.headers['idempotency-key']);
    assert.equal(JSON.parse(replay.body).consent.version, f.initialPrivacyVersion);
    assert.equal(await f.page.locator('[data-confirmation-group],[data-confirmation-wallet]').count(),0);
    assert.equal(f.calls.filter(call=>call.path.endsWith('/registration/submit')).length,2,'only the explicit original-payload proof retry posts again');
    assert.equal(f.runtime.messages.length,0,'restoring and replaying an old pending receipt does not backfill mail');
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
