<script setup lang="ts">
import { ref, computed } from 'vue';
import WorldMap from './components/WorldMap.vue';
import ConnectWallet from './components/ConnectWallet.vue';
import ClaimButton from './components/ClaimButton.vue';
import StatusBar from './components/StatusBar.vue';
import FooterBar from './components/FooterBar.vue';
import { useClaim } from './composables/useClaim';

const address = ref('');
const connectedLabel = ref<string | null>(null);
const { config, state, claim, reset } = useClaim();

const canClaim = computed(() => {
  if (!address.value.trim()) return false;
  return state.phase === 'idle' || state.phase === 'rejected' || state.phase === 'error' || state.phase === 'confirmed';
});

const isPending = computed(() =>
  ['loading-config', 'solving-hashcash', 'submitting', 'broadcast'].includes(state.phase),
);

function handleClaim() {
  if (!canClaim.value) return;
  if (state.phase === 'confirmed' || state.phase === 'rejected' || state.phase === 'error') {
    reset();
  }
  void claim(address.value);
}
</script>

<template>
  <div class="layout">
    <!-- Decorative animated map fills the background. -->
    <WorldMap class="map-bg" />

    <!-- Header bar -->
    <header class="header">
      <div class="brand">
        <svg class="logo" viewBox="0 0 64 64" aria-hidden="true">
          <circle cx="32" cy="32" r="28" fill="#F6AE2D" />
          <path
            d="M32 14 L48 24 L48 40 L32 50 L16 40 L16 24 Z"
            fill="#1F2348"
            stroke="#1F2348"
            stroke-width="2"
            stroke-linejoin="round"
          />
        </svg>
        <div class="title">
          <h1>Nimiq Faucet</h1>
          <p class="tagline">PoW theme &mdash; tribute to the original web-miner</p>
        </div>
      </div>
      <StatusBar
        :phase="state.phase"
        :tx-id="state.txId"
        :error-message="state.errorMessage"
        :hashcash-attempts="state.hashcashAttempts"
      />
    </header>

    <!-- Centerpiece content -->
    <main class="content">
      <div class="panel">
        <h2 class="hero">Claim your free NIM</h2>
        <p class="sub">
          Decentralised peer-to-peer cash. Connect your Nimiq Hub account (or paste an address) and we'll send
          you {{ config?.claimAmountLuna ? `${(Number(config.claimAmountLuna) / 1e5).toFixed(2)} NIM` : 'some NIM' }} to get you started.
          <span v-if="connectedLabel" class="claiming-to">Claiming to <strong>{{ connectedLabel }}</strong>.</span>
        </p>

        <ConnectWallet
          v-model="address"
          :disabled="isPending"
          :network="config?.network"
          @connected-label="connectedLabel = $event"
        />

        <div class="cta-row">
          <ClaimButton
            :disabled="!canClaim"
            :pending="isPending"
            :label="
              state.phase === 'confirmed' ? 'Claim again' :
              state.phase === 'rejected' || state.phase === 'error' ? 'Try again' :
              isPending ? 'Mining…' :
              'Claim NIM'
            "
            @click="handleClaim"
          />
          <p v-if="config?.hashcash" class="hashcash-note">
            Proof-of-work difficulty {{ config.hashcash.difficulty }} bits — solved in your browser.
          </p>
        </div>
      </div>
    </main>

    <FooterBar class="footer" />
  </div>
</template>

<style scoped>
.layout {
  position: relative;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.map-bg {
  position: absolute !important;
  inset: 0;
  z-index: 0;
  opacity: 0.55;
}

.header {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 1rem;
  padding: 1.5rem 2rem;
}

.brand {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.logo {
  width: 2.75rem;
  height: 2.75rem;
  filter: drop-shadow(0 4px 14px rgba(246, 174, 45, 0.35));
}

.title h1 {
  font-size: 1.4rem;
  font-weight: 800;
  letter-spacing: 0.02em;
  color: var(--text);
}
.tagline {
  font-size: 0.7rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.16em;
}

.content {
  position: relative;
  z-index: 1;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
}

.panel {
  width: 100%;
  max-width: 640px;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  padding: 2.5rem;
  background: rgba(20, 23, 46, 0.78);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid var(--line);
  border-radius: 18px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
}

.hero {
  font-size: 2rem;
  font-weight: 800;
  line-height: 1.15;
  letter-spacing: -0.01em;
}

.sub {
  font-size: 0.95rem;
  line-height: 1.6;
  color: var(--muted);
}
.claiming-to {
  display: inline;
  margin-left: 0.4rem;
  color: var(--gold);
}
.claiming-to strong { color: var(--text); font-weight: 700; }

.cta-row {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  align-items: flex-start;
}

.hashcash-note {
  font-size: 0.75rem;
  color: var(--muted);
  font-style: italic;
}

.footer {
  position: relative;
  z-index: 1;
}

@media (max-width: 640px) {
  .panel {
    padding: 1.5rem;
  }
  .hero {
    font-size: 1.5rem;
  }
}
</style>
