// Compiled homepage, fully intercepted public fixtures. No live records or mail.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createInitialContent } from '../../src/config/content.mjs';
import { toPublicContent } from '../../shared/content-schema.mjs';
import { peopleRuntimeFixture } from '../helpers/people-runtime-fixture.mjs';

const { chromium } = await import(process.env.ARTDICO_PLAYWRIGHT_MODULE || 'playwright-core');
const project = fileURLToPath(new URL('../../', import.meta.url));
const dist = resolve(process.env.ARTDICO_DIST_DIRECTORY || resolve(project, 'dist'));
const evidence = resolve(process.env.ARTDICO_HOME_EVIDENCE_DIRECTORY || resolve(project, '.local-data/browser-evidence/p5-homepage'));
const SITE = 'https://artdico.host', API = 'https://api.artdico.host';
const errors = [], reports = [], assets = new Map(), digest = value => createHash('sha256').update(value).digest('hex');
const content = toPublicContent(createInitialContent()); content.showcases = []; content.organizations = [];
const mime = file => ({ html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', png: 'image/png', webp: 'image/webp',
  avif: 'image/avif', jpg: 'image/jpeg', svg: 'image/svg+xml', woff2: 'font/woff2' })[extname(file).slice(1)] || 'application/octet-stream';
const browser = await chromium.launch({ executablePath: process.env.ARTDICO_CHROMIUM_BINARY || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'] });
await mkdir(evidence, { recursive: true });

async function fixture({ width, javaScriptEnabled = true, reducedMotion = 'no-preference', missingDecorations = false, longDescription = false }) {
  const runtime = await peopleRuntimeFixture({ capacity: 300 }), requests = [];
  const published = structuredClone(content);
  if (longDescription) published.event.presentation.heroDescription = '合成介绍：与不同城市的游戏创作者交流经验，认识新的创作伙伴。'.repeat(5);
  const context = await browser.newContext({ viewport: { width, height: 900 }, javaScriptEnabled, reducedMotion });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    assert.ok([SITE, API].includes(url.origin), 'all resources must be served from the intercepted fixture origins');
    requests.push({ path: url.pathname, method: req.method(), origin: url.origin });
    assert.ok(['GET', 'HEAD', 'OPTIONS'].includes(req.method()), 'homepage viewing must not submit applications or mail');
    if (url.origin === API) {
      assert.equal(req.headers().cookie, undefined);
      if (url.pathname === '/api/public/content') return route.fulfill({ status: 200, contentType: 'application/json',
        headers: { 'access-control-allow-origin': SITE }, body: JSON.stringify({ revision: 1, publishedAt: '2026-11-01T00:00:00Z', content: published }) });
      const response = await runtime.app.handle(new Request(req.url(), { method: req.method(), headers: await req.allHeaders() }));
      return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    }
    const path = url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname;
    const file = resolve(dist, '.' + path); assert.ok(file.startsWith(dist + '/'));
    if (missingDecorations && /planet|home.*\.woff2$/iu.test(path)) return route.fulfill({ status: 404, body: '' });
    const data = await readFile(file); assets.set(path, { path, bytes: data.length, sha256: digest(data) });
    return route.fulfill({ status: 200, contentType: mime(file), body: data });
  });
  const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  if (javaScriptEnabled) await page.clock.setFixedTime(new Date('2026-11-01T00:00:00Z'));
  await page.goto(SITE + '/', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  return { context, page, runtime, requests };
}

async function inspect(f, label) {
  const { page } = f;
  assert.equal(await page.locator('#artdico-host.ah-cosmos').count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, label + ': horizontal overflow');
  assert.equal(await page.locator('h1').count(), 1); assert.equal(await page.locator('h1').isVisible(), true);
  assert.equal(await page.locator('h1').getAttribute('aria-label'),content.event.title,'the canonical event title remains HTML and accessible independently of the reference artwork');
  const titleArtwork=page.locator('#hero-heading [data-home-title-image]');
  assert.equal(await titleArtwork.count(),2,'the two title graphics come from the supplied reference components');
  for(const artwork of await titleArtwork.all()){
    assert.equal(await artwork.isVisible(),true);
    assert.equal(await artwork.evaluate(image=>image.complete&&image.naturalWidth>0),true,'the original title artwork loaded');
    const box=await artwork.boundingBox();assert.ok(box&&box.width>0&&box.x>=-1&&box.x+box.width<=page.viewportSize().width+1,'reference title artwork stays within the viewport');
  }
  const clipped = await page.locator('h1').evaluate(node => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT), failures = [];
    while (walker.nextNode()) {
      const text = walker.currentNode; if (!text.textContent.trim()) continue;
      const parent = text.parentElement; if (!parent || getComputedStyle(parent).display === 'none' || parent.closest('[aria-hidden="true"]')) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      for (const box of range.getClientRects()) if (box.width && (box.left < -1 || box.right > innerWidth + 1)) failures.push(text.textContent);
    }
    return failures;
  });
  assert.deepEqual(clipped, [], label + ': meaningful title must remain readable');
  const visible = await page.locator('body').innerText();
  assert.doesNotMatch(visible, /20\+|10K\+|600\s*(?:㎡|m²)/iu);
  for (const control of await page.locator('a,button,summary').all()) assert.doesNotMatch(await control.textContent(), /申请展位|展位申请|送作品申请|我有作品想展示/u);
  assert.match(await page.locator('meta[name=robots]').getAttribute('content'), /noindex/u);
  assert.match(await page.locator('html').textContent(), /SIL OPEN FONT LICENSE/iu);
  const description = await page.locator('meta[name=description]').getAttribute('content'); assert.ok(description?.trim());
  assert.equal(f.runtime.messages.length, 0);
  const share = new URL(await page.locator('meta[property="og:image"]').getAttribute('content'));
  assert.equal(share.origin, SITE); assert.match(share.pathname, /^\/_astro\/[A-Za-z0-9_.-]+\.png$/u);
  const localShare = new URL(await page.locator('link[rel=image_src]').getAttribute('href'), SITE); assert.equal(localShare.href, share.href);
  const bytes = await readFile(resolve(dist, '.' + share.pathname));
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [1200, 630]);
  const background = await page.locator('#artdico-host').evaluate(node => getComputedStyle(node).backgroundColor);
  assert.equal(background, 'rgb(0, 0, 0)');
  const primary = page.locator('#top [data-home-primary-apply]');
  assert.equal(await primary.getAttribute('href'), '#registration');
  assert.match(await primary.innerText(), label === 'no-javascript' ? /查看申请说明/u : /申请参加/u);
  assert.equal(await page.locator('#top [data-home-agenda-primary]').getAttribute('href'), '#agenda');
  assert.equal(await page.locator('#top .ah-hero-actions .ah-primary[data-home-agenda-primary]').count(),1,'the reference primary action opens the timetable while the application remains explicit');
  assert.equal(await page.locator('#recruitment .ah-primary').count(), 0, 'recruitment links do not compete with the main application action');
  const primaryBox = await primary.evaluate(node => { const box = node.getBoundingClientRect(); return { height: box.height, top: box.top + scrollY, bottom: box.bottom + scrollY }; });
  assert.ok(primaryBox.height >= 44);
  const actionLayout=await page.evaluate(()=>{
    const bounds=selector=>{const box=document.querySelector(selector).getBoundingClientRect();return {top:box.top+scrollY,bottom:box.bottom+scrollY};};
    return {facts:bounds('#top .ah-event-meta'),hero:bounds('#top'),agenda:bounds('[data-home-agenda-primary]')};
  });
  assert.ok(primaryBox.top>=actionLayout.facts.bottom-1&&primaryBox.bottom<=actionLayout.hero.bottom+1,'the application action remains after the facts and within the hero');
  const referenceAgendaTop=1306*page.viewportSize().width/1921;
  if(page.viewportSize().width>=1024)assert.ok(Math.abs(actionLayout.agenda.top-referenceAgendaTop)<=Math.max(60,100*page.viewportSize().width/1921),'desktop timetable action follows the original PNG y=1306 proportion, allowing confirmed event text and font metrics');
  await primary.focus();assert.equal(await primary.evaluate(node=>document.activeElement===node),true,'the application remains keyboard reachable');
  await page.evaluate(()=>scrollTo(0,0));
  const venueSize = await page.locator('[data-public-hero-venue]').evaluate(node => parseFloat(getComputedStyle(node).fontSize));
  const dateSize = await page.locator('[data-public-date-value]').evaluate(node => parseFloat(getComputedStyle(node).fontSize));
  assert.ok(venueSize >= 15 && dateSize >= 15, 'event facts remain readable beside the decorative title');
  if (page.viewportSize().width <= 600) {
    const layout = await page.evaluate(() => ({ descriptionBottom: document.querySelector('.ah-hero-description').getBoundingClientRect().bottom,
      factsTop: document.querySelector('#top .ah-event-meta').getBoundingClientRect().top }));
    assert.ok(layout.descriptionBottom <= layout.factsTop, 'published introductory copy cannot overlap event facts');
  }
  return { label, width: page.viewportSize().width, shareSha256: digest(bytes), readOnlyRequests: f.requests.length, noOverflow: true, noClippedHeadline: true,
    applicationActionInHero: true, applicationKeyboardReachable: true, actionPositions:{applicationTop:primaryBox.top,agendaTop:actionLayout.agenda.top,referenceAgendaTop:page.viewportSize().width>=1024?referenceAgendaTop:null},eventFactFontPixels: { venue: venueSize, date: dateSize } };
}

