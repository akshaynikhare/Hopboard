/**
 * Hopboard — live globe.
 *
 * A rotating wireframe globe with a marker on every country that currently has
 * a session, and a counter that says exactly what the relay says. Canvas 2D,
 * written here, no library and no CDN: the app has no build step and no
 * dependencies, and a marketing page is not the place to acquire the first one.
 *
 * WHAT IT SHOWS IS WHAT IS THERE.
 *
 *   - If the relay says two devices, it draws two devices. There is no floor,
 *     no "demo mode", no seeded traffic. A new product with three users looks
 *     like a new product with three users.
 *   - Motion is allowed to come from three places and no others: the globe
 *     turning, which is a property of the globe; your pointer, which is you;
 *     and a marker easing in or out, which happens when the relay's answer
 *     actually changed. Markers do not pulse, blink or travel between each
 *     other. Arcs in particular are absent on purpose — the relay reports
 *     per-country totals and nothing about who is paired with whom, so an arc
 *     from one country to another would be a drawing of something we do not
 *     know. That is the line: animation may show what changed, never invent
 *     what is happening.
 *   - When the endpoint is unreachable the numbers go back to "—" and the
 *     caption reads "sessions worldwide". No error state, no last-known number
 *     presented as current for longer than STALE_MS.
 *
 * PRIVACY. This is a GET and nothing else. No credentials, no referrer, no
 * body, no query string, no beacon on unload — there is nothing this page could
 * usefully tell the relay, and the relay's own response carries counts only:
 * no keys, no addresses, no content. See docs/PRD.md §7 for why the relay never
 * learns more than that in the first place.
 */

import { RELAY_HTTP_URL } from "../core/config.js";
import { LAND } from "./land.js";

/** Derived from the relay host so there is one host in the codebase, not two.
 *  wss:// → https://, and ws://127.0.0.1:8000 → http://127.0.0.1:8000 for local
 *  development, where a missing relay simply lands in the unavailable path. */
const STATS_URL = `${RELAY_HTTP_URL}/stats`;

const POLL_MS      = 30_000;    // the floor the endpoint asked for
const MAX_POLL_MS  = 300_000;   // backoff ceiling — it is a free tier
const TIMEOUT_MS   = 6_000;
const STALE_MS     = 120_000;   // after this, numbers are no longer "right now"
const DEG_PER_MS   = 0.006;     // one turn a minute

/**
 * Approximate country centroids, ISO-3166-1 alpha-2. Whole degrees: at 320
 * pixels across, a degree is under a pixel and a centroid is a fiction anyway.
 * Codes absent from this table are still counted in the totals — they simply
 * have nowhere to be drawn.
 */
const CENTROIDS = parseCentroids(`
AD 43 2    AE 24 54   AF 33 66   AG 17 -62  AI 18 -63  AL 41 20   AM 40 45
AO -12 18  AR -34 -64 AS -14 -170 AT 47 13  AU -25 134 AW 12 -70  AX 60 20
AZ 40 48   BA 44 18   BB 13 -59  BD 24 90   BE 51 5    BF 12 -2   BG 43 25
BH 26 51   BI -3 30   BJ 10 2    BL 18 -63  BM 32 -65  BN 5 115   BO -17 -64
BQ 12 -68  BR -10 -53 BS 24 -76  BT 27 90   BW -22 24  BY 53 28   BZ 17 -89
CA 58 -106 CD -3 23   CF 7 21    CG -1 15   CH 47 8    CI 8 -5    CK -21 -159
CL -35 -71 CM 6 12    CN 35 105  CO 4 -73   CR 10 -84  CU 22 -80  CV 16 -24
CW 12 -69  CY 35 33   CZ 50 15   DE 51 10   DJ 12 43   DK 56 10   DM 15 -61
DO 19 -70  DZ 28 3    EC -2 -78  EE 59 26   EG 27 30   EH 25 -13  ER 15 39
ES 40 -4   ET 8 39    FI 64 26   FJ -18 178 FM 7 158   FO 62 -7   FR 46 2
GA -1 12   GB 54 -2   GD 12 -62  GE 42 43   GF 4 -53   GG 49 -2   GH 8 -1
GI 36 -5   GL 72 -40  GM 13 -15  GN 10 -11  GP 16 -61  GQ 2 10    GR 39 22
GT 15 -90  GU 13 145  GW 12 -15  GY 5 -59   HK 22 114  HN 15 -87  HR 45 16
HT 19 -72  HU 47 20   ID -2 118  IE 53 -8   IL 31 35   IM 54 -4   IN 22 79
IQ 33 44   IR 32 53   IS 65 -18  IT 42 13   JE 49 -2   JM 18 -77  JO 31 36
JP 36 138  KE 1 38    KG 41 75   KH 13 105  KI 1 173   KM -12 44  KN 17 -63
KP 40 127  KR 36 128  KW 29 47   KY 19 -81  KZ 48 68   LA 18 105  LB 34 36
LC 14 -61  LI 47 9    LK 7 81    LR 6 -9    LS -29 28  LT 55 24   LU 50 6
LV 57 25   LY 27 17   MA 32 -6   MC 44 7    MD 47 29   ME 42 19   MF 18 -63
MG -19 47  MH 7 171   MK 42 22   ML 17 -4   MM 21 96   MN 46 105  MO 22 113
MP 15 145  MQ 15 -61  MR 20 -11  MS 17 -62  MT 36 14   MU -20 57  MV 3 73
MW -13 34  MX 23 -102 MY 4 102   MZ -18 35  NA -22 17  NC -21 165 NE 17 8
NG 9 8     NI 13 -85  NL 52 5    NO 62 10   NP 28 84   NR -1 167  NU -19 -169
NZ -41 174 OM 21 57   PA 9 -80   PE -10 -75 PF -17 -149 PG -6 145 PH 13 122
PK 30 70   PL 52 20   PM 47 -56  PR 18 -66  PS 32 35   PT 39 -8   PW 7 134
PY -23 -58 QA 25 51   RE -21 55  RO 46 25   RS 44 21   RU 61 90   RW -2 30
SA 24 45   SB -9 160  SC -5 55   SD 15 30   SE 62 15   SG 1 104   SI 46 15
SK 49 19   SL 8 -12   SM 44 12   SN 14 -14  SO 6 46    SR 4 -56   SS 7 30
ST 0 7     SV 14 -89  SX 18 -63  SY 35 38   SZ -26 31  TC 21 -71  TD 15 19
TG 8 1     TH 15 101  TJ 39 71   TK -9 -171 TL -9 126  TM 39 59   TN 34 9
TO -21 -175 TR 39 35  TT 11 -61  TV -8 178  TW 24 121  TZ -6 35   UA 49 32
UG 1 32    US 40 -98  UY -33 -56 UZ 41 64   VA 42 12   VC 13 -61  VE 8 -66
VG 18 -64  VI 18 -65  VN 16 108  VU -16 167 WF -13 -176 WS -14 -172 XK 42 21
YE 15 48   ZA -29 24  ZM -13 28  ZW -19 30
`);

