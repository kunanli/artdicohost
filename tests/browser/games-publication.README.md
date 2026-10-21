# Games and publication native acceptance

Run only after the source owner freezes the matching root source and built `dist`.
The browser never connects to production: every URL is intercepted, staff HTML is
served through the production FC alias map, and API calls execute the actual
`peopleRuntimeFixture` application over memory OSS. All identities, pictures,
credentials and publications are synthetic; mail remains disabled.

```sh
ARTDICO_SOURCE_DIRECTORY=/workspace/artdicohost \
ARTDICO_DIST_DIRECTORY=/workspace/artdicohost/dist \
ARTDICO_PLAYWRIGHT_MODULE=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs \
ARTDICO_CHROMIUM_BINARY=/usr/bin/chromium \
node tests/browser/games-publication-smoke.mjs
```

Optional `ARTDICO_BROWSER_GROUPS=flow,games,refresh,people` selects focused groups.
The default covers 30 reports, including desktop and 320/390-pixel viewports.
Screenshots and JSON provenance are written/read under
`.local-data/browser-evidence/games-publication/` (redirect standard output to
`results.json`; progress goes to standard error).

The primary path is actual staff UI save, anonymous API unchanged, explicit UI
publication, and public rendering after returning to the frontend. Additional
proof covers no-photo guest readiness, actual published red/green states and
withdrawal, private projection, three works sharing one booth, independent
creator organization, legacy absent metadata, explicit relation clearing,
native IndexedDB recovery and exact original pending retry, and proof-dialog
logout. People replies remain distinct from formal attendance places; game
counts do not alter the shared 300-person ledger. Owner labels retain the same
color through filtering, reload and the personal workspace.

Refresh tests combine one real browser history navigation with explicit native
DOM lifecycle events for controlled races. A held old response is delivered
despite abort and its fetch settlement is observed before checking the new DOM.
The delayed packets come from the actual runtime. Invalid-metadata fault cases
alter only the designated response and remove stale Content-Length framing.
These tests cover handler behavior; they do not claim a browser BFCache hit.
Browser time advances (`setSystemTime`), so the real debounce, minimum interval
and ten-second deadline execute rather than remaining frozen.

Run the prior independent-page 39 reports, organization-admin 4,
people-relationships 23 and image-editor 12 sequentially against the same final
bundle where their controllers changed. Do not build, run other Chromium
suites or pack XZ concurrently with this acceptance.
