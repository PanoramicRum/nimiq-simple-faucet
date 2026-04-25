import { z } from 'zod';

export const HostContextSchema = z
  .object({
    uid: z.string().max(256).optional(),
    cookieHash: z.string().max(256).optional(),
    sessionHash: z.string().max(256).optional(),
    accountAgeDays: z.number().int().nonnegative().max(365 * 50).optional(),
    emailDomainHash: z.string().max(256).optional(),
    kycLevel: z.enum(['none', 'email', 'phone', 'id']).optional(),
    tags: z.array(z.string().max(64)).max(32).optional(),
    /** SSO providers the integrator authenticated the user against. */
    verifiedIdentities: z.array(z.string().max(64)).max(10).optional(),
    signature: z.string().max(512).optional(),
  })
  .strict();

export type HostContext = z.infer<typeof HostContextSchema>;

const CANONICAL_FIELDS = [
  'uid',
  'cookieHash',
  'sessionHash',
  'accountAgeDays',
  'emailDomainHash',
  'kycLevel',
  'tags',
  'verifiedIdentities',
] as const;

export function canonicalizeHostContext(ctx: HostContext): string {
  const entries: [string, unknown][] = [];
  for (const key of CANONICAL_FIELDS) {
    const value = ctx[key];
    if (value === undefined) continue;
    entries.push([key, Array.isArray(value) ? [...value].sort() : value]);
  }
  return JSON.stringify(entries);
}

/**
 * Trust-boundary defence (#96). When the integrator's HMAC signature on a
 * `hostContext` is missing or invalid, the **trust-claim** fields are
 * attacker-controlled — a forged `kycLevel: 'id'` or
 * `verifiedIdentities: ['google']` could nudge scoring in the attacker's
 * favour without any cryptographic backing. Strip these.
 *
 * Correlation fields (`uid`, `cookieHash`, `sessionHash`) are also
 * attacker-controllable, but the fingerprint layer's job is precisely
 * to detect inconsistencies *between* them and a stable visitor-id —
 * lying about a UID either lets the attacker evade correlation (no worse
 * than not sending a UID at all) or trips correlation themselves. Keep
 * these fields so fingerprint can still do its work on unsigned traffic.
 *
 * The route layer calls this on the unsigned path before the value
 * enters the abuse pipeline, so no AbuseCheck implementation needs to
 * know about the threat.
 */
export function stripUnsignedHostContext(ctx: HostContext): HostContext {
  const stripped: HostContext = {};
  // Correlation hashes — attacker-controlled but not trust-claiming.
  if (ctx.uid !== undefined) stripped.uid = ctx.uid;
  if (ctx.cookieHash !== undefined) stripped.cookieHash = ctx.cookieHash;
  if (ctx.sessionHash !== undefined) stripped.sessionHash = ctx.sessionHash;
  // Preserve `signature` so request logs reflect that one was attempted
  // (value is already known-bad here).
  if (ctx.signature !== undefined) stripped.signature = ctx.signature;
  // INTENTIONALLY DROPPED on the unsigned path:
  //   accountAgeDays, emailDomainHash, kycLevel, tags, verifiedIdentities
  return stripped;
}
