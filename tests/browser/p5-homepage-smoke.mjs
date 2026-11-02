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
// The single-title Hero has its own requested geometry. The original PNG remains the
// reference for every unrelated guest/logo/heading/divider measurement.
const HERO_POSTER_LAYOUT = Object.freeze({
  reason: 'Each brand appears once as a complete, unbroken line of real text.',
  priorHero: 'A GLOBAL overline and repeated filled/outline GAME JAM and ARTDiCO HOST pairs.',
  currentHero: 'One GlobalGameJam line and one ARTDiCO HOST line, each followed by its smaller Chinese subtitle.',
  desktopWrapperWidth: 'min(82vw, 1574px)', desktopInlinePadding: 'clamp(24px, 7.3vw, 140px)', mobileInlinePadding: 20,
  mainTitlePixels: 'desktop clamp(64px, 9vw, 172px); mobile (viewport - 40px) / 8.8', hostSizeRatio: 1,
  groupGap: 'clamp(28px, 4vw, 72px)',
  wordWidthAlignment: 'Both complete brands share the same left edge and wrapper boundaries; their distinct natural word widths remain readable without cropping.',
  latinWeight: 800, cssSizeAdjust: '140%', staticWidthScale: 1,
  displayLeading: 1.1, solidStrokePixels: .55,
  subtitlePixels: { minimum: 16, maximum: 28 }, sliceAngle: 124,
  sliceStops: [0,68,68,82,82,100], sliceColors: ['rgb(150, 100, 255)','rgb(198, 179, 255)','rgb(150, 100, 255)'],
  unchangedScope: 'No guest, organization, section heading, divider, fallback or crop tolerance changes. Footer outline styling stays independent.',
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
  const context = await browser.newContext({ viewport: { width, height: 900 }, javaScriptEnabled, reducedMotion });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
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
  return { context, page, runtime, requests, fontFailures, missingDecorations, legacyShowcases, longDescription, expectedHeroDescription: published.event.presentation.heroDescription };
}

async function heroPoster(page,{failedFont=false}={}){
  await page.evaluate(()=>document.fonts.ready);
  const close=(actual,expected,tolerance,message)=>assert.ok(Math.abs(actual-expected)<=tolerance,message);
  assert.equal(await page.locator('#hero-heading [data-home-title-image],#hero-heading [data-home-title-fallback]').count(),0,'the title remains live text without image/error fallback layers');
  assert.equal(await page.locator('#hero-heading').getAttribute('aria-label'),await page.locator('#hero-heading').getAttribute('data-initial-event-title'),'the canonical event title stays independent of the visual brand styling');
  assert.equal(await page.locator('#hero-heading [data-home-title-overline],#hero-heading [data-poster-repeat],#hero-heading .ah-poster-outline').count(),0,'the Hero has no split GLOBAL overline, repeated words or outline echoes');
  assert.equal(await page.locator('#hero-heading [data-poster-word]').count(),2,'the Hero contains exactly one real-text word group for each brand');
  assert.equal(await page.locator('#hero-heading [data-poster-primary]').count(),2,'both single brand lines remain primary text');
  assert.deepEqual(await page.locator('#hero-heading [data-home-title-subtitle][lang="zh-CN"]').allTextContents(),['中国组织者交流会','嘉年华']);
  const value=await page.evaluate(()=>{
    const box=node=>{const b=node.getBoundingClientRect();return{x:b.x,y:b.y+scrollY,right:b.right,bottom:b.bottom+scrollY,width:b.width,height:b.height};};
    const boxes=range=>[...range.getClientRects()].filter(b=>b.width&&b.height).map(b=>({x:b.x,y:b.y+scrollY,right:b.right,bottom:b.bottom+scrollY,width:b.width,height:b.height}));
    const heading=document.querySelector('#hero-heading'),headingStyle=getComputedStyle(heading);
    const rows=[...heading.querySelectorAll(':scope>.ah-home-title-art')].map(node=>{
      const type=node.querySelector('[data-home-title-type][lang=en]'),style=getComputedStyle(type),range=document.createRange();range.selectNodeContents(type);
      const primary=style.fontFamily.split(',')[0].trim().replace(/^["']|["']$/gu,'');
      const words=[...type.children].map(word=>{
        const range=document.createRange();range.selectNodeContents(word);const style=getComputedStyle(word),matrix=style.transform==='none'?new DOMMatrixReadOnly():new DOMMatrixReadOnly(style.transform);
        return{text:word.textContent.trim(),primary:word.hasAttribute('data-poster-primary'),repeat:word.hasAttribute('data-poster-repeat'),word:word.hasAttribute('data-poster-word'),classes:[...word.classList],color:style.color,fill:style.webkitTextFillColor,stroke:parseFloat(style.webkitTextStrokeWidth),strokeColor:style.webkitTextStrokeColor,background:style.backgroundImage,clip:style.webkitBackgroundClip,scaleX:matrix.a,scaleY:matrix.d,animations:word.getAnimations().length,box:box(word),boxes:boxes(range)};
      });
      const subtitle=node.querySelector('[data-home-title-subtitle]');
      return{key:type.dataset.homeTitleType,words,box:box(type),wrapper:box(node),wrapperPosition:getComputedStyle(node).position,hiddenFromSpeech:node.getAttribute('aria-hidden'),family:style.fontFamily,primary,weight:style.fontWeight,fontSize:parseFloat(style.fontSize),lineHeight:parseFloat(style.lineHeight),textBoxes:boxes(range),subtitle:{fontSize:parseFloat(getComputedStyle(subtitle).fontSize),box:box(subtitle)},faces:[...document.fonts].filter(face=>face.family.replace(/^["']|["']$/gu,'')===primary&&face.weight==='800').map(face=>({weight:face.weight,status:face.status,sizeAdjust:face.sizeAdjust}))};
    });
    const bounds=selector=>box(document.querySelector(selector));
    return{rows,composition:{viewport:innerWidth,headingDisplay:headingStyle.display,headingDirection:headingStyle.flexDirection,headingGap:parseFloat(headingStyle.rowGap),heading:box(heading),description:bounds('[data-public-hero-description]'),facts:bounds('#top .ah-event-meta'),actions:bounds('#top .ah-hero-actions'),hero:bounds('#top')}};
  });
  const {rows,composition}=value;
  const mobile=composition.viewport<=820;
  const expectedLatin=mobile?(composition.viewport-40)/8.8:Math.min(172,Math.max(64,composition.viewport*.09));
  const expectedInset=mobile?HERO_POSTER_LAYOUT.mobileInlinePadding:Math.min(140,Math.max(24,composition.viewport*.073));
  const expectedWrapperWidth=mobile?composition.viewport-40:Math.min(1574,composition.viewport*.82);
  const expectedGroupGap=Math.min(72,Math.max(28,composition.viewport*.04));
  assert.equal(rows.length,2,'both brand wrappers remain direct children of the semantic h1');
  assert.deepEqual(rows.map(row=>row.key),['ggj','host']);
  assert.deepEqual(rows.map(row=>row.words.map(word=>word.text)),[['GlobalGameJam'],['ARTDiCO HOST']],'each complete brand appears once, with GlobalGameJam kept together');
  for(const [index,row] of rows.entries()){
    close(row.fontSize,expectedLatin*(index?HERO_POSTER_LAYOUT.hostSizeRatio:1),.01,'both complete brands use the approved display size');
    close(row.wrapper.x,composition.hero.x+expectedInset,1,'the title retains the approved desktop inset or 20px mobile margin');
    close(row.wrapper.width,expectedWrapperWidth,1,'the brand wrapper retains its exact approved responsive width');
    close(row.wrapper.right,composition.hero.x+expectedInset+expectedWrapperWidth,1,'the full wrapper retains its approved right boundary');
    assert.notEqual(row.wrapperPosition,'absolute','both brands participate in normal flow');assert.equal(row.hiddenFromSpeech,'true');
    const [word]=row.words;
    assert.equal(word.primary,true);assert.equal(word.repeat,false);assert.equal(word.word,true,'each complete brand participates in the native text mask');assert.ok(word.classes.includes('ah-poster-solid'));
    close(word.stroke,HERO_POSTER_LAYOUT.solidStrokePixels,.01,'the solid brand keeps its fine same-color stroke');assert.equal(word.strokeColor,word.color);
    if(index===0){
      assert.ok(word.classes.includes('ah-poster-slice'),'only GlobalGameJam retains the restrained diagonal color accent');
      assert.equal((word.background.match(/linear-gradient\(/gu)||[]).length,1,'GlobalGameJam has one color layer');assert.ok(word.background.includes(HERO_POSTER_LAYOUT.sliceAngle+'deg'));
      assert.deepEqual((word.background.match(/\d+(?:\.\d+)?%/gu)||[]).map(Number.parseFloat),HERO_POSTER_LAYOUT.sliceStops,'the single color layer keeps the exact hard-edge stops');
      const colors=word.background.match(/rgba?\([^)]*\)/gu)||[];
      assert.deepEqual(colors.filter((color,index)=>index===0||color!==colors[index-1]),HERO_POSTER_LAYOUT.sliceColors,'the accent stays purple, pale purple, then purple');
      assert.equal(word.clip,'text','the single background layer clips to the real letters');assert.match(word.fill,/rgba\([^)]*,\s*0\)$/u);
    }else{
      assert.equal(word.classes.includes('ah-poster-slice'),false,'ARTDiCO HOST stays a plain solid brand');assert.equal(word.background,'none');assert.equal(word.fill,word.color,'ARTDiCO HOST keeps an opaque solid fill');assert.doesNotMatch(word.fill,/rgba\([^)]*,\s*0\)$/u);
    }
    close(row.lineHeight/row.fontSize,HERO_POSTER_LAYOUT.displayLeading,.002,'each single brand retains the approved display leading');
    assert.ok(row.subtitle.fontSize>=HERO_POSTER_LAYOUT.subtitlePixels.minimum&&row.subtitle.fontSize<=HERO_POSTER_LAYOUT.subtitlePixels.maximum&&row.subtitle.fontSize<row.fontSize,'Chinese subtitles remain readable and smaller than the Latin display');close(row.subtitle.box.y-word.box.bottom,mobile?8:10,1,'each subtitle follows its brand with the approved gap');
    close(row.subtitle.fontSize,mobile?Math.min(20,Math.max(16,composition.viewport*.026)):Math.min(28,Math.max(18,composition.viewport*.0145)),.01,'subtitle size follows its separate small display role');
    assert.equal(word.boxes.length,1,'a complete brand never breaks onto another line');close(word.box.x,row.wrapper.x,1,'each complete brand starts at its wrapper left edge');
    close(word.scaleX,HERO_POSTER_LAYOUT.staticWidthScale,.001,'letterforms retain their natural width');close(word.scaleY,1,.001,'letterforms are not vertically stretched');assert.equal(word.animations,0,'brand words stay static');
    for(const rect of word.boxes)assert.ok(rect.x>=row.wrapper.x-1&&rect.right<=row.wrapper.right+1,'the whole brand fits its wrapper');
    assert.equal(row.weight,'800');assert.equal(row.primary,'Barlow Condensed');assert.ok(row.faces.length>0);assert.ok(row.faces.some(face=>face.status===(failedFont?'error':'loaded')),'the real shipped font request reaches its expected load or fallback state');assert.ok(row.faces.every(face=>face.sizeAdjust===HERO_POSTER_LAYOUT.cssSizeAdjust),'the original display face keeps its approved CSS metrics');
    assert.ok(row.box.width>0&&row.box.height>0&&row.textBoxes.length>0,'the headline consists of rendered native letterforms');
    for(const rect of row.textBoxes)assert.ok(rect.x>=-1&&rect.right<=composition.viewport+1,'every live brand remains inside the viewport');
  }
  assert.equal(composition.headingDisplay,'flex');assert.equal(composition.headingDirection,'column');close(composition.headingGap,expectedGroupGap,.01,'the two single brands use their approved responsive spacing');
  close(rows[0].words[0].box.x,rows[1].words[0].box.x,1,'the complete brands share one left edge');
  close(rows[0].wrapper.x,rows[1].wrapper.x,1,'both brand wrappers share a left edge');close(rows[0].wrapper.right,rows[1].wrapper.right,1,'both brand wrappers share the same right boundary');
  close(rows[1].wrapper.y-rows[0].wrapper.bottom,composition.headingGap,1,'the two brand groups are separated by their explicit normal-flow gap');
  assert.ok(composition.description.y>=composition.heading.bottom-1,'published introductory copy follows both complete brands');
  assert.ok(composition.facts.y>=composition.description.bottom-1&&composition.facts.y>=composition.heading.bottom-1,'event facts follow both brand lines and the published copy');
  assert.ok(composition.actions.y>=composition.facts.bottom-1&&composition.actions.bottom<=composition.hero.bottom+1,'Hero actions follow the facts and remain inside the Hero');
  return{layout:HERO_POSTER_LAYOUT,...value};
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
  assert.equal(await page.locator('#hero-heading [data-home-title-image],#hero-heading [data-home-title-fallback]').count(),0,'live title text replaces the old image and error-fallback layers');
  const titleTypography=await heroPoster(page,{failedFont:f.missingDecorations});
  if(f.missingDecorations)assert.ok(f.fontFailures.size>0,'the missing-decoration case actually fails a requested poster font');
  const clipped = await page.locator('h1').evaluate(node => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT), failures = [];
    while (walker.nextNode()) {
      const text = walker.currentNode; if (!text.textContent.trim()) continue;
      const parent = text.parentElement; if (!parent) continue;
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
    emptyWorksSectionHidden:true,legacyMissingFieldKeepsInitialSectionHidden:f.legacyShowcases,validLongDescriptionRecovered:f.longDescription,posterTypography:titleTypography,failedFontPaths:[...f.fontFailures],backgrounds,applicationActionInHero: true, applicationKeyboardReachable: true, actionPositions:{applicationTop:primaryBox.top,agendaTop:actionLayout.agenda.top,scope:'The single-title Hero follows both complete brand lines and facts; the original PNG y=1306 CTA proportion is superseded only here.'},eventFactFontPixels: { venue: venueSize, date: dateSize } };
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
      assert.doesNotMatch(await f.page.locator('[data-registration-availability]').textContent(), /报名已开放/u);
    }
    if (options.reducedMotion === 'reduce') assert.equal(await f.page.evaluate(() => document.getAnimations().some(animation =>
      animation.playState === 'running' && animation.effect.getComputedTiming().iterations === Infinity)), false);
    await f.page.screenshot({ path: resolve(evidence, label + '.png'), fullPage: false }); await f.context.close();
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
const report = { reports, heroPosterLayout:HERO_POSTER_LAYOUT, pageErrors: errors, syntheticOnly: true, realMail: false, businessWrites: 0,
  htmlSha256: digest(await readFile(resolve(dist, 'index.html'))), assets: [...assets.values()].sort((a, b) => a.path.localeCompare(b.path)) };
await writeFile(resolve(evidence, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