try {
  for (const width of [320, 390, 1440]) {
    const f = await fixture({ width });
    await f.page.locator('footer').scrollIntoViewIfNeeded();
    assert.ok(await f.page.locator('footer img').count());
    await f.page.waitForFunction(() => [...document.querySelectorAll('footer img')].every(image => image.complete && image.naturalWidth > 0));
    await f.page.locator('footer').screenshot({ path: resolve(evidence, 'footer-' + width + '.png'), animations: 'disabled' });
    await f.page.evaluate(() => scrollTo(0, 0));
    await f.page.screenshot({ path: resolve(evidence, 'homepage-' + width + '.png'), fullPage: true, animations: 'disabled' });
    await f.page.screenshot({ path: resolve(evidence, 'hero-' + width + '.png'), fullPage: false, animations: 'disabled' });
    reports.push(await inspect(f, 'standard-' + width)); await f.context.close();
  }
  for (const options of [{ width: 390, javaScriptEnabled: false }, { width: 390, reducedMotion: 'reduce' }, { width: 390, missingDecorations: true }, { width: 390, longDescription: true }]) {
    const f = await fixture(options), label = options.javaScriptEnabled === false ? 'no-javascript' : options.reducedMotion === 'reduce' ? 'reduced-motion' : options.longDescription ? 'long-description' : 'missing-decorations';
    reports.push(await inspect(f, label));
    if (options.javaScriptEnabled === false) {
      assert.equal(f.requests.filter(row => row.origin === API).length, 0);
      assert.equal(await f.page.locator('[data-registration-form] [data-submit]').isDisabled(), true);
      assert.doesNotMatch(await f.page.locator('[data-registration-availability]').textContent(), /报名已开放/u);
    }
    if (options.reducedMotion === 'reduce') assert.equal(await f.page.evaluate(() => document.getAnimations().some(animation =>
      animation.playState === 'running' && animation.effect.getComputedTiming().iterations === Infinity)), false);
    await f.page.screenshot({ path: resolve(evidence, label + '.png'), fullPage: false }); await f.context.close();
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
const report = { reports, pageErrors: errors, syntheticOnly: true, realMail: false, businessWrites: 0,
  htmlSha256: digest(await readFile(resolve(dist, 'index.html'))), assets: [...assets.values()].sort((a, b) => a.path.localeCompare(b.path)) };
await writeFile(resolve(evidence, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
