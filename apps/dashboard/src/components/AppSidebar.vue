<script setup lang="ts">
import { RouterLink } from 'vue-router';

defineProps<{ open: boolean }>();
defineEmits<{ (e: 'toggle'): void }>();

const links: { to: string; label: string; icon: string }[] = [
  { to: '/admin/overview', label: 'Overview', icon: '◉' },
  { to: '/admin/claims', label: 'Claims', icon: '▦' },
  { to: '/admin/abuse', label: 'Abuse', icon: '▲' },
  { to: '/admin/account', label: 'Account', icon: '◈' },
  { to: '/admin/integrators', label: 'Integrators', icon: '◎' },
  { to: '/admin/config', label: 'Config', icon: '⚙' },
  { to: '/admin/logs', label: 'Logs', icon: '≡' },
];
</script>

<template>
  <aside
    :class="[
      'shrink-0 border-r border-[color:var(--color-card-border)] bg-[color:var(--color-card-bg)] transition-[width]',
      open ? 'w-56' : 'w-14',
    ]"
    aria-label="Primary navigation"
  >
    <div class="flex items-center justify-between px-3 py-3">
      <span v-if="open" class="text-sm font-semibold tracking-wide">Nimiq Faucet</span>
      <button
        type="button"
        class="btn-secondary !px-2 !py-1"
        :aria-expanded="open"
        aria-controls="sidebar-nav"
        :title="open ? 'Collapse sidebar' : 'Expand sidebar'"
        @click="$emit('toggle')"
      >
        {{ open ? '‹' : '›' }}
      </button>
    </div>
    <nav id="sidebar-nav" class="flex flex-col gap-0.5 px-1">
      <RouterLink
        v-for="l in links"
        :key="l.to"
        :to="l.to"
        class="focus-ring flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-[color:var(--color-row-hover)]"
        active-class="bg-[color:var(--color-row-hover)] font-semibold"
      >
        <span aria-hidden="true" class="w-4 text-center">{{ l.icon }}</span>
        <span v-if="open">{{ l.label }}</span>
        <span v-else class="sr-only">{{ l.label }}</span>
      </RouterLink>
    </nav>
  </aside>
</template>
