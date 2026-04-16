import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FaucetClient,
  FaucetError,
  type ClaimOptions,
  type ClaimResponse,
  type ClaimStatus,
  type FaucetClientOptions,
} from '@nimiq-faucet/sdk';

export type FaucetClientLike = Pick<
  FaucetClient,
  'claim' | 'status' | 'waitForConfirmation' | 'config' | 'subscribe'
>;

export interface UseFaucetClaimArgs extends Omit<ClaimOptions, 'signal'> {
  /** Either a ready FaucetClient or options to construct one on the fly. */
  client: FaucetClientLike | FaucetClientOptions;
  address: string;
  /** Auto-poll claim status after submission. Defaults to true. */
  pollForConfirmation?: boolean;
}

export interface UseFaucetClaimResult {
  claim: () => Promise<void>;
  reset: () => void;
  status: 'idle' | 'pending' | ClaimStatus;
  id: string | null;
  txId: string | null;
  decision: ClaimResponse['decision'] | null;
  error: FaucetError | Error | null;
}

function useClient(source: FaucetClientLike | FaucetClientOptions): FaucetClientLike {
  return useMemo(() => {
    if (source instanceof FaucetClient) return source;
    if (typeof (source as FaucetClientLike).claim === 'function') return source as FaucetClientLike;
    return new FaucetClient(source as FaucetClientOptions);
  }, [source]);
}

export function useFaucetClaim(args: UseFaucetClaimArgs): UseFaucetClaimResult {
  const client = useClient(args.client);
  const { address, hostContext, captchaToken, hashcashSolution, fingerprint, pollForConfirmation = true } = args;

  const [status, setStatus] = useState<UseFaucetClaimResult['status']>('idle');
  const [id, setId] = useState<string | null>(null);
  const [txId, setTxId] = useState<string | null>(null);
  const [decision, setDecision] = useState<ClaimResponse['decision'] | null>(null);
  const [error, setError] = useState<FaucetError | Error | null>(null);
  const abort = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    setStatus('idle');
    setId(null);
    setTxId(null);
    setDecision(null);
    setError(null);
  }, []);

  const claim = useCallback(async () => {
    reset();
    setStatus('pending');
    const controller = new AbortController();
    abort.current = controller;
    try {
      const response = await client.claim(address, {
        hostContext,
        captchaToken,
        hashcashSolution,
        fingerprint,
        signal: controller.signal,
      });
      setId(response.id);
      setStatus(response.status);
      setTxId(response.txId ?? null);
      setDecision(response.decision ?? null);
      if (pollForConfirmation && (response.status === 'broadcast' || response.status === 'queued')) {
        const confirmed = await client.waitForConfirmation(response.id);
        setStatus(confirmed.status);
        setTxId(confirmed.txId ?? response.txId ?? null);
        setDecision(confirmed.decision ?? null);
      }
    } catch (err) {
      setError(err as Error);
      setStatus('rejected');
    } finally {
      abort.current = null;
    }
  }, [client, address, hostContext, captchaToken, hashcashSolution, fingerprint, pollForConfirmation, reset]);

  useEffect(() => () => abort.current?.abort(), []);

  return { claim, reset, status, id, txId, decision, error };
}

export interface UseFaucetStatusResult {
  data: ClaimResponse | null;
  error: Error | null;
  loading: boolean;
  refetch: () => void;
}

export function useFaucetStatus(
  client: FaucetClientLike | FaucetClientOptions,
  id: string | null,
  pollIntervalMs = 2_000,
): UseFaucetStatusResult {
  const c = useClient(client);
  const [data, setData] = useState<ClaimResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);
  const tick = useRef(0);

  const fetchOnce = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const n = ++tick.current;
    try {
      const next = await c.status(id);
      if (n === tick.current) setData(next);
    } catch (err) {
      if (n === tick.current) setError(err as Error);
    } finally {
      if (n === tick.current) setLoading(false);
    }
  }, [c, id]);

  useEffect(() => {
    if (!id) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    fetchOnce();
    if (pollIntervalMs > 0) {
      timer = setInterval(fetchOnce, pollIntervalMs);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [id, pollIntervalMs, fetchOnce]);

  return { data, error, loading, refetch: fetchOnce };
}

export function useFaucetStream(
  client: FaucetClientLike | FaucetClientOptions,
  onEvent: (event: unknown) => void,
): void {
  const c = useClient(client);
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    const unsubscribe = c.subscribe((event) => handler.current(event));
    return unsubscribe;
  }, [c]);
}

export { FaucetClient, FaucetError } from '@nimiq-faucet/sdk';
export type {
  ClaimOptions,
  ClaimResponse,
  ClaimStatus,
  ClaimDecision,
  HostContext,
  FingerprintBundle,
} from '@nimiq-faucet/sdk';
