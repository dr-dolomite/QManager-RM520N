---
name: info-chip-dissolves-on-primary-container
description: Badge variant="info" IS bg-primary-container, the exact fill the Highlight-by-Container Rule gives a promoted row, so an info chip on a promoted row renders as bare text
metadata:
  type: reference
---

`Badge variant="info"` resolves to **`bg-primary-container text-on-primary-container`**
(the Info-Is-Brand Rule — info does not own a second blue). The Highlight-by-Container
Rule promotes an emphasised row to **`bg-primary-container`** with the same ink. They
are the same two tokens, so **an `info` chip sitting on a promoted row loses its fill
entirely** and renders as a glyph plus a word. Nothing lints it, the ink stays legible,
and it survives review as "the chip is fine" — it is only the chip FORM that is gone.

The collision is structural, not incidental: it fires on any surface that puts a status
chip inside a `primary-container` block (the Tracked SIMs active row; the alignment
recorder's winning position row is the same shape). `muted`, `success`, `warning` and
`destructive` do not collide — only `info`.

**The fix that measures right:** re-ground the chip on the row's own ink,
`bg-on-primary-container/20`, applied by className only on the promoted row. The alpha
is not taste — a stock `info` chip on a plain `bg-surface` card measures **1.39:1**
fill-vs-ground, and `/20` lands the re-grounded chip at **1.41:1**, i.e. parity with how
that chip reads everywhere else. Its own ink stays at 5.77:1 (light) / 4.90:1 (dark).
`/10` and `/12` measure 1.18 and 1.22 and read as a tint, not a chip.

Related: the same host problem hits **dim ink**. `text-on-surface-variant` is measured
against the card ground, so on a `primary-container` row it must be replaced by an
inherit-plus-`opacity-90` (the shape `components/monitoring/alerts/activity-row.tsx`
already uses). Measured 6.63:1 on the promoted row, 8.50:1 for the neutral token on the
resting row. See [[reference-measuring-contrast-in-this-repo]] for the canvas conversion
these numbers need — `getComputedStyle().color` is `lab()` here.