function parseCentroids(src) {
  const parts = src.trim().split(/\s+/);
  const out = new Map();
  for (let i = 0; i + 2 < parts.length; i += 3) {
    out.set(parts[i], { lat: +parts[i + 1], lon: +parts[i + 2] });
  }
  return out;
}

/* ------------------------------------------------------------------ state */

const RAD = Math.PI / 180;
const TILT = -18 * RAD;          // north pole tipped toward the viewer

let canvas, ctx, size = 0, dpr = 1;
let spin = 0, last = 0, raf = 0;
let onScreen = false, mounted = false;

/* Rotation is a rate that eases rather than a flag that flips, so the globe
   slows to a stop under the pointer and picks back up when it leaves instead of
   jerking between the two. `fling` is what is left of a drag after you let go. */
let rate = 0, fling = 0;
let dragging = false, dragX = 0, hovering = false;

/* One entry per country the relay has mentioned recently. `a` is how far it has
   eased in (0 gone, 1 present) and `h` how far it is highlighted; both are
   targets chased over time, which is what makes a country appearing in the
   numbers a thing you can SEE happen rather than a value that was suddenly
   different the next time you looked. */
const marks = new Map();
let hover = null;                // country under the pointer, or from the list
let busiest = null;              // highlighted when nothing else is

let stats = null;                // last good payload
let statsAt = 0;                 // when it arrived
let attemptAt = 0;               // last request, success or not
let failures = 0;
let timer = 0;

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
const dark = window.matchMedia("(prefers-color-scheme: dark)");

let colour = {};
function readColours() {
  const s = getComputedStyle(document.documentElement);
  const v = (n, fallback) => (s.getPropertyValue(n).trim() || fallback);
  colour = {
    grid: v("--rule2", "#3c3c3c"),
    dim:  v("--dim", "#858585"),
    text: v("--text", "#cccccc"),
    mark: v("--ok", "#4ec9b0"),
    edge: v("--rule", "#2b2b2b"),
    blue: v("--blue", "#007acc"),
    panel: v("--panel", "#252526"),
  };
  colour.gridRGB = toRGB(colour.grid) || [90, 90, 90];
  colour.blueRGB = toRGB(colour.blue) || [0, 122, 204];
  colour.panelRGB = toRGB(colour.panel) || [37, 37, 38];
  colour.dimRGB = toRGB(colour.dim) || [133, 133, 133];
  colour.textRGB = toRGB(colour.text) || [204, 204, 204];
  colour.markRGB = toRGB(colour.mark) || [78, 201, 176];

  /**
   * The sphere's own three tones, mixed FROM the page's accent rather than
   * picked next to it — so the globe still belongs to this palette when the
   * accent is retuned, and a light theme gets a light planet for free.
   *
   *   lit   the sunward crescent, accent pulled toward the section's teal
   *   deep  the shaded limb and the terminator
   *   air   the halo outside the sphere
   */
  const dark = isDark();
  colour.litRGB = mix(colour.blueRGB, colour.markRGB, dark ? 0.34 : 0.22);
  colour.deepRGB = dark ? mix(colour.blueRGB, [10, 14, 44], 0.72) : mix(colour.blueRGB, [255, 255, 255], 0.55);
  colour.airRGB = mix(colour.blueRGB, colour.markRGB, dark ? 0.42 : 0.30);
  colour.dotStyles = buildDotStyles();
}

