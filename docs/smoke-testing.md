# End-to-end testnet smoke test

This walkthrough drives a real transaction through the faucet on Nimiq testnet:
start the stack, run `pnpm smoke:testnet`, and see a confirmed transaction
hash at the end. Use it before tagging a release.

There are two wallet flows — pick whichever matches your situation.

---

## Flow A: bring your own funded wallet

If you already have a testnet address with NIM and know its private key, this
is the fastest path.

1. **Set wallet values in `deploy/compose/.env`:**

   ```bash
   cd deploy/compose
   cp .env.example .env
   ```

   Edit `.env`:
   ```
   FAUCET_SIGNER_DRIVER=wasm
   FAUCET_WALLET_ADDRESS=NQ00 …your address…
   FAUCET_PRIVATE_KEY=…64-char hex or 12/24-word mnemonic…
   FAUCET_ADMIN_PASSWORD=any-dev-password
   FAUCET_KEY_PASSPHRASE=any-dev-passphrase-min-8-chars
   ```

2. **Start the stack:**
   ```bash
   docker compose up -d
   ```

3. **Run the smoke test:**
   ```bash
   cd ../..
   FAUCET_BASE_URL=http://localhost:8080 pnpm smoke:testnet
   ```

   Success looks like:
   ```
   [smoke] base url: http://localhost:8080
   [smoke] network=test, hashcash=true
   [smoke] generated fresh recipient: NQ00 …
   [smoke] solving hashcash (difficulty=20)…
   [smoke] hashcash solved
   [smoke] claim accepted: id=… status=broadcast
   [smoke] confirmed tx: …
   [smoke] explorer: https://test.nimiq.watch/#…
   ```

---

## Flow B: generate a fresh wallet and fund it

If you don't have a testnet wallet yet, generate one and fund it from a public
testnet faucet.

1. **Generate a fresh keypair:**
   ```bash
   pnpm generate:wallet
   ```

   This writes `.wallet.local.json` (gitignored) in the repo root and prints
   the new address.

2. **Fund the printed address** from a public testnet faucet:
   - https://faucet.pos.nimiq-testnet.com

   Wait for the transaction to confirm (a few seconds).

3. **Read the values out:**
   ```bash
   cat .wallet.local.json
   ```

4. **Copy them into `deploy/compose/.env`:**
   ```
   FAUCET_SIGNER_DRIVER=wasm
   FAUCET_WALLET_ADDRESS=NQ00 …address from .wallet.local.json…
   FAUCET_PRIVATE_KEY=…privateKey from .wallet.local.json…
   FAUCET_ADMIN_PASSWORD=any-dev-password
   FAUCET_KEY_PASSPHRASE=any-dev-passphrase-min-8-chars
   ```

5. **Start + smoke test** (same as Flow A steps 2-3):
   ```bash
   cd deploy/compose && docker compose up -d
   cd ../.. && pnpm smoke:testnet
   ```

---

## Using a local Nimiq node (`rpc` driver)

The default flow above uses `FAUCET_SIGNER_DRIVER=wasm` — the faucet connects
to testnet directly via seed peers and signs in-process. This is the simplest
setup.

If you want to drive a local `core-rs-albatross` node instead:

```bash
cd deploy/compose
docker compose --profile local-node up -d
```

This adds a `nimiq` service reachable at `http://nimiq:8648` on the compose
network. The faucet talks to it via `FAUCET_SIGNER_DRIVER=rpc` and
`FAUCET_RPC_URL=http://nimiq:8648`. Initial testnet sync takes several
minutes to an hour.

**Caveat:** the `rpc` driver requires the node to hold your wallet's private
key and have it unlocked. Set this up on the node before running the smoke
test. The `wasm` flow is easier if you just want to validate the faucet.

---

## Troubleshooting

- **"Driver not initialized"**: the WASM client is still establishing
  consensus with testnet seed peers. Wait up to a minute after startup and
  retry. Check `docker compose logs faucet`.
- **"Insufficient funds"**: your `FAUCET_WALLET_ADDRESS` hasn't received
  testnet NIM yet, or the transaction hasn't confirmed. Check the address
  on https://test.nimiq.watch.
- **"claim rejected: geo-blocked"**: either disable geo-IP for local testing
  (`FAUCET_GEOIP_BACKEND=none` in `.env`) or add your country to the allow
  list.
- **hashcash timeout**: default difficulty (20 bits) can take up to a minute
  on slow hardware. Lower it with `FAUCET_HASHCASH_DIFFICULTY=16` for local
  testing.

---

## What this proves

A successful smoke test confirms:
- The Docker image builds and runs
- Postgres + Redis wire up correctly
- The WASM/RPC driver can establish consensus on testnet
- The abuse pipeline (including hashcash) runs end-to-end
- A claim flows through broadcast and lands on-chain

It does **not** cover:
- Admin dashboard flows (see Playwright e2e)
- Captcha providers — Turnstile/hCaptcha need real site keys, FCaptcha needs a running instance ([deploy/compose/fcaptcha.yml](../deploy/compose/fcaptcha.yml))
- GeoIP accuracy — tested in unit tests against fixtures

Never commit `.env`, `.wallet.local.json`, or any real keys.
