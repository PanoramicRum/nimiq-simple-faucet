/** Shared formatting utilities for the ClaimUI. */

export function timeAgo(ts: string | number): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}

export function lunaToNim(luna: string | number): string {
  return (Number(luna) / 100_000).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function truncateAddress(addr: string): string {
  if (addr.length <= 16) return addr;
  return addr.slice(0, 9) + ' ... ' + addr.slice(-4);
}