/** The stylesheet is the authority on the theme, not the media query: a forced
 *  theme or a future toggle changes the tokens, and everything here is derived
 *  from those. Read the page background and ask whether it is dark. */
function isDark() {
  const bg = toRGB(getComputedStyle(document.documentElement)
    .getPropertyValue("--bg").trim()) || [30, 30, 30];
  return bg[0] + bg[1] + bg[2] < 384;
}

const mix = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

/**
 * One ready-made fill per brightness step.
 *
 * A dot that is further from the light does not just fade — it cools, toward
 * the same grey the rest of the page uses for secondary text, while the lit
 * side warms toward the accent. Baking colour AND alpha into one style string
 * per step means the draw loop sets a fill eight times a frame instead of
 * touching globalAlpha a thousand times.
 *
 * --rule2 is deliberately NOT the dot colour: it is the page's component-edge
 * grey, three shades off the background, and a sphere drawn in it is invisible
 * at any alpha.
 */
function buildDotStyles() {
  const dark = isDark();
  // Land has to win against the ocean under it, and the ocean is now a real
  // blue. On a dark page that means the lit side goes almost white with a
  // breath of the section's teal in it; on a light page it goes the other way,
  // because "more visible" there means darker.
  const lit = dark
    ? mix([255, 255, 255], colour.markRGB, 0.20)
    : mix(colour.textRGB, colour.blueRGB, 0.34);
  const shade = dark
    ? mix(colour.dimRGB, colour.deepRGB, 0.58)
    : mix(colour.dimRGB, colour.blueRGB, 0.40);

  const out = [];
  for (let i = 0; i < BUCKETS; i++) {
    const t = (i + 0.5) / BUCKETS;
    out.push(rgba(mix(shade, lit, t), 0.24 + 0.76 * t));
  }
  return out;
}

/**
 * Hex → [r,g,b]. Canvas has no color-mix and no relative colour syntax, so the
 * gradients below have to be assembled by hand from whatever the stylesheet
 * says. The tokens are all hex; anything else returns null and the caller falls
 * back to a flat colour rather than drawing `rgba(NaN,…)`.
 */
function toRGB(css) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css || "");
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;

/* ------------------------------------------------------------------ mount */

export function mount() {
  if (mounted) return;
  canvas = document.getElementById("globe");
  if (!canvas || !canvas.getContext) return;
  ctx = canvas.getContext("2d");
  if (!ctx) return;
  mounted = true;

  readColours();
  resize();
  draw();
  bindPointer();
  canvas.style.cursor = "grab";

  window.addEventListener("resize", () => { resize(); draw(); }, { passive: true });
  dark.addEventListener?.("change", () => { readColours(); draw(); });
  reduced.addEventListener?.("change", () => { loop(); draw(); });
  document.addEventListener("visibilitychange", () => { loop(); schedule(); });

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(entries => {
      onScreen = entries[0].isIntersecting;
      loop();
      schedule();
    }, { rootMargin: "120px" }).observe(canvas);
  } else {
    onScreen = true;
    loop();
  }

  poll();
}

