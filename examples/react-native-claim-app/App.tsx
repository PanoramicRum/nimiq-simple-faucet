import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { createReactNativeFaucetClient, type FaucetConfig } from '@nimiq-faucet/react-native';

// Faucet URL — Expo exposes EXPO_PUBLIC_* env vars to the app.
const FAUCET_URL = process.env.EXPO_PUBLIC_FAUCET_URL ?? 'http://localhost:8080';
// Unsigned identifier sent in hostContext.uid. In production a backend signs
// the hostContext (FaucetClient.signHostContext + integrator HMAC secret);
// the demo passes a plain uid for simplicity — see docs/abuse-layers/integration-guide.md.
const INTEGRATOR_ID = process.env.EXPO_PUBLIC_INTEGRATOR_ID ?? 'react-native-example';

type Phase = 'idle' | 'submitting' | 'solving' | 'broadcast' | 'confirmed' | 'rejected' | 'error';

export default function App() {
  // The RN client auto-injects fingerprint.visitorId from react-native-device-info
  // on a dev build (no-op on Expo Go / web — it degrades gracefully).
  const client = useMemo(() => createReactNativeFaucetClient({ url: FAUCET_URL }), []);

  const [config, setConfig] = useState<FaucetConfig | null>(null);
  const [address, setAddress] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [attempts, setAttempts] = useState(0);
  const [txId, setTxId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    client.config().then(setConfig).catch(() => setConfig(null));
  }, [client]);

  const busy = phase === 'submitting' || phase === 'solving' || phase === 'broadcast';
  const claimAmount = config ? (Number(config.claimAmountLuna) / 1e5).toFixed(2) : '—';

  async function claim() {
    if (!address || busy || !config) return;
    setTxId(null);
    setErrorMessage(null);
    setAttempts(0);
    try {
      let result;
      if (config.hashcash) {
        setPhase('solving');
        result = await client.solveAndClaim(address, {
          uid: INTEGRATOR_ID,
          onProgress: setAttempts,
          hostContext: { uid: INTEGRATOR_ID },
        });
      } else {
        setPhase('submitting');
        result = await client.claim(address, { hostContext: { uid: INTEGRATOR_ID } });
      }
      if (result.status === 'challenged') {
        // A captcha layer is on. RN can't render Turnstile/hCaptcha widgets
        // directly — they need a WebView. See the README + abuse-layers guide.
        setPhase('error');
        setErrorMessage('Faucet requires a captcha (needs a WebView in RN — see the README).');
        return;
      }
      setTxId(result.txId ?? null);
      setPhase('broadcast');
      const final = await client.waitForConfirmation(result.id);
      setTxId(final.txId ?? result.txId ?? null);
      setPhase(final.status === 'confirmed' ? 'confirmed' : 'rejected');
    } catch (err) {
      setPhase('error');
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }

  function reset() {
    setPhase('idle');
    setTxId(null);
    setErrorMessage(null);
    setAttempts(0);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.h1}>Claim NIM</Text>
        <Text style={styles.muted}>
          Expo app using <Text style={styles.code}>@nimiq-faucet/react-native</Text>.
        </Text>

        <View style={styles.card}>
          <Row label="Faucet" value={FAUCET_URL} />
          <Row label="Network" value={config ? config.network : 'loading…'} />
          <Row label="Per claim" value={`${claimAmount} NIM`} />
          {config?.hashcash ? <Row label="Hashcash" value={`difficulty ${config.hashcash.difficulty}`} /> : null}
        </View>

        <TextInput
          style={styles.input}
          value={address}
          onChangeText={setAddress}
          placeholder="NQ00 0000 0000 0000 0000 0000 0000 0000 0000"
          autoCapitalize="characters"
          autoCorrect={false}
          editable={!busy}
        />

        <Pressable
          style={[styles.button, (!address || busy || !config) && styles.buttonDisabled]}
          disabled={!address || busy || !config}
          onPress={claim}
        >
          {busy ? <ActivityIndicator color="#1a1a2e" /> : null}
          <Text style={styles.buttonText}>
            {phase === 'solving'
              ? `Solving proof-of-work… ${attempts.toLocaleString()}`
              : busy
                ? 'Claiming…'
                : 'Claim'}
          </Text>
        </Pressable>

        {phase === 'confirmed' ? (
          <Banner tone="good">
            ✓ Confirmed{txId ? ` — tx ${txId}` : ''}.{'  '}
            <Text style={styles.link} onPress={reset}>
              Claim again
            </Text>
          </Banner>
        ) : null}
        {phase === 'rejected' || phase === 'error' ? (
          <Banner tone="bad">
            {errorMessage ?? 'Claim rejected.'}
            {'  '}
            <Text style={styles.link} onPress={reset}>
              Try again
            </Text>
          </Banner>
        ) : null}

        <Text style={styles.note}>
          The device fingerprint is auto-injected on a native dev build (npx expo run:android / run:ios). On Expo Go and
          the web preview it’s skipped — the SDK degrades gracefully. Captcha layers need a WebView in RN; see the README
          and docs/abuse-layers/integration-guide.md.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function Banner({ tone, children }: { tone: 'good' | 'bad'; children: ReactNode }) {
  return <Text style={[styles.banner, tone === 'good' ? styles.bannerGood : styles.bannerBad]}>{children}</Text>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f1020' },
  container: { padding: 20, gap: 14, maxWidth: 520, width: '100%', alignSelf: 'center' },
  h1: { fontSize: 26, fontWeight: '700', color: '#f5f6fa' },
  muted: { color: '#9aa0b4' },
  code: { fontFamily: 'monospace', color: '#cdd2e6' },
  card: { backgroundColor: '#191b34', borderRadius: 12, padding: 12, gap: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  rowLabel: { color: '#9aa0b4', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 },
  rowValue: { color: '#f5f6fa', fontWeight: '600', flexShrink: 1, marginLeft: 12 },
  input: {
    borderWidth: 1,
    borderColor: '#2c2f55',
    backgroundColor: '#13152b',
    borderRadius: 10,
    padding: 12,
    color: '#f5f6fa',
    fontFamily: 'monospace',
  },
  button: {
    backgroundColor: '#f6ae2d',
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#1a1a2e', fontWeight: '700', fontSize: 16 },
  banner: { borderRadius: 10, padding: 12, overflow: 'hidden', fontSize: 14 },
  bannerGood: { backgroundColor: 'rgba(45,160,80,0.18)', color: '#7ee0a0' },
  bannerBad: { backgroundColor: 'rgba(200,40,60,0.18)', color: '#ff9aa6' },
  link: { color: '#f6ae2d', fontWeight: '700' },
  note: { color: '#7a7f95', fontSize: 12, lineHeight: 18, marginTop: 4 },
});
