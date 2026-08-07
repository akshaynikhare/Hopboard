/**
 * Promote the platform you are probably on, and hide nothing.
 *
 * The usual version of this feature guesses your OS and shows you one button.
 * That is wrong here for a specific reason: the guess is wrong often enough —
 * a Linux user on a Chromebook, someone on a work Mac reading on their phone,
 * anyone behind a UA-reducing browser — and when it is wrong, the page has no
 * other route. So this only ever ADDS a card at the top. Every platform stays
 * where it was, in the order it was, and a browser with no JavaScript sees the
 * complete page with nothing missing.
 *
 * There is also nothing to detect on the honest question. Whether background
 * clipboard capture works is a property of the operating system, not of the
 * browser reading this, and the cards state it per platform in the markup.
 *
 * The second half of the file swaps the generic /releases/latest links for the
 * real asset URLs. Same principle: it only ever sharpens what the markup
 * already says, and does nothing at all when it cannot.
 */

const byId = id => document.getElementById(id);

/**
 * `navigator.userAgentData` where it exists, the string where it does not.
 *
 * Deliberately coarse. The page has five destinations, so telling Windows 10
 * from 11 or Ubuntu from Fedora buys nothing and only adds ways to be wrong.
 */
function detect() {
  const d = navigator.userAgentData;
  const platform = (d?.platform || navigator.platform || "").toLowerCase();
  const ua = navigator.userAgent.toLowerCase();

  // iPad has reported itself as a Mac since iPadOS 13, and the only reliable
  // tell is that a Mac has no touch points. Checked FIRST: an iPad that falls
  // through to the macOS card is offered a .dmg it cannot possibly run.
  const iPad = platform.startsWith("mac") && navigator.maxTouchPoints > 1;
  if (iPad || /iphone|ipad|ipod/.test(ua)) return "ios";

  if (d?.mobile && /android/.test(ua)) return "android";
  if (/android/.test(ua)) return "android";
  if (/cros/.test(ua)) return "android";              // ChromeOS installs the PWA the same way
  if (platform.startsWith("win")) return "windows";
  if (platform.startsWith("mac")) return "mac";
  if (platform.startsWith("linux") || /linux|x11/.test(ua)) return "linux";
  return null;
}

const COPY = {
  windows: { name: "Windows", lead: "The installer for Windows 10 and 11.", to: "#desktop",
             icon: "#i-windows", doc: "/help/install/windows/" },
  mac:     { name: "macOS",   lead: "One download for Intel and Apple Silicon.", to: "#desktop",
             icon: "#i-apple",   doc: "/help/install/mac/" },
  linux:   { name: "Linux",   lead: ".deb, .rpm and AppImage, or the AUR.", to: "#desktop",
             icon: "#i-linux",   doc: "/help/install/linux/" },
  android: { name: "Android", lead: "No app to install — add it to your home screen from Chrome.", to: "#mobile",
             icon: "#i-android", doc: "/help/install/android/" },
  ios:     { name: "iPhone or iPad", lead: "No app to install — add it to your home screen from Safari.", to: "#mobile",
             icon: "#i-apple",   doc: "/help/install/iphone/" },
};

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * A `<use>` of one of the sprite symbols in the page.
 *
 * createElementNS, not createElement: `createElement("svg")` builds an
 * HTMLUnknownElement that lays out as nothing at all and reports no error.
 * `className` is a read-only SVGAnimatedString on an SVG element, so the class
 * has to go on as an attribute too.
 */
function mark(href) {
  const tile = document.createElement("span");
  tile.className = "dlicon";

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "brandmark");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");

  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", href);

  svg.append(use);
  tile.append(svg);
  return tile;
}

const os = detect();
const host = byId("pick");

if (os && host && COPY[os]) {
  const { name, lead, to, icon, doc } = COPY[os];
  const card = document.createElement("div");
  card.className = "pickcard";

  // Built with the DOM rather than a markup string: this page has no esc()
  // helper and nothing here needs one, but the CSP enforces Trusted Types and
  // a plain innerHTML assignment would throw. textContent cannot be an
  // injection either way, which is the better habit to leave behind.
  const h = document.createElement("p");
  h.className = "pickhead";
  h.textContent = `Looks like you are on ${name}`;

  const p = document.createElement("p");
  p.textContent = lead;

  const a = document.createElement("a");
  a.className = "btn";
  a.href = to;
  a.textContent = to === "#mobile" ? "How to add it" : `Get it for ${name}`;

  const guide = document.createElement("p");
  guide.className = "doclink";
  const guideLink = document.createElement("a");
  guideLink.href = doc;
  guideLink.textContent = `${name} install guide`;
  guide.append(guideLink);

  const alt = document.createElement("p");
  alt.className = "hint";
  alt.textContent = "Not right? Every platform is listed below.";

  card.append(mark(icon), h, p, a, guide, alt);
  host.append(card);
  host.hidden = false;
}

/**
 * Point the download buttons at the actual files.
 *
 * The markup ships pointing at /releases/latest with the artefact described in
 * prose, which is a correct page on its own — this only ever replaces a correct
 * answer with a more specific one. So every failure path here is `return`:
 * offline, rate-limited (the unauthenticated API allows 60 requests an hour per
 * IP), no release published, or an asset that does not match. There is no
 * spinner and no empty state, because there is never a moment where the page is
 * waiting on this.
 *
 * Worth knowing when it appears to do nothing: release.yml creates releases as
 * DRAFTS, and the API returns the latest *published* one. Until somebody
 * publishes the draft this finds nothing — and neither does /releases/latest,
 * so the fallback is not the worse answer.
 */
const REPO = "akshaynikhare/RealtimeClipboard";
const ASSET = {
  msi:      /\.msi$/i,
  exe:      /-setup\.exe$/i,
  dmg:      /\.dmg$/i,
  deb:      /\.deb$/i,
  rpm:      /\.rpm$/i,
  appimage: /\.AppImage$/i,
};

const mb = bytes => `${(bytes / 1e6).toFixed(1)} MB`;

async function hydrate() {
  let assets;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
    if (!res.ok) return;
    ({ assets } = await res.json());
  } catch {
    return;
  }
  if (!Array.isArray(assets) || !assets.length) return;

  const find = key => ASSET[key] && assets.find(a => ASSET[key].test(a.name));

  for (const el of document.querySelectorAll("[data-dl]")) {
    const asset = find(el.dataset.dl);
    if (asset) el.href = asset.browser_download_url;
  }

  for (const el of document.querySelectorAll("[data-dl-meta]")) {
    const asset = find(el.dataset.dlMeta);
    if (asset) el.textContent = `${el.textContent.trim()} · ${mb(asset.size)}`;
  }
}

hydrate();
