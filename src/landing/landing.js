/**
 * Hopboard — landing page behaviour.
 *
 * Three jobs, none of which may block first paint:
 *
 *   1. Put a real, freshly generated key in the hero the moment the page loads,
 *      and keep the primary button pointed at whatever key is on screen.
 *   2. Run the dotted path: a pill that travels from the machine that copied to
 *      the machine that pastes, labelled with what actually happens at each step.
 *   3. Load the globe only when the section it lives in comes near the viewport.
 *
 * Key generation is IMPORTED from the app rather than reimplemented. The
 * alphabet and length are product decisions (PRD FR-1.2, D3) and a second copy
 * of them here is a copy that can drift — a landing page quietly handing out
 * keys from the wrong alphabet is the kind of bug nobody notices for months.
 */

import { generate, normalise } from "../core/keys.js";

const byId = id => document.getElementById(id);
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

/**
 * Each feature is started separately and its failure is contained.
 *
 * The app learned this the expensive way (see tests/boot.mjs): one unguarded
 * throw during start-up took out everything after it, and the only symptom was
 * a feature quietly not working. Here it would mean an SVG API missing on some
 * browser stopping the key generator from ever running — the one thing on this
 * page that has to work.
 */
function start(name, fn) {
  try { fn(); } catch (err) { console.warn(`[landing] ${name} not started:`, err); }
}

/* ================================================================= the key */

start("key", function key() {
  const input = byId("key");
  const form  = byId("keyForm");
  const regen = byId("regen");
  const status = byId("keyStatus");
  const buttons = [byId("start"), byId("start2")].filter(Boolean);
  if (!input || !form) return;

  /**
   * The buttons are plain anchors and stay plain anchors: their href tracks the
   * field, so middle-click, ⌘-click, "copy link address" and a browser with
   * JavaScript disabled all behave. Only the Enter key needs intercepting.
   */
  const sync = () => {
    const k = normalise(input.value);
    const href = k ? "./app.html#" + k : "./app.html";
    for (const b of buttons) b.href = href;
  };

  const fresh = (announce) => {
    const k = generate();
    input.value = k;
    sync();
    // The value of an <input> changing is silent to a screen reader, and the
    // key is the one thing on this page you are meant to read out.
    if (announce && status) status.textContent = "New key: " + k.split("").join(" ");
  };

  input.addEventListener("input", sync);
  // Normalise on the way out rather than on every keystroke: rewriting the
  // value mid-word drops the caret to the end on every browser.
  input.addEventListener("change", () => { input.value = normalise(input.value); sync(); });
  input.addEventListener("focus", () => input.select());

  regen?.addEventListener("click", () => { fresh(true); input.focus(); });

  form.addEventListener("submit", e => {
    e.preventDefault();
    const k = normalise(input.value);
    if (k.length < 4) { input.focus(); return; }   // keys.isValid() floor
    location.href = "./app.html#" + k;
  });

  fresh(false);
});

/* ========================================================== the dotted path */

/**
 * Two layouts, not one stretched one. `preserveAspectRatio` would squash a
 * 1200-wide path into 44px of height on a phone; instead the geometry itself
 * changes and the path runs top-to-bottom below 620px, which is also the
 * breakpoint where the page drops to a single column.
 */
