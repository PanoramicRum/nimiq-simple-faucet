<script setup lang="ts">
/**
 * §3.0.16 — user-facing theme picker dropdown.
 *
 * Reads the bundled theme list from `/v1/config.ui.themePicker.themes`
 * (only present when the operator opted in via FAUCET_THEME_PICKER_ENABLED).
 * On selection: writes the slug to localStorage + reloads the page with
 * `?theme=<slug>`. The server reads the query param and serves that
 * theme's index.html.
 *
 * On every load, checks localStorage against the active theme. If the
 * user previously picked a different theme but landed on `/` without
 * the query param (e.g. typed the URL directly), redirect to
 * `?theme=<their-pick>` once. This is the persistence story.
 *
 * If the picker is disabled (operator default), the component renders
 * nothing and the page looks identical to before §3.0.16.
 */

import { computed, onMounted, ref } from 'vue';
import type { FaucetConfig } from '@nimiq-faucet/sdk';

interface ThemeListEntry {
  slug: string;
  displayName: string;
  description: string;
}

interface UiConfigSection {
  theme: string;
  displayName: string;
  themePicker?: { enabled: boolean; themes: ThemeListEntry[] };
}

const props = defineProps<{ config: FaucetConfig | null }>();

// /v1/config.ui isn't part of the SDK type yet (the SDK is shared
// across all themes; we extended the runtime shape in §3.0.16). Read
// it via a permissive cast — the types catch up in a future SDK bump.
const ui = computed<UiConfigSection | null>(() => {
  const c = props.config as (FaucetConfig & { ui?: UiConfigSection }) | null;
  return c?.ui ?? null;
});

const enabled = computed(() => Boolean(ui.value?.themePicker?.enabled));
const themes = computed<ThemeListEntry[]>(() => ui.value?.themePicker?.themes ?? []);
const activeSlug = computed(() => ui.value?.theme ?? '');

const STORAGE_KEY = 'nimiq-faucet-theme';
const PICKER_OPEN = ref(false);

onMounted(() => {
  if (!enabled.value) return;
  // If the user previously picked a theme but the URL doesn't reflect
  // it, redirect once. Avoids an infinite loop by checking the URL.
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    if (stored === activeSlug.value) return;
    if (!themes.value.some((t) => t.slug === stored)) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('theme') === stored) return;
    url.searchParams.set('theme', stored);
    window.location.replace(url.toString());
  } catch {
    // localStorage unavailable (private mode, sandboxed iframe). Just skip.
  }
});

function pickTheme(slug: string) {
  if (slug === activeSlug.value) {
    PICKER_OPEN.value = false;
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, slug);
  } catch {
    /* private mode — fall through; the URL switch will still work for this load */
  }
  const url = new URL(window.location.href);
  url.searchParams.set('theme', slug);
  window.location.assign(url.toString());
}
</script>

<template>
  <div v-if="enabled && themes.length > 1" class="theme-picker">
    <button
      type="button"
      class="trigger"
      :aria-expanded="PICKER_OPEN ? 'true' : 'false'"
      aria-haspopup="listbox"
      @click="PICKER_OPEN = !PICKER_OPEN"
    >
      <span class="label">Theme</span>
      <span class="current">{{ ui?.displayName }}</span>
      <span class="caret" aria-hidden="true">▾</span>
    </button>

    <ul v-if="PICKER_OPEN" class="menu" role="listbox">
      <li
        v-for="t in themes"
        :key="t.slug"
        :role="'option'"
        :aria-selected="t.slug === activeSlug ? 'true' : 'false'"
        :class="{ active: t.slug === activeSlug }"
        @click="pickTheme(t.slug)"
      >
        <div class="row">
          <span class="name">{{ t.displayName }}</span>
          <span v-if="t.slug === activeSlug" class="dot" aria-hidden="true">●</span>
        </div>
        <p class="desc">{{ t.description }}</p>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.theme-picker {
  position: relative;
  display: inline-block;
}

.trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.85rem;
  background: rgba(20, 23, 46, 0.6);
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--text);
  font-size: 0.78rem;
  letter-spacing: 0.02em;
  transition: background-color 160ms ease, border-color 160ms ease;
}
.trigger:hover {
  background: rgba(20, 23, 46, 0.85);
  border-color: rgba(246, 174, 45, 0.35);
}
.label {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: var(--muted);
}
.current { font-weight: 700; }
.caret { font-size: 0.65rem; color: var(--muted); }

.menu {
  position: absolute;
  top: calc(100% + 0.5rem);
  right: 0;
  min-width: 16rem;
  list-style: none;
  margin: 0;
  padding: 0.4rem;
  background: rgba(14, 17, 36, 0.96);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.55);
  z-index: 50;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.menu li {
  padding: 0.6rem 0.75rem;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 120ms ease;
}
.menu li:hover { background: rgba(246, 174, 45, 0.08); }
.menu li.active { background: rgba(246, 174, 45, 0.12); }

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 700;
  font-size: 0.85rem;
}
.row .dot { color: var(--gold); font-size: 0.7rem; }
.desc {
  margin-top: 0.15rem;
  font-size: 0.72rem;
  color: var(--muted);
  line-height: 1.4;
}
</style>
