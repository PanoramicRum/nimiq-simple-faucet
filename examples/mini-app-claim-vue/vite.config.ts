import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const hmrHost = process.env.VITE_HMR_HOST;

export default defineConfig({
  plugins: [vue()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    hmr: hmrHost ? { host: hmrHost, protocol: 'ws', clientPort: 5173 } : undefined,
  },
});
