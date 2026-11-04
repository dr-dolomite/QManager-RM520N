#!/usr/bin/env python3
"""Overlay a labelled percentage grid on a screenshot, to place pins and measure gaps.

Usage:
    python pin_grid.py <shot.png> [out.png] [--step 5] [--crop x0,y0,x1,y1]

Writes <shot>.grid.png next to the input by default. Gridlines every --step percent are labelled
with their percentage and pixel position, so a pin's left/top can be read straight off the image.
--crop takes percentages and writes a zoomed crop, which helps when measuring small gaps.
The output is an authoring aid. Never embed it in the artifact.
"""
import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("shot")
    ap.add_argument("out", nargs="?")
    ap.add_argument("--step", type=float, default=5.0)
    ap.add_argument("--crop", help="x0,y0,x1,y1 in percent")
    a = ap.parse_args()

    im = Image.open(a.shot).convert("RGB")
    w, h = im.size
    print(f"image {w}x{h}px (at DPR 1, 1px = 1 CSS px; halve for a 2x capture)")
    if a.crop:
        x0, y0, x1, y1 = (float(v) / 100 for v in a.crop.split(","))
        im = im.crop((int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h)))
        im = im.resize((im.width * 2, im.height * 2), Image.LANCZOS)
        base_x, base_y, span_x, span_y = x0 * 100, y0 * 100, (x1 - x0) * 100, (y1 - y0) * 100
    else:
        base_x, base_y, span_x, span_y = 0.0, 0.0, 100.0, 100.0

    d = ImageDraw.Draw(im, "RGBA")
    try:
        font = ImageFont.load_default(size=15)  # Pillow >= 10.1
    except TypeError:
        font = ImageFont.load_default()
    W, H = im.size
    pct = 0.0
    while pct <= 100.0 + 1e-9:
        if base_x <= pct <= base_x + span_x:
            x = (pct - base_x) / span_x * W
            strong = abs(pct % 10) < 1e-9
            d.line([(x, 0), (x, H)], fill=(255, 64, 160, 170 if strong else 90), width=2 if strong else 1)
            d.text((x + 3, 3), f"{pct:g}% ({int(pct / 100 * w)}px)", font=font, fill=(255, 255, 255, 255), stroke_width=2, stroke_fill=(0, 0, 0, 255))
        if base_y <= pct <= base_y + span_y:
            y = (pct - base_y) / span_y * H
            strong = abs(pct % 10) < 1e-9
            d.line([(0, y), (W, y)], fill=(64, 200, 255, 170 if strong else 90), width=2 if strong else 1)
            d.text((3, y + 3), f"{pct:g}% ({int(pct / 100 * h)}px)", font=font, fill=(255, 255, 255, 255), stroke_width=2, stroke_fill=(0, 0, 0, 255))
        pct += a.step

    out = Path(a.out) if a.out else Path(a.shot).with_suffix(".grid.png" if not a.crop else ".crop.png")
    im.save(out)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
