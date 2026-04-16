export interface FingerprintLink {
  visitorId: string;
  uid: string | null;
  cookieHash: string | null;
  seenAt: number;
}

export interface FingerprintStore {
  /** Record the current request's signal tuple. Must be idempotent per (visitorId, uid, cookieHash). */
  record(link: FingerprintLink): Promise<void>;
  /** Count distinct visitor IDs that have been linked to this UID within the window (ms). */
  countVisitorsForUid(uid: string, windowMs: number): Promise<number>;
  /** Count distinct UIDs linked to this visitor ID within the window. */
  countUidsForVisitor(visitorId: string, windowMs: number): Promise<number>;
}

export interface FingerprintCheckConfig {
  store: FingerprintStore;
  /** Lookback window for correlation. Default 24 * 60 * 60_000 ms (24 h). */
  windowMs?: number | undefined;
  /** Distinct visitor IDs per UID above which we escalate. Default 3. */
  maxVisitorsPerUid?: number | undefined;
  /** Distinct UIDs per visitor above which we escalate. Default 3. */
  maxUidsPerVisitor?: number | undefined;
  /** If the host context is unsigned, soft-score add. Default 0.3. */
  unsignedContextPenalty?: number | undefined;
  /** Weight. Default 2. */
  weight?: number | undefined;
}
