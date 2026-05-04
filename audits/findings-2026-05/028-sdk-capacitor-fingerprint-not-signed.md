# sdk-capacitor injects `Device.getId()` as `visitorId` without HMAC signing — parity gap with closed #104

**Severity:** Low
**CVSS v3.1:** AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:N (3.7)
**Component:** packages/sdk-capacitor
**Affected versions:** main @ 855868a (introduced when sdk-capacitor shipped, after the original audit)

> _The maintainer of this repository has waived the SECURITY.md private-disclosure policy for the duration of this audit; this finding is therefore filed publicly. Downstream forks should NOT inherit this disclosure channel._

## Summary

The original audit's [#104](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/104) flagged that `sdk-go` and `sdk-flutter` did not implement `hostContext` HMAC signing — a gap closed by [PR #134](https://github.com/PanoramicRum/nimiq-simple-faucet/pull/134) (which brought all SDKs to parity). The new `sdk-capacitor` package, added after the audit, has the same gap: it auto-injects `Device.getId()` as `fingerprint.visitorId` on every claim, but does not invoke `FaucetClient.signHostContext()`. The injected `visitorId` is therefore an *unsigned* client claim — exactly the trust-boundary problem #96/#104 closed for other SDKs.

If the server's fingerprint abuse-layer treats `visitorId` as a meaningful signal (it does, per [`packages/abuse-fingerprint/`](../../packages/abuse-fingerprint/)), an attacker:
1. Modifies the Capacitor app or the device's Capacitor plugin to return arbitrary `visitorId` values.
2. Submits each claim from a fresh fake `visitorId` to bypass per-device correlation.
3. Sees the same per-IP rate-limit they'd see without the SDK — fingerprint correlation contributes 0 to the abuse score.

## Location

- [`packages/sdk-capacitor/src/index.ts:20-57`](../../packages/sdk-capacitor/src/index.ts#L20-L57) — `claim()` and `solveAndClaim()` wrappers inject `visitorId` from `Device.getId()` directly
- Compare with the parity reference: [`packages/sdk-flutter/`](../../packages/sdk-flutter/) and [`packages/sdk-go/`](../../packages/sdk-go/) implement `signHostContext()` per the closed #104.

## Reproduction

Modify `packages/sdk-capacitor/src/index.ts` (or any clone of the published package) to mock `Device.getId()`:

```ts
// Pretend to be a different device on every claim
const fakeIds = ['device-a', 'device-b', 'device-c'];
let i = 0;
const Device = {
  getId: () => Promise.resolve({ identifier: fakeIds[i++ % fakeIds.length] }),
};
```

Submit 100 claims from the same IP. The server's fingerprint layer sees 100 distinct `visitorId`s and registers 1 visit per UID — well below any per-UID threshold. The per-IP rate-limit still fires, so the attack is bounded by IP quota; but if the operator was relying on fingerprint correlation to lift the per-IP cap (e.g., shared NAT scenarios), this bypass quietly defeats that.

## Impact

- **Trust boundary**: a client-side device identifier is treated by the abuse pipeline as if it had origin-of-trust. It doesn't.
- **Same shape as closed #104**: not a new class of vulnerability, just a new instance. Severity Low because:
  - Per-IP rate-limit + claim-amount cap are unchanged; this finding only weakens fingerprint correlation, one of 10 abuse layers.
  - Most operator deployments don't lean heavily on fingerprint scoring.
  - The integrator HMAC signing path (for backends that proxy claims) does sign hostContext, so server-to-server integrations are unaffected.

## Recommended fix

Two options, depending on Capacitor's expected usage model:

### Option A — sign on the device using a baked-in secret (BAD; documented for completeness)

Don't do this. A Capacitor app's APK/IPA can be reverse-engineered; any baked-in HMAC secret is harvestable. The integrator-HMAC model assumes the secret lives on a *backend* the integrator controls.

### Option B (recommended) — document that `visitorId` from sdk-capacitor is unsigned client input

Update [`packages/sdk-capacitor/README.md`](../../packages/sdk-capacitor/README.md) and inline JSDoc on the `claim()` wrapper:

```ts
/**
 * Submits a claim with the current device identifier auto-attached as
 * `fingerprint.visitorId`.
 *
 * SECURITY NOTE: `visitorId` is UNSIGNED client input. The faucet's
 * fingerprint abuse-layer uses it for correlation, not authentication —
 * an attacker who controls the Capacitor app can spoof this value. Do
 * not weight it heavily in abuse scoring; rely on per-IP rate-limit
 * and signed `hostContext` (via `FaucetClient.signHostContext()` from
 * a backend) for trust.
 *
 * If the integrator runs a backend, sign hostContext there and pass
 * the signed envelope through to this SDK's `claim()` via the
 * `hostContext` option.
 */
```

Plus add a runtime warning in dev mode: if `Device.getId()` is the only signal and there's no signed hostContext, emit `console.warn('[sdk-capacitor] visitorId is unsigned client input ...')`.

### Option C — surface a signing path through the integrator HMAC

If integrators have a backend, they can mint a signed hostContext server-side using `FaucetClient.signHostContext()` (already in sdk-ts) and pass the resulting object to the Capacitor SDK's claim call. Document this pattern explicitly in the Capacitor README — it's how the existing `mini-app-claim-{vue,react}` examples handle the same trust boundary.

Recommend **Option B + C together**: B prevents footgun usage, C points integrators at the correct hardening pattern.

## References

- [Original audit finding #104](https://github.com/PanoramicRum/nimiq-simple-faucet/issues/104) — same gap, closed for sdk-go and sdk-flutter via PR #134
- [`SECURITY.md` "Trust boundary model" → "Client-supplied claim payload"](../../SECURITY.md) — defines `hostContext.{trust-claims}` as unsigned-by-default
- Related CWE: CWE-345 (Insufficient Verification of Data Authenticity)
