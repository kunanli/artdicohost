// Compiled homepage, fully intercepted public fixtures. No live records or mail.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createInitialContent } from '../../src/config/content.mjs';
import { toPublicContent } from '../../shared/content-schema.mjs';
import { peopleRuntimeFixture } from '../helpers/people-runtime-fixture.mjs';
import { PUBLIC_REGISTRATION_URL } from '../../src/config/event.mjs';

const { chromium } = await import(process.env.ARTDICO_PLAYWRIGHT_MODULE || 'playwright-core');
const project = fileURLToPath(new URL('../../', import.meta.url));
const dist = resolve(process.env.ARTDICO_DIST_DIRECTORY || resolve(project, 'dist'));
const evidence = resolve(process.env.ARTDICO_HOME_EVIDENCE_DIRECTORY || resolve(project, '.local-data/browser-evidence/p5-homepage'));
const SITE = 'https://artdico.host', API = 'https://api.artdico.host';
// The single-title Hero has its own requested geometry. The original PNG remains the
// reference for every unrelated guest/logo/heading/divider measurement.
const HERO_POSTER_LAYOUT = Object.freeze({
  reason:'Restore the exact original title artwork and original opposite-edge composition.',
  firstArtwork:{width:1227,height:229,desktopWidthRatio:.6391,mobileWidthRatio:.94},
  secondArtwork:{width:981,height:225,desktopWidthRatio:.511,mobileWidthRatio:.82},
  desktopSphere:{leftRatio:.22,widthRatio:.5594},
  unchangedScope:'Guest, organization, heading and divider geometry remain unchanged; functional typography and footer styling remain independent.',
});
const errors = [], reports = [], assets = new Map(), digest = value => createHash('sha256').update(value).digest('hex');
const content = toPublicContent(createInitialContent()); content.showcases = []; content.organizations = [];
const mime = file => ({ html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', png: 'image/png', webp: 'image/webp',
  avif: 'image/avif', jpg: 'image/jpeg', svg: 'image/svg+xml', woff2: 'font/woff2' })[extname(file).slice(1)] || 'application/octet-stream';
