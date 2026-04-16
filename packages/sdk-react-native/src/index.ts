import {
  FaucetClient,
  type ClaimOptions,
  type ClaimResponse,
  type FaucetClientOptions,
  type FingerprintBundle,
} from '@nimiq-faucet/sdk';

export * from '@nimiq-faucet/sdk';

/**
 * Minimal subset of `react-native-device-info` we rely on. Declared inline
 * so we don't force consumers to install the types package at build time.
 */
interface DeviceInfoLike {
  getUniqueIdSync(): string;
}

/**
 * Resolve `react-native-device-info` via Metro's CommonJS `require`. The peer
 * dep is provided by the host app and is always available at runtime under RN;
 * we only keep the try/catch for graceful degradation in unit-test setups.
 */
function loadDeviceInfo(): DeviceInfoLike | undefined {
  try {
    const req = (globalThis as { require?: (id: string) => unknown }).require;
    if (typeof req !== 'function') return undefined;
    const mod = req('react-native-device-info') as
      | { default?: DeviceInfoLike; getUniqueIdSync?: () => string }
      | undefined;
    if (!mod) return undefined;
    if (mod.default && typeof mod.default.getUniqueIdSync === 'function') return mod.default;
    if (typeof mod.getUniqueIdSync === 'function') {
      const fn = mod.getUniqueIdSync;
      return { getUniqueIdSync: () => fn.call(mod) };
    }
  } catch {
    // Peer dep missing; gracefully degrade.
  }
  return undefined;
}

/**
 * FaucetClient wrapper that auto-populates `fingerprint.visitorId` from
 * `DeviceInfo.getUniqueIdSync()`. Caller-provided `visitorId` wins.
 */
export class ReactNativeFaucetClient extends FaucetClient {
  private readonly deviceInfo: DeviceInfoLike | undefined;
  private cachedId: string | undefined;

  constructor(opts: FaucetClientOptions) {
    super(opts);
    this.deviceInfo = loadDeviceInfo();
  }

  private getId(): string | undefined {
    if (this.cachedId !== undefined) return this.cachedId;
    try {
      this.cachedId = this.deviceInfo?.getUniqueIdSync();
    } catch {
      this.cachedId = undefined;
    }
    return this.cachedId;
  }

  private inject(options: ClaimOptions): ClaimOptions {
    if (options.fingerprint?.visitorId) return options;
    const id = this.getId();
    if (!id) return options;
    const fp: FingerprintBundle = { ...(options.fingerprint ?? {}), visitorId: id };
    return { ...options, fingerprint: fp };
  }

  override async claim(address: string, options: ClaimOptions = {}): Promise<ClaimResponse> {
    return super.claim(address, this.inject(options));
  }

  override async solveAndClaim(
    address: string,
    options: ClaimOptions & { uid?: string; onProgress?: (attempts: number) => void } = {},
  ): Promise<ClaimResponse> {
    const injected = this.inject(options);
    const merged: ClaimOptions & { uid?: string; onProgress?: (attempts: number) => void } = injected;
    if (options.uid !== undefined) merged.uid = options.uid;
    if (options.onProgress !== undefined) merged.onProgress = options.onProgress;
    return super.solveAndClaim(address, merged);
  }
}

export function createReactNativeFaucetClient(opts: FaucetClientOptions): ReactNativeFaucetClient {
  return new ReactNativeFaucetClient(opts);
}
