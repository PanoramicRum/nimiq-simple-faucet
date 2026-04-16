import { z } from 'zod';

export type NetworkId = 'main' | 'test';

export const AddressSchema = z
  .string()
  .min(1)
  .describe('Currency-specific address. Drivers validate format.');
export type Address = z.infer<typeof AddressSchema>;

export const TxIdSchema = z.string().min(1);
export type TxId = z.infer<typeof TxIdSchema>;

export type ClaimStatus = 'queued' | 'broadcast' | 'confirmed' | 'rejected' | 'challenged';

export interface ClaimRecord {
  id: string;
  createdAt: number;
  address: Address;
  amount: bigint;
  status: ClaimStatus;
  txId?: TxId;
  rejectionReason?: string;
  abuseScore: number;
  signals: Record<string, unknown>;
}

export interface HistorySummary {
  firstSeenAt: number | null;
  incomingCount: number;
  outgoingCount: number;
  totalReceived: bigint;
  totalSent: bigint;
  isSweeper: boolean;
}

export class DriverError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'DriverError';
  }
}