const browser = await chromium.launch({ executablePath: process.env.ARTDICO_CHROMIUM_BINARY || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'] });
await mkdir(evidence, { recursive: true });

async function fixture({ width, javaScriptEnabled = true, reducedMotion = 'no-preference', missingDecorations = false, longDescription = false, legacyShowcases = false }) {
  const runtime = await peopleRuntimeFixture({ capacity: 300 }), requests = [], fontFailures = new Set();
  const published = structuredClone(content);
  if (longDescription) published.event.presentation.heroDescription = '合成介绍：与不同城市的游戏创作者交流经验，认识新的创作伙伴。'.repeat(5);
  const legacy = structuredClone(published); delete legacy.showcases;
  let legacyPending = legacyShowcases;
  let externalNavigationAllowed = false, externalNavigations = 0;
  const context = await browser.newContext({ viewport: { width, height: 900 }, javaScriptEnabled, reducedMotion });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.href === PUBLIC_REGISTRATION_URL) {
      assert.equal(externalNavigationAllowed, true, 'only an explicit test click may open external registration');
      assert.equal(req.isNavigationRequest(), true); assert.equal(req.method(), 'GET'); externalNavigations++;
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Synthetic registration destination</title><p>Intercepted external registration; no live platform request.</p>' });
    }
    assert.ok([SITE, API].includes(url.origin), 'all resources must be served from the intercepted fixture origins');
    requests.push({ path: url.pathname, method: req.method(), origin: url.origin });
    assert.ok(['GET', 'HEAD', 'OPTIONS'].includes(req.method()), 'homepage viewing must not submit applications or mail');
    if (url.origin === API) {
      assert.equal(req.headers().cookie, undefined);
      if (url.pathname === '/api/public/content') return route.fulfill({ status: 200, contentType: 'application/json',
        headers: { 'access-control-allow-origin': SITE }, body: JSON.stringify({ revision: legacyShowcases && !legacyPending ? 2 : 1, publishedAt: '2026-11-01T00:00:00Z', content: legacyPending ? legacy : published }) });
      const response = await runtime.app.handle(new Request(req.url(), { method: req.method(), headers: await req.allHeaders() }));
      return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    }
    const path = url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname;
    const file = resolve(dist, '.' + path); assert.ok(file.startsWith(dist + '/'));
    if (missingDecorations && /planet|BarlowCondensed-ExtraBold.*\.woff2$/iu.test(path)) {
      if (extname(path) === '.woff2') fontFailures.add(path);
      return route.fulfill({ status: 404, body: '' });
    }
    const data = await readFile(file); assets.set(path, { path, bytes: data.length, sha256: digest(data) });
    return route.fulfill({ status: 200, contentType: mime(file), body: data });
  });
  const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  if (javaScriptEnabled) await page.clock.setFixedTime(new Date('2026-11-01T00:00:00Z'));
  await page.goto(SITE + '/', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  if (legacyShowcases) {
    assert.notEqual(await page.locator('#students').getAttribute('hidden'), null, 'a first response missing the required works field retains the hidden static section');
    assert.equal(await page.locator('#students').isVisible(), false);
    assert.equal(await page.locator('[data-public-showcases-concept],[data-public-showcases-empty]').count(), 0);
    assert.match(await page.locator('[data-public-content-status]').textContent(), /暂时无法读取已发布安排/u, 'a malformed legacy envelope is not accepted as a publication');
    const reads = requests.filter(row => row.path === '/api/public/content').length;
    legacyPending = false;
    await page.clock.setFixedTime(new Date('2026-11-01T00:00:02Z'));
    await page.waitForTimeout(1100);
    const refreshed = page.waitForResponse(response => response.url() === API + '/api/public/content');
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await refreshed;
    await page.waitForFunction(description => document.querySelector('[data-public-hero-description]')?.textContent === description, published.event.presentation.heroDescription);
    assert.equal(requests.filter(row => row.path === '/api/public/content').length, reads + 1, 'one bounded read recovers the valid long-description publication');
  }
  return { context, page, runtime, requests, fontFailures, missingDecorations, legacyShowcases, longDescription, expectedHeroDescription: published.event.presentation.heroDescription,
    allowExternalNavigation: () => { externalNavigationAllowed = true; }, externalNavigationCount: () => externalNavigations };
}

async function heroPoster(page,{failedFont=false}={}){
  await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('#hero-heading [data-home-title-image]').count(),2,'the two original supplied title artworks are restored');
  assert.equal(await page.locator('#hero-heading').getAttribute('aria-label'),await page.locator('#hero-heading').getAttribute('data-initial-event-title'),'the semantic event name remains independent of decorative artwork');
  assert.equal(await page.locator('#hero-heading [data-home-title-overline],#hero-heading [data-poster-repeat],#hero-heading .ah-poster-outline').count(),0,'no split overline or repeated title echo is added');
  const value=await page.evaluate(()=>{
    const box=node=>{const b=node.getBoundingClientRect();return{x:b.x,y:b.y+scrollY,right:b.right,bottom:b.bottom+scrollY,width:b.width,height:b.height};};
    const heading=document.querySelector('#hero-heading'),bounds=selector=>box(document.querySelector(selector));
    const rows=[...heading.querySelectorAll(':scope>.ah-home-title-art')].map(node=>{const image=node.querySelector('[data-home-title-image]');return{key:image.dataset.homeTitleImage,box:box(image),wrapper:box(node),wrapperPosition:getComputedStyle(node).position,hiddenFromSpeech:node.getAttribute('aria-hidden'),complete:image.complete,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,hidden:image.hidden,fallbackHidden:node.querySelector('[data-home-title-fallback]').hidden};});
    return{rows,composition:{viewport:innerWidth,heading:box(heading),description:bounds('[data-public-hero-description]'),facts:bounds('#top .ah-event-meta'),actions:bounds('#top .ah-hero-actions'),hero:bounds('#top')}};
  });
  const{rows,composition}=value,mobile=composition.viewport<=820;
  assert.deepEqual(rows.map(row=>row.key),['ggj','host']);
  for(const[index,row]of rows.entries()){
    const ratio=mobile?index===0?.94:.82:index===0?.6391:.511;
    assert.ok(Math.abs(row.box.width-composition.viewport*ratio)<=1,'original artwork retains its separately measured responsive width');
    assert.equal(row.complete,true);assert.equal(row.hidden,false);assert.equal(row.fallbackHidden,true);
    assert.equal(row.naturalWidth,index===0?1227:981);assert.equal(row.naturalHeight,index===0?229:225);
    assert.ok(Math.abs(row.box.height/row.box.width-row.naturalHeight/row.naturalWidth)<.001,'artwork preserves its original aspect ratio');
    assert.equal(row.wrapperPosition,'absolute');assert.equal(row.hiddenFromSpeech,'true');
    assert.ok(row.box.x>=-1&&row.box.right<=composition.viewport+1,'both complete title graphics remain within the viewport');
    assert.ok(Math.abs(index===0?row.box.x:row.box.right-composition.viewport)<=1,'the original brands retain opposite page-edge alignment');
  }
  assert.ok(rows[1].wrapper.y>rows[0].wrapper.bottom+20,'the original two title groups have independent vertical positions');
  assert.ok(composition.facts.y>=composition.description.bottom-1,'event facts follow the introductory copy');
  assert.ok(composition.actions.y>=composition.facts.bottom-1&&composition.actions.bottom<=composition.hero.bottom+1,'Hero actions remain after the facts and inside the Hero');
  return{layout:HERO_POSTER_LAYOUT,...value,footerFontFailure:failedFont};
}

