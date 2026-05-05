<script setup lang="ts">
defineProps<{
  disabled?: boolean;
  pending?: boolean;
  label?: string;
}>();
</script>

<template>
  <button
    type="button"
    class="claim"
    :disabled="disabled"
    :data-pending="pending ? 'true' : 'false'"
  >
    <span class="label">{{ label ?? 'Claim NIM' }}</span>
    <span class="arrow" aria-hidden="true">→</span>
  </button>
</template>

<style scoped>
.claim {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  height: 2.25rem;
  padding: 0 1.4rem;
  background: var(--gold);
  color: var(--navy-3);
  border-radius: 999px;
  font-weight: 800;
  font-size: 0.82rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  box-shadow: 0 0 0 0 rgba(246, 174, 45, 0.3), 0 6px 16px rgba(0, 0, 0, 0.28);
  transition: background-color 160ms ease, transform 120ms ease, box-shadow 200ms ease;
}

.claim:not(:disabled):hover {
  background: var(--amber);
  transform: translateY(-1px);
  box-shadow: 0 0 0 5px rgba(246, 174, 45, 0.18), 0 8px 18px rgba(0, 0, 0, 0.32);
}
.claim:not(:disabled):active {
  transform: translateY(0);
}

.claim[data-pending='true'] {
  animation: pulse 1.6s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(246, 174, 45, 0.4), 0 6px 16px rgba(0, 0, 0, 0.28); }
  50%      { box-shadow: 0 0 0 8px rgba(246, 174, 45, 0), 0 6px 16px rgba(0, 0, 0, 0.28); }
}

.arrow { font-size: 1rem; }
</style>
