import { computed, onUnmounted, ref, shallowRef, watch, type Ref } from 'vue';
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
  const client = shallowRef(asClient(args.client));
  const status = ref<'idle' | 'pending' | ClaimStatus>('idle');
  const id = ref<string | null>(null);
  const txId = ref<string | null>(null);
  const decision = ref<ClaimResponse['decision'] | null>(null);
  const error = ref<FaucetError | Error | null>(null);
  let controller: AbortController | null = null;

  const isPending = computed(() => status.value === 'pending');

  const reset = () => {
    controller?.abort();
    controller = null;
    status.value = 'idle';
    id.value = null;
    txId.value = null;
    decision.value = null;
    error.value = null;
  };

  const claim = async () => {
    reset();
    status.value = 'pending';
    controller = new AbortController();
    try {
      const response = await client.value.claim(args.address, {
        hostContext: args.hostContext,
        captchaToken: args.captchaToken,
        hashcashSolution: args.hashcashSolution,
        fingerprint: args.fingerprint,
        signal: controller.signal,
      });
      id.value = response.id;
      status.value = response.status;
      txId.value = response.txId ?? null;
      decision.value = response.decision ?? null;
      const shouldPoll = args.pollForConfirmation ?? true;
      if (shouldPoll && (response.status === 'broadcast' || response.status === 'queued')) {
        const confirmed = await client.value.waitForConfirmation(response.id);
        status.value = confirmed.status;
        txId.value = confirmed.txId ?? response.txId ?? null;
        decision.value = confirmed.decision ?? null;
      }
    } catch (err) {
      error.value = err as Error;
      status.value = 'rejected';
    } finally {
      controller = null;
    }
  };

  onUnmounted(() => controller?.abort());

  return { claim, reset, status, id, txId, decision, error, isPending };
}

export function useFaucetStatus(
  client: FaucetClientLike | FaucetClientOptions,
  id: Ref<string | null> | string | null,
  pollIntervalMs = 2_000,
) {
  const c = asClient(client);
  const data = ref<ClaimResponse | null>(null);
  const error = ref<Error | null>(null);
  const loading = ref(false);
  const idRef = (typeof id === 'object' && id !== null && 'value' in id ? id : ref(id)) as Ref<string | null>;
  let timer: ReturnType<typeof setInterval> | undefined;
  let tick = 0;

  const refetch = async () => {
    if (!idRef.value) return;
    loading.value = true;
    const n = ++tick;
    try {
      const next = await c.status(idRef.value);
      if (n === tick) data.value = next;
    } catch (err) {
      if (n === tick) error.value = err as Error;
    } finally {
      if (n === tick) loading.value = false;
    }
  };

  watch(
    idRef,
    (newId) => {
      if (timer) clearInterval(timer);
      if (!newId) return;
      refetch();
      if (pollIntervalMs > 0) {
        timer = setInterval(refetch, pollIntervalMs);
      }
    },
    { immediate: true },
  );

  onUnmounted(() => {
    if (timer) clearInterval(timer);
  });

  return { data, error, loading, refetch };
}

export function useFaucetStream(
  client: FaucetClientLike | FaucetClientOptions,
  onEvent: (event: unknown) => void,
) {
  const c = asClient(client);
  const unsubscribe = c.subscribe(onEvent);
  onUnmounted(unsubscribe);
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
