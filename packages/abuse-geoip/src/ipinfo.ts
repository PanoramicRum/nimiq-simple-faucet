import { request } from 'undici';
import type { GeoIpResolver, GeoIpResult } from './types.js';

export interface IpinfoResolverOptions {
  /** IPinfo API token. Free tier works for light traffic. */
  token: string;
  baseUrl?: string;
  /** Cache size (number of IPs). Default 4000. */
  cacheSize?: number;
  /** Cache TTL in ms. Default 24 h. */
  ttlMs?: number;
}

interface IpinfoResponse {
  ip?: string;
  country?: string;
  org?: string; // e.g. "AS13335 Cloudflare, Inc."
  privacy?: {
    vpn?: boolean;
    proxy?: boolean;
    tor?: boolean;
    relay?: boolean;
    hosting?: boolean;
    service?: string;
  };
}

export class IpinfoResolver implements GeoIpResolver {
  readonly id = 'ipinfo';
  #cache = new Map<string, { expires: number; value: GeoIpResult }>();

  constructor(private readonly options: IpinfoResolverOptions) {}

  async lookup(ip: string): Promise<GeoIpResult> {
    const now = Date.now();
    const cached = this.#cache.get(ip);
    if (cached && cached.expires > now) return cached.value;

    const base = this.options.baseUrl ?? 'https://ipinfo.io';
    const res = await request(`${base}/${encodeURIComponent(ip)}`, {
      headers: { authorization: `Bearer ${this.options.token}`, accept: 'application/json' },
    });
    if (res.statusCode >= 400) {
      throw new Error(`ipinfo ${res.statusCode}`);
    }
    const body = (await res.body.json()) as IpinfoResponse;

    let asn: number | null = null;
    let asnOrg: string | null = null;
    if (body.org) {
      const match = /^AS(\d+)\s+(.*)$/.exec(body.org);
      if (match) {
        asn = Number(match[1]);
        asnOrg = match[2] ?? null;
      } else {
        asnOrg = body.org;
      }
    }

    const value: GeoIpResult = {
      country: body.country ? body.country.toUpperCase() : null,
      asn,
      asnOrg,
      isVpn: body.privacy?.vpn || body.privacy?.proxy || body.privacy?.relay,
      isHosting: body.privacy?.hosting,
      isTor: body.privacy?.tor,
    };

    const ttl = this.options.ttlMs ?? 24 * 60 * 60_000;
    const maxSize = this.options.cacheSize ?? 4000;
    if (this.#cache.size >= maxSize) {
      const first = this.#cache.keys().next().value;
      if (first !== undefined) this.#cache.delete(first);
    }
    this.#cache.set(ip, { expires: now + ttl, value });
    return value;
  }
}
