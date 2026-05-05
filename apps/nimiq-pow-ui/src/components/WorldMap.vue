<script setup lang="ts">
/**
 * Decorative hex-tessellated world map.
 *
 * Tessellates the world into a pointy-top hex grid; each cell tests its
 * (lng, lat) center against the continent polygons in `lib/landmask.ts`
 * and renders as a hexagon if it falls on land. The set of land hex
 * cells is stable across renders (the bitmap is static), so a future
 * feature can light up specific cells by lat/lng — point a
 * `pulse({lat, lng})` helper at the nearest cell and animate. For now
 * the map is purely decorative.
 */
import { computed } from 'vue';
import { isLand } from '../lib/landmask';

// Density tuned to match the Nimiq wallet's network-tab map: smaller
// individual hexes packed denser. The bitmap underneath is 360×170 at
// 1° resolution, so 160×70 hex sampling (~2.25° lng × ~1.86° lat per
// cell) is well within the bitmap's resolution limit. Row count tuned
// so the SVG's intrinsic aspect (~2.63:1) is closer to the viewport's
// (~2:1) — less empty vertical space between map and action strip.
const COLS = 160;
// Trimmed lat range so we don't render empty south-polar rows below
// the lowest land (Patagonia tip ~-54°). The bitmap data underneath
// runs to -85, but those rows are all sea and would only add empty
// vertical space between the map and the address-input strip.
const ROWS = 70;
const LNG_MIN = -180;
const LNG_MAX = 180;
const LAT_MAX = 75;
const LAT_MIN = -55;

// Pointy-top hex geometry. We separate two radii:
//   • CELL_R drives the grid pitch (column/row spacing)
//   • HEX_R is the rendered hex's circumradius, smaller than CELL_R so
//     each hex has visible breathing room around it. The ratio (0.65)
//     keeps the hexagon shape readable at typical render sizes while
//     leaving a clear gap between cells. Smaller ratios make the hex
//     look like a circle (anti-aliasing rounds the corners under ~5px);
//     larger ratios merge into a flush honeycomb.
const CELL_R = 7;
const HEX_R = CELL_R * 0.78;
const SQRT3 = Math.sqrt(3);
const CELL_W = CELL_R * SQRT3;       // column pitch (full hex width @ CELL_R)
const ROW_PITCH = CELL_R * 1.5;      // row pitch
const HEX_W = HEX_R * SQRT3;         // rendered hex width (smaller than CELL_W)

const VIEW_W = COLS * CELL_W + CELL_W / 2; // +half for the staggered odd rows
const VIEW_H = (ROWS - 1) * ROW_PITCH + HEX_R * 2;

interface HexCell {
  /** SVG `points` string for the hexagon polygon (6 vertices). */
  points: string;
}

/**
 * Build the SVG `points` string for a pointy-top hex centered at (cx, cy).
 * Pointy-top vertices, starting at top and going clockwise:
 *   (cx, cy - R)
 *   (cx + HEX_W/2, cy - R/2)
 *   (cx + HEX_W/2, cy + R/2)
 *   (cx, cy + R)
 *   (cx - HEX_W/2, cy + R/2)
 *   (cx - HEX_W/2, cy - R/2)
 */
function hexPoints(cx: number, cy: number): string {
  const halfW = HEX_W / 2;
  const halfR = HEX_R / 2;
  const verts: ReadonlyArray<readonly [number, number]> = [
    [cx, cy - HEX_R],
    [cx + halfW, cy - halfR],
    [cx + halfW, cy + halfR],
    [cx, cy + HEX_R],
    [cx - halfW, cy + halfR],
    [cx - halfW, cy - halfR],
  ];
  return verts.map((v) => `${v[0].toFixed(2)},${v[1].toFixed(2)}`).join(' ');
}

/**
 * Pre-computed once. Each entry is the SVG points string for a land
 * hex cell.
 */
const cells = computed<HexCell[]>(() => {
  const result: HexCell[] = [];
  for (let row = 0; row < ROWS; row++) {
    // Odd rows shift right by half a cell-width (pointy-top staggered packing).
    const offsetX = (row % 2) * (CELL_W / 2);
    const cy = HEX_R + row * ROW_PITCH;
    for (let col = 0; col < COLS; col++) {
      const cx = CELL_W / 2 + col * CELL_W + offsetX;
      // Map cell center to (lng, lat); flip lat so row 0 is north.
      const lng = LNG_MIN + (cx / VIEW_W) * (LNG_MAX - LNG_MIN);
      const lat = LAT_MAX - (cy / VIEW_H) * (LAT_MAX - LAT_MIN);
      if (isLand(lng, lat)) {
        result.push({ points: hexPoints(cx, cy) });
      }
    }
  }
  return result;
});
</script>

<template>
  <svg
    class="world-map"
    :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`"
    preserveAspectRatio="xMidYMid meet"
    aria-hidden="true"
  >
    <polygon
      v-for="(c, i) in cells"
      :key="i"
      :points="c.points"
      class="hex"
    />
  </svg>
</template>

<style scoped>
.world-map {
  display: block;
  width: 100%;
  height: 100%;
}

.hex {
  /* Each hex is now visibly separated from its neighbours; no stroke
     needed (a stroke would soften the gap by tinting the gutter). */
  fill: rgba(245, 246, 250, 0.22);
}
</style>
