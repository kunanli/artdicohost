// Kept as the established entrypoint; the current contract is independent URLs,
// shared mounted panels, one visible section, and explicit guarded navigation.
import {runAdminIndependentBrowser} from './admin-independent-pages-smoke.mjs';
await runAdminIndependentBrowser({groups:['navigation']});
