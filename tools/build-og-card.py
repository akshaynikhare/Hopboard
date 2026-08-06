#!/usr/bin/env python3
"""
Regenerates social/og-card.png — the 1200x630 Open Graph card.

    python tools/build-og-card.py            # writes social/og-card.png
    python tools/build-og-card.py --check    # fails if the file is out of date

WHY THIS FILE EXISTS
--------------------
The card used to be a PNG with no source. When the project was renamed the sweep
updated every string in the repo and could not touch the one place the old name
was actually most visible: the picture every link preview shows. It sat stale
because nothing could tell it had gone stale.

So the name is not written here. It is read out of src/core/config.js, the same
REPO.NAME the app's own links are built from, and --check compares the rendered
bytes against what is on disk. A rename now either regenerates this or fails.

FONTS
-----
Segoe UI and Consolas, matching --ui-font and --mono in src/styles/tokens.css.
Both ship with Windows, which is where this is run. On a machine without them
the card would render in a substitute face and silently stop matching the site,
so a missing font is a hard error rather than a fallback.

The palette is likewise not invented here — every colour is a token from
src/styles/tokens.css, listed next to its name below.
"""

import argparse
import io
import re
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit("Pillow is required:  pip install Pillow")

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "social" / "og-card.png"
CONFIG = ROOT / "src" / "core" / "config.js"

W, H = 1200, 630

# Straight from src/styles/tokens.css. Names kept identical so a token change
# can be grepped to here.
EDITOR = (0x1E, 0x1E, 0x1E)   # --editor   page background
SIDE = (0x25, 0x25, 0x26)     # --side     raised panel
BD = (0x2B, 0x2B, 0x2B)       # --bd       grid rules
BD2 = (0x3C, 0x3C, 0x3C)      # --bd2      input border
TEXT = (0xCC, 0xCC, 0xCC)     # --text
DIM = (0x85, 0x85, 0x85)      # --dim at card scale
BRIGHT = (0xE7, 0xE7, 0xE7)   # --bright   headline and wordmark
BLUE = (0x00, 0x7A, 0xCC)     # --blue     accent bar, icon, bullets
STR = (0xCE, 0x91, 0x78)      # --str      the share key, as in the app
PANEL_HDR = (0x1B, 0x1B, 0x1B)

# The four-column rule grid the original was built on: 72px gutter, 352px
# columns. The layout hangs off these, so they are the only magic numbers.
GUTTER = 72
COLUMN = 352
RULES = [GUTTER + COLUMN * i for i in range(4)]   # 72, 424, 776, 1128
BASELINE_RULE = 534                                # the horizontal one
ACCENT_W = 7                                       # left edge bar

FONTS = Path("C:/Windows/Fonts")
UI = FONTS / "segoeui.ttf"
UI_BOLD = FONTS / "segoeuib.ttf"
UI_SEMI = FONTS / "seguisb.ttf"
MONO = FONTS / "consola.ttf"

HEADLINE = ["An online clipboard for", "every machine you own."]
SUBTITLE = [
    "Copy on your laptop, paste on your phone. Type one five-character",
    "key on each device — no account, no install, end-to-end encrypted.",
]
FEATURES = ["No account", "Works across networks", "Files peer-to-peer", "Open source"]
BADGE = "PRE-ALPHA"
SAMPLE_KEY = "D75LV"   # the throwaway key the tests use; never a real one


def product_name() -> str:
    """REPO.NAME out of config.js — the card follows the app, not a constant here."""
    src = CONFIG.read_text(encoding="utf-8")
    m = re.search(r"\bNAME:\s*[\"']([^\"']+)[\"']", src)
    if not m:
        sys.exit(f"could not find REPO.NAME in {CONFIG}")
    return m.group(1)


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    if not path.exists():
        sys.exit(f"missing font: {path}\nThis card must render in Segoe UI/Consolas "
                 f"to match the site; a substitute face would drift silently.")
    return ImageFont.truetype(str(path), size)


