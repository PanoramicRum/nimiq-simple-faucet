import { useCallback, useMemo, useState } from 'react';
import { CapacitorFaucetClient } from '@nimiq-faucet/capacitor';
import { useFaucetClaim } from '@nimiq-faucet/react';

const faucetUrl = (import.meta as any).env?.VITE_FAUCET_URL || 'http://localhost:8080';

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

export default function App() {
  const client = useMemo(() => new CapacitorFaucetClient({ url: faucetUrl }), []);
  const [address, setAddress] = useState('');

  const { claim, reset, status, txId, error } = useFaucetClaim({
    client,
    address,
    hostContext: { uid: 'capacitor-example' },
  });

  const pending = status === 'pending';
  const label = statusLabel(status);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (address.trim()) claim();
  }, [address, claim]);

  return (
    <main style={styles.container}>
      <h1 style={styles.heading}>Nimiq Faucet</h1>
      <p style={styles.subtitle}>Capacitor mobile app — claim free NIM</p>

      <form onSubmit={handleSubmit} style={styles.form}>
        <label htmlFor="address" style={styles.label}>Nimiq Address</label>
        <input
          id="address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="NQ00 0000 0000 0000 0000 0000 0000 0000 0000"
          disabled={pending}
          autoComplete="off"
          spellCheck={false}
          style={styles.input}
        />
        <button type="submit" disabled={pending || !address.trim()} style={styles.button}>
          {pending ? 'Claiming...' : 'Claim NIM'}
        </button>
      </form>

      {label && (
        <div style={{
          ...styles.status,
          ...(status === 'confirmed' ? styles.confirmed : {}),
          ...(status === 'rejected' ? styles.rejected : {}),
        }}>
          <p>{label}</p>
          {txId && <p style={styles.tx}>TX: <code>{txId}</code></p>}
        </div>
      )}

      {error && (
        <div style={styles.error}>
          <p>{error.message}</p>
          <button onClick={reset} style={{ ...styles.button, ...styles.retry }}>Try again</button>
        </div>
      )}
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { maxWidth: 480, margin: '0 auto', padding: '2rem', fontFamily: 'system-ui, sans-serif' },
  heading: { fontSize: '1.75rem', marginBottom: '0.25rem', color: '#1f2348' },
  subtitle: { color: '#6b7280', marginBottom: '2rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  label: { fontWeight: 600, fontSize: '0.875rem' },
  input: { padding: '0.75rem', border: '1px solid #d1d5db', borderRadius: 8, fontFamily: 'monospace', fontSize: '0.875rem' },
  button: { padding: '0.75rem', border: 'none', borderRadius: 8, background: '#1f2348', color: '#fff', fontSize: '1rem', fontWeight: 600, cursor: 'pointer' },
  status: { marginTop: '1.5rem', padding: '1rem', borderRadius: 8, background: '#e8eaf6' },
  confirmed: { background: '#d1fae5', color: '#065f46' },
  rejected: { background: '#fee2e2', color: '#991b1b' },
  tx: { marginTop: '0.5rem', fontSize: '0.8rem', wordBreak: 'break-all' as const },
  error: { marginTop: '1.5rem', padding: '1rem', borderRadius: 8, background: '#fee2e2', color: '#991b1b' },
  retry: { marginTop: '0.75rem', background: '#991b1b', fontSize: '0.875rem', padding: '0.5rem 1rem' },
};
