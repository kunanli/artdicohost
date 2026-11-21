import { defineConfig } from 'astro/config';

// Static website only. Registration persistence belongs to a separate FC API.
export default defineConfig({
  output: 'static',
  trailingSlash: 'always',
  build: { inlineStylesheets: 'auto' },
  vite: { build: { target: 'es2022', rollupOptions: { output: {
    // Keep shared contracts and projections in one chunk when both public detail
    // pages and staff workspaces use them. The FC admin graph has a 44-asset bound.
    manualChunks(id) {
      if (['/shared/general-application.mjs', '/shared/registration-schema.mjs', '/shared/showcase-display.mjs', '/src/lib/admission-view.mjs', '/shared/staff-permissions.mjs', '/src/lib/admin-sections.mjs', '/src/lib/admin-save-state.mjs', '/src/lib/xlsx-download.mjs', '/src/lib/person-confirmation.mjs', '/src/lib/delivery-settings.mjs'].some(path => id.endsWith(path))) return 'registration-domain';
      // These helpers create no stores or views until called. Keep their shared
      // dependency graph in one asset when the same editors span many pages.
      if (['/src/lib/browser-drafts.mjs', '/src/lib/staff-form-draft.mjs', '/src/lib/operations-form-draft.mjs'].some(path => id.endsWith(path))) return 'staff-drafts';
    },
  } } } },
});
