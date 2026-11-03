// Independent public-form readability regression. All data and browser storage
// are synthetic; every request is intercepted and business POSTs are forbidden.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

let activeBrowser = null, activePage = null, stage = 'preflight', currentWidth = null, numericMetrics = null;
const project = fileURLToPath(new URL('../../', import.meta.url));
const source = resolve(process.env.ARTDICO_SOURCE_DIRECTORY || project);
const dist = resolve(process.env.ARTDICO_DIST_DIRECTORY || resolve(source, 'dist'));
const evidence = resolve(process.env.ARTDICO_TYPOGRAPHY_EVIDENCE_DIRECTORY || resolve(project, '.local-data/browser-evidence/public-typography'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const minimum = Object.freeze({ label: 16, legend: 16, disclosure: 16, input: 16, consent: 16, button: 16, hint: 14, status: 14, error: 14, heading: 20, policy: 14, paragraphLineRatio: 1.6, contrast: 4.5 });

async function main() {
  const { peopleRuntimeFixture, PEOPLE_FIXTURE_API: API, PEOPLE_FIXTURE_PUBLIC: SITE, PEOPLE_FIXTURE_EVENT: eventId } = await import(pathToFileURL(resolve(source, 'tests/helpers/people-runtime-fixture.mjs')));
  const { createInitialContent } = await import(pathToFileURL(resolve(source, 'src/config/content.mjs')));
  const { toPublicContent } = await import(pathToFileURL(resolve(source, 'shared/content-schema.mjs')));
  const html = await readFile(resolve(dist, 'index.html')), htmlInfo = await stat(resolve(dist, 'index.html'));
  const scriptSha256 = sha(await readFile(fileURLToPath(import.meta.url)));
  const raw = createInitialContent();
  // Keep only documented seed sessions for a synthetic timeline. Empty public
  // guests/organizations still isolate form readability from live publication.
  raw.sessions = raw.sessions.filter(item => ['session-arrival-a', 'session-arrival-b', 'session-arrival-c', 'session-speaker-one-b'].includes(item.id));
  for (const key of ['guests', 'showcases', 'booths', 'organizations']) raw[key] = [];
  const publication = JSON.stringify({ revision: 1, publishedAt: '2026-10-21T09:00:00.000Z', content: toPublicContent(raw) });
  const { chromium } = await import(process.env.ARTDICO_PLAYWRIGHT_MODULE || 'playwright-core');
  const browser = await chromium.launch({ executablePath: process.env.ARTDICO_CHROMIUM_BINARY || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  activeBrowser = browser;
  await mkdir(evidence, { recursive: true });
  const reports = [], pageErrors = [], servedAssets = new Map(), requests = [];
  const mime = file => ({ html: 'text/html; charset=utf-8', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', woff2: 'font/woff2', ico: 'image/x-icon' })[extname(file).slice(1)] || 'application/octet-stream';
  let failure = null;

  async function measure(page, phase) {
    stage = phase + '-typography';
    const measurements = await page.locator('[data-registration-form]').evaluate((form, minimum) => {
      const visible = node => !!node.getClientRects().length && getComputedStyle(node).visibility === 'visible' && !node.closest('[hidden]');
      const roots = [form, document.querySelector('#privacy')].filter(Boolean);
      const query = selector => roots.flatMap(root => [...root.querySelectorAll(selector)]);
      const box = node => { const rect = node.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; };
      const groups = {
        label: '[data-field] > label:not(.ah-demo-consent),.ah-general-proposal-toggle',
        legend: 'legend',
        disclosure: 'details > summary',
        input: 'input:not([type=checkbox]):not([type=hidden]),select,textarea',
        consent: '.ah-demo-consent,.ah-demo-consent span,.ah-demo-consent a',
        button: 'button',
        hint: '.ah-field-hint,.ah-form-hint,.ah-form-disclaimer,.ah-optional,[data-registration-mode-label]',
        status: '[data-application-draft-status],[data-form-result]',
        error: '.ah-form-error,.ah-form-error-list button',
        heading: 'h3,h4',
        policy: '[data-public-privacy] p,.ah-application-recovery p',
      };
      const roles = Object.fromEntries(Object.entries(groups).map(([role, selector]) => [role, query(selector).filter(visible).filter(node => node.matches('input,select,textarea') || node.textContent.trim()).map(node => {
        const style = getComputedStyle(node);
        return { tag: node.tagName.toLowerCase(), font: parseFloat(style.fontSize), lineRatio: parseFloat(style.lineHeight) / parseFloat(style.fontSize), box: box(node),
          clientWidth: node.clientWidth, clientHeight: node.clientHeight, scrollWidth: node.scrollWidth, scrollHeight: node.scrollHeight,
          overflowX: style.overflowX, overflowY: style.overflowY, min: minimum[role] };
      })]));
      const paragraphs = query('p,dd').filter(visible).filter(node => node.textContent.trim()).map(node => {
        const style = getComputedStyle(node); return { font: parseFloat(style.fontSize), ratio: parseFloat(style.lineHeight) / parseFloat(style.fontSize) };
      });
      const rgb = value => {
        const match = /^rgba?\(([^)]+)\)$/u.exec(value); if (!match) throw new Error('Unsupported computed color.');
        const values = match[1].split(/[\s,/]+/u).filter(Boolean).map(Number); return [values[0], values[1], values[2], values[3] ?? 1];
      };
      const over = (front, back) => { const alpha = front[3] + back[3] * (1 - front[3]); return [0, 1, 2].map(index => (front[index] * front[3] + back[index] * back[3] * (1 - front[3])) / alpha).concat(alpha); };
      const luminance = color => color.slice(0, 3).map(value => { const v = value / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((total, value, index) => total + value * [.2126, .7152, .0722][index], 0);
      const contrast = node => {
        const layers = []; let unresolvedImage = false;
        for (let current = node; current; current = current.parentElement) {
          const style = getComputedStyle(current), color = rgb(style.backgroundColor); layers.push(color);
          if (style.backgroundImage !== 'none') unresolvedImage = true;
          if (color[3] === 1) break;
        }
        let background = [255, 255, 255, 1]; for (const color of layers.reverse()) background = over(color, background);
        const foreground = over(rgb(getComputedStyle(node).color), background), fg = luminance(foreground), bg = luminance(background);
        return { ratio: (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05), foreground: foreground.slice(0, 3), background: background.slice(0, 3), backgroundLuminance: bg, unresolvedImage };
      };
      const panels = query('[data-public-privacy],.ah-application-recovery').filter(visible).map(panel => ({
        kind: panel.matches('.ah-application-recovery') ? 'recovery' : 'policy', ...contrast(panel),
        text: [...panel.querySelectorAll('summary,dt,dd,p,h3,h4,a')].filter(visible).filter(node => node.textContent.trim()).map(node => ({ tag: node.tagName.toLowerCase(), ...contrast(node) })),
      }));
      return { roles, paragraphs, panels, pageWidth: document.documentElement.scrollWidth, viewport: innerWidth };
    }, minimum);
    numericMetrics = measurements;
    assert.ok(measurements.pageWidth <= measurements.viewport + 1, 'the public form never overflows the viewport');
    for (const [role, rows] of Object.entries(measurements.roles)) for (const row of rows) {
      assert.ok(row.font >= row.min - .01, 'semantic text meets its role minimum: ' + role);
      assert.ok(row.box.width > 0 && row.box.height > 0);
      if (role !== 'input') assert.ok(row.scrollWidth <= row.clientWidth + 1 && row.scrollHeight <= row.clientHeight + 1, 'visible public text is neither clipped nor scrollable: ' + role);
      if (role !== 'input') assert.ok(!['auto', 'scroll'].includes(row.overflowX) && !['auto', 'scroll'].includes(row.overflowY), 'public labels and explanations have no inner scroll');
      assert.ok(row.box.x >= -1 && row.box.x + row.box.width <= measurements.viewport + 1, 'each visible form control/text box stays in the viewport');
    }
    for (const role of ['label', 'input', 'button']) {
      const sizes = measurements.roles[role].map(row => row.font);
      if (sizes.length) assert.ok(Math.max(...sizes) - Math.min(...sizes) <= .5, 'equivalent form roles use a consistent size: ' + role);
    }
    assert.ok(measurements.paragraphs.length > 0);
    for (const paragraph of measurements.paragraphs) assert.ok(Number.isFinite(paragraph.ratio) && paragraph.ratio >= minimum.paragraphLineRatio - .001, 'explanatory paragraphs have readable line spacing');
    assert.ok(measurements.panels.some(panel => panel.kind === (phase === 'recovery' ? 'recovery' : 'policy')), 'the on-demand footer privacy or recovery surface is measured');
    for (const panel of measurements.panels) {
      assert.equal(panel.unresolvedImage, false, 'contrast is computed over resolved solid surfaces, not guessed through imagery');
      assert.ok(panel.backgroundLuminance <= .1, 'policy and recovery use the requested dark surface');
      assert.ok(panel.text.length > 0);
      for (const text of panel.text) { assert.equal(text.unresolvedImage, false); assert.ok(text.ratio >= minimum.contrast, 'actual composited text/background contrast meets 4.5:1'); }
    }
    return measurements;
  }

  async function measureAgenda(page, width) {
    stage = 'agenda-readability';
    const reports = [];
    for (const zone of ['A', 'B', 'C']) {
      await page.locator('[data-zone="' + zone + '"]').click();
      const panel = page.locator('[data-agenda-panel="' + zone + '"]');
      await panel.waitFor({ state: 'visible' });
      const metrics = await panel.locator('.ah-agenda-row').evaluateAll(rows => rows.map(row => {
        const box = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
        const text = node => { const s = getComputedStyle(node); return { ...box(node), font: parseFloat(s.fontSize), line: parseFloat(s.lineHeight), clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, overflowX: s.overflowX, overflowY: s.overflowY }; };
        const time = row.querySelector('time'), category = row.querySelector('.ah-session-category'), title = row.querySelector('strong');
        const range = document.createRange(); range.selectNodeContents(time);
        const point = getComputedStyle(row, '::after');
        return { row: box(row), time: text(time), category: text(category), title: text(title), timeLines: range.getClientRects().length,
          pointCenterY: row.getBoundingClientRect().y + parseFloat(point.top) + parseFloat(point.height) / 2 };
      }));
      assert.ok(metrics.length > 0, 'each venue has a documented synthetic session');
      const timeSize = Math.max(16, Math.min(32, width * .0167));
      const categorySize = Math.max(14, Math.min(25, width * .013));
      const titleSize = Math.max(20, Math.min(40, width * .0208));
      for (const row of metrics) {
        numericMetrics = { agendaWidth: width, zone, ...row };
        assert.ok(Math.abs(row.time.font - timeSize) < .02, 'timeline time uses its reference-scaled display role');
        assert.ok(Math.abs(row.category.font - categorySize) < .02, 'venue badge uses its own readable display role');
        assert.ok(Math.abs(row.title.font - titleSize) < .02, 'session title preserves the original larger hierarchy');
        assert.ok(row.title.font / row.time.font >= 1.2 && row.title.font / row.time.font <= 1.35, 'session title remains larger than the time');
        assert.equal(row.timeLines, 1, 'the complete time range stays on one line');
        assert.ok(row.category.y >= row.time.bottom + 4, 'the venue badge stays below the complete time line');
        assert.ok(Math.abs(row.category.x - row.time.x) < 1, 'time and venue badge share a clean left edge');
        assert.ok(row.title.x >= row.time.right + 8, 'larger time text does not intrude into the session title');
        assert.ok(Math.abs(row.pointCenterY - (row.time.y + row.time.height / 2)) < 1, 'the timeline point aligns with the time line');
        for (const item of [row.time, row.category, row.title]) {
          assert.ok(item.x >= row.row.x && item.right <= row.row.right + 1 && item.bottom <= row.row.bottom + 1, 'each timeline label stays in its row');
          assert.ok(item.scrollWidth <= item.clientWidth + 1, 'timeline text has no hidden horizontal clipping');
          assert.ok(!['scroll', 'auto'].includes(item.overflowX) && !['scroll', 'auto'].includes(item.overflowY), 'timeline text never becomes an inner scroll area');
        }
      }
      reports.push({ zone, rows: metrics.length, timeSize: metrics[0].time.font, categorySize: metrics[0].category.font, titleSize: metrics[0].title.font,
        singleLineTimes: true, labelSeparation: true, titleHierarchy: true, pointAlignment: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'venue switching preserves the viewport bounds');
    }
    await page.locator('[data-zone="A"]').click();
    return reports;
  }

  try {
    for (const width of [320, 390, 1440, 1920]) {
      currentWidth = width; stage = 'isolated-runtime';
      const runtime = await peopleRuntimeFixture({ capacity: 300, mail: false });
      const context = await browser.newContext({ viewport: { width, height: 1000 }, isMobile: width < 600, hasTouch: width < 600, reducedMotion: 'reduce' });
      let config;
      try {
        await context.route('**/*', async route => {
          const request = route.request(), url = new URL(request.url());
          assert.ok([SITE, API].includes(url.origin), 'all network remains inside the intercepted synthetic origins');
          assert.equal(request.method(), 'GET', 'this readability test never submits or checks an application');
          requests.push({ width, path: url.pathname, method: request.method() });
          if (url.origin === API) {
            assert.equal(request.headers().cookie, undefined); assert.equal(request.headers().authorization, undefined);
            if (url.pathname === '/api/public/content') return route.fulfill({ status: 200, contentType: 'application/json', body: publication });
            assert.equal(url.pathname, '/api/admin/registration/config');
            const response = await runtime.app.handle(new Request(request.url(), { headers: await request.allHeaders() }));
            const body = Buffer.from(await response.arrayBuffer()); assert.equal(response.status, 200); config = JSON.parse(body);
            const headers = Object.fromEntries(response.headers); delete headers['content-length'];
            return route.fulfill({ status: response.status, headers, body });
          }
          if (url.pathname === '/__typography-seed/') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Synthetic local draft seed</title>' });
          if (url.pathname.startsWith('/__typography-source__/')) {
            const path = url.pathname.slice('/__typography-source__'.length); assert.match(path, /^\/(?:src\/lib|shared)\/[a-z0-9-]+\.mjs$/u);
            const file = resolve(source, '.' + path); assert.ok(file.startsWith(source + '/'));
            return route.fulfill({ status: 200, contentType: 'text/javascript', body: await readFile(file) });
          }
          const path = url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname, file = resolve(dist, '.' + path); assert.ok(file.startsWith(dist + '/'));
          try { const bytes = await readFile(file); servedAssets.set(path, sha(bytes)); return route.fulfill({ status: 200, contentType: mime(file), body: bytes }); }
          catch { return route.fulfill({ status: 404, body: '' }); }
        });
        const page = await context.newPage(); activePage = page; page.setDefaultTimeout(12000);
        page.on('pageerror', error => pageErrors.push(error.message)); await page.clock.setFixedTime(new Date('2026-10-21T09:00:00.000Z'));
        stage = 'open-form'; await page.goto(SITE + '/#registration', { waitUntil: 'networkidle' }); await page.evaluate(() => document.fonts.ready);
        const form = page.locator('[data-registration-form]'); await form.locator('[data-submit]:enabled').waitFor(); assert.equal(await form.getAttribute('data-registration-mode'), 'production');
        const agenda = await measureAgenda(page, width); stage = 'form-keyboard';
        assert.equal(await page.locator('#about .ah-program-detail').count(), 0, 'organizer instructions no longer interrupt the visual bubbles');
        const organizer = page.locator('[data-faq-id="site-role"] .ah-faq-answer');
        assert.equal(await organizer.count(), 1, 'organizer participation is available in Q&A even with a legacy publication');
        assert.ok(await organizer.evaluate(node => parseFloat(getComputedStyle(node).fontSize)) >= 16, 'Q&A explanations use the readable body role');
        const noteMetrics = await page.locator('.ah-home-fact-bubble small').evaluateAll(nodes => nodes.map(node => ({font:parseFloat(getComputedStyle(node).fontSize),width:node.clientWidth,scrollWidth:node.scrollWidth,height:node.clientHeight,scrollHeight:node.scrollHeight})));
        assert.equal(noteMetrics.length, 4);
        for (const note of noteMetrics) { assert.ok(note.font >= (width >= 768 ? 16 : 14)); assert.ok(note.scrollWidth <= note.width + 1 && note.scrollHeight <= note.height + 1, 'larger bubble notes stay readable without clipping'); }
        await form.locator('.ah-general-extra > summary').focus(); await page.keyboard.press('Enter'); assert.equal(await form.locator('.ah-general-extra').evaluate(node => node.open), true);
        await form.locator('[data-proposal-toggle]').focus(); await page.keyboard.press('Space'); assert.equal(await form.locator('[data-proposal-toggle]').isChecked(), true); assert.equal(await form.locator('[data-speaker-proposal]').isVisible(), true);
        assert.equal(await form.locator('[data-registration-policy],[data-registration-email-policy],[data-registration-email-notice]').count(), 0, 'the form omits the two detailed notices and duplicate email explanation');
        assert.equal(await page.locator('#privacy > details').evaluate(node => node.open), false, 'privacy details start collapsed');
        await form.locator('a[href="#privacy"]').focus(); await page.keyboard.press('Enter');
        assert.equal(await page.locator('#privacy > details').evaluate(node => node.open), true, 'the consent link opens the existing footer privacy disclosure');
        assert.equal(await page.locator('#privacy > details > summary').evaluate(node => document.activeElement === node), true, 'reading continues at the opened disclosure');
        assert.equal(await form.locator('[name=consentAccepted]').isChecked(), false, 'reading the notice never consents on the visitor’s behalf');
        const privacyText = await page.locator('[data-public-privacy]').textContent();
        for (const [key,value] of Object.entries(config.privacy)) assert.ok(privacyText.includes(key === 'contactEmail' ? 'kunan@globalgamejam.org' : value), 'the linked notice preserves the current policy with the approved public support contact');
        assert.match(privacyText, /EmailJS/u);
        await form.locator('[name=name]').focus(); await page.keyboard.press('Tab'); assert.equal(await form.locator('[name=email]').evaluate(node => document.activeElement === node), true);
        const focus = await form.locator('[name=email]').evaluate(node => { const style = getComputedStyle(node); return { outline: parseFloat(style.outlineWidth), outlineStyle: style.outlineStyle, shadow: style.boxShadow }; });
        assert.ok(focus.outline >= 2 && focus.outlineStyle !== 'none' || focus.shadow !== 'none', 'keyboard focus has a visible indicator');
        await form.locator('[name=name]').fill('合成可读性'); await form.locator('[name=email]').fill('type@example.invalid');
        const consent = form.locator('[name=consentAccepted]'); await consent.focus(); await page.keyboard.press('Space'); assert.equal(await consent.isChecked(), true); await page.keyboard.press('Space'); assert.equal(await consent.isChecked(), false);
        const open = await measure(page, 'open');
        stage = 'front-end-errors'; await form.locator('[data-submit]').click(); await form.locator('[data-form-error]:visible').waitFor();
        assert.equal(await form.locator('[data-form-error]').evaluate(node => document.activeElement === node), true); assert.ok(await form.locator('[aria-invalid=true]').count() >= 3);
        const invalid = await measure(page, 'invalid');
        const applicationShot = resolve(evidence, 'application-' + width + '.png'); await page.locator('#registration').screenshot({ path: applicationShot });
        stage = 'seed-local-unknown';
        const payload = { eventId, fields: { intake: 'general-v2', name: '合成可读性核对人', email: 'synthetic.typography@example.invalid', categories: ['student'], participationInterests: ['attend'], organization: '合成独立单位' }, consent: { accepted: true, version: config.privacy.version } };
        const pending = { eventId, idempotencyKey: 'b'.repeat(64), payloadJson: JSON.stringify(payload), attempted: true, uncertain: true };
        await page.goto(SITE + '/__typography-seed/', { waitUntil: 'domcontentloaded' });
        await page.evaluate(async pending => {
          const { createBrowserDraftStore } = await import('/__typography-source__/src/lib/browser-drafts.mjs');
          const { createApplicationDraft } = await import('/__typography-source__/src/lib/application-draft.mjs');
          const store = createBrowserDraftStore(), draft = createApplicationDraft({ store, eventId: pending.eventId });
          await draft.read(); await draft.pendingStore.prepare(pending); store.close();
        }, pending);
        stage = 'unknown-recovery'; await page.goto(SITE + '/#registration', { waitUntil: 'networkidle' }); await page.evaluate(() => document.fonts.ready); await page.locator('[data-application-recovery]:visible').waitFor();
        assert.equal(await page.locator('[data-application-edit-fields]').isVisible(), false);
        const recovery = await measure(page, 'recovery'); assert.ok(recovery.roles.heading.length >= 1);
        const stored = await page.evaluate(async eventId => {
          const { createBrowserDraftStore } = await import('/__typography-source__/src/lib/browser-drafts.mjs');
          const { createApplicationDraft } = await import('/__typography-source__/src/lib/application-draft.mjs');
          const store = createBrowserDraftStore(), draft = createApplicationDraft({ store, eventId });
          try { return (await draft.read()).record.value; } finally { store.close(); }
        }, eventId);
        assert.deepEqual(stored, pending, 'rendering unknown recovery preserves the exact original local request');
        const recoveryShot = resolve(evidence, 'recovery-' + width + '.png'); await page.locator('#registration').screenshot({ path: recoveryShot });
        assert.equal((await runtime.app.registrationService.repository.list()).registrations.length, 0); assert.equal(runtime.messages.length, 0);
        reports.push({ width, keyboardAndConsent: true, optionalAndProposal: true, clientErrorsWithoutSubmission: true, unknownRecoveryFromBrowserDraft: true, originalPendingUnchanged: true, applicationRecords: 0, providerCalls: 0, agenda, open, invalid, recovery, screenshots: [applicationShot, recoveryShot] });
      } catch (error) {
        await activePage?.screenshot({ path: resolve(evidence, 'failure-' + width + '.png'), fullPage: true }).catch(() => {});
        throw error;
      } finally { activePage = null; await context.close(); }
    }
    assert.deepEqual(pageErrors, []); assert.equal(reports.length, 4);
  } catch (error) {
    failure = { message: error.message, stack: error.stack };
    await activePage?.screenshot({ path: resolve(evidence, 'failure-' + currentWidth + '.png'), fullPage: true }).catch(() => {});
  } finally {
    await browser.close(); activeBrowser = null;
    assert.equal(sha(await readFile(resolve(dist, 'index.html'))), sha(html), 'the tested build stays frozen');
    const report = { ok: !failure, cases: reports.length, expectedCases: 4, syntheticOnly: true, source, dist, scriptSha256, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim(), publicHtmlSha256: sha(html), htmlMtime: htmlInfo.mtime.toISOString(), minimum,
      realNetworkRequests: 0, businessPostRequests: 0, mailRequests: 0, requests, servedAssets: Object.fromEntries([...servedAssets].sort()), reports, pageErrors, ...(failure ? { failure } : {}) };
    await writeFile(resolve(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    const contrasts = reports.flatMap(item => [item.open, item.invalid, item.recovery].flatMap(state => state.panels.flatMap(panel => panel.text.map(text => text.ratio))));
    const summary = { ok: report.ok, cases: reports.length, expectedCases: 4, syntheticOnly: true, publicHtmlSha256: report.publicHtmlSha256, sourceCommit: report.sourceCommit, scriptSha256, pageErrorCount: pageErrors.length, businessPostRequests: 0, mailRequests: 0, minimumContrast: contrasts.length ? Math.min(...contrasts) : null,
      ...(failure ? { failure: { code: 'PUBLIC_TYPOGRAPHY_ASSERTION_FAILED', stage, width: currentWidth, location: /public-typography-smoke\.mjs:\d+:\d+/u.exec(failure.stack)?.[0] ?? null }, numericMetrics } : {}) };
    process.stdout.write((report.ok ? 'Public typography browser verified: ' : 'Public typography browser failed: ') + JSON.stringify(summary) + '\n');
  }
  if (failure) process.exitCode = 1;
}

await main().catch(async error => {
  await activeBrowser?.close().catch(() => {});
  process.stdout.write('Public typography browser failed: ' + JSON.stringify({ ok: false, cases: 0, expectedCases: 4, syntheticOnly: true, failure: { code: 'PUBLIC_TYPOGRAPHY_PREFLIGHT_FAILED', stage, width: currentWidth, location: /public-typography-smoke\.mjs:\d+:\d+/u.exec(error.stack ?? '')?.[0] ?? null } }) + '\n');
  process.exitCode = 1;
});
