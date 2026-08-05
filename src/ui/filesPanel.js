/** Panel 2 — files and images. Thumbnails here, bytes over P2P. */

import { FILES } from "../core/config.js";
import { emit, on, EV } from "../core/bus.js";
import * as state from "../core/state.js";
import * as registry from "../files/registry.js";
import * as transfer from "../files/transfer.js";
import { iconFor, formatSize } from "../files/thumbs.js";
import { $, esc, on as bind } from "./dom.js";

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
    const tile = e.target.closest(".tile");
    if (!tile) return;
    const file = registry.get(tile.dataset.id);
    if (!file) return;
    // Local (or already-received) files save; remote ones are fetched on demand.
    if (file.blob) registry.save(file.id);
    else transfer.request(file.id);
  });

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

function render() {
  const items = registry.all();
  $("fileN").textContent = items.length;
  $("noFiles").style.display = items.length ? "none" : "block";

  $("grid").innerHTML = items.map(f => `
    <div class="tile" data-id="${esc(f.id)}" title="${esc(f.name)} · ${formatSize(f.size)}">
      <div class="thumb">${f.thumb
        ? `<img src="${f.thumb}" alt="">`
        : `<span>${iconFor(f.name)}</span>`}</div>
      ${badge(f)}
      <div class="meta">
        <div class="nm">${esc(f.name)}</div>
        <div class="sz">${formatSize(f.size)}</div>
      </div>
      <div class="bar" style="width:${f.progress}%"></div>
    </div>`).join("");
}

function badge(f) {
  if (f.origin === "local") return `<span class="badge local">HERE</span>`;
  if (f.progress > 0 && f.progress < 100) return `<span class="badge busy">${f.progress}%</span>`;
  // The transport path is never hidden: relay-fallback is a different privacy
  // story from a direct transfer, and the user should see which they got.
  if (f.path === "relay") return `<span class="badge relay">RELAY</span>`;
  return `<span class="badge remote">P2P</span>`;
}

export const maxBytes = FILES.MAX_BYTES;
