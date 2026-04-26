# Production deployment

This is the runbook for deploying the Nimiq Simple Faucet to a real
environment. For local development or testnet smoke testing, see
[smoke-testing.md](./smoke-testing.md) instead.

Two shipping paths are supported and fully tested:

- **Docker Compose** — single-host deploys. SQLite in a named volume
  today; good up to low-thousand claims/day.
- **Helm / Kubernetes** — the standard path for anything
  production-grade. Chart lives in [`deploy/helm/`](../deploy/helm/).
  Single-replica with a PVC-backed SQLite on 1.0.x.

Pick whichever fits your operational maturity.

> **Note on Postgres + Redis (for this release, 1.0.x):** The Postgres
> and Redis subcharts in the Helm chart and the `postgres` profile in
> docker-compose are defined but NOT yet consumed by the server — that
> lands in a future 1.x release (tracked in [ROADMAP](../ROADMAP.md) §1.3.x).
> Until then, SQLite is the supported backend. All references to
> "Postgres" below describe the 1.3.x target; the current code path
> refuses non-SQLite `DATABASE_URL` values.

---

## 1. Decide how the faucet holds its key

This is the single most important decision. The faucet MUST be able to sign
transactions; you pick *where the private key lives*.

| Mode | `FAUCET_SIGNER_DRIVER` | Key location | When to use |
|------|------------------------|--------------|-------------|
| WASM | `wasm` | In the faucet process, from `FAUCET_PRIVATE_KEY` env var (and encrypted to disk at `/data/faucet.key` via `FAUCET_KEY_PASSPHRASE`) | Default. Simplest. Faucet connects directly to testnet/mainnet seed peers. |
| RPC | `rpc` | In a separate `core-rs-albatross` node with the wallet pre-unlocked | You already run a Nimiq node and want to centralise key custody. |

**For either mode**, the address is `FAUCET_WALLET_ADDRESS`. The faucet
will refuse to start if this is unset or if it can't produce the same
address from the supplied key.

> **RPC security note:** When using `FAUCET_SIGNER_DRIVER=rpc`, the faucet
> sends the private key and wallet passphrase to the Nimiq node via
> `importRawKey` and `unlockAccount` RPC calls. Inside a Docker Compose
> network this is safe (traffic stays on the isolated bridge network), but
> if the RPC node is on a separate host, **always use HTTPS** for
> `FAUCET_RPC_URL` to protect key material in transit. Never expose the
> RPC port to the public internet.

---

## 2. Pre-flight checklist

- [ ] Secret manager selected (Vault, AWS Secrets Manager, GCP Secret Manager, sealed-secrets, or plain k8s Secret)
- [ ] For K8s: External Secrets Operator installed, OR you're comfortable maintaining a plain `Secret` yourself
- [ ] For K8s with TLS: cert-manager installed + ClusterIssuer configured
- [ ] Ingress controller installed (nginx, traefik, cloud-native, etc.)
- [ ] DNS A/AAAA record pointing at your cluster's ingress
- [ ] A funded Nimiq address on the correct network (main or test)
- [ ] Captcha provider (Turnstile or hCaptcha account, or a self-hosted FCaptcha instance) if you're exposing the public claim UI
- [ ] Postgres (managed RDS / Cloud SQL / self-hosted) if you expect >1 replica or >1000 claims/day
- [ ] Redis (managed ElastiCache / Memorystore) for the same case
- [ ] Backup strategy: SQLite volume snapshots OR Postgres logical dumps

---

## 3. Docker Compose path

### Step-by-step

```bash
git clone https://github.com/PanoramicRum/nimiq-simple-faucet.git
cd nimiq-simple-faucet/deploy/compose
cp .env.example .env
```

Edit `.env`:

