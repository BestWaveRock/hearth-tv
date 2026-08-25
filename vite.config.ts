import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: false,
    // hls.js is imported dynamically inside the video player, so the bundler
    // splits it out on its own. No manual chunking needed.
  },
  server: {
    port: 5173,
    proxy: {
      // During `npm run dev`, forward the API to `npm run dev:api` (wrangler).
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
