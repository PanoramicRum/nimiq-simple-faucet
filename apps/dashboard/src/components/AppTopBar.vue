<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

defineEmits<{ (e: 'toggle-sidebar'): void }>();

const auth = useAuthStore();
const router = useRouter();

async function onLogout(): Promise<void> {
  await auth.logout();
  await router.replace({ path: '/admin/login' });
}
</script>

<template>
  <header
    class="flex items-center justify-between border-b border-[color:var(--color-card-border)] bg-[color:var(--color-card-bg)] px-4 py-2"
  >
    <div class="flex items-center gap-2">
      <button
        type="button"
        class="btn-secondary !px-2 !py-1 md:hidden"
        aria-label="Toggle sidebar"
        @click="$emit('toggle-sidebar')"
      >
        ☰
      </button>
      <h1 class="text-sm font-semibold">Admin dashboard</h1>
    </div>
    <div class="flex items-center gap-3 text-sm">
      <span class="muted">
        <span class="sr-only">Signed in as </span>{{ auth.user?.userId ?? 'admin' }}
      </span>
      <button type="button" class="btn-secondary" @click="onLogout">Log out</button>
    </div>
  </header>
</template>
