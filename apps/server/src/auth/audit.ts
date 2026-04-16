import { nanoid } from 'nanoid';
import type { Db } from '../db/index.js';
import { auditLog } from '../db/schema.js';

export interface AuditEntry {
  actor: string;
  action: string;
  target?: string | undefined;
  signals?: Record<string, unknown> | undefined;
}

export async function writeAudit(db: Db, entry: AuditEntry): Promise<string> {
  const id = nanoid();
  await db.insert(auditLog).values({
    id,
    ts: new Date(),
    actor: entry.actor,
    action: entry.action,
    target: entry.target ?? null,
    signalsJson: JSON.stringify(entry.signals ?? {}),
  });
  return id;
}
