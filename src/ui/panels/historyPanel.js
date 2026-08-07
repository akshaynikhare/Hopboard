/**
 * Sidebar pane — in-session clip history (PRD FR-2.9).
 *
 * ── BUS CONTRACT ───────────────────────────────────────────────────────────
 * Emits  "history:restore"  {text}   — user clicked a row; load it into the editor.
 * Listens "history:changed" {clips}  — the list changed; re-render.
 * (Both names are exported as history.EVENTS.RESTORE / .CHANGED — use those.)
 *
 * Why a new event rather than re-emitting EV.TEXT_RECEIVED: TEXT_RECEIVED means
 * "a peer sent this". Restoring from history is neither remote nor new, and
 * main.js routes TEXT_RECEIVED into clipboard/capture.apply() — so borrowing it
 * would both lie about provenance and fire an unrequested OS clipboard write,
 * with a suppression window that then swallows the user's next real copy.
 * main.js wires RESTORE to the editor, a send, and a switch to Manual mode —
 * never to the OS clipboard.
 *
 * ── ESCAPING ───────────────────────────────────────────────────────────────
 * Every clip value that reaches innerHTML goes through esc() first. Clip text is
 * attacker-controlled by definition — anyone holding the session key can put
 * `<img src=x onerror=…>` on your clipboard, and this pane is where it would
 * land. There is no path in this file from raw clip text to markup.
 */

import { emit, on, EV } from "../../core/bus.js";
import * as history from "../../core/history.js";
import { write as writeClipboard } from "../../clipboard/os.js";
import { upgrade as upgradeHeader, sync as syncHeader } from "../shell/panes.js";
import { $, esc, on as bind, setHTML } from "../primitives/dom.js";

const PREVIEW_CHARS = 70;
const TITLE_CHARS = 300;

export function init() {
  if ($("paneHistory")) return;          // already mounted

  history.init();                        // idempotent; keeps main.js to one line
  mount();

  bind("histList", "click", onListClick);
  bind("histList", "keydown", e => {
    if (e.key !== "Enter" && e.key !== " ") return;
    // A row is role="button" and contains a real <button> (Copy). Without this
    // guard, Enter on Copy fired BOTH: the button's native activation copied
    // the clip, and this handler also restored it into the editor — one
    // keystroke, two unrelated effects, one of them destructive to whatever
    // was being typed. The pointer path never hit it because onListClick
    // stops propagation; the keyboard path had no equivalent.
    if (e.target.closest?.("button")) return;
    const row = e.target.closest?.(".hrow");
    if (!row) return;
    e.preventDefault();
    restore(row.dataset.id);
  });

  bind("histClear", "click", e => {
    e.stopPropagation();                 // header click toggles the pane; this must not
    emit(EV.TOAST, history.clear() ? "History cleared" : "History is already empty");
  });

  on(history.EVENTS.CHANGED, render);
  render();
}

/* ------------------------------------------------------------------- mount */

/**
 * No markup exists for this pane, so it builds its own and appends to the
 * #mount-panes hook in index.html.
 *
 * Note the header deliberately does NOT carry [data-toggle]: sessionPanel.js
 * binds a collapse handler to every [data-toggle] in the document at its own
 * init(), and depending on module ordering this pane could be bound zero times
 * or twice (two handlers = a click that toggles and untoggles). Owning the
 * handler here makes the pane order-independent. The .paneh / .chev / .collapsed
 * classes from styles/sidebar.css still do all the visual work.
 */