function resize() {
  const css = canvas.clientWidth || 300;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  size = css;
  canvas.width = Math.round(css * dpr);
  canvas.height = Math.round(css * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/* --------------------------------------------------------------- rotation */

/** The speed the globe should be turning at right now.
 *
 *  It stops under the pointer. Not as a trick — a label you are trying to read
 *  while the thing carrying it slides out from under you is a label you cannot
 *  read, and the countries are the point of the section. */
/** Whether a transition would actually be seen. Everything that eases checks
 *  this before easing, and jumps straight to its target when it is false. */
const canAnimate = () => onScreen && !document.hidden && !reduced.matches;

function wantRate() {
  if (!canAnimate() || dragging || hovering) return 0;
  return DEG_PER_MS;
}

/** Whether anything on screen is still moving. Nothing is: stop the loop.
 *  A globe that keeps a requestAnimationFrame alive to redraw an identical
 *  frame is a battery bug with a nice gradient on it. */
function busy() {
  if (wantRate() > 0 || dragging) return true;
  if (Math.abs(rate) > 1e-5 || Math.abs(fling) > 1e-4) return true;
  for (const m of marks.values()) {
    if (Math.abs(m.a - m.target) > 0.002 || Math.abs(m.h - m.hTarget) > 0.002) return true;
  }
  return false;
}

/** Put every transition straight to its conclusion. Used when there is nobody
 *  to watch it finish — the alternative is animating carefully off screen. */
function settle() {
  rate = 0;
  fling = 0;
  for (const [code, m] of marks) {
    if (m.target === 0) marks.delete(code);
    else m.a = 1;
    m.h = m.hTarget;
  }
}

function loop() {
  if (!canAnimate() && !dragging && !fling) settle();
  const go = busy();
  if (go && !raf) { last = 0; raf = requestAnimationFrame(tick); }
  if (!go && raf) { cancelAnimationFrame(raf); raf = 0; }
  if (!go) draw();
}

/** Frame-rate-independent approach: the fraction of the remaining distance to
 *  close in `dt` ms, given a time constant. Same easing on a 60 Hz laptop and a
 *  120 Hz phone. */
const ease = (dt, tau) => 1 - Math.exp(-dt / tau);

function tick(now) {
  const dt = last ? Math.min(now - last, 64) : 0;   // a backgrounded tab can hand us seconds
  last = now;

  if (dt) {
    rate += (wantRate() - rate) * ease(dt, 260);
    spin = (spin + rate * dt + fling * dt) % 360;
    fling *= Math.exp(-dt / 220);                   // what is left of a drag, decaying
    if (Math.abs(fling) < 1e-4) fling = 0;

    for (const [code, m] of marks) {
      m.a += (m.target - m.a) * ease(dt, 300);
      m.h += (m.hTarget - m.h) * ease(dt, 180);
      if (m.target === 0 && m.a < 0.004) marks.delete(code);
    }
  }

  draw();
  raf = busy() ? requestAnimationFrame(tick) : 0;
}

/* ---------------------------------------------------------------- drawing */

/** lat/lon → screen, with a flag for the hemisphere facing us. */
function project(lat, lon, r, cx, cy) {
  const la = lat * RAD;
  const lo = (lon + spin) * RAD;
  const x = Math.cos(la) * Math.sin(lo);
  const y0 = Math.sin(la);
  const z0 = Math.cos(la) * Math.cos(lo);
  const y = y0 * Math.cos(TILT) - z0 * Math.sin(TILT);
  const z = y0 * Math.sin(TILT) + z0 * Math.cos(TILT);
  return { x: cx + x * r, y: cy - y * r, z };
}

/* -------------------------------------------------------------- the field */

/**
 * The land mask, unpacked on first use.
 *
 * One bit per cell of a 240 × 120 equirectangular grid. Kept packed in the
 * source and expanded here rather than shipped as an array of coordinates: the
 * whole coastline of the world costs 4.8 kB this way, and this module is not
 * fetched at all until the section it lives in comes near the viewport.
 */
let MASK = null;
function mask() {
  if (MASK) return MASK;
  const bin = atob(LAND.bits);
  MASK = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) MASK[i] = bin.charCodeAt(i);
  return MASK;
}

function isLand(lat, lon) {
  const m = mask();
  const row = Math.min(LAND.h - 1, Math.max(0, ((90 - lat) / LAND.step) | 0));
  const col = Math.min(LAND.w - 1, ((((lon + 180) % 360) + 360) % 360) / LAND.step | 0);
  const bit = row * LAND.w + col;
  return (m[bit >> 3] >> (7 - (bit & 7))) & 1;
}

/**
 * The dots, built once: the continents, and nothing else.
 *
 * An earlier version drew a graticule over the whole sphere. It read as a mesh
 * ball — a thing with a grid on it — and a grid is not what anyone recognises.
 * Dots on land only, ocean left to the body wash underneath, and the shape
 * becomes Earth in the first frame, which is the whole reason the section has a
 * globe rather than a number.
 *
 * A dot with any ocean in the four cells around it is COAST, and coast is drawn
 * brighter. That single flag is what turns a scatter of dots into an outline:
 * the eye gets a continuous edge to follow round each landmass, and the fill
 * inside can then sit back without the shape falling apart.
 *
 * What is stored is unit-sphere trigonometry, not angles — rotating a point by
 * `spin` is then four multiplies and two adds instead of two sines and two
 * cosines. Across ~3,000 points at 60 frames a second that is the difference
 * between a rounding error and a measurable slice of the frame.
 */
/**
 * Dot spacing is chosen from the RADIUS, not fixed.
 *
 * A step that looks right on a 300px globe leaves 8px gaps on a 600px one, and
 * the continents come apart into confetti. So aim for a constant spacing in
 * PIXELS — the same visual density at any size — and quantise the result so a
 * window drag rebuilds the field a handful of times rather than every frame.
 *
 * The floor is the mask's own resolution: sampling finer than the source data
 * just draws the same cell twice and gives coastlines a staircase.
 */
const DOT_PX = 5.4;       // target gap between neighbouring dots
let FIELD = null;
let fieldStep = 0;

function stepFor(r) {
  const deg = (DOT_PX / Math.max(1, r)) * (180 / Math.PI);
  return Math.min(2.6, Math.max(LAND.step, Math.round(deg * 4) / 4));
}

function buildField(step) {
  fieldStep = step;
  const cosLa = [], sinLa = [], cosLon = [], sinLon = [], weight = [];
  for (let lat = -88; lat <= 88; lat += step) {
    const la = lat * RAD;
    const cla = Math.cos(la), sla = Math.sin(la);
    // Constant arc spacing: the closer to a pole, the fewer dots a ring needs to
    // look as dense as the equator.
    const count = Math.max(4, Math.round((360 / step) * cla));
    const gap = 360 / count;
    for (let i = 0; i < count; i++) {
      const lon = -180 + i * gap;
      if (!isLand(lat, lon)) continue;
      const coast =
        !isLand(lat + LAND.step, lon) || !isLand(lat - LAND.step, lon) ||
        !isLand(lat, lon + LAND.step) || !isLand(lat, lon - LAND.step);
      const lo = lon * RAD;
      cosLa.push(cla); sinLa.push(sla);
      cosLon.push(Math.cos(lo)); sinLon.push(Math.sin(lo));
      weight.push(coast ? 1.32 : 0.92);
    }
  }
  FIELD = {
    n: cosLa.length,
    cosLa: Float32Array.from(cosLa), sinLa: Float32Array.from(sinLa),
    cosLon: Float32Array.from(cosLon), sinLon: Float32Array.from(sinLon),
    weight: Float32Array.from(weight),
  };
}

/* A light, so the sphere has a lit side and a dark one. Front-left and a little
   above — the same direction the page's panel shadows imply. Unit length. */
const LX = -0.42, LY = 0.40, LZ = 0.82;

/* Alpha is quantised into buckets and each bucket drawn in one pass. Setting
   globalAlpha per dot costs a state change per dot; eight passes cost eight. */
const BUCKETS = 8;
const bucket = Array.from({ length: BUCKETS }, () => []);

function draw() {
  if (!ctx || !size) return;

  // 0.405 rather than a rounder number: a highlighted marker's halo reaches
  // about 36px past its centre, and at the limb that has to stay inside the
  // canvas or the glow gets a straight edge cut across it.
  const cx = size / 2, cy = size / 2, r = size * 0.405;

  const step = stepFor(r);
  if (!FIELD || step !== fieldStep) buildField(step);

  ctx.clearRect(0, 0, size, size);

  // ATMOSPHERE — outside the sphere, so the planet sits in something rather
  // than being pasted onto the page. It is the one part of this drawing that is
  // purely for effect, which is why it is kept to a thin band: a wide glow round
  // a small disc reads as a lens flare, not as air.
  const air = ctx.createRadialGradient(cx, cy, r * 0.94, cx, cy, r * 1.16);
  air.addColorStop(0, rgba(colour.airRGB, 0));
  air.addColorStop(0.38, rgba(colour.airRGB, 0.26));
  air.addColorStop(1, rgba(colour.airRGB, 0));
  ctx.fillStyle = air;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.16, 0, Math.PI * 2);
  ctx.fill();

  // OCEAN. With the dots on land only, this carries the entire surface between
  // the continents, so it is a real gradient and not a wash: a bright cyan-lit
  // crescent where the light is, falling through the accent blue to a deep
  // indigo at the terminator. Three stops, because two make a vignette and four
  // make a beach ball.
  const body = ctx.createRadialGradient(
    cx + LX * r * 0.6, cy - LY * r * 0.6, r * 0.04,
    cx, cy, r * 1.02);
  body.addColorStop(0, rgba(colour.litRGB, 0.42));
  body.addColorStop(0.45, rgba(colour.blueRGB, 0.30));
  body.addColorStop(1, rgba(colour.deepRGB, 0.36));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // The edge, so the object closes. A gradient rather than a flat hairline: a
  // rim brightest on the lit side reads as curvature, a uniform ring reads as a
  // sticker.
  const rim = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  rim.addColorStop(0, rgba(colour.litRGB, 0.75));
  rim.addColorStop(0.5, rgba(colour.blueRGB, 0.40));
  rim.addColorStop(1, rgba(colour.deepRGB, 0.30));
  ctx.strokeStyle = rim;
  ctx.lineWidth = Math.max(1, size / 420);
  ctx.beginPath();
  ctx.arc(cx, cy, r - 0.5, 0, Math.PI * 2);
  ctx.stroke();

  drawField(r, cx, cy);
  drawMarkers(r, cx, cy);
}

