import type { FingerprintLink, FingerprintStore } from './types.js';

function key(link: Pick<FingerprintLink, 'visitorId' | 'uid' | 'cookieHash'>): string {
  return `${link.visitorId}|${link.uid ?? ''}|${link.cookieHash ?? ''}`;
}

export class InMemoryFingerprintStore implements FingerprintStore {
  // Dedup by tuple; last write wins on seenAt so "most recent sighting" semantics stay intuitive.
  private readonly links = new Map<string, FingerprintLink>();

  async record(link: FingerprintLink): Promise<void> {
    this.links.set(key(link), { ...link });
  }

  async countVisitorsForUid(uid: string, windowMs: number): Promise<number> {
    // O(n) scan — acceptable for tests and small installs; persistent stores must index on (uid, seenAt).
    const cutoff = Date.now() - windowMs;
    const seen = new Set<string>();
    for (const link of this.links.values()) {
      if (link.uid !== uid) continue;
      if (link.seenAt < cutoff) continue;
      seen.add(link.visitorId);
    }
    return seen.size;
  }

  async countUidsForVisitor(visitorId: string, windowMs: number): Promise<number> {
    const cutoff = Date.now() - windowMs;
    const seen = new Set<string>();
    for (const link of this.links.values()) {
      if (link.visitorId !== visitorId) continue;
      if (link.uid === null) continue;
      if (link.seenAt < cutoff) continue;
      seen.add(link.uid);
    }
    return seen.size;
  }
}
