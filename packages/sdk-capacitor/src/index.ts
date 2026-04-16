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