function drawField(r, cx, cy) {
  const f = FIELD;
  const sp = spin * RAD;
  const cs = Math.cos(sp), ss = Math.sin(sp);
  const ct = Math.cos(TILT), st = Math.sin(TILT);
  // Near-constant, because the SPACING is near-constant: stepFor() already
  // holds the gap between dots at roughly 5px whatever the sphere's size, so
  // scaling the dots as well would only close that gap back up.
  const base = size < 260 ? 1.7 : 2.3;
  const px = 1 / dpr;                       // one device pixel, in CSS units

  for (const b of bucket) b.length = 0;

  for (let i = 0; i < f.n; i++) {
    // Rotate about the pole, cheaply: sin/cos of (lon + spin) from the stored
    // sin/cos of lon.
    const sinLo = f.sinLon[i] * cs + f.cosLon[i] * ss;
    const cosLo = f.cosLon[i] * cs - f.sinLon[i] * ss;

    const x = f.cosLa[i] * sinLo;
    const y0 = f.sinLa[i];
    const z0 = f.cosLa[i] * cosLo;
    const y = y0 * ct - z0 * st;
    const z = y0 * st + z0 * ct;
    if (z <= 0.02) continue;                // the far side is not drawn at all

    // Two things dim a dot: facing away from the light, and lying near the limb
    // where the surface turns away from the viewer. The second is what stops
    // the sphere ending in a hard ring of dots.
    const lambert = Math.max(0, x * LX + y * LY + z * LZ);
    // The ambient floor matters: with none, the unlit side loses its dots
    // entirely and the globe reads as a crescent moon rather than a planet.
    const shade = Math.min(1, (0.44 + 0.56 * lambert) * (0.46 + 0.54 * z) * f.weight[i]);

    // Snapped to whole device pixels in both position and size: a 1.4px square
    // at a fractional offset is a grey smudge, and a thousand of them is fog.
    const s = Math.max(px, Math.round(base * (0.6 + 0.4 * z) * dpr) / dpr);
    const sx = Math.round((cx + x * r) * dpr) / dpr;
    const sy = Math.round((cy - y * r) * dpr) / dpr;

    const bi = Math.min(BUCKETS - 1, (shade * BUCKETS) | 0);
    bucket[bi].push(sx, sy, s);
  }

  for (let bi = 0; bi < BUCKETS; bi++) {
    const list = bucket[bi];
    if (!list.length) continue;
    ctx.fillStyle = colour.dotStyles[bi];
    for (let i = 0; i < list.length; i += 3) ctx.fillRect(list[i], list[i + 1], list[i + 2], list[i + 2]);
  }
}