```bash
FAUCET_NETWORK=main                      # or test
FAUCET_SIGNER_DRIVER=wasm                # simplest; rpc if you have an external node
FAUCET_WALLET_ADDRESS=NQ12 ...           # your funded address
FAUCET_PRIVATE_KEY=<64 hex or 12/24-word mnemonic>

FAUCET_ADMIN_PASSWORD=<16+ chars>
FAUCET_KEY_PASSPHRASE=<16+ chars>        # encrypts the on-disk key blob

FAUCET_TURNSTILE_SITE_KEY=...            # or FAUCET_HCAPTCHA_SITE_KEY
FAUCET_TURNSTILE_SECRET=...              # matching secret

FAUCET_TLS_REQUIRED=true                 # KEEP AT TRUE IN PROD
FAUCET_CORS_ORIGINS=https://your-integrator.example.com  # explicit list, no '*'

POSTGRES_USER=faucet
POSTGRES_PASSWORD=<generate a strong one>
POSTGRES_DB=faucet
```

Start it:

```bash
docker compose up -d
```

**Put it behind TLS.** The faucet refuses to boot on plain HTTP when
`FAUCET_TLS_REQUIRED=true`. In production you always want this, so the
compose stack should sit behind either:

- A reverse proxy on the host (Caddy, Traefik) with a Let's Encrypt cert, or
- A cloud load balancer (ALB, Cloud LB) with an ACM / managed cert

Don't publish port 8080 to the public internet directly.

### Backups (Compose path)

The `faucet-data` volume contains the SQLite DB, the encrypted key blob,
and the admin TOTP secret. Back it up regularly:

```bash
# Hot backup (safe; SQLite supports online backup)
docker compose exec faucet sqlite3 /data/faucet.db ".backup '/data/faucet.db.backup'"
docker cp compose-faucet-1:/data/faucet.db.backup /secure-backup/$(date +%F).db

# Also snapshot the encrypted key blob
docker cp compose-faucet-1:/data/faucet.key /secure-backup/$(date +%F).key
```

Rotation and offsite replication are your responsibility.

---

## 4. Kubernetes / Helm path

### Install the chart

The chart is published at `oci://ghcr.io/panoramicrum/charts/nimiq-simple-faucet`:

```bash
helm install faucet \
  oci://ghcr.io/panoramicrum/charts/nimiq-simple-faucet \
  --version 1.0.0 \
  --namespace faucet \
  --create-namespace \
  -f values-prod.yaml
```

See [`deploy/helm/examples/values-prod.yaml`](../deploy/helm/examples/values-prod.yaml)
for a production-grade starting point that this doc builds on.

### Secrets (External Secrets Operator)

The default values assume ESO. Pre-create a ClusterSecretStore that points
at your real secret manager, then populate these keys:

| Remote key | Property | Maps to env var |
|------------|----------|-----------------|
| `faucet/admin` | `password` | `FAUCET_ADMIN_PASSWORD` |
| `faucet/admin` | `totp` | `FAUCET_ADMIN_TOTP_SECRET` |
| `faucet/wallet` | `key-passphrase` | `FAUCET_KEY_PASSPHRASE` |
| `faucet/wallet` | `private-key` | `FAUCET_PRIVATE_KEY` |
| `faucet/captcha` | `turnstile-secret` | `FAUCET_TURNSTILE_SECRET` |
| `faucet/captcha` | `turnstile-site-key` | `FAUCET_TURNSTILE_SITE_KEY` |
| `faucet/abuse` | `hashcash-secret` | `FAUCET_HASHCASH_SECRET` |
| `faucet/integrators` | `keys` | `FAUCET_INTEGRATOR_KEYS` |

The full list is in [`deploy/helm/values.yaml`](../deploy/helm/values.yaml)
under `secrets.external.data`. You can add or remove entries there.

### Secrets (no ESO — plain k8s Secret)

If you don't run ESO:

