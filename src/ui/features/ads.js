/**
 * The sponsor slot, under the editor.
 *
 * Why an ad at all: no accounts, no subscription and no telemetry, but the relay
 * is a paid server, and a slot that pays for it is the least intrusive way to
 * keep the app free.
 *
 * It will never load a third-party script. This document holds the session key
 * in location.hash and decrypted clipboard text in its DOM, and an ad tag
 * updates itself remotely with nobody here reviewing the diff — see CLAUDE.md.
 * AdSense runs on the landing page, which holds neither.
 *
 * The space is reserved for a FIRST-PARTY sponsor: a static image and a link
 * served from this origin, no script, which is the one form of paid content that
 * costs the user nothing. The change that would unlock ad-network inventory is
 * getting the key out of the fragment — worth doing on its own merits, not for
 * the ads.
 *
 * It sits here rather than in the sidebar because the sidebar holds the key, the
 * file previews and the settings. A mis-click beside "fetch this file" transfers
 * data; below the editor is outside the flow of every task.
 */

import { $, esc, setHTML } from "../primitives/dom.js";

// Fixed in CSS rather than letting the creative size itself, so the editor does
// not jump when one loads — reserved space is the point of a placeholder.
const PLACEHOLDER_LABEL = "Sponsor slot · 728 × 90";

export function init() {
  const host = $("mount-ad");
  if (!host) return;

  setHTML(host, `
    <aside class="adslot" id="adSlot" aria-label="Sponsor">
      <div class="adslot-tag">Sponsored</div>

      <!-- A first-party creative replaces the contents of this box, not the
           box. Static markup from this origin — no ad script, see above. -->
      <div class="adslot-box" id="adBox" role="presentation">
        <span class="adslot-ph">${esc(PLACEHOLDER_LABEL)}</span>
      </div>

      <p class="adslot-note"
         title="This space pays for the relay. It runs no third-party code and never sees your clipboard.">
        This space pays for the relay. It runs no third-party code and never
        sees your clipboard.
      </p>
    </aside>`);
}

// Filling this slot: static markup inside #adBox — an <img> or a styled <a>,
// from this origin, keeping the box size. No <script>, no pixel, no off-site
// iframe. Whoever adds the creative also owns keeping the note above true.
