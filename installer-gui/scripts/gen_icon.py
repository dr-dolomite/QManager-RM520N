"""Rasterize the QManager "Tonal Q" mark into installer-gui/assets/app.ico.

One-off asset generator, not a runtime or build dependency — run manually
(inside any venv with `pillow` installed) when the source mark's geometry
in public/qmanager-mark.svg changes. Pillow has no SVG decoder, so rather
than pull in a heavier SVG-rasterization stack (cairosvg needs a native
cairo build that isn't available out of the box on Windows; svglib's
reportlab backend hits the same wall), this reimplements the mark's exact
geometry directly in Pillow draw calls — the SVG itself documents that
geometry in public/qmanager-mark.svg's header comment (ring centreline
r=18.5 weight 7, tail a 45deg ray from centre to r=23.5 weight 7 round
cap, notch = the tail path stroked at 14 and masked out of the ring).
Keep the two files in sync by eye; there is no automatic check.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE.parent / "assets"
SIZES = (16, 24, 32, 48, 64, 128, 256)
SUPERSAMPLE = 8

# Geometry from public/qmanager-mark.svg, on its native 48x48 grid.
GRID = 48
CENTER = (24.0, 24.0)
RING_CENTERLINE_R = 18.5
RING_WEIGHT = 7.0
TAIL_END = (40.617, 40.617)
TAIL_WEIGHT = 7.0
NOTCH_WEIGHT = 14.0

RING_COLOR = (0x2B, 0x7F, 0xFF, 0xFF)
TAIL_COLOR = (0x14, 0x47, 0xE6, 0xFF)


def _stroke_mask(size: int, scale: float, p0: tuple[float, float], p1: tuple[float, float], weight: float) -> Image.Image:
    """A round-capped line stroke as a white-on-black L-mode mask."""
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    x0, y0 = p0[0] * scale, p0[1] * scale
    x1, y1 = p1[0] * scale, p1[1] * scale
    w = weight * scale
    draw.line([(x0, y0), (x1, y1)], fill=255, width=max(1, round(w)))
    r = w / 2
    draw.ellipse([x0 - r, y0 - r, x0 + r, y0 + r], fill=255)
    draw.ellipse([x1 - r, y1 - r, x1 + r, y1 + r], fill=255)
    return mask


def render(size: int) -> Image.Image:
    canvas = size * SUPERSAMPLE
    scale = canvas / GRID

    # Ring: filled annulus (outer circle minus inner circle).
    ring_mask = Image.new("L", (canvas, canvas), 0)
    draw = ImageDraw.Draw(ring_mask)
    cx, cy = CENTER[0] * scale, CENTER[1] * scale
    outer_r = (RING_CENTERLINE_R + RING_WEIGHT / 2) * scale
    inner_r = (RING_CENTERLINE_R - RING_WEIGHT / 2) * scale
    draw.ellipse([cx - outer_r, cy - outer_r, cx + outer_r, cy + outer_r], fill=255)
    draw.ellipse([cx - inner_r, cy - inner_r, cx + inner_r, cy + inner_r], fill=0)

    # Notch: cut the tail's own path (stroked wide) out of the ring.
    notch_mask = _stroke_mask(canvas, scale, CENTER, TAIL_END, NOTCH_WEIGHT)
    notch_pixels = notch_mask.load()
    ring_pixels = ring_mask.load()
    for y in range(canvas):
        for x in range(canvas):
            if notch_pixels[x, y]:
                ring_pixels[x, y] = 0

    # Tail: the round-capped ray, drawn solid on top, unmasked.
    tail_mask = _stroke_mask(canvas, scale, CENTER, TAIL_END, TAIL_WEIGHT)

    layer = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    ring_layer = Image.new("RGBA", (canvas, canvas), RING_COLOR)
    layer = Image.composite(ring_layer, layer, ring_mask)
    tail_layer = Image.new("RGBA", (canvas, canvas), TAIL_COLOR)
    layer = Image.composite(tail_layer, layer, tail_mask)

    return layer.resize((size, size), Image.LANCZOS)


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    images = [render(size) for size in SIZES]
    ico_path = OUT_DIR / "app.ico"
    images[0].save(
        ico_path,
        format="ICO",
        sizes=[(im.width, im.height) for im in images],
        append_images=images[1:],
    )
    png_path = OUT_DIR / "app-256.png"
    images[-1].save(png_path, format="PNG")
    print(f"Wrote {ico_path} ({[im.size for im in images]}) and {png_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
