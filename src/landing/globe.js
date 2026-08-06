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
 *   - The only motion is the globe turning, which is a property of the globe
 *     and not a claim about usage. Markers do not pulse, blink or travel,
 *     because that reads as activity and would be an invention.
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

function loop() {
  const want = onScreen && !document.hidden && !reduced.matches;
  if (want && !raf) { last = 0; raf = requestAnimationFrame(tick); }
  if (!want && raf) { cancelAnimationFrame(raf); raf = 0; }
}

function tick(now) {
  if (last) spin = (spin + (now - last) * DEG_PER_MS) % 360;
  last = now;
  draw();
  raf = requestAnimationFrame(tick);
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
 * The dots, built once.
 *
 * Parallels only — no meridians. Two crossing sets of lines make a mesh ball;
 * one set of rings, spaced so the gap between dots is the same arc length
 * everywhere, makes a sphere with a surface. Rotation still reads clearly,
 * because projection bunches the dots toward the limb and that bunching travels.
 *
 * What is stored is the unit-sphere trigonometry, not the angles: rotating a
 * point by `spin` is then four multiplies and two adds instead of two sines and
 * two cosines. At ~1000 points and 60 frames a second that is the difference
 * between a rounding error and a measurable slice of the frame.
 */
const RING_STEP = 9;      // degrees between parallels
const ARC_STEP  = 4.5;    // degrees between dots along the equator
let FIELD = null;

function buildField() {
  const cosLa = [], sinLa = [], cosLon = [], sinLon = [], weight = [];
  for (let lat = -81; lat <= 81; lat += RING_STEP) {
    const la = lat * RAD;
    const cla = Math.cos(la), sla = Math.sin(la);
    // Constant arc spacing: the closer to a pole, the fewer dots the ring needs
    // to look as dense as the equator.
    const count = Math.max(6, Math.round((360 / ARC_STEP) * cla));
    const step = 360 / count;
    // The equator carries a touch more weight — one ring the eye can follow is
    // what tells you which way the thing is turning.
    const w = Math.abs(lat) < 1 ? 1.25 : 1;
    for (let i = 0; i < count; i++) {
      const lo = i * step * RAD;
      cosLa.push(cla); sinLa.push(sla);
      cosLon.push(Math.cos(lo)); sinLon.push(Math.sin(lo));
      weight.push(w);
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
  if (!FIELD) buildField();

  const cx = size / 2, cy = size / 2, r = size * 0.42;
  ctx.clearRect(0, 0, size, size);

  // Volume before detail: a wash inside the sphere, brightest where the light
  // is, so the dots sit ON something instead of floating in a disc-shaped hole.
  const body = ctx.createRadialGradient(
    cx + LX * r * 0.55, cy - LY * r * 0.55, r * 0.05,
    cx, cy, r);
  body.addColorStop(0, rgba(colour.blueRGB, 0.13));
  body.addColorStop(0.62, rgba(colour.blueRGB, 0.045));
  body.addColorStop(1, rgba(colour.gridRGB, 0.0));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // The edge, so the object closes. Drawn as a gradient rather than a flat
  // hairline: a rim that is brightest on the lit side reads as curvature, and a
  // uniform ring reads as a sticker.
  const rim = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  rim.addColorStop(0, rgba(colour.blueRGB, 0.55));
  rim.addColorStop(0.5, rgba(colour.gridRGB, 0.45));
  rim.addColorStop(1, rgba(colour.gridRGB, 0.16));
  ctx.strokeStyle = rim;
  ctx.lineWidth = 1;
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
  const base = size < 220 ? 1 : size < 300 ? 1.2 : 1.5;
  const px = 1 / dpr;                       // snap to the device pixel grid

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
    const shade = (0.30 + 0.70 * lambert) * (0.35 + 0.65 * z) * f.weight[i];
    const a = Math.min(1, 0.10 + 0.72 * shade);

    const s = base * (0.62 + 0.38 * z);
    const sx = Math.round((cx + x * r) / px) * px;
    const sy = Math.round((cy - y * r) / px) * px;

    const bi = Math.min(BUCKETS - 1, (a * BUCKETS) | 0);
    bucket[bi].push(sx, sy, s);
  }

  ctx.fillStyle = colour.grid;
  for (let bi = 0; bi < BUCKETS; bi++) {
    const list = bucket[bi];
    if (!list.length) continue;
    ctx.globalAlpha = (bi + 0.5) / BUCKETS;
    for (let i = 0; i < list.length; i += 3) ctx.fillRect(list[i], list[i + 1], list[i + 2], list[i + 2]);
  }
  ctx.globalAlpha = 1;
}

function drawMarkers(r, cx, cy) {
  const counts = fresh() && stats ? stats.countries : null;
  if (!counts) return;

  const entries = [...counts.entries()]
    .filter(([code]) => CENTROIDS.has(code))
    .sort((a, b) => b[1] - a[1]);
  if (!entries.length) return;

  const max = entries[0][1];
  const labelled = size >= 220 ? entries.slice(0, 3).map(e => e[0]) : [];
  const markRGB = toRGB(colour.mark) || [78, 201, 176];

  // Back to front, so a marker near the limb cannot paint over one in front of
  // it. Sorting by z is what stops the far side of the sphere bleeding through.
  const drawn = [];
  for (const [code, n] of entries) {
    const c = CENTROIDS.get(code);
    const p = project(c.lat, c.lon, r, cx, cy);
    if (p.z <= 0.02) continue;                       // round the back
    drawn.push({ code, n, p });
  }
  drawn.sort((a, b) => a.p.z - b.p.z);

  ctx.textBaseline = "middle";

  for (const { code, n, p } of drawn) {
    const { x, y, z } = p;
    const s = 4 + 3 * (max > 1 ? (n - 1) / (max - 1) : 0);

    // A halo, sized with the marker. It is the one thing on the globe allowed
    // to be brighter than the surface, because it is the only thing on the
    // globe that is a fact about someone.
    const halo = s * 3.6;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, halo);
    glow.addColorStop(0, rgba(markRGB, 0.55));
    glow.addColorStop(0.45, rgba(markRGB, 0.16));
    glow.addColorStop(1, rgba(markRGB, 0));
    ctx.globalAlpha = 0.5 * Math.min(1, z + 0.4);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, halo, 0, Math.PI * 2);
    ctx.fill();

    // A ring around the square, not a pulse. It gives the mark a size the eye
    // can judge against its neighbours without implying anything is happening.
    ctx.globalAlpha = 0.30 * Math.min(1, z + 0.3);
    ctx.strokeStyle = colour.mark;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, s * 1.75, 0, Math.PI * 2);
    ctx.stroke();

    // The mark itself: square, like every other marker on the page, snapped to
    // the pixel grid so a 5px square is 5 crisp pixels and not 7 soft ones.
    const px = 1 / dpr;
    const mx = Math.round((x - s / 2) / px) * px;
    const my = Math.round((y - s / 2) / px) * px;
    ctx.globalAlpha = Math.min(1, 0.6 + z);
    ctx.fillStyle = colour.mark;
    ctx.fillRect(mx, my, s, s);

    if (labelled.includes(code) && z > 0.25) {
      const text = code + " " + n;
      ctx.font = '600 10.5px "Cascadia Code",Consolas,"SF Mono",Menlo,monospace';
      const w = ctx.measureText(text).width;
      const lx = x + s / 2 + 7, ly = y;

      // A plate behind the label. Over a field of dots, unbacked 10px type is
      // the first thing to become unreadable.
      ctx.globalAlpha = 0.72 * Math.min(1, z + 0.35);
      ctx.fillStyle = rgba(colour.panelRGB, 0.92);
      ctx.fillRect(lx - 4, ly - 8, w + 8, 16);

      ctx.globalAlpha = Math.min(1, 0.45 + z);
      ctx.fillStyle = colour.text;
      ctx.fillText(text, lx, ly + 0.5);
    }
  }
  ctx.globalAlpha = 1;
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
}
