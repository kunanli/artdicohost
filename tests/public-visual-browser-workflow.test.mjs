import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('actual-asset browser QA follows the build using captured files and installed locked Playwright, then retains short-lived evidence', async () => {
  const workflow = await readFile(new URL('../.github/workflows/check.yml', import.meta.url), 'utf8');
  const check = workflow.slice(workflow.indexOf('\n  check:'), workflow.indexOf('\n  deploy:'));
  const build = check.indexOf('run: pnpm build'), browser = check.indexOf('id: public_visual_browser'), audit = check.indexOf('name: Audit application');
  assert.ok(browser > build && audit > browser);
  const block = check.slice(check.lastIndexOf('      - name:', browser), audit);
  assert.match(block, /steps\.public_visual_fixture\.outcome == 'success'/u); assert.doesNotMatch(block, /continue-on-error: true/u);
  assert.match(block, /Require captured public assets and complete visual acceptance/u);
  assert.match(block, /steps\.public_visual_fixture\.outcome != 'success' \|\| steps\.public_visual_browser\.outcome != 'success'/u);
  assert.match(block, /exit 1/u);
  assert.match(block, /ARTDICO_PLAYWRIGHT_MODULE: playwright-core/u);
  assert.match(block, /ARTDICO_PUBLIC_VISUAL_FIXTURE_DIRECTORY: \.local-data\/public-visual-fixture/u);
  assert.match(block, /ARTDICO_BUBBLES_EVIDENCE_DIRECTORY: \.local-data\/browser-evidence\/bubbles-logo-bounds/u);
  assert.match(block, /command -v google-chrome \|\| command -v google-chrome-stable \|\| command -v chromium/u);
  assert.match(block, /node tests\/browser\/bubbles-logo-bounds-smoke\.mjs/u);
  assert.match(block, /name: bubbles-logo-bounds-evidence/u); assert.match(block, /retention-days: 1\n/u);
  assert.doesNotMatch(block, /secrets\.|printenv|npx|playwright install|npm install|sudo|workflow_dispatch/u);
});
