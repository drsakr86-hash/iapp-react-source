import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The waiting-room screen, its pure logic, the announcer and the calling
// service, bundled for jsdom. Test-only; not part of `npm run build`.
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: 'tests/dist-display',
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: 'tests/display.entry.tsx',
      formats: ['iife'],
      name: 'IAppDisplayTest',
      fileName: () => 'display.js',
    },
  },
});
