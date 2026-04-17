import { computed, onUnmounted, reactive, toRefs, type Ref } from 'vue';
import {
  FaucetClient,
  FaucetError,
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

function asClient(source: FaucetClientLike | FaucetClientOptions): FaucetClientLike {
  if (source instanceof FaucetClient) return source;
  if (typeof (source as FaucetClientLike).claim === 'function') return source as FaucetClientLike;
  return new FaucetClient(source as FaucetClientOptions);
}

export function useFaucetClaim(args: UseFaucetClaimArgs) {
  const client = asClient(args.client);
  const state = reactive<ClaimState>({
    status: 'idle',
    id: null,
    txId: null,
    decision: null,
    error: null,
  });
  const manager = new ClaimManager(client, (s) => Object.assign(state, s));
  const isPending = computed(() => state.status === 'pending');

  onUnmounted(() => manager.destroy());

  return {
    ...toRefs(state),
    isPending,
    claim: () =>
      manager.claim(args.address, {
        hostContext: args.hostContext,
        captchaToken: args.captchaToken,
        hashcashSolution: args.hashcashSolution,
        fingerprint: args.fingerprint,
        pollForConfirmation: args.pollForConfirmation,
      }),
    reset: () => manager.reset(),
  };
}

export function useFaucetStatus(
  client: FaucetClientLike | FaucetClientOptions,
  id: Ref<string | null> | string | null,
  pollIntervalMs = 2_000,
) {
  const c = asClient(client);
  const state = reactive<StatusState>({ data: null, error: null, loading: false });
  const poller = new StatusPoller(c, (s) => Object.assign(state, s));
  const idValue = typeof id === 'object' && id !== null && 'value' in id ? id.value : id;

  if (idValue) poller.start(idValue, pollIntervalMs);
  onUnmounted(() => poller.destroy());

  return { ...toRefs(state), refetch: () => { if (idValue) poller.refetch(idValue); } };
}

export function useFaucetStream(
  client: FaucetClientLike | FaucetClientOptions,
  onEvent: (event: unknown) => void,
) {
  const c = asClient(client);
  const mgr = new StreamManager(c);
  mgr.start(onEvent);
  onUnmounted(() => mgr.destroy());
}

export { FaucetClient, FaucetError } from '@nimiq-faucet/sdk';
export type {
  ClaimOptions,
  ClaimResponse,
  ClaimStatus,
  ClaimDecision,
  HostContext,
  FingerprintBundle,
  ClaimState,
} from '@nimiq-faucet/sdk';
