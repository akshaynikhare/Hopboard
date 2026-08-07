/**
 * A key in the fragment means someone followed a share link to the landing page
 * rather than to the app. Send them on, rather than showing marketing to
 * somebody who came here to work.
 *
 * An in-page anchor is NOT a key. "#live" and "#compare" are both four or more
 * characters and both used to be swallowed, so deep-linking to a section landed
 * the visitor in the app on a room called LIVE. If the fragment names something
 * on this page, it is a destination, not a credential.
 *
 * A file rather than an inline <script> so `script-src 'self'` holds with no
 * hash and no 'unsafe-inline'. A module script is deferred, which this wants
 * anyway: getElementById cannot answer until the page has been parsed.
 */

const raw = location.hash.slice(1).trim();

if (raw && !document.getElementById(raw)) {
  const shared = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (shared.length >= 4) location.replace("./app.html#" + shared);
}
