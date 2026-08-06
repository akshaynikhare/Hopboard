/**
 * The sponsor slot, under the editor.
 *
 * Why an ad at all: the app has no accounts, no subscription and no telemetry,
 * but the relay it depends on is a paid server. A slot that pays for the relay
 * is the least intrusive way to keep the app free, and saying so plainly in the
 * slot itself costs a line of text.
 *
 * ---- THE DECISION THIS FILE ENCODES --------------------------------------
 *
 * Google AdSense runs on index.html, the landing page. It does NOT run here,
 * and this slot will never load a third-party script. Two facts about THIS
 * document, and neither is a matter of taste:
 *
 *   1. The session key is in location.hash. Any script in this document can
 *      read location.href, ad tags report the page URL they ran on, and the
 *      key is a bearer credential — whoever has it can read the session. It
 *      does not matter whether today's tag strips the fragment: the tag
 *      updates itself remotely and nobody here reviews the diff.
 *
 *   2. Decrypted clipboard text and file blobs are in this DOM. The whole
 *      claim of the product is that only your devices see them.
 *
 * The slot stays because the space is worth having: it is sized and reserved
 * for a FIRST-PARTY sponsor — a static image and a link, served from this
 * origin, no script — which is the one form of paid content that costs the
 * user nothing. Until there is one, it renders as the placeholder below.
 *
 * The change that would unlock ad-network inventory here is getting the key
 * out of the fragment (hold it in memory, mint the share link on demand). That
 * is worth doing on its own merits; it is not worth doing FOR the ads.
 *
 * Why it sits HERE and not in the sidebar: the sidebar holds the session key,
 * the file previews and the settings — everything you act on. Putting paid
 * content next to a "fetch this file" button invites a mis-click on the one
 * surface where a mis-click transfers data. Below the editor it is outside the
 * flow of every task in the app.
 */

import { $, esc, setHTML } from "./dom.js";

/**
 * A leaderboard on desktop, a mobile banner below it. Fixing the height in CSS
 * rather than letting the creative size itself means the editor does not jump
 * when one loads — reserved space is the whole point of a placeholder.
 */
const PLACEHOLDER_LABEL = "Sponsor slot · 728 × 90";

export function init() {
  const host = $("mount-ad");
  if (!host) return;

  setHTML(host, `
    <aside class="adslot" id="adSlot" aria-label="Sponsor">
      <div class="adslot-tag">Sponsored</div>

      <!-- A first-party creative replaces the contents of this box, not the
           box. Static markup served from this origin — no ad script here, for
           the reasons at the top of this file. -->
      <div class="adslot-box" id="adBox" role="presentation">
        <span class="adslot-ph">${esc(PLACEHOLDER_LABEL)}</span>
      </div>

      <!-- One line, and it has to earn every word of it: what this pays for,
           and the promise that matters. The long version is on the landing
           page — this is a footnote, not a policy. -->
      <p class="adslot-note"
         title="This space pays for the relay. It runs no third-party code and never sees your clipboard.">
        This space pays for the relay. It runs no third-party code and never
        sees your clipboard.
      </p>
    </aside>`);
}

/* ------------------------------------------------------------------
   Filling this slot

   A sponsor creative goes in as static markup inside #adBox: an <img> or a
   styled <a>, both served from this origin, keeping the 728×90 / 100px box.
   No <script>, no pixel, no iframe pointing off-site — a tracking pixel leaks
   the referrer and a remote script leaks everything, and this document holds
   the session key and the decrypted clipboard.

   AdSense belongs on index.html — see the ad section there.

   Whoever adds the creative also owns keeping the note above true. If it ever
   stops being true, change the note in the same commit.
------------------------------------------------------------------- */
