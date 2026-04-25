import type { AbuseCheck, CheckResult } from '@faucet/core';
import { isHostingOrg, isVpnOrg } from './hosting.js';
import type { GeoIpPolicy, GeoIpResolver, GeoIpResult } from './types.js';

export interface GeoIpCheckConfig {
  resolver: GeoIpResolver;
  policy?: GeoIpPolicy;
  /** Skip the check for private / unroutable IPs. Default true. */
  skipPrivate?: boolean;
  /** Weight in the aggregate score. Default 2. */
  weight?: number;
}

const PRIVATE_IP =
  /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|fc|fd|fe80:)/i;

function isPrivate(ip: string): boolean {
  if (!ip) return true;
  return PRIVATE_IP.test(ip);
}

function normalizeCountries(xs: readonly string[] | undefined): Set<string> | undefined {
  if (!xs || xs.length === 0) return undefined;
  return new Set(xs.map((c) => c.trim().toUpperCase()));
}

function evaluatePolicy(
  info: GeoIpResult,
  policy: GeoIpPolicy,
): { score: number; reason?: string; decision?: 'deny' } {
  const deny = normalizeCountries(policy.denyCountries);
  const allow = normalizeCountries(policy.allowCountries);

  if (info.country) {
    if (deny?.has(info.country)) {
      return { score: 1, decision: 'deny', reason: `country ${info.country} deny-listed` };
    }
    if (allow && !allow.has(info.country)) {
      return { score: 1, decision: 'deny', reason: `country ${info.country} not in allow-list` };
    }
  } else if (allow) {
    // #103: an allow-list means "only these countries" — an unresolved
    // country is by definition not in it. Hard deny instead of a soft
    // 0.9 score that can be averaged below threshold by clean signals
    // from other layers.
    return {
      score: 1,
      decision: 'deny',
      reason: 'country unknown while allow-list active',
    };
  }

  if (info.asn && policy.denyAsns?.includes(info.asn)) {
    return { score: 1, decision: 'deny', reason: `ASN ${info.asn} deny-listed` };
  }

  if (policy.denyTor && info.isTor) {
    return { score: 1, decision: 'deny', reason: 'Tor exit node' };
  }

  const vpnFlag = info.isVpn === true || isVpnOrg(info.asnOrg);
  if (policy.denyVpn && vpnFlag) {
    return { score: 1, decision: 'deny', reason: 'VPN / proxy provider' };
  }

  const hostingFlag = info.isHosting === true || isHostingOrg(info.asnOrg);
  if (policy.denyHosting && hostingFlag) {
    return { score: 1, decision: 'deny', reason: 'datacenter / hosting ASN' };
  }

  // Soft score contributions for signals the policy didn't explicitly deny.
  let score = 0;
  if (vpnFlag) score = Math.max(score, 0.6);
  if (hostingFlag) score = Math.max(score, 0.4);
  return { score };
}

export function geoipCheck(config: GeoIpCheckConfig): AbuseCheck {
  const policy = config.policy ?? {};
  const skipPrivate = config.skipPrivate ?? true;
  return {
    id: 'geoip',
    description: 'Country / ASN / VPN / datacenter policy',
    weight: config.weight ?? 2,
    async check(req): Promise<CheckResult> {
      if (skipPrivate && isPrivate(req.ip)) {
        return { score: 0, signals: { skipped: 'private-ip', ip: req.ip } };
      }
      let info: GeoIpResult;
      try {
        info = await config.resolver.lookup(req.ip);
      } catch (err) {
        return {
          score: 0,
          signals: {
            resolver: config.resolver.id,
            error: (err as Error).message,
          },
          reason: 'geoip lookup failed (soft-skipping)',
        };
      }

      const verdict = evaluatePolicy(info, policy);
      const result: CheckResult = {
        score: verdict.score,
        signals: {
          resolver: config.resolver.id,
          country: info.country,
          asn: info.asn,
          asnOrg: info.asnOrg,
          isVpn: info.isVpn ?? null,
          isHosting: info.isHosting ?? null,
          isTor: info.isTor ?? null,
        },
      };
      if (verdict.decision) result.decision = verdict.decision;
      if (verdict.reason) result.reason = verdict.reason;
      return result;
    },
  };
}

export { isHostingOrg, isVpnOrg };
