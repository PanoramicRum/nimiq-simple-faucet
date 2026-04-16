# Helm chart — `nimiq-simple-faucet`

Installs the Nimiq Simple Faucet (Fastify API + admin UI) on Kubernetes.

## Prerequisites

- Kubernetes **1.28+**
- An Ingress controller (nginx, Traefik, etc.) if you want external access
- [cert-manager](https://cert-manager.io/) for automatic TLS certificates (optional but recommended)
- [External Secrets Operator](https://external-secrets.io/) for the default secrets flow (optional; inline fallback is supported)
- Helm **3.12+**

## Install

```bash
# Add Bitnami (required for the optional postgresql / redis sub-charts)
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update

# From the repo root
helm dependency update deploy/helm
helm install faucet deploy/helm \
  --namespace faucet --create-namespace \
  --set config.corsOrigins="https://app.example.com" \
  --set ingress.enabled=true \
  --set ingress.className=nginx \
  --set ingress.hosts[0].host=faucet.example.com \
  --set ingress.hosts[0].paths[0].path=/ \
  --set ingress.hosts[0].paths[0].pathType=Prefix
```

Or install the published OCI chart:

```bash
helm install faucet oci://ghcr.io/nimiq/charts/nimiq-simple-faucet \
  --version 0.1.0 --namespace faucet --create-namespace \
  -f my-values.yaml
```

## Secrets

Two modes, controlled by `secrets.external.enabled`:

1. **External Secrets (default).** The chart renders an `ExternalSecret` that
   materialises a Kubernetes Secret with the `FAUCET_*` env keys consumed by
   the pod. Configure `secrets.external.secretStoreRef` and
   `secrets.external.data` to point at your backing store (Vault, AWS Secrets
   Manager, GCP, 1Password, etc.).
2. **Inline fallback.** Set `secrets.external.enabled=false` and supply
   `secrets.values` via a **local**, git-ignored override file (`-f prod.yaml`).
   Never commit plaintext secrets to the chart.

Secret keys are the same `FAUCET_*` variables defined in
[`apps/server/src/config.ts`](../../apps/server/src/config.ts).

## Persistence

- **SQLite mode (default, the only supported mode on 1.0.x).**
  `persistence.enabled=true` renders a PVC mounted at `/data`. Single-replica
  only.
- **Postgres/Redis mode — NOT YET FUNCTIONAL.** Server-side Postgres support
  is tracked in [ROADMAP.md 1.3.x](../../ROADMAP.md). The Bitnami subchart
  dependencies remain in the chart so 1.3.x can flip them on without
  structural changes, but on 1.0.x do NOT set `postgresql.enabled=true` —
  the faucet will still use SQLite and the subchart will run unused.

## Upgrade notes

- Always run `helm dependency update` before `helm upgrade` when chart version
  is bumped.
- Upgrades use a zero-surge RollingUpdate (`maxUnavailable: 0`) to avoid
  double-writer races during the SQLite → SQLite rollout.
- When switching storage backends (SQLite → Postgres) in a future 1.3.x, an
  explicit export/import of the claim history will be needed; the chart will
  not migrate data for you.

## Values reference

See [`values.yaml`](./values.yaml) for the full annotated list. Highlights:

| Key | Default | Notes |
| --- | --- | --- |
| `image.repository` | `ghcr.io/panoramicrum/nimiq-simple-faucet` | Published on release. |
| `image.tag` | `""` → `.Chart.AppVersion` | Pin to a tag for reproducibility. |
| `replicaCount` | `1` | Must stay at `1` on 1.0.x (SQLite single-writer). Multi-replica lands with Postgres in ROADMAP 1.3.x. |
| `config.network` | `test` | `main` for production. |
| `config.claimAmountLuna` | `100000` | 1 NIM = 100 000 luna. |
| `config.corsOrigins` | _required_ | Explicit CSV or `*`. |
| `secrets.external.enabled` | `true` | Flip to `false` for inline fallback. |
| `persistence.size` | `10Gi` | SQLite mode only. |
| `ingress.enabled` | `false` | Enable and set className + TLS for prod. |
| `networkPolicy.enabled` | `false` | Uncomment egress rules before enabling. |

## Uninstall

```bash
helm uninstall faucet --namespace faucet
```

The PVC is retained by default. Delete it explicitly if you want the SQLite
data gone:

```bash
kubectl -n faucet delete pvc faucet-nimiq-simple-faucet-data
```