async function inspect(f, label) {
  const { page } = f;
  assert.equal(await page.locator('#artdico-host.ah-cosmos').count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, label + ': horizontal overflow');
  assert.equal(await page.locator('h1').count(), 1); assert.equal(await page.locator('h1').isVisible(), true);
  assert.notEqual(await page.locator('#students').getAttribute('hidden'), null, 'an empty or legacy publication does not reveal the works section');
  assert.equal(await page.locator('#students').isVisible(), false, 'no works means no heading, carousel or reserved section space');
  assert.equal(await page.locator('#students-heading').isVisible(), false);
  assert.equal(await page.locator('[data-public-works-controls]').isVisible(), false);
  assert.equal(await page.locator('[data-public-showcases-concept],[data-public-showcases-empty]').count(), 0, 'empty works have no concept or waiting-state placeholder');
  assert.equal(await page.locator('[data-showcase-id]').count(), 0);
  if (f.longDescription) assert.equal(await page.locator('[data-public-hero-description]').textContent(), f.expectedHeroDescription, 'the long-description case still exercises the actual accepted public copy');
  assert.equal(await page.locator('h1').getAttribute('aria-label'),content.event.title,'the canonical event title remains accessible independently of the poster typography');
  assert.equal(await page.locator('#hero-heading [data-home-title-image]').count(),2,'the original title artwork is present');
  const titleTypography=await heroPoster(page,{failedFont:f.missingDecorations});
  if(f.missingDecorations)assert.ok(f.fontFailures.size>0,'the missing-decoration case actually fails a requested poster font');
  const clipped = await page.locator('h1').evaluate(node => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT), failures = [];
    while (walker.nextNode()) {
      const text = walker.currentNode; if (!text.textContent.trim()) continue;
      const parent = text.parentElement; if (!parent||parent.closest('[hidden]')) continue;
      for(let ancestor=parent;ancestor&&ancestor!==node.parentElement;ancestor=ancestor.parentElement){const style=getComputedStyle(ancestor);if(ancestor.hidden||style.display==='none'||style.visibility!=='visible'||Number(style.opacity)===0)failures.push('hidden-text');}
      const range = document.createRange(); range.selectNodeContents(text);
      const textBoxes=[...range.getClientRects()].filter(box=>box.width>0&&box.height>0);if(!textBoxes.length)failures.push('unrendered-text');
      for (const box of textBoxes) {
        if(!box.width||!box.height)continue;
        if(box.left < -1||box.right > innerWidth+1)failures.push('viewport');
        for(let clip=parent;clip&&clip!==node.parentElement;clip=clip.parentElement){const style=getComputedStyle(clip),rect=clip.getBoundingClientRect();if(['hidden','clip','scroll','auto'].includes(style.overflowX)&&(box.left<rect.left-1||box.right>rect.right+1))failures.push('horizontal-clip');if(['hidden','clip','scroll','auto'].includes(style.overflowY)&&(box.top<rect.top-1||box.bottom>rect.bottom+1))failures.push('vertical-clip');}
      }
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
  const backgrounds = await page.locator('#artdico-host').evaluate(node => ({root:getComputedStyle(node).backgroundColor,body:getComputedStyle(document.body).backgroundColor,html:getComputedStyle(document.documentElement).backgroundColor,active:node.dataset.atmosphereState==='active'}));
  assert.equal(backgrounds.body,'rgb(0, 0, 0)','the approved full-page atmosphere has a black document backdrop');
  assert.equal(backgrounds.html,'rgb(0, 0, 0)');
  assert.equal(backgrounds.root,backgrounds.active?'rgba(0, 0, 0, 0)':'rgb(0, 0, 0)','the root exposes the active atmosphere and remains black in static/reduced fallback');
  const primary = page.locator('#top [data-home-primary-apply]');
  assert.equal(page.url(), SITE + '/', 'the event remains readable and never redirects the entire page');
  assert.equal(await primary.getAttribute('href'), PUBLIC_REGISTRATION_URL);
  assert.match(await primary.innerText(), /前往活动行报名/u);
  assert.match(await page.locator('[data-general-registration-notice]').innerText(), /普通参会请前往活动行报名/u);
  const generalRoutes = await page.locator('a[data-general-registration]').evaluateAll(nodes => nodes.map(node => ({ href: node.getAttribute('href'), target: node.getAttribute('target') })));
  assert.equal(generalRoutes.length, 7, 'Hero, desktop/mobile navigation, footer, both service FAQs and the old registration section all retain explicit external registration links');
  for (const link of generalRoutes) { assert.equal(link.href, PUBLIC_REGISTRATION_URL); assert.ok(link.target === null || link.target === '_self'); }
  assert.equal(await page.locator('[data-recruit="speaker"]').getAttribute('href'), '#speaker-application');
  assert.equal(await page.locator('[data-recruit="site"],[data-recruit="student"]').count(), 0, 'ordinary attendees never prefill the onsite speaker application');
  assert.equal(await page.locator('#speaker-application').count(), 1);
  for (const id of ['registration-status', 'site-role']) assert.match(await page.locator('#faq-' + id + ' .ah-faq-answer').textContent(), /活动行报名/u);
  if (label !== 'no-javascript') {
    const faq = page.locator('#faq-registration-status'), summary = faq.locator('summary');
    await summary.focus();
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent('artdico:registration-unavailable', { detail: { message: '合成讲者服务暂时不可用' } }));
      document.dispatchEvent(new CustomEvent('artdico:registration-ready', { detail: { availability: { status: 'closed' } } }));
    });
    assert.equal(await summary.evaluate(node => document.activeElement === node), true, 'privacy and speaker availability refresh keep FAQ keyboard focus');
    assert.match(await faq.locator('.ah-faq-answer').textContent(), /普通参会请前往活动行报名/u);
    assert.equal(await faq.locator('a[data-general-registration]').getAttribute('href'), PUBLIC_REGISTRATION_URL);
    assert.match(await primary.innerText(), /前往活动行报名/u, 'onsite proposal availability cannot rewrite the general attendance action');
    assert.match(await page.locator('[data-general-registration-notice]').innerText(), /普通参会请前往活动行报名/u, 'proposal outages cannot mark external attendance unavailable');
  }
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
  assert.ok(actionLayout.agenda.top>=actionLayout.facts.bottom-1&&actionLayout.agenda.bottom<=actionLayout.hero.bottom+1,'the timetable action follows the facts in the new normal-flow poster composition');
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
    emptyWorksSectionHidden:true,legacyMissingFieldKeepsInitialSectionHidden:f.legacyShowcases,validLongDescriptionRecovered:f.longDescription,posterTypography:titleTypography,failedFontPaths:[...f.fontFailures],backgrounds,applicationActionInHero: true, applicationKeyboardReachable: true, externalRegistrationLinks: generalRoutes.length, generalAttendanceIndependentOfProposalService:true, actionPositions:{applicationTop:primaryBox.top,agendaTop:actionLayout.agenda.top,scope:'The single-title Hero follows both complete brand lines and facts; the original PNG y=1306 CTA proportion is superseded only here.'},eventFactFontPixels: { venue: venueSize, date: dateSize } };
}

