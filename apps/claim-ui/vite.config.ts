import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Proxy targets the Fastify server. Default 8080 (Docker internal port).
// Override with FAUCET_PORT for local dev when compose maps to a different host port.
const faucetPort = process.env.FAUCET_PORT ?? '8080';
const httpTarget = `http://localhost:${faucetPort}`;
const wsTarget = `ws://localhost:${faucetPort}`;

export default defineConfig({
  plugins: [vue()],
  base: '/',
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: process.env.NODE_ENV !== 'production',
  },
  server: {
    port: 5173,
    proxy: {
      // WebSocket entries must come first so Vite picks them over the generic /v1 rule.
      '/ws/v1/stream': { target: wsTarget, ws: true, changeOrigin: true },
      '/v1/stream': { target: wsTarget, ws: true, changeOrigin: true },
      '/v1': { target: httpTarget, changeOrigin: true },
      '/healthz': { target: httpTarget, changeOrigin: true },
      '/readyz': { target: httpTarget, changeOrigin: true },
    },
  },
  worker: {
    format: 'es',
  },
});
