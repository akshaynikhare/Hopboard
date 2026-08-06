/**
 * The one ad slot, under the editor.
 *
 * WHAT THIS IS: a placeholder. It renders a correctly-sized, correctly-labelled
 * box and nothing else — no third-party script, no network request, no ad
 * network. Going live is a deliberate step, described at the bottom of this
 * file, because on THIS page it is not a neutral one.
 *
 * Why an ad at all: the app has no accounts, no subscription and no telemetry,
 * but the relay it depends on is a paid server. One slot that pays for the
 * relay is the least intrusive way to keep the app free, and saying so plainly
 * in the slot itself costs a line of text.
 *
 * Why it sits HERE and not in the sidebar: the sidebar holds the session key,
 * the file previews and the settings — everything you act on. Putting paid
 * content next to a "fetch this file" button invites a mis-click on the one
 * surface where a mis-click transfers data. Below the editor it is outside the
 * flow of every task in the app.
 */

import { $, esc } from "./dom.js";

/**
 * A leaderboard on desktop, a mobile banner below it. Fixing the height in CSS
 * rather than letting the unit size itself means the editor does not jump when
 * a real ad finally loads — reserved space is the whole point of a placeholder.
 */
const PLACEHOLDER_LABEL = "Ad slot · 728 × 90";

export function init() {
  const host = $("mount-ad");
  if (!host) return;

  host.innerHTML = `
    <aside class="adslot" id="adSlot" aria-label="Advertisement">
      <div class="adslot-tag">Advertisement</div>

      <!-- The real ad unit replaces the contents of this box, not the box. -->
      <div class="adslot-box" id="adBox" role="presentation">
        <span class="adslot-ph">${esc(PLACEHOLDER_LABEL)}</span>
      </div>

      <p class="adslot-note">
        Hopboard is free, has no accounts and stores nothing on a server. This
        single slot pays for the relay that keeps your devices talking to each
        other. It lives outside the editor and never sees your clipboard — your
        text and files are encrypted in this browser before they leave it.
      </p>
    </aside>`;
}

/* ------------------------------------------------------------------
   Going live — read before pasting a publisher id in here

   1. Put the <ins class="adsbygoogle" data-ad-client data-ad-slot> markup
      inside #adBox and load adsbygoogle.js once from init(). Keep the box's
      fixed height so the editor still does not shift.

   2. app.html is `noindex, nofollow` and `referrer: no-referrer` on purpose
      (see the comments there). AdSense wants a crawlable page; the page it
      should be reading is index.html, the landing page. Serving ads on a page
      Google is told not to index is worth checking against the AdSense policy
      before it earns a penny.

   3. The privacy claim in the note above has to stay true after step 1. An ad
      script runs in the same document as the decrypted clipboard text, so it
      can read the DOM if nothing stops it. If this goes live, it needs a CSP
      that pins the ad origins, and the slot should stay out of the DOM subtree
      the editor and history write into — as it is now.

   4. Consider whether the slot should be suppressed while a session has peers
      connected, i.e. while real clipboard content is on screen.
------------------------------------------------------------------- */