```yaml
# values-prod.yaml
secrets:
  external:
    enabled: false
  values:
    FAUCET_ADMIN_PASSWORD: ""      # keep empty in committed files!
    FAUCET_KEY_PASSPHRASE: ""
    FAUCET_PRIVATE_KEY: ""
    # ...
```

Then supply real values at install time via `--set-file` or a second
override file that is **never committed** and lives only on the
operator's machine / in sealed-secrets:

```bash
helm install faucet … -f values-prod.yaml -f values-secrets-LOCAL.yaml
```

### TLS + ingress with cert-manager

```yaml
# values-prod.yaml
ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/proxy-body-size: "1m"
    # Optional hardening:
    nginx.ingress.kubernetes.io/force-ssl-redirect: "true"
  hosts:
    - host: faucet.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: faucet-tls
      hosts:
        - faucet.example.com

config:
  corsOrigins: "https://your-integrator.example.com"
  tlsRequired: true
```

### Persistence and Postgres

SQLite is fine for up to ~1 req/sec sustained. Past that, enable Postgres:

```yaml
# values-prod.yaml
persistence:
  enabled: false    # disable local SQLite PVC

postgresql:
  enabled: true
  auth:
    username: faucet
    database: faucet
    existingSecret: faucet-postgres     # created by your ESO / sealed secret
    secretKeys:
      adminPasswordKey: postgres-password
      userPasswordKey: password
  primary:
    persistence:
      size: 50Gi

redis:
  enabled: true
  auth:
    existingSecret: faucet-redis
    existingSecretPasswordKey: password
  architecture: standalone

replicaCount: 2
```

> **Migration from SQLite to Postgres:** the server does not ship an
> automatic migration. If you have existing SQLite data to preserve,
> export via `sqlite3 /data/faucet.db .dump | psql $DATABASE_URL` before
> switching modes. Most operators just start fresh on Postgres — the
> claims table grows quickly anyway, and historic data can be archived
> from SQLite separately.

### NetworkPolicy

The chart ships a commented-out `NetworkPolicy` scaffold. Uncomment and
tune egress to only reach:

- Your Nimiq RPC endpoint (port 443 if HTTPS, 8648 if self-hosted)
- Captcha verify endpoints (`challenges.cloudflare.com`, `hcaptcha.com`)
- GeoIP provider (IPinfo API or MaxMind update endpoint, if used)

```yaml
networkPolicy:
  enabled: true
  # see values.yaml for the starter template
```

### Scaling

Replicas >1 require:

- Postgres enabled (SQLite can't be shared)
- Redis enabled (for rate-limit counters and nonces)
- Session cookies signed with a stable secret (already handled by the chart)

Do not scale horizontally if you kept SQLite. Horizontal scaling with a
local sqlite volume is silently corrupting in ways that are painful to
debug. The chart won't stop you, but you've been warned.

---

## 5. Post-install verification

Once the pod is `Ready`:

```bash
# 1. Health
curl -fsS https://faucet.example.com/healthz
# → "ok"

# 2. Public config (verify abuse layers are enabled as expected)
curl -s https://faucet.example.com/v1/config | jq .

# 3. Admin dashboard
open https://faucet.example.com/admin
# → first login triggers TOTP enrolment (see docs/admin-first-run.md)

# 4. Real claim against testnet (keep the stack on testnet until you're happy)
curl -X POST https://faucet.example.com/v1/claim \
  -H 'content-type: application/json' \
  -d '{"address":"NQ12 ..."}'
```

If anything in step 1-3 fails, check pod logs; most prod-run misconfigs
are caught by the server's startup Zod validation (it'll crash-loop with
a clear error message).

---

## 6. Hardening checklist before going live

