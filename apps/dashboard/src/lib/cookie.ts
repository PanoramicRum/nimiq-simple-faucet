/**
 * Read a cookie by name from `document.cookie`. Returns `null` if not present.
 *
 * The admin API sets `faucet_csrf` as a non-HttpOnly cookie precisely so that
 * the dashboard JS can read it and echo it into the `X-Faucet-Csrf` header
 * (double-submit). The session cookie `faucet_session` is HttpOnly and cannot
 * be read here — we use the presence of the CSRF cookie as a proxy for "likely
 * logged in" and confirm via a probe request.
 */
export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const raw = document.cookie;
  if (!raw) return null;
  const parts = raw.split(/;\s*/);
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    const k = p.slice(0, eq);
    if (k === name) {
      return decodeURIComponent(p.slice(eq + 1));
    }
  }
  return null;
}
