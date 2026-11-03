// Actual runtime over memory OSS. Every browser request is intercepted; no real mail or people.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { peopleRuntimeFixture, PEOPLE_FIXTURE_API as API, PEOPLE_FIXTURE_PUBLIC as SITE, PEOPLE_FIXTURE_PASSWORD } from '../helpers/people-runtime-fixture.mjs';

const { chromium } = await import(process.env.ARTDICO_PLAYWRIGHT_MODULE || 'playwright-core');
const project = fileURLToPath(new URL('../../', import.meta.url));
const dist = resolve(process.env.ARTDICO_DIST_DIRECTORY || resolve(project, 'dist'));
const evidence = resolve(process.env.ARTDICO_EVIDENCE_DIRECTORY || resolve(project, '.local-data/browser-evidence')), reports = [], errors = [];
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0KFjAwMDAxMDAgKAAGOQBVgs9CEsAAAAASUVORK5CYII=';
const browser = await chromium.launch({ executablePath: process.env.ARTDICO_CHROMIUM_BINARY || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const operationId = () => randomBytes(32).toString('base64url');
const pendingFields = (name = '合成学生申请人') => ({ intake: 'general-v2', locale:'zh-CN', name, email: 'synthetic.application@example.invalid', categories: ['student'], participationInterests: ['talk'], speaker: {topic:'合成分享主题',summary:'合成主题简介，只用于隔离浏览器验收。'} });
const json = (value, status = 200, headers = {}) => ({ status, contentType: 'application/json', body: JSON.stringify(value), headers });

async function fixture({ width = 390, capacity = 3, mail = true, username = 'owner', submitAckLost = false, approvalAckLost = false } = {}) {
  const runtime = await peopleRuntimeFixture({ capacity, mail }), headers = await runtime.login(username);
  const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
  const [name, ...value] = headers.Cookie.split('=');
  await context.addCookies([{ domain: new URL(API).hostname, path: '/api/admin', name, value: value.join('='), httpOnly: true, secure: true, sameSite: 'Strict' }]);
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  // The real fixture clock is fixed; keep browser capability/token expiry checks on that same wall clock.
  // setFixedTime leaves event-loop timers running normally.
  await page.clock.setFixedTime(new Date('2026-10-21T09:00:00.000Z'));
  const calls = [], writes = [], reads = [], navigations = [];
  let loseSubmit = submitAckLost, loseApproval = approvalAckLost, approving = false, rejectAdmissionRead = false, rejectNextApproval = false, rejectReviewSave = false, failReviewList = false, wrongReviewIdentity = false, receiptProven = false;
  const append = runtime.objects.append.bind(runtime.objects);
  runtime.objects.append = async (key, ...args) => {
    const result = await append(key, ...args);
    if (loseApproval && approving && key === 'cms/v1/registrations/ggj-cn-2026/index/commits.jsonl') {
      loseApproval = false; throw new Error('SYNTHETIC_DURABLE_APPROVAL_ACK_LOST');
    }
    return result;
  };
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    assert.ok([SITE, API].includes(url.origin), 'all browser origins must remain intercepted');
    if(req.isNavigationRequest())navigations.push({origin:url.origin,path});
    if (url.origin === API && path.startsWith('/api/')) {
      const requestHeaders = await req.allHeaders(), body = req.postData() ? JSON.parse(req.postData()) : null;
      if(receiptProven&&req.method()==='POST'&&/\/registration\/(?:token|submit)$/u.test(path))assert.fail('a proven compact receipt never starts another registration POST');
      const entry = { path, method: req.method(), body, rawBody:req.postData(), headers: requestHeaders };
      calls.push(entry); if (req.method() === 'GET') reads.push(entry); else if (req.method() !== 'OPTIONS') writes.push(entry);
      if (/^\/api\/(?:public\/|admin\/registration\/)/u.test(path)) assert.equal(requestHeaders.cookie, undefined, 'public request omits the private staff cookie');
      if (path.endsWith('/registration/confirmation')) assert.equal(requestHeaders.referer, undefined, 'private receipt is not a Referer');
      if (rejectAdmissionRead && path === '/api/admin/admissions' && req.method() === 'GET') return route.fulfill(json({}, 401));
      if (rejectNextApproval && path === '/api/admin/admissions/approve') { rejectNextApproval = false; entry.status = 401; return route.fulfill(json({}, 401)); }
      if(rejectReviewSave&&path.endsWith('/review')&&req.method()==='PATCH'){rejectReviewSave=false;entry.status=422;return route.fulfill(json({error:{code:'VALIDATION_ERROR',fields:{internalNotes:'合成校验失败，填写保留'}}},422));}
      if(failReviewList&&path==='/api/admin/registrations'&&req.method()==='GET'){failReviewList=false;entry.status=503;return route.fulfill(json({error:{code:'UNAVAILABLE'}},503));}
      const request = new Request(req.url(), { method: req.method(), headers: requestHeaders,
        ...(['GET', 'HEAD'].includes(req.method()) ? {} : { body: req.postData() }) });
      approving = path === '/api/admin/admissions/approve';
      let response;
      try { response = await runtime.app.handle(request); } finally { approving = false; }
      entry.status = response.status;
      if(path.endsWith('/registration/submit')&&[200,201].includes(response.status))entry.receipt=await response.clone().json();
      if (loseSubmit && path === '/api/admin/registration/submit') {
        loseSubmit = false; await response.arrayBuffer();
        return route.fulfill(json({ error: { code: 'UNAVAILABLE' } }, 503, { 'access-control-allow-origin': SITE }));
      }
      if(wrongReviewIdentity&&/^\/api\/admin\/registrations\/[A-Za-z0-9_-]{43}$/u.test(path)&&req.method()==='GET'){wrongReviewIdentity=false;const value=await response.json();value.registration.id='z'.repeat(43);return route.fulfill(json(value,response.status));}
      return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    }
    const file = resolve(dist, '.' + (path.endsWith('/') ? path + 'index.html' : path));
    assert.ok(file.startsWith(dist + '/'));
    try { return route.fulfill({ status: 200, body: await readFile(file), contentType: ({ html: 'text/html', js: 'text/javascript', css: 'text/css', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', woff2: 'font/woff2' })[extname(file).slice(1)] || 'application/octet-stream' }); }
    catch { return route.fulfill({ status: 404, body: '' }); }
  });
  async function api(path, { method = 'GET', body, useHeaders = headers } = {}, status = 200) {
    const response = await runtime.app.handle(runtime.request(path, { method, body, headers: useHeaders }));
    const value = await response.json(); assert.equal(response.status, status, JSON.stringify(value)); return value;
  }
  return { runtime, context, page, headers, calls, writes, reads, navigations, proveReceipt:()=>{receiptProven=true;}, api, mail, expireNextApproval: () => { rejectNextApproval = true; }, expireAdmissionRead: () => { rejectAdmissionRead = true; },rejectNextReviewSave:()=>{rejectReviewSave=true;},failNextReviewList:()=>{failReviewList=true;},wrongNextReviewIdentity:()=>{wrongReviewIdentity=true;} };
}
async function noOverflow(page) { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true); }
async function openPublic(f) {
  await f.page.goto(SITE + '/#registration', { waitUntil: 'domcontentloaded' });
  await f.page.locator('[data-registration-form][data-registration-mode=production]').waitFor();
  return f.page.locator('[data-registration-form]');
}
async function fillApplication(form, fields = {}) {
  await form.locator('[name=name]').fill(fields.name || '合成学生申请人');
  await form.locator('[name=email]').fill(fields.email || 'synthetic.application@example.invalid');
  await form.locator('[name=categories]').selectOption(fields.category || 'student');
  if(!fields.emptyTopic){await form.locator('[name="speaker.topic"]').fill('合成分享主题');await form.locator('[name="speaker.summary"]').fill('合成主题简介，只用于隔离浏览器验收。');}
  await form.locator('[name=consentAccepted]').check();
}
async function compactReceipt(f,previousURL,admission='pending_review') {
  const labels={confirmed:'报名成功',pending_review:'申请已收到，待审核',waitlisted:'候补登记已保存，尚未确认名额',rejected:'本次申请未通过审核'};
  const success=f.page.locator('[data-speaker-application-received]');await success.waitFor({state:'visible'});
  await f.page.waitForFunction(()=>document.activeElement===document.querySelector('[data-speaker-application-received]'));
  assert.equal(f.page.url(),previousURL,'a committed application keeps the original form URL and hash');assert.equal(await success.getAttribute('role'),'status');assert.equal(await success.getAttribute('tabindex'),'-1');
  assert.equal((await success.innerText()).trim(),'讲者申请已收到。筹备团队将另行联系；讲者安排与入场资格尚未确认。','only the accurate speaker receipt is presented');assert.equal(admission,'pending_review');
  const form=f.page.locator('[data-registration-form]');assert.equal(await form.isVisible(),false);assert.equal(await form.locator('[data-submit]').isDisabled(),true);assert.equal(await f.page.locator('[data-registration-preview]').isVisible(),false);
  assert.equal(await f.page.locator('[data-registration-success-details]').isVisible(),false);assert.equal(await f.page.locator('[data-registration-reference]').textContent(),'');assert.equal(await f.page.locator('[data-registration-group-status]').textContent(),'');assert.equal(await f.page.locator('[data-registration-group-image] img').count(),0);
  assert.equal(f.navigations.some(item=>item.path==='/registration/confirmation/'),false,'submission never navigates to a private confirmation document');assert.equal(f.calls.some(item=>/\/registration\/confirmation(?:\/|$)/u.test(item.path)),false,'submission never starts a private confirmation API read');
  const receipt=f.writes.filter(item=>item.path.endsWith('/registration/submit')).at(-1);assert.ok(receipt&&[200,201].includes(receipt.status));assert.equal(receipt.receipt.admissionStatus,admission,'the status is backed by the actual isolated runtime receipt');
  const posts=f.writes.filter(item=>item.method==='POST').length,mail=f.runtime.messages.length;f.proveReceipt();
  await form.evaluate(node=>{node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));node.querySelector('[data-submit]').click();});
  assert.equal(f.writes.filter(item=>item.method==='POST').length,posts,'completed form events never start another POST');assert.equal(f.runtime.messages.length,mail,'completed form events never resend mail');assert.equal(f.page.url(),previousURL);return receipt.receipt;
}
async function submitApplication(f, form) {
  const previousURL=f.page.url();await form.locator('[data-submit]').click();await compactReceipt(f,previousURL);
  return (await f.runtime.app.registrationService.repository.list()).registrations.at(-1);
}
async function openReview(f) {
  await f.page.goto(API + '/admin/registrations/', { waitUntil: 'domcontentloaded' });
  await f.page.locator('[data-review-workspace]:visible').waitFor();
  await f.page.locator('.review-tools > summary').click();
  await f.page.locator('[data-admissions-metrics] article').first().waitFor();
}
async function seedGroup(f) {
  await f.api('/api/admin/group-invite', { method: 'POST', body: { expectedRevision: 0, contentType: 'image/png', dataBase64: PNG, expiresAt: '2026-10-21T10:00:00.000Z' } });
}
async function assertPending(f, id) {
  const state = await f.runtime.app.registrationService.getAdmissions({ actor: f.runtime.users[0] });
  assert.equal(state.people.find(person => person.registrationId === id).status, 'pending_review');
  assert.equal(state.summary.confirmedCount, 0); assert.equal(state.summary.pendingReviewCount, 1);
  assert.equal(f.runtime.messages.length, f.mail ? 1 : 0);
  if(f.mail){assert.match(f.runtime.messages[0].template_params.invitation_text,/申请已收到|申请已经收到/u);assert.doesNotMatch(f.runtime.messages[0].template_params.invitation_text,/Apple Wallet|名额已确认|已获邀|群码/u);}
}
async function rawDecision(f, id, action = 'approve') {
  const current = await f.runtime.app.registrationService.getAdmissions({ actor: f.runtime.users[0] });
  return f.api('/api/admin/admissions/' + action, { method: 'POST', body: { registrationId: id, expectedRevision: current.revision, operationId: operationId() } });
}

try {
  await mkdir(evidence, { recursive: true });
  for (const width of [320, 390, 1440]) {
    const f = await fixture({ width }), form = await openPublic(f);
    assert.equal(await form.locator('[name=categories] option[value=student]').count(), 1);
    for (const key of ['city', 'organization', 'wechat']) assert.equal(await form.locator('[name=' + key + ']').getAttribute('required'), null);
    for (const key of ['attendance', 'accommodationChoice', 'cooperationInterest', 'background', 'position', 'speaker.language']) assert.equal(await form.locator('[name="' + key + '"]').count(), 0);
    assert.equal(await form.locator('[data-form-step],[data-next-step]').count(), 0);
    assert.equal(await form.locator('[data-speaker-proposal]').isVisible(), true);assert.equal(await form.locator('[data-proposal-toggle]').count(),0);
    assert.equal(f.calls.filter(item => item.method === 'POST').length, 0);
    await noOverflow(f.page); await f.context.close();
    reports.push({ width, singleShortApplication: true, studentIdentity: true, noUnaskedControlsOrWrites: true });
  }
  {
    const f = await fixture(), form = await openPublic(f); await seedGroup(f); await fillApplication(form);
    const formURL=f.page.url();await form.locator('[data-submit]').evaluate(button => { button.click(); button.click(); });
    const receipt=await compactReceipt(f,formURL);
    // Explicit compatibility-only navigation preserves the old private-route,
    // print, group and Wallet guards. It is not the public submission outcome.
    await f.page.goto(receipt.confirmation.confirmationUrl,{waitUntil:'domcontentloaded'});
    await f.page.locator('[data-confirmation-content]:visible').waitFor();
    const records = await f.runtime.app.registrationService.repository.list(), record = records.registrations[0];
    assert.equal(records.registrations.length, 1); await assertPending(f, record.id);
    assert.deepEqual(record.fields, pendingFields());
    assert.equal(f.writes.filter(item => item.path.endsWith('/registration/submit')).length, 1);
    assert.match(await f.page.locator('[data-confirmation-heading]').textContent(), /待.*审核|申请.*收到/u);
    assert.match(await f.page.locator('[data-confirmation-email]').textContent(), /审核|未.*正式/u);
    assert.equal(await f.page.locator('[data-confirmation-group]').isVisible(), false);
    assert.equal(await f.page.locator('[data-confirmation-wallet]').isVisible(), false);
    assert.equal(f.reads.some(item => item.path.includes('/group-invite/')), false);
    const privateUrl = f.page.url(); assert.doesNotMatch(privateUrl, /example\.invalid|%E5%90%88/u);
    await f.page.evaluate(() => dispatchEvent(new Event('beforeprint'))); assert.equal(new URL(f.page.url()).hash, '');
    await f.page.emulateMedia({ media: 'print' }); assert.equal(await f.page.locator('[data-confirmation-copy]').isVisible(), false);
    assert.match(await f.page.locator('[data-confirmation-heading]').textContent(), /审核|收到/u);
    const pdf = await f.page.pdf({ path: resolve(evidence, 'application-pending-print.pdf'), format: 'A4' }); assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    await f.page.evaluate(() => dispatchEvent(new Event('afterprint'))); assert.equal(f.page.url(), privateUrl);
    await f.page.emulateMedia({ media: 'screen' }); await noOverflow(f.page);
    await f.page.screenshot({ path: resolve(evidence, 'application-pending-mobile.png'), fullPage: true });
    await rawDecision(f, record.id); assert.equal(f.runtime.messages.length, 2);assert.match(f.runtime.messages[1].template_params.invitation_text,/Apple Wallet/u);
    await f.page.locator('[data-confirmation-refresh]').click(); await f.page.locator('[data-confirmation-page][data-admission=confirmed]').waitFor();
    await f.page.locator('[data-confirmation-group] img').waitFor(); assert.ok(f.reads.some(item => item.path.includes('/group-invite/')));
    await f.page.locator('[data-confirmation-refresh]').click(); assert.equal(f.runtime.messages.length, 2, 'read refresh never sends another receipt or formal invitation');
    await f.context.close(); reports.push({ sparseStudentSaved: true, doubleClickOneApplication: true, independentApplicationReceipt: true, sameURLFocusedCompactResult:true, noAutomaticPrivateConfirmationRequest:true, explicitLegacyPrivateRouteNavigation:true, pendingNoSeatFormalMailGroupOrWallet: true, privatePrint: true, explicitApprovalOneMailAndGroup: true });
  }
  {
    const f = await fixture(), form = await openPublic(f); await fillApplication(form, { category: 'so', name: '合成组织者主题申请', emptyTopic:true });
    await form.locator('[data-submit]').click();
    await form.locator('[data-error-for="speaker.topic"]:visible').waitFor();
    assert.equal(f.writes.filter(item => item.path.endsWith('/registration/submit')).length, 0);
    await form.locator('[name="speaker.topic"]').fill('合成分享主题'); await form.locator('[name="speaker.summary"]').fill('合成主题简介，只用于隔离浏览器验收。');
    const record = await submitApplication(f, form); await assertPending(f, record.id);
    assert.deepEqual(record.fields.categories, ['so']); assert.deepEqual(record.fields.participationInterests, ['talk']);
    assert.deepEqual(record.fields.speaker, { topic: '合成分享主题', summary: '合成主题简介，只用于隔离浏览器验收。' });
    assert.equal(Object.hasOwn(record.fields, 'organization'), false); assert.equal(Object.hasOwn(record.fields, 'soRo'), false);
    assert.equal((await f.runtime.app.registrationService.repository.list()).registrations.length, 1);
    await f.context.close(); reports.push({ standaloneSpeakerApplication: true, proposalValidated: true, ordinaryOrganizerNoLegacyBranch: true });
  }
  {
    const f = await fixture({ submitAckLost: true }), form = await openPublic(f); await fillApplication(form);
    await form.locator('[data-submit]').click(); await form.locator('[data-submit]').filter({ hasText: /再次确认/u }).waitFor();
    assert.equal(await form.locator('[name=name]').isDisabled(), true); assert.equal(await form.locator('[name=name]').inputValue(), '合成学生申请人');
    assert.equal(f.writes.filter(item => item.path.endsWith('/registration/submit')).length, 1); assert.equal(f.runtime.messages.length, 1);
    const retryURL=f.page.url();await form.locator('[data-submit]').click();await compactReceipt(f,retryURL);
    const attempts = f.writes.filter(item => item.path.endsWith('/registration/submit')); assert.equal(attempts.length, 2);
    assert.deepEqual(attempts[0].body, attempts[1].body);assert.equal(attempts[0].rawBody,attempts[1].rawBody,'the pending replay keeps the exact original JSON bytes');assert.equal(attempts[0].headers['idempotency-key'], attempts[1].headers['idempotency-key']);
    const saved = await f.runtime.app.registrationService.repository.list(); assert.equal(saved.registrations.length, 1); await assertPending(f, saved.registrations[0].id);
    await f.context.close(); reports.push({ publicUnknownAckFrozen: true, samePayloadAndKeyRetry: true, noDuplicateApplicationOrMail: true });
  }
  {
    const f = await fixture({ width: 1440 }), pending = await f.runtime.seedPublic(pendingFields('合成内部意见申请'));
    const original=await f.api('/api/admin/registrations/'+pending.reference_code),{deletionRequested,...oldReview}=original.review;
    await f.api('/api/admin/registrations/'+pending.reference_code+'/review',{method:'PATCH',body:{expectedRevision:original.revision,review:{...oldReview,status:'approved'}}});
    await openReview(f); await f.page.locator('[data-review-filters] [name=category]').selectOption('student');
    await f.page.locator('[data-review-filters] button[type=submit]').click();
    await f.page.locator('[data-review-rows] tr').first().getByRole('button', { name: '查看与核查' }).click();
    await f.page.locator('[data-review-dialog][open]').waitFor();
    assert.equal(await f.page.locator('[data-review-form] [name=status]').count(),0,'old internal decisions are no longer editable');
    await f.page.locator('[data-review-legacy-records] > summary').click();
    assert.match(await f.page.locator('[data-review-legacy]').innerText(),/内部建议通过（不授予名额）/u);
    await assertPending(f,pending.reference_code);
    await f.page.locator('[data-review-form] .review-detail-group > summary').first().click();await f.page.locator('[data-review-form] [name=internalNotes]').fill('合成日常跟进，不改变旧内部建议');
    assert.equal(await f.page.locator('[data-review-approve]').isDisabled(), true, 'unsaved internal notes must be saved before a formal decision');
    await f.page.locator('[data-review-save]').click(); await f.page.locator('[data-review-form] [data-save-state=saved]').waitFor();
    await f.page.locator('[data-review-approve]:enabled').waitFor();
    assert.equal((await f.api('/api/admin/registrations/'+pending.reference_code)).review.status,'approved','daily save preserves the retired annotation');
    await assertPending(f, pending.reference_code);
    await f.page.locator('[data-review-approve]').click();
    await f.page.locator('[data-review-admission-status]').filter({ hasText: /已确认参会名额/u }).waitFor();
    assert.equal(f.runtime.messages.length, 2); assert.equal((await f.runtime.app.registrationService.getAdmissionStatus(pending.reference_code)).status, 'confirmed');
    await f.page.locator('[data-review-detail-close]').first().click();
    await f.page.screenshot({ path: resolve(evidence, 'application-review-desktop.png'), fullPage: true });
    await noOverflow(f.page); await f.context.close(); reports.push({ studentReviewFilter: true, internalApprovedAnnotationNoSeat: true, explicitReviewActionConfirmsAndSends: true });
  }
  {
    const f=await fixture({width:1440,mail:false}),pending=await f.runtime.seedPublic(pendingFields('合成核查保存边界'));
    await openReview(f);await f.page.locator('[data-review-rows] tr').first().getByRole('button',{name:'查看与核查'}).click();
    const dialog=f.page.locator('[data-review-dialog][open]'),form=dialog.locator('[data-review-form]');await dialog.waitFor();await form.locator('.review-detail-group > summary').first().click();
    await form.locator('[name=assignedTo]').fill('  Cafe\u0301  ');await form.locator('[name=internalNotes]').fill('  合成核查备注  ');
    f.rejectNextReviewSave();await form.locator('[data-review-save]').click();await form.locator('.ah-form-save-state[data-save-state=error]').waitFor();
    assert.equal(await dialog.isVisible(),true);assert.equal(await form.locator('[name=internalNotes]').inputValue(),'  合成核查备注  ');assert.equal(await form.locator('[data-review-save]').isEnabled(),true);
    assert.equal((await f.api('/api/admin/registrations/'+pending.reference_code)).review.internalNotes,'');
    const detailsBefore=f.reads.filter(entry=>entry.path==='/api/admin/registrations/'+pending.reference_code).length;
    f.failNextReviewList();await form.locator('[data-review-save]').click();await form.locator('.ah-form-save-state[data-save-state=saved]').waitFor();
    await f.page.locator('[data-review-status]').filter({hasText:'列表暂未刷新'}).waitFor();
    assert.equal(await dialog.isVisible(),true);assert.equal(await form.locator('[name=assignedTo]').inputValue(),'Café');assert.equal(await form.locator('[name=internalNotes]').inputValue(),'合成核查备注');assert.equal(await form.locator('[data-review-save]').isDisabled(),true);
    assert.equal(f.reads.filter(entry=>entry.path==='/api/admin/registrations/'+pending.reference_code).length,detailsBefore+1,'adopt the first identity-matched readback without a second detail GET');
    const saved=await f.api('/api/admin/registrations/'+pending.reference_code);assert.equal(saved.registration.id,pending.reference_code);assert.equal(saved.review.assignedTo,'Café');assert.equal(saved.review.internalNotes,'合成核查备注');
    assert.equal(f.writes.filter(entry=>entry.path.endsWith('/review')).length,2);await assertPending(f,pending.reference_code);await f.context.close();
    reports.push({review422KeepsInputAndAllowsCorrection:true,reviewSaveNormalizesWhitespaceAndNFC:true,identityMatchedFirstReadbackAdopted:true,postProofListFailureKeepsSavedEditor:true});
  }
  {
    const f=await fixture({mail:false}),pending=await f.runtime.seedPublic(pendingFields('合成核查身份不匹配'));
    await openReview(f);await f.page.locator('[data-review-rows] tr').first().getByRole('button',{name:'查看与核查'}).click();
    const dialog=f.page.locator('[data-review-dialog][open]'),form=dialog.locator('[data-review-form]');await dialog.waitFor();await form.locator('.review-detail-group > summary').first().click();
    await form.locator('[name=internalNotes]').fill('合成身份核对备注');f.wrongNextReviewIdentity();await form.locator('[data-review-save]').click();await form.locator('.ah-form-save-state[data-save-state=unknown]').waitFor();
    assert.equal(await dialog.isVisible(),true);assert.equal(await form.locator('[name=internalNotes]').inputValue(),'合成身份核对备注');assert.equal(await form.locator('[data-review-save]').isDisabled(),true);
    assert.equal(f.writes.filter(entry=>entry.path.endsWith('/review')).length,1);await assertPending(f,pending.reference_code);await f.context.close();
    reports.push({wrongReviewReadbackIdentityNeverShowsSaved:true,uncertainReviewRetainsInputWithoutAutomaticResubmit:true});
  }
  {
    const f = await fixture({ approvalAckLost: true }), pending = await f.runtime.seedPublic(pendingFields('合成未知审核回执'));
    await openReview(f);const lostApproval=f.page.waitForResponse(response=>response.url().endsWith('/api/admin/admissions/approve')&&response.status()===503);await f.page.locator('[data-admissions-approve="' + pending.reference_code + '"]').click();await lostApproval;
    await f.page.locator('[data-admissions-pending]:visible').waitFor(); assert.equal(f.runtime.messages.length, 1);
    assert.equal((await f.runtime.app.registrationService.getAdmissionStatus(pending.reference_code)).status, 'confirmed');
    assert.equal(f.writes.filter(item => item.path.endsWith('/admissions/approve')).length, 1);
    await f.page.locator('[data-admissions-refresh]').click(); await f.page.locator('[data-admissions-status]').filter({ hasText: /原操作结果仍待确认/u }).waitFor();
    assert.equal(f.runtime.messages.length, 1); assert.equal(f.writes.filter(item => item.path.endsWith('/admissions/approve')).length, 1);
    await f.page.locator('[data-admissions-retry]').click(); await f.page.locator('[data-admissions-pending]').waitFor({ state: 'hidden' });
    const attempts = f.writes.filter(item => item.path.endsWith('/admissions/approve')); assert.equal(attempts.length, 2); assert.deepEqual(attempts[0].body, attempts[1].body);
    assert.equal(f.runtime.messages.length, 2); assert.equal((await f.runtime.app.registrationService.repository.list()).registrations.length, 1);
    await f.context.close(); reports.push({ durableApprovalLostAck: true, readRefreshNoMail: true, explicitOriginalDecisionRetryOneMail: true });
  }
  {
    const f = await fixture(), pending = await f.runtime.seedPublic(pendingFields('合成不通过申请'));
    await openReview(f); await f.page.locator('[data-admissions-reject="' + pending.reference_code + '"]').click();
    await f.page.locator('[data-admissions-status]').filter({ hasText: /审核不通过/u }).waitFor();
    assert.equal((await f.runtime.app.registrationService.getAdmissionStatus(pending.reference_code)).status, 'rejected'); assert.equal(f.runtime.messages.length, 1);
    await f.page.goto(pending.confirmation.confirmationUrl); await f.page.locator('[data-confirmation-content]:visible').waitFor();
    assert.match(await f.page.locator('[data-confirmation-heading]').textContent(), /未通过|不通过/u);
    assert.equal(await f.page.locator('[data-confirmation-wallet]').isVisible(), false); assert.equal(await f.page.locator('[data-confirmation-group]').isVisible(), false);
    assert.equal((await f.runtime.app.registrationService.repository.list()).registrations.length, 1);
    await f.context.close(); reports.push({ explicitRejectionKeepsOriginal: true, rejectedPrivateStatusNoInvitationOrSeat: true });
  }
  {
    const f = await fixture({ capacity: 1 }), first = await f.runtime.seedPublic(pendingFields('合成先核准申请')), second = await f.runtime.seedPublic(pendingFields('合成核准候补'));
    await rawDecision(f, first.reference_code); await rawDecision(f, second.reference_code);
    assert.equal(f.runtime.messages.length, 3); assert.equal((await f.runtime.app.registrationService.getAdmissionStatus(second.reference_code)).status, 'waitlisted');
    const unreviewed = await f.runtime.seedPublic(pendingFields('合成尚未审核申请'));
    await openReview(f); await f.page.locator('[data-admissions-people]').getByRole('button', { name: '取消并释放名额' }).first().click();
    await f.page.locator('[data-admissions-people] tr').filter({ hasText: second.reference_code }).filter({ hasText: /已确认参会名额/u }).waitFor();
    assert.equal((await f.runtime.app.registrationService.getAdmissionStatus(second.reference_code)).status, 'confirmed');
    assert.equal((await f.runtime.app.registrationService.getAdmissionStatus(unreviewed.reference_code)).status, 'pending_review');
    assert.equal(f.runtime.messages.length, 5); assert.equal((await f.runtime.app.registrationService.getAdmissions({ actor: f.runtime.users[0] })).summary.confirmedCount, 1);
    await f.context.close(); reports.push({ approvedWaitlistNoEarlyFormalMail: true, releasePromotesApprovedOnly: true, pendingNeverAutoPromoted: true });
  }
  {
    const f = await fixture(), person = (await f.runtime.createContact({ name: '合成学生身份调整', categories: ['so'] })).contact;
    await f.page.goto(API + '/admin/contacts/', { waitUntil: 'domcontentloaded' });
    const personRow = f.page.locator('[data-directory-person="contact:' + person.id + '"]'); await personRow.waitFor();
    await personRow.locator('.people-row-menu > summary').click();
    await personRow.getByRole('button', { name: '编辑基本资料', exact: true }).click();
    await f.page.locator('[data-profile-dialog][open]').waitFor(); await f.page.locator('[data-profile-categories] [name=categories][value=so]').uncheck();
    await f.page.locator('[data-profile-categories] [name=categories][value=student]').check(); await f.page.locator('[data-profile-save]').click();
    await f.page.locator('[data-profile-dialog] .ah-form-save-state[data-save-state=saved]').waitFor();assert.equal(await f.page.locator('[data-profile-dialog]').isVisible(),true);await f.page.locator('[data-profile-close]').first().click();
    const current = (await f.runtime.app.contactsStore.read()).contacts.find(item => item.id === person.id);
    assert.deepEqual(current.profile.categories, ['student']); assert.deepEqual(current.sourceProfile.categories, ['so']);
    assert.deepEqual(current.source, person.source);
    await f.page.locator('[data-contacts-legacy-tools] > summary').click();
    await f.page.locator('[data-contacts-category]').selectOption('category:student'); assert.equal(await f.page.locator('[data-contacts-rows] tr').count(), 1);
    await f.page.locator('[data-contacts-category]').selectOption('source-category:so'); assert.equal(await f.page.locator('[data-contacts-rows] tr').count(), 1);
    assert.equal((await f.runtime.app.registrationService.repository.list()).registrations.length, 0); assert.equal(f.runtime.messages.length, 0);
    await f.context.close(); reports.push({ currentStudentEditable: true, originalIdentityRetainedAndFilterable: true, identityAloneNoAdmission: true });
  }
  {
    const f = await fixture({ username: 'reviewer' }), pending = await f.runtime.seedPublic(pendingFields('合成审核同事申请'));
    await openReview(f); assert.equal(await f.page.locator('[data-admissions-superadmin]:visible').count(), 0);
    await f.page.locator('[data-review-rows] tr').first().getByRole('button', { name: '查看与核查' }).click();
    await f.page.locator('[data-review-dialog][open]').waitFor(); f.expireNextApproval();
    await f.page.locator('[data-review-approve]').click(); await f.page.locator('[data-review-workspace]').waitFor({ state: 'hidden' });
    assert.equal(await f.page.locator('[data-review-dialog]').isVisible(), false);
    assert.equal(await f.page.locator('[data-admissions-people] tr').count(), 0);
    assert.equal((await f.page.locator('body').textContent()).includes('合成审核同事申请'), false, 'expired decisions erase applicant text even inside the closed modal');
    assert.equal(await f.page.locator('[data-review-user]').textContent(), '');
    assert.equal(await f.page.locator('[data-review-login-submit]').isEnabled(), true, 'an expired in-flight decision must not leave the login controls busy');
    assert.equal((await f.runtime.app.registrationService.getAdmissionStatus(pending.reference_code)).status, 'pending_review'); assert.equal(f.runtime.messages.length, 1);
    await f.page.locator('[data-review-login] [name=username]').fill('reviewer');
    await f.page.locator('[data-review-login] [name=password]').fill(PEOPLE_FIXTURE_PASSWORD); await f.page.locator('[data-review-login-submit]').click();
    await f.page.locator('[data-review-workspace]:visible').waitFor();
    assert.equal(f.writes.filter(item => item.path.endsWith('/admissions/approve')).length, 1, 'relogin never retries the original decision automatically');
    assert.equal(await f.page.locator('[data-admissions-approve="' + pending.reference_code + '"]').isDisabled(), true, 'the durable original decision blocks a fresh approval');
    await f.page.locator('[data-operations-local-draft="admission-pending"]').getByRole('button', { name: '恢复待核对操作', exact: true }).click();
    await f.page.locator('[data-admissions-retry]').click();
    await f.page.locator('[data-admissions-status]').filter({ hasText: /已确认参会名额/u }).waitFor(); assert.equal(f.runtime.messages.length, 2);
    const attempts = f.writes.filter(item => item.path.endsWith('/admissions/approve'));
    assert.equal(attempts.length, 2); assert.deepEqual(attempts[0].body, attempts[1].body, 'the restored decision keeps its original operationId and expected revision');
    await f.page.locator('[data-operations-local-draft="admission-pending"][data-operations-draft-state=discarded]').waitFor({state:'attached'});
    f.expireAdmissionRead(); await f.page.locator('[data-admissions-refresh]').click(); await f.page.locator('[data-review-workspace]').waitFor({ state: 'hidden' });
    assert.equal(await f.page.locator('[data-admissions-people] tr').count(), 0); assert.equal(await f.page.locator('[data-admissions-metrics]').textContent(), '');
    assert.equal((await f.page.locator('body').textContent()).includes('合成审核同事申请'), false, 'read expiry also erases retained applicant text');
    await f.context.close(); reports.push({ reviewerCanReviewWithoutSuperadminTools: true, detailDecisionExpiryClearsAndUnlocksLogin: true, reloginAfterExpiredDecisionWorks: true, sessionExpiryClearsPrivateReviewState: true });
  }
  {
    const f = await fixture({ username: 'outreach' }); await f.page.goto(API + '/admin/registrations/', { waitUntil: 'networkidle' });
    assert.equal(await f.page.locator('[data-review-workspace]').isVisible(), false);
    assert.equal(f.calls.some(item => item.path === '/api/admin/admissions' || item.path.startsWith('/api/admin/registrations')), false);
    assert.equal(f.runtime.messages.length, 0); await f.context.close(); reports.push({ noReviewerRoleNoPrivateSourceReads: true });
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ reports, pageErrors: errors, syntheticOnly: true }, null, 2));
} finally { await browser.close(); }
