<script setup lang="ts">
import { ref, computed } from 'vue';
import WorldMap from './components/WorldMap.vue';
import ConnectWallet from './components/ConnectWallet.vue';
import ClaimButton from './components/ClaimButton.vue';
import StatusBar from './components/StatusBar.vue';
import FooterBar from './components/FooterBar.vue';
import ThemePicker from './components/ThemePicker.vue';
import FCaptchaWidget from './components/FCaptchaWidget.vue';
import { useClaim } from './composables/useClaim';
import { isValidNimiqAddress } from './lib/nimiqAddress';

const address = ref('');
const connectedLabel = ref<string | null>(null);
const captchaToken = ref('');
const { config, state, claim, reset } = useClaim();

const isAddressValid = computed(() => isValidNimiqAddress(address.value));

// Captcha is required if the server config exposes a provider. Today
// only fcaptcha is wired into this UI — turnstile / hcaptcha can be
// added later by mounting their widgets in the same `.abuse-slot`.
const captchaProvider = computed(() => config.value?.captcha?.provider ?? null);
const needsCaptcha = computed(() => captchaProvider.value !== null);
const fcaptchaServerUrl = computed(() => config.value?.captcha?.serverUrl ?? null);
const fcaptchaSiteKey = computed(() => config.value?.captcha?.siteKey ?? null);

// Ref to ConnectWallet so the top-right "Ready to mine…" pill can
// trigger the same Hub-connect flow as the bottom-strip Connect button.
const connectWalletRef = ref<{ connect: () => Promise<void> } | null>(null);
function triggerConnect(): void {
  void connectWalletRef.value?.connect();
}

// Phases where the user can act rather than wait on a claim in flight.
const isClaimablePhase = computed(
  () =>
    state.phase === 'idle' ||
    state.phase === 'rejected' ||
    state.phase === 'error' ||
    state.phase === 'confirmed',
);

// The abuse-layer gate the Claim button enforces, minus the address
// requirement: captcha solved (when a provider is configured) and not
// mid-claim. The wallet-connect controls (the top-right pill and the
// in-strip Connect button) are disabled until this passes, so a visitor
// has to clear the captcha before the page will open the Nimiq Hub.
const canConnect = computed(() => {
  if (needsCaptcha.value && !captchaToken.value) return false;
  return isClaimablePhase.value;
});

const canClaim = computed(() => canConnect.value && isAddressValid.value);

const isPending = computed(() =>
  ['loading-config', 'solving-hashcash', 'submitting', 'broadcast'].includes(state.phase),
);

function handleClaim() {
  if (!canClaim.value) return;
  if (state.phase === 'confirmed' || state.phase === 'rejected' || state.phase === 'error') {
    reset();
  }
  void claim(address.value, captchaToken.value || undefined).then(() => {
    // Reset the captcha after every submission — most providers (FCaptcha
    // included) emit a single-use token, so the next claim attempt needs
    // a fresh challenge.
    captchaToken.value = '';
  });
}
</script>

