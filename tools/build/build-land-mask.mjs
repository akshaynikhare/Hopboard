/**
 * Builds src/landing/land.js — the land mask the globe draws its continents from.
 *
 * THIS IS NOT A BUILD STEP. The app ships exactly as it sits in the repository
 * and has no toolchain; this script is run by hand when the mask needs to
 * change, and its output is committed like any other source file. Nothing at
 * deploy time or test time invokes it.
 *
 *   node tools/build/build-land-mask.mjs
 *
 * Source data: Natural Earth 1:110m "land", which is public domain (no rights
 * reserved, no attribution required — the credit below is courtesy).
 * https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_land.geojson
 *
 * Output is a bit-per-cell equirectangular grid, packed eight cells to a byte
 * and base64'd: bit `row * W + col`, row 0 at +90° latitude, column 0 at -180°
 * longitude. At 1.5° that is 3,600 bytes — 4.8 kB of base64 — for a coastline
 * accurate enough that Italy, the Red Sea and the Gulf of California all
 * survive at the size this thing is actually drawn.
 */
import { readFileSync, writeFileSync } from "node:fs";

const SRC = process.argv[2] || "ne_110m_land.geojson";
const OUT = "src/landing/land.js";
/**
 * Degrees a side. Pick it against the size the globe is DRAWN at, not against
 * how much detail the source has: at a 600px sphere one degree is about four
 * pixels at the equator, so a finer grid buys nothing you could see and costs
 * bytes on the one page search engines fetch.
 */
const STEP = +(process.argv[3] || 1);
const W = Math.round(360 / STEP);
const H = Math.round(180 / STEP);

const gj = JSON.parse(readFileSync(SRC, "utf8"));

/** Every polygon, as an array of rings: outer first, then any holes. */
const polys = [];
for (const f of gj.features) {
  const g = f.geometry;
  if (!g) continue;
  if (g.type === "Polygon") polys.push(g.coordinates);
  else if (g.type === "MultiPolygon") for (const p of g.coordinates) polys.push(p);
}

/** Bounding boxes, so a cell only tests polygons that could possibly hold it.
 *  Without this the run is O(cells × every vertex on Earth) and takes minutes. */
const boxes = polys.map(rings => {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  for (const [x, y] of rings[0]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
});

/** Even-odd crossing count over EVERY ring of one polygon. Holes are wound the
 *  other way, so counting them flips the parity back — which is what a hole is. */
function inside(rings, px, py) {
  let odd = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) odd = !odd;
    }
  }
  return odd;
}

const bytes = new Uint8Array(Math.ceil((W * H) / 8));
let land = 0;
for (let row = 0; row < H; row++) {
  const lat = 90 - (row + 0.5) * STEP;
  for (let col = 0; col < W; col++) {
    const lon = -180 + (col + 0.5) * STEP;
    let hit = false;
    for (let p = 0; p < polys.length && !hit; p++) {
      const b = boxes[p];
      if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
      if (inside(polys[p], lon, lat)) hit = true;
    }
    if (hit) {
      const bit = row * W + col;
      bytes[bit >> 3] |= 128 >> (bit & 7);
      land++;
    }
  }
}

const b64 = Buffer.from(bytes).toString("base64");
const lines = b64.match(/.{1,96}/g).map(l => `  "${l}" +`).join("\n").replace(/ \+$/, "");

writeFileSync(OUT, `/**
 * RealtimeClipboard — the land mask the globe draws its continents from.
 *
 * GENERATED FILE. Do not hand-edit: run \`node tools/build/build-land-mask.mjs\`
 * against Natural Earth's 1:110m land polygons and commit what comes out. The
 * generator is not part of any build — this file ships as source, like
 * everything else here.
 *
 * A bit per cell of a ${W} × ${H} equirectangular grid (${STEP}° a side), packed
 * eight to a byte and base64'd. Bit \`row * ${W} + col\`; row 0 is +90° latitude,
 * column 0 is -180° longitude. ${land} of ${W * H} cells are land (${((land / (W * H)) * 100).toFixed(1)}%).
 *
 * Natural Earth is public domain. https://www.naturalearthdata.com/
 */

export const LAND = {
  w: ${W},
  h: ${H},
  step: ${STEP},
  bits:
${lines},
};
`);

console.log(`${OUT}: ${W}x${H}, ${land} land cells, ${b64.length} base64 chars`);
