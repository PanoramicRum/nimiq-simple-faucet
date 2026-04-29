<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';

/**
 * Decorative world-dot map + peer-pulse animation.
 *
 * Visual tribute to nimiq/web-miner. The old miner did real PoW + showed
 * actual peer connections; this is purely decorative — pulses fire on a
 * timer to suggest network activity. The faucet claim itself is a plain
 * HTTP POST handled by `useClaim()` — none of this code path produces
 * cryptographic work.
 *
 * Implementation: canvas with a coarse dot grid clipped (loosely) to a
 * stylised continents bitmap. Every ~600 ms a few "peer" dots get a
 * pulse animation (radial expand + fade); independently, occasional
 * peer-to-peer lines fade in/out between random pairs.
 */

const canvas = ref<HTMLCanvasElement | null>(null);

// Coarse 60-col × 24-row continents bitmap. 1 = land, 0 = sea. This is a
// stylised silhouette — not geographically accurate, just enough to read
// as "world map" at a glance. A nicer-looking version is a future polish.
const LAND_BITMAP: ReadonlyArray<string> = [
  '............................................................',
  '..........###........................##........#####.......',
  '........######.....#######........#######......######......',
  '.......#########..##########.....#########....#########....',
  '......##############################...####...##########...',
  '.....##########################........###...############..',
  '....##########################...........#...##############',
  '....########################..............#..##############',
  '....#####################...................##############.',
  '....##################...................#################.',
  '.....################......................##############..',
  '......##############......................################.',
  '.......#############.......................##############..',
  '........############........................############...',
  '.........###########..........................##########...',
  '..........#########............................########....',
  '...........#######...............................######....',
  '...........######..................................####....',
  '............####.....................................##....',
  '.............###..............................#.....##.....',
  '.............##..............................##....##......',
  '..............#.............................###....#.......',
  '..............##............................##.............',
  '...............#.............................#.............',
];

interface Peer {
  // Grid coords (col, row) of an active land dot.
  col: number;
  row: number;
  // Active = currently pulsing; resets after the animation duration.
  pulseStartedAt: number | null;
}

interface Link {
  from: Peer;
  to: Peer;
  startedAt: number;
}

const PULSE_DURATION_MS = 1_400;
const LINK_DURATION_MS = 2_400;
const PULSE_SPAWN_INTERVAL_MS = 700;
const LINK_SPAWN_INTERVAL_MS = 1_900;
const ACTIVE_PEER_COUNT = 14;