<template>
  <div class="layout">
    <!-- Decorative animated map fills the background. -->
    <WorldMap class="map-bg" />

    <!-- Top-left: NIM brand pill (matches the wallet/web-miner top chrome) -->
    <header class="top-left">
      <div class="brand-pill">
        <svg class="logo" viewBox="0 0 64 64" aria-hidden="true">
          <!-- Canonical Nimiq mark: yellow flat-top hexagon. -->
          <path
            d="M50 32 L41 47.6 L23 47.6 L14 32 L23 16.4 L41 16.4 Z"
            fill="#F6AE2D"
          />
        </svg>
        <span class="brand-label">NIM</span>
      </div>
      <ThemePicker :config="config" />
    </header>

    <!-- Top-right: stats grid (CLAIM / NETWORK / PoW / STATUS) -->
    <aside class="top-right">
      <div class="stat">
        <span class="stat-label">Claim</span>
        <span class="stat-value">
          {{ config?.claimAmountLuna ? `${(Number(config.claimAmountLuna) / 1e5).toFixed(2)} NIM` : '—' }}
        </span>
      </div>
      <div class="stat">
        <span class="stat-label">Network</span>
        <span class="stat-value">{{ config?.network ? config.network.charAt(0).toUpperCase() + config.network.slice(1) : '—' }}</span>
      </div>
      <div class="stat status-stat">
        <button type="button" class="connect-btn" :disabled="!canConnect" @click="triggerConnect">
          Connect Wallet
        </button>
      </div>
    </aside>

    <!-- Map fills the middle (world dot map renders through the decorative layer above) -->
    <main class="middle"></main>

    <!-- Bottom action strip: abuse-layer slot above, then Hub button + address input + Claim CTA -->
    <section class="bottom-strip">
      <!-- Reserved slot for any abuse-layer surface the server demands:
           hashcash progress, submit/broadcast/confirmed/rejected/error
           messages today, and any future captcha widgets (turnstile /
           hcaptcha / fcaptcha iframes) when this UI integrates them. -->
      <div class="abuse-slot">
        <FCaptchaWidget
          v-if="
            state.phase === 'idle' &&
            captchaProvider === 'fcaptcha' &&
            fcaptchaServerUrl &&
            fcaptchaSiteKey
          "
          v-model="captchaToken"
          :server-url="fcaptchaServerUrl"
          :site-key="fcaptchaSiteKey"
        />
        <StatusBar
          v-else-if="state.phase !== 'idle'"
          class="strip-status"
          :phase="state.phase"
          :tx-id="state.txId"
          :error-message="state.errorMessage"
          :hashcash-attempts="state.hashcashAttempts"
        />
      </div>
      <div class="strip-inner">
        <ConnectWallet
          ref="connectWalletRef"
          v-model="address"
          :disabled="isPending"
          :connect-disabled="!canConnect"
          :network="config?.network"
          @connected-label="connectedLabel = $event"
        />
        <ClaimButton
          class="claim-cta"
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
      </div>
    </section>

    <FooterBar class="footer" />
  </div>
</template>

<style scoped>
.layout {
  position: relative;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  /* Clamp the layout to the viewport so wide absolute-positioned
     children (e.g. top-right stats grid + status pill) can't expand
     the document horizontally and shift map-bg's right edge offscreen. */
  overflow-x: hidden;
  width: 100%;
}

.map-bg {
  /* Use explicit viewport-unit math instead of just `right: 12rem` —
     belt-and-suspenders against any ancestor creating a containing
     block that would shift `right`'s reference frame. With explicit
     `left` and `width` derived from `100vw`, both edges are
     unambiguous regardless of any layout overflow weirdness. */
  position: fixed !important;
  top: 0;
  left: 12rem;
  width: calc(100vw - 24rem);
  height: calc(100vh - 1.5rem);
  z-index: 0;
  opacity: 0.85;
}

/* ── Top-left: NIM brand pill ─────────────────────────────── */
.top-left {
  position: absolute;
  top: 1.25rem;
  left: 1.5rem;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.brand-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.9rem;
  border-radius: 999px;
  background: rgba(20, 23, 46, 0.7);
  border: 1px solid var(--line);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.logo {
  width: 1.5rem;
  height: 1.5rem;
  filter: drop-shadow(0 2px 8px rgba(246, 174, 45, 0.45));
}

.brand-label {
  font-size: 0.85rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--text);
}

/* ── Top-right: stats grid ────────────────────────────────── */
.top-right {
  position: absolute;
  top: 1.25rem;
  right: 1.5rem;
  z-index: 2;
  display: flex;
  align-items: stretch;
  gap: 0;
  padding: 0.6rem 0.5rem;
  background: rgba(20, 23, 46, 0.7);
  border: 1px solid var(--line);
  border-radius: 12px;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  padding: 0.2rem 1rem;
  border-right: 1px solid var(--line);
  min-width: 96px;
}
.stat:last-child { border-right: none; }

