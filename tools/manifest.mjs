/**
 * Package-manager manifests, generated from one release.
 *
 * Every channel below is the same three facts — a version, a URL, a SHA256 —
 * arranged differently. Written by hand that is eight files to remember per
 * release, which works for two releases and then quietly does not: someone
 * updates Scoop and forgets the tap, and `brew install` starts handing out a
 * version four behind `scoop install`. Generating them is the same argument the
 * rest of this repo already makes about RELAY_HTTP_URL, LINKS and the service
 * worker's precache list.
 *
 *   node tools/manifest.mjs <scoop|homebrew|aur|all> <vX.Y.Z>
 *   node tools/manifest.mjs publish <vX.Y.Z>     open the PRs (CI only)
 *
 * Checksums come from the release assets themselves, so this cannot describe an
 * artifact that was never built.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..");
const OUT = join(ROOT, "dist/manifests");

const OWNER = "akshaynikhare";
const REPO = "Hopboard";
const [, , command, rawTag] = process.argv;

if (!command || !rawTag) {
  console.error("usage: node tools/manifest.mjs <scoop|homebrew|aur|all|publish> <vX.Y.Z>");
  process.exit(2);
}

const tag = rawTag.startsWith("v") ? rawTag : `v${rawTag}`;
const version = tag.slice(1);
const base = `https://github.com/${OWNER}/${REPO}/releases/download/${tag}`;

/**
 * Asset names, as Tauri's bundler emits them.
 *
 * !! These are guesses until the first real release, and they are the most
 * likely thing on this page to be wrong. Tauri's naming has changed between
 * versions and differs per target. Check one actual release page and correct
 * them here rather than in three manifests. !!
 */
const ASSETS = {
  msi: `Hopboard_${version}_x64_en-US.msi`,
  nsis: `Hopboard_${version}_x64-setup.exe`,
  dmg: `Hopboard_${version}_universal.dmg`,
  deb: `hopboard_${version}_amd64.deb`,
  appimage: `hopboard_${version}_amd64.AppImage`,
};

/** SHA256 of a released asset, fetched rather than assumed. */
async function digest(name) {
  const url = `${base}/${name}`;
  const res = await fetch(url);
  if (!res.ok) {
    // Loud, and fatal. A manifest carrying a placeholder checksum installs
    // nothing and tells the user their download is corrupt.
    throw new Error(`cannot reach ${url} (HTTP ${res.status}) — was the release published?`);
  }
  return createHash("sha256").update(Buffer.from(await res.arrayBuffer())).digest("hex");
}

const write = (name, body) => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), body.trimStart());
  console.log(`  wrote dist/manifests/${name}`);
};

/* ------------------------------------------------------------------ scoop -- */

async function scoop() {
  const hash = await digest(ASSETS.nsis);
  write("hopboard.json", `
{
    "version": "${version}",
    "description": "An end-to-end encrypted clipboard shared between your devices",
    "homepage": "https://github.com/${OWNER}/${REPO}",
    "license": "MIT",
    "architecture": {
        "64bit": {
            "url": "${base}/${ASSETS.nsis}#/setup.exe",
            "hash": "${hash}"
        }
    },
    "innosetup": false,
    "installer": { "args": ["/S"] },
    "uninstaller": { "args": ["/S"] },
    "checkver": { "github": "https://github.com/${OWNER}/${REPO}" },
    "autoupdate": {
        "architecture": {
            "64bit": { "url": "${base.replace(tag, "v$version")}/Hopboard_$version_x64-setup.exe#/setup.exe" }
        }
    }
}
`);
}

/* --------------------------------------------------------------- homebrew -- */

async function homebrew() {
  const hash = await digest(ASSETS.dmg);
  // A cask for the app. The CLI is a separate formula and deliberately not
  // bundled into it: somebody automating a server wants `hopboard` on PATH and
  // has no use for a tray icon, and installing a GUI to get a pipe is rude.
  write("hopboard.rb", `
cask "hopboard" do
  version "${version}"
  sha256 "${hash}"

  url "${base.replace(tag, "v#{version}")}/Hopboard_#{version}_universal.dmg"
  name "Hopboard"
  desc "End-to-end encrypted clipboard shared between your devices"
  homepage "https://github.com/${OWNER}/${REPO}"

  depends_on macos: ">= :big_sur"

  app "Hopboard.app"

  # The app writes nothing but its settings. Named explicitly so an uninstall
  # is complete — a clipboard tool that leaves state behind after you remove it
  # has undermined its own pitch.
  zap trash: [
    "~/Library/Application Support/io.github.akshaynikhare.hopboard",
    "~/Library/Preferences/io.github.akshaynikhare.hopboard.plist",
    "~/Library/Saved Application State/io.github.akshaynikhare.hopboard.savedState",
  ]
end
`);

  write("hopboard-cli.rb", `
class HopboardCli < Formula
  desc "Online clipboard on the command line — pipe text between machines"
  homepage "https://github.com/${OWNER}/${REPO}"
  url "https://registry.npmjs.org/hopboard/-/hopboard-${version}.tgz"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match(/^[0-9A-Z]{6}$/, shell_output("#{bin}/hopboard new").strip)
  end
end
`);
}

/* -------------------------------------------------------------------- aur -- */

async function aur() {
  const hash = await digest(ASSETS.appimage);
  write("PKGBUILD", `
# Maintainer: ${OWNER} <https://github.com/${OWNER}>
pkgname=hopboard-bin
pkgver=${version}
pkgrel=1
pkgdesc="End-to-end encrypted clipboard shared between your devices"
arch=('x86_64')
url="https://github.com/${OWNER}/${REPO}"
license=('MIT')
# webkit2gtk 4.1, not 4.0. Getting this wrong produces a package that installs
# cleanly and then fails at launch with a missing symbol, which reads as "the
# app is broken" rather than "the dependency is wrong".
depends=('webkit2gtk-4.1' 'gtk3')
provides=('hopboard')
conflicts=('hopboard')
source=("\\$pkgname-\\$pkgver.AppImage::${base.replace(tag, "v\\$pkgver")}/hopboard_\\$pkgver_amd64.AppImage")
sha256sums=('${hash}')
options=(!strip)

package() {
  install -Dm755 "\\$srcdir/\\$pkgname-\\$pkgver.AppImage" "\\$pkgdir/usr/bin/hopboard"
}
`);
}

/* ---------------------------------------------------------------- publish -- */

function publish() {
  // Deliberately not implemented as a force-push. These files land in
  // repositories other people also read and touch — a tap, a bucket, the AUR —
  // and a bot that pushes to them directly is how a channel acquires a
  // reputation for breaking. The generated files are in dist/manifests/; the
  // release job opens pull requests from them.
  console.log(`
  Manifests for ${tag} are in dist/manifests/.

  Open them as pull requests against:
    hopboard.json      -> ${OWNER}/scoop-hopboard
    hopboard.rb        -> ${OWNER}/homebrew-tap  (Casks/)
    hopboard-cli.rb    -> ${OWNER}/homebrew-tap  (Formula/)
    PKGBUILD           -> aur.archlinux.org/hopboard-bin.git

  Not pushed automatically. See the comment in tools/manifest.mjs.`);
}

const RUN = { scoop, homebrew, aur, publish };

try {
  if (command === "all") {
    for (const fn of [scoop, homebrew, aur]) await fn();
  } else if (RUN[command]) {
    await RUN[command]();
  } else {
    console.error(`unknown command "${command}"`);
    process.exit(2);
  }
} catch (err) {
  console.error(`\n::error::${err.message}\n`);
  process.exit(1);
}
