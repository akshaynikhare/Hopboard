/**
 * A key in the fragment means someone followed a share link to the landing page
 * rather than to the app. Send them on, rather than showing marketing to
 * somebody who came here to work.
 *
 * An in-page anchor is NOT a key. "#live" and "#compare" are both four or more
 * characters and both used to be swallowed by this, so deep-linking to a
 * section — from a search result, or from anywhere at all — landed the visitor
 * in the app on a room called LIVE. If the fragment names something on this
 * page, it is a destination, not a credential.
 *
 * This was an inline <script> at the end of <body>. It moved out to a file so
 * `script-src 'self'` can hold with no hash and no 'unsafe-inline' — it was the
 * only executable inline script on the whole site. A module script is deferred,
 * which is what this wants anyway: the getElementById test below cannot answer
 * "is this fragment a section on the page?" until the page has been parsed.
 */

const raw = location.hash.slice(1).trim();

if (raw && !document.getElementById(raw)) {
  const shared = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (shared.length >= 4) location.replace("./app.html#" + shared);
}
