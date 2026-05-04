import { Device } from '@capacitor/device';
import {
  FaucetClient,
  type ClaimOptions,
  type ClaimResponse,
  type FaucetClientOptions,
  type FingerprintBundle,
} from '@nimiq-faucet/sdk';

export * from '@nimiq-faucet/sdk';

/**
 * Create a `FaucetClient` that auto-populates `fingerprint.visitorId` from
 * Capacitor's `Device.getId()`. A caller-supplied `visitorId` always wins.
 *
 * The returned value extends `FaucetClient`, so the full SDK surface
 * (`status`, `waitForConfirmation`, `config`, `requestChallenge`, `subscribe`)
 * is untouched and passes straight through.
 *
 * **SECURITY NOTE.** `visitorId` is **unsigned client input.** The faucet's
 * fingerprint abuse-layer uses it for correlation, not authentication —
 * an attacker who controls the Capacitor app (modified APK/IPA, JS
 * tampering, runtime hook) can spoof this value to bypass per-device
 * abuse correlation. Don't weight `visitorId` heavily in abuse scoring.
 *
 * For trust, rely on:
 * 1. **Per-IP rate limit** (`FAUCET_RATE_LIMIT_PER_IP_PER_DAY`) — the
 *    primary cap; can't be spoofed without distinct network paths.
 * 2. **Signed `hostContext`** — when an integrator backend is in the
 *    loop, sign hostContext server-side via `FaucetClient.signHostContext()`
 *    (from `@nimiq-faucet/sdk`) and pass the signed envelope into this
 *    SDK's `claim()` via the `hostContext` option. The mini-app-claim
 *    examples follow this pattern.
 *
 * Mirror of audit finding #104 (closed for sdk-go and sdk-flutter), now
 * documented for sdk-capacitor as findings-2026-05/028.
 */
export class CapacitorFaucetClient extends FaucetClient {
  private cachedDeviceId: string | undefined;

  private async deviceId(): Promise<string | undefined> {
    if (this.cachedDeviceId !== undefined) return this.cachedDeviceId;
    try {
      const res = await Device.getId();
      this.cachedDeviceId = res?.identifier;
    } catch {
      this.cachedDeviceId = undefined;
    }
    return this.cachedDeviceId;
  }

  private async withDeviceFingerprint(options: ClaimOptions): Promise<ClaimOptions> {
    if (options.fingerprint?.visitorId) return options;
    const id = await this.deviceId();
    if (!id) return options;
    const fp: FingerprintBundle = { ...(options.fingerprint ?? {}), visitorId: id };
    return { ...options, fingerprint: fp };
  }

  override async claim(address: string, options: ClaimOptions = {}): Promise<ClaimResponse> {
    return super.claim(address, await this.withDeviceFingerprint(options));
  }

  override async solveAndClaim(
    address: string,
    options: ClaimOptions & { uid?: string; onProgress?: (attempts: number) => void } = {},
  ): Promise<ClaimResponse> {
    const injected = await this.withDeviceFingerprint(options);
    // Preserve uid/onProgress without triggering exactOptionalPropertyTypes.
    const merged: ClaimOptions & { uid?: string; onProgress?: (attempts: number) => void } = injected;
    if (options.uid !== undefined) merged.uid = options.uid;
    if (options.onProgress !== undefined) merged.onProgress = options.onProgress;
    return super.solveAndClaim(address, merged);
  }
}

export function createCapacitorFaucetClient(opts: FaucetClientOptions): CapacitorFaucetClient {
  return new CapacitorFaucetClient(opts);
}
