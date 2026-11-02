// Compiled homepage only. All requests and public records are synthetic; this
// browser never contacts the live site or submits an application.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const project = fileURLToPath(new URL('../../', import.meta.url));
const source = resolve(process.env.ARTDICO_SOURCE_DIRECTORY || project);
const dist = resolve(process.env.ARTDICO_DIST_DIRECTORY || resolve(source, 'dist'));
const evidence = resolve(process.env.ARTDICO_SCROLL_EVIDENCE_DIRECTORY || resolve(project, '.local-data/browser-evidence/home-scroll-motion'));
const SITE = 'https://artdico.host', API = 'https://api.artdico.host', expectedCases = 6;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let browser = null, activePage = null, stage = 'preflight', width = null, numericMetrics = null;

async function main() {
  const { createInitialContent } = await import(pathToFileURL(resolve(source, 'src/config/content.mjs')));
  const { toPublicContent, validateContent } = await import(pathToFileURL(resolve(source, 'shared/content-schema.mjs')));
  const { chromium } = await import(process.env.ARTDICO_PLAYWRIGHT_MODULE || 'playwright-core');
  const html = await readFile(resolve(dist, 'index.html')), scriptSha256 = sha(await readFile(fileURLToPath(import.meta.url)));
  assert.equal(html.includes(Buffer.from('scroll-motion-guest')), false, 'the synthetic guest hash is absent from the original static document');
  const raw = createInitialContent();
  raw.guests = [{ id: 'scroll-motion-guest', name: '合成滚动嘉宾', company: '合成创作单位', title: '合成创作者', ggjRole: '', portraitId: '', status: 'pending', publicConsent: false, contactId: 'SYNTHETIC_PRIVATE_CONTACT', internalNotes: 'SYNTHETIC_PRIVATE_NOTE' }];
  raw.organizations = []; raw.showcases = []; raw.booths = [];
  raw.sessions = raw.sessions.slice(0, 1).map(item => ({ ...item, title: '合成滚动定位活动' }));
  assert.equal(validateContent(raw).valid, true, 'the synthetic publication must pass the real schema');
  const publication = toPublicContent(raw), reports = [], pageErrors = [], servedAssets = new Map(), requests = [];
  let failure = null;
  const mime = file => ({ html: 'text/html; charset=utf-8', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', avif: 'image/avif', svg: 'image/svg+xml', woff2: 'font/woff2', ico: 'image/x-icon', txt: 'text/plain' })[extname(file).slice(1)] || 'application/octet-stream';
  await mkdir(evidence, { recursive: true });
  browser = await chromium.launch({ executablePath: process.env.ARTDICO_CHROMIUM_BINARY || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  async function fixture({ viewportWidth, javaScriptEnabled = true, withoutObserver = false }) {
    const context = await browser.newContext({ viewport: { width: viewportWidth, height: 900 }, isMobile: viewportWidth < 600, hasTouch: viewportWidth < 600, reducedMotion: withoutObserver ? 'no-preference' : 'reduce', javaScriptEnabled });
    let revision = 1, publicReads = 0;
    if (javaScriptEnabled) await context.addInitScript(() => {
      // Instrument the real browser callbacks, without replacing animation time
      // or making a continuous render loop appear idle.
      const nativeFrame = requestAnimationFrame.bind(window), nativeCancel = cancelAnimationFrame.bind(window), pending = new Set();
      window.requestAnimationFrame = callback => { const id = nativeFrame(time => { pending.delete(id); callback(time); }); pending.add(id); return id; };
      window.cancelAnimationFrame = id => { pending.delete(id); nativeCancel(id); };
      Object.defineProperty(window, '__homeMotionQaPendingFrames', { value: () => pending.size });
    });
    if (withoutObserver) await context.addInitScript(() => Object.defineProperty(window, 'IntersectionObserver', { configurable: true, value: undefined }));
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      assert.ok([SITE, API].includes(url.origin), 'all network stays in the intercepted origins');
      assert.equal(request.method(), 'GET', 'motion and navigation never submit business requests');
      requests.push({ width: viewportWidth, path: url.pathname, method: request.method() });
      if (url.origin === API) {
        assert.equal(request.headers().cookie, undefined); assert.equal(request.headers().authorization, undefined);
        const headers = { 'access-control-allow-origin': SITE };
        if (url.pathname === '/api/public/content') {
          publicReads++;
          await new Promise(done => setTimeout(done, 120));
          return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ revision, publishedAt: '2026-11-01T12:00:00.000Z', content: publication }) });
        }
        assert.equal(url.pathname, '/api/admin/registration/config', 'there is no other API or private-source access');
        return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ enabled: false, reason: 'closed' }) });
      }
      if (url.pathname === '/__scroll-blank/') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Synthetic fresh-document navigation</title>' });
      const path = url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname, file = resolve(dist, '.' + path);
      assert.ok(file.startsWith(dist + '/'));
      try { const bytes = await readFile(file); servedAssets.set(path, sha(bytes)); return route.fulfill({ status: 200, contentType: mime(file), body: bytes }); }
      catch { return route.fulfill({ status: 404, body: '' }); }
    });
    const page = await context.newPage(); activePage = page; page.setDefaultTimeout(12000);
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(SITE + '/', { waitUntil: 'networkidle' }); await page.evaluate(() => document.fonts.ready);
    const scrollState = () => page.evaluate(() => ({ scrollY, agendaTop: document.getElementById('agenda').getBoundingClientRect().top, headerBottom: document.querySelector('.ah-home-header').getBoundingClientRect().bottom, activeTag: document.activeElement?.tagName, activeId: document.activeElement?.id, hash: location.hash }));
    return { context, page, publicReads: () => publicReads, refresh: async () => { revision++; const beforeWait = await scrollState(); await page.waitForTimeout(1100); const beforeDispatch = await scrollState(); const received = page.waitForResponse(response => response.url() === API + '/api/public/content'); await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await received; const afterResponse = await scrollState(); await page.waitForTimeout(100); return { beforeWait, beforeDispatch, afterResponse, afterRender: await scrollState() }; } };
  }
  async function settled(page) { await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))); }
  async function header(page) {
    const value = await page.locator('.ah-home-header').evaluate(node => { const b = node.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, height: b.height, width: innerWidth, scroll: scrollY }; });
    assert.ok(Math.abs(value.top) <= 1, 'the complete header remains pinned at the viewport top');
    assert.ok(value.height >= 44 && value.left >= -1 && value.right <= value.width + 1, 'the pinned header stays usable inside the viewport');
    return value;
  }
  async function noOverflow(page) { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'motion does not create horizontal overflow'); }
  async function progress(page) { return page.locator('[data-scroll-progress]').evaluate(node => { const b = node.getBoundingClientRect(), h = node.closest('header').getBoundingClientRect(); return { width: b.width, max: h.width, hidden: node.getAttribute('aria-hidden') }; }); }
  async function art(page) { return page.locator('.ah-home-program-art').first().evaluate(node => { const b = node.getBoundingClientRect(), s = getComputedStyle(node); return { documentTop: b.top + scrollY, transform: s.transform, translate: s.translate }; }); }
  async function anchor(page, id, { noScript = false, requireCurrent = true } = {}) {
    if (!noScript) await settled(page);
    const geometry = () => page.evaluate(id => { const target = document.getElementById(id), nav = document.querySelector('.ah-home-header'); return { hash: location.hash, top: target.getBoundingClientRect().top, headerBottom: nav.getBoundingClientRect().bottom, scrollY, scrollPadding: getComputedStyle(document.documentElement).scrollPaddingTop, scrollMargin: getComputedStyle(target).scrollMarginTop, scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior, targetHeight: target.getBoundingClientRect().height }; }, id);
    const initial = await geometry(); numericMetrics = { initial };
    // Native hash navigation honors the site's smooth-scroll preference. Wait
    // for its actual landing position and a stable scroll offset, not two RAFs.
    try {
      const deadline = Date.now() + 12000; let lastY = null, stableAt = Date.now(), landed = false;
      while (Date.now() < deadline) {
        const sample = await geometry();
        if (lastY === null || Math.abs(lastY - sample.scrollY) > .5) stableAt = Date.now();
        lastY = sample.scrollY;
        if (sample.hash === '#' + id && sample.top >= sample.headerBottom - 1 && sample.top <= sample.headerBottom + 64 && Date.now() - stableAt >= 100) { landed = true; break; }
        // Poll from Node: no-JavaScript pages intentionally cannot run RAF or
        // timer callbacks inside their main world.
        await page.waitForTimeout(50);
      }
      assert.equal(landed, true, 'native anchors settle inside the original strict readable bounds');
    } catch (error) { numericMetrics = { initial, final: await geometry() }; throw error; }
    const final = await geometry(); numericMetrics = { initial, final };
    const top = await page.locator('#' + id).evaluate(node => node.getBoundingClientRect().top), nav = await header(page);
    assert.ok(top >= nav.bottom - 1 && top <= nav.bottom + 64, 'native section anchors land below the measured header with a modest gap');
    if (requireCurrent) await page.waitForFunction(id => [...document.querySelectorAll('.ah-home-header a[aria-current="location"]')].some(node => node.hash === '#' + id), id);
    return { initial, final, top, headerBottom: nav.bottom };
  }
  async function noDecorativeMotion(page) {
    const value = await page.evaluate(() => ({ reveals: document.getAnimations().filter(animation => animation.id === 'ah-scroll-reveal').length,
      artwork: [...document.querySelectorAll('[data-scroll-art]')].map(node => ({ transform: getComputedStyle(node).transform, translate: getComputedStyle(node).translate })) }));
    assert.equal(value.reveals, 0, 'reduced or hidden pages have no entry animation');
    for (const item of value.artwork) assert.ok(item.transform === 'none' && ['none', '0px', '0px 0px'].includes(item.translate), 'decorative artwork returns to its static position');
    assert.equal(await page.locator('[data-scroll-atmosphere]').evaluate(node => node.hidden), true, 'particle canvas is fully disabled when motion is reduced or the page is hidden');
    assert.equal(await page.locator('[data-hero-particles]').evaluate(node => node.hidden), true, 'the hero rim particles also stop in reduced or hidden states');
    const pose = await page.locator('[data-hero-art]').evaluate(node => { const transform = getComputedStyle(node).transform; const matrix = new DOMMatrixReadOnly(transform === 'none' ? undefined : transform); return { identity: matrix.isIdentity, x: matrix.m41, y: matrix.m42 }; });
    assert.ok(pose.identity || Math.abs(pose.x) < .01 && Math.abs(pose.y) < .01, 'hero pointer pose returns to neutral when motion stops');
    return value;
  }
  async function essentialContent(page) {
    for (const selector of ['#hero-heading', '#about-heading', '#guests-heading', '#agenda-heading', '#registration-heading']) {
      const value = await page.locator(selector).evaluate(node => { const s = getComputedStyle(node), b = node.getBoundingClientRect(); return { display: s.display, visibility: s.visibility, opacity: Number(s.opacity), width: b.width, height: b.height }; });
      assert.ok(value.display !== 'none' && value.visibility === 'visible' && value.opacity > 0 && value.width > 0 && value.height > 0, 'meaningful information never waits hidden for an animation engine');
    }
    assert.doesNotMatch(await page.locator('body').textContent(), /SYNTHETIC_PRIVATE_/u);
    await noOverflow(page);
  }

  try {
    for (width of [320, 390, 1440, 1920]) {
      stage = 'initial-reduced'; const f = await fixture({ viewportWidth: width }), { page } = f;
      try {
        await page.waitForFunction(() => document.querySelector('#artdico-host')?.dataset.scrollMotion === 'ready');
        await page.waitForFunction(() => document.querySelector('#artdico-host')?.dataset.motionState === 'reduced');
        await essentialContent(page); await noDecorativeMotion(page); await header(page);
        stage = 'enable-motion'; await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.waitForFunction(() => document.querySelector('#artdico-host')?.dataset.motionState === 'active'); await settled(page);
        const atmosphere = await page.locator('[data-scroll-atmosphere]').evaluate(node => ({ hidden: node.hidden, ariaHidden: node.getAttribute('aria-hidden'), pointerEvents: getComputedStyle(node).pointerEvents }));
        assert.equal(atmosphere.hidden, false); assert.equal(atmosphere.ariaHidden, 'true'); assert.equal(atmosphere.pointerEvents, 'none', 'edge particles cannot intercept reading or form controls');
        stage = 'visible-hero-ambient';
        await page.waitForFunction(() => document.querySelector('.ah-home-hero-planet')?.dataset.heroMotion === 'active');
        const heroCanvas = await page.locator('[data-hero-particles]').evaluate(node => ({ hidden: node.hidden, ariaHidden: node.getAttribute('aria-hidden'), pointerEvents: getComputedStyle(node).pointerEvents }));
        assert.equal(heroCanvas.hidden, false); assert.equal(heroCanvas.ariaHidden, 'true'); assert.equal(heroCanvas.pointerEvents, 'none');
        await page.waitForTimeout(1000);
        assert.ok(await page.evaluate(() => window.__homeMotionQaPendingFrames()) > 0, 'visible hero has a real ambient particle frame loop');
        let pointerInteraction = false;
        if (width >= 1000) {
          const stageBox = await page.locator('.ah-home-hero-stage').boundingBox(); assert.ok(stageBox);
          const pointerY = stageBox.y + Math.min(stageBox.height * .4, 550);
          await page.mouse.move(stageBox.x + stageBox.width * .25, pointerY); await page.waitForTimeout(280);
          const firstPose = await page.locator('[data-hero-art]').evaluate(node => getComputedStyle(node).transform);
          await page.mouse.move(stageBox.x + stageBox.width * .72, pointerY); await page.waitForTimeout(280);
          const secondPose = await page.locator('[data-hero-art]').evaluate(node => { const transform = getComputedStyle(node).transform, m = new DOMMatrixReadOnly(transform === 'none' ? undefined : transform); return { transform, x: m.m41, y: m.m42 }; });
          assert.notEqual(firstPose, secondPose.transform, 'fine-pointer movement changes the real hero sphere pose');
          assert.ok(Math.abs(secondPose.x) <= 8 && Math.abs(secondPose.y) <= 8, 'hero pointer interaction stays gentle'); pointerInteraction = true;
        }
        await page.screenshot({ path: resolve(evidence, 'hero-active-' + width + '.png') });
        const start = await progress(page); assert.equal(start.hidden, 'true', 'reading progress is a decorative, non-announcing layer');
        await page.locator('#about').evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' }));
        await page.waitForFunction(() => document.querySelector('.ah-home-hero-planet')?.dataset.heroMotion === 'idle'); await settled(page);
        const firstArt = await art(page);
        stage = 'actual-scroll'; const beforeWheel = await page.evaluate(() => scrollY); await page.mouse.move(width - 4, 450); await page.mouse.wheel(0, 80);
        await page.waitForFunction(before => scrollY > before + 20, beforeWheel); await settled(page);
        const secondArt = await art(page), artShift = Math.abs(secondArt.documentTop - firstArt.documentTop);
        assert.ok(artShift > .1 && artShift <= 80, 'actual scrolling moves decorative art gently relative to its document position');
        const afterWheel = await page.evaluate(() => scrollY); await page.mouse.wheel(0, 650);
        await page.waitForFunction(before => scrollY > before + 100, afterWheel); await settled(page); await header(page);
        const later = await progress(page); assert.ok(later.width > start.width + .1 && later.width <= later.max + 1, 'reading progress follows native page scrolling');
        assert.equal(await page.locator('.ah-home-header').getAttribute('data-scrolled'), 'true');
        stage = 'entry-and-focus';
        await page.locator('#guests .ah-section-heading').evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForFunction(() => document.querySelector('#guests .ah-section-heading')?.getAnimations().some(animation => animation.id === 'ah-scroll-reveal'));
        const entry = await page.locator('#guests .ah-section-heading').evaluate(node => ({ opacity: Number(getComputedStyle(node).opacity), motions: node.getAnimations().filter(animation => animation.id === 'ah-scroll-reveal').length }));
        assert.ok(entry.motions > 0 && entry.opacity > 0 && entry.opacity <= 1, 'real entry animation keeps the content visible');
        await page.locator('#guests-heading').focus();
        await page.waitForFunction(() => !document.querySelector('#guests .ah-section-heading').getAnimations().some(animation => animation.id === 'ah-scroll-reveal'));
        const guestButton = page.locator('#guest-scroll-motion-guest [data-guest-toggle]');
        // The existing guest float is intentionally moving before focus. Use
        // native scrolling, then its supported focus pause for the hit test.
        await guestButton.evaluate(node => { node.scrollIntoView({ block: 'center', behavior: 'instant' }); node.focus({ preventScroll: true }); }); await settled(page);
        assert.equal(await guestButton.evaluate(node => { const b = node.getBoundingClientRect(); return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('[data-guest-toggle]') === node; }), true, 'the decorative canvas never covers the real central interaction target');
        stage = 'header-anchor-and-menu'; let alignment;
        if (width < 1000) {
          const menu = page.locator('[data-site-menu]'); await menu.locator('summary').click();
          assert.equal(await menu.evaluate(node => node.open), true);
          const bounds = await menu.locator('nav').boundingBox(); assert.ok(bounds && bounds.x >= -1 && bounds.x + bounds.width <= width + 1 && bounds.y >= 0 && bounds.y + bounds.height <= 901, 'the pinned mobile menu fits the viewport');
          await menu.locator('a[href="#agenda"]').click(); assert.equal(await menu.evaluate(node => node.open), false);
          alignment = await anchor(page, 'agenda');
          // Focus the already visible pinned control without requesting a new
          // native focus scroll; test Enter/Escape and API refresh separately.
          await menu.locator('summary').evaluate(node => node.focus({ preventScroll: true })); await page.keyboard.press('Enter'); assert.equal(await menu.evaluate(node => node.open), true);
          await page.keyboard.press('Escape'); assert.equal(await menu.evaluate(node => node.open), false);
          assert.equal(await menu.locator('summary').evaluate(node => document.activeElement === node), true);
        } else { await page.locator('.ah-home-desktop-nav a[href="#agenda"]').click(); alignment = await anchor(page, 'agenda'); }
        stage = 'refresh-position'; const beforeRefresh = await page.evaluate(() => scrollY); const refreshTrace = await f.refresh(); await settled(page);
        const afterRefresh = await page.evaluate(() => scrollY); numericMetrics = { beforeRefresh, afterRefresh, refreshTrace };
        assert.ok(Math.abs(afterRefresh - beforeRefresh) <= 2, 'public refresh and motion scanning preserve the reader’s position'); await header(page);
        stage = 'idle-frame-budget';
        await page.waitForFunction(() => window.__homeMotionQaPendingFrames() === 0, null, { timeout: 4000 });
        stage = 'live-reduced'; await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.waitForFunction(() => document.querySelector('#artdico-host')?.dataset.motionState === 'reduced'); await noDecorativeMotion(page);
        stage = 'deep-link'; const readsBeforeDeepLink = f.publicReads();
        await page.goto(SITE + '/__scroll-blank/', { waitUntil: 'domcontentloaded' });
        await page.goto(SITE + '/#guest-scroll-motion-guest', { waitUntil: 'networkidle' }); await page.evaluate(() => document.fonts.ready);
        assert.ok(f.publicReads() > readsBeforeDeepLink, 'initial guest hash is tested against a new delayed publication, not an existing document');
        await page.locator('#guest-scroll-motion-guest details[open]').waitFor(); await settled(page);
        const deepTop = await page.locator('#guest-scroll-motion-guest').evaluate(node => node.getBoundingClientRect().top), deepHeader = await header(page);
        assert.ok(deepTop >= deepHeader.bottom - 1, 'an asynchronously published guest hash is not covered by the pinned header'); await essentialContent(page);
        stage = 'synthetic-hidden'; await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.waitForFunction(() => document.querySelector('#artdico-host')?.dataset.motionState === 'active');
        await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
        await page.waitForFunction(() => document.querySelector('#artdico-host')?.dataset.motionState === 'hidden'); await noDecorativeMotion(page);
        await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
        await page.waitForFunction(() => document.querySelector('#artdico-host')?.dataset.motionState === 'active');
        await page.emulateMedia({ reducedMotion: 'reduce' }); await page.screenshot({ path: resolve(evidence, 'pinned-header-' + width + '.png') });
        reports.push({ width, initialAndLiveReducedMotion: true, visibleHeroAmbientFrameLoop: true, finePointerInteraction: pointerInteraction, nativeWheel: true, boundedDecorativeShift: artShift, realEntryAndFocusCancellation: true, pointerTransparentEdgeCanvas: true, idleWithoutPendingFramesWhenHeroOffscreen: true, frameProbeExplicitlySyntheticInstrumentation: true, pinnedHeader: true, anchorsBelowHeader: alignment, mobileMenu: width < 1000, publicRefreshPositionPreserved: true, delayedGuestHash: true, hiddenSignalExplicitlySynthetic: true });
      } finally { activePage = null; await f.context.close(); }
    }
    for (const mode of ['no-javascript', 'no-intersection-observer']) {
      stage = mode; width = 390; const f = await fixture({ viewportWidth: width, javaScriptEnabled: mode !== 'no-javascript', withoutObserver: mode === 'no-intersection-observer' });
      try {
        await essentialContent(f.page);
        if (mode === 'no-intersection-observer') {
          assert.equal(await f.page.locator('.ah-home-hero-planet').getAttribute('data-hero-motion'), 'idle');
          assert.equal(await f.page.locator('[data-hero-particles]').evaluate(node => node.hidden), true);
        }
        await f.page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
        if (mode !== 'no-javascript') await settled(f.page); await header(f.page);
        const menu = f.page.locator('[data-site-menu]'); await menu.locator('summary').click(); await menu.locator('a[href="#about"]').click();
        await anchor(f.page, 'about', { noScript: mode === 'no-javascript', requireCurrent: false }); await essentialContent(f.page);
        reports.push({ width, fallback: mode, essentialContentVisible: true, pinnedHeaderAndNativeMenu: true, noBusinessRequests: true });
      } finally { activePage = null; await f.context.close(); }
    }
    assert.deepEqual(pageErrors, []); assert.equal(reports.length, expectedCases);
  } catch (error) {
    failure = { message: error.message, stack: error.stack, stage, width };
    await activePage?.screenshot({ path: resolve(evidence, 'failure-' + width + '.png'), fullPage: true }).catch(() => {});
  } finally {
    await browser.close(); browser = null;
    assert.equal(sha(await readFile(resolve(dist, 'index.html'))), sha(html), 'the compiled build stays frozen throughout the checks');
    const report = { ok: !failure, cases: reports.length, expectedCases, syntheticOnly: true, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim(), publicHtmlSha256: sha(html), scriptSha256, businessPostRequests: 0, mailRequests: 0, realNetworkRequests: 0, reports, pageErrors, requests, servedAssets: Object.fromEntries([...servedAssets].sort()), ...(failure ? { failure } : {}) };
    await writeFile(resolve(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    const summary = { ok: report.ok, cases: report.cases, expectedCases, widths: [320, 390, 1440, 1920], syntheticOnly: true, sourceCommit: report.sourceCommit, publicHtmlSha256: report.publicHtmlSha256, scriptSha256, pageErrorCount: pageErrors.length, businessPostRequests: 0, mailRequests: 0, ...(failure ? { failure: { code: 'HOME_SCROLL_ASSERTION_FAILED', stage, width, location: /home-scroll-motion-smoke\.mjs:\d+:\d+/u.exec(failure.stack)?.[0] ?? null }, numericMetrics } : {}) };
    process.stdout.write((report.ok ? 'Public scroll motion browser verified: ' : 'Public scroll motion browser failed: ') + JSON.stringify(summary) + '\n');
    if (failure) process.exitCode = 1;
  }
}

await main().catch(async () => {
  await browser?.close().catch(() => {});
  process.stdout.write('Public scroll motion browser failed: ' + JSON.stringify({ ok: false, cases: 0, expectedCases, syntheticOnly: true, failure: { code: 'HOME_SCROLL_PREFLIGHT_FAILED', stage, width } }) + '\n');
  process.exitCode = 1;
});
