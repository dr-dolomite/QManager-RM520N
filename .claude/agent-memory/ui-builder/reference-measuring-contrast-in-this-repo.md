---
name: measuring-contrast-in-this-repo
description: Computed colours come back as lab(), and a class-only theme flip does not repaint a hidden Browser pane — the two traps that silently fake contrast numbers
metadata:
  type: reference
---

Two things make a naive contrast measurement in the Browser pane return confident nonsense.

**1. `getComputedStyle(el).color` returns `lab(...)`, not `rgb(...)`.** `globals.css` ships the
OKLCH tokens inside `@supports (color: lab(0% 0 0))`, so Chrome serialises every resolved colour
as `lab(72.36 -0.68 -4.07)`. A `match(/[\d.]+/g)` parser reads that as r=72 g=-0.68 b=-4 and every
ratio comes out ~1.00 — wrong, and wrong in a way that looks like an opacity bug.
**Fix:** convert through a 1x1 canvas — `ctx.fillStyle = cssColorString; ctx.fillRect(0,0,1,1);
getImageData(0,0,1,1).data` gives real sRGB bytes for any CSS Color 4 string.

**2. Flipping `document.documentElement.classList` does NOT restyle the subtree while the pane is
hidden.** The theme is `.dark` on `<html>` vs bare `:root`. Removing the class repainted `body`
but left `bg-surface-container` at its dark value, so light and dark measured byte-identical.
**Fix:** `localStorage.setItem('theme','light'); location.reload()` — a real load, real recalc.
Verify by reading the ground's rgb (light `surface-container` = 242,244,247; dark = 19,22,27); if
the two runs report the same ground, the flip did not take and the numbers are one theme twice.

**Why:** a hidden pane runs no frames (see [[reference-hidden-browser-pane-freezes-raf]]), so it
also skips the style pass a class mutation would otherwise trigger. Same root cause as the frozen
entrance cascade — and that cascade pins `opacity: 0` inline on every `motion.div`, which makes
every effective-opacity walk return 0. Clear it first with
`document.querySelectorAll('[style*="opacity"]').forEach(el => { el.style.opacity=''; el.style.transform=''; })`.

**How to apply:** any time a brief asks for measured contrast "in BOTH themes". Always print the
resolved background rgb alongside the ratio — it is the only cheap proof the theme actually moved.
