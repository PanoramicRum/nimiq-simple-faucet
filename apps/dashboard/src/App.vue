<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { RouterView, useRoute, useRouter } from 'vue-router';
import { useAuthStore } from './stores/auth';
import { setUnauthorizedHandler } from './lib/api';
import AppSidebar from './components/AppSidebar.vue';
import AppTopBar from './components/AppTopBar.vue';
import DriverReadinessBanner from './components/DriverReadinessBanner.vue';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const sidebarOpen = ref<boolean>(true);

setUnauthorizedHandler(() => {
  auth.clearLocal();
  const next = route.fullPath;
  if (route.name !== 'login') {
    void router.replace({ path: '/admin/login', query: { next } });
  }
});

onMounted(async () => {
  // If the CSRF cookie is present assume we may be logged in and confirm.
  if (auth.isAuthenticated && route.name !== 'login') {
    await auth.probe();
  }
});

watch(
  () => route.fullPath,
  () => {
    // Refresh cookie-derived flag after any navigation (server may have
    // cleared cookies on a 401 response captured by the api wrapper).
    auth.refreshCsrfFlag();
  },
);

function toggleSidebar(): void {
  sidebarOpen.value = !sidebarOpen.value;
}
</script>

<template>
  <div v-if="route.name === 'login'" class="min-h-screen">
    <RouterView />
  </div>
  <div v-else class="flex min-h-screen">
    <AppSidebar :open="sidebarOpen" @toggle="toggleSidebar" />
    <div class="flex min-h-screen flex-1 flex-col">
      <AppTopBar @toggle-sidebar="toggleSidebar" />
      <DriverReadinessBanner />
      <main class="flex-1 p-6" aria-live="polite">
        <RouterView />
      </main>
    </div>
  </div>
</template>
