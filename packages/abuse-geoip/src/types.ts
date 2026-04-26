export interface GeoIpResult {
  /** ISO 3166-1 alpha-2, uppercase. `null` = private/unroutable/unknown. */
  country: string | null;
  /** Autonomous system number, if resolvable. */
  asn: number | null;
  /** Organisation name reported for the ASN. */
  asnOrg: string | null;
  /** True if the resolver flagged the address as VPN/proxy. */
  isVpn?: boolean | undefined;
  /** True if the resolver flagged the address as datacenter / hosting. */
  isHosting?: boolean | undefined;
  /** True if known Tor exit node. */
  isTor?: boolean | undefined;
}

export interface GeoIpResolver {
  readonly id: string;
  lookup(ip: string): Promise<GeoIpResult>;
  /**
   * Optional health snapshot of the underlying GeoIP data. Used by the
   * server's `/readyz` to surface staleness — a faucet running with a
   * year-old MaxMind DB silently mis-classifies VPN/hosting ranges.
   * Returns `null` when the resolver doesn't have a meaningful concept
   * of "data age" (e.g. an online API like ipinfo).
   */
  healthSnapshot?(): GeoIpHealthSnapshot | null;
}

export interface GeoIpHealthSnapshot {
  /** Resolver id (matches GeoIpResolver.id). */
  resolver: string;
  /** Wall-clock timestamp the local DB file was last modified, ms since epoch. `null` for online resolvers. */
  dbBuildTimeMs?: number | null;
  /** Age of the data in milliseconds, computed against `Date.now()`. */
  ageMs?: number | null;
  /** True when the resolver considers the data old enough to be inaccurate. */
  stale: boolean;
}

export interface GeoIpPolicy {
  /** Country allow-list (ISO-alpha2). When set, any other country is denied. */
  allowCountries?: readonly string[] | undefined;
  /** Country deny-list (ISO-alpha2). Takes precedence over allowCountries. */
  denyCountries?: readonly string[] | undefined;
  /** ASN deny-list. */
  denyAsns?: readonly number[] | undefined;
  /** Deny known VPN / proxy providers when the resolver reports it. */
  denyVpn?: boolean | undefined;
  /** Deny known Tor exit nodes when the resolver reports it. */
  denyTor?: boolean | undefined;
  /** Deny known datacenter / hosting ASNs. */
  denyHosting?: boolean | undefined;
}