let rafId = 0;
let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  const c = canvas.value;
  if (!c) return;
  const ctx = c.getContext('2d');
  if (!ctx) return;

  // Hand-pick `ACTIVE_PEER_COUNT` random land dots as our "peers".
  const landDots: { col: number; row: number }[] = [];
  for (let row = 0; row < LAND_BITMAP.length; row++) {
    const line = LAND_BITMAP[row];
    if (!line) continue;
    for (let col = 0; col < line.length; col++) {
      if (line[col] === '#') landDots.push({ col, row });
    }
  }

  const peers: Peer[] = [];
  // Use a deterministic shuffle to keep the visual stable across hot reloads.
  const shuffled = [...landDots].sort((a, b) => (a.col * 31 + a.row * 7) - (b.col * 31 + b.row * 7));
  const stride = Math.max(1, Math.floor(shuffled.length / ACTIVE_PEER_COUNT));
  for (let i = 0; i < ACTIVE_PEER_COUNT && i * stride < shuffled.length; i++) {
    const dot = shuffled[i * stride];
    if (!dot) continue;
    peers.push({ col: dot.col, row: dot.row, pulseStartedAt: null });
  }

  const links: Link[] = [];

  let lastPulseAt = 0;
  let lastLinkAt = 0;

  function resize() {
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = Math.floor(rect.width * dpr);
    c.height = Math.floor(rect.height * dpr);
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(c);

  function tick(t: number) {
    if (!c || !ctx) return;
    const w = c.clientWidth;
    const h = c.clientHeight;

    // Cell sizing: fit the bitmap inside the canvas with some padding.
    const cols = LAND_BITMAP[0]?.length ?? 60;
    const rows = LAND_BITMAP.length;
    const cell = Math.min(w / (cols + 2), h / (rows + 2));
    const dotR = Math.max(1.2, cell * 0.22);
    const offsetX = (w - cols * cell) / 2;
    const offsetY = (h - rows * cell) / 2;

    ctx.clearRect(0, 0, w, h);

    // Dots — sea is faint, land is brighter. Peers are gold.
    for (let row = 0; row < rows; row++) {
      const line = LAND_BITMAP[row];
      if (!line) continue;
      for (let col = 0; col < cols; col++) {
        const isLand = line[col] === '#';
        const cx = offsetX + (col + 0.5) * cell;
        const cy = offsetY + (row + 0.5) * cell;
        ctx.beginPath();
        ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
        ctx.fillStyle = isLand ? 'rgba(245, 246, 250, 0.42)' : 'rgba(158, 163, 199, 0.10)';
        ctx.fill();
      }
    }

    // Spawn pulses at intervals.
    if (t - lastPulseAt > PULSE_SPAWN_INTERVAL_MS) {
      const idx = Math.floor(Math.random() * peers.length);
      const peer = peers[idx];
      if (peer) peer.pulseStartedAt = t;
      lastPulseAt = t;
    }

    // Draw peer dots (gold) + ongoing pulses.
    for (const peer of peers) {
      const cx = offsetX + (peer.col + 0.5) * cell;
      const cy = offsetY + (peer.row + 0.5) * cell;
      ctx.beginPath();
      ctx.arc(cx, cy, dotR * 1.4, 0, Math.PI * 2);
      ctx.fillStyle = '#F6AE2D';
      ctx.fill();

      if (peer.pulseStartedAt !== null) {
        const age = t - peer.pulseStartedAt;
        if (age > PULSE_DURATION_MS) {
          peer.pulseStartedAt = null;
        } else {
          const p = age / PULSE_DURATION_MS;
          const r = dotR * 1.4 + p * cell * 4;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255, 177, 13, ${(1 - p) * 0.6})`;
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }
    }

    // Spawn p2p links occasionally.
    if (t - lastLinkAt > LINK_SPAWN_INTERVAL_MS && peers.length >= 2) {
      const a = peers[Math.floor(Math.random() * peers.length)];
      let b = peers[Math.floor(Math.random() * peers.length)];
      let attempts = 0;
      while (b === a && attempts < 5) {
        b = peers[Math.floor(Math.random() * peers.length)];
        attempts++;
      }
      if (a && b && a !== b) links.push({ from: a, to: b, startedAt: t });
      lastLinkAt = t;
    }

    // Draw + age-out links.
    for (let i = links.length - 1; i >= 0; i--) {
      const link = links[i];
      if (!link) continue;
      const age = t - link.startedAt;
      if (age > LINK_DURATION_MS) {
        links.splice(i, 1);
        continue;
      }
      const p = age / LINK_DURATION_MS;
      const alpha = p < 0.5 ? p * 2 * 0.55 : (1 - p) * 2 * 0.55;
      const ax = offsetX + (link.from.col + 0.5) * cell;
      const ay = offsetY + (link.from.row + 0.5) * cell;
      const bx = offsetX + (link.to.col + 0.5) * cell;
      const by = offsetY + (link.to.row + 0.5) * cell;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      // Slight quadratic bezier so lines don't look like a wireframe.
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2 - cell * 1.5;
      ctx.quadraticCurveTo(mx, my, bx, by);
      ctx.strokeStyle = `rgba(255, 177, 13, ${alpha})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);
});

onBeforeUnmount(() => {
  if (rafId) cancelAnimationFrame(rafId);
  resizeObserver?.disconnect();
});
</script>

<template>
  <div class="world-map">
    <canvas ref="canvas" />
  </div>
</template>

<style scoped>
.world-map {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
canvas {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
