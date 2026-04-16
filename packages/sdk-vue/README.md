# @nimiq-faucet/vue

Vue 3 composables for the [Nimiq Simple Faucet](https://github.com/PanoramicRum/nimiq-simple-faucet), built on `@nimiq-faucet/sdk`.

## Install

```bash
npm install @nimiq-faucet/vue
```

## Usage

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { FaucetClient, useFaucetClaim } from '@nimiq-faucet/vue';

const client = new FaucetClient({ url: 'https://faucet.example.com' });
const address = ref('');
const { claim, status, txId, error } = useFaucetClaim({
  client,
  get address() { return address.value; },
  hostContext: { uid: hashedUserId },
});
</script>

<template>
  <input v-model="address" />
  <button @click="claim" :disabled="status === 'pending'">Claim NIM</button>
</template>
```

## Composables

- `useFaucetClaim({ client, address, hostContext? })` — reactive claim lifecycle
- `useFaucetStatus(client, id, pollIntervalMs?)` — polls claim status (returns refs)
- `useFaucetStream(client, onEvent)` — WebSocket subscription (auto-cleanup on unmount)

## License

MIT
