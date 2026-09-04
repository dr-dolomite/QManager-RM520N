---
name: frozen-pane-freezes-css-transitions-too
description: A hidden Browser pane pins CSS TRANSITIONS at t=0, so getComputedStyle reports a transitioned box-shadow/color as its start value; inject `*{transition:none!important}` before measuring
metadata:
  type: reference
---

The hidden-pane freeze is not only rAF/framer-motion. **CSS transitions are frozen at t=0 too**, and `getComputedStyle` returns the *interpolated start* value, not the declared one.

Concretely: a coverage cell carrying `shadow-[inset_0_0_0_2px_var(--primary)]` plus
`transition-[background-color,color,box-shadow]` read back as
`oklab(0 0 0 / 0) 0px 0px 0px 0px inset` — a transparent, zero-spread shadow — while its own
`--tw-shadow` custom property correctly read `inset 0 0 0 2px lab(46.6 23.9 -82.3)`.
That contradiction (custom property right, computed property wrong) is the tell.

**Why:** the pane runs no frames, so the transition never advances past its first tick, and the
computed value is whatever the animation timeline holds — which for `box-shadow` is the
layer-matched all-zero start.

**How to apply:** before reading any computed value on a property that appears inside a
`transition-[...]` list, inject `*{transition:none !important; animation:none !important}` and
re-read. Geometry (`offsetHeight`, `getBoundingClientRect`) is unaffected and always safe.
Do NOT conclude a token or class "did not apply" from one frozen read. See
[[reference-hidden-browser-pane-freezes-raf]].
