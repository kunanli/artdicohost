// Actual runtime CAS, one final save gesture, precise ACKs and response faults.
import {runAdminIndependentBrowser} from './admin-independent-pages-smoke.mjs';
await runAdminIndependentBrowser({groups:['save']});
