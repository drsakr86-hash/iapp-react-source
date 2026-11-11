import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The examination form and service (partial save / retry), bundled for jsdom.
// Test-only; not part of `npm run build`.
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: 'tests/dist-examsave',
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: 'tests/examsave.entry.tsx',
      formats: ['iife'],
      name: 'IAppExamSaveTest',
      fileName: () => 'examsave.js',
    },
  },
});
