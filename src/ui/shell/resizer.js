/**
 * Draggable splitters.
 *
 * Uses pointer events with setPointerCapture rather than mousemove on document:
 * capture keeps the drag alive when the cursor crosses an iframe, leaves the
 * window, or moves faster than the browser paints — the usual causes of a
 * splitter that "sticks" mid-drag.
 *
 * Sizes persist, because re-dragging the sidebar every visit is the kind of
 * small tax that makes an app feel unfinished.
 */

import { read, write } from "../../core/storage.js";
import { $ } from "../primitives/dom.js";

const SIDEBAR = { min: 260, max: 720, key: "sidebarWidth" };
const FILES_PANE = { min: 90, max: 0.75, key: "filesPaneHeight" };   // max as a fraction

export function init() {
  restore();
  vertical();
  horizontal();
}

/* ---------------- sidebar width ---------------- */
function vertical() {
  const handle = $("resizeSide");
  const side = $("side");
  if (!handle || !side) return;

  drag(handle, {
    start: () => side.getBoundingClientRect().width,
    move: (startWidth, dx) => {
      // Dragging left widens the sidebar, so the delta is inverted.
      const width = clamp(startWidth - dx, SIDEBAR.min, Math.min(SIDEBAR.max, innerWidth - 320));
      side.style.width = `${width}px`;
      return width;
    },
    end: width => write(SIDEBAR.key, Math.round(width)),
    axis: "x",
  });

  // Keyboard: a splitter with tabindex that ignores arrow keys is a trap.
  handle.addEventListener("keydown", e => {
    const step = e.shiftKey ? 40 : 12;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const current = side.getBoundingClientRect().width;
    const width = clamp(current + (e.key === "ArrowLeft" ? step : -step),
                        SIDEBAR.min, Math.min(SIDEBAR.max, innerWidth - 320));
    side.style.width = `${width}px`;
    write(SIDEBAR.key, Math.round(width));
  });
}

/* ---------------- files / session split ---------------- */
function horizontal() {
  const handle = $("resizePanes");
  const files = $("paneFiles");
  if (!handle || !files) return;

  // Its sibling splitter handles arrows and this one did not, so it took focus
  // and then ignored every key — a tab stop that does nothing. It is also the
  // only way to resize without dragging (WCAG 2.5.7).
  handle.addEventListener("keydown", e => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const step = e.shiftKey ? 40 : 12;
    const available = $("side").getBoundingClientRect().height;
    const current = files.getBoundingClientRect().height;
    const height = clamp(current + (e.key === "ArrowDown" ? step : -step),
                         FILES_PANE.min, available * FILES_PANE.max);
    files.style.flex = "none";
    files.style.height = `${height}px`;
    write(FILES_PANE.key, Math.round(height));
  });

  drag(handle, {
    start: () => files.getBoundingClientRect().height,
    move: (startHeight, _dx, dy) => {
      const available = $("side").getBoundingClientRect().height;
      const height = clamp(startHeight + dy, FILES_PANE.min, available * FILES_PANE.max);
      // flex:1 would fight an explicit height, so the pane is pinned while sized.
      files.style.flex = "none";
      files.style.height = `${height}px`;
      return height;
    },
    end: height => write(FILES_PANE.key, Math.round(height)),
    axis: "y",
  });
}

/* ---------------- shared drag plumbing ---------------- */
function drag(handle, { start, move, end, axis }) {
  let origin = null, base = 0, latest = 0;

  handle.addEventListener("pointerdown", e => {
    e.preventDefault();
    origin = { x: e.clientX, y: e.clientY };
    base = start();
    latest = base;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add("dragging");
    // Without this the drag selects text across the whole app.
    document.body.style.userSelect = "none";
    document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
  });

  handle.addEventListener("pointermove", e => {
    if (!origin) return;
    latest = move(base, e.clientX - origin.x, e.clientY - origin.y);
  });

  const stop = e => {
    if (!origin) return;
    origin = null;
    try { handle.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    handle.classList.remove("dragging");
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    end(latest);
  };
  handle.addEventListener("pointerup", stop);
  handle.addEventListener("pointercancel", stop);
}

function restore() {
  const width = read(SIDEBAR.key);
  if (width) $("side").style.width = `${clamp(width, SIDEBAR.min, SIDEBAR.max)}px`;

  const height = read(FILES_PANE.key);
  const files = $("paneFiles");
  if (height && files) {
    files.style.flex = "none";
    files.style.height = `${height}px`;
  }
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