def clipboard_icon(d: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int) -> None:
    """The app icon, redrawn rather than scaled — icons/icon.svg is a stroked
    glyph and downsampling a 512px raster of it to 23px turns the strokes to mud."""
    s = max(2, round(w / 11))
    d.rounded_rectangle([x, y + h * 0.12, x + w, y + h], radius=s, outline=BLUE, width=s)
    tab_w, tab_h = w * 0.52, h * 0.17
    d.rounded_rectangle(
        [x + (w - tab_w) / 2, y, x + (w + tab_w) / 2, y + tab_h * 1.6],
        radius=s * 0.8, fill=BLUE,
    )
    d.line([(x + w * 0.27, y + h * 0.60), (x + w * 0.44, y + h * 0.76),
            (x + w * 0.75, y + h * 0.40)], fill=BLUE, width=s, joint="curve")


def render() -> Image.Image:
    name = product_name()
    im = Image.new("RGB", (W, H), EDITOR)
    d = ImageDraw.Draw(im)

    for x in RULES:
        d.line([(x, 0), (x, H)], fill=BD, width=1)
    d.line([(0, BASELINE_RULE), (W, BASELINE_RULE)], fill=BD, width=1)
    d.rectangle([0, 0, ACCENT_W - 1, H], fill=BLUE)

    # ---- wordmark row -----------------------------------------------------
    clipboard_icon(d, GUTTER + 4, 85, 23, 33)
    f_mark = font(UI_BOLD, 30)
    mark_x = GUTTER + 47
    d.text((mark_x, 87), name, font=f_mark, fill=BRIGHT)

    # The badge trails the wordmark instead of sitting at a fixed x — the whole
    # reason the old card could not simply have its name swapped in place.
    f_badge = font(UI_SEMI, 15)
    bx = mark_x + round(d.textlength(name, font=f_mark)) + 21
    bw = round(d.textlength(BADGE, font=f_badge)) + 22
    d.rounded_rectangle([bx, 93, bx + bw, 115], radius=3, fill=SIDE)
    d.text((bx + 11, 96), BADGE, font=f_badge, fill=DIM)

    # ---- headline and subtitle -------------------------------------------
    f_head = font(UI_BOLD, 62)
    for i, line in enumerate(HEADLINE):
        d.text((GUTTER, 180 + i * 76), line, font=f_head, fill=BRIGHT)

    f_sub = font(UI, 28)
    for i, line in enumerate(SUBTITLE):
        d.text((GUTTER + 1, 360 + i * 40), line, font=f_sub, fill=DIM)

    # ---- session key panel ------------------------------------------------
    px0, px1 = 860, 1128
    d.rectangle([px0, 173, px1, 207], fill=PANEL_HDR)
    d.rectangle([px0, 207, px1, 283], fill=SIDE)
    f_label = font(MONO, 14)
    d.text((877, 182), "SESSION KEY", font=f_label, fill=DIM)

    d.rectangle([876, 228, 1112, 282], fill=PANEL_HDR, outline=BD2, width=1)
    f_key = font(MONO, 34)
    kw = d.textlength(SAMPLE_KEY, font=f_key)
    d.text((876 + (236 - kw) / 2, 238), SAMPLE_KEY, font=f_key, fill=STR)

    d.text((877, 295), "Type this on your other device", font=font(UI, 17), fill=DIM)

    # ---- feature row ------------------------------------------------------
    f_feat = font(UI, 21)
    x = GUTTER
    for label in FEATURES:
        d.rectangle([x, 576, x + 8, 584], fill=BLUE)
        d.text((x + 22, 570), label, font=f_feat, fill=TEXT)
        x += 22 + round(d.textlength(label, font=f_feat)) + 56
    return im


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="exit non-zero if social/og-card.png is out of date")
    args = ap.parse_args()

    buf = io.BytesIO()
    render().save(buf, "PNG", optimize=True)
    fresh = buf.getvalue()

    if args.check:
        if not OUT.exists():
            print(f"{OUT.relative_to(ROOT)} is missing — run tools/build-og-card.py")
            return 1
        if OUT.read_bytes() != fresh:
            print(f"{OUT.relative_to(ROOT)} is out of date — run tools/build-og-card.py")
            return 1
        print(f"{OUT.relative_to(ROOT)} is up to date ({product_name()})")
        return 0

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(fresh)
    print(f"wrote {OUT.relative_to(ROOT)}  {W}x{H}  ({product_name()})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
