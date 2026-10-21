// Actual runtime over memory OSS. Every browser request is intercepted; no real mail or people.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { peopleRuntimeFixture, PEOPLE_FIXTURE_API as API, PEOPLE_FIXTURE_PUBLIC as SITE } from '../helpers/people-runtime-fixture.mjs';

const { chromium } = await import(process.env.ARTDICO_PLAYWRIGHT_MODULE || 'playwright-core');
const project = fileURLToPath(new URL('../../', import.meta.url));
const dist = resolve(process.env.ARTDICO_DIST_DIRECTORY || resolve(project, 'dist'));
const evidence = resolve(project, '.local-data/browser-evidence'), reports = [], errors = [];
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0KFjAwMDAxMDAgKAAGOQBVgs9CEsAAAAASUVORK5CYII=';
const browser = await chromium.launch({ executablePath: process.env.ARTDICO_CHROMIUM_BINARY || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const operationId = () => randomBytes(32).toString('base64url');
const pendingFields = (name = '合成学生申请人') => ({ intake: 'general-v2', name, email: 'synthetic.application@example.invalid', categories: ['student'], participationInterests: ['attend'] });
const json = (value, status = 200, headers = {}) => ({ status, contentType: 'application/json', body: JSON.stringify(value), headers });

async function fixture({ width = 390, capacity = 3, mail = true, username = 'owner', submitAckLost = false, approvalAckLost = false } = {}) {
  const runtime = await peopleRuntimeFixture({ capacity, mail }), headers = await runtime.login(username);
  const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
  const [name, ...value] = headers.Cookie.split('=');
  await context.addCookies([{ domain: new URL(API).hostname, path: '/api/admin', name, value: value.join('='), httpOnly: true, secure: true, sameSite: 'Strict' }]);
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  const calls = [], writes = [], reads = [];
  let loseSubmit = submitAckLost, loseApproval = approvalAckLost, approving = false, rejectAdmissionRead = false;
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
    if (url.origin === API && path.startsWith('/api/')) {
      const requestHeaders = await req.allHeaders(), body = req.postData() ? JSON.parse(req.postData()) : null;
      const entry = { path, method: req.method(), body, headers: requestHeaders };
      calls.push(entry); if (req.method() === 'GET') reads.push(entry); else if (req.method() !== 'OPTIONS') writes.push(entry);
      if (/^\/api\/(?:public\/|admin\/registration\/)/u.test(path)) assert.equal(requestHeaders.cookie, undefined, 'public request omits the private staff cookie');
      if (path.endsWith('/registration/confirmation')) assert.equal(requestHeaders.referer, undefined, 'private receipt is not a Referer');
      if (rejectAdmissionRead && path === '/api/admin/admissions' && req.method() === 'GET') return route.fulfill(json({}, 401));
      const request = new Request(req.url(), { method: req.method(), headers: requestHeaders,
        ...(['GET', 'HEAD'].includes(req.method()) ? {} : { body: req.postData() }) });
      approving = path === '/api/admin/admissions/approve';
      let response;
      try { response = await runtime.app.handle(request); } finally { approving = false; }
      entry.status = response.status;
      if (loseSubmit && path === '/api/admin/registration/submit') {
        loseSubmit = false; await response.arrayBuffer();
        return route.fulfill(json({ error: { code: 'UNAVAILABLE' } }, 503, { 'access-control-allow-origin': SITE }));
      }
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
  return { runtime, context, page, headers, calls, writes, reads, api, expireAdmissionRead: () => { rejectAdmissionRead = true; } };
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
  await form.locator('[name=consentAccepted]').check();
}
async function submitApplication(f, form) {
  await form.locator('[data-submit]').click();
  await f.page.waitForURL(url => url.origin === SITE && url.pathname === '/registration/confirmation/' && url.hash.startsWith('#r='));
  await f.page.locator('[data-confirmation-content]:visible').waitFor();
  return (await f.runtime.app.registrationService.repository.list()).registrations.at(-1);
}
async function openReview(f) {
  await f.page.goto(API + '/admin/registrations/', { waitUntil: 'domcontentloaded' });
  await f.page.locator('[data-review-workspace]:visible').waitFor();
  await f.page.locator('[data-admissions-metrics] article').first().waitFor();
}
async function seedGroup(f) {
  await f.api('/api/admin/group-invite', { method: 'POST', body: { expectedRevision: 0, contentType: 'image/png', dataBase64: PNG, expiresAt: '2026-10-21T10:00:00.000Z' } });
}
async function assertPending(f, id) {
  const state = await f.runtime.app.registrationService.getAdmissions({ actor: f.runtime.users[0] });
  assert.equal(state.people.find(person => person.registrationId === id).status, 'pending_review');
  assert.equal(state.summary.confirmedCount, 0); assert.equal(state.summary.pendingReviewCount, 1);
  assert.equal(f.runtime.messages.length, 0);
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
    assert.equal(await form.locator('[data-speaker-proposal]').isVisible(), false);
    assert.equal(f.calls.filter(item => item.method === 'POST').length, 0);
    await noOverflow(f.page); await f.context.close();
    reports.push({ width, singleShortApplication: true, studentIdentity: true, noUnaskedControlsOrWrites: true });
  }
  {
    const f = await fixture(), form = await openPublic(f); await seedGroup(f); await fillApplication(form);
    await form.locator('[data-submit]').evaluate(button => { button.click(); button.click(); });
    await f.page.waitForURL(url => url.pathname === '/registration/confirmation/' && url.hash.startsWith('#r='));
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
    await rawDecision(f, record.id); assert.equal(f.runtime.messages.length, 1);
    await f.page.locator('[data-confirmation-refresh]').click(); await f.page.locator('[data-confirmation-page][data-admission=confirmed]').waitFor();
    await f.page.locator('[data-confirmation-group] img').waitFor(); assert.ok(f.reads.some(item => item.path.includes('/group-invite/')));
    await f.page.locator('[data-confirmation-refresh]').click(); assert.equal(f.runtime.messages.length, 1, 'read refresh never sends a second invitation');
    await f.context.close(); reports.push({ sparseStudentSaved: true, doubleClickOneApplication: true, pendingNoSeatMailGroupOrWallet: true, privatePrint: true, explicitApprovalOneMailAndGroup: true });
  }
  {
    const f = await fixture(), form = await openPublic(f); await fillApplication(form, { category: 'so', name: '合成组织者主题申请' });
    await form.locator('[data-proposal-toggle]').check(); await form.locator('[data-submit]').click();
    await form.locator('[data-error-for="speaker.topic"]:visible').waitFor();
    assert.equal(f.writes.filter(item => item.path.endsWith('/registration/submit')).length, 0);
    await form.locator('[name="speaker.topic"]').fill('合成分享主题'); await form.locator('[name="speaker.summary"]').fill('合成主题简介，只用于隔离浏览器验收。');
    const record = await submitApplication(f, form); await assertPending(f, record.id);
    assert.deepEqual(record.fields.categories, ['so']); assert.deepEqual(record.fields.participationInterests, ['attend', 'talk']);
    assert.deepEqual(record.fields.speaker, { topic: '合成分享主题', summary: '合成主题简介，只用于隔离浏览器验收。' });
    assert.equal(Object.hasOwn(record.fields, 'organization'), false); assert.equal(Object.hasOwn(record.fields, 'soRo'), false);
    assert.equal((await f.runtime.app.registrationService.repository.list()).registrations.length, 1);
    await f.context.close(); reports.push({ optionalTopicSharesApplication: true, proposalValidated: true, ordinaryOrganizerNoLegacyBranch: true });
  }
  {
    const f = await fixture({ submitAckLost: true }), form = await openPublic(f); await fillApplication(form);
    await form.locator('[data-submit]').click(); await form.locator('[data-submit]').filter({ hasText: /再次确认/u }).waitFor();
    assert.equal(await form.locator('[name=name]').isDisabled(), true); assert.equal(await form.locator('[name=name]').inputValue(), '合成学生申请人');
    assert.equal(f.writes.filter(item => item.path.endsWith('/registration/submit')).length, 1); assert.equal(f.runtime.messages.length, 0);
    await form.locator('[data-submit]').click(); await f.page.waitForURL(url => url.pathname === '/registration/confirmation/');
    const attempts = f.writes.filter(item => item.path.endsWith('/registration/submit')); assert.equal(attempts.length, 2);
    assert.deepEqual(attempts[0].body, attempts[1].body); assert.equal(attempts[0].headers['idempotency-key'], attempts[1].headers['idempotency-key']);
    const saved = await f.runtime.app.registrationService.repository.list(); assert.equal(saved.registrations.length, 1); await assertPending(f, saved.registrations[0].id);
    await f.context.close(); reports.push({ publicUnknownAckFrozen: true, samePayloadAndKeyRetry: true, noDuplicateApplicationOrMail: true });
  }
  {
    const f = await fixture({ width: 1440 }), pending = await f.runtime.seedPublic(pendingFields('合成内部意见申请'));
    await openReview(f); await f.page.locator('[data-review-filters] [name=category]').selectOption('student');
    await f.page.locator('[data-review-filters] button[type=submit]').click();
    await f.page.locator('[data-review-rows] tr').first().getByRole('button', { name: '查看与核查' }).click();
    await f.page.locator('[data-review-dialog][open]').waitFor(); await f.page.locator('[data-review-form] [name=status]').selectOption('approved');
    assert.equal(await f.page.locator('[data-review-approve]').isDisabled(), true, 'unsaved internal notes must be saved before a formal decision');
    await f.page.locator('[data-review-save]').click(); await f.page.locator('[data-review-status]').filter({ hasText: '核查记录已保存' }).waitFor();
    await f.page.locator('[data-review-approve]:enabled').waitFor();
    await assertPending(f, pending.reference_code);
    await f.page.locator('[data-review-approve]').click();
    await f.page.locator('[data-review-admission-status]').filter({ hasText: /已确认参会名额/u }).waitFor();
    assert.equal(f.runtime.messages.length, 1); assert.equal((await f.runtime.app.registrationService.getAdmissionStatus(pending.reference_code)).status, 'confirmed');
    await f.page.locator('[data-review-detail-close]').first().click();
    await f.page.screenshot({ path: resolve(evidence, 'application-review-desktop.png'), fullPage: true });
    await noOverflow(f.page); await f.context.close(); reports.push({ studentReviewFilter: true, internalApprovedAnnotationNoSeat: true, explicitReviewActionConfirmsAndSends: true });
  }
  {
    const f = await fixture({ approvalAckLost: true }), pending = await f.runtime.seedPublic(pendingFields('合成未知审核回执'));
    await openReview(f); await f.page.locator('[data-admissions-approve="' + pending.reference_code + '"]').click();
    await f.page.locator('[data-admissions-pending]:visible').waitFor(); assert.equal(f.runtime.messages.length, 0);
    assert.equal((await f.runtime.app.registrationService.getAdmissionStatus(pending.reference_code)).status, 'confirmed');
    assert.equal(f.writes.filter(item => item.path.endsWith('/admissions/approve')).length, 1);
    await f.page.locator('[data-admissions-refresh]').click(); await f.page.locator('[data-admissions-status]').filter({ hasText: /原操作结果仍待确认/u }).waitFor();
    assert.equal(f.runtime.messages.length, 0); assert.equal(f.writes.filter(item => item.path.endsWith('/admissions/approve')).length, 1);
    await f.page.locator('[data-admissions-retry]').click(); await f.page.locator('[data-admissions-pending]').waitFor({ state: 'hidden' });
    const attempts = f.writes.filter(item => item.path.endsWith('/admissions/approve')); assert.equal(attempts.length, 2); assert.deepEqual(attempts[0].body, attempts[1].body);
    assert.equal(f.runtime.messages.length, 1); assert.equal((await f.runtime.app.registrationService.repository.list()).registrations.length, 1);
    await f.context.close(); reports.push({ durableApprovalLostAck: true, readRefreshNoMail: true, explicitOriginalDecisionRetryOneMail: true });
  }
  {
    const f = await fixture(), pending = await f.runtime.seedPublic(pendingFields('合成不通过申请'));
    await openReview(f); await f.page.locator('[data-admissions-reject="' + pending.reference_code + '"]').click();
    await f.page.locator('[data-admissions-status]').filter({ hasText: /审核不通过/u }).waitFor();
    assert.equal((await f.runtime.app.registrationService.getAdmissionStatus(pending.reference_code)).status, 'rejected'); assert.equal(f.runtime.messages.length, 0);
    await f.page.goto(pending.confirmation.confirmationUrl); await f.page.locator('[data-confirmation-content]:visible').waitFor();
    assert.match(await f.page.locator('[data-confirmation-heading]').textContent(), /未通过|不通过/u);
    assert.equal(await f.page.locator('[data-confirmation-wallet]').isVisible(), false); assert.equal(await f.page.locator('[data-confirmation-group]').isVisible(), false);
    assert.equal((await f.runtime.app.registrationService.repository.list()).registrations.length, 1);
    await f.context.close(); reports.push({ explicitRejectionKeepsOriginal: true, rejectedPrivateStatusNoInvitationOrSeat: true });
  }
  {
    const f = await fixture({ capacity: 1 }), first = await f.runtime.seedPublic(pendingFields('合成先核准申请')), second = await f.runtime.seedPublic(pendingFields('合成核准候补'));
    await rawDecision(f, first.reference_code); await rawDecision(f, second.reference_code);
    assert.equal(f.runtime.messages.length, 1); assert.equal((await f.runtime.app.registrationService.getAdmissionStatus(second.reference_code)).status, 'waitlisted');
    const unreviewed = await f.runtime.seedPublic(pendingFields('合成尚未审核申请'));
    await openReview(f); await f.page.locator('[data-admissions-people]').getByRole('button', { name: '取消并释放名额' }).first().click();
    await f.page.locator('[data-admissions-status]').filter({ hasText: /候补转正/u }).waitFor();
    assert.equal((await f.runtime.app.registrationService.getAdmissionStatus(second.reference_code)).status, 'confirmed');
    assert.equal((await f.runtime.app.registrationService.getAdmissionStatus(unreviewed.reference_code)).status, 'pending_review');
    assert.equal(f.runtime.messages.length, 2); assert.equal((await f.runtime.app.registrationService.getAdmissions({ actor: f.runtime.users[0] })).summary.confirmedCount, 1);
    await f.context.close(); reports.push({ approvedWaitlistNoEarlyFormalMail: true, releasePromotesApprovedOnly: true, pendingNeverAutoPromoted: true });
  }
  {
    const f = await fixture(), person = (await f.runtime.createContact({ name: '合成学生身份调整', categories: ['so'] })).contact;
    await f.page.goto(API + '/admin/contacts/', { waitUntil: 'domcontentloaded' }); await f.page.locator('[data-contacts-rows] tr').first().waitFor();
    await f.page.locator('[data-contacts-rows] tr').first().getByRole('button', { name: '编辑资料', exact: true }).click();
    await f.page.locator('[data-profile-dialog][open]').waitFor(); await f.page.locator('[data-profile-categories] [name=categories][value=so]').uncheck();
    await f.page.locator('[data-profile-categories] [name=categories][value=student]').check(); await f.page.locator('[data-profile-save]').click();
    await f.page.locator('[data-profile-dialog]').waitFor({ state: 'hidden' });
    const current = (await f.runtime.app.contactsStore.read()).contacts.find(item => item.id === person.id);
    assert.deepEqual(current.profile.categories, ['student']); assert.deepEqual(current.sourceProfile.categories, ['so']);
    assert.deepEqual(current.source, person.source);
    await f.page.locator('[data-contacts-category]').selectOption('category:student'); assert.equal(await f.page.locator('[data-contacts-rows] tr').count(), 1);
    await f.page.locator('[data-contacts-category]').selectOption('source-category:so'); assert.equal(await f.page.locator('[data-contacts-rows] tr').count(), 1);
    assert.equal((await f.runtime.app.registrationService.repository.list()).registrations.length, 0); assert.equal(f.runtime.messages.length, 0);
    await f.context.close(); reports.push({ currentStudentEditable: true, originalIdentityRetainedAndFilterable: true, identityAloneNoAdmission: true });
  }
  {
    const f = await fixture({ username: 'reviewer' }), pending = await f.runtime.seedPublic(pendingFields('合成审核同事申请'));
    await openReview(f); assert.equal(await f.page.locator('[data-admissions-superadmin]:visible').count(), 0);
    await f.page.locator('[data-admissions-approve="' + pending.reference_code + '"]').click();
    await f.page.locator('[data-admissions-status]').filter({ hasText: /已确认参会名额/u }).waitFor(); assert.equal(f.runtime.messages.length, 1);
    f.expireAdmissionRead(); await f.page.locator('[data-admissions-refresh]').click(); await f.page.locator('[data-review-workspace]').waitFor({ state: 'hidden' });
    assert.equal(await f.page.locator('[data-admissions-people] tr').count(), 0); assert.equal(await f.page.locator('[data-admissions-metrics]').textContent(), '');
    assert.doesNotMatch(await f.page.locator('body').textContent(), /合成审核同事申请/u);
    await f.context.close(); reports.push({ reviewerCanReviewWithoutSuperadminTools: true, sessionExpiryClearsPrivateReviewState: true });
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
