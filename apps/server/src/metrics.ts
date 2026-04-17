import { Registry, Counter, Gauge, Histogram } from 'prom-client';

export const registry = new Registry();
registry.setDefaultLabels({ app: 'nimiq-faucet' });

export const claimsTotal = new Counter({
  name: 'faucet_claims_total',
  help: 'Total claims processed',
  labelNames: ['status', 'decision'] as const,
  registers: [registry],
});

export const claimDuration = new Histogram({
  name: 'faucet_claim_duration_seconds',
  help: 'Claim processing duration in seconds',
  labelNames: ['phase'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const walletBalance = new Gauge({
  name: 'faucet_wallet_balance_luna',
  help: 'Current wallet balance in luna',
  registers: [registry],
});

export const driverReady = new Gauge({
  name: 'faucet_driver_ready',
  help: '1 when the signer driver is ready, 0 otherwise',
  registers: [registry],
});

export const reconcilerFlips = new Counter({
  name: 'faucet_reconciler_flips_total',
  help: 'Claims reconciled from broadcast to a terminal state',
  labelNames: ['to'] as const,
  registers: [registry],
});
