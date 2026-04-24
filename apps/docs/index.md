---
layout: home

hero:
  name: Nimiq Simple Faucet
  tagline: Self-hosted reusable faucet and payout service for Nimiq, with a pluggable abuse stack and seven first-party SDKs.
  actions:
    - theme: brand
      text: Get started
      link: /guide/quick-start
    - theme: alt
      text: View on GitHub
      link: https://github.com/PanoramicRum/nimiq-simple-faucet

features:
  - title: Self-hosted
    details: One container, one binary. Ships as `ghcr.io/panoramicrum/nimiq-simple-faucet:latest` with SQLite defaults; scales to Postgres and Redis when you need it.
  - title: Pluggable abuse stack
    details: Turnstile, hCaptcha, FCaptcha, hashcash, GeoIP/ASN, on-chain Nimiq heuristics, and optional LLM scoring combine into a single decision pipeline.
  - title: AI-agent integration (MCP)
    details: An `/mcp` endpoint exposes public, integrator, and admin tools so Claude Code, Cursor, and custom agents can introspect, claim, and moderate.
  - title: Admin dashboard
    details: Built-in dashboard for balance, claim history, blocklists, and live decision explanations with step-up TOTP for sensitive actions.
  - title: Six first-party SDKs
    details: TypeScript, React, Vue, Capacitor, React Native, Flutter, and Go. Every SDK exposes the same `claim(address, { hostContext })` surface.
  - title: Docker, Compose, Helm
    details: Production manifests under `deploy/` cover Docker Compose for single-node setups and Helm charts for Kubernetes with secret-mounted keyrings.
---
