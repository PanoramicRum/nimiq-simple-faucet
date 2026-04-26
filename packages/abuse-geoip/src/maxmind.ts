import { statSync } from 'node:fs';
import {
  open as openMmdb,
  type AsnResponse,
  type CountryResponse,
  type Reader,
} from 'maxmind';
import type { GeoIpHealthSnapshot, GeoIpResolver, GeoIpResult } from './types.js';

export interface MaxMindResolverOptions {
  /** Path to GeoLite2-Country.mmdb. Required. */
  countryDbPath: string;
  /** Path to GeoLite2-ASN.mmdb. Optional. */
  asnDbPath?: string;
  /** Cache size. Default 6000 entries per DB. */
  cacheSize?: number;
  /**
   * Maximum tolerated age of the country DB before `healthSnapshot()`
   * reports it as stale. Default 45 days — MaxMind ships GeoLite2 weekly,
   * so anything older is well past the operator's normal refresh window.
   */
  maxAgeMs?: number;
}

const DEFAULT_MAX_AGE_MS = 45 * 24 * 60 * 60 * 1_000;

export class MaxMindResolver implements GeoIpResolver {
  readonly id = 'maxmind';
  #countryReader: Reader<CountryResponse> | null = null;
  #asnReader: Reader<AsnResponse> | null = null;
  #ready: Promise<void>;

  constructor(private readonly options: MaxMindResolverOptions) {
    this.#ready = this.#load();
  }

  async #load(): Promise<void> {
    const cacheSize = this.options.cacheSize ?? 6000;
    this.#countryReader = await openMmdb<CountryResponse>(this.options.countryDbPath, {
      cache: { max: cacheSize },
    });
    if (this.options.asnDbPath) {
      this.#asnReader = await openMmdb<AsnResponse>(this.options.asnDbPath, {
        cache: { max: cacheSize },
      });
    }
  }

  async lookup(ip: string): Promise<GeoIpResult> {
    await this.#ready;
    const country = this.#countryReader?.get(ip) ?? null;
    const asn = this.#asnReader?.get(ip) ?? null;
    const iso =
      country?.country?.iso_code ?? country?.registered_country?.iso_code ?? null;
    return {
      country: iso ? iso.toUpperCase() : null,
      asn: asn?.autonomous_system_number ?? null,
      asnOrg: asn?.autonomous_system_organization ?? null,
    };
  }

  // Audit Improvement: surface DB staleness in /readyz so operators get
  // a loud signal when their MaxMind DB hasn't been refreshed in months.
  // Stale country/ASN data silently mis-classifies VPN/hosting ranges,
  // letting attackers around country/ASN allow- or deny-lists.
  healthSnapshot(): GeoIpHealthSnapshot {
    const maxAgeMs = this.options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    let dbBuildTimeMs: number | null = null;
    try {
      // The .mmdb file's mtime is the closest proxy to "build time"
      // without parsing the metadata block — close enough for staleness.
      dbBuildTimeMs = statSync(this.options.countryDbPath).mtimeMs;
    } catch {
      // File missing / unreadable. Report stale=true so the operator
      // notices; the resolver itself would have failed to open earlier.
      return { resolver: this.id, stale: true };
    }
    const ageMs = Date.now() - dbBuildTimeMs;
    return {
      resolver: this.id,
      dbBuildTimeMs,
      ageMs,
      stale: ageMs > maxAgeMs,
    };
  }
}
