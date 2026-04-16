<!-- Thanks for contributing. Keep this template short; the security checklist is non-negotiable. -->

## Summary

<!-- 1-2 sentences describing the change and why. -->

## Changes

<!-- Bullet list of the notable changes. Group by package/app if helpful. -->

-

## Test plan

- [ ] `pnpm build` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` (unit) passes
- [ ] `pnpm test:e2e` passes (if UI or route behaviour changed)
- [ ] Manual smoke against a local container (if deploy-affecting)

## Security checklist

See [`docs/security/hardening-checklist.md`](../docs/security/hardening-checklist.md) for the full list.

- [ ] No secrets in diff (keys, tokens, passwords, TOTP seeds, HMAC signatures)
- [ ] New inputs validated at boundary (Zod schema or equivalent)
- [ ] No stack traces in user-facing errors (generic messages in prod)
- [ ] Admin mutations go through `/admin/*` (not direct DB writes from UI)
- [ ] New env vars added to `.env.example` with a one-line description
- [ ] Timing-safe comparisons where user input meets secrets (`timingSafeEqual`)