/** Where every live marker currently is on screen. Rebuilt each frame and read
 *  back by the pointer code, so hit-testing agrees with what you can see rather
 *  than with a second, subtly different projection. */
let placed = [];

function drawMarkers(r, cx, cy) {
  placed = [];
  if (!marks.size) return;

  let max = 1;
  for (const m of marks.values()) if (m.n > max) max = m.n;
  const markRGB = colour.markRGB;
  const px = 1 / dpr;

  // Back to front, so a marker near the limb cannot paint over one in front of
  // it. Sorting by z is what stops the far side of the sphere bleeding through.
  const drawn = [];
  for (const m of marks.values()) {
    const p = project(m.lat, m.lon, r, cx, cy);
    if (p.z <= 0.02) continue;                       // round the back
    drawn.push({ m, p });
    placed.push({ code: m.code, x: p.x, y: p.y });
  }
  drawn.sort((a, b) => a.p.z - b.p.z);

  ctx.textBaseline = "middle";

  for (const { m, p } of drawn) {
    const { x, y, z } = p;
    // `a` scales the mark as it arrives and shrinks it away as it leaves; `h`
    // is how highlighted it is. Neither ever loops.
    const grow = m.a * m.a * (3 - 2 * m.a);          // smoothstep — no rubber-band
    const s = (4 + 3 * (max > 1 ? (m.n - 1) / (max - 1) : 0)) * (0.4 + 0.6 * grow) * (1 + 0.28 * m.h);
    const vis = grow * Math.min(1, z + 0.35);

    const halo = s * (3.6 + 1.6 * m.h);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, halo);
    glow.addColorStop(0, rgba(markRGB, 0.55 + 0.2 * m.h));
    glow.addColorStop(0.45, rgba(markRGB, 0.16));
    glow.addColorStop(1, rgba(markRGB, 0));
    ctx.globalAlpha = (0.5 + 0.3 * m.h) * vis;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, halo, 0, Math.PI * 2);
    ctx.fill();

    // A ring, not a pulse. It gives the mark a size the eye can judge against
    // its neighbours without implying that anything is happening.
    ctx.globalAlpha = (0.30 + 0.45 * m.h) * vis;
    ctx.strokeStyle = colour.mark;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, s * (1.75 + 0.5 * m.h), 0, Math.PI * 2);
    ctx.stroke();

    // The mark itself: square, like every other marker on the page, snapped to
    // the pixel grid so a 5px square is 5 crisp pixels and not 7 soft ones.
    ctx.globalAlpha = Math.min(1, 0.6 + z) * grow;
    ctx.fillStyle = colour.mark;
    ctx.fillRect(Math.round((x - s / 2) / px) * px, Math.round((y - s / 2) / px) * px, s, s);
  }

  // The label goes last and alone. Three captions over a rotating sphere is
  // three things to read and no way to know which matters; one, on whichever
  // country you are pointing at — or the busiest, when you are pointing at
  // nothing — is a readout.
  const lead = drawn.find(d => d.m.h > 0.02 && d.p.z > 0.06);
  if (lead && size >= 200) label(lead, r, cx, cy);

  ctx.globalAlpha = 1;
}

function label({ m, p }, r, cx, cy) {
  const text = `${m.code} · ${m.n} device${m.n === 1 ? "" : "s"}`;
  ctx.font = '600 11px "Cascadia Code",Consolas,"SF Mono",Menlo,monospace';
  const w = ctx.measureText(text).width;
  const h = 20;

  // Out along the radius, so the leader never crosses the globe on its way to
  // the plate, and flipped to the inside when the marker is near the right
  // edge. Then clamped to the canvas: a marker at the top would otherwise hang
  // its plate half outside, and half a label is worse than none.
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const ux = (p.x - cx) / r, uy = (p.y - cy) / r;
  const out = 16 + 10 * Math.abs(ux);
  const bw = w + 12;
  const flip = p.x + out + bw > size - 4;
  const bx = Math.round(clamp(flip ? p.x - out - bw : p.x + out, 2, size - bw - 2));
  const by = Math.round(clamp(p.y + uy * 14 - h / 2, 2, size - h - 2));

  // The leader ends on whichever side of the plate faces the marker, so it
  // stays a short connector instead of a line drawn across the label.
  ctx.globalAlpha = m.h * 0.8;
  ctx.strokeStyle = colour.mark;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(bx > p.x ? bx : bx + bw, by + h / 2);
  ctx.stroke();

  ctx.globalAlpha = m.h;
  ctx.fillStyle = rgba(colour.panelRGB, 0.94);
  ctx.fillRect(bx, by, bw, h);
  ctx.strokeStyle = rgba(colour.gridRGB, 0.9);
  ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, h - 1);

  ctx.fillStyle = colour.text;
  ctx.fillText(text, bx + 6, by + h / 2 + 0.5);
}

