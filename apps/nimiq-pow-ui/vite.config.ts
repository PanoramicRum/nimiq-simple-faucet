import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

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
    port: 5174,
    proxy: {
      '/v1': { target: httpTarget, changeOrigin: true },
      '/v1/stream': { target: wsTarget, ws: true, changeOrigin: true },
    },
  },
});
