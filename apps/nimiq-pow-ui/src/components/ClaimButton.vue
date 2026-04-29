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
  gap: 0.85rem;
  padding: 1rem 2.25rem;
  background: var(--gold);
  color: var(--navy-3);
  border-radius: 999px;
  font-weight: 800;
  font-size: 1rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  box-shadow: 0 0 0 0 rgba(246, 174, 45, 0.3), 0 12px 30px rgba(0, 0, 0, 0.35);
  transition: background-color 160ms ease, transform 120ms ease, box-shadow 200ms ease;
}

.claim:not(:disabled):hover {
  background: var(--amber);
  transform: translateY(-1px);
  box-shadow: 0 0 0 8px rgba(246, 174, 45, 0.18), 0 14px 32px rgba(0, 0, 0, 0.4);
}
.claim:not(:disabled):active {
  transform: translateY(0);
}

.claim[data-pending='true'] {
  animation: pulse 1.6s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(246, 174, 45, 0.4), 0 12px 30px rgba(0, 0, 0, 0.35); }
  50%      { box-shadow: 0 0 0 14px rgba(246, 174, 45, 0), 0 12px 30px rgba(0, 0, 0, 0.35); }
}

.arrow { font-size: 1.2rem; }
</style>