/* ------------------------------------------------- markers and highlighting */

/**
 * Fold the relay's latest answer into the marker set.
 *
 * Markers are not rebuilt from scratch each poll, they are RECONCILED: a
 * country that is still there keeps its identity and just updates its count, a
 * new one starts at zero and eases in, and one that has gone is left in place
 * with a target of zero so it can ease out and then be dropped. That is the
 * only reason any of this animates — something in the numbers changed.
 */
function syncMarks() {
  const live = fresh() && stats ? stats.countries : null;
  const seen = new Set();
  // Only animate the arrival if there is someone to watch it. Off screen, in a
  // hidden tab, or with reduced motion asked for, a marker is simply THERE.
  // Visibility must never be something a frame has to deliver: a browser
  // throttling rAF would otherwise leave the globe permanently blank, which is
  // a far worse failure than a missing transition.
  const animate = canAnimate();

  if (live) {
    for (const [code, n] of live) {
      const c = CENTROIDS.get(code);
      if (!c) continue;                       // counted in the totals, nowhere to draw
      seen.add(code);
      const m = marks.get(code);
      if (m) { m.n = n; m.target = 1; if (!animate) m.a = 1; }
      else marks.set(code, {
        code, n, lat: c.lat, lon: c.lon,
        a: animate ? 0 : 1, target: 1, h: 0, hTarget: 0,
      });
    }
  }
  for (const [code, m] of marks) {
    if (seen.has(code)) continue;
    m.target = 0;
    if (!animate) marks.delete(code);         // nothing is coming to fade it out
  }

  busiest = null;
  let best = -1;
  for (const m of marks.values()) if (m.target === 1 && m.n > best) { best = m.n; busiest = m.code; }

  applyHighlight();
}

/** One country is highlighted at a time: whichever you are pointing at, or the
 *  busiest when you are pointing at nothing. The globe and the list below it
 *  are driven from the same value, so they can never disagree. */
function applyHighlight() {
  const want = hover && marks.has(hover) ? hover : busiest;
  const animate = canAnimate();
  for (const [code, m] of marks) {
    m.hTarget = code === want ? 1 : 0;
    if (!animate) m.h = m.hTarget;
  }
  const list = document.getElementById("countryList");
  if (list) for (const li of list.children) li.classList.toggle("on", li.dataset.code === want);
  loop();
}

function setHover(code) {
  if (code === hover) return;
  hover = code;
  applyHighlight();
}

/* --------------------------------------------------------------- the pointer */

/** Nearest marker to a point, within a comfortable finger's reach. Hit-testing
 *  reads the positions the last frame actually drew, so it can never disagree
 *  with what is on screen. */
function pick(x, y) {
  let code = null, best = 22 * 22;
  for (const p of placed) {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < best) { best = d; code = p.code; }
  }
  return code;
}

function bindPointer() {
  const at = e => {
    const b = canvas.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };
  /** Dragging the full diameter turns the globe half way round — the surface
   *  keeps up with the finger instead of sliding under it. */
  const degPerPx = () => 90 / Math.max(1, size * 0.405);   // matches draw()'s radius

  let moveAt = 0;

  canvas.addEventListener("pointerdown", e => {
    dragging = true;
    fling = 0;
    dragX = at(e).x;
    moveAt = e.timeStamp;
    canvas.setPointerCapture?.(e.pointerId);
    canvas.style.cursor = "grabbing";
    loop();
  });

  canvas.addEventListener("pointermove", e => {
    const { x, y } = at(e);
    if (dragging) {
      const deg = (x - dragX) * degPerPx();
      const dt = Math.max(8, e.timeStamp - moveAt);
      dragX = x;
      moveAt = e.timeStamp;
      spin = (spin + deg) % 360;
      fling = deg / dt;                       // carried on after release, and decayed
      draw();
      return;
    }
    // Hovering stops the rotation, so only a real pointer may do it — a tap on
    // a phone fires these too, and a globe that stopped for good after one tap
    // would look broken.
    if (e.pointerType === "mouse") {
      hovering = true;
      const code = pick(x, y);
      setHover(code);
      canvas.style.cursor = code ? "pointer" : "grab";
    }
  });

  const release = () => {
    if (!dragging) return;
    dragging = false;
    canvas.style.cursor = hovering ? "grab" : "";
    loop();
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  canvas.addEventListener("pointerenter", e => {
    if (e.pointerType !== "mouse") return;
    hovering = true;
    canvas.style.cursor = "grab";
    loop();
  });
  canvas.addEventListener("pointerleave", e => {
    if (e.pointerType !== "mouse") return;
    hovering = false;
    setHover(null);
    loop();
  });

  // The list under the readout is the same data in words. Pointing at a line
  // lights its country on the globe, and vice versa — one highlight, two views
  // of it. Delegated, because the list is rewritten on every poll.
  const list = document.getElementById("countryList");
  if (list) {
    list.addEventListener("pointerover", e => {
      const li = e.target.closest?.("li");
      if (li?.dataset.code) setHover(li.dataset.code);
    });
    list.addEventListener("pointerleave", () => setHover(null));
  }
}

/* ------------------------------------------------------------------ stats */

const fresh = () => stats !== null && Date.now() - statsAt < STALE_MS;

function schedule() {
  clearTimeout(timer);
  if (document.hidden) return;                     // nothing to show, no reason to ask
  const wait = Math.min(POLL_MS * Math.pow(2, failures), MAX_POLL_MS);
  const due = Math.max(POLL_MS, wait) - (Date.now() - attemptAt);
  timer = setTimeout(poll, Math.max(1000, due));
}

async function poll() {
  clearTimeout(timer);
  if (document.hidden) { schedule(); return; }
  if (Date.now() - attemptAt < POLL_MS) { schedule(); return; }   // the 30s floor
  attemptAt = Date.now();

  const abort = new AbortController();
  const cut = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    // A bare GET. No credentials, no referrer, no query string, no body:
    // there is nothing about this visitor the relay should learn.
    const res = await fetch(STATS_URL, {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: abort.signal,
    });
    if (!res.ok) throw new Error(String(res.status));   // 404 while it is being built
    const parsed = clean(await res.json());
    if (!parsed) throw new Error("shape");
    stats = parsed;
    statsAt = Date.now();
    failures = 0;
  } catch {
    // Unreachable, 404, CORS, malformed, or offline — all the same to the page.
    // Keep the last numbers only while they can still be called current.
    failures = Math.min(failures + 1, 4);
    if (!fresh()) stats = null;
  } finally {
    clearTimeout(cut);
  }
  render();
  draw();
  schedule();
}

