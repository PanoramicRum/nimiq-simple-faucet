# Release playbook

How to cut a release of the Nimiq Simple Faucet. Written for the maintainer.

The automated workflow handles most of the work. This doc covers the human steps around it.

## One-time setup

Before cutting the first public release, ensure the following exist as GitHub repo secrets (**Settings → Secrets and variables → Actions**):

| Secret | Purpose | Where to get it |
|--------|---------|-----------------|
| `NPM_TOKEN` | Publish `@nimiq-faucet/*` packages to npm | https://www.npmjs.com/settings/panoramicrum/tokens — create an **Automation** token |
| `GITHUB_TOKEN` | Builtin; used to push images to GHCR, Helm chart to OCI registry, and create the Release | (nothing to do — automatic) |

No other secrets are required for Tier 1 publishing. Optional add-ons:

- `PUB_DEV_PUBLISH_TOKEN` — only if you wire pub.dev publishing into the workflow later. Currently the Flutter SDK is published manually (see below).

## Cutting a release

### 1. Prepare the version bump

Changesets drives the npm version bump. Before tagging, make sure there is at least one pending entry in `.changeset/`:

```bash
pnpm changeset
# Pick packages, pick bump type (major / minor / patch), write a short summary.
```

For the inaugural 1.0.0 release, the major bump changeset already lives at [.changeset/initial-1.0.0.md](../.changeset/initial-1.0.0.md).

Also bump the non-npm artifacts by hand so everything lines up:

- `deploy/helm/Chart.yaml` — both `version:` and `appVersion:`
- `packages/sdk-flutter/pubspec.yaml` — `version:`

### 2. Dry-run with a release candidate

Always dry-run before tagging the real release:

```bash
git tag v1.0.0-rc1
git push origin v1.0.0-rc1
```

The workflow at [.github/workflows/release.yml](../.github/workflows/release.yml) will:

1. Build the Docker image and push it to `ghcr.io/panoramicrum/nimiq-simple-faucet:1.0.0-rc1` and `:latest`
2. Run `pnpm changeset version` → `pnpm changeset publish` against npm
3. Package and push the Helm chart to `oci://ghcr.io/panoramicrum/charts`
4. Create the GitHub Release, auto-detected as prerelease because of the `-rc1` suffix
5. Pull the image back, extract `/openapi.yaml`, open a PR that updates `packages/openapi/openapi.yaml` in the repo

Watch the workflow. If anything fails, delete the tag and investigate:

```bash
git push origin :v1.0.0-rc1
git tag -d v1.0.0-rc1
```

Verify the artifacts landed:

```bash
# Docker image
docker pull ghcr.io/panoramicrum/nimiq-simple-faucet:1.0.0-rc1

# npm packages
npm view @nimiq-faucet/sdk@1.0.0-rc1

# Helm chart
helm pull oci://ghcr.io/panoramicrum/charts/nimiq-simple-faucet --version 1.0.0-rc1
```

### 3. Tag the real release

Only after the rc is green:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The same workflow runs, and because there is no prerelease suffix the GitHub Release is marked as the latest stable.

### 4. Publish the Flutter SDK (manual)

The current release workflow does **not** publish to pub.dev. Do this by hand, from the repo root:

```bash
cd packages/sdk-flutter
dart pub publish --force
```

You'll need a valid pub.dev login (`dart pub login`) before the first run. This step is on the Tier 3 roadmap to be automated; see [ROADMAP.md](../ROADMAP.md).

### 5. Update the Go SDK consumers

Go modules resolve by git tag automatically. Once `v1.0.0` is on the default branch, consumers can:

```bash
go get github.com/PanoramicRum/nimiq-simple-faucet/packages/sdk-go@v1.0.0
```

No per-SDK tag is required — the repo-level tag is what Go's module proxy indexes.

### 6. Post-release housekeeping

- Merge the auto-opened "freeze OpenAPI" PR after sanity-checking the diff
- Announce on the Nimiq community channels if appropriate
- Bump `.changeset/` with a new entry targeting the next release cycle

## Troubleshooting

- **npm publish fails with 402 Payment Required**: `.changeset/config.json` has `"access": "restricted"`. Change to `"public"` (scoped npm packages default to paid-only without this).
- **Helm push fails with 401**: the OCI registry URL in `release.yml` points at the wrong org. Verify `CHART_OCI_REGISTRY` matches where the image is pushed.
- **GHCR image push fails with "denied"**: the repo's Actions permissions need to allow `packages: write`. Check workflow-level permissions in `release.yml`.

## See also

- [CHANGELOG.md](../CHANGELOG.md) — per-release notes
- [ROADMAP.md](../ROADMAP.md) — what's planned for future releases
- [.github/workflows/release.yml](../.github/workflows/release.yml) — the automated side
