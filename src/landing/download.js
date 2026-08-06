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
  windows: { name: "Windows", lead: "The installer for Windows 10 and 11.", to: "#desktop" },
  mac:     { name: "macOS",   lead: "One download for Intel and Apple Silicon.", to: "#desktop" },
  linux:   { name: "Linux",   lead: ".deb, .rpm and AppImage, plus Flathub and the AUR.", to: "#desktop" },
  android: { name: "Android", lead: "No app to install — add it to your home screen from Chrome.", to: "#mobile" },
  ios:     { name: "iPhone or iPad", lead: "No app to install — add it to your home screen from Safari.", to: "#mobile" },
};

const os = detect();
const host = byId("pick");

if (os && host && COPY[os]) {
  const { name, lead, to } = COPY[os];
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

  const alt = document.createElement("p");
  alt.className = "hint";
  alt.textContent = "Not right? Every platform is listed below.";

  card.append(h, p, a, alt);
  host.append(card);
  host.hidden = false;
}
