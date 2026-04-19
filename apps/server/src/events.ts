/**
 * In-memory ring buffer for faucet system events.
 * Events are transient — not persisted to DB.
 */

export interface SystemEvent {
  type: string;
  message: string;
  detail?: string;
  ts: number;
}

export class EventRing {
  private readonly buf: SystemEvent[] = [];
  private readonly max: number;

  constructor(max = 50) {
    this.max = max;
  }

  push(event: Omit<SystemEvent, 'ts'>): void {
    this.buf.push({ ...event, ts: Date.now() });
    if (this.buf.length > this.max) this.buf.shift();
  }

  list(limit = 20): SystemEvent[] {
    return this.buf.slice(-limit).reverse();
  }
}