const LAYOUTS = {
  wide: {
    vb: "0 0 1200 360",
    text:  "M120 180 C 300 180 372 76 600 76 C 828 76 900 180 1080 180",
    files: "M120 204 C 400 350 800 350 1080 204",
    filesLabel: { x: 600, y: 314, place: "below" },   // the low point of that curve
    nodes: [
      { x: 120,  y: 180, kind: "end",   name: "Your laptop",  sub: "copies",           place: "below" },
      { x: 600,  y: 76,  kind: "relay", name: "Relay",        sub: "ciphertext only",  place: "above" },
      { x: 1080, y: 180, kind: "end",   name: "Your desktop", sub: "pastes",           place: "below" },
    ],
  },
  tall: {
    vb: "0 0 420 660",
    text:  "M92 70 C 92 190 328 200 328 330 C 328 460 92 470 92 590",
    files: "M64 92 C 8 300 8 360 64 568",
    // Under the diagram rather than beside the curve: at 360px there is not
    // enough width for a caption next to the relay's own label without the two
    // colliding.
    filesLabel: { x: 210, y: 645, place: "mid" },
    nodes: [
      { x: 92,  y: 70,  kind: "end",   name: "Your laptop",  sub: "copies",          place: "right" },
      { x: 328, y: 330, kind: "relay", name: "Relay",        sub: "ciphertext only", place: "left"  },
      { x: 92,  y: 590, kind: "end",   name: "Your desktop", sub: "pastes",          place: "right" },
    ],
  },
};

/** What the product is doing at each point along the path, as a fraction of it. */
const STEPS = [
  { at: 0.00, text: "Copying…" },
  { at: 0.13, text: "Encrypting in your browser…" },
  { at: 0.38, text: "Ciphertext through the relay" },
  { at: 0.62, text: "Decrypting on your device…" },
  { at: 0.86, text: "Arriving on your desktop" },
];
const STILL = "Encrypted here, decrypted there";

const TRAVEL_MS = 11000;   // one end to the other
const HOLD_MS   = 1600;    // pause on arrival before it starts again

