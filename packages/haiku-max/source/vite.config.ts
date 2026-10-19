import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
  },
  build: {
    target: 'es2022',
    // Three.js alone is a large single chunk; the game ships no other heavy assets.
    chunkSizeWarningLimit: 1200,
  },
});
