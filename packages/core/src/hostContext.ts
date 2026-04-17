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
