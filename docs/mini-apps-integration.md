# Integrating with a Nimiq Pay Mini App

This page covers what an integrator deploying a [Nimiq Pay Mini App](https://nimiq.com/) needs to know about the Nimiq Simple Faucet — CORS, the WebView's `Origin` header, FCaptcha URL placement, and the security knobs to leave on or off.

The reference apps are at [`examples/mini-app-claim-vue`](../examples/mini-app-claim-vue/) and [`examples/mini-app-claim-react`](../examples/mini-app-claim-react/) (see [PR #113](https://github.com/PanoramicRum/nimiq-simple-faucet/pull/113)).

## CORS allow-list

The Mini App is loaded from a host you control (e.g. `https://app.example.com`). The faucet's `FAUCET_CORS_ORIGINS` controls what `Origin` values are allowed to hit `/v1/claim`.

### Production: enumerate or wildcard-subdomain

```env
# Single origin
FAUCET_CORS_ORIGINS=https://app.example.com

# Multiple origins, comma-separated
FAUCET_CORS_ORIGINS=https://app.example.com,https://admin.example.com

# Issue #122: subdomain wildcard for staging deploys
FAUCET_CORS_ORIGINS=https://app.example.com,*.staging.example.com
```

Wildcard syntax: `*.example.com` matches `https://x.example.com` and `https://x.example.com:8080`. It does NOT match the apex `https://example.com` (add it explicitly), nor deeper labels like `https://a.b.example.com`. Regex metacharacters in the suffix are escaped, so a dot is a literal dot.

### Dev / LAN testing

A real-phone test uses a LAN IP rather than a public hostname:

```env
FAUCET_CORS_ORIGINS=http://192.168.1.50:5173,http://192.168.1.50:5174
```

Wildcard `*` is allowed when `FAUCET_DEV=1` and `FAUCET_TLS_REQUIRED=false`. The server refuses to start with `*` when TLS is required (audit hardening guard).

## WebView `Origin` header — known unknown

> ⚠️ **Open question (issue [#121](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/121)):** what does Nimiq Pay's WebView put in the `Origin` header for a fetch from a LAN-loaded Mini App? Document this with a phone test and update this section.

The unknown matters because:
- If `Origin` is `null` or absent, `FAUCET_REQUIRE_BROWSER=true` blocks the request (the server only sees a non-browser caller).
- If `Origin` is set to the LAN URL, `FAUCET_CORS_ORIGINS` must include it (literal or wildcard).
- If `Origin` is a `chrome-extension://...` style URL, neither browser-only nor any practical CORS allow-list catches it.

Recommendation until a phone test lands:

| Setting | Mini App-fronted faucet | Browser-only faucet |
|---|---|---|
| `FAUCET_REQUIRE_BROWSER` | **`false`** — see "Why" below | `true` |
| `FAUCET_CORS_ORIGINS` | Real hostnames + LAN IPs you test from | Real hostnames only |

**Why `FAUCET_REQUIRE_BROWSER=false`:** non-browser hardening is already provided by captcha (FCaptcha / hCaptcha / Turnstile) + per-IP rate-limit + integrator HMAC. The browser check is a defence-in-depth signal that breaks legitimate Mini App callers. Once the phone test confirms whether `Origin` is set, we may flip the recommendation.

### Capturing the `Origin` value (for the phone test)

1. Boot the faucet with `FAUCET_DEV=1` so request logs aren't redacted.
2. Run a Mini App against it from a real phone inside Nimiq Pay → Mini Apps.
3. Tail the faucet logs while the phone fires `POST /v1/claim`:
   ```bash
   docker compose logs -f faucet | grep '/v1/claim'
   ```
4. Look for `req.headers.origin` in the bound logger output. Record:
   - Android Chrome WebView: ____
   - iOS WKWebView: ____
   - Nimiq Pay app on each: ____
5. Open a comment on issue [#121](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/121) with the result.

## FCaptcha URL placement

Issue [#118](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/118): two URLs, two roles.

| Var | Who hits it | Right value (typical) |
|---|---|---|
| `FAUCET_FCAPTCHA_PUBLIC_URL` | The end user's **browser / WebView** | A phone-reachable URL (`https://captcha.example.com` in prod, `http://192.168.1.50:3000` on a LAN dev box) |
| `FAUCET_FCAPTCHA_INTERNAL_URL` | The faucet **container** verifying tokens | `http://fcaptcha:3000` on the compose bridge, or the same public URL in prod |

In production, both are usually the same public URL — set only `*_PUBLIC_URL` and `*_INTERNAL_URL` defaults to it. The legacy single var `FAUCET_FCAPTCHA_URL` is honoured for one minor as a fallback for both; setting it logs a deprecation warning at boot.

The Mini App reads `FAUCET_FCAPTCHA_PUBLIC_URL` indirectly via `GET /v1/config.captcha.serverUrl`, so as long as the server boots with the right value, the widget loads from the right place.

## Browser-only mode and the `requireBrowser` knob

`FAUCET_REQUIRE_BROWSER=true` requires:
- `Sec-Fetch-Site` header present (sent by all modern browsers; not by `curl`, Python `requests`, etc.)
- `Origin` header present and in the CORS allow-list
- OR a valid integrator HMAC envelope

For a Mini App where the WebView's `Origin` behaviour is uncertain (issue #121), leaving this `false` and relying on the captcha + rate-limit layers is the recommended starting point. Flip to `true` once the phone test confirms `Origin` is a value you can list explicitly.

## Test plan checklist (for your deployment)

- [ ] `FAUCET_CORS_ORIGINS` contains every origin your Mini App can be loaded from (prod hostname, staging wildcard, LAN IP for testing).
- [ ] `FAUCET_FCAPTCHA_PUBLIC_URL` resolves from the user's device — open it in a desktop browser on the same network you'll test from.
- [ ] `FAUCET_FCAPTCHA_INTERNAL_URL` resolves from the faucet container — `docker compose exec faucet wget -qO- $FAUCET_FCAPTCHA_INTERNAL_URL/health` returns 200.
- [ ] A real phone inside Nimiq Pay → Mini Apps can click "Claim NIM" → see `/v1/config` → load the FCaptcha widget → submit → see a `confirmed` claim.
- [ ] `req.headers.origin` for that phone request is recorded against issue #121.

## Related documents

- [`packages/abuse-fcaptcha/README.md`](../packages/abuse-fcaptcha/README.md) — FCaptcha layer config
- [`docs/deployment-production.md`](./deployment-production.md) — production hardening checklist
- [`docs/integrator-hmac.md`](./integrator-hmac.md) — integrator HMAC for non-browser callers
