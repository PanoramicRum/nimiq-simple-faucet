import {
  open as openMmdb,
  type AsnResponse,
  type CountryResponse,
  type Reader,
} from 'maxmind';
import type { GeoIpResolver, GeoIpResult } from './types.js';

export interface MaxMindResolverOptions {
  /** Path to GeoLite2-Country.mmdb. Required. */
  countryDbPath: string;
  /** Path to GeoLite2-ASN.mmdb. Optional. */
  asnDbPath?: string;
  /** Cache size. Default 6000 entries per DB. */
  cacheSize?: number;
}

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
}
