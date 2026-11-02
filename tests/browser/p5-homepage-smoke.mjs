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
// Hero v2 has its own requested poster geometry. The original PNG remains the
// reference for every unrelated guest/logo/heading/divider measurement.
const HERO_POSTER_LAYOUT = Object.freeze({
  reason: 'Filled complete words followed by the same outlined words in one compact, normal-flow word wall.',
  priorHero: 'Separate GLOBAL/GAME JAM and ARTDiCO/HOST words in two absolute anchors; original PNG agenda action y=1306.',
  currentHero: 'GLOBAL overline, GAME JAM pair, ARTDiCO HOST pair, smaller Chinese subtitles; facts and actions follow the wall.',
  desktopWrapperWidth: 'min(66vw, 1267px)', desktopInlinePadding: 'clamp(24px, 7.3vw, 140px)', mobileInlinePadding: 20,
  gameJamPixels: 'desktop clamp(90px, 11.7vw, 225px); mobile (viewport - 40px) / 5.45', hostSizeRatio: .7175,
  wordWallGap: 'desktop clamp(18px, 1.5vw, 29px); mobile 18px',
  wordWidthAlignment: 'Loaded native Barlow pairs align within 1px across both groups. Font-404 fallback retains exact pair widths and strict wrapper/viewport crop checks; different font advances do not imply cross-group equality.',
  latinWeight: 800, cssSizeAdjust: '140%', staticWidthScale: 1.06,
  pairLeading: 1.02, solidStrokePixels: .55, minimumOutlinePixels: 1,
  subtitlePixels: { minimum: 16, maximum: 28 }, sliceAngles: [124, 72],
  unchangedScope: 'No guest, organization, section heading, divider, fallback or crop tolerance changes.',
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
  assert.equal(await page.locator('#hero-heading [data-home-title-image],#hero-heading [data-home-title-fallback]').count(),0,'the poster remains live text without image/error fallback layers');
  assert.equal(await page.locator('#hero-heading').getAttribute('aria-label'),await page.locator('#hero-heading').getAttribute('data-initial-event-title'),'the canonical event title stays independent of the repeated poster words');
  assert.deepEqual(await page.locator('#hero-heading [data-home-title-overline][lang=en]').allTextContents(),['GLOBAL'],'GLOBAL remains a separate live-text overline');
  assert.deepEqual(await page.locator('#hero-heading [data-home-title-subtitle][lang="zh-CN"]').allTextContents(),['中国组织者交流会','嘉年华']);
  const value=await page.evaluate(()=>{
    const box=node=>{const b=node.getBoundingClientRect();return{x:b.x,y:b.y+scrollY,right:b.right,bottom:b.bottom+scrollY,width:b.width,height:b.height};};
    const boxes=range=>[...range.getClientRects()].filter(b=>b.width&&b.height).map(b=>({x:b.x,y:b.y+scrollY,right:b.right,bottom:b.bottom+scrollY,width:b.width,height:b.height}));
    const heading=document.querySelector('#hero-heading'),headingStyle=getComputedStyle(heading);
    const rows=[...heading.querySelectorAll(':scope>.ah-home-title-art')].map(node=>{
      const type=node.querySelector('[data-home-title-type][lang=en]'),style=getComputedStyle(type),range=document.createRange();range.selectNodeContents(type);
      const primary=style.fontFamily.split(',')[0].trim().replace(/^["']|["']$/gu,'');
      const words=[...type.children].map(word=>{
        const range=document.createRange();range.selectNodeContents(word);const style=getComputedStyle(word),matrix=new DOMMatrixReadOnly(style.transform);
        return{text:word.textContent.trim(),primary:word.hasAttribute('data-poster-primary'),repeat:word.hasAttribute('data-poster-repeat'),word:word.hasAttribute('data-poster-word'),classes:[...word.classList],color:style.color,fill:style.webkitTextFillColor,stroke:parseFloat(style.webkitTextStrokeWidth),strokeColor:style.webkitTextStrokeColor,background:style.backgroundImage,clip:style.webkitBackgroundClip,scaleX:matrix.a,scaleY:matrix.d,animations:word.getAnimations().length,box:box(word),boxes:boxes(range)};
      });
      const subtitle=node.querySelector('[data-home-title-subtitle]');
      return{key:type.dataset.homeTitleType,words,box:box(type),wrapper:box(node),wrapperPosition:getComputedStyle(node).position,hiddenFromSpeech:node.getAttribute('aria-hidden'),family:style.fontFamily,primary,weight:style.fontWeight,fontSize:parseFloat(style.fontSize),lineHeight:parseFloat(style.lineHeight),textBoxes:boxes(range),subtitle:{fontSize:parseFloat(getComputedStyle(subtitle).fontSize),box:box(subtitle)},faces:[...document.fonts].filter(face=>face.family.replace(/^["']|["']$/gu,'')===primary&&face.weight==='800').map(face=>({weight:face.weight,status:face.status,sizeAdjust:face.sizeAdjust}))};
    });
    const bounds=selector=>box(document.querySelector(selector));
    return{rows,composition:{viewport:innerWidth,headingDisplay:headingStyle.display,headingDirection:headingStyle.flexDirection,headingGap:parseFloat(headingStyle.rowGap),heading:box(heading),overline:bounds('[data-home-title-overline]'),description:bounds('[data-public-hero-description]'),facts:bounds('#top .ah-event-meta'),actions:bounds('#top .ah-hero-actions'),hero:bounds('#top')}};
  });
  const {rows,composition}=value;
  const mobile=composition.viewport<=820;
  const expectedLatin=mobile?(composition.viewport-40)/5.45:Math.min(210,Math.max(90,composition.viewport*.117));
  const expectedInset=mobile?HERO_POSTER_LAYOUT.mobileInlinePadding:Math.min(140,Math.max(24,composition.viewport*.073));
  const expectedWrapperWidth=mobile?composition.viewport-40:Math.min(1267,composition.viewport*.66);
  const expectedWallGap=8;
  assert.equal(rows.length,2,'both poster wrappers remain direct children of the semantic h1');
  assert.deepEqual(rows.map(row=>row.key),['ggj','host']);
  assert.deepEqual(rows.map(row=>row.words.map(word=>word.text)),[['GAME JAM','GAME JAM'],['ARTDiCO HOST','ARTDiCO HOST']],'every filled group repeats its own complete words in outline');
  for(const [index,row] of rows.entries()){
    close(row.fontSize,expectedLatin*(index?HERO_POSTER_LAYOUT.hostSizeRatio:1),.01,'each group retains the approved large display size');
    close(row.wrapper.x,composition.hero.x+expectedInset,1,'the word wall retains the approved desktop inset or 20px mobile margin');
    close(row.wrapper.width,expectedWrapperWidth,1,'the word-wall wrapper retains its exact approved responsive width');
    close(row.wrapper.right,composition.hero.x+expectedInset+expectedWrapperWidth,1,'the full wrapper retains its approved right boundary');
    assert.notEqual(row.wrapperPosition,'absolute','the word wall participates in normal flow instead of retaining the former two anchors');assert.equal(row.hiddenFromSpeech,'true');
    const [solid,outline]=row.words;
    assert.equal(solid.primary,true);assert.equal(solid.repeat,false);assert.equal(outline.primary,false);assert.equal(outline.repeat,true);
    assert.ok(solid.classes.includes('ah-poster-solid')&&solid.classes.includes('ah-poster-slice'));assert.ok(outline.classes.includes('ah-poster-outline'));
    close(solid.stroke,HERO_POSTER_LAYOUT.solidStrokePixels,.01,'only the Hero solid uses the exact fine same-color stroke');assert.equal(solid.strokeColor,solid.color);
    assert.ok(outline.stroke>=HERO_POSTER_LAYOUT.minimumOutlinePixels,'the repeated words retain an actual visible outline');assert.match(outline.fill,/rgba\([^)]*,\s*0\)$/u);
    assert.equal((solid.background.match(/linear-gradient\(/gu)||[]).length,2,'two independent layers produce the color cuts');
    for(const angle of HERO_POSTER_LAYOUT.sliceAngles)assert.ok(solid.background.includes(angle+'deg'),'color cuts retain their specified diagonal angles');
    for(const stop of [34,48,59,79])assert.ok(solid.background.split(stop+'%').length>=3,'adjacent color spans retain the same stop for a hard edge');assert.deepEqual(solid.clip.split(',').map(value=>value.trim()),['text','text'],'both diagonal background layers clip to the real letters');
    close(solid.box.x,outline.box.x,1,'the two rows share a left edge');close(solid.box.right,outline.box.right,1,'the repeated words share a right edge');close(solid.box.width,outline.box.width,1,'the two rows have the same rendered width');
    close(outline.box.y,solid.box.bottom,1,'filled and outline rows form a contiguous pair');close(row.lineHeight/row.fontSize,HERO_POSTER_LAYOUT.pairLeading,.002,'the pair keeps compact Hero leading');
    assert.ok(row.subtitle.fontSize>=HERO_POSTER_LAYOUT.subtitlePixels.minimum&&row.subtitle.fontSize<=HERO_POSTER_LAYOUT.subtitlePixels.maximum&&row.subtitle.fontSize<row.fontSize,'Chinese subtitles remain readable and smaller than the Latin display');close(row.subtitle.box.y-outline.box.bottom,mobile?4:6,1,'each subtitle follows its pair with only the approved compact gap');
    close(row.subtitle.fontSize,mobile?Math.min(20,Math.max(16,composition.viewport*.026)):Math.min(28,Math.max(18,composition.viewport*.0145)),.01,'subtitle size follows its separate small display role');
    for(const word of row.words){
      assert.equal(word.word,true,'every visible repeated row participates in the native text mask');assert.equal(word.boxes.length,1,'a complete repeated group never breaks onto another line');
      close(word.scaleX,HERO_POSTER_LAYOUT.staticWidthScale,.001,'the font retains the approved small static width adjustment');close(word.scaleY,1,.001,'letterforms are not vertically stretched');assert.equal(word.animations,0,'poster words stay static');
      for(const rect of word.boxes)assert.ok(rect.x>=row.wrapper.x-1&&rect.right<=row.wrapper.right+1,'whole words fit their poster wrapper');
    }
    assert.equal(row.weight,'800');assert.equal(row.primary,'Barlow Condensed');assert.ok(row.faces.length>0);assert.ok(row.faces.some(face=>face.status===(failedFont?'error':'loaded')),'the real shipped font request reaches its expected load or fallback state');assert.ok(row.faces.every(face=>face.sizeAdjust===HERO_POSTER_LAYOUT.cssSizeAdjust),'the original display face keeps its approved CSS metrics');
    assert.ok(row.box.width>0&&row.box.height>0&&row.textBoxes.length>0,'the headline consists of rendered native letterforms');
    for(const rect of row.textBoxes)assert.ok(rect.x>=-1&&rect.right<=composition.viewport+1,'every live brand word remains inside the viewport');
  }
  assert.equal(composition.headingDisplay,'flex');assert.equal(composition.headingDirection,'column');
  close(composition.headingGap,expectedWallGap,.01,'the wall uses the approved compact group spacing');
  if(!failedFont){
    close(rows[0].words[0].box.x,rows[1].words[0].box.x,1,'the loaded native words align at the left edge across both groups');
    close(rows[0].words[0].box.right,rows[1].words[0].box.right,1,'the loaded native word groups share the same right edge');
  }
  close(rows[0].wrapper.x,rows[1].wrapper.x,1,'both groups share the word-wall left edge');close(rows[0].wrapper.right,rows[1].wrapper.right,1,'both groups share the word-wall right boundary');
  close(rows[1].wrapper.y-rows[0].wrapper.bottom,composition.headingGap,1,'only the explicit compact wall gap separates the two groups');
  close(rows[0].box.y-composition.overline.bottom,8,1,'GLOBAL sits immediately above the first pair with the approved overline gap');
  assert.ok(composition.description.y>=composition.heading.bottom-1,'published introductory copy follows the entire normal-flow word wall');
  assert.ok(composition.facts.y>=composition.description.bottom-1&&composition.facts.y>=composition.heading.bottom-1,'event facts follow both the word wall and the published copy');
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
    emptyWorksSectionHidden:true,legacyMissingFieldKeepsInitialSectionHidden:f.legacyShowcases,validLongDescriptionRecovered:f.longDescription,posterTypography:titleTypography,failedFontPaths:[...f.fontFailures],backgrounds,applicationActionInHero: true, applicationKeyboardReachable: true, actionPositions:{applicationTop:primaryBox.top,agendaTop:actionLayout.agenda.top,scope:'Hero v2 follows the complete word wall and facts; the original PNG y=1306 CTA proportion is superseded only here.'},eventFactFontPixels: { venue: venueSize, date: dateSize } };
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
