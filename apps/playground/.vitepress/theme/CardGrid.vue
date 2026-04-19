<script setup lang="ts">
import { withBase } from 'vitepress'

interface CardItem {
  icon: string
  title: string
  details: string
  time?: string
  badge?: string
  link: string
}

withDefaults(defineProps<{
  items: CardItem[]
  title?: string
  open?: boolean
}>(), { open: true })
</script>

<template>
  <details class="card-section" :open="open || undefined">
    <summary v-if="title" class="section-title">{{ title }}</summary>
    <div class="card-grid">
      <div v-for="(item, i) in items" :key="i" class="grid-card">
        <a :href="withBase(item.link)" class="card-link">
          <div class="card-icon">{{ item.icon }}</div>
          <h3 class="card-title">{{ item.title }}</h3>
          <p class="card-details">{{ item.details }}</p>
          <span v-if="item.time" class="card-badge">{{ item.time }}</span>
          <code v-else-if="item.badge" class="card-badge-code">{{ item.badge }}</code>
        </a>
      </div>
    </div>
  </details>
</template>

<style scoped>
.card-section {
  margin: 24px 0;
}

.section-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--vp-c-text-1);
  cursor: pointer;
  padding: 8px 0;
  list-style: none;
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-title::before {
  content: '▸';
  font-size: 14px;
  color: var(--vp-c-text-3);
  transition: transform 0.2s;
}

details[open] > .section-title::before {
  transform: rotate(90deg);
}

.section-title::-webkit-details-marker {
  display: none;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
  margin-top: 12px;
}

.grid-card {
  border: 1px solid var(--vp-c-divider);
  border-radius: 16px;
  padding: 24px;
  transition: border-color 0.2s, box-shadow 0.2s;
  background: var(--vp-c-bg-soft);
}

.grid-card:hover {
  border-color: var(--nimiq-gold);
  box-shadow: 0 0 20px rgba(233, 178, 19, 0.08);
}

.card-link {
  text-decoration: none;
  color: inherit;
  display: block;
}

.card-icon {
  font-size: 28px;
  margin-bottom: 12px;
}

.card-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--vp-c-text-1);
  margin: 0 0 8px;
}

.card-details {
  font-size: 14px;
  color: var(--vp-c-text-2);
  line-height: 1.5;
  margin: 0 0 12px;
}

.card-badge {
  display: inline-block;
  font-size: 12px;
  font-weight: 600;
  color: var(--nimiq-gold);
  background: var(--vp-c-brand-soft);
  padding: 2px 10px;
  border-radius: 10px;
}

.card-badge-code {
  display: inline-block;
  font-size: 11px;
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-mute);
  padding: 2px 8px;
  border-radius: 6px;
}
</style>
