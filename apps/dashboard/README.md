# @nimiq-faucet/dashboard

Admin dashboard for the Nimiq faucet. Vue 3 + Vite + TypeScript + Tailwind v3,
bundled into a static directory that Fastify serves at `/admin/` in production.

## Scripts

```
pnpm -F @nimiq-faucet/dashboard dev        # Vite dev server on :5174, proxies /admin/* and /v1/* to Fastify on :8080
pnpm -F @nimiq-faucet/dashboard typecheck   # vue-tsc --noEmit
pnpm -F @nimiq-faucet/dashboard build       # vue-tsc + vite build → dist/
pnpm -F @nimiq-faucet/dashboard preview     # serve the built bundle locally
```

## Running locally

1. Start the Fastify server in dev mode (admin routes require
   `FAUCET_ADMIN_PASSWORD` — pick anything for local dev):

   ```
   FAUCET_DEV=1 FAUCET_ADMIN_PASSWORD=dev pnpm -F @nimiq-faucet/server dev
   ```

2. In another shell:

   ```
   pnpm -F @nimiq-faucet/dashboard dev
   ```

3. Open http://localhost:5174/admin/login. On the very first login the server
   returns a TOTP provisioning URI (shown as a QR code and raw URI) once; scan
   it with any authenticator app and keep the secret safe.

The Vite dev server proxies all `/admin/*` and `/v1/*` requests (including the
`/v1/stream` WebSocket) to `http://localhost:8080`, so the browser sees a
single origin and cookies work identically to production.

## Production

`pnpm -F @nimiq-faucet/dashboard build` writes a self-contained static bundle
to `apps/dashboard/dist/`. The Fastify app registers `@fastify/static` against
that directory at prefix `/admin/` (see M4.4 in
`/home/richy/.claude/plans/starry-roaming-bunny.md`). The bundle is
`base: '/admin/'`, so all asset URLs resolve correctly behind the mount.

## Architecture

- `src/main.ts` — bootstraps Vue + Pinia + vue-router.
- `src/router.ts` — routes + `beforeEach` auth guard.
- `src/App.vue` — login-only layout vs. sidebar + top-bar shell.
- `src/stores/auth.ts` — Pinia store; infers "likely logged in" from the
  readable `faucet_csrf` cookie and confirms via a `/admin/overview` probe.
- `src/lib/api.ts` — `fetch` wrapper: always `credentials: 'include'`,
  `X-Faucet-Csrf` on mutations, optional `X-Faucet-Totp` for step-up, dispatches
  logout + redirect on 401.
- `src/lib/stream.ts` — WebSocket client for `/v1/stream` with exponential
  backoff reconnect. Filters by `event.type`.
- `src/lib/qr.ts` — hand-rolled QR renderer (byte mode, ECC-L, up to version
  10) used only for the first-login TOTP URI so we do not ship a QR dependency.
- `src/views/*.vue` — one view per sidebar route. Components live in
  `src/components/`.

## Security notes

- The HttpOnly session cookie (`faucet_session`) is never accessible from JS;
  we only read the separate double-submit CSRF cookie (`faucet_csrf`).
- Step-up TOTP is required for `/admin/account/send` and
  `/admin/account/rotate-key`. The code is sent in the `X-Faucet-Totp` header;
  it is never logged and never stored in component state after a request.
- Integrator API keys and HMAC secrets are shown **once** after create/rotate.
  The banner disappears when dismissed.
