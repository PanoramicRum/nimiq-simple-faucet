<script setup lang="ts">
import { computed } from 'vue';
import { lunaToNim } from '../lib/format';

interface ClaimDetail {
  id: string;
  createdAt: string | number;
  address: string;
  amountLuna?: string;
  status: string;
  decision: string | null;
  txId: string | null;
  rejectionReason: string | null;
}

const props = defineProps<{ claim: ClaimDetail }>();
const emit = defineEmits<{ close: [] }>();

const statusLabel = computed(() => {
  switch (props.claim.status) {
    case 'confirmed': return 'Confirmed';
    case 'broadcast': return 'Broadcast';
    case 'rejected': return 'Rejected';
    case 'challenged': return 'Challenged';
    case 'timeout': return 'Timeout';
    default: return props.claim.status;
  }
});

const statusBgClass = computed(() => {
  switch (props.claim.status) {
    case 'confirmed': return 'bg-[#21BCA5]/10 text-[#21BCA5]';
    case 'broadcast': return 'bg-tertiary-container text-on-tertiary-container';
    case 'rejected': return 'bg-error-container text-error';
    default: return 'bg-surface-container-high text-on-surface-variant';
  }
});

const dotColorClass = computed(() => {
  switch (props.claim.status) {
    case 'confirmed': return 'bg-[#21BCA5]';
    case 'broadcast': return 'bg-tertiary';
    case 'rejected': return 'bg-error';
    default: return 'bg-on-surface-variant';
  }
});

const formattedTime = computed(() => {
  const d = new Date(props.claim.createdAt);
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
});

const timeAgo = computed(() => {
  const diff = Date.now() - new Date(props.claim.createdAt).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} mins ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} hours ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
});

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text);
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#31302d]/10 backdrop-blur-sm" @click.self="emit('close')">
      <div class="w-full max-w-2xl rounded-[24px] p-8 md:p-12 relative flex flex-col gap-8 bg-surface-container-lowest/95 backdrop-blur-[20px] shadow-soft outline outline-1 outline-outline-variant/15">
        <!-- Header -->
        <div class="flex items-start justify-between">
          <div class="flex flex-col gap-2">
            <h2 class="font-headline text-2xl font-bold text-on-surface">Event Details</h2>
            <div class="flex items-center gap-3">
              <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-label text-xs font-semibold uppercase tracking-wider" :class="statusBgClass">
                <span class="w-2 h-2 rounded-full" :class="dotColorClass"></span>
                {{ statusLabel }}
              </span>
              <span class="text-on-surface-variant text-sm font-body">{{ timeAgo }}</span>
            </div>
          </div>
          <button
            class="w-10 h-10 rounded-full bg-surface-container-low flex items-center justify-center text-on-surface-variant hover:text-primary transition-colors cursor-pointer"
            @click="emit('close')"
          >
            ✕
          </button>
        </div>

        <!-- Content — Bento grid -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <!-- Address (full width) -->
          <div class="col-span-1 md:col-span-2 bg-surface-container-low rounded-[16px] p-6 flex flex-col gap-3">
            <span class="font-label text-xs uppercase tracking-wider text-on-surface-variant font-medium">Address</span>
            <div class="flex items-center justify-between">
              <span class="font-mono text-sm text-on-surface break-all">{{ claim.address }}</span>
              <button class="text-primary hover:text-primary-container p-2 rounded-lg hover:bg-surface-container-high transition-colors" @click="copyToClipboard(claim.address)">
                📋
              </button>
            </div>
          </div>

          <!-- Exact Time -->
          <div class="bg-surface-container-low rounded-[16px] p-6 flex flex-col gap-2">
            <span class="font-label text-xs uppercase tracking-wider text-on-surface-variant font-medium">Exact Time</span>
            <span class="font-mono text-sm text-on-surface">{{ formattedTime }}</span>
          </div>

          <!-- Amount -->
          <div v-if="claim.amountLuna" class="bg-surface-container-low rounded-[16px] p-6 flex flex-col gap-2">
            <span class="font-label text-xs uppercase tracking-wider text-on-surface-variant font-medium">Amount</span>
            <span class="font-mono text-lg text-primary font-semibold">{{ lunaToNim(claim.amountLuna) }} NIM</span>
          </div>

          <!-- Decision -->
          <div class="bg-surface-container-low rounded-[16px] p-6 flex flex-col gap-2">
            <span class="font-label text-xs uppercase tracking-wider text-on-surface-variant font-medium">Decision</span>
            <span class="font-mono text-sm text-on-surface">{{ claim.decision ?? '—' }}</span>
          </div>

          <!-- TX Hash (if exists) -->
          <div v-if="claim.txId" class="col-span-1 md:col-span-2 bg-surface-container-low rounded-[16px] p-6 flex flex-col gap-3">
            <span class="font-label text-xs uppercase tracking-wider text-on-surface-variant font-medium">Transaction Hash</span>
            <div class="flex items-center justify-between">
              <span class="font-mono text-sm text-on-surface break-all">{{ claim.txId }}</span>
              <button class="text-primary hover:text-primary-container p-2 rounded-lg hover:bg-surface-container-high transition-colors" @click="copyToClipboard(claim.txId!)">
                📋
              </button>
            </div>
          </div>

          <!-- Rejection Reason (if exists) -->
          <div v-if="claim.rejectionReason" class="col-span-1 md:col-span-2 bg-surface-container-low rounded-[16px] p-6 flex flex-col gap-3">
            <span class="font-label text-xs uppercase tracking-wider text-on-surface-variant font-medium">Rejection Reason</span>
            <span class="font-mono text-sm text-error">{{ claim.rejectionReason }}</span>
          </div>

          <!-- Claim ID -->
          <div class="bg-surface-container-low rounded-[16px] p-6 flex flex-col gap-2">
            <span class="font-label text-xs uppercase tracking-wider text-on-surface-variant font-medium">Claim ID</span>
            <span class="font-mono text-sm text-on-surface">{{ claim.id }}</span>
          </div>

          <!-- Status -->
          <div class="bg-surface-container-low rounded-[16px] p-6 flex flex-col gap-2">
            <span class="font-label text-xs uppercase tracking-wider text-on-surface-variant font-medium">Status</span>
            <span class="font-mono text-sm text-on-surface">{{ claim.status }}</span>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
