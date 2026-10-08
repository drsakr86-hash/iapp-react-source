import { defineConfig } from 'vite';

// Pure drafts logic (WhatsApp number handling, queue filters/search/order).
// Test-only; not part of `npm run build`.
export default defineConfig({
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: 'tests/dist-drafts',
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: 'tests/drafts.entry.tsx',
      formats: ['iife'],
      name: 'IAppDraftsTest',
      fileName: () => 'drafts.js',
    },
  },
});
