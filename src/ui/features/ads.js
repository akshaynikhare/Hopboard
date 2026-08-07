/**
 * The ad slot, under the editor.
 *
 * Why an ad at all: no accounts and no subscription, but the relay is a paid
 * server, and a slot that pays for it is what keeps the app free.
 *
 * ── WHAT THIS COSTS, WHICH IS NOT NOTHING ──────────────────────────────────
 *
 * This file used to say no third-party script would ever run in this document,
 * and the reasoning was sound: app.html holds the share key in `location.hash`
 * and decrypted clipboard text in its DOM, and an ad tag updates itself
 * remotely with nobody here reviewing the diff. Running AdSense here was a
 * deliberate decision to accept that, taken with the consequences stated. They
 * are:
 *
 *   - The tag can read `location.hash`, and therefore the share key.
 *   - The tag can read the editor's contents, and contextual ad targeting
 *     reads page content by design — that is what it is for.
 *   - The ad request reports the page URL. Unlike gtag, AdSense exposes no
 *     supported way to override it, so the fragment cannot be stripped the way
 *     analytics.js strips it.
 *
 * There is one real fix and it is architectural: get the key out of the
 * fragment. Until that lands, `GOOGLE.ADSENSE_SLOTS.APP` in core/config.js is
 * the switch — leave it empty and this document serves the first-party
 * placeholder below while the landing page still runs ads. Filling it in is
 * what turns the paragraph above from a description into a fact.
 *
 * It sits here rather than in the sidebar because the sidebar holds the key, the
 * file previews and the settings. A mis-click beside "fetch this file" transfers
 * data; below the editor is outside the flow of every task.
 */

import { $, esc, setHTML, scriptURL } from "../primitives/dom.js";
import { GOOGLE, GOOGLE_SRC, adsEnabled } from "../../core/config.js";

// Fixed in CSS rather than letting the creative size itself, so the editor does
// not jump when one loads — reserved space is the point of a placeholder.
const PLACEHOLDER_LABEL = "Sponsor slot · 728 × 90";

const live = () => adsEnabled() && Boolean(GOOGLE.ADSENSE_SLOTS.APP);

export function init() {
  const host = $("mount-ad");
  if (!host) return;

  setHTML(host, `
    <aside class="adslot" id="adSlot" aria-label="${live() ? "Advertisement" : "Sponsor"}">
      <div class="adslot-tag">${live() ? "Advertisement" : "Sponsored"}</div>

      <div class="adslot-box" id="adBox" role="presentation">
        <span class="adslot-ph">${esc(PLACEHOLDER_LABEL)}</span>
      </div>

      <p class="adslot-note"
         title="${live()
           ? "Ads pay for the relay. This slot is served by Google and is subject to their privacy policy."
           : "This space pays for the relay. It runs no third-party code and never sees your clipboard."}">
        ${live()
          ? "Ads pay for the relay. This slot is served by Google."
          : "This space pays for the relay. It runs no third-party code and never sees your clipboard."}
      </p>
    </aside>`);

  if (live()) mountUnit();
}

/**
 * The unit replaces the contents of the reserved box, never the box — its
 * height is what stops the editor jumping when a creative loads.
 */
function mountUnit() {
  const box = $("adBox");
  if (!box) return;

  const el = document.createElement("script");
  el.async = true;
  el.setAttribute("crossorigin", "anonymous");
  el.src = scriptURL(GOOGLE_SRC.adsense(GOOGLE.ADSENSE_CLIENT));
  document.head.append(el);

  const ins = document.createElement("ins");
  ins.className = "adsbygoogle";
  ins.style.display = "block";
  ins.style.width = "100%";
  ins.style.height = "100%";
  ins.setAttribute("data-ad-client", GOOGLE.ADSENSE_CLIENT);
  ins.setAttribute("data-ad-slot", GOOGLE.ADSENSE_SLOTS.APP);
  ins.setAttribute("data-ad-format", "horizontal");
  ins.setAttribute("data-full-width-responsive", "true");

  box.replaceChildren(ins);
  box.classList.add("adlive");

  (window.adsbygoogle = window.adsbygoogle || []).push({});
}

// Filling the slot WITHOUT AdSense: static markup inside #adBox — an <img> or a
// styled <a>, from this origin, keeping the box size. That path costs the user
// nothing and needs no CSP change; it is what `ADSENSE_SLOTS.APP` being empty
// falls back to.
