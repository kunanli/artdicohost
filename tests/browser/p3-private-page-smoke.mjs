// P3/P4 client journeys: every request is intercepted, all identities and capabilities are synthetic.
import assert from 'node:assert/strict';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';

const { chromium } = await import(process.env.ARTDICO_PLAYWRIGHT_MODULE || 'playwright-core');
const project = fileURLToPath(new URL('../../', import.meta.url));
const dist = resolve(process.env.ARTDICO_DIST_DIRECTORY || resolve(project, 'dist'));
const evidence = resolve(process.env.ARTDICO_EVIDENCE_DIRECTORY || resolve(project, '.local-data/browser-evidence/p3-private-page'));
await mkdir(evidence, { recursive: true });
const htmlPath = resolve(dist, 'registration/confirmation/index.html'), html = await readFile(htmlPath);
assert.match(html.toString(), /https:\/\/api\.artdico\.host/u, 'build with the existing public API setting first');
assert.match(html.toString(), /noindex,nofollow,noarchive/u);
const build = { htmlSha256: createHash('sha256').update(html).digest('hex'), htmlModifiedAt: (await stat(htmlPath)).mtime.toISOString() };
const SITE = 'https://artdico.host', API = 'https://api.artdico.host';
const token = 'v1.' + 'x'.repeat(100) + '.' + 'y'.repeat(43), otherToken = 'v1.' + 'b'.repeat(100) + '.' + 'c'.repeat(43);
const link = SITE + '/registration/confirmation/#r=' + token;
const ios = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
const android = 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36 MicroMessenger/8.0';
const event = { id: 'synthetic-p3-event', title: '合成 P3 验收活动', date: '2026-12-05', time: '10:00–18:00', venue: '合成活动场地', timezone: 'Asia/Shanghai', checkIn: '09:30' };
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1cAAAAASUVORK5CYII=', 'base64');
const reports = [], errors = [];
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': SITE } });
const browser = await chromium.launch({ executablePath: process.env.ARTDICO_CHROMIUM_BINARY || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

async function fixture({ width = 390, userAgent = ios, status = 'confirmed', group = 'valid', imageFailure = false, factsReady = true, holdFirst = false, expireSoon = false, notifications = undefined, otherNotifications = undefined } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, userAgent });
  await context.addCookies([{ name: 'synthetic_staff', value: 'PRIVATE-COOKIE-MUST-NOT-LEAK', domain: 'api.artdico.host', path: '/', secure: true, httpOnly: true, sameSite: 'Strict' }]);
  await context.addInitScript(() => {
    globalThis.__p3 = { copied: [], created: [], revoked: [], failClipboard: false };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { if (globalThis.__p3.failClipboard) throw new Error('synthetic unavailable clipboard');globalThis.__p3.copied.push(text); } } });
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); globalThis.__p3.created.push(url); return url; };
    URL.revokeObjectURL = url => { globalThis.__p3.revoked.push(url); revoke(url); };
  });
  const page = await context.newPage(), calls = [];
  page.on('pageerror', error => errors.push(error.message));
  const memory = { status, group, imageFailure, factsReady, notifications, otherNotifications, readStatus: 200, walletStatus: 200, readCount: 0, groupVersion: 1, held: null, mail: false, writes: 0 };
  const receipt = received => ({
    event, referenceCode: (received === otherToken ? 's' : 'r').repeat(43), submittedAt: '2026-10-21T00:00:00Z',
    attendee: { name: received === otherToken ? '合成报名人乙' : '合成报名人甲', organization: '合成机构', email: 'PRIVATE-SOURCE-MUST-NOT-RENDER' },
    admission: { status: memory.status, kind: 'attendee', revision: 2 }, email: { status: 'provider_accepted' }, wallet: { ready: true },
    eventFacts: { ready: memory.factsReady, reason: memory.factsReady ? 'EVENT_FACTS_VERIFIED' : 'EVENT_FACTS_MISMATCH', revision: 43 },
    invitation: { ready: true, settings: { recipientName: received === otherToken ? '合成报名人乙' : '合成报名人甲', date: event.date, time: event.time, venue: event.venue, confirmed: true, renderVersion: 'ggj2026-poster-v2' } },
    groupInvite: memory.group === 'missing' ? null : { platform: 'wechat', qrImageUrl: API + '/api/registration/group-invite/synthetic-p3.' + memory.groupVersion, expiresAt: new Date(Date.now() + (memory.group === 'expired' ? -1_000 : expireSoon ? 1_500 : 600_000)).toISOString() },
    ...(memory.notifications !== undefined ? { notifications: structuredClone(received === otherToken && memory.otherNotifications !== undefined ? memory.otherNotifications : memory.notifications) } : {}),
  });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === SITE) {
      const file = resolve(dist, '.' + (url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname));
      assert.ok(file.startsWith(dist + '/'));
      try { return route.fulfill({ status: 200, body: await readFile(file), contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' })[extname(file)] || 'application/octet-stream' }); }
      catch { return route.fulfill({ status: 404, body: '' }); }
    }
    assert.equal(url.origin, API, 'no external network is allowed');
    assert.equal(request.headers().cookie, undefined);
    assert.equal(request.headers().referer, undefined);
    calls.push({ path: url.pathname, method: request.method() });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': SITE, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'Content-Type' } });
    if (url.pathname === '/api/admin/registration/confirmation') {
      assert.equal(request.method(), 'POST');
      const body = JSON.parse(request.postData());assert.deepEqual(Object.keys(body), ['receiptToken']);assert.ok([token, otherToken].includes(body.receiptToken));
      memory.readCount++;
      const result = receipt(body.receiptToken);
      if (holdFirst && memory.readCount === 1) { memory.held = () => route.fulfill(json(result)); return; }
      return route.fulfill(memory.readStatus === 200 ? json(result) : json({ error: { code: 'SYNTHETIC_READ_FAILURE' } }, memory.readStatus));
    }
    if (url.pathname === '/api/admin/registration/wallet') {
      assert.equal(request.method(), 'POST');assert.deepEqual(JSON.parse(request.postData()), { receiptToken: token });
      if (memory.walletStatus !== 200) return route.fulfill(json({ error: { code: 'SYNTHETIC_WITHDRAWN' } }, memory.walletStatus));
      // Only exercise the download UI here; signed PKPASS validation has its own disposable fixture suite.
      return route.fulfill({ status: 200, body: Buffer.from([80, 75, 3, 4, 1]), contentType: 'application/vnd.apple.pkpass', headers: { 'access-control-allow-origin': SITE } });
    }
    if (/^\/api\/registration\/group-invite\/synthetic-p3\.[12]$/u.test(url.pathname)) {
      assert.equal(request.method(), 'GET');
      return route.fulfill({ status: memory.imageFailure ? 410 : 200, body: memory.imageFailure ? '' : image, contentType: 'image/png', headers: { 'access-control-allow-origin': SITE } });
    }
    memory.writes++;throw new Error('Unexpected API route: ' + url.pathname);
  });
  async function open() { await page.goto(link, { waitUntil: holdFirst ? 'domcontentloaded' : 'networkidle' });if (!holdFirst) await page.locator('[data-confirmation-content]:visible').waitFor(); }
  async function close() {
    assert.equal(memory.mail, false);assert.equal(memory.writes, 0);
    assert.equal(calls.some(call => /submit|dispatch|manual-sent|generated|withdraw|admission/u.test(call.path)), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const storage = await page.evaluate(() => ({ local: Object.entries(localStorage), session: Object.entries(sessionStorage) }));assert.deepEqual(storage, { local: [], session: [] });
    assert.doesNotMatch(await page.locator('body').textContent(), /PRIVATE-SOURCE-MUST-NOT-RENDER/u);
    await context.close();
  }
  return { page, memory, calls, open, close };
}

async function cleared(page) {
  assert.equal(await page.locator('[data-confirmation-content]').isVisible(), false);
  for (const field of ['name', 'organization', 'event', 'date', 'time', 'venue', 'reference', 'email', 'application-received', 'pre-event-reminder']) assert.equal(await page.locator('[data-confirmation-' + field + ']').textContent(), '');
  assert.equal(await page.locator('[data-confirmation-notifications]').evaluate(output => output.hidden), true);
  assert.equal(await page.locator('[data-confirmation-private-link]').inputValue(), '');
  assert.equal(await page.locator('[data-confirmation-wallet]').isVisible(), false);assert.equal(await page.locator('[data-confirmation-group] img').count(), 0);
  for(const selector of ['[data-confirmation-more]', '[data-confirmation-registration]', '[data-confirmation-notice-records]', '[data-confirmation-group-help]'])assert.equal(await page.locator(selector).evaluate(node => node.open), false);
  assert.equal(await page.locator('[data-confirmation-safari-guide]').isVisible(), false);
  assert.equal(await page.locator('[data-confirmation-invitation-image]').getAttribute('src'), null);assert.equal(await page.locator('[data-confirmation-invitation-download]').getAttribute('href'), null);
}

try {
  for (const width of [320, 390, 1440]) {
    const f = await fixture({ width });await f.open();
    const order = await f.page.evaluate(() => ['[data-confirmation-heading]', '.confirmation-details', '.confirmation-save', '[data-confirmation-group]'].map(selector => document.querySelector(selector).getBoundingClientRect().top));assert.deepEqual(order, [...order].sort((a, b) => a - b));
    assert.equal(await f.page.locator('[data-confirmation-more]').getAttribute('open'), null);
    assert.equal(await f.page.locator('[data-confirmation-notifications]').evaluate(output => output.hidden), true);assert.equal(await f.page.locator('[data-confirmation-application-received]').textContent(), '');assert.equal(await f.page.locator('[data-confirmation-pre-event-reminder]').textContent(), '');
    assert.equal(await f.page.locator('[data-confirmation-print]').isVisible(), false);
    await f.page.locator('[data-confirmation-group] img').evaluate(img => img.decode());
    assert.match(await f.page.locator('.confirmation-group-validity').textContent(), /10 分钟.*7 天.*不代表微信群码已过期/u);
    await f.page.locator('[data-confirmation-copy]').click();assert.deepEqual(await f.page.evaluate(() => globalThis.__p3.copied), [link]);
    await f.page.locator('[data-confirmation-more] summary').click();assert.equal(await f.page.locator('[data-confirmation-print]').isVisible(), true);assert.equal(await f.page.locator('[data-confirmation-invitation]').isVisible(), true);
    await f.page.screenshot({ path: resolve(evidence, 'confirmed-' + width + '.png'), fullPage: true });await f.close();reports.push({ width, orderedPage: true, secondaryPrintAndPng: true, copyIsPrivateAndNotPersisted: true });
  }
  for (const status of ['pending_review', 'waitlisted', 'rejected', 'withdrawn']) {
    const f = await fixture({ status });await f.open();
    assert.equal(await f.page.locator('[data-confirmation-group]').isVisible(), false);assert.equal(await f.page.locator('[data-confirmation-wallet]').isVisible(), false);
    assert.equal(f.calls.some(call => call.path.includes('/group-invite/')), false);
    assert.equal(await f.page.locator('[data-confirmation-save-heading]').textContent(), '保存查询入口');
    assert.equal(await f.page.locator('[data-confirmation-outcome-contact]').isVisible(), ['rejected', 'withdrawn'].includes(status));
    if (status === 'withdrawn') assert.equal(await f.page.locator('[data-confirmation-name]').textContent(), '');
    await f.close();reports.push({ status, noGroupOrWallet: true, actualResult: true });
  }
  for (const group of ['missing', 'expired', 'image-failure']) {
    const f = await fixture({ group: group === 'image-failure' ? 'valid' : group, imageFailure: group === 'image-failure' });await f.open();
    const message = f.page.locator('[data-confirmation-group-status]');await message.filter({ hasText: '群码待更新，请重新读取或联系主办方' }).waitFor();
    assert.equal(await f.page.locator('[data-confirmation-group]').isVisible(), true);assert.equal(await f.page.locator('[data-confirmation-group] img').count(), 0);
    await f.page.locator('[data-confirmation-group] [data-confirmation-contact-copy]').click();assert.deepEqual(await f.page.evaluate(() => globalThis.__p3.copied), ['support@artdico.co']);
    f.memory.group = 'valid';f.memory.imageFailure = false;f.memory.groupVersion = 2;
    await f.page.locator('[data-confirmation-group-refresh]').evaluate(button => { button.click(); button.click(); });
    await f.page.locator('[data-confirmation-group] img').evaluate(img => img.decode());assert.equal(f.memory.readCount, 2);
    assert.equal(await f.page.locator('[data-confirmation-group-refresh]').isDisabled(), true);assert.match(await f.page.locator('[data-confirmation-group] img').getAttribute('src'), /synthetic-p3\.2$/u);
    await f.close();reports.push({ group, recoveryPreserved: true, explicitReadOnlyRecovery: true, duplicateReadBounded: true });
  }
  {
    const f = await fixture({ expireSoon: true });await f.open();await f.page.locator('[data-confirmation-group-status]').filter({ hasText: '群码待更新' }).waitFor();assert.equal(await f.page.locator('[data-confirmation-group]').isVisible(), true);assert.equal(f.memory.readCount, 1);await f.close();reports.push({ shortImageExpiryRemovesImageWithoutAutomaticRead: true });
  }
  for (const device of ['wechat-ios', 'safari-ios', 'android']) {
    const f = await fixture({ userAgent: device === 'android' ? android : ios + (device === 'wechat-ios' ? ' MicroMessenger/8.0' : ''), notifications: { applicationReceived: { status: 'provider_accepted' }, preEventReminder: { status: 'unknown' } } });await f.open();assert.match(await f.page.locator('[data-confirmation-application-received]').textContent(), /回执不代表获邀/u);
    const hint = await f.page.locator('[data-confirmation-device]').textContent();
    if (device === 'wechat-ios') assert.match(hint, /微信.*Safari/u);
    if (device === 'safari-ios') assert.match(hint, /系统提示确认添加.*不代表已加入/u);
    if (device === 'android') { assert.match(hint, /私人链接.*PNG.*PDF/u);assert.equal(await f.page.locator('[data-confirmation-wallet]').isVisible(), false); }
    else if (device === 'wechat-ios') {
      assert.equal(await f.page.locator('[data-confirmation-wallet]').textContent(), '查看 Safari 添加指引');
      await f.page.locator('[data-confirmation-wallet]').click();await f.page.locator('[data-confirmation-safari-guide]:visible').waitFor();
      assert.equal(f.calls.some(call => call.path.endsWith('/wallet')), false, 'WeChat guidance never attempts a Wallet download');
      await f.page.locator('[data-confirmation-safari-copy]').click();assert.deepEqual(await f.page.evaluate(() => globalThis.__p3.copied), [link]);
      f.memory.readStatus = 401;await f.page.locator('[data-confirmation-refresh]').click();await f.page.locator('[data-confirmation-error]:visible').waitFor();await cleared(f.page);
      assert.equal(await f.page.locator('[data-confirmation-safari-guide]').isVisible(), false);
      assert.deepEqual(await f.page.evaluate(() => globalThis.__p3.created), []);
    } else {
      const waiting = f.page.waitForEvent('download');await f.page.locator('[data-confirmation-wallet]').click();const download = await waiting;assert.equal(download.suggestedFilename(), 'artdico-host.pkpass');
      assert.match(await f.page.locator('[data-confirmation-action-status]').textContent(), /票券文件已准备/u);assert.doesNotMatch(await f.page.locator('[data-confirmation-action-status]').textContent(), /已加入|添加成功/u);
      f.memory.walletStatus = 401;await f.page.locator('[data-confirmation-wallet]').click();await f.page.locator('[data-confirmation-error]:visible').waitFor();await cleared(f.page);
      const probe = await f.page.evaluate(() => globalThis.__p3);assert.ok(probe.created.length);assert.ok(probe.created.every(url => probe.revoked.includes(url)));
    }
    await f.close();reports.push({ device, correctGuidance: true, downloadIsNotInstallation: true, ...(device === 'safari-ios' ? { wallet401ClearsPrivateDataAndBlob: true } : device === 'wechat-ios' ? { guideDoesNotDownloadAnd401ClearsIt: true } : {}) });
  }
  {
    const f = await fixture({ factsReady: false });await f.open();assert.match(await f.page.locator('h1').textContent(), /名额已确认/u);assert.equal(await f.page.locator('[data-confirmation-facts-warning]').isVisible(), true);assert.match(await f.page.locator('[data-confirmation-email]').textContent(), /提交发送/u);assert.equal(await f.page.locator('[data-confirmation-wallet]').isVisible(), false);assert.equal(await f.page.locator('[data-confirmation-group]').isVisible(), true);await f.close();reports.push({ factsMismatchPreservesAdmissionAndEmailHistory: true });
  }
  for (const readStatus of [401, 503]) {
    const f = await fixture({ notifications: { applicationReceived: { status: 'provider_accepted' }, preEventReminder: { status: 'provider_accepted' } } });await f.open();await f.page.locator('[data-confirmation-notice-records] summary').click();await f.page.locator('[data-confirmation-notifications]:visible').waitFor();await f.page.evaluate(() => { globalThis.__p3.failClipboard = true; });await f.page.locator('[data-confirmation-copy]').click();await f.page.locator('[data-confirmation-copy-fallback]:visible').waitFor();assert.equal(await f.page.locator('[data-confirmation-private-link]').inputValue(), link);f.memory.readStatus = readStatus;await f.page.locator('[data-confirmation-refresh]').click();await f.page.locator('[data-confirmation-error]:visible').waitFor();await cleared(f.page);await f.close();reports.push({ readStatus, failedReadClearsPreviousPrivateDataAndVisibleCapabilityInput: true, typedNoticeHistoryCleared: true });
  }
  {
    const f = await fixture({ holdFirst: true, notifications: { applicationReceived: { status: 'provider_accepted' }, preEventReminder: { status: 'pending' } }, otherNotifications: { applicationReceived: { status: 'rejected' }, preEventReminder: { status: 'unknown' } } });await f.open();await f.page.waitForFunction(() => document.querySelector('[data-confirmation-page]'));
    for (let index = 0; index < 100 && !f.memory.held; index++) await f.page.waitForTimeout(20);assert.ok(f.memory.held);
    await f.page.evaluate(value => { location.hash = '#r=' + value; }, otherToken);await f.page.locator('[data-confirmation-name]').filter({ hasText: '合成报名人乙' }).waitFor();await f.memory.held();
    await f.page.waitForTimeout(30);assert.equal(await f.page.locator('[data-confirmation-name]').textContent(), '合成报名人乙');assert.doesNotMatch(await f.page.locator('body').textContent(), /合成报名人甲/u);
    assert.match(await f.page.locator('[data-confirmation-application-received]').textContent(), /未能发出/u);assert.match(await f.page.locator('[data-confirmation-pre-event-reminder]').textContent(), /无法确认/u);
    await f.page.evaluate(() => { location.hash = '#r=invalid'; });await f.page.locator('[data-confirmation-error]:visible').waitFor();await cleared(f.page);await f.close();reports.push({ changedPrivateLinkIgnoresLatePersonAndClearsInvalidCapability: true });
  }
  const noticeStates = ['not_sent', 'not_applicable', 'not_configured', 'disabled', 'pending', 'provider_accepted', 'rejected', 'unknown'];
  const noticePatterns = { not_sent: /暂无.*发送记录/u, not_applicable: /无需/u, not_configured: /暂未启用/u, disabled: /已暂停/u, pending: /待处理/u, provider_accepted: /已提交发送/u, rejected: /未能发出/u, unknown: /无法确认/u };
  for (const [index, status] of noticeStates.entries()) {
    const width = [320, 390, 1440][index % 3], f = await fixture({ width, notifications: { applicationReceived: { status }, preEventReminder: { status } } });await f.open();
    assert.equal(await f.page.locator('[data-confirmation-notifications]').isVisible(), false);await f.page.locator('[data-confirmation-notice-records] summary').click();await f.page.locator('[data-confirmation-notifications]:visible').waitFor();
    for (const key of ['application-received', 'pre-event-reminder']) { const message = await f.page.locator('[data-confirmation-' + key + ']').textContent();assert.match(message, noticePatterns[status]);assert.doesNotMatch(message, /已送达|添加成功|已获邀|名额已确认/u); }
    assert.match(await f.page.locator('h1').textContent(), /名额已确认/u);assert.match(await f.page.locator('[data-confirmation-email]').textContent(), /确认邮件已提交发送/u);
    if ([0, 5, 7].includes(index)) await f.page.screenshot({ path: resolve(evidence, 'typed-notices-' + width + '.png'), fullPage: true });
    await f.close();reports.push({ noticeStatus: status, width, distinctTypedHistory: true, collapsedByDefault: true, formalEmailAndAdmissionPreserved: true });
  }
  {
    const f = await fixture({ status: 'pending_review', notifications: { applicationReceived: { status: 'provider_accepted' }, preEventReminder: { status: 'not_sent' } } });await f.open();await f.page.locator('[data-confirmation-notice-records] summary').click();
    assert.match(await f.page.locator('h1').textContent(), /申请已收到，待审核/u);assert.match(await f.page.locator('[data-confirmation-application-received]').textContent(), /回执不代表获邀/u);assert.doesNotMatch(await f.page.locator('[data-confirmation-email]').textContent(), /确认邮件已提交发送/u);
    for (const key of ['group', 'wallet', 'invitation']) assert.equal(await f.page.locator('[data-confirmation-' + key + ']').isVisible(), false);assert.equal(f.calls.some(call => call.path.includes('/group-invite/')), false);
    await f.close();reports.push({ pendingReceiptAcceptedIsNotAdmissionOrFormalConfirmation: true, noCredentialAccessFromTypedHistory: true });
  }
  for (const malformedKind of ['applicationReceived', 'preEventReminder']) {
    const notices = { applicationReceived: { status: 'provider_accepted' }, preEventReminder: { status: 'provider_accepted' } };notices[malformedKind] = { status: 'delivered', recipient: 'PRIVATE-UNTRUSTED-RECIPIENT', body: '<a href="https://private.invalid/notice">PRIVATE-UNTRUSTED-BODY</a>' };
    const f = await fixture({ notifications: notices });await f.open();await f.page.locator('[data-confirmation-notice-records] summary').click();
    const badKey = malformedKind === 'applicationReceived' ? 'application-received' : 'pre-event-reminder', goodKey = malformedKind === 'applicationReceived' ? 'pre-event-reminder' : 'application-received';
    assert.match(await f.page.locator('[data-confirmation-' + badKey + ']').textContent(), /无法确认/u);assert.match(await f.page.locator('[data-confirmation-' + goodKey + ']').textContent(), /已提交发送/u);assert.match(await f.page.locator('[data-confirmation-email]').textContent(), /确认邮件已提交发送/u);assert.match(await f.page.locator('h1').textContent(), /名额已确认/u);assert.doesNotMatch(await f.page.locator('body').textContent(), /PRIVATE-UNTRUSTED|private\.invalid/u);assert.equal(await f.page.locator('[href="https://private.invalid/notice"]').count(), 0);
    await f.close();reports.push({ malformedKind, onlyThatKindUnknown: true, untrustedNoticeFieldsNotRendered: true });
  }
  assert.deepEqual(errors, []);console.log(JSON.stringify({ build, reports, syntheticOnly: true, allRequestsIntercepted: true, realMail: false, businessWrites: 0, actualWalletInstallation: false, pageErrors: errors }, null, 2));
} finally { await browser.close(); }
