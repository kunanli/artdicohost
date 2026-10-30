import { defineConfig } from 'astro/config';

// Static website only. Registration persistence belongs to a separate FC API.
export default defineConfig({
  output: 'static',
  trailingSlash: 'always',
  build: { inlineStylesheets: 'auto' },
  vite: { build: { target: 'es2022', rollupOptions: { output: {
    // Share form/permission/navigation contracts and the explicitly invoked export
    // helper, keeping the admin graph within the existing 40-asset package budget.
    manualChunks(id) {
      if (['/shared/registration-schema.mjs', '/src/lib/admission-view.mjs', '/shared/staff-permissions.mjs', '/src/lib/admin-sections.mjs', '/src/lib/admin-save-state.mjs', '/src/lib/xlsx-download.mjs', '/src/lib/person-confirmation.mjs'].some(path => id.endsWith(path))) return 'registration-domain';
      // These helpers create no stores or views until called. Keep their shared
      // dependency graph in one asset when the same editors span many pages.
      if (['/src/lib/browser-drafts.mjs', '/src/lib/staff-form-draft.mjs', '/src/lib/operations-form-draft.mjs'].some(path => id.endsWith(path))) return 'staff-drafts';
    },
  } } } },
});
