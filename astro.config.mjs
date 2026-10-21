import { defineConfig } from 'astro/config';

// Static website only. Registration persistence belongs to a separate FC API.
export default defineConfig({
  output: 'static',
  trailingSlash: 'always',
  build: { inlineStylesheets: 'auto' },
  vite: { build: { target: 'es2022', rollupOptions: { output: {
    // Share pure form/permission/navigation contracts without adding a runtime asset.
    manualChunks(id) {
      if (['/shared/registration-schema.mjs', '/src/lib/admission-view.mjs', '/shared/staff-permissions.mjs', '/src/lib/admin-sections.mjs'].some(path => id.endsWith(path))) return 'registration-domain';
    },
  } } } },
});
