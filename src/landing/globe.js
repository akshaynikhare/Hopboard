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

import { RELAY_URL } from "../core/config.js";

/** Derived from the relay host so there is one host in the codebase, not two.
 *  wss:// → https://, and ws://127.0.0.1:8000 → http://127.0.0.1:8000 for local
 *  development, where a missing relay simply lands in the unavailable path. */
const STATS_URL = RELAY_URL.replace(/^ws/i, "http") + "/stats";

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
  };
}

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

function draw() {
  if (!ctx || !size) return;
  const cx = size / 2, cy = size / 2, r = size * 0.42;

  ctx.clearRect(0, 0, size, size);

  // The edge of the sphere, so the wireframe reads as a solid object.
  ctx.strokeStyle = colour.edge;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // Graticule as small squares — the same mark as the bullets on the page.
  // Front hemisphere only: a wireframe you can see through reads as a mesh
  // ball, not a planet.
  ctx.fillStyle = colour.grid;
  const dot = size < 240 ? 1 : 1.3;
  for (let lat = -75; lat <= 75; lat += 15) {
    const step = 6 / Math.max(0.25, Math.cos(lat * RAD));   // even spacing near the poles
    for (let lon = 0; lon < 360; lon += step) {
      const p = project(lat, lon, r, cx, cy);
      if (p.z <= 0) continue;
      ctx.globalAlpha = 0.18 + 0.5 * p.z;
      ctx.fillRect(p.x, p.y, dot, dot);
    }
  }
  for (let lon = 0; lon < 360; lon += 15) {
    for (let lat = -84; lat <= 84; lat += 6) {
      const p = project(lat, lon, r, cx, cy);
      if (p.z <= 0) continue;
      ctx.globalAlpha = 0.14 + 0.4 * p.z;
      ctx.fillRect(p.x, p.y, dot, dot);
    }
  }
  ctx.globalAlpha = 1;

  drawMarkers(r, cx, cy);
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

  for (const [code, n] of entries) {
    const c = CENTROIDS.get(code);
    const p = project(c.lat, c.lon, r, cx, cy);
    if (p.z <= 0.02) continue;                       // round the back

    const s = 4 + 3 * (max > 1 ? (n - 1) / (max - 1) : 0);
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, s * 3.4);
    glow.addColorStop(0, colour.mark);
    glow.addColorStop(1, "transparent");
    ctx.globalAlpha = 0.28 * Math.min(1, p.z + 0.35);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y, s * 3.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = Math.min(1, 0.55 + p.z);
    ctx.fillStyle = colour.mark;
    ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);

    if (labelled.includes(code) && p.z > 0.25) {
      ctx.globalAlpha = Math.min(1, 0.4 + p.z);
      ctx.fillStyle = colour.text;
      ctx.font = '10px "Cascadia Code",Consolas,"SF Mono",Menlo,monospace';
      ctx.textBaseline = "middle";
      ctx.fillText(code + " " + n, p.x + s / 2 + 6, p.y);
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
