#!/usr/bin/env python3
"""Generate the app icons in assets/ (run once; the PNGs are committed). Needs Pillow + DejaVu fonts."""
import pathlib
from PIL import Image, ImageDraw, ImageFont

out = pathlib.Path(__file__).resolve().parent.parent / "assets"
out.mkdir(exist_ok=True)
GREEN, ACCENT, WHITE = (31, 77, 58), (155, 214, 170), (255, 255, 255)
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

def icon(size, maskable=False):
    s = size * 4  # draw large, then downsample for smooth edges
    im = Image.new("RGB", (s, s), GREEN)
    d = ImageDraw.Draw(im)
    pad = int(s * (0.2 if maskable else 0.1))
    # "TEE" with the double E picked out, so it isn't read as "theology"
    f = ImageFont.truetype(FONT, int((s - 2 * pad) * 0.42))
    parts = [("T", WHITE), ("EE", ACCENT)]
    w = sum(d.textlength(t, font=f) for t, _ in parts)
    x = (s - w) / 2
    y = s * 0.30
    for t, col in parts:
        d.text((x, y), t, font=f, fill=col)
        x += d.textlength(t, font=f)
    # ball on a tee
    cx, r = s / 2, s * 0.075
    by = s * 0.74
    d.ellipse([cx - r, by - r, cx + r, by + r], fill=WHITE)
    d.polygon([(cx - r * 0.9, by + r * 1.05), (cx + r * 0.9, by + r * 1.05), (cx + r * 0.25, by + r * 1.6), (cx - r * 0.25, by + r * 1.6)], fill=ACCENT)
    d.rectangle([cx - r * 0.25, by + r * 1.6, cx + r * 0.25, by + r * 2.6], fill=ACCENT)
    return im.resize((size, size), Image.LANCZOS)

icon(192).save(out / "icon-192.png")
icon(512).save(out / "icon-512.png")
icon(512, maskable=True).save(out / "icon-maskable-512.png")
icon(180).save(out / "apple-touch-icon.png")
print("icons written to", out)