/** Trust nothing: anything not a sane non-negative integer is dropped. */
function clean(raw) {
  if (!raw || typeof raw !== "object") return null;
  const num = v => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
  const countries = new Map();
  if (raw.countries && typeof raw.countries === "object") {
    for (const [code, n] of Object.entries(raw.countries)) {
      const c = String(code).toUpperCase();
      const v = num(n);
      if (/^[A-Z]{2}$/.test(c) && v) countries.set(c, v);
    }
  }
  const rooms = num(raw.rooms), devices = num(raw.devices);
  if (rooms === null && devices === null && !countries.size) return null;
  return { rooms, devices, countries };
}

/* ------------------------------------------------------------------ readout */

/**
 * How old the numbers are, said plainly.
 *
 * It matters because a failed poll does not immediately blank the readout — the
 * last figures stay up to STALE_MS. Saying "just now" over two-minute-old data
 * would be a small lie, and the point of this section is that it does not tell
 * them.
 */
function age(ms) {
  if (ms < 45_000) return "just now";
  if (ms < 90_000) return Math.round(ms / 1000) + "s ago";
  return Math.round(ms / 60_000) + " min ago";
}

function render() {
  const live = fresh() && stats;
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

  const rooms = live && stats.rooms !== null ? stats.rooms : null;
  const devices = live && stats.devices !== null ? stats.devices : null;
  const countries = live && stats.countries.size ? stats.countries.size : null;

  for (const [id, value] of [["statRooms", rooms], ["statDevices", devices], ["statCountries", countries]]) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.textContent = value === null ? "—" : String(value);
    el.classList.toggle("none", value === null);
  }

  // Lit only when the last request actually succeeded. Retained numbers still
  // show — with their age — but the indicator does not claim a live connection
  // it has not got.
  const dot = document.getElementById("liveDot");
  if (dot) dot.classList.toggle("on", !!live && failures === 0);

  // Wording, in order of what is true:
  //   no data          → the neutral caption, which claims nothing
  //   zero rooms       → say zero. It is a fair thing to know about a new tool.
  //   otherwise        → the count, as reported.
  let state = "Sessions worldwide";
  if (live && rooms === 0) state = "Nothing open right now — yours would be the first";
  else if (live) state = "Live · updated " + age(Date.now() - statsAt);
  set("liveStateText", state);

  const list = document.getElementById("countryList");
  if (list) {
    list.textContent = "";
    if (live) {
      for (const [code, n] of [...stats.countries.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
        const li = document.createElement("li");
        // The code is what ties a line to a marker: the delegated handler in
        // bindPointer() reads it, and applyHighlight() writes the class back.
        if (CENTROIDS.has(code)) li.dataset.code = code;
        const b = document.createElement("b");
        b.textContent = code;
        li.appendChild(b);
        li.appendChild(document.createTextNode(
          ` — ${n} device${n === 1 ? "" : "s"}${CENTROIDS.has(code) ? "" : " (not on the map)"}`));
        list.appendChild(li);
      }
    }
  }

  const cap = document.getElementById("globeCap");
  if (cap) {
    cap.textContent = live && countries
      ? `Active in ${[...stats.countries.keys()].slice(0, 4).join(", ")}${countries > 4 ? " and more" : ""}`
      : "Sessions worldwide";
  }
  if (canvas) {
    canvas.setAttribute("aria-label", live && countries
      ? `Globe marking active sessions in ${countries} ${countries === 1 ? "country" : "countries"}`
      : "Rotating globe. Live session counts are not available right now.");
  }

  // Last, because it reads the list this function just wrote.
  syncMarks();
}
