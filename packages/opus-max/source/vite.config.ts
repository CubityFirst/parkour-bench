import { defineConfig } from 'vite';

// Relative base so the production build works from any sub-path (or straight from disk).
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});
