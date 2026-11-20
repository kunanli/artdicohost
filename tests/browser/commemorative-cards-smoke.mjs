import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createAppleWalletApi } from '../../functions/apple-wallet/handler.mjs';
import { createAppleWalletService } from '../../functions/apple-wallet/service.mjs';
import { createWalletFixture, passFiles } from '../apple-wallet-fixture.mjs';
import { peopleRuntimeFixture, PEOPLE_FIXTURE_API as API, PEOPLE_FIXTURE_PUBLIC as SITE, PEOPLE_FIXTURE_PASSWORD } from '../helpers/people-runtime-fixture.mjs';

const dist = resolve(process.env.ARTDICO_DIST_DIRECTORY ?? 'dist');
const output = resolve(process.env.ARTDICO_EVIDENCE_DIRECTORY ?? '.local-data/browser-evidence/commemorative-cards');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
const browser = await chromium.launch({ executablePath: process.env.ARTDICO_CHROMIUM_BINARY || '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const reports = [];
const signing = await createWalletFixture();
await mkdir(output, { recursive: true });

try {
  for (const [width, outcome, device] of [[320, 'accepted', 'other'], [390, 'accepted', 'safari'], [390, 'accepted', 'chrome'], [1440, 'unknown', 'other']]) {
    const isCard = message => /电子纪念卡/u.test(message.template_params.email_subject);
    let attempts = 0;
    const fixture = await peopleRuntimeFixture({ mail: true, mailResult: message => isCard(message) && ++attempts === 1 ? outcome : 'accepted' });
    const walletAvailable = device !== 'other';
    const wallet = createAppleWalletService({ env: signing.env, tokenSecret: 'synthetic-browser-card-signing-token-secret',
      clock: () => signing.now, trustedRootFingerprints: signing.fields.trustedRootFingerprints,
      authorize: fixture.app.confirmationService.authorize, authorizedRegistration: fixture.app.confirmationService.authorizedRegistration });
    const walletApi = createAppleWalletApi({ service: wallet });
    const iosAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 ';
    const context = await browser.newContext({ viewport: { width, height: 840 }, locale: 'zh-CN',
      ...(walletAvailable ? { userAgent: iosAgent + (device === 'safari' ? 'Version/18.0' : 'CriOS/131.0') + ' Mobile/15E148 Safari/604.1' } : {}) });
    const errors = [];
    let privateReads = 0, staleIdentity = width === 320;
    try {
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        try {
          assert.ok([SITE, API].includes(url.origin));
          if (url.origin === API && url.pathname.startsWith('/api/')) {
            const method = request.method();
            const privateRead = method === 'POST' && ['/api/admin/registration/confirmation', '/api/registration/confirmation'].includes(url.pathname);
            if (privateRead) privateReads++;
            if (staleIdentity && method === 'PATCH' && url.pathname.startsWith('/api/admin/registration-confirmation/cards/')) {
              staleIdentity = false;
              return route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":{"message":"资料已更新，请核对后再保存。"}}' });
            }
            const headers = new Headers(await request.allHeaders());
            if (device === 'chrome' && url.pathname === '/api/admin/registration/confirmation') headers.set('accept', 'application/json');
            const input = new Request(url.href, { method, headers,
              ...(['GET', 'HEAD'].includes(method) ? {} : { body: request.postData() }) });
            const response = await (walletAvailable && url.pathname === '/api/admin/registration/wallet' ? walletApi(input) : fixture.app.handle(input));
            if (walletAvailable && privateRead && response.ok) {
              const data = await response.json();
              if (data.card?.format === 'both') data.wallet = await wallet.readiness();
              return route.fulfill({ status: 200, headers: Object.fromEntries(response.headers), json: data });
            }
            return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
          }
          const path = resolve(dist, '.' + url.pathname + (url.pathname.endsWith('/') ? 'index.html' : ''));
          assert.ok(path.startsWith(dist + '/'));
          try { return route.fulfill({ status: 200, contentType: mime[extname(path)] ?? 'application/octet-stream', body: await readFile(path) }); }
          catch (error) { if (error.code !== 'ENOENT') throw error; return route.fulfill({ status: 404, body: '' }); }
        } catch (error) { errors.push(error.message); return route.fulfill({ status: 503, body: '' }); }
      });

      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      await page.clock.setFixedTime(new Date('2026-10-21T09:00:00Z'));
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(SITE + '/#wallet-card-application');
      const recipient = 'synthetic.card@example.invalid';
      const application = page.locator('[data-wallet-form]');
      for (const [name, value] of Object.entries({ huodongxingReference: '0000000420', name: '合成纪念卡申请人', email: recipient, wechat: 'synthetic_card_user' })) {
        await application.locator('[name="wallet.' + name + '"]').fill(value);
      }
      if (device === 'safari') {
        await application.locator('[name="wallet.requestedWalletIdentity"]').selectOption('organizer');
        await application.locator('[data-wallet-community] summary').click();
        await application.locator('[name="wallet.ggjSite"]').fill('GGJ 合成站');
        await application.locator('[name="wallet.ggjRole"]').fill('站点组织者');
      }
      await page.locator('#wallet-consent').check();
      await page.locator('[data-wallet-submit]').click();
      await page.locator('[data-wallet-result]:not([hidden])').waitFor();
      await fixture.seedWallet({ name: '另一个待核对的申请', huodongxingReference: '0000000510' });

      await page.goto(API + '/admin/cards/');
      await page.locator('#card-user').fill('owner');
      await page.locator('#card-password').fill(PEOPLE_FIXTURE_PASSWORD);
      await page.locator('[data-card-login] button').click();
      assert.equal(await page.locator('[data-staff-page="cards"]').getAttribute('aria-current'), 'page');
      await page.locator('[data-card-search]').fill('0000000420');
      await page.getByRole('button', { name: /合成纪念卡申请人/u }).click();
      await page.locator('[data-card-details]:not([hidden])').waitFor();
      assert.equal(await page.locator('[data-card-list] button').count(), 1);
      assert.equal(await page.locator('[data-card-filter="todo"] span').textContent(), '2');
      assert.equal(await page.locator('[data-card-list] small').textContent(), '核对报名');
      assert.equal(await page.locator('[data-card-recipient]').innerText(), recipient);
      if (device === 'safari') {
        assert.match(await page.locator('[data-card-requested-identity]').innerText(), /组织者/u);
        assert.equal(await page.locator('#card-identity').inputValue(), 'organizer');
      }
      const selectedUrl = page.url();
      assert.match(selectedUrl, /#application=[A-Za-z0-9_-]{43}$/u);
      await page.reload();
      await page.locator('[data-card-details]:not([hidden])').waitFor();
      assert.equal(page.url(), selectedUrl);
      assert.equal(await page.locator('[data-card-recipient]').innerText(), recipient);
      await page.locator('[data-card-search]').fill('0000000420');
      const cardMessages = () => fixture.messages.filter(isCard);
      assert.equal(cardMessages().length, 0);
      await page.locator('[data-card-approve]').click();
      await page.locator('#card-identity').selectOption('guest');
      assert.equal(await page.locator('[data-card-list] small').textContent(), '设置卡面身份');
      await page.locator('[data-card-identity-form] button').click();
      if (width === 320) {
        await page.getByRole('alert').filter({ hasText: '资料已更新，请核对后再保存。' }).waitFor();
        assert.equal(await page.locator('[data-card-detail-error]').isVisible(), true);
        assert.equal(await page.locator('[data-card-error]').isVisible(), false);
        assert.equal(page.url(), selectedUrl);
        await page.locator('#card-identity').selectOption('guest');
        await page.locator('[data-card-identity-form] button').click();
      }
      assert.equal(await page.locator('#card-format').count(), 0);
      await page.locator('[data-card-delivery]:visible').waitFor();
      assert.match(await page.locator('[data-card-delivery-formats]').textContent(), /同一链接领取/u);
      assert.equal(await page.locator('[data-card-identity-value] span').innerText(), '嘉宾');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      if (device === 'safari') {
        await page.locator('[data-card-community-summary]').click();
        assert.match(await page.locator('[data-card-requested-community]').innerText(), /GGJ 合成站 · 站点组织者/u);
        assert.equal(await page.getByLabel('GGJ 站点').inputValue(), 'GGJ 合成站');
        assert.equal(await page.getByLabel('社群角色').inputValue(), '站点组织者');
        await page.getByRole('button', { name: '保存 GGJ 社群' }).click();
        await page.getByRole('status').filter({ hasText: 'GGJ 社群已保存。' }).waitFor();
        assert.match(await page.locator('[data-card-community-summary]').textContent(), /GGJ 合成站 · 站点组织者/u);
      }
      assert.equal(cardMessages().length, 0);
      await page.screenshot({ path: resolve(output, 'staff-' + width + '.png'), fullPage: true });
      await page.locator('[data-card-delivery] button').click();

      const resend = page.getByRole('button', { name: '重新发送纪念卡' });
      await resend.waitFor();
      assert.equal(cardMessages().length, 1);
      if (outcome === 'unknown') {
        assert.equal(await page.locator('[data-card-check]').isVisible(), false);
        assert.equal(await page.locator('[data-card-list] small').first().textContent(), '寄送结果未确认');
        assert.match(await page.locator('[data-card-delivery-formats]').textContent(), /两封/u);
        await page.reload();
        await resend.waitFor();
        assert.equal(cardMessages().length, 1, 'reading an uncertain delivery never resends it');
      }
      await resend.click();
      await page.getByRole('status').filter({ hasText: '已重新提交纪念卡邮件。' }).waitFor();
      assert.equal(cardMessages().length, 2);
      assert.equal(await page.locator('[data-card-state]').textContent(), '纪念卡邮件已提交发送');
      assert.equal(await page.locator('[data-card-name]').textContent(), '合成纪念卡申请人');
      if (outcome === 'accepted') {
        assert.equal(await page.locator('[data-card-name]').textContent(), '合成纪念卡申请人');
        assert.equal(await page.locator('[data-card-filter="todo"] span').textContent(), '1');
        assert.equal(await page.locator('[data-card-filter="submitted"] span').textContent(), '1');
        await page.locator('[data-card-filter="submitted"]').click();
        assert.equal(await page.locator('[data-card-list] small').textContent(), '已提交发送');
        const link = /https:\/\/artdico\.host\/registration\/confirmation\/#r=[A-Za-z0-9_.-]+/u.exec(cardMessages()[0].template_params.invitation_text)[0];
        const readsBefore = privateReads;
        await page.goto(link);
        const downloadButton = page.getByRole('link', { name: '下载 JPEG 纪念卡' });
        await downloadButton.waitFor();
        assert.equal(await downloadButton.evaluate(button => button.getBoundingClientRect().bottom <= innerHeight), true);
        const image = page.locator('[data-confirmation-jpeg-image]');
        await page.waitForFunction(node => node.complete && node.naturalWidth === 1030 && node.naturalHeight === 1510, await image.elementHandle());
        assert.match(await image.getAttribute('alt'), /入场身份：嘉宾/u);
        if (device === 'safari') {
          assert.equal(await page.locator('[data-confirmation-community]').innerText(), 'GGJ 合成站 · 站点组织者');
          assert.match(await image.getAttribute('alt'), /GGJ 合成站 · 站点组织者/u);
        } else {
          assert.equal(await page.locator('[data-confirmation-community]').isVisible(), false);
        }
        assert.equal(await image.evaluate(node => node.clientWidth === node.closest('.confirmation-save').clientWidth), true);
        assert.equal(await image.evaluate(node => {
          const canvas = document.createElement('canvas');
          canvas.width = node.naturalWidth;
          canvas.height = node.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(node, 0, 0);
          const { data } = ctx.getImageData(675, 696, 285, 47);
          return data.some((value, index) => index % 4 === 0 && value > 200);
        }), true, 'the downloadable artwork shows the identity value in its own column');
        const walletButton = page.locator('[data-confirmation-wallet]');
        assert.equal(await walletButton.isVisible(), walletAvailable);
        if (walletAvailable) {
          await page.locator('[data-confirmation-wallet-badge]').waitFor();
          assert.equal(await page.locator('[data-confirmation-wallet-badge]').getAttribute('src'), '/wallet/add-to-apple-wallet-cn.svg');
          assert.equal(await walletButton.getAttribute('aria-label'), '加入 Apple Wallet');
          assert.equal(await walletButton.evaluate(button => button.getBoundingClientRect().bottom <= innerHeight), true);
        }
        if (device === 'safari') {
          assert.equal(await walletButton.getAttribute('data-wallet-action'), 'add');
          const walletDownload = page.waitForEvent('download');
          await walletButton.click();
          const pass = await walletDownload;
          assert.equal(pass.suggestedFilename(), 'artdico-host.pkpass');
          const files = passFiles(await readFile(await pass.path()));
          const walletPass = JSON.parse(files.get('pass.json'));
          assert.deepEqual(walletPass.preferredStyleSchemes, ['posterEventTicket', 'eventTicket']);
          assert.equal(files.has('logo.png'), false);
          assert.equal(files.has('artwork@2x.png'), true);
          assert.equal(walletPass.eventTicket.additionalInfoFields.find(field => field.key === 'poster-ggj-community').value, 'GGJ 合成站 · 站点组织者');
          assert.equal(walletPass.semantics.admissionLevel, '嘉宾');
          assert.equal(walletPass.eventTicket.primaryFields[0].value, '合成纪念卡申请人');
          assert.deepEqual(walletPass.eventTicket.auxiliaryFields.map(field => field.key), ['date', 'time', 'venue-short', 'ggj-community-short']);
          assert.equal(walletPass.eventTicket.backFields.find(field => field.key === 'ggj-community').value, 'GGJ 合成站 · 站点组织者');
        } else if (device === 'chrome') {
          assert.equal(await walletButton.getAttribute('data-wallet-action'), 'guide');
          assert.equal(await page.locator('[data-confirmation-safari-guide]').isVisible(), false);
          await walletButton.click();
          await page.locator('[data-confirmation-safari-guide]').waitFor();
          assert.equal(await walletButton.getAttribute('aria-expanded'), 'true');
          assert.equal(await image.isVisible(), true);
          await page.locator('[data-confirmation-safari-close]').click();
          assert.equal(await walletButton.getAttribute('aria-expanded'), 'false');
        }
        await page.screenshot({ path: resolve(output, 'recipient-jpeg-' + width + '-' + device + '.png'), fullPage: true });
        const pending = page.waitForEvent('download');
        await downloadButton.click();
        const download = await pending;
        assert.equal(download.suggestedFilename(), 'artdico-host-card.jpg');
        const jpeg = await readFile(await download.path());
        assert.deepEqual([...jpeg.subarray(0, 3)], [0xff, 0xd8, 0xff]);
        assert.deepEqual([...jpeg.subarray(-2)], [0xff, 0xd9]);
        assert.equal(privateReads - readsBefore, device === 'chrome' ? 2 : 1, 'the legacy response is upgraded with one canonical read');
        await writeFile(resolve(output, 'sample-commemorative-card.jpg'), jpeg);
      }
      assert.deepEqual(errors, []);
      reports.push({ width, outcome, device, oneMailPerClick: true, explicitResend: true, selectedAfterReload: true,
        inlineError: width === 320, directJpeg: outcome === 'accepted', wallet: walletAvailable });
    } finally { await context.close(); }
  }
} finally { signing.cleanup(); await browser.close(); }

const sha256 = async path => createHash('sha256').update(await readFile(resolve(dist, path))).digest('hex');
const result = { reports, adminHtmlSha256: await sha256('admin/cards/index.html'), confirmationHtmlSha256: await sha256('registration/confirmation/index.html') };
await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
