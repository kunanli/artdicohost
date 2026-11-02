// Historical reference geometry over synthetic publications, not production
// upload proof. Actual uploads are covered by bubbles-logo-bounds-smoke.mjs.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const project = fileURLToPath(new URL('../../', import.meta.url));
const source = resolve(process.env.ARTDICO_SOURCE_DIRECTORY || project);
const dist = resolve(process.env.ARTDICO_DIST_DIRECTORY || resolve(source, 'dist'));
const evidence = resolve(process.env.ARTDICO_REFERENCE_EVIDENCE_DIRECTORY || resolve(project, '.local-data/browser-evidence/home-reference'));
const { createInitialContent } = await import(pathToFileURL(resolve(source, 'src/config/content.mjs')));
const { toPublicContent, validateContent } = await import(pathToFileURL(resolve(source, 'shared/content-schema.mjs')));
const { publicContentEnvelope } = await import(pathToFileURL(resolve(source, 'src/lib/public-content-refresh.mjs')));
const SITE = 'https://artdico.host', API = 'https://api.artdico.host', PRIVATE = 'SYNTHETIC_REFERENCE_PRIVATE_NEVER_PUBLIC';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const testScriptSha256 = sha(await readFile(fileURLToPath(import.meta.url)));
const referencePath = resolve(source, 'FrontEnd_Resource/落地页.png'), referenceBytes = await readFile(referencePath);
const REFERENCE = Object.freeze({
  path: referencePath, sha256: 'ff5b62dfadc80e31a6af0eb3b08d23a28e4dbfdd047c0d65f1953da2b6366485', width: 1921, height: 19362,
  // Purple-ring pixel bounds in the PNG, inclusive: x282..501,652..871,
  // 1022..1241,1392..1611; first row y5293..5512, third y6035..6254.
  guestDiameter: 220, guestFirstCenter: 392, guestColumnStep: 370, guestRowStep: 371, guestColumns: 4,
  // White glyph bounds x281..553/y5030..5094 and x284..561/y6721..6785.
  // 65px glyph height corresponds approximately to 72px Noto Sans SC CSS type.
  headingGlyphHeight: 65, headingCssSizeEstimate: 72, headingLeft: 281,
  dividerLeft: 140, dividerWidth: 1652, guestDividerToCircle: 137,
  // Outer circle edge x256..1663/y6990..8397, with heading divider y6854.
  planetDiameter: 1408, planetLeft: 256, organizationDividerToPlanet: 136,
  organizationLogoWhiteBounds: [[581, 7146, 930, 7265], [1021, 7147, 1310, 7264], [399, 7388, 634, 7507],
    [713, 7387, 885, 7504], [1011, 7380, 1120, 7526], [1305, 7364, 1440, 7534], [355, 7602, 630, 7706]],
  organizationMiddleRowStagger: 24,
  organizationKeys: ['gamezone', 'igda', 'szdx', 'bu', 'pengyou', 'g4c', 'teesside'],
  programSwatchLeft: [276, 859, 1303],
  method: 'Original PNG pixel runs and edge samples; desktop ratios use viewport/1921. Glyph-to-CSS size is an explicit font-metric estimate.',
  limitation: 'Geometry and manually reviewable screenshots; no full-page pixel-diff or pixel-perfect equivalence claim.',
});
// The user now requires both company and position beneath each name. These
// approved control sizes intentionally exceed the source's 220px bubbles;
// source spacing and all unrelated reference measurements remain separate.
const GUEST_INFORMATION_LAYOUT = Object.freeze({
  reason: 'Three separate visible fields: name, company and actual position.',
  originalSourceDiameter: REFERENCE.guestDiameter,
  desktopDiameter: 'min(19.270833vw - 8px, clamp(224px, 13.541667vw, 260px)); track capped at 370px',
  mobileDiameter: 'min(220px, (viewport - 2 * page padding - 20px column gap) / 2); page padding 20px at 320 and 24px at 390',
  desktopDiameterByViewport: { 1920: 260, 1440: 224 },
  mobilePaddingByViewport: { 390: 24, 320: 20 },
});
assert.equal(sha(referenceBytes), REFERENCE.sha256, 'geometry measurements must refer to the unchanged original image');
assert.equal(referenceBytes.readUInt32BE(16), REFERENCE.width); assert.equal(referenceBytes.readUInt32BE(20), REFERENCE.height);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0KFjAwMDAxMDAgKAAGOQBVgs9CEsAAAAASUVORK5CYII=','base64');
const coverId = sha(png) + '.png', missingId = 'b'.repeat(64) + '.png';
const media = new Map([[coverId, png]]), logoSources = [];
for (const name of ['yxqd.png', 'igdasz.png', 'szdx.png', 'BU logo.png', 'pygw.png', 'hk.png', 'Teessi.png']) {
  const path = resolve(source, 'FrontEnd_Resource/参与组织logo', name), bytes = await readFile(path), id = sha(bytes) + '.png';
  media.set(id, bytes); logoSources.push({ path, sha256: sha(bytes), id });
}
const artworkSources = [];
for (const name of ['Youliya.png', 'Shaojiaqi.png']) {
  const path = resolve(source, 'FrontEnd_Resource/游戏作品展示样本', name), bytes = await readFile(path), id = sha(bytes) + '.png';
  media.set(id, bytes); artworkSources.push({ path, sha256: sha(bytes), id });
}
const guestId = index => 'synthetic-reference-guest-' + index;
const organizationId = index => 'synthetic-reference-organization-' + index;
const organizationNames = ['游戏奇点', 'IGDA 深圳', '深圳大学艺术学部', 'Bournemouth University', '鹏游港湾', 'G4C HK', 'Teesside University'];
const organizationInputOrder = [5, 4, 0, 1, 3, 6, 2]; // Existing publication-style order; renderer must explicitly sort known public labels.
const names = ['合成英文嘉宾 Alex', '合成嘉宾乙', 'Synthetic Enki', '合成嘉宾丁', 'Synthetic Wilson', '合成嘉宾己', 'Synthetic Nelson', 'Synthetic PingYao', '合成嘉宾九'];
function rawFixture({ brokenImages = false } = {}) {
  const content = createInitialContent();
  content.guests = names.map((name, index) => ({ id: guestId(index), name, company: '合成公开创作组织', ggjRole: '',
    portraitId: brokenImages && index === 0 ? missingId : '', status: 'confirmed', publicConsent: true, internalNotes: PRIVATE,
    title: '合成创作者', bio: '这是一段合成公开资料简介，用于检查姓名气泡和原生展开交互。', website: 'https://example.invalid/synthetic-public-profile', publicRoles: ['guest'] }));
  content.organizations = organizationInputOrder.map(index => ({ id: organizationId(index), name: organizationNames[index],
    logoId: brokenImages && index === 6 ? missingId : logoSources[index].id, website: index === 0 ? 'https://example.invalid/synthetic-organization' : '',
    participation: index % 2 ? 'attendee' : 'exhibitor', status: index === 5 ? 'pending' : index === 6 ? 'withdrawn' : 'confirmed', publicConsent: true, internalNotes: PRIVATE }));
  content.booths = [];
  content.sessions = [
    { id: 'synthetic-reference-a', zone: 'A', start: '10:00', end: '11:00', title: '合成公开交流场次 A', format: 'talk', guestId: guestId(0), speakerName: '', speakerStatus: 'pending', status: 'scheduled', internalNotes: PRIVATE },
    { id: 'synthetic-reference-b', zone: 'B', start: '14:00', end: '15:00', title: '合成公开交流场次 B', format: 'talk', guestId: guestId(1), speakerName: '', speakerStatus: 'pending', status: 'scheduled', internalNotes: PRIVATE },
    { id: 'synthetic-reference-c', zone: 'C', start: '16:00', end: '17:00', title: '合成作品分享 C', format: 'showcase', guestId: '', speakerName: '', speakerStatus: 'pending', status: 'scheduled', internalNotes: PRIVATE },
  ];
  content.showcases = ['student', 'indie'].map((kind, index) => ({ id: 'synthetic-reference-work-' + index, kind,
    title: index ? '合成独立游戏作品' : '合成学生三维创作', teamName: '合成创作团队', summary: '合成公开作品资料；展示形式与实际安排分别核对。',
    coverId: brokenImages && index === 0 ? missingId : artworkSources[index].id, status: 'confirmed', responseStatus: 'attending', publicConsent: true, participationForms: [], boothId: '', sessionId: '',
    organizationId: organizationId(0), school: PRIVATE, email: 'private@example.invalid', wechat: PRIVATE, contactName: PRIVATE,
    memberCount: 2, materialLinks: '', internalNotes: PRIVATE }));
  content.event.presentation.faqItems = [{ id: 'synthetic-reference-faq', question: '合成公开问答？', answer: '公开说明保持可读；通知、名额与公开资料分别核对。' }];
  return content;
}
function publication(raw, mode) {
  const checked = validateContent(raw); assert.equal(checked.valid, true, JSON.stringify(checked.errors));
  const options = mode === 'empty' ? { guestAttendance: { schemaVersion: 1, sourceRevision: 12, confirmedGuestIds: [] } }
    : mode === 'proved' ? { guestAttendance: { schemaVersion: 1, sourceRevision: 12, confirmedGuestIds: [guestId(0)] } } : {};
  const content = toPublicContent(raw, options);
  if (mode === 'corrupt') content.guestAttendance = { schemaVersion: 1, sourceRevision: 12, confirmedGuestIds: ['not-a-published-profile'] };
  const envelope = { revision: 1, publishedAt: '2026-11-01T12:00:00.000Z', content };
  assert.equal(Boolean(publicContentEnvelope(envelope)), mode !== 'corrupt', 'fixture must exercise the real public envelope boundary');
  assert.doesNotMatch(JSON.stringify(content), /SYNTHETIC_REFERENCE_PRIVATE|private@example/u);
  if (mode === 'legacy') assert.equal(Object.hasOwn(content, 'guestAttendance'), false, 'legacy proof is genuinely absent, not fabricated');
  return content;
}
const mime = path => ({ html: 'text/html; charset=utf-8', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', woff2: 'font/woff2', ico: 'image/x-icon' })[extname(path).slice(1)] || 'application/octet-stream';
const { chromium } = await import(process.env.ARTDICO_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ executablePath: process.env.ARTDICO_CHROMIUM_BINARY || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
// A synthetic transparent dark mark exercises uploaded artwork without borrowing
// the real additional organization's identity or pretending to capture its bytes.
const syntheticLogoContext=await browser.newContext();
const syntheticLogoPage=await syntheticLogoContext.newPage();
const syntheticLogoSources=await syntheticLogoPage.evaluate(()=>['transparent-black','transparent-blue','opaque-white','opaque-black','opaque-complex','mixed-transparent-panel'].map(kind=>{
  const canvas=document.createElement('canvas');canvas.width=240;canvas.height=96;
  const context=canvas.getContext('2d'),opaque=kind.startsWith('opaque'),background=kind==='opaque-black'?'#000':'#fff';
  if(opaque){context.fillStyle=background;context.fillRect(0,0,240,96);}
  context.fillStyle=kind==='opaque-black'?'#fff':kind==='transparent-blue'?'#164bb7':'#080808';
  context.fillRect(24,16,192,64);
  if(opaque){context.fillStyle=background;context.fillRect(72,32,96,32);}else context.clearRect(72,32,96,32);
  if(kind==='opaque-complex'){for(const [x,y,color]of[[0,0,'#c00'],[120,0,'#0c0'],[0,48,'#00c'],[120,48,'#fff']]){context.fillStyle=color;context.fillRect(x,y,120,48);}}
  if(kind==='mixed-transparent-panel'){context.clearRect(0,0,240,96);context.fillStyle='#fff';context.fillRect(5,5,230,86);context.fillStyle='#000';context.fillRect(24,16,192,64);context.fillStyle='#fff';context.fillRect(72,32,96,32);}
  return {kind,base64:canvas.toDataURL('image/png').split(',')[1]};
}));
await syntheticLogoContext.close();
const syntheticLogos=new Map(syntheticLogoSources.map(item=>{const bytes=Buffer.from(item.base64,'base64'),id=sha(bytes)+'.png';media.set(id,bytes);return [item.kind,{kind:item.kind,id}];}));
const syntheticLogoByWidth=new Map([320,390,1440,1920].map((width,index)=>[width,syntheticLogos.get(['transparent-black','transparent-blue','opaque-white','opaque-black'][index])]));
const reports = [], pageErrors = [], servedAssets = new Map();
await mkdir(evidence, { recursive: true });
async function fixture(width, { mode = 'legacy', brokenImages = false, javascript = true } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, isMobile: width < 600, hasTouch: width < 600, javaScriptEnabled: javascript, reducedMotion: 'reduce' });
  const page = await context.newPage(), calls = [], raw = rawFixture({ brokenImages }); let currentMode = mode, revision = 1;
  const html = await readFile(resolve(dist, 'index.html'), 'utf8');
  const titleImagePaths = new Set([...html.matchAll(/<img\b[^>]*\bdata-home-title-image\b[^>]*>/gu)].map(match => {
    const src = /\bsrc="([^"]+)"/u.exec(match[0]); assert.ok(src, 'built title art has its actual source URL'); return new URL(src[1], SITE).pathname;
  }));
  page.setDefaultTimeout(12000); page.on('pageerror', error => pageErrors.push({ width, mode, message: error.message }));
  await context.addCookies([{ name: 'synthetic_staff', value: PRIVATE, domain: new URL(API).hostname, path: '/', httpOnly: true, secure: true, sameSite: 'Strict' }]);
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    assert.ok([SITE, API].includes(url.origin), 'all origins must be intercepted: ' + url.origin);
    assert.equal(request.method(), 'GET', 'this homepage verification never writes or sends mail');
    calls.push({ origin: url.origin, path: url.pathname, method: request.method() });
    if (url.origin === API) {
      assert.equal(request.headers().cookie, undefined, 'public reads omit available staff cookies'); assert.equal(request.headers().authorization, undefined);
      if (url.pathname === '/api/public/content') return route.fulfill({ status: currentMode === 'unavailable' ? 503 : 200, contentType: 'application/json',
        headers: { 'access-control-allow-origin': SITE }, body: currentMode === 'unavailable' ? '{}' : JSON.stringify({ revision, publishedAt: new Date(Date.UTC(2026, 10, 1, 12, 0, revision)).toISOString(), content: publication(raw, currentMode) }) });
      if (url.pathname.startsWith('/api/public/portraits/')) {
        const id = url.pathname.split('/').at(-1); assert.ok(media.has(id) || id === missingId); assert.equal(request.headers().referer, undefined);
        return route.fulfill(media.has(id) ? { status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': SITE }, body: media.get(id) } : { status: 404, body: '' });
      }
      assert.equal(url.pathname, '/api/admin/registration/config', 'no other API, recipient, token or business endpoint is reachable');
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': SITE }, body: JSON.stringify({ enabled: false, reason: 'closed' }) });
    }
    assert.equal(url.pathname.startsWith('/api/'), false);
    if (brokenImages && titleImagePaths.has(url.pathname)) return route.fulfill({ status: 404, body: '' });
    const path = url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname, file = resolve(dist, '.' + path);
    assert.ok(file.startsWith(dist + '/'));
    try { const bytes = await readFile(file); servedAssets.set(path, sha(bytes)); return route.fulfill({ status: 200, contentType: mime(file), body: bytes }); }
    catch { return route.fulfill({ status: 404, body: '' }); }
  });
  async function refresh(nextMode, change) {
    if (change) change(raw);
    currentMode = nextMode; revision++; await page.waitForTimeout(1100);
    const received = page.waitForResponse(response => response.url() === API + '/api/public/content');
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await received; await page.waitForTimeout(250);
  }
  return { width, context, page, calls, refresh, titleImagePaths };
}
const noOverflow = async f => assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no horizontal overflow at ' + f.width + 'px');
function near(actual, expected, tolerance, description) { assert.ok(Math.abs(actual - expected) <= tolerance, `${description}: actual=${actual.toFixed(2)}, reference=${expected.toFixed(2)}, tolerance=${tolerance.toFixed(2)}`); }
async function mobileOrganizationCircle(f,expected){
  const value=await f.page.evaluate(()=>{const rect=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};return{circle:rect(document.querySelector('[data-organizations-planet]')),rows:[...document.querySelectorAll('[data-organization-id]')].filter(row=>!row.hidden).map(row=>({id:row.id,slot:rect(row),card:rect(row.querySelector('.ah-organization-card')),frame:row.querySelector('.ah-organization-image')&&!row.querySelector('.ah-organization-image').hidden?rect(row.querySelector('.ah-organization-image')):null,image:row.querySelector('.ah-organization-image:not([hidden]) img')?rect(row.querySelector('img')):null}))};});
  near(value.circle.width,value.circle.height,1,'mobile planet remains a true circle');assert.equal(value.rows.length,expected);
  const cx=value.circle.x+value.circle.width/2,cy=value.circle.y+value.circle.height/2,r=value.circle.width/2;
  for(const row of value.rows){assert.ok(row.card.width>=44&&row.card.height>=44,'every mobile organization keeps a complete 44px action frame');for(const box of[row.slot,row.card,row.frame,row.image].filter(Boolean))for(const x of[box.x,box.x+box.width])for(const y of[box.y,box.y+box.height])assert.ok(Math.hypot(x-cx,y-cy)<=r-4+.75,'every complete logo/card corner stays inside the real circle with safety padding');}
  for(let a=0;a<value.rows.length;a++)for(let b=a+1;b<value.rows.length;b++){const x=value.rows[a].card,y=value.rows[b].card;assert.ok(Math.min(x.x+x.width,y.x+y.width)-Math.max(x.x,y.x)<=1||Math.min(x.y+x.height,y.y+y.height)-Math.max(x.y,y.y)<=1,'circle organization cards never overlap');}
  return value;
}
function rowsOf(boxes, tolerance = 10) {
  const rows = [];
  for (const box of boxes) { let row = rows.find(row => Math.abs(row.top - box.y) <= tolerance); if (!row) rows.push(row = { top: box.y, items: [] }); row.items.push(box); }
  return rows;
}
async function geometry(f) {
  const measured = await f.page.evaluate(() => {
    const rect = node => { const b = node.getBoundingClientRect(); return { x: b.x, y: b.y + scrollY, width: b.width, height: b.height }; };
    const bubbles = [...document.querySelectorAll('[data-guest-toggle]')].map(node => ({ ...rect(node), radius: getComputedStyle(node).borderTopLeftRadius,
      name: rect(node.querySelector('.ah-guest-name')), fields: [...node.querySelectorAll('.ah-guest-name,.ah-guest-affiliation,.ah-guest-subtitle')].map(rect) }));
    const heading = id => { const node = document.getElementById(id), shell = node.closest('.ah-section-heading'); return { ...rect(node), font: parseFloat(getComputedStyle(node).fontSize), shell: rect(shell), border: parseFloat(getComputedStyle(shell).borderBottomWidth) }; };
    const planet = document.querySelector('[data-organizations-planet]');
    const paintedLogo = image => {
      if (!image?.naturalWidth || !image?.naturalHeight) return null;
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0); const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        if (pixels[i + 3] > 120 && Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) > 210) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
      }
      if (right < left || bottom < top) return null;
      const box = rect(image), fit = Math.min(box.width / canvas.width, box.height / canvas.height);
      return { x: box.x + (box.width - canvas.width * fit) / 2 + left * fit,
        y: box.y + (box.height - canvas.height * fit) / 2 + top * fit, width: (right - left + 1) * fit, height: (bottom - top + 1) * fit,
        intrinsicWhiteBounds: [left, top, right, bottom], element: box, objectFit: getComputedStyle(image).objectFit };
    };
    return { bubbles, guestHeading: heading('guests-heading'), organizationHeading: heading('booths-heading'),
      planet: planet ? { ...rect(planet), radius: getComputedStyle(planet).borderTopLeftRadius, decorative: planet.getAttribute('aria-hidden') === 'true' } : null,
      placeholders: [...document.querySelectorAll('.ah-guest-placeholder')].map(node => ({ background: getComputedStyle(node).backgroundColor,
        padding: ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].map(key => parseFloat(getComputedStyle(node)[key])), circle: rect(node.querySelector('.ah-guest-placeholder-circle')) })),
      organizations: [...document.querySelectorAll('[data-organization-id]')].map(node => ({ ...rect(node), id: node.dataset.organizationId,
        reference: node.dataset.organizationReference ?? null, card: rect(node.querySelector('.ah-organization-card')),
        frame: rect(node.querySelector('.ah-organization-image')), image: rect(node.querySelector('img')), paintedLogo: paintedLogo(node.querySelector('img')) })) };
  });
  await writeFile(resolve(evidence, 'geometry-' + f.width + '.json'), JSON.stringify(measured, null, 2) + '\n');
  assert.equal(measured.bubbles.length, 9, 'nine actual legacy profiles, no decorative placeholder people');
  assert.deepEqual(measured.organizations.map(item => item.reference), REFERENCE.organizationKeys, 'known public organization labels are explicitly ordered, despite shuffled fixture input');
  assert.deepEqual(measured.organizations.map(item => item.id), organizationNames.map((_, index) => organizationId(index)), 'visual ordering preserves all independent record IDs');
  const expectedDiameter = f.width >= 1000 ? GUEST_INFORMATION_LAYOUT.desktopDiameterByViewport[f.width]
    : Math.min(220, (f.width - 2 * GUEST_INFORMATION_LAYOUT.mobilePaddingByViewport[f.width] - 20) / 2);
  for (const b of measured.bubbles) {
    near(b.width, b.height, 3, 'guest summary is the circular control');
    near(b.width, expectedDiameter, 1.5, 'approved three-field guest circle size at this viewport');
    assert.ok(b.radius.includes('%') ? parseFloat(b.radius) >= 48 : parseFloat(b.radius) >= b.width * .48, 'summary circular radius');
    assert.ok(b.name.x >= b.x - 1 && b.name.x + b.name.width <= b.x + b.width + 1, 'name stays inside the circle');
    assert.equal(b.fields.length, 3, 'the saved name, company and position form one visible group');
    for (const field of b.fields) {
      assert.ok(field.x >= b.x - 1 && field.y >= b.y - 1 && field.x + field.width <= b.x + b.width + 1 && field.y + field.height <= b.y + b.height + 1, 'all three field boxes remain inside their circle');
      near(field.x + field.width / 2, b.x + b.width / 2, 1.5, 'each field shares the bubble horizontal center');
    }
    for (let index = 1; index < b.fields.length; index++) assert.ok(b.fields[index].y >= b.fields[index - 1].y + b.fields[index - 1].height - 1, 'name, company and position remain ordered without overlap');
    const groupTop = Math.min(...b.fields.map(field => field.y)), groupBottom = Math.max(...b.fields.map(field => field.y + field.height));
    near((groupTop + groupBottom) / 2, b.y + b.height / 2, 1.5, 'the complete three-field group occupies the circle center');
  }
  if (f.width >= 1000) {
    const scale = f.width / REFERENCE.width, rows = rowsOf(measured.bubbles);
    assert.deepEqual(rows.map(row => row.items.length), [4, 4, 1], 'reference has four desktop columns, with only nine actual people');
    for (let column = 0; column < REFERENCE.guestColumns; column++) {
      const bubble = rows[0].items[column];
      near(bubble.x + bubble.width / 2, (REFERENCE.guestFirstCenter + column * REFERENCE.guestColumnStep) * scale, 1.5, 'original circle center retained despite the larger three-field control');
    }
    near(rows[0].items[1].x - rows[0].items[0].x, REFERENCE.guestColumnStep * scale, 1.5, 'source 370px column step');
    near(rows[1].top - rows[0].top, REFERENCE.guestRowStep * scale, 1.5, 'source 371px row step');
    for (const placeholder of measured.placeholders) {
      assert.ok(['transparent', 'rgba(0, 0, 0, 0)'].includes(placeholder.background), 'decorative wrappers have no inherited white panel');
      assert.deepEqual(placeholder.padding, [0, 0, 0, 0], 'reference empty circles have no card wrapper padding');
      near(placeholder.circle.width, measured.bubbles[0].width, 3, 'decorative circle uses the same source diameter');
      near(placeholder.circle.height, measured.bubbles[0].height, 3, 'decorative circle stays circular');
    }
    for (const h of [measured.guestHeading, measured.organizationHeading]) {
      near(h.x, REFERENCE.headingLeft * scale, 38 * scale, 'source heading left alignment');
      near(h.font, REFERENCE.headingCssSizeEstimate * scale, REFERENCE.headingCssSizeEstimate * scale * .2, 'source 65px white glyph height, estimated CSS type size');
      near(h.shell.x, REFERENCE.dividerLeft * scale, 30 * scale, 'source full-width divider left');
      near(h.shell.width, REFERENCE.dividerWidth * scale, 70 * scale, 'source full-width divider span');
      assert.ok(h.border >= .5, 'heading divider remains visible');
    }
    near(rows[0].top - measured.guestHeading.shell.y - measured.guestHeading.shell.height, REFERENCE.guestDividerToCircle * scale, 55 * scale, 'source divider-to-circle breathing room');
    assert.ok(measured.planet?.decorative, 'the large organization planet is decorative, with a real semantic list');
    near(measured.planet.width, measured.planet.height, 4, 'organization planet is circular');
    near(measured.planet.width, REFERENCE.planetDiameter * scale, REFERENCE.planetDiameter * scale * .16, 'source 1408px organization planet diameter');
    near(measured.planet.x + measured.planet.width / 2, f.width / 2, 40 * scale, 'planet centered as in source');
    near(measured.planet.y - measured.organizationHeading.shell.y - measured.organizationHeading.shell.height, REFERENCE.organizationDividerToPlanet * scale, 60 * scale, 'source divider-to-planet spacing');
    // Original middle-row logo tops differ by 24px. Allow another 8px between
    // painted logo edges and the measured DOM frames, then scale by viewport.
    assert.deepEqual(rowsOf(measured.organizations, (REFERENCE.organizationMiddleRowStagger + 8) * scale).map(row => row.items.length), [2, 4, 1], 'source seven-organization layout is 2/4/1 with its intentional stagger');
    // These reference PNGs are not the captured uploads. Unknown/new artwork
    // must stay bounded; painted-pixel similarity must not permit huge canvases.
    for (const row of measured.organizations) {
      assert.ok(row.paintedLogo); assert.equal(row.paintedLogo.objectFit, 'contain');
      for (const [inside, outside] of [[row.image, row.frame], [row.frame, row.card], [row.card, row]]) {
        assert.ok(inside.x >= outside.x - 1.5 && inside.y >= outside.y - 1.5 && inside.x + inside.width <= outside.x + outside.width + 1.5 && inside.y + inside.height <= outside.y + outside.height + 1.5, 'whole logo image/card stays in its independent frame');
      }
    }
    for (let i = 0; i < measured.organizations.length; i++) for (let j = i + 1; j < measured.organizations.length; j++) {
      for (const key of ['image', 'card']) {
        const a = measured.organizations[i][key], b = measured.organizations[j][key];
        assert.ok(Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) <= 1.5 || Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) <= 1.5, 'whole image/card rectangles never overlap');
      }
    }
  } else {assert.deepEqual(rowsOf(measured.bubbles).map(row => row.items.length), [2, 2, 2, 2, 1], 'small screens retain a readable two-column adaptation');await mobileOrganizationCircle(f,7);}
  return measured;
}
async function disclosures(f) {
  const { page } = f, details = page.locator('#guest-' + guestId(0) + ' details'), toggle = details.locator('[data-guest-toggle]');
  assert.equal(await toggle.evaluate(node => node.tagName), 'SUMMARY'); assert.equal(await details.evaluate(node => node.tagName), 'DETAILS');
  await toggle.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  if (f.width >= 1000) {
    await toggle.hover(); await page.waitForFunction(id => document.querySelector('#guest-' + id + ' details')?.open, guestId(0));
    const bubble = await toggle.boundingBox(), body = await details.locator('.ah-guest-detail-body').boundingBox(); assert.ok(bubble && body);
    const x = Math.max(bubble.x, body.x) + Math.min(bubble.width, body.width) / 2;
    await page.mouse.move(x, bubble.y + bubble.height - 2);
    await page.mouse.move(x, (bubble.y + bubble.height + body.y) / 2); await page.waitForTimeout(60);
    await page.mouse.move(Math.min(body.x + body.width - 10, Math.max(body.x + 10, x)), body.y + 12);
    await page.waitForTimeout(200); assert.equal(await details.evaluate(node => node.open), true, 'pointer crosses the circle/detail gap without losing its card');
    await page.mouse.move(0, 0); await page.waitForFunction(id => !document.querySelector('#guest-' + id + ' details')?.open, guestId(0));
  }
  await toggle.focus(); await page.keyboard.press('Enter'); assert.equal(await details.evaluate(node => node.open), true, 'native keyboard disclosure opens');
  assert.equal(await details.locator('.ah-guest-detail-body > .ah-guest-portrait').count(), 1, 'portrait belongs to the expanded introduction');
  await page.keyboard.press('Escape'); assert.equal(await details.evaluate(node => node.open), false); assert.equal(await toggle.evaluate(node => document.activeElement === node), true);
  if (f.width < 600) {
    await toggle.tap(); assert.equal(await details.evaluate(node => node.open), true); await noOverflow(f);
    await toggle.tap(); assert.equal(await details.evaluate(node => node.open), false, 'touch can open and close the same native detail');
  }
}
async function otherContent(f) {
  const { page } = f;
  assert.equal(await page.locator('#program-synthetic-reference-a strong').textContent(), '合成公开交流场次 A', 'the activity title remains unchanged');
  assert.equal(await page.locator('#program-synthetic-reference-a .ah-session-meta').count(), 0, 'the speaker/host field is omitted even when a guest is linked');
  assert.equal(await page.locator('#program-synthetic-reference-c .ah-session-meta').count(), 0, 'an unassigned activity has no pending speaker placeholder');
  const program = await page.locator('[data-program-controls]').evaluate(node => {
    const box = element => { const b = element.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
    return { tabs: box(node.querySelector('.ah-zone-tabs')), filter: box(node.querySelector('.ah-program-period')), buttons: [...node.querySelectorAll('[data-zone]')].map(box), swatches: [...node.querySelectorAll('.ah-zone-swatch')].map(box) };
  });
  assert.equal(program.swatches.length, 3); assert.ok(program.filter.y >= program.tabs.y + program.tabs.height - 1, 'the period filter has a separate row below the three venue tabs');
  if (f.width >= 1000) for (let index = 0; index < 3; index++) near(program.swatches[index].x, REFERENCE.programSwatchLeft[index] * f.width / REFERENCE.width, 3, 'original venue swatch left position');
  else for (const button of program.buttons) near(button.width, program.buttons[0].width, 1.5, 'all three mobile venue columns retain equal width');
  await page.locator('[data-zone="B"]').click(); assert.equal(await page.locator('[data-zone="B"]').getAttribute('aria-selected'), 'true');
  await page.locator('[data-zone="B"]').focus(); await page.keyboard.press('ArrowRight'); assert.equal(await page.locator('[data-zone="C"]').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('[data-agenda-panel="C"]').isVisible(), true);
  assert.equal(await page.locator('[data-showcase-id]').count(), 2); assert.equal(await page.locator('[data-showcase-id]:visible').count(), 1);
  const peek = page.locator('[data-work-peek]'); assert.equal(await peek.getAttribute('aria-hidden'), 'true');
  assert.equal(await page.locator('[data-work-navigation]').isVisible(), true, 'two actual works expose manual navigation');
  assert.equal(await page.locator('.ah-work-stage').getAttribute('data-work-presentation'), 'image');
  assert.equal(await peek.isVisible(), true, 'a next-item glimpse is backed by the actual second published work');
  assert.equal(await peek.locator('img').getAttribute('src'), await page.locator('#work-synthetic-reference-work-1 .ah-showcase-poster img').getAttribute('src'));
  const mainImage = page.locator('#work-synthetic-reference-work-0 .ah-work-preview img');
  await mainImage.scrollIntoViewIfNeeded(); await mainImage.evaluate(node => node.decode());
  const work = await mainImage.evaluate(node => { const b = node.getBoundingClientRect(); return { width: b.width, height: b.height, fit: getComputedStyle(node).objectFit, naturalWidth: node.naturalWidth, naturalHeight: node.naturalHeight }; });
  near(work.width / work.height, 2, .015, 'the full original work uses a 2:1 frame rather than a cropped 16:9 frame'); assert.equal(work.fit, 'contain');
  assert.equal(work.naturalWidth, 1768); assert.equal(work.naturalHeight, 885, 'the original cover bytes are actually decoded');
  near((await peek.boundingBox()).height, work.height, 1.5, 'next real artwork glimpse keeps the main cover height');
  await writeFile(resolve(evidence, 'program-work-geometry-' + f.width + '.json'), JSON.stringify({ program, work }, null, 2) + '\n');
  await page.locator('[data-public-work-next]').click(); await page.locator('#work-synthetic-reference-work-1:visible').waitFor();
  assert.equal(await peek.isVisible(), false, 'last item does not invent another cover');
  await page.locator('[data-public-works-filter]').selectOption('student'); await page.locator('#work-synthetic-reference-work-0:visible').waitFor();
  assert.equal(await page.locator('[data-public-work-next]').isDisabled(), true); assert.equal(await peek.isVisible(), false, 'single-item filter has no decorative next work');
  assert.equal(await page.locator('[data-work-navigation]').isVisible(), false, 'a one-item subset hides previous, next and the redundant counter');
  assert.equal(await page.locator('[data-public-works-filter]').isVisible(), true, 'the category selector remains available for a one-item subset');
  await page.locator('[data-public-works-filter]').selectOption('all');
  assert.equal(await page.locator('[data-work-navigation]').isVisible(), true, 'restoring all categories restores the two-item navigation');
  assert.equal(await peek.isVisible(), true, 'restoring all categories restores the actual next cover');
  await page.locator('[data-public-work-next]').click(); await page.locator('#work-synthetic-reference-work-1:visible').waitFor();
  await page.locator('[data-public-work-prev]').click(); await page.locator('#work-synthetic-reference-work-0:visible').waitFor();
  assert.equal(await page.locator('[data-booth-id],.ah-exhibition-details,a[href^="#booth-"]').count(),0,'the public page has no booth detail interface');
  assert.equal(await page.locator('#students .ah-showcase-arrangement').count(), 0, 'works without real arrangements have no placeholder paragraph');
  assert.doesNotMatch(await page.locator('#students').textContent(), /资料待确认|参加待确认|展示安排陆续公布|封面、展示形式与安排/u);
  assert.equal(await page.locator('[data-faq-id="synthetic-reference-faq"]').count(), 1);
  assert.match(await page.locator('[data-faq-id="lodging-support"]').textContent(), /本次活动提供少量外地来宾住宿支持/u);
  assert.match(await page.locator('[data-faq-id="lodging-support"]').textContent(), /kunan@globalgamejam\.org/u);
  assert.doesNotMatch(await page.locator('[data-faq-id="registration-status"]').textContent(), /可以提交参会申请/u, 'closed application state is authoritative');
  assert.equal(await page.locator('[data-public-organizations] .ah-organization-participation').count(), 0);
  assert.doesNotMatch(await page.locator('[data-public-organizations]').textContent(), /参展|一般参与|参与待确认|已退出|查看作品/u, 'organization surface shows names and logos without inferred participation/status');
  const organization = page.locator('#organization-' + organizationId(0) + ' a.ah-organization-card');
  assert.equal(await organization.getAttribute('href'), 'https://example.invalid/synthetic-organization'); assert.match(await organization.getAttribute('rel'), /noopener/u);
  await page.locator('[data-zone="A"]').click();
}
async function screenshots(f) {
  if (![390, 1920].includes(f.width)) return [];
  await f.page.mouse.move(0, 0); await f.page.keyboard.press('Escape');
  // A full-page screenshot does not load offscreen lazy art. Scroll normally
  // through the built page before capturing, without changing loading attrs.
  await f.page.evaluate(async () => {
    for (let top = 0; top < document.documentElement.scrollHeight; top += innerHeight * .75) {
      scrollTo({ top, behavior: 'instant' }); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
  });
  await f.page.waitForLoadState('networkidle');
  for (const image of await f.page.locator('#artdico-host img:visible').all()) {
    await image.evaluate(node => node.decode());
  }
  await f.page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await f.page.waitForTimeout(150);
  assert.equal(await f.page.locator('[data-public-guests] details[open]').count(), 0, 'reference layout captures do not accidentally hover-open a guest');
  const files = [];
  const full = resolve(evidence, 'homepage-' + f.width + '.png'); await f.page.screenshot({ path: full, fullPage: true }); files.push(full);
  for (const [name, selector] of [['hero', '#top'], ['about', '#about'], ['guests', '#guests'], ['organizations', '#booths'], ['works', '#students'], ['agenda', '#agenda'], ['faq', '#faq'], ['footer', '.ah-footer']]) {
    const path = resolve(evidence, name + '-' + f.width + '.png'); await f.page.locator(selector).screenshot({ path }); files.push(path);
  }
  return files;
}
async function loadOrganizationImages(f) {
  await f.page.mouse.move(0, 0);
  for (const image of await f.page.locator('[data-public-organizations] img').all()) {
    await image.evaluate(node=>node.closest('[data-organization-id]')?.scrollIntoView({block:'center',behavior:'instant'}));
    await image.evaluate(node=>new Promise(resolve=>{const done=()=>{if(node.closest('.ah-organization-image')?.hidden||node.complete&&node.naturalWidth>0&&node.closest('.ah-organization-image')?.dataset.logoPresentation!=='pending')resolve();else setTimeout(done,10);};done();}));
    if(await image.isVisible())await image.evaluate(node=>node.decode());
  }
  await f.page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
}
async function referenceCrops() {
  const context = await browser.newContext({ viewport: { width: REFERENCE.width, height: REFERENCE.height }, deviceScaleFactor: 1 });
  try {
    await context.route('**/*', route => { assert.equal(route.request().url(), SITE + '/__reference.png'); assert.equal(route.request().method(), 'GET'); return route.fulfill({ status: 200, contentType: 'image/png', body: referenceBytes }); });
    const page = await context.newPage(); await page.setContent('<body style="margin:0"><img src="' + SITE + '/__reference.png" style="display:block;width:1921px;height:19362px"></body>');
    await page.locator('img').evaluate(image => image.decode()); const files = [];
    for (const [name, y, height] of [['reference-hero', 0, 2350], ['reference-guests', 4800, 1700], ['reference-organizations', 6500, 2050]]) {
      const path = resolve(evidence, name + '.png'); await page.screenshot({ path, clip: { x: 0, y, width: 1921, height } }); files.push(path);
    }
    return files;
  } finally { await context.close(); }
}
let failure = null, referenceScreenshots = [];
try {
  referenceScreenshots = await referenceCrops();
  for (const width of [320, 390, 1440, 1920]) {
    const f = await fixture(width);
    try {
      await f.page.goto(SITE + '/', { waitUntil: 'networkidle' }); await f.page.evaluate(() => document.fonts.ready); await f.page.locator('#guest-' + guestId(8)).waitFor();
      assert.equal(await f.page.locator('[data-guest-id]').count(), 9);
      assert.equal(await f.page.locator('.ah-guest-attendance').count(), 0, 'bubble captions do not invent attendance text');
      assert.equal(await f.page.locator('.ah-guest-affiliation').count(), 9, 'the saved company is shown independently of title');
      assert.equal(await f.page.locator('.ah-guest-affiliation').evaluateAll(nodes => nodes.every(node => node.textContent === '合成公开创作组织' && node.dataset.affiliationSource === 'company')), true);
      assert.equal(await f.page.locator('.ah-guest-subtitle').count(), 9, 'all nine supplied titles remain visible alongside company');
      assert.equal(await f.page.locator('.ah-guest-subtitle').evaluateAll(nodes => nodes.every(node => node.textContent === '合成创作者' && node.dataset.subtitleSource === 'title')), true, 'caption uses the supplied profile title');
      for (let index = 0; index < 9; index++) assert.equal(await f.page.locator('#guest-' + guestId(index) + ' [data-guest-toggle]').getAttribute('aria-label'), [names[index], '合成公开创作组织', '合成创作者', '嘉宾介绍'].join('，'));
      assert.equal(await f.page.locator('[data-organization-id]').count(), 7);
      const blanks = f.page.locator('.ah-guest-placeholder');
      assert.equal(await blanks.count(), 3, 'the reference final row may be completed with three purely decorative circles');
      assert.equal(await blanks.locator('[data-guest-id],[data-guest-toggle],summary,a,button,input,[tabindex]').count(), 0, 'decorative circles never invent a person or keyboard action');
      assert.equal(await blanks.evaluateAll(nodes => nodes.every(node => node.getAttribute('aria-hidden') === 'true' && node.getAttribute('role') === 'presentation' && !node.textContent.trim())), true);
      assert.equal(await f.page.locator('.ah-guest-placeholder:visible').count(), width < 600 ? 0 : 3, 'decorative reference fill is hidden on small screens');
      await loadOrganizationImages(f);
      const measured = await geometry(f); await disclosures(f); await otherContent(f); await noOverflow(f);
      const files = await screenshots(f); let unknownOrganizationFallback = false;
      await f.refresh('legacy', raw => { raw.organizations.push(
        { id:'synthetic-reference-unknown',name:'合成第八个组织',logoId:syntheticLogoByWidth.get(width).id,website:'https://example.invalid/eighth-organization',participation:'undecided',status:'confirmed',publicConsent:true,internalNotes:PRIVATE }); });
      const unknown=f.page.locator('[data-organization-id="synthetic-reference-unknown"]');
      assert.equal(await f.page.locator('[data-organization-id]').count(),8,'an eighth public organization is retained beside the original seven');
      assert.equal(await unknown.getAttribute('data-organization-reference'),null);
      if(width>=1000)assert.notEqual(await unknown.evaluate(node=>getComputedStyle(node).position),'absolute','desktop unknown identities retain normal flow');
      await unknown.scrollIntoViewIfNeeded();
      await f.page.waitForFunction(()=>document.querySelector('#organization-synthetic-reference-unknown .ah-organization-image')?.dataset.logoPresentation==='white');
      await unknown.locator('img').evaluate(image=>image.decode());
      assert.equal(await unknown.locator('img').getAttribute('data-logo-source'),API+'/api/public/portraits/'+syntheticLogoByWidth.get(width).id,'white presentation retains an explicit exact original upload source');
      const extraGeometry=await unknown.evaluate(node=>{
        const box=element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
        const image=node.querySelector('img'),canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
        const context=canvas.getContext('2d');context.drawImage(image,0,0);const data=context.getImageData(0,0,canvas.width,canvas.height).data;
        const pixel=(x,y)=>[...data.slice((y*canvas.width+x)*4,(y*canvas.width+x)*4+4)];let ink=0,nonwhite=0,transparent=0;
        for(let i=0;i<data.length;i+=4){if(data[i+3]>32){ink++;if(data[i]!==255||data[i+1]!==255||data[i+2]!==255)nonwhite++;}else transparent++;}
        return {slot:box(node),name:box(node.querySelector('h3')),frame:box(node.querySelector('.ah-organization-image')),image:box(image),planet:box(document.querySelector('[data-organizations-planet]')),imageFilter:getComputedStyle(image).filter,
          frameBackground:getComputedStyle(node.querySelector('.ah-organization-image')).backgroundColor,mask:{ink,nonwhite,transparent,corner:pixel(0,0),counter:pixel(120,48),width:canvas.width,height:canvas.height}};
      });
      assert.ok(extraGeometry.name.width>1&&extraGeometry.name.height>1,'an uploaded unknown logo always retains its visible name');
      assert.equal(extraGeometry.imageFilter,'none','white logos use an alpha mask rather than a CSS filter on an opaque rectangle');
      assert.equal(extraGeometry.mask.nonwhite,0,'every visible generated logo pixel is white');assert.ok(extraGeometry.mask.ink>0&&extraGeometry.mask.transparent>0);
      assert.equal(extraGeometry.mask.corner[3],0,'opaque source backgrounds do not turn into a white rectangle');assert.equal(extraGeometry.mask.counter[3],0,'enclosed letter counters remain transparent');
      assert.ok(['transparent','rgba(0, 0, 0, 0)'].includes(extraGeometry.frameBackground),'white logos sit on the page without a light panel');
      assert.equal(await unknown.locator('a').getAttribute('href'),'https://example.invalid/eighth-organization');
      if(width>=1000){
        assert.ok(extraGeometry.slot.y>=extraGeometry.planet.y+extraGeometry.planet.height*.5,'additional logos occupy the lower portion of the same planet');
        assert.ok(extraGeometry.slot.bottom<=extraGeometry.planet.bottom+1,'the eighth card is discoverable inside the visible planet rather than one planet below it');
      }
      const allSlots=await f.page.locator('[data-organization-id]').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
      for(let a=0;a<allSlots.length;a++)for(let b=a+1;b<allSlots.length;b++)assert.ok(Math.min(allSlots[a].right,allSlots[b].right)-Math.max(allSlots[a].x,allSlots[b].x)<=1.5||Math.min(allSlots[a].bottom,allSlots[b].bottom)-Math.max(allSlots[a].y,allSlots[b].y)<=1.5,'the additional card never overlaps any original organization');
      if(width<1000)await mobileOrganizationCircle(f,8);
      await noOverflow(f);unknownOrganizationFallback=true;
      const extraScreenshot=resolve(evidence,'eight-organizations-'+width+'.png');await f.page.locator('#booths').screenshot({path:extraScreenshot});files.push(extraScreenshot);
      await f.refresh('legacy',raw=>{raw.organizations.find(item=>item.id==='synthetic-reference-unknown').logoId=syntheticLogos.get('mixed-transparent-panel').id;});
      await unknown.scrollIntoViewIfNeeded();
      await f.page.waitForFunction(()=>document.querySelector('#organization-synthetic-reference-unknown .ah-organization-image')?.dataset.logoPresentation==='white');
      const mixedMask=await unknown.locator('img').evaluate(image=>{const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d');context.drawImage(image,0,0);const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;const pixel=(x,y)=>[...pixels.slice((y*canvas.width+x)*4,(y*canvas.width+x)*4+4)];return {outer:pixel(0,0),innerPanel:pixel(8,8),counter:pixel(120,48),ink:pixel(32,24)};});
      assert.equal(mixedMask.outer[3],0);assert.equal(mixedMask.innerPanel[3],0,'a transparent outer margin does not preserve an opaque white inner panel');assert.equal(mixedMask.counter[3],0,'the panel-colored enclosed counter is also removed');assert.deepEqual(mixedMask.ink,[255,255,255,255]);
      await f.refresh('legacy',raw=>{raw.organizations.find(item=>item.id==='synthetic-reference-unknown').logoId=syntheticLogoByWidth.get(width).id;});
      await unknown.scrollIntoViewIfNeeded();await f.page.waitForFunction(()=>document.querySelector('#organization-synthetic-reference-unknown .ah-organization-image')?.dataset.logoPresentation==='white');
      if(width===1440){
        await f.refresh('legacy',raw=>{raw.organizations.push({id:'synthetic-reference-duplicate',name:'游戏奇点',logoId:logoSources[0].id,website:'',participation:'undecided',status:'confirmed',publicConsent:true,internalNotes:PRIVATE});});
        const duplicate=f.page.locator('[data-organization-id="synthetic-reference-duplicate"]');
        assert.equal(await duplicate.count(),1);assert.equal(await duplicate.getAttribute('data-organization-reference'),null);
        assert.notEqual(await duplicate.evaluate(node=>getComputedStyle(node).position),'absolute','a second saved record with the same public label stays in normal flow');
        assert.equal(await f.page.locator('[data-organization-reference="gamezone"]').count(),1,'only one real card occupies each reference slot');
        assert.ok((await duplicate.locator('h3').boundingBox()).height>1,'the distinct duplicate retains its own visible name');
        await f.refresh('legacy',raw=>{raw.organizations.find(item=>item.id==='synthetic-reference-unknown').logoId=syntheticLogos.get('opaque-complex').id;});
        await unknown.scrollIntoViewIfNeeded();
        await f.page.waitForFunction(()=>document.querySelector('#organization-synthetic-reference-unknown .ah-organization-image')?.hidden===true);
        assert.ok((await unknown.locator('h3').boundingBox()).height>1,'an inseparable complex background keeps the actual readable organization name');
        assert.equal(await unknown.getAttribute('data-logo-artwork'),'published-name');
        await f.refresh('legacy',raw=>{raw.organizations.find(item=>item.id==='synthetic-reference-unknown').logoId=syntheticLogoByWidth.get(width).id;});
        await unknown.scrollIntoViewIfNeeded();
        await f.page.waitForFunction(()=>document.querySelector('#organization-synthetic-reference-unknown .ah-organization-image')?.dataset.logoPresentation==='white');
        assert.equal(await unknown.locator('img').getAttribute('data-logo-source'),API+'/api/public/portraits/'+syntheticLogoByWidth.get(width).id,'a new revision replaces the fallback instead of retaining stale output');
      }
      let organizationPaging=null;
      if(width<1000){
        assert.equal(await f.page.locator('[data-organizations-pagination]').isVisible(),false,'all eight fit one circle without a redundant page control');
        await f.refresh('legacy',raw=>{for(let n=0;n<3;n++)raw.organizations.push({id:'synthetic-page-extra-'+n,name:'合成后页组织'+n,logoId:syntheticLogoByWidth.get(width).id,website:'https://example.invalid/page-'+n,participation:'undecided',status:'confirmed',publicConsent:true,internalNotes:PRIVATE});});
        assert.equal(await f.page.locator('[data-organization-id]').count(),11,'paging retains every original node and stable ID');
        assert.equal(await f.page.locator('[data-organizations-pagination]').isVisible(),true);await mobileOrganizationCircle(f,8);
        await f.page.locator('[data-organizations-next]').focus();await f.page.keyboard.press('Enter');await mobileOrganizationCircle(f,3);
        assert.equal(await f.page.locator('[data-organizations-previous]').evaluate(node=>document.activeElement===node),true,'the last page keeps keyboard focus on a usable control');
        const secondPageIds=await f.page.locator('[data-organization-id]:visible').evaluateAll(nodes=>nodes.map(node=>node.id));
        await f.refresh('legacy',raw=>{raw.organizations.find(item=>item.id==='synthetic-page-extra-0').name='合成刷新后页组织';});
        assert.deepEqual(await f.page.locator('[data-organization-id]:visible').evaluateAll(nodes=>nodes.map(node=>node.id)),secondPageIds,'read-only refresh keeps the current stable page');
        await f.page.locator('[data-organizations-previous]').click();await mobileOrganizationCircle(f,8);
        await f.page.evaluate(()=>{location.hash='#organization-synthetic-page-extra-2';});await f.page.locator('#organization-synthetic-page-extra-2:visible').waitFor();await mobileOrganizationCircle(f,3);
        const link=f.page.locator('#organization-synthetic-page-extra-2 a');await link.focus();await f.refresh('legacy',raw=>{raw.organizations.find(item=>item.id==='synthetic-page-extra-2').name='合成仍在后页组织';});
        assert.equal(await f.page.locator('#organization-synthetic-page-extra-2 a').evaluate(node=>document.activeElement===node),true,'refresh restores focus to the same visible organization');
        organizationPaging={total:11,first:8,second:3,stableIdsAndHash:true,refreshAndKeyboardFocus:true};
      }
      assert.doesNotMatch(await f.page.locator('body').textContent(), /SYNTHETIC_REFERENCE_PRIVATE|private@example/u);
      reports.push({ name: 'legacy-public-layout-' + width, width, profiles: 9, organizations: 7, attendance: 'not inferred; only actual profile title is displayed', geometry: measured,
        interaction: 'native keyboard, Escape, pointer gap or touch; actual timetable tabs, works filter and FAQ', unknownOrganizationFallback,
        duplicateKnownOrganizationRetained: width===1440, eighthOrganizationGeometry:extraGeometry,mixedTransparentPanelMask:mixedMask,organizationPaging, requests: f.calls.length, screenshots: files });
    } finally { await f.context.close(); }
  }
  for (const mode of ['empty', 'corrupt', 'unavailable']) {
    const f = await fixture(390, { mode });
    try {
      await f.page.goto(SITE + '/', { waitUntil: 'networkidle' });
      assert.equal(await f.page.locator('[data-guest-id]').count(), 0, mode + ' never falls back to nine legacy cards');
      if (mode !== 'empty') { assert.equal(await f.page.locator('[data-organization-id]').count(), 0); assert.match(await f.page.locator('[data-public-content-status]').textContent(), /无法|暂时/u); }
      else assert.equal(await f.page.locator('[data-organization-id]').count(), 7);
      await noOverflow(f); reports.push({ name: 'initial-' + mode, width: 390, guestCount: 0, failClosed: true, requests: f.calls.length });
    } finally { await f.context.close(); }
  }
  const broken = await fixture(390, { brokenImages: true });
  try {
    await broken.page.goto(SITE + '/', { waitUntil: 'networkidle' });
    assert.equal(broken.titleImagePaths.size, 2, 'both reference title graphics are exercised by actual intercepted 404s');
    assert.equal(await broken.page.locator('[data-home-title-fallback]:visible').count(), 2, 'actual error/startup recovery exposes both readable title fallbacks');
    assert.match(await broken.page.locator('#hero-heading').innerText(), /GLOBAL GAME JAM/u); assert.match(await broken.page.locator('#hero-heading').innerText(), /ARTDiCO HOST/u);
    const first = broken.page.locator('#guest-' + guestId(0)); await first.locator('[data-guest-toggle]').tap();
    await broken.page.waitForFunction(id => document.querySelector('#guest-' + id + ' .ah-guest-portrait img')?.hidden === true, guestId(0));
    assert.equal(await first.locator('.ah-guest-name').isVisible(), true); assert.equal(await first.locator('.ah-guest-initial').isVisible(), true);
    const organization = broken.page.locator('#organization-' + organizationId(6)); await organization.scrollIntoViewIfNeeded();
    await broken.page.waitForFunction(id => document.querySelector('#organization-' + id + ' .ah-organization-image')?.hidden === true, organizationId(6));
    assert.equal(await organization.locator('h3').isVisible(), true);
    const failedWork = broken.page.locator('#work-synthetic-reference-work-0');
    await failedWork.scrollIntoViewIfNeeded();
    await broken.page.waitForFunction(() => document.querySelector('#work-synthetic-reference-work-0')?.dataset.coverState === 'unavailable');
    assert.equal(await broken.page.locator('.ah-work-stage').getAttribute('data-work-presentation'), 'text', 'a real cover 404 switches the selected work into text presentation');
    assert.equal(await broken.page.locator('[data-work-peek]').isVisible(), false, 'the failed main artwork never leaves a decorative next-image strip');
    assert.equal(await failedWork.locator('.ah-showcase-cover-empty').innerText(), '作品图片尚未公布');
    const failedGeometry = await failedWork.evaluate(card => {
      const fallback = card.querySelector('.ah-showcase-cover-empty');
      const caption = card.querySelector('.ah-showcase-caption');
      return { posterHeight: card.querySelector('.ah-showcase-poster').getBoundingClientRect().height,
        fallbackHeight: fallback.getBoundingClientRect().height, captionHeight: caption.getBoundingClientRect().height,
        captionPosition: getComputedStyle(caption).position, captionBackground: getComputedStyle(caption).backgroundColor };
    });
    assert.ok(failedGeometry.posterHeight <= failedGeometry.captionHeight + failedGeometry.fallbackHeight + 24, 'failed cover keeps only its natural caption and short fallback instead of an empty poster');
    assert.ok(['transparent', 'rgba(0, 0, 0, 0)'].includes(failedGeometry.captionBackground), 'failed cover has no purple image-caption panel');
    assert.equal(await failedWork.locator('[data-work-preview]').isVisible(), false);
    assert.equal(await failedWork.locator('[data-work-preview]').isDisabled(), true, 'a failed cover cannot open the image viewer');
    assert.equal(failedGeometry.captionPosition, 'static', 'failed artwork keeps its title in normal text flow');
    await broken.page.locator('[data-public-work-next]').click();
    await broken.page.locator('#work-synthetic-reference-work-1:visible').waitFor();
    assert.equal(await broken.page.locator('.ah-work-stage').getAttribute('data-work-presentation'), 'image', 'manual navigation still reaches the next real cover');
    await noOverflow(broken);
    reports.push({ name: 'image-failure-name-and-initial', width: 390, failedHeroImagePaths: [...broken.titleImagePaths], readableHeroTitle: true, readableGuestName: true, readableGuestInitial: true, readableOrganizationName: true, failedWorkUsesCompactText: true, failedWorkGeometry: failedGeometry, nextRealCoverReachable: true });
  } finally { await broken.context.close(); }
  const changing = await fixture(390);
  try {
    await changing.page.goto(SITE + '/', { waitUntil: 'networkidle' }); assert.equal(await changing.page.locator('[data-guest-id]').count(), 9);
    await changing.refresh('empty'); assert.equal(await changing.page.locator('[data-guest-id]').count(), 0);
    await changing.refresh('corrupt'); assert.equal(await changing.page.locator('[data-guest-id]').count(), 0, 'bad refresh retains the verified explicit empty proof');
    await changing.refresh('proved', raw => { raw.event.title = '合成最新发布活动标题'; });
    assert.equal(await changing.page.locator('[data-guest-id]').count(), 1); assert.equal(await changing.page.locator('.ah-guest-attendance').count(), 0);
    assert.equal((await changing.page.locator('#hero-heading').textContent()).trim(), '合成最新发布活动标题', 'a changed published fact replaces decorative title art with the real title');
    await changing.refresh('unavailable'); assert.equal(await changing.page.locator('[data-guest-id]').count(), 1, 'failed refresh retains only the last verified explicit proof');
    assert.match(await changing.page.locator('[data-public-content-status]').textContent(), /仍显示上次核对/u); await noOverflow(changing);
    reports.push({ name: 'proof-refresh-transitions', width: 390, counts: [9, 0, 0, 1, 1], verifiedStatePreserved: true, customPublishedTitlePreserved: true });
  } finally { await changing.context.close(); }
  assert.deepEqual(pageErrors, []);
} catch (error) { failure = { message: error.message, stack: error.stack }; }
finally {
  await browser.close();
  const html = await readFile(resolve(dist, 'index.html')), metadata = await stat(resolve(dist, 'index.html'));
  const result = { ok: !failure, syntheticOnly: true, zeroRealNetwork: true, zeroBusinessWrites: true, zeroRealMail: true,
    source, testScriptSha256, gitHeadAtRun: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim(), dist,
    htmlMtime: metadata.mtime.toISOString(), publicHtmlSha256: sha(html), servedAssets: Object.fromEntries([...servedAssets].sort()),
    reference: REFERENCE, guestInformationLayout: GUEST_INFORMATION_LAYOUT, referenceScreenshots, organizationInputOrder: organizationInputOrder.map(index => organizationNames[index]),
    logoSources, artworkSources, geometryScope: 'Desktop scaled reference ratios with explicit tolerances; mobile functional adaptation. Screenshots require visual review and are not pixel-diff equivalence.',
    passedCases: reports.length, reports, pageErrors, ...(failure ? { failure } : {}) };
  await writeFile(resolve(evidence, 'report.json'), JSON.stringify(result, null, 2) + '\n'); process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
if (failure) throw new Error(failure.message);