start("flow", function flow() {
  const stage  = byId("flowStage");
  const svg    = byId("flowSvg");
  const text   = byId("flowText");
  const files  = byId("flowFiles");
  const nodesG = byId("flowNodes");
  const labels = byId("flowLabels");
  const pill   = byId("flowPill");
  const pillText = byId("flowPillText");
  if (!stage || !svg || !text || !files || !nodesG || !labels || !pill || !pillText) return;

  const SVGNS = "http://www.w3.org/2000/svg";
  let layout = null, len = 0, metrics = null, raf = 0, started = 0, onScreen = false;

  const pick = () => (window.innerWidth <= 620 ? LAYOUTS.tall : LAYOUTS.wide);

  /** Path coordinates → pixels inside the stage.
   *  getScreenCTM() and the stage rect are both viewport-relative and read in
   *  the same breath, so their difference survives any amount of scrolling.
   *  Only a resize invalidates it. */
  function measure() {
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;                    // display:none, or not laid out yet
    const r = stage.getBoundingClientRect();
    return { ctm, ox: r.left, oy: r.top };
  }

  function toPx(x, y) {
    const p = new DOMPoint(x, y).matrixTransform(metrics.ctm);
    return { x: p.x - metrics.ox, y: p.y - metrics.oy };
  }

  const OFFSETS = {
    below: "translate(-50%, 14px)",
    above: "translate(-50%, calc(-100% - 14px))",
    right: "translate(20px, -50%)",
    left:  "translate(calc(-100% - 20px), -50%)",
    mid:   "translate(-50%, -50%)",
  };

  function build() {
    layout = pick();
    svg.setAttribute("viewBox", layout.vb);
    text.setAttribute("d", layout.text);
    files.setAttribute("d", layout.files);

    nodesG.textContent = "";
    labels.textContent = "";

    for (const n of layout.nodes) {
      // Squares, like the bullets. The relay is hollow because nothing of yours
      // stays in it.
      const box = document.createElementNS(SVGNS, "rect");
      const s = n.kind === "relay" ? 13 : 11;
      box.setAttribute("x", n.x - s / 2);
      box.setAttribute("y", n.y - s / 2);
      box.setAttribute("width", s);
      box.setAttribute("height", s);
      box.setAttribute("class", "fnode" + (n.kind === "relay" ? " relay" : ""));
      nodesG.appendChild(box);

      const el = document.createElement("div");
      el.className = "flabel";
      const b = document.createElement("b");
      b.textContent = n.name;
      el.appendChild(b);
      el.appendChild(document.createTextNode(n.sub));
      labels.appendChild(el);
      n.el = el;
    }

    const fl = document.createElement("div");
    fl.className = "flabel";
    fl.textContent = "files · straight between machines";
    labels.appendChild(fl);
    layout.filesLabel.el = fl;

    len = text.getTotalLength();
    position();
    // Only reveal the pill once it has somewhere real to be. If the stage is
    // not laid out yet (a background tab on some engines) getScreenCTM() returns
    // null, and an un-transformed pill would sit in the top-left corner. Try
    // once more on the next frame, by which point layout has certainly run.
    if (metrics) stage.dataset.ready = "1";
    else requestAnimationFrame(() => { position(); if (metrics) stage.dataset.ready = "1"; });
  }

  function position() {
    metrics = measure();
    if (!metrics) return;
    for (const n of layout.nodes) {
      const p = toPx(n.x, n.y);
      n.el.style.left = p.x + "px";
      n.el.style.top = p.y + "px";
      n.el.style.transform = OFFSETS[n.place];
    }
    const f = layout.filesLabel;
    const fp = toPx(f.x, f.y);
    f.el.style.left = fp.x + "px";
    f.el.style.top = fp.y + "px";
    f.el.style.transform = OFFSETS[f.place];
    place(reduced.matches ? 0.5 : 0);
  }

  function place(t) {
    if (!metrics || !len) return;
    const p = text.getPointAtLength(len * t);
    const px = toPx(p.x, p.y);
    pill.style.transform = `translate(${px.x}px, ${px.y}px) translate(-50%, -50%)`;

    let label = STILL;
    if (!reduced.matches) {
      label = STEPS[0].text;
      for (const s of STEPS) if (t >= s.at) label = s.text;
    }
    if (pillText.textContent !== label) pillText.textContent = label;
  }

  function frame(now) {
    if (!started) started = now;
    const e = (now - started) % (TRAVEL_MS + HOLD_MS);
    place(Math.min(1, e / TRAVEL_MS));
    raf = requestAnimationFrame(frame);
  }

  function run() {
    const want = onScreen && !document.hidden && !reduced.matches;
    if (want && !raf) { started = 0; raf = requestAnimationFrame(frame); }
    if (!want && raf) { cancelAnimationFrame(raf); raf = 0; if (reduced.matches) place(0.5); }
  }

  build();

  // Only animate what is on screen. Everything else is a frame budget spent on
  // something nobody is looking at.
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(entries => {
      onScreen = entries[0].isIntersecting;
      run();
    }, { rootMargin: "80px" }).observe(stage);
  } else {
    onScreen = true;
    run();
  }

  document.addEventListener("visibilitychange", run);
  reduced.addEventListener?.("change", () => { position(); run(); });

  let resizeTimer = 0;
  let width = window.innerWidth;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      // A phone toolbar collapsing changes the height, not the layout. Only a
      // width change can move a line.
      if (window.innerWidth === width && layout === pick()) { position(); return; }
      width = window.innerWidth;
      (layout === pick() ? position : build)();
    }, 150);
  }, { passive: true });
});

/* ================================================================ the globe */

/**
 * Loaded on approach, not on load. It is below the fold, it fetches from a
 * third host, and neither of those belongs in the critical path of the page
 * search engines fetch. If the import fails, the section keeps its static
 * "Sessions worldwide" caption and nothing else notices.
 */
start("globe", function globe() {
  const canvas = byId("globe");
  if (!canvas) return;

  let loaded = false;
  const load = () => {
    if (loaded) return;
    loaded = true;
    import("./globe.js").then(m => m.mount()).catch(() => { /* caption stands */ });
  };

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) { io.disconnect(); load(); }
    }, { rootMargin: "300px" });
    io.observe(canvas);
  } else if ("requestIdleCallback" in window) {
    requestIdleCallback(load, { timeout: 3000 });
  } else {
    setTimeout(load, 1200);
  }
});
