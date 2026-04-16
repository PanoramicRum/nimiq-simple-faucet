/**
 * Tiny formatting helpers shared across views.
 */

/** Convert integer luna (string/number/bigint) to a human NIM string with 5dp. */
export function formatLuna(luna: string | number | bigint | null | undefined): string {
  if (luna === null || luna === undefined) return '—';
  let n: bigint;
  try {
    n = typeof luna === 'bigint' ? luna : BigInt(luna as string | number);
  } catch {
    return String(luna);
  }
  const neg = n < 0n;
  if (neg) n = -n;
  const whole = n / 100_000n;
  const frac = (n % 100_000n).toString().padStart(5, '0').replace(/0+$/, '');
  const s = frac.length > 0 ? `${whole}.${frac}` : whole.toString();
  return `${neg ? '-' : ''}${s} NIM`;
}

export function truncateMiddle(s: string, head = 8, tail = 6): string {
  if (!s) return '';
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export function formatTimestamp(ts: string | number | Date | null | undefined): string {
  if (ts === null || ts === undefined) return '—';
  const d = typeof ts === 'number' ? new Date(ts) : ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toISOString().replace('T', ' ').replace('Z', ' UTC');
}

export function formatPercent(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}
