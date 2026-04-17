import { AbusePipeline, type AbuseCheck, type CurrencyDriver } from '@faucet/core';
import { hashcashCheck } from '@faucet/abuse-hashcash';
import { hcaptchaCheck } from '@faucet/abuse-hcaptcha';
import {
  DbipResolver,
  IpinfoResolver,
  MaxMindResolver,
  geoipCheck,
  type GeoIpResolver,
} from '@faucet/abuse-geoip';
import { fingerprintCheck } from '@faucet/abuse-fingerprint';
import { onchainNimiqCheck } from '@faucet/abuse-onchain-nimiq';
import { aiCheck } from '@faucet/abuse-ai';
import type { Db } from '../db/index.js';
import type { ServerConfig } from '../config.js';
import { rateLimitCheck } from './rateLimit.js';
import { blocklistCheck } from './blocklist.js';
import { turnstileCheck } from './turnstile.js';
import { DrizzleFingerprintStore } from './fingerprintStore.js';
import { DrizzleRecentClaimsQuery } from './recentClaimsQuery.js';

export interface PipelineOverrides {
  geoipResolver?: GeoIpResolver;
  fingerprintEnabled?: boolean | undefined;
  onchainEnabled?: boolean | undefined;
  aiEnabled?: boolean | undefined;
}

export function buildPipeline(
  db: Db,
  config: ServerConfig,
  driver: CurrencyDriver,
  overrides: PipelineOverrides = {},
): AbusePipeline {
  const checks: AbuseCheck[] = [
    blocklistCheck(db),
    rateLimitCheck(db, { perIpPerDay: config.rateLimitPerIpPerDay }),
  ];
  if (config.turnstileSecret) {
    checks.push(turnstileCheck({ secret: config.turnstileSecret }));
  }
  if (config.hcaptchaSecret) {
    checks.push(hcaptchaCheck({ secret: config.hcaptchaSecret }));
  }
  if (config.hashcashSecret) {
    checks.push(
      hashcashCheck({
        secret: config.hashcashSecret,
        difficulty: config.hashcashDifficulty,
        ttlMs: config.hashcashTtlMs,
      }),
    );
  }
  const geoipResolver = overrides.geoipResolver ?? buildGeoipResolver(config);
  if (geoipResolver) {
    checks.push(
      geoipCheck({
        resolver: geoipResolver,
        policy: {
          denyCountries: config.geoipDenyCountries,
          allowCountries:
            config.geoipAllowCountries.length > 0 ? config.geoipAllowCountries : undefined,
          denyAsns: config.geoipDenyAsns,
          denyVpn: config.geoipDenyVpn,
          denyTor: config.geoipDenyTor,
          denyHosting: config.geoipDenyHosting,
        },
      }),
    );
  }
  if (overrides.fingerprintEnabled ?? config.fingerprintEnabled) {
    checks.push(
      fingerprintCheck({
        store: new DrizzleFingerprintStore(db),
        windowMs: config.fingerprintWindowMs,
        maxVisitorsPerUid: config.fingerprintMaxVisitorsPerUid,
        maxUidsPerVisitor: config.fingerprintMaxUidsPerVisitor,
      }),
    );
  }
  if ((overrides.onchainEnabled ?? config.onchainEnabled) && driver.addressHistory) {
    checks.push(
      onchainNimiqCheck({
        driver,
        denyIfSweeper: config.onchainDenyIfSweeper,
        softScoreFreshAddress: config.onchainSoftScoreFreshAddress,
      }),
    );
  }
  if (overrides.aiEnabled ?? config.aiEnabled) {
    checks.push(
      aiCheck({
        query: new DrizzleRecentClaimsQuery(db),
        denyThreshold: config.aiDenyThreshold,
        reviewThreshold: config.aiReviewThreshold,
      }),
    );
  }
  return new AbusePipeline(checks);
}

function buildGeoipResolver(config: ServerConfig): GeoIpResolver | undefined {
  if (config.geoipBackend === 'dbip') {
    return new DbipResolver();
  }
  if (config.geoipBackend === 'maxmind') {
    if (!config.geoipMaxmindCountryDb) {
      throw new Error('FAUCET_GEOIP_BACKEND=maxmind requires FAUCET_GEOIP_MAXMIND_COUNTRY_DB');
    }
    const maxmindOpts = config.geoipMaxmindAsnDb
      ? { countryDbPath: config.geoipMaxmindCountryDb, asnDbPath: config.geoipMaxmindAsnDb }
      : { countryDbPath: config.geoipMaxmindCountryDb };
    return new MaxMindResolver(maxmindOpts);
  }
  if (config.geoipBackend === 'ipinfo') {
    if (!config.geoipIpinfoToken) {
      throw new Error('FAUCET_GEOIP_BACKEND=ipinfo requires FAUCET_GEOIP_IPINFO_TOKEN');
    }
    return new IpinfoResolver({ token: config.geoipIpinfoToken });
  }
  return undefined;
}
