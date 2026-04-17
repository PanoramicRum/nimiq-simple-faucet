# 🎮 Nimiq Simple Faucet — Choose your adventure

> 👋 **Welcome to Nimiq Simple Faucet.** A self-hosted, stable (1.x) faucet / payout service for Nimiq with 9 pluggable abuse-prevention layers (rate-limiting on by default; others opt-in) and 7 SDKs.

**Pick a quest — reply with a number:**

**[1] 🚀 Quick demo** · ~5–10 min
  Boot the compose stack (`docker compose --profile local-node up -d` — see the [Quick Start section of the README](./README.md#quick-start)), confirm `/admin` loads, done. "Does this work?"

**[2] 🐳 Docker container trial** · ~20 min
  Path [1] plus generate a wallet, fund it at https://faucet.pos.nimiq-testnet.com, wire the credentials into `.env`, and claim a real testnet tx. End state: admin dashboard open, confirmed tx in the claims table. Full walkthrough: [deploy/compose/README.md](./deploy/compose/README.md).

**[3] 🧪 Full platform walkthrough** · ~2 hr
  Exercise every feature — server, admin dashboard, claim UI, 5 examples, 7 SDKs, CLI tools, MCP server, 9 abuse layers. See [docs/qa-testing.md](./docs/qa-testing.md).

**[4] 🧩 Drop into my app** · ~10 min
  Framework recipe (Next.js, Vue, Capacitor, React Native, Flutter, Go, plain TS). See [AGENTS.md](./AGENTS.md#recipes).

**[5] 🏗️ Deploy to production** · ~1 hr
  TLS, secrets, Helm chart, single-image Docker. See [docs/deployment-production.md](./docs/deployment-production.md). (Postgres backend is on the [roadmap](./ROADMAP.md) — SQLite today.)

**[6] 🛠️ Fork & customize** · open-ended
  Add a new abuse layer, driver, or SDK. See [CONTRIBUTING.md](./CONTRIBUTING.md) and [packages/core/README.md](./packages/core/README.md).

**[7] 🛡️ Security / compliance review** · ~5 min
  Anti-fraud posture + trust-connector vision. See [docs/fraud-prevention.md](./docs/fraud-prevention.md).

**[8] 📚 Just let me read** · no commitment
  Audience-grouped doc index at [docs/README.md](./docs/README.md).

---

For the full agent briefing (authoritative sources, integration recipes, stable facts): [AGENTS.md](./AGENTS.md).
