import { useState } from 'react';
import { useFaucetClaim } from '@nimiq-faucet/react';

// The faucet URL the browser hits. Override with VITE_FAUCET_URL.
const FAUCET_URL = import.meta.env.VITE_FAUCET_URL ?? 'http://localhost:8080';

export function App() {
  const [address, setAddress] = useState('');
  const { status, txId, error, claim, reset } = useFaucetClaim({
    client: { url: FAUCET_URL },
    address,
  });

  // `status` walks: idle → pending → broadcast → confirmed (or rejected).
  const busy = status === 'pending' || status === 'broadcast' || status === 'queued';

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 480, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Claim NIM</h1>
      <p>
        The smallest faucet integration: <code>useFaucetClaim</code> + a button.
      </p>

      <input
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder="NQ00 0000 0000 0000 0000 0000 0000 0000 0000"
        spellCheck={false}
        disabled={busy}
        style={{ width: '100%', padding: '0.6rem', fontFamily: 'monospace', boxSizing: 'border-box' }}
      />

      <button
        onClick={claim}
        disabled={!address || busy}
        style={{ marginTop: '0.75rem', padding: '0.6rem 1.2rem', cursor: busy ? 'progress' : 'pointer' }}
      >
        {busy ? 'Claiming…' : 'Claim'}
      </button>

      {status === 'confirmed' && (
        <p style={{ color: 'green' }}>
          ✓ Confirmed — tx <code>{txId}</code>. <button onClick={reset}>Claim again</button>
        </p>
      )}
      {(status === 'rejected' || error) && (
        <p style={{ color: 'crimson' }}>
          {error?.message ?? 'Claim rejected.'} <button onClick={reset}>Try again</button>
        </p>
      )}
      {status === 'challenged' && (
        <p style={{ color: '#a60' }}>
          The faucet asked for a captcha or proof-of-work. This minimal example doesn’t handle abuse layers — see the
          README.
        </p>
      )}
    </main>
  );
}
