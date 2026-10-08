import { defineConfig } from 'vite';

// Pure reception logic (WhatsApp number handling, queue filters/search/order).
// Test-only; not part of `npm run build`.
export default defineConfig({
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: 'tests/dist-reception',
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: 'tests/reception.entry.ts',
      formats: ['iife'],
      name: 'IAppReceptionTest',
      fileName: () => 'reception.js',
    },
  },
});
