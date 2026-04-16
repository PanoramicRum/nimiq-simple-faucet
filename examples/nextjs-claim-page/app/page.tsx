'use client';

import { useMemo, useState } from 'react';
import { FaucetClient, useFaucetClaim } from '@nimiq-faucet/react';

const faucetUrl = process.env.NEXT_PUBLIC_FAUCET_URL || 'http://localhost:8080';

function statusLabel(status: string): string {
  switch (status) {
    case 'idle': return '';
    case 'pending': return 'Submitting claim...';
    case 'queued': return 'Queued — waiting for broadcast...';
    case 'broadcast': return 'Broadcast — waiting for confirmation...';
    case 'confirmed': return 'Confirmed!';
    case 'rejected': return 'Rejected';
    case 'challenged': return 'Challenge required';
    default: return status;
  }
}

export default function Home() {
  const client = useMemo(() => new FaucetClient({ url: faucetUrl }), []);
  const [address, setAddress] = useState('');

  const { claim, reset, status, txId, error } = useFaucetClaim({
    client,
    address,
    hostContext: { uid: 'nextjs-example' },
  });

  const pending = status === 'pending';
  const label = statusLabel(status);

  return (
    <main className="container">
      <h1>Nimiq Faucet</h1>
      <p className="subtitle">Claim free NIM on testnet</p>

      <form
        className="claim-form"
        onSubmit={(e) => { e.preventDefault(); if (address.trim()) claim(); }}
      >
        <label htmlFor="address">Nimiq Address</label>
        <input
          id="address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="NQ00 0000 0000 0000 0000 0000 0000 0000 0000"
          disabled={pending}
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" disabled={pending || !address.trim()}>
          {pending ? 'Claiming...' : 'Claim NIM'}
        </button>
      </form>

      {label && (
        <div className={`status ${status}`}>
          <p>{label}</p>
          {txId && <p className="tx">TX: <code>{txId}</code></p>}
        </div>
      )}

      {error && (
        <div className="error">
          <p>{error.message}</p>
          <button className="retry" onClick={reset}>Try again</button>
        </div>
      )}
    </main>
  );
}
