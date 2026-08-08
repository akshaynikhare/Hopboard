/**
 * The sponsor slot, under the editor.
 *
 * Why an ad at all: no accounts and no subscription, but the relay is a paid
 * server, and a slot that pays for it is what keeps the app free.
 *
 * ── WHY THIS ONE IS NOT ADSENSE, WHEN THE REST OF THE SITE IS ──────────────
 *
 * The landing and content pages run AdSense (src/landing/tags.js). This document
 * does not, and the asymmetry is the whole point rather than an omission nobody
 * got to. Note that analytics DOES run here (analytics.js) — so the line is not
 * "no Google in the app", it is the paragraph below.
 *
 * app.html holds the share key in `location.hash` and decrypted clipboard text
 * in its DOM. An ad tag placed here could read both, and contextual targeting
 * reads page content by design — that is what it is for. Worse, the ad request
 * reports the page URL, and unlike gtag (which `pageLocation()` fixes) AdSense
 * exposes no supported way to withhold it, so the key would go to Google on
 * every request. That is the one thing this product promises never happens.
 *
 * The revenue given up is small: app.html is `noindex`, search traffic lands on
 * the crawlable pages, and the leaderboard and FAQ rail there already catch
 * essentially every impression. docs/SEO.md called this split before the tags
 * existed; docs/ARCHITECTURE.md §5 records it as an invariant.
 *
 * !! Turning this into an AdSense unit is NOT a config flip. app.html's meta CSP
 * is deliberately stricter than the site-wide header, and tools/check/
 * site-check.mjs fails the deploy if that stops being true. Widening it is the
 * decision; the code below is downstream of it. !!
 *
 * The space is reserved for a FIRST-PARTY sponsor: a static image and a link
 * served from this origin, no script, which is the one form of paid content that
 * costs the user nothing.
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

      <!-- Says "this slot", not "this page": analytics.js does load gtag here.
           A claim about the document would be false; one about the slot is
           exactly true, and it is the slot a reader is asking about. -->
      <p class="adslot-note"
         title="This slot pays for the relay. It is served from here rather than an ad network, and never sees your clipboard.">
        This slot pays for the relay. Served from here, not an ad network, and
        it never sees your clipboard.
      </p>
    </aside>`);
}

// Filling this slot: static markup inside #adBox — an <img> or a styled <a>,
// from this origin, keeping the box size. No <script>, no pixel, no off-site
// iframe. Whoever adds the creative also owns keeping the note above true.
