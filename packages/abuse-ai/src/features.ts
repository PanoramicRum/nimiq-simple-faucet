import type { BuildFeaturesArgs, FeatureBundle } from './types.js';

const ONE_HOUR_MS = 60 * 60_000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

export async function buildFeatures({ req, query }: BuildFeaturesArgs): Promise<FeatureBundle> {
  const uid = req.hostContext?.uid;
  // Fan out all counters in parallel; they are independent reads.
  const [claimsByIp1h, claimsByIp24h, claimsByAddress1h, claimsByAddress24h, claimsByUid24h] =
    await Promise.all([
      query.byIp(req.ip, ONE_HOUR_MS),
      query.byIp(req.ip, ONE_DAY_MS),
      query.byAddress(req.address, ONE_HOUR_MS),
      query.byAddress(req.address, ONE_DAY_MS),
      uid ? query.byUid(uid, ONE_DAY_MS) : Promise.resolve(0),
    ]);

  return {
    claimsByIp1h,
    claimsByIp24h,
    claimsByAddress1h,
    claimsByAddress24h,
    claimsByUid24h,
    fingerprintEntropy: fingerprintEntropy(req.fingerprint),
    hostContextVerified: hostContextVerified(req),
    // Onchain freshness comes from a later pipeline stage; default to 0 here.
    addressIsFresh: 0,
    hourOfDayUtc: new Date(req.requestedAt).getUTCHours(),
  };
}

function fingerprintEntropy(fp: { components?: Record<string, unknown> | undefined; confidence?: number | undefined } | undefined): number {
  if (!fp) return 0.5 * 0.5;
  if (fp.components) {
    const n = Object.keys(fp.components).length;
    return Math.min(1, n / 20);
  }
  return 0.5 * (fp.confidence ?? 0.5);
}

function hostContextVerified(req: { hostContext?: unknown; hostContextVerified?: boolean | undefined }): number {
  if (req.hostContextVerified) return 1;
  if (req.hostContext) return 0;
  return 0.5;
}
