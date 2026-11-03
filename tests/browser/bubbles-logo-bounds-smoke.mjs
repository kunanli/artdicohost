// Built-page regression over an anonymously captured PUBLIC snapshot and its
// exact uploaded organization image bytes. Actual data stays in ignored paths.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

let activeBrowser = null;
async function main() {
const project = fileURLToPath(new URL('../../', import.meta.url));
const source = resolve(process.env.ARTDICO_SOURCE_DIRECTORY || project);
const dist = resolve(process.env.ARTDICO_DIST_DIRECTORY || resolve(source, 'dist'));
const capture = resolve(process.env.ARTDICO_PUBLIC_VISUAL_FIXTURE_DIRECTORY || process.env.ARTDICO_PUBLIC_FIXTURE_DIRECTORY || resolve(project, '.local-data/public-visual-fixture'));
const evidence = resolve(process.env.ARTDICO_BUBBLES_EVIDENCE_DIRECTORY || process.env.ARTDICO_EVIDENCE_DIRECTORY || resolve(project, '.local-data/browser-evidence/bubbles-logo-bounds'));
assert.ok(capture.includes('/.local-data/'), 'public captures must remain in an ignored local directory');
const SITE = 'https://artdico.host', API = 'https://api.artdico.host';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const testScriptSha256 = sha(await readFile(fileURLToPath(import.meta.url)));
const { publicContentEnvelope } = await import(pathToFileURL(resolve(source, 'src/lib/public-content-refresh.mjs')));
const { toPublicContent } = await import(pathToFileURL(resolve(source, 'shared/content-schema.mjs')));
const { publicGuestCards } = await import(pathToFileURL(resolve(source,'shared/guest-display.mjs')));
const { organizationReferenceKey } = await import(pathToFileURL(resolve(source, 'shared/organization-display.mjs')));
const referenceKeys = ['gamezone','igda','szdx','bu','pengyou','g4c','teesside'];
// The user's centred sphere replaces the old seven-slot 2/4/1 composition.
// Independent bounds/centroid checks below apply to every actual page and width.

const artworkConfig = await readFile(resolve(source,'src/config/organization-artwork.mjs'),'utf8');
const reviewedDigests = new Map([...artworkConfig.matchAll(/(\w+):Object\.freeze\(\{url:\w+,sourceDigest:"([a-f0-9]{64})"/gu)].map(match=>[match[1],match[2]]));
assert.equal(reviewedDigests.size,7,'the seven original reviewed variants remain explicit');
const manifest = JSON.parse(await readFile(resolve(capture, 'manifest.json'), 'utf8'));
assert.equal(manifest.schemaVersion, 1); assert.equal(manifest.anonymous, true); assert.equal(manifest.source, API + '/api/public/content');
assert.equal(manifest.snapshot.file, 'snapshot.json');
const snapshotBytes = await readFile(resolve(capture, manifest.snapshot.file));
assert.equal(snapshotBytes.length, manifest.snapshot.bytes); assert.equal(sha(snapshotBytes), manifest.snapshot.sha256);
const snapshot = JSON.parse(snapshotBytes), checked = publicContentEnvelope(snapshot);
assert.ok(checked, 'captured publication must pass the actual public envelope boundary, with no toy fallback');
assert.equal(snapshot.revision, manifest.snapshot.revision); assert.equal(snapshot.publishedAt, manifest.snapshot.publishedAt);
const rawGuestCount=snapshot.content.guests.length;
assert.equal(rawGuestCount,manifest.counts.guests,'raw published profile count matches this exact manifest');
const organizationCount = snapshot.content.organizations.length;
assert.equal(organizationCount,manifest.counts.organizations,'actual organization count must match the same capture manifest');
assert.ok(organizationCount>=7&&organizationCount<=200,'the original seven organizations and any newly published organizations are all retained');
for(const key of referenceKeys){
 const originals=snapshot.content.organizations.filter(card=>organizationReferenceKey(card)===key);
 assert.equal(originals.length,1,'each of the seven reviewed identities remains independently present');
 assert.equal(originals[0].logoUrl?.split('/').at(-1)?.split('.')[0],reviewedDigests.get(key),'original reviewed upload digest is not silently replaced');
}
const logoPaths = new Set(snapshot.content.organizations.map(item => item.logoUrl).filter(Boolean));
assert.equal(logoPaths.size,organizationCount,'each currently published organization has its exact captured logo'); assert.equal(manifest.media.length, logoPaths.size);
const actualMedia = new Map();
for (const item of manifest.media) {
  assert.match(item.file, /^media\/[a-f0-9]{64}\.(?:png|jpg|webp)$/u);
  assert.equal(item.path, '/api/public/portraits/' + item.file.slice(6)); assert.ok(logoPaths.has(item.path));
  const bytes = await readFile(resolve(capture, item.file));
  assert.equal(bytes.length, item.bytes); assert.equal(sha(bytes), item.sha256); assert.equal(item.sha256, item.file.slice(6, 70));
  actualMedia.set(item.path, { bytes, contentType: item.contentType });
}
const rawGuests=snapshot.content.guests;
const attendancePresent=Object.hasOwn(snapshot.content,'guestAttendance');
const guests=publicGuestCards(rawGuests,attendancePresent?snapshot.content.guestAttendance:undefined),ids=guests.map(item=>item.id);
const safePublicIds=publicGuestCards(rawGuests).map(item=>item.id);
assert.deepEqual(ids,safePublicIds,'a valid attendance proof annotates every safe public profile instead of filtering the displayed collection');
assert.deepEqual(ids,rawGuests.filter(item=>!Object.hasOwn(item,'visibility')||item.visibility==='public').map(item=>item.id),'every valid public profile in this exact captured publication is displayed');
const confirmedGuestIds=new Set(attendancePresent?snapshot.content.guestAttendance.confirmedGuestIds:[]);
for(const guest of guests)assert.equal(guest.attendance,confirmedGuestIds.has(guest.id)?'attending':'pending','attendance stays bound to the original proof for each displayed profile');
assert.ok(guests.length>0,'actual guest interaction scenarios need at least one safe public profile');
if(snapshot.revision===44){
  assert.equal(rawGuestCount,9,'R44 preserves all nine original published profiles');
  assert.equal(guests.length,9,'R44 checks all nine safe profiles in the actual DOM');
  assert.equal(confirmedGuestIds.size,3,'R44 retains exactly its three real attendance proofs');
}
const visibleGuestCount=guests.length,motionGuest=guests[0],syntheticBase=rawGuests.find(item=>item.id===motionGuest.id);
const spellingBoundaryProfiles=rawGuests.filter(item=>/maria|ping\s*yao/iu.test(item.name));
const actualSpellingBoundaryIds=spellingBoundaryProfiles.filter(item=>ids.includes(item.id)).map(item=>item.id);
const attendanceProof={present:attendancePresent,sourceRevision:attendancePresent?snapshot.content.guestAttendance.sourceRevision:null,
 confirmedIds:attendancePresent?confirmedGuestIds.size:null,displayedAttending:guests.filter(item=>item.attendance==='attending').length,displayedPending:guests.filter(item=>item.attendance==='pending').length};

const mime = file => ({ html: 'text/html; charset=utf-8', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', woff2: 'font/woff2', ico: 'image/x-icon' })[extname(file).slice(1)] || 'application/octet-stream';
const { chromium } = await import(process.env.ARTDICO_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ executablePath: process.env.ARTDICO_CHROMIUM_BINARY || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
activeBrowser = browser;
await mkdir(evidence, { recursive: true });
const reports = [], glyphInkChecks = [], pageErrors = [], servedAssets = new Map(), rawImageRequests = new Set(), uncapturedMediaRequests = new Set();
let uncapturedMediaRequestCount=0;
let defaultReferenceLogosRendered = 0;
let stage = 'fixture', currentWidth = null, currentMode = null, lastNumericMetrics = null;
async function syntheticImages() {
  const context = await browser.newContext(); await context.route('**/*', route => route.abort());
  try {
    const page = await context.newPage();
    const values = await page.evaluate(() => [['opaque-square', 1600, 1600], ['tall', 160, 1800], ['wide', 1800, 160], ['padded', 1600, 1400]].map(([kind, width, height]) => {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const context = canvas.getContext('2d');
      context.fillStyle = '#fff'; context.fillRect(0, 0, width, height); context.fillStyle = kind === 'tall' ? '#e61e2c' : '#164bb7';
      if (kind === 'padded') context.fillRect(width / 2 - 40, height / 2 - 30, 80, 60);
      else context.fillRect(width * .08, height * .08, width * .84, height * .84);
      return { kind, width, height, base64: canvas.toDataURL('image/png').split(',')[1] };
    }));
    return values.map(item => { const bytes = Buffer.from(item.base64, 'base64'), id = sha(bytes) + '.png'; return { kind: item.kind, width: item.width, height: item.height, id, path: '/api/public/portraits/' + id, bytes, contentType: 'image/png' }; });
  } finally { await context.close(); }
}
const synthetic = await syntheticImages(), media = new Map([...actualMedia, ...synthetic.map(item => [item.path, item])]);
function changedEnvelope(change, revision = snapshot.revision + 1) {
  const content = structuredClone(snapshot.content); change(content);
  const envelope = { revision, publishedAt: snapshot.publishedAt, content: toPublicContent(content) };
  assert.deepEqual(envelope.content.guestAttendance,snapshot.content.guestAttendance,'synthetic text/image variants never replace or remove the original attendance proof');
  assert.ok(publicContentEnvelope(envelope), 'explicit synthetic variant remains a valid public envelope');
  return Buffer.from(JSON.stringify(envelope));
}
function genericOrganizationIdentities(content){
 const keys=new Map();content.organizations.forEach((item,index)=>{const id='synthetic-raw-upload-'+index;keys.set(item.id,id);item.id=id;item.name='合成原始公开图像 '+index;});
 for(const item of [...content.showcases,...content.booths])if(keys.has(item.organizationId))item.organizationId=keys.get(item.organizationId);
}
async function fixture(width, { mode = 'actual', reducedMotion = 'no-preference', holdLogos = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, isMobile: width < 600, hasTouch: width < 600, reducedMotion });
  const page = await context.newPage(), calls = []; let responseBytes = snapshotBytes, revision = snapshot.revision, releaseGate;
  const gate = new Promise(resolve => { releaseGate = resolve; });
  if (!holdLogos) releaseGate();
  if (mode === 'raw-generic') responseBytes = changedEnvelope(genericOrganizationIdentities);
  if (mode === 'adversarial') responseBytes = changedEnvelope(content => { content.organizations.forEach((item, index) => { const image = synthetic[index % synthetic.length]; item.logoId = image.id; item.logoUrl = image.path; }); });
  revision=JSON.parse(responseBytes).revision;
  await page.addInitScript(()=>{window.__publicVisualContentUpdates=0;document.addEventListener('artdico:public-content-updated',()=>window.__publicVisualContentUpdates++);});
  page.setDefaultTimeout(12000); page.on('pageerror', error => pageErrors.push({ width, mode, message: error.message }));
  await context.addCookies([{ name: 'synthetic_staff', value: 'SYNTHETIC_NEVER_SEND_STAFF_COOKIE', domain: new URL(API).hostname, path: '/', httpOnly: true, secure: true, sameSite: 'Strict' }]);
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()); assert.ok([SITE, API].includes(url.origin)); assert.equal(request.method(), 'GET', 'read-only page inspection never writes or sends');
    calls.push({ origin: url.origin, path: url.pathname });
    if (url.origin === API) {
      assert.equal(request.headers().cookie, undefined); assert.equal(request.headers().authorization, undefined);
      if (url.pathname === '/api/public/content') return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': SITE }, body: responseBytes });
      if (url.pathname.startsWith('/api/public/portraits/')) {
        if (media.has(url.pathname)) {
          await gate; if (actualMedia.has(url.pathname)) rawImageRequests.add(url.pathname);
          const image = media.get(url.pathname); return route.fulfill({ status: 200, contentType: image.contentType, headers: { 'access-control-allow-origin': SITE }, body: image.bytes });
        }
        uncapturedMediaRequests.add(url.pathname);
        uncapturedMediaRequestCount++;
        return route.fulfill({ status: 404, body: '' }); // Guest photos/work media outside the logo capture are deliberately stubbed.
      }
      assert.equal(url.pathname, '/api/admin/registration/config'); return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': SITE }, body: '{"enabled":false,"reason":"closed"}' });
    }
    assert.equal(url.pathname.startsWith('/api/'), false);
    if (/\/_astro\/organization-[^/]+\.(?:png|webp)$/u.test(url.pathname)) await gate;
    const path = url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname, file = resolve(dist, '.' + path); assert.ok(file.startsWith(dist + '/'));
    try { const bytes = await readFile(file); servedAssets.set(path, sha(bytes)); return route.fulfill({ status: 200, contentType: mime(file), body: bytes }); }
    catch { return route.fulfill({ status: 404, body: '' }); }
  });
  async function refresh(change) {
    const priorRevision=JSON.parse(responseBytes).revision,acceptedUpdates=await page.evaluate(()=>window.__publicVisualContentUpdates);
    assert.ok(revision+1>priorRevision,'each fixture refresh publishes a strictly newer envelope');
    responseBytes = changedEnvelope(change, ++revision); await page.waitForTimeout(1100);
    const expectedIds=JSON.parse(responseBytes).content.organizations.map(item=>item.id);
    const read = page.waitForResponse(value => value.url() === API + '/api/public/content'); await page.evaluate(() => dispatchEvent(new Event('focus'))); await read;
    await page.waitForFunction(({expectedIds,acceptedUpdates})=>{const actual=[...document.querySelectorAll('[data-organization-id]')].map(node=>node.dataset.organizationId);return window.__publicVisualContentUpdates>acceptedUpdates&&actual.length===expectedIds.length&&actual.every((id,index)=>id===expectedIds[index]);},{expectedIds,acceptedUpdates},{timeout:12000});
  }
  return { width, mode, context, page, calls, releaseLogos: releaseGate, refresh,get publishedOrganizations(){return JSON.parse(responseBytes).content.organizations;} };
}
const noOverflow = async f => assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no page horizontal overflow at ' + f.width);
function contained(inner, outer, message, tolerance = 1.5) {
  assert.ok(inner.x >= outer.x - tolerance && inner.y >= outer.y - tolerance && inner.x + inner.width <= outer.x + outer.width + tolerance && inner.y + inner.height <= outer.y + outer.height + tolerance, message);
}
function nonoverlap(rects, message) {
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j], width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    assert.ok(width <= 1.5 || height <= 1.5, message + ' pair ' + i + '/' + j);
  }
}
async function organizationBounds(f, { loaded = true } = {}) {
  stage = loaded ? 'organization-loaded-bounds' : 'organization-before-load-bounds';
  const publishedIds=f.publishedOrganizations.map(item=>item.id);
  const actualOrder=await f.page.locator('[data-organization-id]').evaluateAll(nodes=>nodes.map(node=>({id:node.dataset.organizationId,slot:node.dataset.organizationSlot??null})));
  assert.deepEqual(actualOrder.map(item=>item.id),publishedIds,'actual image DOM order follows the current public array');
  assert.deepEqual(actualOrder.map(item=>item.slot),publishedIds.map((_,index)=>String(index)),'every entry retains its public array index independently of identity or load state');
  const orderedIds=actualOrder.map(item=>'organization-'+item.id),rows=[];
  const batchSize=8;
  for(let offset=0;offset<orderedIds.length;offset+=batchSize){
    await f.page.evaluate(id=>document.getElementById(id)?.dispatchEvent(new CustomEvent('artdico:organization-reveal',{bubbles:true,detail:{id}})),orderedIds[offset]);
    const batch=await f.page.locator('[data-organization-id]').evaluateAll(nodes => nodes.filter(node=>!node.hidden).map(node => {
    const box = element => { const b = element.getBoundingClientRect(); return { x: b.x, y: b.y + scrollY, width: b.width, height: b.height }; };
    const card = node.querySelector('.ah-organization-card'), frame = node.querySelector('.ah-organization-image'), image = frame?.querySelector('img');
    const presentation=frame?.dataset.logoPresentation??null,name=node.querySelector('h3'),nameStyle=getComputedStyle(name),nameRect=name.getBoundingClientRect();
    const nameVisible=nameRect.width>1&&nameRect.height>1&&nameStyle.display!=='none'&&nameStyle.visibility==='visible'&&Number(nameStyle.opacity)>0&&nameStyle.clipPath!=='inset(50%)';
    const accessibleNameMatches=card.getAttribute('aria-label')===name.textContent+(card.tagName==='A'?' · 打开组织页面（新窗口）':'');
    let whiteMask=null;
    if(presentation==='white'&&image?.complete&&image.naturalWidth){
      const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d');context.drawImage(image,0,0);const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;let ink=0,nonwhite=0,transparent=0;
      for(let i=0;i<pixels.length;i+=4){if(pixels[i+3]>32){ink++;if(pixels[i]!==255||pixels[i+1]!==255||pixels[i+2]!==255)nonwhite++;}else transparent++;}
      whiteMask={width:canvas.width,height:canvas.height,ink,nonwhite,transparent};
    }
    return { id: node.dataset.organizationId, slotIndex: node.dataset.organizationSlot ?? null, reference: node.dataset.organizationReference ?? null, artwork: node.dataset.logoArtwork ?? null,
      slot: box(node), card: box(card), frame: frame ? box(frame) : null, image: image ? box(image) : null,
      src: image?.getAttribute('src'), source: image?.dataset.logoSource??image?.getAttribute('src'), presentation, frameHidden:frame?.hidden??false, name:box(name),nameVisible,nameDisplay:nameStyle.display,nameFont:parseFloat(nameStyle.fontSize),accessibleNameMatches,whiteMask, complete: image?.complete, naturalWidth: image?.naturalWidth, naturalHeight: image?.naturalHeight, fit: image ? getComputedStyle(image).objectFit : null,
      imageVisibility: image ? getComputedStyle(image).visibility : null, imageDisplay: image ? getComputedStyle(image).display : null, imageOpacity: image ? Number(getComputedStyle(image).opacity) : null };
  }));
    rows.push(...batch.map(row=>({...row,page:Math.floor(offset/batchSize)})));
  }
  lastNumericMetrics = rows.map(({ slot, card, frame, image, naturalWidth, naturalHeight, fit }) => ({ slot, card, frame, image, naturalWidth, naturalHeight, fit }));
  assert.equal(rows.length,organizationCount,'every organization from this exact captured snapshot must render');
  assert.deepEqual(rows.map(row=>row.id),publishedIds,'complete page traversal retains the public order without duplicates');
  for (const row of rows) {
    assert.ok(row.slot.width > 0 && row.slot.height >= 40 && row.frame && row.image, 'each actual logo has its own independent nonzero slot and frame');
    assert.equal(row.accessibleNameMatches,true,'every organization retains its full accessible name');
    contained(row.card,row.slot,'organization card stays inside its own slot');
    if(!row.frameHidden){contained(row.frame,row.card,'image frame stays inside its card');contained(row.image,row.frame,'the whole image element stays inside its frame, including opaque canvas');}
    else{assert.equal(row.nameVisible,true,'an inseparable image uses its readable white organization name');assert.ok(row.nameFont>=16);contained(row.name,row.card,'name fallback stays in its own fixed card');}
    assert.ok(row.slot.x >= -1 && row.slot.x + row.slot.width <= f.width + 1, 'logo slot remains in viewport');
    if (loaded) { assert.ok(row.complete && row.naturalWidth > 0 && row.naturalHeight > 0); assert.equal(row.fit, 'contain');
      if(!row.frameHidden){assert.equal(row.nameVisible,false,'a successful logo does not repeat a visible name caption');assert.equal(row.nameDisplay,'none','a successful logo fully removes the duplicate visual caption');if(f.width<=820)assert.ok(Math.abs(row.frame.height-row.card.height)<=1,'mobile uploaded logos use their complete card frame');assert.equal(row.imageVisibility,'visible');assert.notEqual(row.imageDisplay,'none');assert.ok(row.imageOpacity>0,'a hidden image cannot masquerade as fixed bounds');}
      if(row.presentation==='white'){assert.ok(row.whiteMask&&row.whiteMask.ink>0&&row.whiteMask.transparent>0);assert.equal(row.whiteMask.nonwhite,0,'generated visible ink is entirely white');assert.ok(row.whiteMask.width<=800&&row.whiteMask.height<=800,'runtime masks stay bounded');}
    }
  }
  for(const page of new Set(rows.map(row=>row.page))){const group=rows.filter(row=>row.page===page);nonoverlap(group.map(row=>row.slot),'independent organization slots cannot overlap');nonoverlap(group.map(row=>row.card),'whole card rectangles cannot overlap');nonoverlap(group.filter(row=>!row.frameHidden).map(row=>row.image),'whole uploaded image rectangles cannot overlap');}
  {
    const circle=await f.page.locator('[data-organizations-planet]').evaluate(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y+scrollY,width:r.width,height:r.height};});
    assert.ok(Math.abs(circle.width-circle.height)<=1,'actual logo container is a true circle');
    for(const row of rows){assert.ok(row.card.width>=44&&row.card.height>=44,'actual logos retain 44px action frames');for(const box of[row.slot,row.card,...(row.frameHidden?[]:[row.frame,row.image])])for(const x of[box.x,box.x+box.width])for(const y of[box.y,box.y+box.height])assert.ok(Math.hypot(x-circle.x-circle.width/2,y-circle.y-circle.height/2)<=circle.width/2-4+.75,'every actual complete logo/card corner stays inside its current circle');}
    for(const page of new Set(rows.map(row=>row.page))){
      const group=rows.filter(row=>row.page===page),cx=circle.x+circle.width/2,cy=circle.y+circle.height/2;
      const centres=group.map(row=>({x:row.slot.x+row.slot.width/2,y:row.slot.y+row.slot.height/2}));
      assert.ok(Math.abs(centres.reduce((sum,p)=>sum+p.x,0)/group.length-cx)<=1.5,'actual logo group horizontal centroid shares sphere centre');
      assert.ok(Math.abs(centres.reduce((sum,p)=>sum+p.y,0)/group.length-cy)<=1.5,'actual logo group vertical centroid shares sphere centre');
      const left=Math.min(...group.map(row=>row.slot.x)),right=Math.max(...group.map(row=>row.slot.x+row.slot.width));
      const top=Math.min(...group.map(row=>row.slot.y)),bottom=Math.max(...group.map(row=>row.slot.y+row.slot.height));
      assert.ok(Math.abs((left+right)/2-cx)<=1.5&&Math.abs((top+bottom)/2-cy)<=1.5,'the complete actual logo group is symmetric within the circle');
    }
  }
  return rows;
}
async function loadLogos(f) {
  f.releaseLogos();
  for(const image of await f.page.locator('[data-organization-id] img').all()){await image.evaluate(node=>{const row=node.closest('[data-organization-id]');row?.dispatchEvent(new CustomEvent('artdico:organization-reveal',{bubbles:true,detail:{id:row.id}}));row?.scrollIntoView({block:'center',behavior:'instant'});});await image.evaluate(node=>new Promise(resolve=>{const done=()=>{if(node.closest('.ah-organization-image')?.hidden||node.complete&&node.naturalWidth>0&&node.closest('.ah-organization-image')?.dataset.logoPresentation!=='pending')resolve();else setTimeout(done,10);};done();}));if(await image.isVisible())await image.evaluate(node=>node.decode());}
  await f.page.evaluate(() => document.fonts.ready);
}
// DOM geometry can be correct even when a subset font renders missing Han
// characters as blank advances or generic tofu. Inspect actual font raster ink,
// not font availability APIs; keep characters and bitmaps inside the browser.
async function guestGlyphInk(f) {
  stage = 'actual-han-glyph-ink';
  const coverage = await f.page.evaluate(async () => {
    await document.fonts.ready;
    const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 96;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('PUBLIC_GLYPH_CANVAS_UNAVAILABLE');
    context.textAlign = 'left'; context.textBaseline = 'alphabetic'; context.fillStyle = '#fff';
    const draw = text => {
      context.clearRect(0, 0, canvas.width, canvas.height); context.fillText(text, 24, 64);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data, alpha = new Uint8Array(canvas.width * canvas.height);
      let ink = 0; for (let index = 0; index < alpha.length; index++) { alpha[index] = pixels[index * 4 + 3]; if (alpha[index]) ink++; }
      return { alpha, ink };
    };
    const equalInk = (a, b) => a.ink === b.ink && a.alpha.every((value, index) => value === b.alpha[index]);
    const unavailable = (glyph, markers) => glyph.ink === 0 || markers.some(marker => marker.ink > 0 && equalInk(glyph, marker));
    const fonts = new Map(), seen = new Set();
    let fields = 0, fieldsWithHan = 0, hanOccurrences = 0, checkedGlyphs = 0, blankGlyphs = 0, missingMarkerGlyphs = 0, negativeControls = 0;
    for (const element of document.querySelectorAll('[data-guest-toggle] .ah-guest-name,[data-guest-toggle] .ah-guest-affiliation,[data-guest-toggle] .ah-guest-subtitle')) {
      fields++; const characters = [...element.textContent].filter(character => /\p{Script=Han}/u.test(character));
      if (!characters.length) continue;
      fieldsWithHan++; hanOccurrences += characters.length;
      const style = getComputedStyle(element), font = [style.fontStyle, style.fontWeight, '32px', style.fontFamily].join(' ');
      context.font = font;
      let markers = fonts.get(font);
      if (!markers) {
        // Both a Unicode noncharacter and an unassigned codepoint are tested:
        // platform last-resort fonts may rasterize either as blank or tofu.
        markers = [draw(String.fromCodePoint(0x10ffff)), draw(String.fromCodePoint(0x0378))]; fonts.set(font, markers);
        const blank = draw(' ');
        if (blank.ink !== 0 || !unavailable(blank, markers) || !markers.every(marker => unavailable(marker, markers))) throw new Error('PUBLIC_GLYPH_NEGATIVE_CONTROL_FAILED');
        negativeControls += 3;
      }
      for (const character of characters) {
        const key = JSON.stringify([font, character]); if (seen.has(key)) continue; seen.add(key);
        const glyph = draw(character); checkedGlyphs++;
        if (glyph.ink === 0) blankGlyphs++;
        else if (markers.some(marker => marker.ink > 0 && equalInk(glyph, marker))) missingMarkerGlyphs++;
      }
    }
    return { fields, fieldsWithHan, hanOccurrences, checkedGlyphs, blankGlyphs, missingMarkerGlyphs, fontStacks: fonts.size, negativeControls, canvasPixels: canvas.width * canvas.height, probeSizePx: 32 };
  });
  lastNumericMetrics = { glyphInk: coverage };
  glyphInkChecks.push({ width: f.width, mode: currentMode, exactCapturedSnapshot: currentMode === 'actual', ...coverage });
  assert.ok(coverage.fields > 0 && coverage.fieldsWithHan > 0 && coverage.checkedGlyphs > 0, 'the actual displayed guest fields exercise Han rasterization');
  assert.equal(coverage.blankGlyphs, 0, 'every actual Han glyph must paint visible ink rather than a blank advance');
  assert.equal(coverage.missingMarkerGlyphs, 0, 'actual Han glyph ink must differ from platform missing-codepoint marker bitmaps');
  assert.equal(coverage.negativeControls, coverage.fontStacks * 3, 'each actual font stack rejects blank and missing-codepoint controls');
  stage = 'actual-public-caption';
  return coverage;
}
async function guestText(f, { profiles = guests, allowLongNameAndTitle = false, requireUnclippedNameAndTitle = false } = {}) {
  stage = 'actual-public-caption';
  assert.equal(await f.page.locator('[data-guest-id]').count(), guests.length);
  assert.deepEqual(await f.page.locator('[data-guest-id]').evaluateAll(nodes=>nodes.map(node=>node.dataset.guestId)),ids,'every safe public profile renders in captured order independently of attendance');
  assert.deepEqual(await f.page.locator('[data-guest-id]').evaluateAll(nodes=>nodes.map(node=>({id:node.dataset.guestId,attendance:node.dataset.guestAttendance}))),guests.map(item=>({id:item.id,attendance:item.attendance})),'the DOM attendance annotation matches the unchanged real proof for every profile');
  assert.equal((await f.page.locator('#guests-heading').textContent()).trim(),'嘉宾阵容','the public collection title does not claim attendance confirmation');
  await guestGlyphInk(f);
  const result = [];
  for (const guest of profiles) {
    const card = f.page.locator('#guest-' + guest.id), toggle = card.locator('[data-guest-toggle]');
    const affiliation = guest.company?.trim() || '';
    const expected = guest.title?.trim() || guest.ggjRole?.trim() || '';
    const kind = guest.title?.trim() ? 'title' : guest.ggjRole?.trim() ? 'role' : 'none';
    assert.equal((await toggle.locator('.ah-guest-name').textContent()).trim(), guest.name.trim());
    if (affiliation) { assert.equal((await toggle.locator('.ah-guest-affiliation').textContent()).trim(), affiliation); assert.equal(await toggle.locator('.ah-guest-affiliation').getAttribute('data-affiliation-source'), 'company'); }
    else assert.equal(await toggle.locator('.ah-guest-affiliation').count(), 0);
    if (expected) { assert.equal((await toggle.locator('.ah-guest-subtitle').textContent()).trim(), expected); assert.equal(await toggle.locator('.ah-guest-subtitle').getAttribute('data-subtitle-source'), kind); }
    else assert.equal(await toggle.locator('.ah-guest-subtitle').count(), 0);
    assert.equal(await toggle.getAttribute('aria-label'), [guest.name, affiliation, expected, '嘉宾介绍'].filter(Boolean).join('，'));
    assert.equal(await toggle.locator('.ah-guest-attendance').count(), 0, 'affiliation and title come from separate actual public fields, not invented attendance text');
    const measured = await toggle.evaluate(node => {
      const box = element => { const b = element.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
      return { circle: box(node), text: [...node.querySelectorAll('.ah-guest-name,.ah-guest-affiliation,.ah-guest-subtitle')].map(element => {
        const range = document.createRange(); range.selectNodeContents(element); const first = range.getClientRects()[0];
        return { className: element.className, box: box(element), firstLine: first ? { x: first.x, y: first.y, width: first.width, height: first.height } : null,
        overflowX: getComputedStyle(element).overflowX, overflowY: getComputedStyle(element).overflowY, clientWidth: element.clientWidth, clientHeight: element.clientHeight,
        scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight, font: parseFloat(getComputedStyle(element).fontSize), lineHeight: parseFloat(getComputedStyle(element).lineHeight),
        display: getComputedStyle(element).display, visibility: getComputedStyle(element).visibility, opacity: Number(getComputedStyle(element).opacity) };
      }) };
    });
    lastNumericMetrics = { guestIndex: ids.indexOf(guest.id), ...measured };
    for (const text of measured.text) {
      contained(text.box, measured.circle, 'actual name, affiliation and title stay in their bubble'); assert.ok(!['auto', 'scroll'].includes(text.overflowX) && !['auto', 'scroll'].includes(text.overflowY)); assert.ok(text.scrollWidth <= text.clientWidth + 1);
      assert.ok(text.clientWidth > 0 && text.clientHeight > 0 && text.display !== 'none' && text.visibility === 'visible' && text.opacity > 0, 'each nonempty public field is visibly rendered');
      if (text.className === 'ah-guest-affiliation') {
        assert.ok(Number.isFinite(text.lineHeight) && text.clientHeight >= text.lineHeight - 1 && text.firstLine, 'a clamped company still shows at least one complete line');
        contained(text.firstLine, text.box, 'the first company line glyph box is fully visible even when later lines are clamped');
      }
    }
    nonoverlap(measured.text.map(text => text.box), 'name, company and title rectangles cannot overlap');
    if (!allowLongNameAndTitle && (requireUnclippedNameAndTitle||actualSpellingBoundaryIds.includes(guest.id))) for (const text of measured.text.filter(item => item.className !== 'ah-guest-affiliation')) assert.ok(text.scrollHeight <= text.clientHeight + 1, 'selected actual or explicitly synthetic reference spelling must fit without an inner scroll');
    assert.ok(measured.text[0].font >= (f.width >= 1800 ? 30 : f.width >= 1000 ? 24 : 18), 'names are enlarged at usable responsive sizes');
    if (expected) assert.ok(measured.text.find(text => text.className === 'ah-guest-subtitle').font >= (f.width >= 1800 ? 19 : f.width >= 1000 ? 16 : 14));
    result.push({ id: guest.id, attendance:guest.attendance, affiliationSource: affiliation ? 'company' : 'none', subtitleSource: kind, metrics: measured });
  }
  return result;
}
async function detail(f, guest, { longText = false } = {}) {
  stage = longText ? 'synthetic-long-full-detail' : 'actual-full-detail';
  const card = f.page.locator('#guest-' + guest.id), toggle = card.locator('[data-guest-toggle]'), body = card.locator('.ah-guest-detail-body');
  await f.page.mouse.move(0, 0); await toggle.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const before = await f.page.locator('#booths').evaluate(node => node.getBoundingClientRect().top + scrollY);
  await toggle.focus(); await f.page.keyboard.press('Enter'); assert.equal(await card.locator('details').evaluate(node => node.open), true);
  assert.equal((await body.locator('.ah-guest-detail-name').textContent()).trim(), guest.name.trim());
  assert.equal(await body.locator('.ah-guest-company').filter({ hasText: /^(?:资料待确认|資料待確認)$/u }).count(), 0, 'public introductions omit the internal profile-review label');
  if (guest.company?.trim()) assert.ok((await body.locator('.ah-guest-company').allTextContents()).map(text => text.trim()).includes(guest.company.trim()), 'expanded detail retains the entire published company');
  if (guest.title) assert.equal((await body.locator('.ah-guest-title').textContent()).trim(), guest.title.trim());
  else assert.equal(await body.locator('.ah-guest-title').count(), 0);
  if (guest.ggjRole) assert.equal((await body.locator('.ah-guest-role').textContent()).trim(), guest.ggjRole.trim());
  else assert.equal(await body.locator('.ah-guest-role').count(), 0);
  if (guest.bio) assert.equal((await body.locator('.ah-guest-bio').textContent()).trim(), guest.bio.trim());
  const bounds = await body.evaluate(node => ({ overflowX: getComputedStyle(node).overflowX, overflowY: getComputedStyle(node).overflowY, maxHeight: getComputedStyle(node).maxHeight,
    scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, height: node.getBoundingClientRect().height, scrollTop: node.scrollTop }));
  lastNumericMetrics = { guestIndex: ids.indexOf(guest.id), ...bounds };
  assert.ok(!['auto', 'scroll'].includes(bounds.overflowX) && !['auto', 'scroll'].includes(bounds.overflowY), 'a hidden Linux scrollbar is not proof: computed inner scrolling is forbidden');
  assert.equal(bounds.maxHeight, 'none'); assert.ok(bounds.scrollHeight <= bounds.clientHeight + 1 && bounds.scrollWidth <= bounds.clientWidth + 1, 'full detail content fits the document-flow box');
  assert.notEqual(await body.getAttribute('tabindex'), '0', 'detail is not a second keyboard scroll pane');
  if (f.width < 600) assert.ok(await f.page.locator('#booths').evaluate(node => node.getBoundingClientRect().top + scrollY) > before + 80, 'phone details make room in the main page');
  if (longText) assert.ok(bounds.height > 1000, 'long synthetic text is genuinely rendered in full, not mirrored by a small empty box');
  if (f.width >= 1000) {
    const point = await body.boundingBox(), start = await f.page.evaluate(() => scrollY);
    await f.page.mouse.move(Math.max(10, Math.min(f.width - 10, point.x + point.width / 2)), Math.max(10, Math.min(900, point.y + 32)));
    await f.page.mouse.wheel(0, 240); await f.page.waitForTimeout(180);
    assert.ok(await f.page.evaluate(() => scrollY) > start + 40, 'wheel over a desktop introduction scrolls the main page');
    assert.equal(await body.evaluate(node => node.scrollTop), 0, 'the introduction never consumes an inner scroll');
  }
  await f.page.keyboard.press('Escape'); assert.equal(await card.locator('details').evaluate(node => node.open), false);
  if (f.width < 600 && !longText && guest.id === motionGuest.id) { await toggle.tap(); assert.equal(await card.locator('details').evaluate(node => node.open), true); await toggle.tap(); assert.equal(await card.locator('details').evaluate(node => node.open), false); }
  return { id: guest.id, ...bounds };
}
async function animationState(page, id) {
  return page.locator('#guest-' + id).evaluate(node => ({ visible: document.visibilityState, rect: node.getBoundingClientRect().toJSON(),
    animations: node.getAnimations().map(animation => ({ state: animation.playState, time: animation.currentTime, duration: animation.effect.getTiming().duration,
      iterations: animation.effect.getTiming().iterations === Infinity ? 'infinite' : animation.effect.getTiming().iterations, transform: getComputedStyle(node).transform })) }));
}
async function motion(f) {
  stage = 'actual-waapi-motion';
  const { page } = f, target = page.locator('#guest-' + motionGuest.id), toggle = target.locator('[data-guest-toggle]');
  await page.mouse.move(0, 0); await page.locator('#guests-heading').focus(); await target.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForFunction(id => document.getElementById('guest-' + id)?.getAnimations().some(animation => animation.playState === 'running'), motionGuest.id);
  const moving = await animationState(page, motionGuest.id); await page.waitForTimeout(650); const later = await animationState(page, motionGuest.id);
  await page.waitForTimeout(650); const third = await animationState(page, motionGuest.id);
  lastNumericMetrics = { moving, later, third };
  assert.equal(moving.animations.length, 1); assert.equal(later.animations.length, 1); assert.ok(later.animations[0].time - moving.animations[0].time > 300);
  assert.ok(later.animations[0].duration >= 5000 && later.animations[0].duration <= 10000); assert.equal(later.animations[0].iterations, 'infinite');
  const positions = [moving.rect.y, later.rect.y, third.rect.y], travel = Math.max(...positions) - Math.min(...positions);
  assert.ok(travel > .05 && travel <= 12, 'real bubble positions change gently, not just an unused animation timer');
  async function paused(reason) {
    await page.waitForFunction(id => document.getElementById('guest-' + id)?.getAnimations().every(animation => animation.playState !== 'running'), motionGuest.id);
    const a = await animationState(page, motionGuest.id); await page.waitForTimeout(220); const b = await animationState(page, motionGuest.id);
    assert.equal(a.animations.length, 1); assert.equal(b.animations[0].state, 'paused'); assert.ok(Math.abs(b.animations[0].time - a.animations[0].time) < 2, reason + ' freezes real WAAPI time');
  }
  async function resumed() { await page.waitForFunction(id => document.getElementById('guest-' + id)?.getAnimations().some(animation => animation.playState === 'running'), motionGuest.id); }
  const aim = await toggle.boundingBox(); await page.mouse.move(aim.x + aim.width / 2, aim.y + aim.height / 2); await paused('hover/open');
  const bubble = await toggle.boundingBox(), body = await target.locator('.ah-guest-detail-body').boundingBox();
  await page.mouse.move(bubble.x + bubble.width / 2, bubble.y + bubble.height - 1); await page.mouse.move(bubble.x + bubble.width / 2, (bubble.y + bubble.height + body.y) / 2);
  await page.waitForTimeout(60); await page.mouse.move(Math.max(body.x + 12, Math.min(body.x + body.width - 12, bubble.x + bubble.width / 2)), body.y + 12);
  await page.waitForTimeout(180); assert.equal(await target.locator('details').evaluate(node => node.open), true, 'hover remains usable across the bubble/card gap');
  await page.keyboard.press('Escape'); await page.mouse.move(0, 0); await page.locator('#guests-heading').focus(); await resumed();
  await toggle.focus(); await paused('keyboard focus'); await page.keyboard.press('Enter'); await paused('open detail');
  await page.keyboard.press('Escape'); await page.locator('#guests-heading').focus(); await resumed();
  await page.locator('.ah-footer').evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' })); await paused('actual offscreen intersection');
  await target.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' })); await resumed();
  // Playwright forces page visibility in headless Chromium. This explicitly
  // synthetic policy signal controls the REAL built WAAPI animation, not OS tabs.
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  await paused('synthetic hidden policy signal');
  await page.evaluate(() => { delete document.hidden; delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); }); await resumed();
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForTimeout(100);
  assert.equal((await animationState(page, motionGuest.id)).animations.length, 0, 'real prefers-reduced-motion cancels the animation');
  const still = await target.boundingBox(); await page.waitForTimeout(300); const stillLater = await target.boundingBox(); assert.ok(Math.abs(still.y - stillLater.y) < .5);
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await resumed();
  await page.evaluate(() => { for (let i = 0; i < 3; i++) dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
  await page.waitForTimeout(100); assert.equal((await animationState(page, motionGuest.id)).animations.length, 1, 'returning to the page never stacks float animations');
  return { realWAAPI: true, runningTimeAdvanced: true, hoverFocusOpenAndOffscreenPaused: true, reducedMotionCancelledAndReturnResumed: true,
    hiddenPolicy: { explicitlySyntheticSignal: true, realWAAPIPaused: true, realOSOrTabOcclusionClaimed: false } };
}
async function shots(f, prefix) {
  if (![390, 1920].includes(f.width)) return [];
  await f.page.mouse.move(0, 0); await f.page.keyboard.press('Escape'); await f.page.locator('#guests-heading').focus(); await f.page.emulateMedia({ reducedMotion: 'reduce' });
  await f.page.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight * .75) { scrollTo({ top: y, behavior: 'instant' }); await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))); } });
  await f.page.waitForLoadState('networkidle'); const paths = [];
  for (const [name, selector] of [['guests', '#guests'], ['organizations', '#booths']]) { const path = resolve(evidence, prefix + '-' + name + '-' + f.width + '.png'); await f.page.locator(selector).screenshot({ path }); paths.push(path); }
  return paths;
}
let failure;
try {
  for (const width of [1920, 1440, 390, 320]) {
    currentWidth = width; currentMode = 'actual'; stage = 'navigate';
    const f = await fixture(width, { holdLogos: true });
    try {
      await f.page.goto(SITE + '/', { waitUntil: 'domcontentloaded' }); await f.page.locator('[data-organization-id]').first().waitFor();
      const before = await organizationBounds(f, { loaded: false }); await loadLogos(f); const after = await organizationBounds(f);
      assert.equal(after.filter(row => /^\/_astro\/organization-[^/]+\.(?:png|webp)$/u.test(new URL(row.src, SITE).pathname)).length, 7, 'all seven current captured logo identities use the approved white variants');
      assert.equal(after.filter(row=>row.artwork==='reference').length,7,'the seven reviewed variants remain unchanged');
      for(const row of after){
        const original=snapshot.content.organizations.find(item=>item.id===row.id);assert.ok(original,'every actual organization maps to the same captured ID');
        const fullNameMatches=await f.page.locator('[data-organization-id="'+row.id+'"]').evaluate((node,name)=>{const card=node.querySelector('.ah-organization-card');return node.querySelector('h3').textContent===name&&card.getAttribute('aria-label')===name+(card.tagName==='A'?' · 打开组织页面（新窗口）':'');},original.name);
        assert.equal(fullNameMatches,true,'hidden captions and accessible names retain the complete name from this exact capture');
      }
      for(const row of after.filter(row=>row.artwork!=='reference')){
        const original=snapshot.content.organizations.find(item=>item.id===row.id);
        assert.ok(original&&new URL(row.source,SITE).pathname===original.logoUrl,'every additional organization derives only from its exact captured upload');
        assert.ok(['published-white','published-name'].includes(row.artwork),'additional uploads use white masks or readable white names');
        assert.equal(row.accessibleNameMatches,true,'additional organizations retain their actual complete accessible name');
        assert.equal(row.nameVisible,row.frameHidden,'additional organizations show a name only when the logo cannot be displayed');
      }
      for (const [key, label] of [['bu', /bournemouth|伯恩|\bbu\b/iu], ['szdx', /深圳|shenzhen/iu], ['teesside', /teesside|提赛德/iu]]) {
        const row = after.find(item => item.reference === key), original = snapshot.content.organizations.find(item => item.id === row?.id);
        assert.ok(original && label.test(original.name), 'an explicit campus/logo binding must match its actual published organization label');
      }
      defaultReferenceLogosRendered = 7;
      before.forEach((row, index) => { assert.ok(Math.abs(row.slot.width - after[index].slot.width) <= 1 && Math.abs(row.slot.height - after[index].slot.height) <= 1, 'image intrinsic size cannot resize its independent slot'); });
      const text = await guestText(f), details = [];
      for (const guest of guests) details.push(await detail(f, guest));
      const animation = width === 1920 ? await motion(f) : null; await noOverflow(f);
      const renderedGuestIds=await f.page.locator('[data-guest-id]').evaluateAll(nodes=>nodes.map(node=>node.dataset.guestId));
      const renderedAttendance=await f.page.locator('[data-guest-id]').evaluateAll(nodes=>({attending:nodes.filter(node=>node.dataset.guestAttendance==='attending').length,pending:nodes.filter(node=>node.dataset.guestAttendance==='pending').length}));
      assert.deepEqual(renderedGuestIds,safePublicIds,'each actual viewport retains the complete safe captured guest ID collection');
      assert.deepEqual(renderedAttendance,{attending:attendanceProof.displayedAttending,pending:attendanceProof.displayedPending},'actual DOM attendance counts come only from the original captured proof');
      reports.push({ name: 'actual-public-' + width, width, exactCapturedSnapshot: true, exactRawImageHashesVerified: true, renderedGuestIds,
        guestAttendance:{source:'unchanged captured proof',...renderedAttendance},bounds: after, text, details, animation, screenshots: await shots(f, 'actual') });
    } finally { f.releaseLogos(); await f.context.close(); }
  }
  for (const mode of ['raw-generic', 'adversarial']) for (const width of [1920, 1440, 390, 320]) {
    currentWidth = width; currentMode = mode; stage = 'navigate';
    const f = await fixture(width, { mode, reducedMotion: 'reduce' });
    try {
      await f.page.goto(SITE + '/', { waitUntil: 'networkidle' }); await loadLogos(f); const bounds = await organizationBounds(f);
      if (mode === 'raw-generic') assert.ok(bounds.every(row => logoPaths.has(new URL(row.source, SITE).pathname)), 'generic compatibility scenario actually renders every captured upload byte');
      else assert.ok(bounds.every(row => synthetic.some(image => image.path === new URL(row.source, SITE).pathname)), 'changed hashes fall back to actual new artwork instead of silently retaining the old white reference variant');
      assert.ok(bounds.every(row=>['published-white','published-name'].includes(row.artwork)), 'unknown identities and future hashes derive white presentation from the actual new upload or retain a readable name');
      let orderRefresh=null;
      if(mode==='raw-generic'){
        const initialIds=f.publishedOrganizations.map(item=>item.id),originalSources=new Map(bounds.map(row=>[row.id,new URL(row.source,SITE).pathname]));
        const firstLink=f.page.locator('[data-organization-id] a.ah-organization-card').first();
        let focusSelector,focusScope;
        if(await firstLink.count()){
          const organizationId=await firstLink.evaluate(node=>node.closest('[data-organization-id]').id);
          await firstLink.evaluate(node=>{const row=node.closest('[data-organization-id]');row.dispatchEvent(new CustomEvent('artdico:organization-reveal',{bubbles:true,detail:{id:row.id}}));row.scrollIntoView({block:'center',behavior:'instant'});});
          focusSelector='#'+organizationId+' a.ah-organization-card';focusScope='existing organization link';
        }else{focusSelector='#guest-'+motionGuest.id+' [data-guest-toggle]';focusScope='existing guest disclosure because this capture has no organization links';}
        await f.page.locator(focusSelector).focus();
        await f.refresh(content=>{genericOrganizationIdentities(content);content.organizations.reverse();});
        assert.equal(await f.page.locator(focusSelector).evaluate(node=>document.activeElement===node),true,'the same existing public control retains focus immediately after order refresh');
        await loadLogos(f);const reorderedBounds=await organizationBounds(f);
        assert.deepEqual(reorderedBounds.map(row=>row.id),[...initialIds].reverse(),'the same captured raw images really reverse in DOM and slot order');
        for(const row of reorderedBounds)assert.equal(new URL(row.source,SITE).pathname,originalSources.get(row.id),'reorder uses exactly the same captured raw source for each organization');
        assert.ok(reorderedBounds.some(row=>{const before=bounds.find(item=>item.id===row.id);return before.slotIndex!==row.slotIndex&&(Math.abs(before.slot.x-row.slot.x)>1.5||Math.abs(before.slot.y-row.slot.y)>1.5);}),'same raw images really move to different physical slots after reorder');
        orderRefresh={explicitlySyntheticOrderOnlyPhase:true,initialIds,reorderedIds:reorderedBounds.map(row=>row.id),sameRawImageBytes:true,rawImageSha256:reorderedBounds.map(row=>new URL(row.source,SITE).pathname.split('/').at(-1).split('.')[0]),focusScope,sameControlFocusImmediatelyAfterRefresh:true,bounds:reorderedBounds};
      }
      await noOverflow(f); reports.push({ name: mode + '-' + width, width, explicitlySyntheticPublicationVariant: true, exactOriginalUploadBytes: mode === 'raw-generic', bounds, orderRefresh, screenshots: await shots(f, mode) });
    } finally { await f.context.close(); }
  }
  const f = await fixture(320, { reducedMotion: 'reduce' });
  currentWidth = 320; currentMode = 'long-detail'; stage = 'navigate';
  try {
    await f.page.goto(SITE + '/', { waitUntil: 'networkidle' });
    // All safe captured profiles already received actual four-width checks.
    // These additional spellings are explicit synthetic text substitutions on
    // one displayed ID; the actual proof and the other profiles stay unchanged.
    for(const sample of spellingBoundaryProfiles){
      const boundary={...syntheticBase,name:sample.name,company:syntheticBase.status==='confirmed'&&!sample.company?.trim()?syntheticBase.company:sample.company,title:sample.title??'',ggjRole:sample.ggjRole??''};
      await f.refresh(content=>{const index=content.guests.findIndex(item=>item.id===motionGuest.id);content.guests[index]=boundary;});
      await guestText(f,{profiles:[boundary],requireUnclippedNameAndTitle:true});await detail(f,boundary);
    }
    const long = { ...syntheticBase, name: 'SYNTHETICLONGNAME'.repeat(10).slice(0, 120), company: '合成完整公开单位'.repeat(24).slice(0, 160), title: '合成完整公开职称'.repeat(30).slice(0, 200), bio: '合成长简介保留全文，不生成内部滚动区域。\n'.repeat(150).slice(0, 3900) };
    await f.refresh(content => { const index = content.guests.findIndex(item => item.id === motionGuest.id); content.guests[index] = long; });
    const text = await guestText(f, { profiles: [long], allowLongNameAndTitle: true });
    const result = await detail(f, long, { longText: true }); await noOverflow(f);
    const roleOnly = { ...syntheticBase, company: '合成独立单位', title: '', ggjRole: '合成角色' };
    await f.refresh(content => { const index = content.guests.findIndex(item => item.id === motionGuest.id); content.guests[index] = roleOnly; });
    await guestText(f, { profiles: [roleOnly] }); await detail(f, roleOnly);
    const companyOnly = { ...syntheticBase, company: '合成只有单位', title: '', ggjRole: '' };
    await f.refresh(content => { const index = content.guests.findIndex(item => item.id === motionGuest.id); content.guests[index] = companyOnly; });
    await guestText(f, { profiles: [companyOnly] }); await detail(f, companyOnly);
    const empty={...syntheticBase,company:syntheticBase.status==='confirmed'?syntheticBase.company:'',title:'',ggjRole:''};
    await f.refresh(content => { const index = content.guests.findIndex(item => item.id === motionGuest.id); content.guests[index] = empty; });
    await guestText(f, { profiles: [empty] }); await detail(f, empty); await noOverflow(f);
    assert.equal((await animationState(f.page, motionGuest.id)).animations.length, 0, 'initial real reduced-motion preference creates no float');
    reports.push({ name: 'long-detail-and-initial-reduced-motion', width: 320, explicitlySyntheticTextVariant:true,syntheticReferenceSpellingBoundaries:spellingBoundaryProfiles.length,actualAttendanceProofUnchanged:true,profileStatusUnchanged:true,emptyCompanyFieldTested:empty.company==='',emptyPositionAndRoleFieldsTested:true,fullTextRendered: true, separateCompanyAndTitle: true, roleFallbackAndEmptyFields: true, text, result });
  } finally { await f.context.close(); }
  assert.equal(rawImageRequests.size, actualMedia.size, 'every actual uploaded organization image was rendered in the raw compatibility scenarios'); assert.deepEqual(pageErrors, []);
  assert.equal(reports.length, 13, 'all actual, raw-upload, adversarial and long-text scenarios must complete');
} catch (error) { failure = { message: error.message, stack: error.stack }; }
finally {
  await browser.close(); activeBrowser = null; const html = await readFile(resolve(dist, 'index.html')), info = await stat(resolve(dist, 'index.html'));
  const actualReports = reports.filter(item => item.exactCapturedSnapshot === true);
  const actualFieldCoverage = {
    publicProfileCardsChecked:actualReports.reduce((total,item)=>total+item.text.length,0),
    companyFieldsChecked: actualReports.reduce((total, item) => total + item.text.filter(text => text.affiliationSource === 'company').length, 0),
    titleFieldsChecked: actualReports.reduce((total, item) => total + item.text.filter(text => text.subtitleSource === 'title').length, 0),
    roleFieldsChecked: actualReports.reduce((total, item) => total + item.text.filter(text => text.subtitleSource === 'role').length, 0),
    emptyCompanyFieldsChecked:actualReports.reduce((total,item)=>total+item.text.filter(text=>text.affiliationSource==='none').length,0),
    emptySubtitleFieldsChecked:actualReports.reduce((total,item)=>total+item.text.filter(text=>text.subtitleSource==='none').length,0),
    fullGuestDetailsChecked: actualReports.reduce((total, item) => total + item.details.length, 0),
  };
  const report = { ok: !failure, passedCases: reports.length, expectedCases: 13, syntheticBusinessWrites: 0, realNetworkRequests: 0, mailRequests: 0,
    source, dist, testScriptSha256, gitHeadAtRun: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim(), htmlMtime: info.mtime.toISOString(), publicHtmlSha256: sha(html),
    capture: { directory: capture, capturedAt: manifest.capturedAt, anonymous: true, source: manifest.source, sourceCommit: manifest.sourceCommit, snapshotSha256: manifest.snapshot.sha256,
      revision:snapshot.revision,guestCount:rawGuestCount,rawGuestCount,visibleGuestCount,attendanceProof,organizationCount: snapshot.content.organizations.length, mediaHashes: manifest.media.map(item => item.sha256) },
    servedAssets: Object.fromEntries([...servedAssets].sort()), actualRawImagesRendered: rawImageRequests.size, defaultReferenceLogosRendered, actualFieldCoverage, glyphInkChecks,
    uncapturedPublicMediaRequestsStubbed: uncapturedMediaRequestCount,uncapturedPublicMediaUniquePathsStubbed:uncapturedMediaRequests.size, actualMediaScope: 'Every safe public guest profile receives four-width DOM text and detail checks; attendance is read only from the unchanged captured proof. Every organization upload is captured. Guest photos and work media outside that capture receive intercepted 404s; their original image bytes are not visually verified.',
    syntheticImageVariants: synthetic.map(({ kind, width, height, id }) => ({ kind, width, height, id })), reports, pageErrors, ...(failure ? { failure } : {}) };
  await writeFile(resolve(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const summary = { ok: report.ok, cases: report.passedCases, expectedCases: 13, actualFixture: true, publicHtmlSha256: report.publicHtmlSha256, snapshotSha256: report.capture.snapshotSha256,
    sourceCommit: report.gitHeadAtRun, captureSourceCommit: manifest.sourceCommit, actualRawLogosTested: report.actualRawImagesRendered, defaultReferenceLogosRendered,
    guestCount:rawGuestCount,rawGuestCount,visibleGuestCount,actualGuestCardsChecked:actualReports.reduce((total,item)=>total+item.text.length,0),actualReferenceSpellingsChecked:actualSpellingBoundaryIds.length,attendanceProof,organizationCount: snapshot.content.organizations.length, pageErrorCount: pageErrors.length,
    actualFieldCoverage,
    actualHanGlyphInk: { cases: glyphInkChecks.filter(item => item.exactCapturedSnapshot).length, checkedGlyphs: glyphInkChecks.filter(item => item.exactCapturedSnapshot).reduce((total, item) => total + item.checkedGlyphs, 0), blankGlyphs: glyphInkChecks.reduce((total, item) => total + item.blankGlyphs, 0), missingMarkerGlyphs: glyphInkChecks.reduce((total, item) => total + item.missingMarkerGlyphs, 0), negativeControls: glyphInkChecks.reduce((total, item) => total + item.negativeControls, 0) },
    uncapturedPublicMediaRequestsStubbed: uncapturedMediaRequestCount,uncapturedPublicMediaUniquePathsStubbed:uncapturedMediaRequests.size,
    ...(failure ? { failure: { code: 'PUBLIC_VISUAL_ASSERTION_FAILED', stage, width: currentWidth, mode: currentMode,
      location: /bubbles-logo-bounds-smoke\.mjs:\d+:\d+/u.exec(failure.stack)?.[0] ?? null }, numericMetrics: lastNumericMetrics } : {}) };
  process.stdout.write((report.ok ? 'Actual public visual browser verified: ' : 'Actual public visual browser failed: ') + JSON.stringify(summary) + '\n');
}
if (failure) process.exitCode = 1;
}
await main().catch(async error => {
  await activeBrowser?.close().catch(() => {});
  process.stdout.write('Actual public visual browser failed: ' + JSON.stringify({ ok: false, cases: 0, expectedCases: 13, actualFixture: false, failure: { code: 'PUBLIC_VISUAL_PREFLIGHT_FAILED',
    type: ['AssertionError', 'Error', 'SyntaxError', 'TypeError'].includes(error.name) ? error.name : 'Error',
    location: /bubbles-logo-bounds-smoke\.mjs:\d+:\d+/u.exec(error.stack ?? '')?.[0] ?? null } }) + '\n');
  process.exitCode = 1;
});
