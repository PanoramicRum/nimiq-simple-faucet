import { statSync } from 'node:fs';
import { open as openMmdb } from 'maxmind';
import { createRequire } from 'node:module';
import type { GeoIpHealthSnapshot, GeoIpResolver, GeoIpResult } from './types.js';

/** DB-IP Lite country MMDB record shape. */
interface DbipCountryRecord {
  country_code?: string;
}

/** DB-IP Lite ASN MMDB record shape. */
interface DbipAsnRecord {
  autonomous_system_number?: number;
  autonomous_system_organization?: string;
}

// The maxmind package constrains Reader<T> to its own Response union.
// DB-IP Lite uses a different record schema, so we use `any` for the
// type parameter and cast to our known interfaces at read time.
// The actual record shapes are verified against real DB-IP MMDB files.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyReader = Awaited<ReturnType<typeof openMmdb<any>>>;

/**
 * GeoIP resolver backed by DB-IP Lite MMDB databases bundled via
 * `@ip-location-db/dbip-country-mmdb` and `@ip-location-db/dbip-asn-mmdb`.
 *
 * Works out of the box — no license key, no download step, no configuration.
 * Data is CC BY 4.0 (https://db-ip.com/db/lite.php).
 */
// DB-IP Lite ships monthly. The bundled package version pins a specific
// snapshot, so the right "max age" check is "is the package itself
// recent enough", which an operator updates via dependabot. We surface
// the file mtime anyway so /readyz shows something concrete; flag stale
// at 90 days since DB-IP updates monthly and we want a generous buffer.
const DBIP_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1_000;

export class DbipResolver implements GeoIpResolver {
  readonly id = 'dbip';
  #countryReader: AnyReader | null = null;
  #asnReader: AnyReader | null = null;
  #ready: Promise<void>;
  #countryDbPath: string | null = null;

  constructor() {
    this.#ready = this.#load();
  }

  async #load(): Promise<void> {
    const require = createRequire(import.meta.url);
    const countryDbPath = require.resolve(
      '@ip-location-db/dbip-country-mmdb/dbip-country.mmdb',
    );
    const asnDbPath = require.resolve(
      '@ip-location-db/dbip-asn-mmdb/dbip-asn.mmdb',
    );
    this.#countryDbPath = countryDbPath;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.#countryReader = await openMmdb<any>(countryDbPath, {
      cache: { max: 6000 },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.#asnReader = await openMmdb<any>(asnDbPath, {
      cache: { max: 6000 },
    });
  }

  // See MaxMind resolver; same intent.
  healthSnapshot(): GeoIpHealthSnapshot {
    if (!this.#countryDbPath) {
      return { resolver: this.id, stale: true };
    }
    let dbBuildTimeMs: number | null = null;
    try {
      dbBuildTimeMs = statSync(this.#countryDbPath).mtimeMs;
    } catch {
      return { resolver: this.id, stale: true };
    }
    const ageMs = Date.now() - dbBuildTimeMs;
    return {
      resolver: this.id,
      dbBuildTimeMs,
      ageMs,
      stale: ageMs > DBIP_MAX_AGE_MS,
    };
  }

  async lookup(ip: string): Promise<GeoIpResult> {
    await this.#ready;
    const country = this.#countryReader?.get(ip) as DbipCountryRecord | null;
    const asn = this.#asnReader?.get(ip) as DbipAsnRecord | null;
    const iso = country?.country_code ?? null;
    return {
      country: iso ? iso.toUpperCase() : null,
      asn: asn?.autonomous_system_number ?? null,
      asnOrg: asn?.autonomous_system_organization ?? null,
    };
  }
}
