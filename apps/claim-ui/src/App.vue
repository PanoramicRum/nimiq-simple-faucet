<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { FaucetConfig } from '@nimiq-faucet/sdk';
import { useClient } from './lib/client';
import NavBar from './components/NavBar.vue';
import FooterBar from './components/FooterBar.vue';

const client = useClient();
const config = ref<FaucetConfig | null>(null);

onMounted(async () => {
  try {
    config.value = await client.config();
  } catch {
    // Config will be fetched by individual views too.
  }
});
</script>

<template>
  <div class="app-shell">
    <NavBar :network="config?.network" />
    <main class="app-main">
      <RouterView />
    </main>
    <FooterBar />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}
.app-main {
  flex: 1;
}
</style>
