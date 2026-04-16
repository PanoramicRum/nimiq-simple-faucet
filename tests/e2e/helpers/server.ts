import { authenticator } from 'otplib';

export { StubDriver } from '../fixtures/StubDriver.js';

/**
 * The TOTP shared secret seeded into `FAUCET_ADMIN_TOTP_SECRET` in
 * `globalSetup`. Fixed so tests can mint deterministic 6-digit codes.
 */
export const ADMIN_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

/** Password used for the first-login seed of the admin account. */
export const ADMIN_PASSWORD = 'admin-pass-123';

/** Fixed HMAC secret for the hashcash challenge signer. */
export const HASHCASH_SECRET = 'e2e-hashcash-secret-chars-16plus';

/** A valid Nimiq-format address used in claim flows. */
export const TEST_USER_ADDRESS = 'NQ00 1111 1111 1111 1111 1111 1111 1111 1111';

/** Mint a 6-digit TOTP code for the configured admin secret. */
export function totpCode(secret: string = ADMIN_TOTP_SECRET): string {
  return authenticator.generate(secret);
}