.stat-label {
  font-size: 0.62rem;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
}
.stat-value {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text);
  margin-top: 0.15rem;
  font-variant-numeric: tabular-nums;
}
.status-stat { padding: 0.2rem 0.5rem; min-width: auto; }

/* Top-right Connect-Wallet button — fixed label, opens the same Hub
   flow as the Connect button in the bottom strip. */
.connect-btn {
  display: inline-flex;
  align-items: center;
  height: 2rem;
  padding: 0 0.95rem;
  background: rgba(246, 174, 45, 0.08);
  border: 1px solid var(--gold);
  color: var(--text);
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 160ms ease, transform 120ms ease, box-shadow 200ms ease;
}
.connect-btn:not(:disabled):hover {
  background: rgba(246, 174, 45, 0.16);
  transform: translateY(-1px);
  box-shadow: 0 0 0 3px rgba(246, 174, 45, 0.10);
}
.connect-btn:not(:disabled):active { transform: translateY(0); }
.connect-btn:disabled { opacity: 0.55; cursor: not-allowed; }

/* ── Middle: blank space, world map shows through ─────────── */
.middle {
  position: relative;
  z-index: 1;
  flex: 1;
  /* Map is decorative; this main element just claims the space. */
}

/* ── Bottom action strip ──────────────────────────────────── */
.bottom-strip {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  /* Larger gap so the FCaptcha widget (when mounted in `.abuse-slot`)
     visually breathes above the address row, instead of touching it. */
  gap: 1.1rem;
  padding: 0.8rem 1.5rem 1rem;
  background: linear-gradient(180deg, rgba(20, 23, 46, 0) 0%, rgba(20, 23, 46, 0.85) 70%, rgba(20, 23, 46, 0.92) 100%);
}

/* Reserved row above the address strip for abuse-layer surfaces:
   status pill, captcha widgets (turnstile/hcaptcha/fcaptcha render
   targets), hashcash progress, etc. Centered, with a small minimum
   height so the strip doesn't jump when content appears/disappears. */
.abuse-slot {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  min-height: 2.4rem;
}

.strip-status {
  align-self: center;
}

.strip-inner {
  width: 100%;
  max-width: 640px;
  display: flex;
  align-items: stretch;
  gap: 0.5rem;
}
/* Connect+input cluster grows; Claim button stays sized to its label. */
.strip-inner > :first-child { flex: 1 1 auto; min-width: 0; }
.claim-cta { flex: 0 0 auto; }

.footer {
  position: relative;
  z-index: 2;
}

@media (max-width: 720px) {
  /* The brand pill and the stats grid can't share the top row on a
     narrow screen, so the stats grid drops onto its own line just
     below the pill — right-aligned, tighter padding/fonts, borders
     dropped, allowed to wrap on very small screens. (It used to be
     `display: none` here, which made the whole right side of the
     header disappear on mobile.) */
  .top-right {
    top: 4.5rem;
    padding: 0.4rem 0.5rem;
    max-width: calc(100vw - 3rem);
    flex-wrap: wrap;
    justify-content: flex-end;
    row-gap: 0.2rem;
  }
  .top-right .stat { min-width: 0; padding: 0.15rem 0.7rem; border-right: none; }
  .top-right .stat-label { font-size: 0.55rem; letter-spacing: 0.1em; }
  .top-right .stat-value { font-size: 0.82rem; }
  .top-right .connect-btn { height: 1.85rem; padding: 0 0.75rem; font-size: 0.72rem; }
  /* The 12rem/24rem insets above clear the desktop top chrome; on
     mobile the chrome stacks vertically instead, so let the map fill
     the viewport width (the brand pill keeps its own opaque backdrop,
     so it stays legible on top). */
  .map-bg {
    left: 0;
    width: 100vw;
  }
  .strip-inner { flex-direction: column; align-items: stretch; }
}
</style>
