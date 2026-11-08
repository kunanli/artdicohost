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
  const originalArtwork = [];
  for (const [path, expectedSha256, width, height] of [
    ['src/assets/home/brand-ggj.png', '5fec057f899f88e3a2e75dff0fc05b15d04b0d4bcbcb46cfb5612ea0fbf8deac', 1227, 229],
    ['src/assets/home/brand-host.png', 'b6a6e36e0cf2359c24126b7c8fa0572db1688b108f238c2255cb2d25553339fc', 981, 225],
  ]) {
    const bytes = await readFile(resolve(source, path));
    assert.equal(sha(bytes), expectedSha256, 'the original supplied title artwork remains unchanged');
    assert.equal(bytes.readUInt32BE(16), width); assert.equal(bytes.readUInt32BE(20), height);
    originalArtwork.push({ path, sha256: expectedSha256, width, height });
  }

  const raw = createInitialContent();
  raw.guests = [{ id: 'scroll-motion-guest', name: '合成滚动嘉宾', company: '合成创作单位', title: '合成创作者', ggjRole: '', portraitId: '', status: 'pending', publicConsent: false, contactId: 'SYNTHETIC_PRIVATE_CONTACT', internalNotes: 'SYNTHETIC_PRIVATE_NOTE' }];
  // Match the current eight-organization composition. A single centred card
  // legitimately sits below the viewport when its distant heading first enters;
  // eight cards keep the real first row and heading visible together so the
  // unchanged simultaneous low-opacity/stagger assertions exercise both fades.
  raw.organizations = Array.from({length:8},(_,index)=>({ id:index===0?'scroll-motion-org':'scroll-motion-org-'+index,
    name:'合成参与组织'+(index||''),logoId:'',website:'',participation:'undecided',status:'pending',publicConsent:false,internalNotes:'SYNTHETIC_PRIVATE_ORG' }));
  assert.equal(raw.organizations.length,8);raw.booths = [];
  // A real published work keeps the works gutter available for its existing
  // compositing assertion. Empty collections are separately hidden by design.
  raw.showcases = [{ id: 'scroll-motion-work', kind: 'student', title: '合成滚动作品', teamName: '合成创作团队', summary: '合成公开作品说明', coverId: '', status: 'confirmed', responseStatus: 'attending', publicConsent: false, participationForms: [], boothId: '', sessionId: '', organizationId: '', school: '', email: '', wechat: '', contactName: '', memberCount: 1, materialLinks: '', internalNotes: 'SYNTHETIC_PRIVATE_WORK' }];
  raw.sessions = raw.sessions.slice(0, 1).map(item => ({ ...item, title: '合成滚动定位活动' }));
  assert.equal(validateContent(raw).valid, true, 'the synthetic publication must pass the real schema');
  const publication = toPublicContent(raw), reports = [], pageErrors = [], servedAssets = new Map(), requests = [];
  let failure = null;
  const mime = file => ({ html: 'text/html; charset=utf-8', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', avif: 'image/avif', svg: 'image/svg+xml', woff2: 'font/woff2', ico: 'image/x-icon', txt: 'text/plain' })[extname(file).slice(1)] || 'application/octet-stream';
  await mkdir(evidence, { recursive: true });
  browser = await chromium.launch({ executablePath: process.env.ARTDICO_CHROMIUM_BINARY || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  async function fixture({ viewportWidth, javaScriptEnabled = true, withoutObserver = false }) {
    const context = await browser.newContext({locale:'zh-CN', viewport: { width: viewportWidth, height: 900 }, isMobile: viewportWidth < 600, hasTouch: viewportWidth < 600, reducedMotion: withoutObserver ? 'no-preference' : 'reduce', javaScriptEnabled });
    let revision = 1, publicReads = 0, displayFontPath = null; const displayFontReads = [];
    if (javaScriptEnabled) await context.addInitScript(() => {
      // Instrument the real browser callbacks, without replacing animation time
      // or making a continuous render loop appear idle.
      const nativeFrame = requestAnimationFrame.bind(window), nativeCancel = cancelAnimationFrame.bind(window), pending = new Set();
      let currentNativeFrame = null;
      window.requestAnimationFrame = callback => { const id = nativeFrame(time => { pending.delete(id); currentNativeFrame = id; try { callback(time); } finally { completeParticleReads(id); currentNativeFrame = null; } }); pending.add(id); return id; };
      window.cancelAnimationFrame = id => { pending.delete(id); nativeCancel(id); };
      Object.defineProperty(window, '__homeMotionQaPendingFrames', { value: () => pending.size });
      const fontEvents = [];
      for (const type of ['loadingdone', 'loadingerror']) document.fonts?.addEventListener(type, event => {
        fontEvents.push({ type, at: performance.now(), faces: [...event.fontfaces].map(face => ({ family: face.family, status: face.status })) }); if (fontEvents.length > 48) fontEvents.shift();
      });
      Object.defineProperty(window, '__homeMotionQaFontEvents', { value: () => fontEvents.map(event => ({ ...event, faces: event.faces.map(face => ({ ...face })) })) });
      // Observe real canvas paint arguments without changing drawing, clocks,
      // particles or their velocity. The hero uses arc only for dot cores.
      const frames = [], reads = new Map(), results = new Map(); let clearSequence = 0, readSequence = 0;
      const nativeClear = CanvasRenderingContext2D.prototype.clearRect, nativeArc = CanvasRenderingContext2D.prototype.arc, nativeFillRect = CanvasRenderingContext2D.prototype.fillRect, nativeEllipse = CanvasRenderingContext2D.prototype.ellipse, nativeRestore = CanvasRenderingContext2D.prototype.restore;
      CanvasRenderingContext2D.prototype.clearRect = function (...args) {
        if (this.canvas.matches('[data-hero-particles]')) { frames.push({ sequence: ++clearSequence, at: performance.now(), completedAt: null, nativeFrame: null, points: [], maskRects: [], maskEllipses: [] }); if (frames.length > 120) frames.shift(); }
        return nativeClear.apply(this, args);
      };
      CanvasRenderingContext2D.prototype.arc = function (...args) {
        if (this.canvas.matches('[data-hero-particles]') && frames.length) frames.at(-1).points.push({ x: args[0], y: args[1], r: args[2] });
        return nativeArc.apply(this, args);
      };
      CanvasRenderingContext2D.prototype.fillRect = function (...args) {
        if (this.canvas.matches('[data-hero-particles]') && this.globalCompositeOperation === 'destination-out' && frames.length) frames.at(-1).maskRects.push({ x: args[0], y: args[1], width: args[2], height: args[3] });
        return nativeFillRect.apply(this, args);
      };
      CanvasRenderingContext2D.prototype.ellipse = function (...args) {
        if (this.canvas.matches('[data-hero-particles]') && this.globalCompositeOperation === 'destination-out' && frames.length) frames.at(-1).maskEllipses.push({ x: args[0], y: args[1], rx: args[2], ry: args[3], rotation: args[4] });
        return nativeEllipse.apply(this, args);
      };
      CanvasRenderingContext2D.prototype.restore = function (...args) {
        const completesMask = this.canvas.matches('[data-hero-particles]') && this.globalCompositeOperation === 'destination-out';
        const result = nativeRestore.apply(this, args);
        if (completesMask && frames.length) { frames.at(-1).completedAt = performance.now(); frames.at(-1).nativeFrame = currentNativeFrame; }
        return result;
      };
      function completeParticleReads(nativeFrame) {
        const frame = frames.at(-1);
        // A geometry/font invalidation clears the bitmap outside a full paint.
        // Sample only after the actual mask restore and native RAF callback end,
        // in this same task, before another callback or MutationObserver clears it.
        // No particle/pixel count participates: even a completed zero-dot paint
        // is sampled once and must face the unchanged visibility assertions.
        if (!frame || frame.completedAt === null || frame.nativeFrame !== nativeFrame) return;
        for (const [id, read] of reads) {
          if (frame.sequence <= read.afterClearSequence) continue;
          reads.delete(id);
          try { results.set(id, { value: read.capture({ requestedAt: read.at, clearSequenceAtRequest: read.afterClearSequence, clearOnlyAtRequest: read.clearOnlyAtRequest, clearSequence: frame.sequence, clearAt: frame.at, completedAt: frame.completedAt, sampledAt: performance.now(), nativeFrame, pendingFrames: pending.size }) }); }
          catch (error) { results.set(id, { error: error.message }); }
        }
      }
      Object.defineProperty(window, '__homeMotionQaArmParticleRead', { value: capture => { const id = ++readSequence; reads.set(id, { capture, at: performance.now(), afterClearSequence: clearSequence, clearOnlyAtRequest: Boolean(frames.length && frames.at(-1).completedAt === null) }); return id; } });
      Object.defineProperty(window, '__homeMotionQaParticleReadReady', { value: id => results.has(id) });
      Object.defineProperty(window, '__homeMotionQaTakeParticleRead', { value: id => { const result = results.get(id); results.delete(id); if (!result) throw new Error('No completed native particle paint was captured.'); if (result.error) throw new Error(result.error); return result.value; } });
      Object.defineProperty(window, '__homeMotionQaParticleFrames', { value: () => frames.map(frame => ({ sequence: frame.sequence, at: frame.at, completedAt: frame.completedAt, nativeFrame: frame.nativeFrame, points: frame.points.map(point => ({ ...point })), maskRects: frame.maskRects.map(rect => ({ ...rect })), maskEllipses: frame.maskEllipses.map(ellipse => ({ ...ellipse })) })) });
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
      if (viewportWidth === 1920 && /\/BarlowCondensed-ExtraBold\.[^/]+\.woff2$/u.test(url.pathname)) {
        displayFontPath = url.pathname; const mode = url.searchParams.get('qa-font') || 'initial-failure'; displayFontReads.push({ mode, path: url.pathname });
        if (mode !== 'late-loaded') return route.fulfill({ status: 404, contentType: 'font/woff2', body: '' });
        await new Promise(done => setTimeout(done, 250));
      }
      const path = url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname, file = resolve(dist, '.' + path);
      assert.ok(file.startsWith(dist + '/'));
      try { const bytes = await readFile(file); servedAssets.set(path, sha(bytes)); return route.fulfill({ status: 200, contentType: mime(file), body: bytes }); }
      catch { return route.fulfill({ status: 404, body: '' }); }
    });
    const page = await context.newPage(); activePage = page; page.setDefaultTimeout(12000);
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(SITE + '/', { waitUntil: 'networkidle' }); await page.evaluate(() => document.fonts.ready);
    const scrollState = () => page.evaluate(() => ({ scrollY, agendaTop: document.getElementById('agenda').getBoundingClientRect().top, headerBottom: document.querySelector('.ah-home-header').getBoundingClientRect().bottom, activeTag: document.activeElement?.tagName, activeId: document.activeElement?.id, hash: location.hash }));
    return { context, page, publicReads: () => publicReads, displayFontPath: () => displayFontPath, displayFontReads: () => [...displayFontReads], refresh: async () => { revision++; const beforeWait = await scrollState(); await page.waitForTimeout(1100); const beforeDispatch = await scrollState(); const received = page.waitForResponse(response => response.url() === API + '/api/public/content'); await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await received; const afterResponse = await scrollState(); await page.waitForTimeout(100); return { beforeWait, beforeDispatch, afterResponse, afterRender: await scrollState() }; } };
  }
  async function settled(page) { await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))); }
  async function captureFailureSignals(page) {
    const finalSignals = await page.evaluate(() => ({ mediaReduce: matchMedia('(prefers-reduced-motion: reduce)').matches, hidden: document.hidden, visibilityState: document.visibilityState, motionState: document.querySelector('#artdico-host')?.dataset.motionState, atmosphereState: document.querySelector('#artdico-host')?.dataset.atmosphereState, pendingFrames: window.__homeMotionQaPendingFrames?.(), layerHidden: document.querySelector('[data-reading-atmosphere]')?.hidden, canvasHidden: document.querySelector('[data-hero-particles]')?.hidden })).catch(() => null);
    numericMetrics = { ...numericMetrics, finalSignals };
    await page.screenshot({ path: resolve(evidence, 'failure-' + width + '.png'), fullPage: true }).catch(() => {});
  }
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
  async function factBubbleMotion(page, viewportWidth) {
    const orbit=page.locator('.ah-home-fact-orbit');
    await orbit.evaluate(node=>scrollTo({top:node.getBoundingClientRect().top+scrollY-document.querySelector('.ah-home-header').getBoundingClientRect().height-28,behavior:'instant'}));
    await page.mouse.move(viewportWidth-2,400);
    await page.waitForFunction(()=>[...document.querySelectorAll('.ah-home-fact-bubble')].every(node=>node.dataset.factMotion==='active'&&node.dataset.scrollReveal==='seen'&&!node.getAnimations().some(a=>a.id==='ah-scroll-reveal')));
    const sample=()=>page.locator('.ah-home-fact-bubble').evaluateAll(nodes=>nodes.map(node=>{const style=getComputedStyle(node),box=node.getBoundingClientRect();return {state:node.dataset.factMotion,float:parseFloat(style.getPropertyValue('--ah-fact-float'))||0,drift:parseFloat(style.getPropertyValue('--ah-fact-scroll'))||0,translate:style.translate,box:box.toJSON()};}));
    const first=await sample();await page.waitForTimeout(650);const second=await sample();
    assert.ok(second.some((item,i)=>Math.abs(item.float-first[i].float)>.35),'fact bubbles visibly float with real time and no scroll');
    const before=await page.evaluate(()=>scrollY);await page.mouse.wheel(0,100);
    await page.waitForFunction(y=>scrollY>y+30,before);await page.waitForTimeout(100);const down=await sample();
    assert.ok(down.some((item,i)=>item.drift>second[i].drift+.25),'native downward scroll adds a separate positive drift');
    const lower=await page.evaluate(()=>scrollY);await page.mouse.wheel(0,-100);
    await page.waitForFunction(y=>scrollY<y-30,lower);await page.waitForTimeout(100);const up=await sample();
    assert.ok(up.some((item,i)=>item.drift<down[i].drift-.25),'reversing the wheel reverses the drift');
    for(const values of [first,second,down,up]){
      for(const item of values){assert.ok(Math.abs(item.float+item.drift)<=(viewportWidth<=820?12.1:24.1));assert.ok(item.box.left>=-1&&item.box.right<=viewportWidth+1);}
      for(let i=0;i<values.length;i++)for(let j=i+1;j<values.length;j++){
        const a=values[i].box,b=values[j].box;
        assert.ok(Math.hypot(a.x+a.width/2-b.x-b.width/2,a.y+a.height/2-b.y-b.height/2)>=(a.width+b.width)/2-1,'moving fact circles never collide');
      }
    }
    const pixels=await particlePixels(page);assert.equal(pixels.sphereAlphaPixels,0,'background stars remain outside the complete moving fact bubbles');
    const path=resolve(evidence,'fact-bubbles-'+viewportWidth+'.png');await orbit.screenshot({path});
    await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
    await page.waitForFunction(()=>[...document.querySelectorAll('.ah-home-fact-bubble')].every(node=>node.dataset.factMotion==='paused'));
    const paused=await sample();await page.waitForTimeout(180);assert.deepEqual((await sample()).map(v=>[v.float,v.drift]),paused.map(v=>[v.float,v.drift]),'offscreen bubbles freeze both motion layers');
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.waitForFunction(()=>[...document.querySelectorAll('.ah-home-fact-bubble')].every(node=>node.dataset.factMotion==='reduced'));
    assert.ok((await sample()).every(item=>item.float===0&&item.drift===0),'reduced motion clears both offsets');
    await page.emulateMedia({reducedMotion:'no-preference'});
    await orbit.evaluate(node=>scrollTo({top:node.getBoundingClientRect().top+scrollY-110,behavior:'instant'}));
    await page.waitForFunction(()=>document.querySelector('.ah-home-fact-bubble').dataset.factMotion==='active');
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
    await page.waitForFunction(()=>document.querySelector('.ah-home-fact-bubble').dataset.factMotion==='hidden');
    const hidden=await sample();await page.waitForTimeout(150);assert.deepEqual((await sample()).map(v=>[v.float,v.drift]),hidden.map(v=>[v.float,v.drift]),'synthetic hidden-page signal freezes both layers');
    await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
    await page.waitForFunction(()=>document.querySelector('.ah-home-fact-bubble').dataset.factMotion==='active');
    await noOverflow(page);
    return {independentRealTimeFloat:true,nativeWheelBothDirections:true,boundedAndNoncolliding:true,offscreenAndHiddenPaused:true,reducedResetsAndResumes:true,sharedAtmosphereClock:true,screenshot:path};
  }

  async function noDecorativeMotion(page) {
    const value = await page.evaluate(() => ({ reveals: document.getAnimations().filter(animation => animation.id === 'ah-scroll-reveal').length,
      artwork: [...document.querySelectorAll('[data-scroll-art]')].map(node => ({ transform: getComputedStyle(node).transform, translate: getComputedStyle(node).translate })) }));
    assert.equal(value.reveals, 0, 'reduced or hidden pages have no entry animation');
    for (const item of value.artwork) assert.ok(item.transform === 'none' && ['none', '0px', '0px 0px'].includes(item.translate), 'decorative artwork returns to its static position');
    assert.equal(await page.locator('[data-reading-atmosphere]').evaluate(node => node.hidden), true, 'the complete background layer is disabled when motion is reduced or the page is hidden');
    await page.waitForFunction(() => window.__homeMotionQaPendingFrames() === 0, null, { timeout: 4000 });
    const stoppedAt = await page.evaluate(() => performance.now()); await page.waitForTimeout(150);
    assert.equal(await page.evaluate(at => window.__homeMotionQaParticleFrames().some(frame => frame.at > at && frame.points.length), stoppedAt), false, 'reduced or hidden pages paint no ambient particles');
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
  async function particlePixels(page) {
    const id = await page.locator('[data-hero-particles]').evaluate(canvas => window.__homeMotionQaArmParticleRead(paintObservation => {
      const context = canvas.getContext('2d'), pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let layerOpacity = 1; for (let node = canvas; node; node = node.parentElement) layerOpacity *= Number(getComputedStyle(node).opacity);
      const b = canvas.getBoundingClientRect(), stage = document.querySelector('.ah-home-hero-stage');
      const spheres = [...document.querySelectorAll('.ah-home-hero-planet,[data-background-planet],.ah-home-fact-bubble')].filter(node => {
        let opacity = 1; for (let parent = node; parent; parent = parent.parentElement) opacity *= Number(getComputedStyle(parent).opacity);
        return opacity > .01 && !node.closest('[hidden]');
      }).map(node => node.getBoundingClientRect()).filter(rect => rect.width > 2 && rect.height > 2);
      const title = stage.querySelector('h1'), titleRects = [...title.childNodes].flatMap(node => {
        if (node instanceof Element) return [node.getBoundingClientRect()];
        if (node.nodeType !== Node.TEXT_NODE) return [];
        const range = document.createRange(); range.selectNodeContents(node); return [...range.getClientRects()];
      });
      for (const node of title.querySelectorAll('[data-poster-word],[data-home-title-subtitle]')) {
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT); let text;
        while ((text = walker.nextNode())) if (text.textContent.trim()) { const range = document.createRange(); range.selectNodeContents(text); titleRects.push(...range.getClientRects()); }
      }
      const readable = [...titleRects, ...[...document.querySelectorAll('#artdico-host h2,#artdico-host h3,#artdico-host p,#artdico-host label,#artdico-host a,#artdico-host button,#artdico-host input,#artdico-host select,#artdico-host textarea,#artdico-host summary')].map(node => node.getBoundingClientRect())].filter(rect => rect.width > 2 && rect.height > 2 && rect.bottom > b.top && rect.top < b.bottom && rect.right > b.left && rect.left < b.right);
      const headerBottom = document.querySelector('.ah-home-header').getBoundingClientRect().bottom, bright = new Uint8Array(canvas.width * canvas.height);
      let brightPixels = 0, centralBrightPixels = 0, signature = 0, sphereAlphaPixels = 0, readableAlphaPixels = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const alpha = pixels[i + 3], index = i / 4, x = b.left + (index % canvas.width + .5) / canvas.width * b.width, y = b.top + (Math.floor(index / canvas.width) + .5) / canvas.height * b.height;
        if (alpha >= 96 && Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) >= 150 && x >= 0 && x < innerWidth && y >= headerBottom && y < innerHeight) { brightPixels++; bright[index] = 1; if (x > innerWidth * .2 && x < innerWidth * .8) centralBrightPixels++; }
        // Check every nontransparent pixel, not just the brighter perceptibility
        // sample. The inset avoids interpreting antialias at a silhouette edge.
        if (alpha) {
          if (spheres.some(ball => ((x - ball.left - ball.width / 2) / (ball.width / 2 - 1)) ** 2 + ((y - ball.top - ball.height / 2) / (ball.height / 2 - 1)) ** 2 < 1)) sphereAlphaPixels++;
          if (readable.some(rect => x > rect.left + 1 && x < rect.right - 1 && y > rect.top + 1 && y < rect.bottom - 1)) readableAlphaPixels++;
        }
        if (alpha) signature = (signature + Math.imul(i / 4 + 1, alpha)) >>> 0;
      }
      const components = [];
      for (let start = 0; start < bright.length; start++) if (bright[start]) {
        const queue = [start]; bright[start] = 0; let sumX = 0, sumY = 0, count = 0;
        for (let next = 0; next < queue.length; next++) {
          const index = queue[next], x = index % canvas.width, y = Math.floor(index / canvas.width); sumX += x; sumY += y; count++;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const px = x + dx, py = y + dy, adjacent = py * canvas.width + px;
            if (px >= 0 && px < canvas.width && py >= 0 && py < canvas.height && bright[adjacent]) { bright[adjacent] = 0; queue.push(adjacent); }
          }
        }
        components.push({ x: (sumX / count + .5) / canvas.width * b.width, y: (sumY / count + .5) / canvas.height * b.height, pixels: count });
      }
      const occupiedRegions = new Set(components.map(point => Math.min(2, Math.floor(point.x / b.width * 3)) + ',' + Math.min(2, Math.floor(point.y / b.height * 3)))).size;
      return { brightPixels, centralBrightPixels, visibleComponents: components.length, occupiedRegions, sphereAlphaPixels, readableAlphaPixels, signature, layerOpacity, bitmapWidth: canvas.width, bitmapHeight: canvas.height, cssWidth: b.width, cssHeight: b.height, mode: canvas.dataset.heroParticleMode, inFixedBackgroundLayer: Boolean(canvas.closest('[data-reading-atmosphere]')), paintObservation };
    }));
    // The pixel read already ran synchronously at the first complete native
    // paint. This wait only retrieves that immutable result under the existing
    // default timeout; it never polls brightness or asks the renderer to repaint.
    await page.waitForFunction(id => window.__homeMotionQaParticleReadReady(id), id, { polling: 50 });
    return page.evaluate(id => window.__homeMotionQaTakeParticleRead(id), id);
  }
  async function backgroundPointerForce(page) {
    // Park the real pointer away from the sampled core's force radius before
    // estimating its natural drift. Do not change the renderer or its clock.
    await page.mouse.move(10, 10);
    await page.waitForTimeout(220);
    const sample = await page.evaluate(() => {
      const frames = window.__homeMotionQaParticleFrames().filter(frame => frame.maskRects.length || frame.maskEllipses.length), last = frames.at(-1), previous = frames.findLast(frame => last.at - frame.at >= 180);
      if (!last || !previous) return null;
      const box = document.querySelector('[data-hero-particles]').getBoundingClientRect(), baseline = frames.filter(frame => frame.at >= previous.at), epsilon = 1e-7;
      const clear = (x, y, padding = 24) => x >= 20 && x <= box.width - 20 && y >= 20 && y <= box.height - 20
        && !last.maskRects.some(rect => x >= rect.x - padding && x <= rect.x + rect.width + padding && y >= rect.y - padding && y <= rect.y + rect.height + padding)
        && !last.maskEllipses.some(ellipse => { const dx = x - ellipse.x, dy = y - ellipse.y, cos = Math.cos(ellipse.rotation), sin = Math.sin(ellipse.rotation); return ((dx * cos + dy * sin) / (ellipse.rx + 40)) ** 2 + ((dy * cos - dx * sin) / (ellipse.ry + 40)) ** 2 <= 1; });
      for (const point of last.points) {
        if (point.x < 60 || point.x > box.width - 60 || point.y < 60 || point.y > box.height - 60 || Math.hypot(box.left + point.x - 10, box.top + point.y - 10) <= 240 || !clear(point.x, point.y)) continue;
        // Native core radius is immutable in this fixed viewport. Require it
        // to be unique in every observed frame instead of assuming array order
        // remains stable when production legitimately skips masked particles.
        const track = baseline.map(frame => ({ at: frame.at, points: frame.points, matches: frame.points.filter(other => Math.abs(other.r - point.r) < epsilon) }));
        if (track.some(frame => frame.matches.length !== 1)) continue;
        if (track.some(frame => frame.points.some(other => other !== frame.matches[0] && Math.hypot(other.x - frame.matches[0].x, other.y - frame.matches[0].y) < 25))) continue;
        if (track.slice(1).some((frame, index) => Math.hypot(frame.matches[0].x - track[index].matches[0].x, frame.matches[0].y - track[index].matches[0].y) > (frame.at - track[index].at) / 1000 * 20 + .25)) continue;
        const start = track[0].matches[0], seconds = (last.at - previous.at) / 1000, vx = (point.x - start.x) / seconds, vy = (point.y - start.y) / seconds;
        for (const [dx, dy] of [[45, 0], [-45, 0], [0, 45], [0, -45]]) {
          const x = point.x + dx, y = point.y + dy;
          if (!clear(x, y, 4) || ![0, .5, 1].every(fraction => clear(point.x + fraction * (vx * .8 + dx / 45 * 8), point.y + fraction * (vy * .8 + dy / 45 * 8), 20))) continue;
          return { point, at: last.at, vx, vy, baselinePaints: track.length, clearancePx: 24, sphereClearancePx: 40, pointer: { x: box.left + x, y: box.top + y }, direction: { x: dx / 45, y: dy / 45 } };
        }
      }
      return null;
    });
    assert.ok(sample, 'a real freely drawn background dot is available for a local pointer-force observation');
    await page.mouse.move(sample.pointer.x, sample.pointer.y); await page.waitForTimeout(550);
    const result = await page.evaluate(sample => {
      const frames = window.__homeMotionQaParticleFrames().filter(frame => frame.at >= sample.at && (frame.maskRects.length || frame.maskEllipses.length)), epsilon = 1e-7;
      let previous = { at: sample.at, point: sample.point };
      for (const frame of frames) {
        const matches = frame.points.filter(point => Math.abs(point.r - sample.point.r) < epsilon);
        if (matches.length !== 1) return { validTrack: false, reason: matches.length ? 'AMBIGUOUS_NATIVE_CORE' : 'MISSING_NATIVE_CORE', at: frame.at, coreRadius: sample.point.r, matches: matches.length };
        const point = matches[0], step = Math.hypot(point.x - previous.point.x, point.y - previous.point.y), maximumStep = (frame.at - previous.at) / 1000 * 20 + .25;
        if (step > maximumStep) return { validTrack: false, reason: 'DISCONTINUOUS_NATIVE_CORE', at: frame.at, coreRadius: sample.point.r, step, maximumStep };
        previous = { at: frame.at, point };
      }
      const last = frames.at(-1), point = previous.point, seconds = (last.at - sample.at) / 1000;
      const predicted = { x: sample.point.x + sample.vx * seconds, y: sample.point.y + sample.vy * seconds };
      const delta = { x: point.x - predicted.x, y: point.y - predicted.y };
      return { validTrack: true, elapsedMs: last.at - sample.at, extraTowardPointer: delta.x * sample.direction.x + delta.y * sample.direction.y, extraDistance: Math.hypot(delta.x, delta.y), naturalSpeed: Math.hypot(sample.vx, sample.vy), coreRadius: sample.point.r, baselinePaints: sample.baselinePaints, trackedPaints: frames.length, clearancePx: sample.clearancePx, sphereClearancePx: sample.sphereClearancePx, nativePaintArcObserved: true };
    }, sample);
    numericMetrics = { backgroundPointerForce: result };
    assert.equal(result.validTrack, true, 'the same unique native core remains visible and continuous in every real painted frame');
    assert.ok(result.extraTowardPointer > 1.5 && result.extraDistance < 20, 'the real painted dot responds locally and gently beyond its measured natural drift');
    return result;
  }
  async function posterGeometry(page) {
    return page.evaluate(() => {
      const heading = document.getElementById('hero-heading'), box = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
      const ranges = node => { const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT), result = []; let text; while ((text = walker.nextNode())) if (text.textContent.trim()) { const range = document.createRange(); range.selectNodeContents(text); for (const r of range.getClientRects()) result.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }); } return result; };
      const marker = node => ({ tag: node.tagName, type: node.getAttribute('data-home-title-type'), word: node.hasAttribute('data-poster-word'), primary: node.hasAttribute('data-poster-primary'), repeat: node.hasAttribute('data-poster-repeat'), overline: node.hasAttribute('data-home-title-overline'), subtitle: node.hasAttribute('data-home-title-subtitle') });
      const gradientLayers = background => { const layers = []; let depth = 0, start = 0; for (let index = 0; index < background.length; index++) { if (background[index] === '(') depth++; else if (background[index] === ')') depth--; else if (background[index] === ',' && depth === 0) { layers.push(background.slice(start, index).trim()); start = index + 1; } } layers.push(background.slice(start).trim()); return layers.map(layer => ({ angle: Number(/^linear-gradient\(([-\d.]+)deg,/u.exec(layer)?.[1]), stops: [...layer.matchAll(/([\d.]+)%/gu)].map(match => Number(match[1])) })); };
      const inspect = node => { const style = getComputedStyle(node), matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform); return { ...marker(node), text: node.textContent.trim().replace(/\s+/gu, ' '), classes: [...node.classList], children: [...node.children].map(marker), directTextNodes: [...node.childNodes].filter(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim()).length, parentType: node.parentElement.getAttribute('data-home-title-type'), family: style.fontFamily, weight: Number(style.fontWeight), fontSize: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight), transformIdentity: matrix.isIdentity, color: style.color, fill: style.webkitTextFillColor, stroke: parseFloat(style.webkitTextStrokeWidth), strokeColor: style.webkitTextStrokeColor, clip: style.webkitBackgroundClip, background: style.backgroundImage, gradients: gradientLayers(style.backgroundImage), display: style.display, visibility: style.visibility, position: style.position, box: box(node), ranges: ranges(node), overflowX: style.overflowX, overflowY: style.overflowY, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }; };
      return { at: performance.now(), viewport: innerWidth, headerBottom: document.querySelector('.ah-home-header').getBoundingClientRect().bottom, heading: { label: heading.getAttribute('aria-label'), hidden: Boolean(heading.closest('[aria-hidden=true]')), count: document.querySelectorAll('h1').length, imageCount: heading.querySelectorAll('[data-home-title-image]').length, children: [...heading.children].map(inspect), repeatCount: heading.querySelectorAll('[data-poster-repeat]').length }, images: [...heading.querySelectorAll('[data-home-title-image]')].map(node => ({ role: node.dataset.homeTitleImage, src: node.currentSrc, complete: node.complete, naturalWidth: node.naturalWidth, naturalHeight: node.naturalHeight, hidden: node.hidden, box: box(node), wrapper: box(node.parentElement), fallbackHidden: node.parentElement.querySelector('[data-home-title-fallback]').hidden })), rows: [...heading.querySelectorAll('[data-home-title-type]')].map(inspect), words: [...heading.querySelectorAll('[data-poster-word]')].map(inspect), overlines: [...heading.querySelectorAll('[data-home-title-overline]')].map(inspect), subtitles: [...heading.querySelectorAll('[data-home-title-subtitle]')].map(inspect), footer: [...document.querySelectorAll('[data-footer-display-line]')].map(inspect), strokeSupported: CSS.supports('-webkit-text-stroke', '1px #fff'), clipSupported: CSS.supports('background-clip', 'text') || CSS.supports('-webkit-background-clip', 'text'), faces: [...document.fonts].filter(face => face.family.includes('Barlow Condensed')).map(face => ({ family: face.family, status: face.status, weight: face.weight, style: face.style, stretch: face.stretch, display: face.display, sizeAdjust: face.sizeAdjust })) };
    });
  }
  async function posterTitle(page, { fontFailure = false } = {}) {
    const value = await posterGeometry(page); numericMetrics = { posterTitle: value };
    assert.equal(value.heading.count, 1); assert.equal(value.heading.hidden, false);
    assert.match(value.heading.label, /Global\s*Game\s*Jam|GlobalGameJam/iu); assert.match(value.heading.label, /ARTDiCO HOST/u);
    assert.equal(value.heading.imageCount, 2, 'both exact supplied title artworks are restored');
    assert.equal(value.heading.children.length, 2); assert.equal(value.heading.repeatCount, 0);
    assert.equal(value.rows.length, 0); assert.equal(value.words.length, 0); assert.equal(value.overlines.length, 0);
    assert.deepEqual(value.images.map(image => image.role), ['ggj', 'host']);
    for (const [index, image] of value.images.entries()) {
      assert.equal(image.complete, true); assert.equal(image.hidden, false); assert.equal(image.fallbackHidden, true);
      assert.equal(image.naturalWidth, index === 0 ? 1227 : 981); assert.equal(image.naturalHeight, index === 0 ? 229 : 225);
      const expectedWidth = value.viewport * (value.viewport <= 820 ? index === 0 ? .94 : .82 : index === 0 ? .6391 : .511);
      assert.ok(Math.abs(image.box.width - expectedWidth) <= 1, 'original title artwork retains its independently measured width');
      assert.ok(Math.abs(image.box.height / image.box.width - image.naturalHeight / image.naturalWidth) < .001, 'original title artwork retains its aspect ratio');
      assert.ok(image.box.left >= -1 && image.box.right <= value.viewport + 1 && image.box.top >= value.headerBottom - 1, 'the full original title artwork remains inside the readable canvas');
      assert.equal(value.heading.children[index].position, 'absolute');
      if (index === 0) assert.ok(Math.abs(image.box.left) <= 1, 'the first original title aligns with the left canvas edge');
      else assert.ok(Math.abs(image.box.right - value.viewport) <= 1, 'the second original title aligns with the right canvas edge');
      assert.equal(value.heading.children[index].background, 'none', 'no replacement diagonal gradient or repeated outline overlays the original');
    }
    assert.ok(value.images[1].box.top > value.images[0].box.bottom + 20, 'the original two events have distinct vertical positions');
    assert.ok(value.faces.length > 0); for (const face of value.faces) assert.equal(face.sizeAdjust, '140%', 'the unrelated footer keeps its licensed display metrics');
    assert.equal(value.faces.some(face => face.status === (fontFailure ? 'error' : 'loaded')), true, 'the footer font load state remains observed');
    assert.equal(value.footer.length, 2); for (const line of value.footer) assert.ok(line.family.includes('Barlow Condensed') && line.weight >= 800);
    if (value.strokeSupported) assert.ok(value.footer[1].stroke >= 1, 'the footer outline retains its own actual display role');
    return value;
  }
  async function originalArtworkFallback(page) {
    const reports = [];
    for (const role of ['ggj', 'host']) {
      const selector = '[data-home-title-image="' + role + '"]';
      const originalSrc = await page.locator(selector).getAttribute('src');
      await page.locator(selector).evaluate((image, role) => {
        // The second test replaces the DOM node just as a public refresh does;
        // delegated image-error handling must still expose the real fallback.
        if (role === 'host') { const clone = image.cloneNode(false); image.replaceWith(clone); image = clone; }
        image.src = '/__synthetic_missing_title_' + role + '.png';
      }, role);
      await page.waitForFunction(selector => { const image = document.querySelector(selector), fallback = image.parentElement.querySelector('[data-home-title-fallback]'); return image.complete && image.naturalWidth === 0 && image.hidden && !fallback.hidden; }, selector);
      const fallback = await page.locator(selector).evaluate(image => {
        const node = image.parentElement.querySelector('[data-home-title-fallback]'), style = getComputedStyle(node), ranges = [...node.children].flatMap(child => { const range = document.createRange(); range.selectNodeContents(child); return [...range.getClientRects()].map(rect => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height })); });
        return { text: node.textContent.replace(/\s+/gu, ' ').trim(), visible: style.display !== 'none', overflowX: style.overflowX, overflowY: style.overflowY, viewport: innerWidth, ranges };
      });
      assert.equal(fallback.visible, true); assert.match(fallback.text, role === 'ggj' ? /GLOBAL GAME JAM.*中国组织者交流会/u : /ARTDiCO HOST.*嘉年华/u);
      assert.ok(fallback.ranges.length >= 2 && fallback.ranges.every(rect => rect.width > 0 && rect.height > 0 && rect.left >= -1 && rect.right <= fallback.viewport + 1), 'actual failed-image fallback remains readable without horizontal clipping');
      assert.equal(['auto', 'scroll'].includes(fallback.overflowX) || ['auto', 'scroll'].includes(fallback.overflowY), false);
      await page.screenshot({ path: resolve(evidence, 'hero-original-fallback-' + role + '-' + width + '.png') });
      await page.locator(selector).evaluate((image, src) => { image.src = src; }, originalSrc);
      await page.waitForFunction(selector => { const image = document.querySelector(selector), fallback = image.parentElement.querySelector('[data-home-title-fallback]'); return image.complete && image.naturalWidth > 0 && !image.hidden && fallback.hidden; }, selector);
      reports.push({ role, cloneReplacement: role === 'host', readableFallback: true, actualArtworkRestored: true });
    }
    return reports;
  }
  async function typedMaskAfter(page, since) {
    const observation = await page.waitForFunction(since => {
      const canvas = document.querySelector('[data-hero-particles]').getBoundingClientRect(), frame = window.__homeMotionQaParticleFrames().find(frame => frame.at > since && frame.completedAt !== null && frame.maskRects.length);
      if (!frame) return false;
      const nodes = [...document.querySelectorAll('#hero-heading .ah-home-title-art')];
      if (nodes.length !== 2) return false;
      const targets = nodes.map((node, index) => {
        const rect = node.getBoundingClientRect();
        const visible = { left: Math.max(rect.left, canvas.left), right: Math.min(rect.right, canvas.right), top: Math.max(rect.top, canvas.top), bottom: Math.min(rect.bottom, canvas.bottom) };
        const visibleRanges = Number(visible.right > visible.left && visible.bottom > visible.top);
        const fullyVisibleRanges = Number(visibleRanges && rect.left >= canvas.left - .1 && rect.right <= canvas.right + .1 && rect.top >= canvas.top && rect.bottom <= canvas.bottom);
        const maskedRanges = Number(visibleRanges && frame.maskRects.some(mask => mask.x <= visible.left - canvas.left - 1 && mask.y <= visible.top - canvas.top - 1 && mask.x + mask.width >= visible.right - canvas.left + 1 && mask.y + mask.height >= visible.bottom - canvas.top + 1));
        return { index, role: 'original-artwork', group: index === 0 ? 'ggj' : 'host', ranges: Number(rect.width > 0 && rect.height > 0), visibleRanges, fullyVisibleRanges, maskedRanges };
      });
      if (!targets.every(target => target.ranges > 0 && target.visibleRanges === target.maskedRanges) || !targets.some(target => target.visibleRanges > 0)) return false;
      // Return the evidence from this same task: no second geometry read can
      // substitute a different paint or scroll position for the checked one.
      return { eventAt: since, sampledAt: performance.now(), scrollY, firstMaskPaintAt: frame.at, completedAt: frame.completedAt, nativeFrame: frame.nativeFrame, rectangles: frame.maskRects.length, targets };
    }, since);
    try { return await observation.jsonValue(); } finally { await observation.dispose(); }
  }
  async function posterMaskSweep(page, initial) {
    const startY = await page.evaluate(() => scrollY), covered = new Map(), steps = [];
    const include = mask => { for (const target of mask.targets) if (target.ranges > 0 && target.fullyVisibleRanges === target.ranges && target.maskedRanges === target.ranges) covered.set(target.index, target); };
    include(initial);
    const geometry = index => page.evaluate(index => {
      const canvas = document.querySelector('[data-hero-particles]').getBoundingClientRect(), node = document.querySelectorAll('#hero-heading .ah-home-title-art')[index], rects = node ? [node.getBoundingClientRect()] : [];
      return { scrollY, canvasTop: canvas.top, canvasBottom: canvas.bottom, top: rects.length ? Math.min(...rects.map(rect => rect.top)) : null, bottom: rects.length ? Math.max(...rects.map(rect => rect.bottom)) : null, fullyVisible: rects.length > 0 && rects.every(rect => rect.left >= canvas.left - .1 && rect.right <= canvas.right + .1 && rect.top >= canvas.top && rect.bottom <= canvas.bottom) };
    }, index);
    const settleWheel = async (index, expectedY = null) => {
      const deadline = Date.now() + 4000; let lastY = null, stableAt = Date.now(), final;
      while (Date.now() < deadline) {
        final = await geometry(index);
        if (lastY === null || Math.abs(final.scrollY - lastY) > .5) stableAt = Date.now(); lastY = final.scrollY;
        if ((expectedY === null ? final.fullyVisible : Math.abs(final.scrollY - expectedY) <= 1) && Date.now() - stableAt >= 100) return final;
        await page.waitForTimeout(50);
      }
      numericMetrics = { posterMaskWheel: { index, expectedY, final } };
      assert.fail('native wheel must expose the complete real title Range and restore the original reading position');
    };
    for (let index = 0; index < initial.targets.length; index++) {
      if (covered.has(index)) continue;
      const before = await geometry(index); assert.ok(before.top !== null && before.bottom !== null);
      const delta = (before.top + before.bottom - before.canvasTop - before.canvasBottom) / 2;
      await page.mouse.wheel(0, delta); const landed = await settleWheel(index);
      const since = await page.evaluate(() => performance.now()), mask = await typedMaskAfter(page, since), pixels = await particlePixels(page);
      assert.equal(pixels.readableAlphaPixels, 0, 'newly exposed native title Ranges contain no actual star alpha'); assert.equal(pixels.sphereAlphaPixels, 0, 'the same completed paint keeps sphere pixels clear during native title scrolling');
      include(mask); assert.equal(covered.has(index), true, 'each initially clipped title target receives its own fully visible Range-mask observation');
      steps.push({ index, nativeWheelDelta: delta, scrollY: landed.scrollY, mask, readableAlphaPixels: pixels.readableAlphaPixels, sphereAlphaPixels: pixels.sphereAlphaPixels });
    }
    assert.equal(covered.size, 2, 'both original title artworks, including their Chinese subtitles, are fully visible and masked across the native-wheel sweep');
    let restoredMask = initial;
    if (steps.length) {
      await page.mouse.wheel(0, startY - await page.evaluate(() => scrollY)); await settleWheel(0, startY);
      restoredMask = await typedMaskAfter(page, await page.evaluate(() => performance.now()));
    }
    return { initialScrollY: startY, restoredScrollY: await page.evaluate(() => scrollY), nativeWheelSteps: steps, coveredTargets: [...covered.values()].sort((a, b) => a.index - b.index), restoredMask };
  }
  async function lateTitleFonts(page, f) {
    const path = f.displayFontPath(); assert.ok(path, 'the actual compiled display-font request was intercepted');
    const before = await posterTitle(page, { fontFailure: true }), original = before.faces.find(face => face.status === 'error');
    await page.screenshot({ path: resolve(evidence, 'hero-font-fallback-' + width + '.png') });
    const load = async mode => page.evaluate(async ({ path, mode, original }) => {
      const startedAt = performance.now(), descriptors = { weight: original.weight, style: original.style, stretch: original.stretch, display: original.display };
      if (original.sizeAdjust) descriptors.sizeAdjust = original.sizeAdjust;
      const face = new FontFace(original.family, 'url("' + path + '?qa-font=' + mode + '")', descriptors); document.fonts.add(face); let rejected = false;
      try { await face.load(); } catch { rejected = true; } await document.fonts.ready;
      return { startedAt, completedAt: performance.now(), status: face.status, rejected, family: face.family, sizeAdjust: face.sizeAdjust };
    }, { path, mode, original });
    const failed = await load('late-error'); assert.equal(failed.status, 'error'); assert.equal(failed.rejected, true);
    await page.waitForFunction(start => window.__homeMotionQaFontEvents().some(event => event.at >= start && event.type === 'loadingerror'), failed.startedAt);
    const errorEvent = await page.evaluate(start => window.__homeMotionQaFontEvents().find(event => event.at >= start && event.type === 'loadingerror'), failed.startedAt), errorMask = await typedMaskAfter(page, errorEvent.at);
    const failurePixels = await particlePixels(page); assert.equal(failurePixels.readableAlphaPixels + failurePixels.sphereAlphaPixels, 0, 'real late font failure leaves fallback text and sphere clear of star alpha');
    await page.screenshot({ path: resolve(evidence, 'hero-late-font-error-' + width + '.png') });
    const errorMaskSweep = await posterMaskSweep(page, errorMask);
    const loaded = await load('late-loaded'); assert.equal(loaded.status, 'loaded'); assert.equal(loaded.rejected, false); assert.equal(loaded.sizeAdjust, original.sizeAdjust, 'late native retry uses the actual shipped face metrics');
    await page.waitForFunction(start => window.__homeMotionQaFontEvents().some(event => event.at >= start && event.type === 'loadingdone'), loaded.startedAt);
    const doneEvent = await page.evaluate(start => window.__homeMotionQaFontEvents().find(event => event.at >= start && event.type === 'loadingdone'), loaded.startedAt), loadedMask = await typedMaskAfter(page, doneEvent.at), after = await posterTitle(page);
    const changed = after.footer.some((line, index) => line.ranges.length !== before.footer[index].ranges.length || line.ranges.some((rect, part) => Math.abs(rect.width - (before.footer[index].ranges[part]?.width ?? 0)) > 1 || Math.abs(rect.height - (before.footer[index].ranges[part]?.height ?? 0)) > 1));
    numericMetrics = { lateTitleFonts: { failed, loaded, before, after, errorMask, loadedMask, changed } };
    assert.equal(changed, true, 'the native shipped font actually replaces fallback footer glyph metrics');
    for (const [index, artwork] of after.images.entries()) assert.deepEqual(artwork.box, before.images[index].box, 'late display fonts cannot change the original Hero artwork geometry');
    const pixels = await particlePixels(page); assert.ok(pixels.brightPixels >= 15 && pixels.visibleComponents >= 6 && pixels.occupiedRegions >= 3, 'the loaded title retains the original visible star-field threshold'); assert.equal(pixels.readableAlphaPixels, 0, 'actual new glyph Ranges remain free of star alpha after late font reflow'); assert.equal(pixels.sphereAlphaPixels, 0);
    await page.screenshot({ path: resolve(evidence, 'hero-active-' + width + '.png') }); await page.screenshot({ path: resolve(evidence, 'hero-late-font-loaded-' + width + '.png') });
    const loadedMaskSweep = await posterMaskSweep(page, loadedMask);
    return { realFontRequests: f.displayFontReads(), failed, loaded, errorEvent, doneEvent, errorMask, loadedMask, errorMaskSweep, loadedMaskSweep, nativeGlyphMetricsChanged: changed, before, after, readableAlphaPixels: pixels.readableAlphaPixels, sphereAlphaPixels: pixels.sphereAlphaPixels };
  }
  async function backgroundPlanet(page) {
    return page.locator('[data-background-planet]').evaluate(node => {
      const box = node.getBoundingClientRect(), layer = node.closest('[data-reading-atmosphere]'); let opacity = 1;
      for (let parent = node; parent; parent = parent.parentElement) opacity *= Number(getComputedStyle(parent).opacity);
      return { x: box.x, y: box.y, width: box.width, height: box.height, opacity, fixedLayer: getComputedStyle(layer).position, layerHidden: layer.hidden, viewportHeight: innerHeight, viewportWidth: innerWidth };
    });
  }
  async function ambientPaintBudget(page) {
    // Allow prior navigation and entrance work to finish before measuring the
    // deliberately continuous background. Native time and RAF stay untouched.
    await page.waitForTimeout(1000);
    const first = await particlePixels(page), start = await page.evaluate(() => ({ at: performance.now(), pending: window.__homeMotionQaPendingFrames() })), pending = [start.pending];
    for (let sample = 0; sample < 6; sample++) { await page.waitForTimeout(200); pending.push(await page.evaluate(() => window.__homeMotionQaPendingFrames())); }
    const painted = await page.evaluate(start => {
      const end = performance.now(), canvas = document.querySelector('[data-hero-particles]'), box = canvas.getBoundingClientRect(), header = document.querySelector('.ah-home-header').getBoundingClientRect();
      const frames = window.__homeMotionQaParticleFrames().filter(frame => frame.at >= start && frame.at <= end && frame.points.length);
      return { elapsedMs: end - start, paints: frames.length, uniquePaintTimes: new Set(frames.map(frame => frame.at)).size, bitmapWidth: canvas.width, bitmapHeight: canvas.height, cssWidth: box.width, cssHeight: box.height, left: box.left, top: box.top, right: box.right, bottom: box.bottom, headerBottom: header.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight, compact: matchMedia('(max-width:820px)').matches };
    }, start.at);
    const second = await particlePixels(page), limit = painted.compact ? 16 : 30;
    numericMetrics = { ambientPaintBudget: { ...painted, pending, first, second, limit } };
    assert.ok(painted.paints >= 3, 'background stars keep actually painting while the original hero is offscreen');
    assert.ok(painted.paints <= Math.floor(painted.elapsedMs / 1000 * limit) + 1, 'native canvas paints remain within the agreed desktop/mobile frame budget');
    assert.equal(painted.uniquePaintTimes, painted.paints); assert.ok(Math.max(...pending) <= 1, 'the settled page keeps at most one real ambient RAF callback');
    assert.ok(painted.bitmapWidth >= 1 && painted.bitmapHeight >= 1 && painted.bitmapWidth <= 1600 && painted.bitmapHeight <= 1600 && painted.bitmapWidth * painted.bitmapHeight <= 1600000, 'the full-page background has bounded bitmap axes and area');
    assert.ok(painted.bitmapWidth <= Math.ceil(painted.cssWidth * 1.25) && painted.bitmapHeight <= Math.ceil(painted.cssHeight * 1.25), 'background bitmap density stays below the bounded DPR');
    assert.ok(painted.left >= -1 && painted.right <= painted.viewportWidth + 1 && painted.cssWidth >= painted.viewportWidth - 1 && painted.top >= painted.headerBottom - 1 && painted.bottom <= painted.viewportHeight + 1, 'the single background canvas spans the viewport below the pinned header');
    assert.notEqual(first.signature, second.signature, 'the full-page star field changes actual pixels over native time');
    assert.ok(first.centralBrightPixels > 0 && second.centralBrightPixels > 0, 'stars continue through open central background rather than only the page edges');
    assert.equal(first.sphereAlphaPixels + second.sphereAlphaPixels + first.readableAlphaPixels + second.readableAlphaPixels, 0, 'the distant sphere and readable foreground remain free of star alpha');
    return { ...painted, limit, pending, visiblePixels: [first, second] };
  }
  async function backgroundCompositing(page) {
    const reports = [];
    for (const id of ['agenda', 'students', 'registration']) {
      await page.locator('#' + id).evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' })); await settled(page); await page.waitForTimeout(1000);
      const sample = await page.evaluate(id => {
        const section = document.getElementById(id), rect = section.getBoundingClientRect(), canvas = document.querySelector('[data-hero-particles]').getBoundingClientRect();
        const x = Math.min(innerWidth - 2, Math.max(2, rect.left + 8)), y = Math.min(innerHeight - 20, Math.max(canvas.top + 20, rect.top + 20)), hit = document.elementFromPoint(x, y);
        const scratch = document.createElement('canvas'); scratch.width = 1; scratch.height = 1; const context = scratch.getContext('2d');
        const alpha = color => { context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return context.getImageData(0, 0, 1, 1).data[3] / 255; };
        const layers = []; let transmission = 1;
        for (let node = hit; node && node !== document.body; node = node.parentElement) {
          const style = getComputedStyle(node), colors = style.backgroundImage.match(/rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}\b|\btransparent\b/gu) || [];
          const gradientAlpha = style.backgroundImage === 'none' ? 0 : colors.length && !style.backgroundImage.includes('url(') ? Math.max(...colors.map(alpha)) : 1;
          const backgroundAlpha = 1 - (1 - alpha(style.backgroundColor)) * (1 - gradientAlpha), effectiveAlpha = backgroundAlpha * Number(style.opacity);
          layers.push({ id: node.id || null, colorAlpha: alpha(style.backgroundColor), gradientAlpha, effectiveAlpha }); transmission *= 1 - effectiveAlpha;
          if (node.id === 'artdico-host') break;
        }
        return { section: id, x, y, insideSection: Boolean(hit && section.contains(hit)), outsideProtectedSurface: !hit?.closest('.ah-register-card,.ah-registration-card,.ah-showcase-card,.ah-work-stage,.ah-admin-panel,form,input,textarea,select,button,a,summary'), reachesRoot: layers.at(-1)?.id === 'artdico-host', transmission, layers };
      }, id);
      numericMetrics = { backgroundCompositing: sample };
      assert.equal(sample.insideSection, true); assert.equal(sample.outsideProtectedSurface, true, 'compositing is sampled in open background, preserving solid cards and form surfaces'); assert.equal(sample.reachesRoot, true);
      assert.ok(sample.layers.every(layer => layer.effectiveAlpha < .999), 'no opaque foreground ancestor blocks the fixed background in an open section gutter');
      assert.ok(sample.transmission >= .4, 'outer section backgrounds transmit the visible star field and distant sphere');
      const planet = await backgroundPlanet(page); assert.ok(planet.opacity > .01 && !planet.layerHidden);
      await page.screenshot({ path: resolve(evidence, 'background-composite-' + id + '-' + width + '.png') }); reports.push({ ...sample, planet });
    }
    return reports;
  }
  async function fadeSequence(page, title, body, label, { screenshots = false, focusCancellation = false } = {}) {
    const selectors = { title, body };
    await page.evaluate(({ title, body }) => {
      const a = document.querySelector(title).getBoundingClientRect(), nav = document.querySelector('.ah-home-header').getBoundingClientRect();
      // Align the title below the pinned header. Centering a short section can
      // also expose its previous neighbour and consume that neighbour's fade.
      scrollTo({ top: Math.max(0, a.top + scrollY - nav.bottom - 24), behavior: 'instant' });
    }, selectors);
    const sample = async phase => {
      const value = await page.evaluate(({ title, body }) => {
        const inspect = selector => { const node = document.querySelector(selector), entry = node.getAnimations().find(animation => animation.id === 'ah-scroll-reveal'), box = node.getBoundingClientRect(); return { opacity: Number(getComputedStyle(node).opacity), phase: node.dataset.scrollPhase, mode: node.dataset.scrollMode, reveal: node.dataset.scrollReveal, top: box.top, bottom: box.bottom,
          animation: entry ? { currentTime: Number(entry.currentTime), delay: entry.effect.getTiming().delay, duration: entry.effect.getTiming().duration, transforms: entry.effect.getKeyframes().some(frame => Object.hasOwn(frame, 'transform')) } : null }; };
        return { at: performance.now(), title: inspect(title), body: inspect(body) };
      }, selectors);
      if (screenshots && ['early', 'middle', 'final'].includes(phase)) await page.screenshot({ path: resolve(evidence, label + '-' + phase + '-' + width + '.png') });
      return value;
    };
    numericMetrics = { fade: label, before: await sample('before') };
    let earlyHandle;
    try {
      earlyHandle = await page.waitForFunction(({ title, body }) => {
        const a = document.querySelector(title), b = document.querySelector(body);
        return a.getAnimations().some(animation => animation.id === 'ah-scroll-reveal') && b.getAnimations().some(animation => animation.id === 'ah-scroll-reveal')
          && Number(getComputedStyle(a).opacity) < .5 && Number(getComputedStyle(b).opacity) < .5;
      }, selectors);
    } catch (error) { numericMetrics = { ...numericMetrics, after: await sample('failure') }; throw error; }
    await earlyHandle.dispose();
    const early = await sample('early'); numericMetrics = { fade: label, early };
    assert.ok(early.title.opacity < .5 && early.body.opacity < .5, 'scroll entry visibly fades both the real title and real content from low opacity');
    assert.equal(early.title.phase, 'title'); assert.equal(early.body.phase, 'body'); assert.equal(early.body.mode, 'fade');
    assert.equal(early.body.animation?.transforms, false, 'actual content cards fade without replacing their existing float or geometry');
    await page.waitForFunction(({ title, body }) => {
      const a = Number(getComputedStyle(document.querySelector(title)).opacity), b = Number(getComputedStyle(document.querySelector(body)).opacity);
      return a > .5 && b > .05 && b < .9 && a > b + .05;
    }, selectors);
    const middle = await sample('middle'); numericMetrics = { fade: label, early, middle };
    assert.ok(middle.title.opacity > early.title.opacity + .1 && middle.body.opacity > early.body.opacity + .01 && middle.title.opacity > middle.body.opacity + .05, 'the title leads the actual card through a visibly staggered fade');
    let focusFinished = false;
    if (focusCancellation) {
      const heading = page.locator(title + ' h2'); await heading.evaluate(node => node.focus({ preventScroll: true }));
      await page.waitForFunction(title => !document.querySelector(title).getAnimations().some(animation => animation.id === 'ah-scroll-reveal'), title);
      assert.equal(await page.locator(title).evaluate(node => Number(getComputedStyle(node).opacity)), 1, 'keyboard focus immediately restores full readable title opacity');
      focusFinished = true;
    }
    await page.waitForFunction(({ title, body }) => [title, body].every(selector => Number(getComputedStyle(document.querySelector(selector)).opacity) >= .99 && !document.querySelector(selector).getAnimations().some(animation => animation.id === 'ah-scroll-reveal')), selectors);
    const final = await sample('final');
    assert.equal(final.title.opacity, 1); assert.equal(final.body.opacity, 1);
    return { early, middle, final, focusCancellation: focusFinished, screenshots };
  }
  async function touchPanKeepsFutureContent(page, context) {
    const future = await page.locator('#about .ah-home-fact-bubble[data-scroll-reveal="pending"]').all();
    let target = null;
    for (const node of future) if (await node.evaluate(item => item.getBoundingClientRect().top > innerHeight + 150)) { target = node; break; }
    assert.ok(target, 'the mobile scroll starts while an About body card is still below the viewport');
    const before = await target.evaluate(node => ({ state: node.dataset.scrollReveal, top: node.getBoundingClientRect().top }));
    const beforeY = await page.evaluate(() => scrollY), session = await context.newCDPSession(page);
    try {
      const x = width - 8, y = 300;
      assert.equal(await page.evaluate(({ x, y }) => !document.elementFromPoint(x, y)?.closest('a,button,summary,input,select,textarea,[tabindex]'), { x, y }), true, 'the touch pan starts on a non-interactive About surface');
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      assert.equal(await target.getAttribute('data-scroll-reveal'), 'pending', 'touching a background does not settle all future cards in its section');
      // A measured pan, rather than an instantaneous high-velocity fling whose
      // legitimate inertia could carry the future card into the viewport.
      for (let step = 1; step <= 4; step++) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - step * 20, id: 1 }] }); await page.waitForTimeout(50);
      }
      await page.waitForTimeout(80);
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForFunction(before => scrollY > before + 15, beforeY);
      assert.equal(await target.getAttribute('data-scroll-reveal'), 'pending', 'native touch scrolling leaves the unentered future card eligible for its fade');
      return { before, after: await target.evaluate(node => ({ state: node.dataset.scrollReveal, top: node.getBoundingClientRect().top })), nativeScrollDelta: await page.evaluate(() => scrollY) - beforeY, simulatedTouchInput: true };
    } finally { await session.detach(); }
  }
  async function agendaRowFade(page) {
    const selector = '#program-' + raw.sessions[0].id, row = page.locator(selector);
    assert.equal(await row.getAttribute('data-scroll-reveal'), 'pending', 'the real agenda row is still unentered before testing its fade');
    assert.notEqual(await page.evaluate(() => location.hash), selector, 'an already settled row hash cannot stand in for a fresh row animation');
    await row.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.waitForFunction(selector => { const node = document.querySelector(selector); return node.getAnimations().some(animation => animation.id === 'ah-scroll-reveal') && Number(getComputedStyle(node).opacity) < .5; }, selector);
    const early = await row.evaluate(node => { const motion = node.getAnimations().find(animation => animation.id === 'ah-scroll-reveal'); return { opacity: Number(getComputedStyle(node).opacity), phase: node.dataset.scrollPhase, mode: node.dataset.scrollMode, delay: motion.effect.getTiming().delay, transforms: motion.effect.getKeyframes().some(frame => Object.hasOwn(frame, 'transform')) }; });
    assert.ok(early.opacity < .5); assert.equal(early.phase, 'body'); assert.equal(early.mode, 'fade'); assert.equal(early.transforms, false); assert.equal(early.delay, 160, 'single-column agenda rows use the short body delay');
    await page.waitForFunction(selector => { const opacity = Number(getComputedStyle(document.querySelector(selector)).opacity); return opacity > .05 && opacity < .9; }, selector);
    const middle = await row.evaluate(node => Number(getComputedStyle(node).opacity));
    await page.waitForFunction(selector => Number(getComputedStyle(document.querySelector(selector)).opacity) === 1 && !document.querySelector(selector).getAnimations().some(animation => animation.id === 'ah-scroll-reveal'), selector);
    return { early, middle, final: await row.evaluate(node => Number(getComputedStyle(node).opacity)), testedBeforeHashSettlement: true };
  }

  async function onePixelViewport(page,originalWidth) {
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.setViewportSize({width:1,height:900});
    await page.waitForFunction(()=>innerWidth===1);
    await page.evaluate(()=>{scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'});dispatchEvent(new Event('scroll'));});
    await page.waitForFunction(()=>{const canvas=document.querySelector('[data-scroll-atmosphere]'),layer=canvas?.closest('[data-reading-atmosphere]');return canvas&&layer&&!layer.hidden&&canvas.width>=1&&canvas.width<=2;});
    await page.waitForTimeout(150);
    const metrics=await page.locator('[data-scroll-atmosphere]').evaluate(canvas=>({viewportWidth:innerWidth,bitmapWidth:canvas.width,bitmapHeight:canvas.height,hidden:canvas.closest('[data-reading-atmosphere]').hidden}));
    assert.equal(metrics.viewportWidth,1);assert.equal(metrics.hidden,false);assert.ok(metrics.bitmapWidth>=1&&metrics.bitmapWidth<=2&&metrics.bitmapHeight>=1);
    assert.deepEqual(pageErrors,[],'a transient one-pixel viewport keeps the actual background canvas paint valid');
    await page.setViewportSize({width:originalWidth,height:900});
    await page.emulateMedia({reducedMotion:'reduce'});await settled(page);await noDecorativeMotion(page);
    return metrics;
  }

  try {
    for (width of [320, 390, 1440, 1920]) {
      stage = 'initial-reduced'; const f = await fixture({ viewportWidth: width }), { page } = f;
      try {
        await page.waitForFunction(() => document.querySelector('#artdico-host')?.dataset.scrollMotion === 'ready');
        await page.waitForFunction(() => document.querySelector('#artdico-host')?.dataset.motionState === 'reduced');
        await essentialContent(page); const typedHero = await posterTitle(page, { fontFailure: width === 1920 }); await noDecorativeMotion(page); await header(page);
        await originalArtworkFallback(page);
        stage = 'enable-motion'; await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.waitForFunction(() => document.querySelector('#artdico-host')?.dataset.motionState === 'active'); await settled(page);
        await page.waitForFunction(() => document.querySelector('#artdico-host')?.dataset.atmosphereState === 'active');
        const initialTitleMask = await typedMaskAfter(page, typedHero.at), initialTitleMaskSweep = await posterMaskSweep(page, initialTitleMask);
        const atmosphere = await page.locator('[data-scroll-atmosphere]').evaluate(node => ({ hidden: node.hidden, ariaHidden: node.getAttribute('aria-hidden'), pointerEvents: getComputedStyle(node).pointerEvents }));
        assert.equal(await page.locator('canvas[data-scroll-atmosphere][data-hero-particles]').count(), 1, 'one canvas supplies hero and full-page stars');
        assert.equal(atmosphere.ariaHidden, 'true'); assert.equal(atmosphere.pointerEvents, 'none', 'background stars cannot intercept reading or form controls');
        assert.equal(await page.locator('[data-reading-atmosphere]').evaluate(node => node.hidden), false);
        const originalSphere = await page.locator('.ah-home-hero-planet').evaluate(node => { const box = node.getBoundingClientRect(); return { width: box.width, height: box.height }; });
        stage = 'visible-hero-ambient';
        await page.waitForFunction(() => document.querySelector('.ah-home-hero-planet')?.dataset.heroMotion === 'active');
        const heroCanvas = await page.locator('[data-hero-particles]').evaluate(node => ({ hidden: node.hidden, ariaHidden: node.getAttribute('aria-hidden'), pointerEvents: getComputedStyle(node).pointerEvents }));
        assert.equal(heroCanvas.hidden, false); assert.equal(heroCanvas.ariaHidden, 'true'); assert.equal(heroCanvas.pointerEvents, 'none');
        await page.waitForTimeout(1000);
        assert.ok(await page.evaluate(() => window.__homeMotionQaPendingFrames()) > 0, 'visible hero has a real ambient particle frame loop');
        const firstParticles = await particlePixels(page); await page.waitForTimeout(180); const secondParticles = await particlePixels(page);
        numericMetrics = { firstParticles, secondParticles };
        // Sparse background dust has a different intended perceptibility from
        // the superseded bright ring. Count visible, separated painted dots;
        // do not force small free particles to become oversized ring pixels.
        for (const pixels of [firstParticles, secondParticles]) {
          assert.ok(pixels.brightPixels >= 15 && pixels.visibleComponents >= 6 && pixels.layerOpacity >= .5 && pixels.cssWidth >= 64 && pixels.cssHeight >= 64, 'sparse blue-purple background dots are actually visible inside the viewport');
          assert.ok(pixels.occupiedRegions >= 3, 'the free dots occupy multiple background regions');
          assert.equal(pixels.sphereAlphaPixels, 0, 'the entire sphere silhouette contains no background-particle alpha');
          assert.equal(pixels.readableAlphaPixels, 0, 'hero titles, description and controls contain no background-particle alpha');
          assert.equal(pixels.mode, 'viewport-background'); assert.equal(pixels.inFixedBackgroundLayer, true);
        }
        assert.notEqual(firstParticles.signature, secondParticles.signature, 'visible hero particles change their rendered pixels over real time');
        let pointerInteraction = false, backgroundPointer = null;
        if (width >= 1000) {
          stage = 'background-pointer-force'; backgroundPointer = await backgroundPointerForce(page);
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
        let lateTitleFontLifecycle = null;
        if (width === 1920) { stage = 'late-title-font-mask'; lateTitleFontLifecycle = await lateTitleFonts(page, f); }
        const start = await progress(page); assert.equal(start.hidden, 'true', 'reading progress is a decorative, non-announcing layer');
        stage = 'organization-presentation';
        const organizationFade = await fadeSequence(page, '#booths .ah-section-heading', '#organization-scroll-motion-org', 'organization-fade', { focusCancellation: true });
        await page.locator('#about').evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' }));
        await page.waitForFunction(original => { const node = document.querySelector('[data-background-planet]'), box = node.getBoundingClientRect(); return Number(document.querySelector('.ah-home-hero-planet').dataset.heroRetreat) >= .99 && box.width < original.width * .85 && Number(getComputedStyle(node).opacity) > .01; }, originalSphere); await settled(page);
        const distantSphere = await backgroundPlanet(page); numericMetrics = { originalSphere, distantSphere };
        assert.ok(distantSphere.width < originalSphere.width * .85 && distantSphere.width > 32 && distantSphere.opacity > .01 && distantSphere.opacity <= .3, 'the original hero sphere retreats to a smaller, subdued visible background');
        assert.equal(distantSphere.fixedLayer, 'fixed'); assert.equal(distantSphere.layerHidden, false);
        assert.ok(distantSphere.x + distantSphere.width > 0 && distantSphere.x < width && distantSphere.y + distantSphere.height > 0 && distantSphere.y < distantSphere.viewportHeight, 'the distant sphere remains visible in the full-page background');
        assert.equal(await page.locator('.ah-home-hero-planet').getAttribute('data-hero-motion'), 'active', 'ambient motion continues when the hero section is offscreen');
        await page.screenshot({ path: resolve(evidence, 'background-retreat-' + width + '.png') });
        stage = 'touch-pan-regression'; const touchPan = width < 1000 ? await touchPanKeepsFutureContent(page, f.context) : null;
        const firstArt = await art(page);
        stage = 'actual-scroll'; const beforeWheel = await page.evaluate(() => scrollY); await page.mouse.move(width - 4, 450); await page.mouse.wheel(0, 80);
        await page.waitForFunction(before => scrollY > before + 20, beforeWheel); await settled(page);
        const secondArt = await art(page), artShift = Math.abs(secondArt.documentTop - firstArt.documentTop);
        assert.ok(artShift > .1 && artShift <= 80, 'actual scrolling moves decorative art gently relative to its document position');
        const sphereAfterWheel = await backgroundPlanet(page), nativeWheelDelta = await page.evaluate(before => scrollY - before, beforeWheel);
        assert.ok(Math.hypot(sphereAfterWheel.x - distantSphere.x, sphereAfterWheel.y - distantSphere.y) < nativeWheelDelta * .25 + 3, 'the distant sphere stays in the viewport background as document content scrolls');
        stage = 'guest-presentation';
        const guestFade = await fadeSequence(page, '#guests .ah-section-heading', '#guest-scroll-motion-guest', 'guest-fade', { screenshots: width === 1920 });
        const afterWheel = await page.evaluate(() => scrollY); await page.mouse.wheel(0, 650);
        await page.waitForFunction(before => scrollY > before + 100, afterWheel); await settled(page); await header(page);
        const later = await progress(page); assert.ok(later.width > start.width + .1 && later.width <= later.max + 1, 'reading progress follows native page scrolling');
        assert.equal(await page.locator('.ah-home-header').getAttribute('data-scrolled'), 'true');
        const guestButton = page.locator('#guest-scroll-motion-guest [data-guest-toggle]');
        // The existing guest float is intentionally moving before focus. Use
        // native scrolling, then its supported focus pause for the hit test.
        await guestButton.evaluate(node => { node.scrollIntoView({ block: 'center', behavior: 'instant' }); node.focus({ preventScroll: true }); }); await settled(page);
        assert.equal(await guestButton.evaluate(node => { const b = node.getBoundingClientRect(); return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('[data-guest-toggle]') === node; }), true, 'the decorative canvas never covers the real central interaction target');
        stage = 'agenda-row-presentation'; const rowFade = await agendaRowFade(page);
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
        for (const selector of ['#guest-scroll-motion-guest', '#organization-scroll-motion-org']) {
          assert.equal(await page.locator(selector).getAttribute('data-scroll-reveal'), 'seen', 'refresh does not rewind a card whose presentation already finished');
          assert.equal(await page.locator(selector).evaluate(node => Number(getComputedStyle(node).opacity)), 1);
        }
        stage = 'continuous-ambient-budget'; const ambientBudget = await ambientPaintBudget(page);
        await page.screenshot({ path: resolve(evidence, 'background-agenda-' + width + '.png') });
        stage = 'live-reduced'; await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.waitForFunction(() => document.querySelector('#artdico-host')?.dataset.motionState === 'reduced'); await noDecorativeMotion(page);
        stage = 'background-compositing'; await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.waitForFunction(() => document.querySelector('#artdico-host')?.dataset.atmosphereState === 'active'); const compositing = await backgroundCompositing(page);
        stage='fact-bubble-motion';const factBubbles=await factBubbleMotion(page,width);
        await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForFunction(() => document.querySelector('#artdico-host')?.dataset.motionState === 'reduced'); await noDecorativeMotion(page);
        stage = 'deep-link'; const readsBeforeDeepLink = f.publicReads();
        await page.goto(SITE + '/__scroll-blank/', { waitUntil: 'domcontentloaded' });
        await page.goto(SITE + '/#guest-scroll-motion-guest', { waitUntil: 'networkidle' }); await page.evaluate(() => document.fonts.ready);
        assert.ok(f.publicReads() > readsBeforeDeepLink, 'initial guest hash is tested against a new delayed publication, not an existing document');
        await page.locator('#guest-scroll-motion-guest button[data-guest-toggle]').waitFor(); assert.equal(await page.locator('#guest-scroll-motion-guest details,.ah-guest-detail-body').count(),0,'a guest anchor reveals its circle without a rectangular panel'); await settled(page);
        const deepTop = await page.locator('#guest-scroll-motion-guest').evaluate(node => node.getBoundingClientRect().top), deepHeader = await header(page);
        assert.ok(deepTop >= deepHeader.bottom - 1, 'an asynchronously published guest hash is not covered by the pinned header'); await essentialContent(page);
        stage = 'synthetic-hidden'; await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.waitForFunction(() => document.querySelector('#artdico-host')?.dataset.motionState === 'active');
        await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
        await page.waitForFunction(() => document.querySelector('#artdico-host')?.dataset.motionState === 'hidden'); await noDecorativeMotion(page);
        await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
        await page.waitForFunction(() => document.querySelector('#artdico-host')?.dataset.motionState === 'active');
        await page.emulateMedia({ reducedMotion: 'reduce' }); await page.screenshot({ path: resolve(evidence, 'pinned-header-' + width + '.png') });
        stage='one-pixel-viewport';const narrowViewport=width===1440?await onePixelViewport(page,width):null;
        reports.push({ width, typedHero, initialTitleMask, initialTitleMaskSweep, initialAndLiveReducedMotion: true, visibleHeroAmbientFrameLoop: true, visibleParticlePixels: [firstParticles, secondParticles], finePointerInteraction: pointerInteraction, backgroundPointer, lateTitleFontLifecycle, nativeWheel: true, boundedDecorativeShift: artShift, originalSphere, distantSphere, sphereAfterWheel, ambientBudget, compositing, factBubbles, continuousFullPageBackgroundWithOneBoundedLoop: true, realEntryAndFocusCancellation: true, guestFade, organizationFade, touchPan, rowFade, narrowViewport, pointerTransparentBackground: true, frameProbeExplicitlySyntheticInstrumentation: true, pinnedHeader: true, anchorsBelowHeader: alignment, mobileMenu: width < 1000, publicRefreshPositionPreserved: true, delayedGuestHash: true, hiddenSignalExplicitlySynthetic: true });
      } catch (error) { await captureFailureSignals(page); throw error; } finally { activePage = null; await f.context.close(); }
    }
    for (const mode of ['no-javascript', 'no-intersection-observer']) {
      stage = mode; width = 390; const f = await fixture({ viewportWidth: width, javaScriptEnabled: mode !== 'no-javascript', withoutObserver: mode === 'no-intersection-observer' });
      try {
        await essentialContent(f.page); await posterTitle(f.page);
        if (mode === 'no-intersection-observer') {
          assert.equal(await f.page.locator('.ah-home-hero-planet').getAttribute('data-hero-motion'), 'idle');
          assert.equal(await f.page.locator('.ah-home-fact-bubble[data-fact-motion=active]').count(),0,'no observer leaves fact bubbles static without another frame loop');
          assert.equal(await f.page.locator('[data-reading-atmosphere]').evaluate(node => node.hidden), true);
          await f.page.waitForFunction(() => window.__homeMotionQaPendingFrames() === 0, null, { timeout: 4000 });
        }
        await f.page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
        if (mode !== 'no-javascript') await settled(f.page); await header(f.page);
        const menu = f.page.locator('[data-site-menu]'); await menu.locator('summary').click(); await menu.locator('a[href="#about"]').click();
        await anchor(f.page, 'about', { noScript: mode === 'no-javascript', requireCurrent: false }); await essentialContent(f.page);
        reports.push({ width, fallback: mode, essentialContentVisible: true, pinnedHeaderAndNativeMenu: true, noBusinessRequests: true });
      } catch (error) { await captureFailureSignals(f.page); throw error; } finally { activePage = null; await f.context.close(); }
    }
    assert.deepEqual(pageErrors, []); assert.equal(reports.length, expectedCases);
  } catch (error) {
    failure = { message: error.message, stack: error.stack, stage, width };
    if (activePage) await captureFailureSignals(activePage);
    await activePage?.screenshot({ path: resolve(evidence, 'failure-' + width + '.png'), fullPage: true }).catch(() => {});
  } finally {
    await browser.close(); browser = null;
    assert.equal(sha(await readFile(resolve(dist, 'index.html'))), sha(html), 'the compiled build stays frozen throughout the checks');
    const report = { ok: !failure, cases: reports.length, expectedCases, syntheticOnly: true, originalArtwork, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim(), publicHtmlSha256: sha(html), scriptSha256, businessPostRequests: 0, mailRequests: 0, realNetworkRequests: 0, reports, pageErrors, requests, servedAssets: Object.fromEntries([...servedAssets].sort()), ...(failure ? { failure } : {}) };
    await writeFile(resolve(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    const summary = { ok: report.ok, cases: report.cases, expectedCases, widths: [320, 390, 1440, 1920], syntheticOnly: true, originalArtwork, sourceCommit: report.sourceCommit, publicHtmlSha256: report.publicHtmlSha256, scriptSha256, pageErrorCount: pageErrors.length, businessPostRequests: 0, mailRequests: 0, ...(failure ? { failure: { code: 'HOME_SCROLL_ASSERTION_FAILED', stage, width, location: /home-scroll-motion-smoke\.mjs:\d+:\d+/u.exec(failure.stack)?.[0] ?? null }, numericMetrics } : {}) };
    process.stdout.write((report.ok ? 'Public scroll motion browser verified: ' : 'Public scroll motion browser failed: ') + JSON.stringify(summary) + '\n');
    if (failure) process.exitCode = 1;
  }
}

await main().catch(async () => {
  await browser?.close().catch(() => {});
  process.stdout.write('Public scroll motion browser failed: ' + JSON.stringify({ ok: false, cases: 0, expectedCases, syntheticOnly: true, failure: { code: 'HOME_SCROLL_PREFLIGHT_FAILED', stage, width } }) + '\n');
  process.exitCode = 1;
});