try {
  for (const width of [320, 390, 1440]) {
    const f = await fixture({ width });
    await f.page.locator('footer').scrollIntoViewIfNeeded();
    assert.ok(await f.page.locator('footer img').count());
    await f.page.waitForFunction(() => [...document.querySelectorAll('footer img')].every(image => image.complete && image.naturalWidth > 0));
    const footerType=f.page.locator('footer [data-footer-display-line]');
    assert.deepEqual(await footerType.allTextContents(),['Come Together.','Create Forever.']);
    const footerTypography=await footerType.evaluateAll(nodes=>nodes.map(node=>{const style=getComputedStyle(node),box=node.getBoundingClientRect();return{family:style.fontFamily,weight:style.fontWeight,stroke:parseFloat(style.webkitTextStrokeWidth),width:box.width,height:box.height};}));
    for(const line of footerTypography){assert.match(line.family,/Barlow Condensed/u);assert.equal(line.weight,'800');assert.ok(line.width>0&&line.height>0);}
    assert.ok(footerTypography[1].stroke>0,'the second live footer line uses the requested outline treatment');
    await f.page.locator('footer').screenshot({ path: resolve(evidence, 'footer-' + width + '.png'), animations: 'disabled' });
    await f.page.evaluate(() => scrollTo(0, 0));
    await f.page.screenshot({ path: resolve(evidence, 'homepage-' + width + '.png'), fullPage: true, animations: 'disabled' });
    await f.page.screenshot({ path: resolve(evidence, 'hero-' + width + '.png'), fullPage: false, animations: 'disabled' });
    reports.push(await inspect(f, 'standard-' + width)); await f.context.close();
  }
  for (const options of [{ width: 390, javaScriptEnabled: false }, { width: 390, reducedMotion: 'reduce' }, { width: 390, missingDecorations: true }, { width: 390, longDescription: true, legacyShowcases: true }]) {
    const f = await fixture(options), label = options.javaScriptEnabled === false ? 'no-javascript' : options.reducedMotion === 'reduce' ? 'reduced-motion' : options.longDescription ? 'long-description' : 'missing-decorations';
    reports.push(await inspect(f, label));
    if (options.javaScriptEnabled === false) {
      assert.equal(f.requests.filter(row => row.origin === API).length, 0);
      assert.equal(await f.page.locator('[data-registration-form] [data-submit]').isDisabled(), true);
      assert.match(await f.page.locator('[data-general-registration-notice]').textContent(), /普通参会请前往活动行报名/u);
    }
    if (options.reducedMotion === 'reduce') assert.equal(await f.page.evaluate(() => document.getAnimations().some(animation =>
      animation.playState === 'running' && animation.effect.getComputedTiming().iterations === Infinity)), false);
    await f.page.screenshot({ path: resolve(evidence, label + '.png'), fullPage: false });
    if (options.javaScriptEnabled === false) {
      f.allowExternalNavigation();
      await f.page.locator('[data-site-menu] summary').click();
      await f.page.locator('[data-site-menu] a[data-general-registration]').click();
      await f.page.waitForURL(PUBLIC_REGISTRATION_URL);
      assert.equal(await f.page.title(), 'Synthetic registration destination');
      assert.equal(f.externalNavigationCount(), 1, 'the no-JS native menu link reaches only the intercepted external destination');
      reports.at(-1).nativeNoScriptExternalNavigation = true;
    }
    await f.context.close();
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
const report = { reports, heroPosterLayout:HERO_POSTER_LAYOUT, pageErrors: errors, syntheticOnly: true, realMail: false, businessWrites: 0,
  htmlSha256: digest(await readFile(resolve(dist, 'index.html'))), assets: [...assets.values()].sort((a, b) => a.path.localeCompare(b.path)) };
await writeFile(resolve(evidence, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
