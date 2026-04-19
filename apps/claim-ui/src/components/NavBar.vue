<script setup lang="ts">
import { RouterLink } from 'vue-router';

defineProps<{ network?: string | undefined }>();
</script>

<template>
  <header class="sticky top-0 z-50 bg-[#FAF9F7] w-full">
    <div class="flex items-center justify-between px-8 py-4 max-w-7xl mx-auto">
      <div class="text-xl font-black text-[#1F2348] font-headline tracking-tight">
        <RouterLink to="/" class="hover:opacity-80 transition-opacity">Nimiq Faucet</RouterLink>
        <span v-if="network" class="text-xs ml-2 font-mono bg-surface-container-high px-2 py-1 rounded-md text-on-surface-variant opacity-80">
          {{ network === 'main' ? 'MAINNET' : 'TESTNET' }}
        </span>
      </div>
      <nav class="hidden md:flex items-center gap-8">
        <a
          href="https://github.com/PanoramicRum/nimiq-simple-faucet"
          target="_blank"
          rel="noopener"
          class="text-[#1F2348]/60 font-medium font-body hover:text-primary-container transition-colors flex items-center gap-2"
        >
          Developer Playground
        </a>
        <a
          href="https://github.com/PanoramicRum/nimiq-simple-faucet"
          target="_blank"
          rel="noopener"
          class="text-[#1F2348]/60 font-medium font-body hover:text-primary-container transition-colors"
        >
          GitHub
        </a>
        <RouterLink
          to="/status"
          class="font-medium font-body transition-colors"
          :class="$route.path === '/status'
            ? 'text-primary-container border-b-2 border-primary-container pb-1 font-bold'
            : 'text-[#1F2348]/60 hover:text-primary-container'"
        >
          Status
        </RouterLink>
      </nav>
    </div>
  </header>
</template>
