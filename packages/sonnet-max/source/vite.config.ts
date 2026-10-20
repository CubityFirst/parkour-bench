import { defineConfig } from 'vite';

// `base: './'` keeps every URL in the production build relative, so the
// contents of dist/ can be hosted from any sub-path (or opened via any static server).
export default defineConfig({
  base: './',
  server: {
    port: 5173,
    open: false,
  },
  preview: {
    port: 4173,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Keep Three.js in its own long-lived chunk.
        manualChunks(id: string) {
          if (id.includes('node_modules/three')) return 'three';
          return undefined;
        },
      },
    },
  },
});
