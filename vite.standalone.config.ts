import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * The standalone build. Everything is inlined afterwards by
 * scripts/build-standalone.mjs into a single page that needs no server.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  build: {
    outDir: 'dist-standalone',
    assetsInlineLimit: 0,
    rollupOptions: { output: { manualChunks: undefined } },
  },
});
