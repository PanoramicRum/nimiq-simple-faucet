import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// The dashboard is served at `/admin/` in production. `base` must match so
// asset URLs in the built bundle resolve correctly behind the Fastify mount.
// In dev we proxy both `/admin/*` and `/v1/*` to the Fastify app on :8080.
export default defineConfig({
  plugins: [vue()],
  base: '/admin/',
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5174,
    proxy: {
      '/admin/auth': { target: 'http://localhost:8080', changeOrigin: true },
      '/admin/overview': { target: 'http://localhost:8080', changeOrigin: true },
      '/admin/claims': { target: 'http://localhost:8080', changeOrigin: true },
      '/admin/blocklist': { target: 'http://localhost:8080', changeOrigin: true },
      '/admin/integrators': { target: 'http://localhost:8080', changeOrigin: true },
      '/admin/config': { target: 'http://localhost:8080', changeOrigin: true },
      '/admin/account': { target: 'http://localhost:8080', changeOrigin: true },
      '/admin/audit-log': { target: 'http://localhost:8080', changeOrigin: true },
      '/v1': { target: 'http://localhost:8080', changeOrigin: true, ws: true },
    },
  },
});
