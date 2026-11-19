import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { peopleRuntimeFixture, PEOPLE_FIXTURE_API as API, PEOPLE_FIXTURE_PUBLIC as SITE, PEOPLE_FIXTURE_PASSWORD } from '../helpers/people-runtime-fixture.mjs';

const dist = resolve(process.env.ARTDICO_DIST_DIRECTORY ?? 'dist');
const output = resolve(process.env.ARTDICO_EVIDENCE_DIRECTORY ?? '.local-data/browser-evidence/commemorative-cards');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
const browser = await chromium.launch({ executablePath: process.env.ARTDICO_CHROMIUM_BINARY || '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const reports = [];
await mkdir(output, { recursive: true });

try {
  for (const [width, outcome] of [[320, 'accepted'], [390, 'accepted'], [1440, 'unknown']]) {
    const isCard = message => /电子纪念卡/u.test(message.template_params.email_subject);
    const fixture = await peopleRuntimeFixture({ mail: true, mailResult: message => isCard(message) ? outcome : 'accepted' });
    const context = await browser.newContext({ viewport: { width, height: 840 }, locale: 'zh-CN' });
    const errors = [];
    let privateReads = 0, staleIdentity = width === 320;
    try {
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        try {
          assert.ok([SITE, API].includes(url.origin));
          if (url.origin === API && url.pathname.startsWith('/api/')) {
            const method = request.method();
            if (method === 'POST' && url.pathname === '/api/admin/registration/confirmation') privateReads++;
            if (staleIdentity && method === 'PATCH' && url.pathname.startsWith('/api/admin/registration-confirmation/cards/')) {
              staleIdentity = false;
              return route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":{"message":"资料已更新，请核对后再保存。"}}' });
            }
            const response = await fixture.app.handle(new Request(url.href, { method, headers: await request.allHeaders(),
              ...(['GET', 'HEAD'].includes(method) ? {} : { body: request.postData() }) }));
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
      await page.locator('#card-format').selectOption('jpeg');
      assert.equal(await page.locator('#card-format option[value=wallet]').isDisabled(), true);
      assert.equal(await page.locator('[data-card-identity-value] span').innerText(), '嘉宾');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      assert.equal(cardMessages().length, 0);
      await page.screenshot({ path: resolve(output, 'staff-' + width + '.png'), fullPage: true });
      await page.locator('[data-card-delivery] button').click();

      if (outcome === 'unknown') {
        await page.locator('[data-card-check]').waitFor();
        assert.equal(await page.locator('[data-card-delivery]').isVisible(), false);
        await page.locator('[data-card-search]').fill('');
        assert.equal(await page.locator('[data-card-list] small').first().textContent(), '核对寄送结果');
        await page.locator('[data-card-check]').click();
        await page.getByRole('status').filter({ hasText: '已重新核对，寄送结果仍待确认。' }).waitFor();
        await page.locator('[data-card-check]:enabled').waitFor();
        assert.equal(cardMessages().length, 1);
      } else {
        await page.waitForFunction(() => document.querySelector('[data-card-state]').textContent === 'JPEG 邮件已提交发送');
        assert.equal(cardMessages().length, 1);
        assert.equal(await page.locator('[data-card-name]').textContent(), '合成纪念卡申请人');
        assert.equal(await page.locator('[data-card-filter="todo"] span').textContent(), '1');
        assert.equal(await page.locator('[data-card-filter="submitted"] span').textContent(), '1');
        await page.locator('[data-card-filter="submitted"]').click();
        assert.equal(await page.locator('[data-card-list] small').textContent(), 'JPEG 已提交');
        const link = /https:\/\/artdico\.host\/registration\/confirmation\/#r=[A-Za-z0-9_.-]+/u.exec(cardMessages()[0].template_params.invitation_text)[0];
        const readsBefore = privateReads;
        await page.goto(link);
        const downloadButton = page.getByRole('link', { name: '下载 JPEG 纪念卡' });
        await downloadButton.waitFor();
        assert.equal(await downloadButton.evaluate(button => button.getBoundingClientRect().bottom <= innerHeight), true);
        const image = page.locator('[data-confirmation-jpeg-image]');
        await page.waitForFunction(node => node.complete && node.naturalWidth === 1030 && node.naturalHeight === 1510, await image.elementHandle());
        assert.equal(await page.locator('[data-confirmation-wallet]').isVisible(), false);
        await page.screenshot({ path: resolve(output, 'recipient-jpeg-' + width + '.png'), fullPage: true });
        const pending = page.waitForEvent('download');
        await downloadButton.click();
        const download = await pending;
        assert.equal(download.suggestedFilename(), 'artdico-host-card.jpg');
        const jpeg = await readFile(await download.path());
        assert.deepEqual([...jpeg.subarray(0, 3)], [0xff, 0xd8, 0xff]);
        assert.deepEqual([...jpeg.subarray(-2)], [0xff, 0xd9]);
        assert.equal(privateReads - readsBefore, 1, 'the first private read makes the JPEG ready to download');
        await writeFile(resolve(output, 'sample-commemorative-card.jpg'), jpeg);
      }
      assert.deepEqual(errors, []);
      reports.push({ width, outcome, mailedOnce: true, selectedAfterReload: true, inlineError: width === 320, directJpeg: outcome === 'accepted' });
    } finally { await context.close(); }
  }
} finally { await browser.close(); }

const sha256 = async path => createHash('sha256').update(await readFile(resolve(dist, path))).digest('hex');
const result = { reports, adminHtmlSha256: await sha256('admin/cards/index.html'), confirmationHtmlSha256: await sha256('registration/confirmation/index.html') };
await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
