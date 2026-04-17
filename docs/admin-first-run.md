# Admin dashboard: first-run walkthrough

The faucet's admin dashboard is at `/admin`. This doc walks through the
three things you have to do on first boot:

1. Log in with the bootstrap password
2. Enrol a TOTP authenticator
3. Fund the faucet wallet and run a test claim

The whole flow takes about 5 minutes if you have an authenticator app
ready.

---

## Prerequisites

You should already have the faucet running (locally, via Docker Compose,
or on Kubernetes — pick from [deployment-production.md](./deployment-production.md)
or [smoke-testing.md](./smoke-testing.md)).

You need:

- `FAUCET_ADMIN_PASSWORD` env var set to some reasonable secret (8+ chars)
- A TOTP authenticator app ready: Google Authenticator, 1Password, Bitwarden, Authy, etc.
- A funded Nimiq wallet — you can generate one via `pnpm generate:wallet` and fund it from the [public testnet faucet](https://faucet.pos.nimiq-testnet.com)

---

## Step 1 — Log in

Browse to `https://<your-faucet>/admin/login` (or `http://localhost:8080/admin/login` locally).

You'll see a single password field labelled **Admin password**.

Enter the password you set via `FAUCET_ADMIN_PASSWORD`. Submit.

**What happens:**

- The server compares your input against a salted Argon2id hash stored in
  the `admin_users` table
- On success, it issues a short-lived session cookie (`faucet_session`)
- On failure, the response is a 401 with a generic "invalid credentials"
  message — no distinction between bad password and missing user

**Rate limiting:** `/admin/auth/login` is rate-limited to 5 requests/minute
per IP. After that you'll see 429s for a minute. This catches naive
credential-stuffing.

---

## Step 2 — Enrol a TOTP authenticator

On the very first successful login, the server notices you have no TOTP
secret enrolled and returns an enrolment response:

- A base-32 TOTP secret
- A `otpauth://...` provisioning URI
- A QR code rendered in the dashboard (the dashboard uses a built-in QR
  renderer — no external JS dependency)

**Scan the QR with your authenticator app.** The app will start showing
a 6-digit code that rotates every 30 seconds.

Enter the current code in the dashboard's **Verify** field and submit.

The server verifies the code using `otplib` with the standard RFC 6238
parameters (30-second step, SHA-1, 6 digits). Once it matches, the secret
is persisted into `admin_users.totp_secret` and future logins require
both the password **and** a fresh TOTP code.

> **Important:** The QR / secret is only shown **once** during enrolment.
> If you lose it before scanning, you'll need to reset the TOTP entry in
> the database manually. Back up the secret (or enrol multiple devices
> against the same QR) before closing the enrolment dialog.

### If you need to re-enrol

Run the admin CLI inside the running container:

```bash
docker exec <container> node apps/server/dist/admin-cli.js reset-totp
```

This wipes the admin user + sessions. The next login triggers a fresh
TOTP enrolment, showing a new QR code / secret.

---

## Step 3 — Find the faucet address and fund it

After TOTP enrolment, you'll land on `/admin/overview`.

Open the **Account** page in the left sidebar. You'll see:

- **Faucet address** — this is what the server will sign transactions
  from. Copy it.
- **Balance** — starts at 0
- **Claim amount** — what each successful claim will send (default
  100,000 luna = 1 NIM)

Send testnet NIM to that address from another source:

- **Testnet:** https://faucet.pos.nimiq-testnet.com
- **Mainnet:** from your treasury / exchange withdrawal

Wait ~5 seconds for the transaction to confirm on Albatross (block time
is 1s). The dashboard polls the driver every few seconds; the **Balance**
will update on its own.

---

## Step 4 — Run a test claim

From a browser or curl:

```bash
curl -X POST https://<your-faucet>/v1/claim \
  -H 'content-type: application/json' \
  -d '{"address":"NQ12 ... any test recipient ..."}'
```

Expected response:

```json
{
  "id": "abc123",
  "status": "broadcast",
  "txId": "d04dee6aa4b59ffa..."
}
```

Watch the **Claims** page in the dashboard — your claim should appear
and transition from `broadcast` → `confirmed` within a few seconds.

Click the row to open the **explain drawer**: it shows the full abuse
pipeline trace for that claim (which layers evaluated, their signals,
the final decision).

---

## Step 5 — Lock it down for production

Before you expose this instance to real users:

- [ ] Change `FAUCET_ADMIN_PASSWORD` from any default (the bootstrap value
      you set in env, if it was anything like `dev` or `changeme`).
- [ ] Set `FAUCET_CORS_ORIGINS` to your integrator's actual origins —
      don't leave `*` in production.
- [ ] Enable a captcha provider: `FAUCET_TURNSTILE_SITE_KEY` +
      `FAUCET_TURNSTILE_SECRET`, or the hCaptcha equivalents. Without one,
      your faucet will burn through its balance in minutes under bot load.
- [ ] Tune rate limits: `FAUCET_RATE_LIMIT_PER_IP_PER_DAY` (default 5) is
      almost always too generous for mainnet. 1-2 is more typical.
- [ ] Configure GeoIP to match your legal footprint — see the `geoip*`
      env vars in `.env.example`.
- [ ] Provision at least one integrator key for your backend —
      **Integrators** page → **Create**. See [integrator-hmac.md](./integrator-hmac.md)
      for how to use it.
- [ ] Back up `/data/faucet.key` and `/data/faucet.db` (or your Postgres
      dump). Losing the key means losing the faucet wallet.
- [ ] Hook up alerting on balance — see [health-observability.md](./health-observability.md).

Done. Your faucet is live.

---

## Troubleshooting

- **"Invalid credentials" with the right password**: double-check
  `FAUCET_ADMIN_PASSWORD` on the container env. Containers don't reread
  env when you update `.env` — they need to be recreated.
- **QR code won't scan**: many authenticator apps require HTTPS for the
  camera permission. Use the text URI option instead, or enrol from a
  laptop with the app on the same device.
- **TOTP code rejected**: server and device clock skew. The enrolment
  flow accepts ±1 step (30s) by default. Ensure your authenticator app
  has clock sync enabled.
- **Claim stuck at `broadcast`**: was a pre-1.0 bug (fixed in 1.0.0). If
  you see this on current versions, check the Nimiq node health and see
  [health-observability.md](./health-observability.md).

## See also

- [deployment-production.md](./deployment-production.md) — full deploy
- [integrator-hmac.md](./integrator-hmac.md) — backend-signed claims
- [health-observability.md](./health-observability.md) — alerting
- [smoke-testing.md](./smoke-testing.md) — end-to-end testnet validation
