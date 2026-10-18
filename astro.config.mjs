import { defineConfig } from 'astro/config';

// Static website only. Registration persistence belongs to a separate FC API.
export default defineConfig({
  output: 'static',
  trailingSlash: 'always',
  build: { inlineStylesheets: 'auto' },
  vite: { build: { target: 'es2022' } },
});
