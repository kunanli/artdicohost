import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createAppleWalletApi } from '../../functions/apple-wallet/handler.mjs';
import { createAppleWalletService } from '../../functions/apple-wallet/service.mjs';
import { createWalletFixture, passFiles } from '../apple-wallet-fixture.mjs';
import { peopleRuntimeFixture, PEOPLE_FIXTURE_API as API, PEOPLE_FIXTURE_PUBLIC as SITE, PEOPLE_FIXTURE_PASSWORD } from '../helpers/people-runtime-fixture.mjs';
import { PUBLIC_EVENT_DETAILS_URL, PUBLIC_REGISTRATION_URL } from '../../src/config/event.mjs';
import { toPublicContent } from '../../shared/content-schema.mjs';

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
    const phone = '+86 010 0000 0000', organization = '合成院校';
    let publicDetails = null;
    let privateReads = 0, staleIdentity = width === 320;
    try {
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        try {
          assert.ok([SITE, API].includes(url.origin));
          if (url.origin === API && url.pathname.startsWith('/api/')) {
            const method = request.method();
            if (publicDetails && url.pathname === '/api/public/content') {
              assert.equal(method, 'GET');
              const headers = await request.allHeaders();
              assert.equal(headers.cookie, undefined);
              assert.equal(headers.authorization, undefined);
              return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': SITE }, json: publicDetails });
            }
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
        await application.getByText('电话与学校／机构（选填）', { exact: true }).click();
        await application.locator('[name="wallet.phone"]').fill(phone);
        await application.locator('[name="wallet.organization"]').fill(organization);
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
        assert.match(await page.locator('[data-card-community-summary]').innerText(), /待保存/u);
        await page.locator('[data-card-community-summary]').click();
        assert.match(await page.locator('[data-card-requested-community]').innerText(), /GGJ 合成站 · 站点组织者/u);
        assert.equal(await page.getByLabel('GGJ 站点').inputValue(), 'GGJ 合成站');
        assert.equal(await page.getByLabel('社群角色').inputValue(), '站点组织者');
        assert.equal(await page.getByLabel('学校／机构／团队').inputValue(), organization);
        assert.equal(await page.getByLabel('纪念卡电话').inputValue(), phone);
        await page.getByRole('button', { name: '保存到纪念卡' }).click();
        await page.getByRole('status').filter({ hasText: '纪念卡资料已保存。' }).waitFor();
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
        assert.equal(await page.locator('[data-card-list] [data-stage="check_delivery"]').count(), 1);
        assert.equal(await page.locator('[data-card-list] [data-stage="check_delivery"] small').count(), 0);
        assert.equal(await page.locator('[data-card-state]').textContent(), '未收到邮件服务回执，重寄可能重复。');
        assert.equal(await page.locator('[data-card-delivery-formats]').isVisible(), false);
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
        const link = /https:\/\/artdico\.host\/registration\/confirmation\/#r=[A-Za-z0-9_.-]+/u.exec(cardMessages()[0].template_params.confirmation_actions)[0];
        const readsBefore = privateReads;
        await page.goto(link);
        const downloadButton = page.getByRole('link', { name: '下载 JPEG 纪念卡' });
        await downloadButton.waitFor();
        assert.equal(await downloadButton.evaluate(button => button.getBoundingClientRect().bottom <= innerHeight), true);
        const image = page.locator('[data-confirmation-jpeg-image]');
        await page.waitForFunction(node => node.complete && node.naturalWidth === 1030 && node.naturalHeight === 1510, await image.elementHandle());
        assert.match(await image.getAttribute('alt'), /卡面身份：嘉宾/u);
        assert.match(await page.locator('[data-confirmation-intro]').textContent(), /长期收藏.*活动行原电子票/u);
        const guide = page.getByRole('navigation', { name: '活动指南' });
        assert.equal(await guide.getByRole('link', { name: '活动详情' }).getAttribute('href'), PUBLIC_EVENT_DETAILS_URL);
        const venue = '深圳市前海合作区梦海大道5188号前海5号楼';
        assert.equal(await guide.locator('[data-confirmation-map-address]').innerText(), venue);
        const guideMap = new URL(await guide.getByRole('link', { name: 'Apple 地图导航' }).getAttribute('href'));
        assert.equal(guideMap.origin, 'https://maps.apple.com');
        assert.deepEqual([...guideMap.searchParams], [['destination', venue]]);
        assert.equal(await guide.getByRole('link', { name: '讲座与活动日程' }).getAttribute('href'), SITE + '/#agenda');
        assert.equal(await guide.getByRole('link', { name: '活动行活动页' }).getAttribute('href'), PUBLIC_REGISTRATION_URL);
        assert.equal(await guide.getByRole('link', { name: '参展游戏与作品' }).getAttribute('href'), SITE + '/#students');
        if (device === 'safari') {
          assert.equal(await page.locator('[data-confirmation-community]').innerText(), 'GGJ 合成站 · 站点组织者');
          await page.getByText('纪念卡个人资料', { exact: true }).click();
          assert.equal(await page.locator('[data-confirmation-card-organization] dd').innerText(), organization);
          assert.equal(await page.locator('[data-confirmation-card-phone] dd').innerText(), phone);
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
        assert.equal(await image.evaluate(node => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          ctx.drawImage(node, 334, 1092, 1, 1, 0, 0, 1, 1);
          return Array.from(ctx.getImageData(0, 0, 1, 1).data.subarray(0, 3)).every(channel => channel < 40);
        }), true, 'the old QR position on the JPEG is clear');
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
          await page.getByRole('status').filter({ hasText: '进入票券详情' }).waitFor();
          const files = passFiles(await readFile(await pass.path()));
          const walletPass = JSON.parse(files.get('pass.json'));
          assert.deepEqual(walletPass.posterGeneric.primaryFields.map(({ value }) => value),
            ['合成纪念卡申请人', '嘉宾', 'GGJ 合成站 · 站点组织者', organization]);
          assert.equal(walletPass.posterGeneric.footerFields[0].value, '2026-12-05 · 10:00–18:00 · 前海5号楼');
          assert.equal(walletPass.posterGeneric.backFields.find(({ key }) => key === 'poster-details-venue').value, venue);
          assert.equal(walletPass.posterGeneric.backFields.find(({ key }) => key === 'poster-details-phone').value, phone);
          assert.equal(walletPass.posterGeneric.backFields.find(({ key }) => key === 'poster-details-event-details').value, PUBLIC_EVENT_DETAILS_URL);
          assert.ok(['logo.png', 'logo@2x.png', 'logo@3x.png'].every(name => files.has(name)));
          assert.equal(files.has('strip@2x.png'), true);
          assert.equal(files.has('background.png'), false);
          for (const name of ['artwork@2x.png', 'artwork@3x.png', 'primaryLogo@2x.png', 'primaryLogo@3x.png']) assert.ok(files.has(name));
          assert.equal(walletPass.logoText, undefined);
          assert.equal(walletPass.eventTicket.backFields.find(field => field.key === 'co-brand-title').value,
            'GGJ China Meetup 2026 x ARTDiCO HOST');
          assert.equal(walletPass.barcodes, undefined);
          assert.equal(walletPass.expirationDate, undefined);
          assert.equal(walletPass.eventTicket.primaryFields, undefined);
          assert.deepEqual(walletPass.eventTicket.secondaryFields.map(field => field.value), ['合成纪念卡申请人', '嘉宾']);
          assert.deepEqual(walletPass.eventTicket.headerFields.map(({ value }) => value), ['前海5号楼']);
          assert.deepEqual(walletPass.eventTicket.auxiliaryFields.map(field => field.key), ['date', 'time', 'activities', 'ggj-site-short', 'ggj-role-short', 'organization-short']);
          assert.deepEqual(walletPass.eventTicket.auxiliaryFields.slice(3), [
            { key: 'ggj-site-short', label: 'GGJ 站点', value: 'GGJ 合成站', row: 1 },
            { key: 'ggj-role-short', label: '社群角色', value: '站点组织者', row: 1 },
            { key: 'organization-short', label: '学校／机构', value: organization, row: 1 },
          ]);
          assert.deepEqual(walletPass.eventTicket.backFields.slice(1, 8).map(({ key, value }) => [key, value]), [
            ['venue', venue], ['directions', guideMap.href], ['agenda', SITE + '/#agenda'], ['showcase', SITE + '/#students'],
            ['huodongxing', PUBLIC_REGISTRATION_URL], ['ggj-site', 'GGJ 合成站'], ['ggj-role', '站点组织者'],
          ]);
          assert.equal(walletPass.eventTicket.backFields.find(field => field.key === 'phone').value, phone);
          assert.deepEqual(walletPass.featuredActions, [{ identifier: 'event-details', type: 'viewSchedule', url: PUBLIC_EVENT_DETAILS_URL }]);
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
      if (device === 'safari' || width === 1440) {
        const content = (await fixture.app.store.read()).draft.content;
        content.sessions = [{ id: 'synthetic-talk', start: '10:00', end: '10:30', zone: 'A', title: '合成已公布讲座',
          guestId: '', speakerName: '合成已确认讲者', speakerStatus: 'confirmed', status: 'scheduled', format: 'talk', internalNotes: 'SYNTHETIC_PRIVATE' }];
        content.guests = [];
        content.booths = [];
        content.showcases = [{ id: 'synthetic-work', title: '合成已公布游戏', teamName: '合成队伍', summary: '已公布的作品说明',
          school: '', contactName: '', email: '', wechat: '', memberCount: 2, participationForms: ['share'], responseStatus: 'attending',
          materialLinks: '', coverId: '', status: 'confirmed', publicConsent: true, sessionId: 'synthetic-talk', boothId: '', internalNotes: 'SYNTHETIC_PRIVATE' }];
        publicDetails = { revision: 1, publishedAt: '2026-10-21T09:00:00.000Z', content: toPublicContent(content) };
        await page.goto(PUBLIC_EVENT_DETAILS_URL);
        await page.getByText('合成已公布讲座', { exact: true }).waitFor();
        await page.getByRole('heading', { name: '合成已公布游戏' }).waitFor();
        assert.ok(await page.getByText('合成已确认讲者', { exact: true }).isVisible());
        assert.equal(await page.getByText(phone, { exact: true }).count(), 0);
        assert.equal(await page.getByText('SYNTHETIC_PRIVATE', { exact: true }).count(), 0);
        assert.ok(new URL(await page.getByRole('link', { name: 'Apple 地图导航' }).getAttribute('href')).searchParams.get('destination').includes('前海5号楼'));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        await page.screenshot({ path: resolve(output, 'event-details-' + width + '.png'), fullPage: true });
        if (width === 1440) {
          publicDetails = { ...publicDetails, revision: 2, content: toPublicContent({ ...content, event: { ...content.event, status: 'cancelled' } }) };
          await page.reload();
          await page.getByRole('status').filter({ hasText: '本次活动已取消。' }).waitFor();
          assert.equal(await page.getByRole('link', { name: 'Apple 地图导航' }).isVisible(), false);
          assert.equal(await page.getByRole('link', { name: '活动行活动页' }).isVisible(), false);
        }
      }
      if (width === 320 || width === 1440) {
        await page.goto(API + '/admin/cards/');
        const add = page.getByRole('button', { name: '新增测试卡' });
        await add.click();
        const create = page.locator('[data-card-create]');
        await create.getByLabel('卡面姓名').fill('合成后台测试卡');
        await create.getByLabel('收件邮箱').fill('synthetic.staff.test@example.invalid');
        await create.getByLabel('卡面身份').selectOption('guest');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        await create.getByRole('button', { name: '保存测试卡' }).click();
        await page.getByRole('status').filter({ hasText: '测试卡已保存，可以发送测试邮件。' }).waitFor();
        assert.equal(await page.locator('[data-card-name]').innerText(), '合成后台测试卡');
        assert.equal(await page.locator('[data-card-reference]').innerText(), '测试卡');
        assert.equal(cardMessages().length, 2);
        await page.getByRole('button', { name: '发送纪念卡', exact: true }).click();
        await resend.waitFor();
        assert.equal(cardMessages().length, 3);
        await resend.click();
        await page.getByRole('status').filter({ hasText: '已重新提交纪念卡邮件。' }).waitFor();
        assert.equal(cardMessages().length, 4);
        const remove = page.getByRole('button', { name: '移除测试卡' });
        page.once('dialog', dialog => dialog.dismiss());
        await remove.click();
        await remove.waitFor();
        page.once('dialog', dialog => dialog.accept());
        await remove.click();
        await page.getByRole('status').filter({ hasText: '纪念卡已移除。' }).waitFor();
        assert.equal(await page.locator('[data-card-details]').isVisible(), false);
        assert.equal(await page.getByRole('button', { name: /合成后台测试卡/u }).count(), 0);
        assert.equal(await page.getByRole('button', { name: /合成纪念卡申请人/u }).count(), 1);
      }
      assert.deepEqual(errors, []);
      reports.push({ width, outcome, device, oneMailPerClick: true, explicitResend: true, selectedAfterReload: true,
        inlineError: width === 320, directJpeg: outcome === 'accepted', wallet: walletAvailable, testCardManagement: width === 320 || width === 1440,
        publicEventDetails: device === 'safari' || width === 1440, savedCardProfile: device === 'safari' });
    } finally { await context.close(); }
  }
} finally { signing.cleanup(); await browser.close(); }

const sha256 = async path => createHash('sha256').update(await readFile(resolve(dist, path))).digest('hex');
const result = { reports, adminHtmlSha256: await sha256('admin/cards/index.html'), confirmationHtmlSha256: await sha256('registration/confirmation/index.html'),
  eventDetailsHtmlSha256: await sha256('event/index.html') };
await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
