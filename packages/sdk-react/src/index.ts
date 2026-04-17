import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FaucetClient,
  ClaimManager,
  StatusPoller,
  StreamManager,
  type ClaimOptions,
  type ClaimResponse,
  type ClaimState,
  type ClaimStatus,
  type FaucetClientOptions,
  type StatusState,
} from '@nimiq-faucet/sdk';

export type FaucetClientLike = Pick<
  FaucetClient,
  'claim' | 'status' | 'waitForConfirmation' | 'config' | 'subscribe'
>;

export interface UseFaucetClaimArgs extends Omit<ClaimOptions, 'signal'> {
  client: FaucetClientLike | FaucetClientOptions;
  address: string;
  pollForConfirmation?: boolean;
}

export interface UseFaucetClaimResult extends ClaimState {
  claim: () => Promise<void>;
  reset: () => void;
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
  const [state, setState] = useState<ClaimState>({
    status: 'idle',
    id: null,
    txId: null,
    decision: null,
    error: null,
  });
  const manager = useRef<ClaimManager | null>(null);

  useEffect(() => {
    manager.current = new ClaimManager(client, setState);
    return () => manager.current?.destroy();
  }, [client]);

  const { address, hostContext, captchaToken, hashcashSolution, fingerprint, pollForConfirmation } = args;

  const claim = useCallback(
    async () => {
      await manager.current?.claim(address, {
        hostContext,
        captchaToken,
        hashcashSolution,
        fingerprint,
        pollForConfirmation,
      });
    },
    [address, hostContext, captchaToken, hashcashSolution, fingerprint, pollForConfirmation],
  );

  const reset = useCallback(() => manager.current?.reset(), []);

  return { ...state, claim, reset };
}

export interface UseFaucetStatusResult extends StatusState {
  refetch: () => void;
}

export function useFaucetStatus(
  client: FaucetClientLike | FaucetClientOptions,
  id: string | null,
  pollIntervalMs = 2_000,
): UseFaucetStatusResult {
  const c = useClient(client);
  const [state, setState] = useState<StatusState>({ data: null, error: null, loading: false });
  const poller = useRef<StatusPoller | null>(null);

  useEffect(() => {
    poller.current = new StatusPoller(c, setState);
    return () => poller.current?.destroy();
  }, [c]);

  useEffect(() => {
    if (id) poller.current?.start(id, pollIntervalMs);
    else poller.current?.stop();
  }, [id, pollIntervalMs]);

  const refetch = useCallback(() => {
    if (id) poller.current?.refetch(id);
  }, [id]);

  return { ...state, refetch };
}

export function useFaucetStream(
  client: FaucetClientLike | FaucetClientOptions,
  onEvent: (event: unknown) => void,
): void {
  const c = useClient(client);
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    const mgr = new StreamManager(c);
    mgr.start((event) => handler.current(event));
    return () => mgr.destroy();
  }, [c]);
}

export { FaucetClient } from '@nimiq-faucet/sdk';
export type {
  ClaimOptions,
  ClaimResponse,
  ClaimStatus,
  ClaimDecision,
  HostContext,
  FingerprintBundle,
  ClaimState,
} from '@nimiq-faucet/sdk';
