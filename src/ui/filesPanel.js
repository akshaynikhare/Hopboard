/**
 * Panel 2 — files and images. Thumbnails here, bytes over P2P.
 *
 * Two things this panel is not allowed to get wrong (docs/ARCHITECTURE.md §5):
 *
 *   1. The transport path is always visible. A file that arrived over the relay
 *      says RELAY, from the moment the fallback is chosen rather than at the
 *      end, because that is a different privacy story from a direct transfer
 *      and the user cannot make an informed choice after the fact.
 *   2. A failed transfer says why, on the tile. A stalled bar that quietly
 *      disappears is indistinguishable from a slow network.
 *
 * Note the badge for a remote file we have NOT fetched yet: it reads GET, not
 * P2P. The old code claimed P2P before any transfer had happened, which is a
 * promise the corporate network is very likely to break — see P2P-FILES.md §4.
 */

import { FILES } from "../core/config.js";
import { emit, on, EV } from "../core/bus.js";
import * as state from "../core/state.js";
import * as registry from "../files/registry.js";
import * as transfer from "../files/transfer.js";
import { iconFor, formatSize } from "../files/thumbs.js";
import { $, esc, on as bind } from "./dom.js";

const S = registry.STATE;

/** States that mean "something is happening and it can be cancelled". */
const BUSY = new Set([S.REQUESTING, S.WAITING, S.CONNECTING, S.SENDING, S.RECEIVING]);

