import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Proxy targets the Fastify app on 8080 so `pnpm dev` mirrors prod single-origin.
export default defineConfig({
  plugins: [vue()],
  base: '/',
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      // WebSocket entries must come first so Vite picks them over the generic /v1 rule.
      '/ws/v1/stream': { target: 'ws://localhost:8080', ws: true, changeOrigin: true },
      '/v1/stream': { target: 'ws://localhost:8080', ws: true, changeOrigin: true },
      '/v1': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
  worker: {
    format: 'es',
  },
});
