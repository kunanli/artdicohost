import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PUBLIC_REGISTRATION_URL } from '../../src/config/event.mjs';

const { chromium } = await import(process.env.ARTDICO_PLAYWRIGHT_MODULE ?? 'playwright-core');
const dist = resolve(process.env.ARTDICO_DIST_DIRECTORY ?? 'dist');
const evidence = resolve(process.env.ARTDICO_ENTRY_EVIDENCE_DIRECTORY ?? '.local-data/browser-evidence/entry-checkin');
const pages = [
  { origin: 'https://artdico.host', path: '/r/', heading: '活动行报名与签到', back: '/#wallet-card-application' },
  { origin: 'https://api.artdico.host', path: '/admin/checkin/', heading: '现场签到已移至活动行', back: '/admin/contacts/' },
];
const browser = await chromium.launch({ executablePath: process.env.ARTDICO_CHROMIUM_BINARY, args: ['--no-sandbox'] });
const cases = [];
await mkdir(evidence, { recursive: true });

try {
  for (const { origin, path, heading, back } of pages) {
    const html = await readFile(resolve(dist, '.' + path, 'index.html'));
    for (const width of [320, 390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const unexpected = [], errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (request.method() === 'GET' && url.origin === origin) {
          if (url.pathname === path) return route.fulfill({ body: html, contentType: 'text/html' });
          if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204 });
          if (/^\/_astro\/[a-zA-Z0-9_.-]+\.css$/u.test(url.pathname)) {
            return route.fulfill({ body: await readFile(resolve(dist, '.' + url.pathname)), contentType: 'text/css' });
          }
          if (url.pathname.startsWith('/fonts/')) {
            return route.fulfill({ status: 204 });
          }
        }
        unexpected.push([request.method(), url.origin, url.pathname]);
        return route.abort();
      });
      try {
        await page.goto(origin + path + '?obsolete=synthetic#ticket=' + 'A'.repeat(22), { waitUntil: 'networkidle' });
        assert.equal(page.url(), origin + path);
        assert.equal(await page.getByRole('heading', { name: heading, exact: true }).count(), 1);
        assert.equal(await page.getByRole('link', { name: '前往活动行活动页' }).getAttribute('href'), PUBLIC_REGISTRATION_URL);
        assert.equal(await page.getByRole('link', { name: '前往活动行活动页' }).getAttribute('rel'), 'noreferrer');
        assert.equal(await page.locator('main a[href="' + back + '"]').count(), 1);
        assert.equal(await page.locator('form, [data-entry-app], [data-entry-link-api]').count(), 0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1
          && localStorage.length === 0 && sessionStorage.length === 0), true);
        assert.deepEqual(unexpected, []);
        assert.deepEqual(errors, []);
        await page.screenshot({ path: resolve(evidence, (path === '/r/' ? 'public' : 'staff') + '-' + width + '.png') });
        cases.push({ path, width, htmlSha256: createHash('sha256').update(html).digest('hex') });
      } finally {
        await page.close();
      }
    }
  }
  const report = { ok: true, cases, sourceCommit: process.env.GITHUB_SHA ?? null, legacyRequests: 0, syntheticOnly: true };
  await writeFile(resolve(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('Activity registration and check-in notices verified at three widths.');
} finally {
  await browser.close();
}