export function init() {
  const drop = $("drop");

  bind(drop, "click", () => $("picker").click());
  bind("bAdd", "click", e => { e.stopPropagation(); $("picker").click(); });
  bind("picker", "change", e => { intake(e.target.files); e.target.value = ""; });

  ["dragenter", "dragover"].forEach(ev =>
    bind(drop, ev, e => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(ev =>
    bind(drop, ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
  bind(drop, "drop", e => intake(e.dataTransfer.files));

  bind("grid", "click", e => {
    // Cancel is inside the tile, so it has to be checked before the tile.
    const stop = e.target.closest("[data-cancel]");
    if (stop) {
      e.stopPropagation();
      transfer.cancel(stop.dataset.cancel);
      return;
    }

    const tile = e.target.closest(".tile");
    if (!tile) return;
    const file = registry.get(tile.dataset.id);
    if (!file) return;
    if (BUSY.has(file.state)) return;                 // already under way

    // Local (or already-received) files save; remote ones are fetched on demand.
    if (file.blob) registry.save(file.id);
    else transfer.request(file.id);
  });

  // A peer asking for one of our files needs a human, unless autoaccept is on.
  // transfer.js checks the setting; this is only the dialog.
  transfer.setApprover(ask);

  on(EV.FILES_CHANGED, render);
  render();
}

async function intake(fileList) {
  const { rejected } = await registry.add(fileList, {
    makeThumbs: state.get().settings.thumbs,
  });
  // Report every rejection — a file silently vanishing is worse than a limit.
  rejected.forEach(r => emit(EV.TOAST, `${r.name}: ${r.reason}`));
}

/* ------------------------------------------------------------------ *
 * Tiles
 * ------------------------------------------------------------------ */

function render() {
  const items = registry.all();
  $("fileN").textContent = items.length;
  $("noFiles").style.display = items.length ? "none" : "block";

  $("grid").innerHTML = items.map(f => `
    <div class="tile${tileClass(f)}" data-id="${esc(f.id)}" title="${esc(tooltip(f))}">
      <div class="thumb">${f.thumb
        ? `<img src="${esc(f.thumb)}" alt="">`
        : `<span>${iconFor(f.name)}</span>`}</div>
      ${badge(f)}
      ${BUSY.has(f.state) ? cancelButton(f) : ""}
      <div class="meta">
        <div class="nm">${esc(f.name)}</div>
        ${f.state === S.ERROR
          ? `<div class="sz bad">${esc(f.error || "transfer failed")}</div>`
          : `<div class="sz">${esc(subtitle(f))}</div>`}
      </div>
      <div class="bar${f.path === "relay" ? " viarelay" : ""}" style="width:${f.progress}%"></div>
    </div>`).join("");
}

function tileClass(f) {
  if (f.state === S.ERROR) return " err";
  if (BUSY.has(f.state)) return " busy";
  return "";
}

function cancelButton(f) {
  return `<button class="tcancel" data-cancel="${esc(f.id)}"
    title="Cancel this transfer" aria-label="Cancel transfer of ${esc(f.name)}">×</button>`;
}

/** Under the name: normally the size, but the live state while it is moving. */
function subtitle(f) {
  switch (f.state) {
    case S.REQUESTING: return "requesting…";
    case S.WAITING:    return "awaiting approval";
    case S.CONNECTING: return "connecting…";
    case S.SENDING:    return `sending ${f.progress}%`;
    case S.RECEIVING:  return `${f.progress}%`;
    case S.CANCELLED:  return "cancelled";
    default:           return formatSize(f.size);
  }
}

function tooltip(f) {
  const bits = [f.name, formatSize(f.size)];
  if (f.state === S.ERROR) bits.push(`failed: ${f.error}`);
  else if (f.path === "relay") bits.push("came via the relay, not directly");
  else if (f.path === "p2p") bits.push("direct peer-to-peer transfer");
  else if (f.origin === "remote") bits.push("click to request the file");
  else bits.push("click to save");
  return bits.join(" · ");
}

/**
 * The badge is the honest label of where this file is and how it got here.
 * Precedence: a failure beats a state, a state beats a path.
 */
function badge(f) {
  if (f.state === S.ERROR) return `<span class="badge err">ERR</span>`;
  if (f.state === S.WAITING) return `<span class="badge busy">ASK</span>`;
  if (f.state === S.REQUESTING || f.state === S.CONNECTING) {
    return `<span class="badge busy">…</span>`;
  }
  if (f.state === S.SENDING || f.state === S.RECEIVING) {
    return `<span class="badge busy">${f.progress}%</span>`;
  }
  if (f.origin === "local") return `<span class="badge local">HERE</span>`;

  // The transport path is never hidden: relay-fallback is a different privacy
  // story from a direct transfer, and the user should see which they got.
  if (f.path === "relay") return `<span class="badge relay">RELAY</span>`;
  if (f.path === "p2p") return `<span class="badge remote">P2P</span>`;
  return `<span class="badge want">GET</span>`;      // not fetched — no path to claim yet
}

/* ------------------------------------------------------------------ *
 * Approval prompt
 *
 * Fires on the machine that HOLDS the file: a peer has asked for bytes and,
 * with autoaccept off, a human decides before they leave the disk. That is the
 * only point in the flow where a decision can still prevent anything — the
 * requesting side already consented by clicking the tile.
 *
 * File requests are authenticated only by session membership (P2P-FILES.md §6),
 * so this dialog is the one thing standing between "someone has the key" and
 * "someone has your files".
 * ------------------------------------------------------------------ */

const prompts = new Map();      // token -> {req, resolve, expires}
let tick = null;
let nextToken = 0;

function ask(req) {
  return new Promise(resolve => {
    const token = `ask${nextToken++}`;
    // Never outlive the requester's own deadline: approving into a peer that
    // has already given up would send 5 MB nowhere.
    const expires = Date.now() + transfer.requestTimeoutMs();
    prompts.set(token, { req, resolve, expires });
    drawPrompts();
    if (!tick) tick = setInterval(sweep, 500);
  });
}

function settle(token, allowed) {
  const p = prompts.get(token);
  if (!p) return;
  prompts.delete(token);
  p.resolve(allowed);
  drawPrompts();
  if (!prompts.size && tick) { clearInterval(tick); tick = null; }
}

/** Expire prompts nobody answered, and keep the countdown honest. */
function sweep() {
  const now = Date.now();
  for (const [token, p] of [...prompts]) {
    if (p.expires <= now) {
      emit(EV.TOAST, `Request for ${p.req.name} expired — nobody answered`);
      settle(token, false);
    }
  }
  drawPrompts();
}

function drawPrompts() {
  const host = $("mount-modals");
  if (!host) return;

  if (!prompts.size) {
    host.innerHTML = "";
    document.removeEventListener("keydown", onKey);
    return;
  }

  host.innerHTML = `<div class="ask" role="dialog" aria-modal="true" aria-label="File request">
    ${[...prompts].map(([token, { req, expires }]) => `
      <div class="card" data-token="${esc(token)}">
        <div class="t">A device wants one of your files</div>
        <div class="f">${esc(req.name)} <span class="s">${formatSize(req.size)}</span></div>
        <div class="w">
          Device <code>${esc(req.from)}</code> is in this session. Anyone holding
          the share key can ask for any file here.
        </div>
        <div class="acts">
          <span class="cd">${Math.max(0, Math.ceil((expires - Date.now()) / 1000))}s</span>
          <button class="btn ghost" data-deny="${esc(token)}">Deny</button>
          <button class="btn" data-allow="${esc(token)}">Send it</button>
        </div>
      </div>`).join("")}
  </div>`;

  host.querySelector("[data-allow]")?.focus?.();
  host.onclick = e => {
    const allow = e.target.closest("[data-allow]");
    if (allow) return settle(allow.dataset.allow, true);
    const deny = e.target.closest("[data-deny]");
    if (deny) return settle(deny.dataset.deny, false);
  };
  document.addEventListener("keydown", onKey);
}

/** Escape denies. The safe answer is the easy one to reach. */
function onKey(e) {
  if (e.key !== "Escape" || !prompts.size) return;
  e.preventDefault();
  settle([...prompts.keys()].pop(), false);
}

export const maxBytes = FILES.MAX_BYTES;