- [ ] `FAUCET_TLS_REQUIRED=true`
- [ ] `FAUCET_CORS_ORIGINS` set to an explicit CSV, not `*`
- [ ] `FAUCET_NETWORK=main` (if running mainnet)
- [ ] Captcha provider configured and verified with a real claim
- [ ] `FAUCET_ADMIN_PASSWORD` changed from any default
- [ ] TOTP enrolled on first login (not skipped)
- [ ] Rate limits tuned: `FAUCET_RATE_LIMIT_PER_MINUTE`, `FAUCET_RATE_LIMIT_PER_IP_PER_DAY`
- [ ] GeoIP allow/deny lists match your legal footprint (`FAUCET_GEOIP_DENY_COUNTRIES`)
- [ ] Backup job cronned and tested (restore-from-backup actually works)
- [ ] Alerting wired — see [health-observability.md](./health-observability.md)
- [ ] Secret rotation schedule documented (TOTP, admin password, HMAC secrets, wallet key)
- [ ] Memory-hygiene mitigations applied (see §6.1) for mainnet deployments holding the signing key in-process

### 6.1 Signer-key memory hygiene

The WASM signer driver decrypts the operator's private key into the
faucet process's heap and keeps it resident for the lifetime of the
container. This is operationally simple — no external HSM, no per-tx
unlock — but it widens the blast radius of a process-level compromise:
a core dump, a `ptrace`-capable adversary, or a reachable
`/proc/<pid>/mem` reads the key directly.

The audit's recommended mitigations, in order of cost:

1. **Disable core dumps.** In Compose, `ulimits: { core: { soft: 0,
   hard: 0 } }` on the `faucet` service. In Kubernetes, set
   `securityContext.allowPrivilegeEscalation: false` (already on by
   default in our Helm chart) AND ensure your kernel's
   `kernel.core_pattern` doesn't pipe core dumps to a writable location.
2. **Restrict `ptrace`.** Run with the
   `prevent_privilege_escalation` Pod Security Standard (default in
   recent Kubernetes) AND `securityContext.seccompProfile.type:
   RuntimeDefault` (already on by default in our chart) which blocks
   `ptrace`/`process_vm_readv` from inside the container.
3. **Read-only root filesystem.** Already on by default
   (`containerSecurityContext.readOnlyRootFilesystem: true`). Prevents
   an attacker who gains code execution from staging a debugger binary.
4. **Switch to the RPC driver for production.** When `FAUCET_SIGNER_DRIVER=rpc`,
   the private key never enters the faucet process. The Nimiq node
   holds it (you can additionally run that node in a dedicated namespace
   with stricter Pod Security). This is the recommended path for
   non-trivial mainnet balances.
5. **Rotate the key on a known schedule.** A leaked-but-unused key has
   a fixed window of validity. Pair this with the audit-log alerting
   on `account.send` so an unexpected withdrawal is noticed within
   minutes, not days.

The chart's defaults (read-only rootfs, `runAsNonRoot`, RuntimeDefault
seccomp, no `allowPrivilegeEscalation`) cover items 1–3 for most
clusters. Item 4 is a deploy-time choice; item 5 is operational.

---

## 7. Troubleshooting

- **Pod crashlooping with `FATAL: no TLS and TLS_REQUIRED=true`** — either front the faucet with an ingress that terminates TLS, or if you're intentionally running behind a trusted reverse proxy, set `FAUCET_TLS_REQUIRED=false` (not recommended).
- **`/admin/login` returns 401 after correct password** — TOTP enrolment wasn't completed. Visit `/admin/login` in a fresh browser session; it will force the enrolment flow again (the QR code is re-displayed only the first time).
- **`Driver not initialized` for minutes** — WASM client is still establishing consensus with seed peers. This can take up to 60s on cold start. If it hangs longer, check egress rules — the pod needs outbound WSS to `*.seed.nimiq.*`.
- **Claims succeed but `status` stays at `broadcast`** — this was a bug in pre-1.0 RPC driver; fixed in 1.0.0. If you see it on 1.0.0+, check `docker logs` for `confirmation failed` warnings and the node's responsiveness.

See also [health-observability.md](./health-observability.md) for monitoring.