function mount() {
  const host = $("mount-panes");
  if (!host) return console.error("[historyPanel] #mount-panes missing");

  const pane = document.createElement("section");
  pane.className = "pane";
  pane.id = "paneHistory";
  setHTML(pane, `
    <div class="paneh" id="histHead">
      <span class="chev"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8L12 16L20 8"/></svg></span> History
      <span class="spacer"></span>
      <span class="soft"><span id="histCount">0</span><span class="vh"> clips</span></span>
      <button class="ibtn" type="button" id="histClear" title="Clear history" aria-label="Clear history">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3"/></svg>
      </button>
    </div>
    <div class="paneb">
      <div class="hist" id="histList"></div>
      <div class="none" id="histEmpty">
        Clips you send and receive appear here. Memory and <code>sessionStorage</code>
        only — history is gone when this tab closes, and cleared when the key changes.
      </div>
    </div>`);

  host.appendChild(pane);

  // The header keeps its own click handler for the reason above, but the
  // keyboard and screen-reader half of a disclosure is not worth restating in
  // two places — ui/panes.js wraps the chevron and label in a real <button>
  // and owns aria-expanded/aria-controls. Enter and Space then come from the
  // platform, and the click bubbles to the handler below exactly once.
  const head = $("histHead");
  upgradeHeader(head);
  bind(head, "click", () => {
    pane.classList.toggle("collapsed");
    syncHeader(head);
  });
}

/* ------------------------------------------------------------------ render */

function render() {
  const items = history.all();
  const count = $("histCount");
  if (count) count.textContent = items.length;

  const empty = $("histEmpty");
  if (empty) empty.style.display = items.length ? "none" : "block";

  const list = $("histList");
  if (!list) return;

  // esc() on every interpolation below. id and time are generated locally, text
  // is hostile; escaping all three keeps the rule "everything is escaped here"
  // checkable by eye instead of case by case.
  //
  // The row carries an explicit aria-label. Left to its contents it announced
  // as "RECV <preview> 14:32 Copy this clip button" — the direction as a
  // four-letter code nobody says out loud, and the row's own action never
  // named. The label says what activating the row does, which is the only
  // thing a button's name is for. Each copy button is named with its clip too,
  // because twenty buttons all called "Copy this clip" is a list you cannot
  // navigate by name.
  setHTML(list, items.map(c => {
    const sent = c.direction === "sent";
    const at = hhmm(c.at);
    const gist = preview(c.text);
    const said = `${sent ? "sent" : "received"} at ${at}: ${gist}`;
    return `
    <div class="row hrow" data-id="${esc(c.id)}" role="button" tabindex="0"
         aria-label="Load into the editor — clip ${esc(said)}"
         title="${esc(clamp(c.text, TITLE_CHARS))}">
      <span class="pill ${sent ? "sent" : "recv"}" aria-hidden="true">${sent ? "SENT" : "RECV"}</span>
      <div class="l"><b class="hprev">${esc(gist)}</b></div>
      <span class="htime" aria-hidden="true">${esc(at)}</span>
      <button class="ibtn hcopy" type="button" title="Copy this clip"
              aria-label="Copy clip ${esc(said)}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg>
      </button>
    </div>`;
  }).join(""));
}

/** One line, no runs of whitespace, ellipsised — a clip is often a stack trace. */
function preview(text) {
  return clamp(String(text).replace(/\s+/g, " ").trim(), PREVIEW_CHARS);
}

function clamp(text, n) {
  const s = String(text);
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Manual padding rather than toLocaleTimeString: locale-independent, always 24h. */
function hhmm(at) {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return "--:--";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ events */

function onListClick(e) {
  const row = e.target.closest(".hrow");
  if (!row) return;

  if (e.target.closest(".hcopy")) {
    e.stopPropagation();
    return copy(row.dataset.id);
  }
  restore(row.dataset.id);
}

/** clipboard/os.js is the only module allowed to touch the OS clipboard. */
async function copy(id) {
  const entry = history.get(id);
  if (!entry) return;
  if (await writeClipboard(entry.text)) {
    emit(EV.TOAST, `Copied ${entry.chars.toLocaleString()} characters`);
  }
}

/**
 * Announce the intent and stop. The toast lives with the wiring in main.js,
 * not here: restoring also flips the session to Manual, and only the handler
 * that performs the switch knows whether the mode actually changed. Emitting a
 * "Loaded into the editor" toast here as well would queue two messages behind
 * one click — toast.js serialises them, so it reads as a stutter.
 */
function restore(id) {
  const entry = history.get(id);
  if (!entry) return;
  emit(history.EVENTS.RESTORE, { text: entry.text });   // "history:restore"
}
