---
target: Cellular and Radio Information hero strip
total_score: 22
max_score: 36
na_heuristics: 5
p0_count: 1
p1_count: 3
timestamp: 2026-08-16T04-25-37Z
slug: components-cellular-radio-summary-tiles-tsx
---
⚠️ DEGRADED: single-context (project instruction forbids launching sub-agents unless the user requests them)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | SINR renders 250 dB badged "Excellent" with a full green bar — a sentinel leaking into the quality scale |
| 2 | Match System / Real World | 3 | Solid; "No 5G leg attached" is real technician language |
| 3 | User Control and Freedom | 3 | Read-only surface; MIMO row links out, Copy diagnostics present |
| 4 | Consistency and Standards | 2 | Hero is a 212px anchor+box while every sibling /cellular/ page still uses the 92px 4-tile TILE_SHAPE strip |
| 5 | Error Prevention | n/a | Nothing on this surface is submittable |
| 6 | Recognition Rather Than Recall | 3 | Labels are explicit; no icon-only affordances |
| 7 | Flexibility and Efficiency | 2 | No keyboard accelerators; Copy diagnostics is the only power path |
| 8 | Aesthetic and Minimalist Design | 1 | 132,033px² anchor at 7.2% ink coverage; ~690px void in every row |
| 9 | Error Recovery | 3 | Condition screens with retry are genuinely good |
| 10 | Help and Documentation | 3 | Inline captions, cell-scanner nudge, estimated-distance tooltip |
| **Total** | | **22/36** | **Acceptable (61%)** |

## Design Specificity Verdict

Authored, not generic — the strip could not be lifted into another product without rewriting its semantics. But it is currently authored around a constraint (only one figure has an honest hue) rather than around its content, and that shows.

**Deterministic scan**: `detect.mjs --json components/cellular/radio/` → `[]`. Clean. Every finding below is compositional and invisible to the detector.

**Measured on the live device (1914px viewport, dark):**
- anchor 623×212 = 132,033px²; true ink (disc + badge + glyphs) = 9,526px² = **7.2%**
- 53px vertical void between disc bottom and value top
- label→value void per box row: 669 / 700 / 692px = **~75% of each row's width**
- dark `--lte` = oklch(0.8 …) against a page ground of oklch(~0.19) — the largest object on the page is also the brightest

## Overall Impression

The user's read is right but the cause is one level down. The anchor is not too big; it is too *empty*, and it is empty because its height is not its own — it is slaved to whatever the box beside it happens to contain. Add a fourth row and the purple gets emptier without anyone touching it. That is a structural fault, not a sizing preference.

Second, the strip uses `bg-lte`, the **strong fill**, across 132,000px². Material 3 spends strong fills on compact emphasis (FABs, chips, selected states) and gives large surfaces **containers**. In dark mode this inversion is at its worst: `--lte` is a light violet, so the least informative object on the page is the brightest.

Third, and least noticed: the box is exactly as low-density as the anchor. Every row puts its label at the far left and its value at the far right of a 921px track, leaving ~690px of nothing between them. The strip is void everywhere; the purple is merely where the eye registers it.

## What's Working

- **The colour discipline itself.** Refusing NR blue and LTE violet on bandwidth/MIMO because those figures span both radios is correct and load-bearing. Do not solve emptiness by re-tinting.
- **Grouped rows over peer tiles.** The box is the right Material primitive and the bare `on-surface-variant` category glyphs read properly as a list.
- **Condition screens.** Replacing the body outright on no-SIM / no-service instead of rendering the loaded layout full of dashes is better than most shipped instruments.

## Priority Issues

**[P1] The anchor's height is inherited, not earned.** 7.2% ink over 132,033px². Its 212px comes from three 60px rows in a sibling element. *Fix:* give the anchor an intrinsic height (slim band or narrow rail), or give it content proportionate to its area. *Command:* `/impeccable layout`

**[P1] Strong fill at hero scale inverts the page's attention economy.** Large surfaces take container tones in M3; `bg-lte-container` at the same footprint reads as tonal Material instead of a colour swatch. *Command:* `/impeccable quieter`

**[P1] ~690px of void per row.** 75% of each 921px row is empty. Two-column rows at ≥`@3xl` halve the void and let a fourth figure in at no height cost. *Command:* `/impeccable layout`

**[P2] Triple redundancy in the anchor.** Violet fill + "4G" badge + the word "LTE" state one fact three ways within 120px. Emptiness is partly repetition wearing a large coat.

**[P2] Family inconsistency.** Sibling /cellular/ pages still use the 92px 4-tile `TILE_SHAPE` strip. Whatever ships here should either propagate or be justified as anchor-only.

**[P0 — out of scope, real defect] SINR 250 dB rated "Excellent".** Valid LTE SINR is roughly -20…+30 dB. A sentinel is reaching the quality scale and being painted as a full green bar next to a genuinely poor RSRP of -117 dBm. On a diagnostic page this is the worst possible failure mode.

## Persona Red Flags

**Alex (power user)**: opens this page to read RSRP fast. The largest, brightest object tells them something they already knew from the sidebar. Real news (-117 dBm, poor) is below the fold-adjacent Spectrum card.

**Sam (accessibility)**: the anchor's caption uses `opacity-85` on a fill rather than a token pair — survivable, but it is contrast by arithmetic, not by design. The `sr-only` "Network type" label is correctly handled.

**Riley (stress tester)**: found the SINR 250 case in one glance. Also: a two-leg MIMO value drops a type step to fit the pinned row — correct — but the anchor has no equivalent pressure valve, so a longer locale string is the only thing that would ever fill it.

## Minor Observations

- The `4G` badge sits in the anchor's top-right corner with 500px of fill between it and the disc; at that separation it reads as a floating tag rather than as part of the identity block.
- Bandwidth's single-carrier row collapses to one line while its neighbours are two — correct, but it makes the middle row visibly lighter than the ones above and below it.

## Questions to Consider

- If the anchor were 76px tall, would anyone miss the 136px that went away?
- What is the largest object on this page allowed to be *about*? Right now it is about identity; the page is about signal quality.
- Would this strip survive if the box gained a fourth figure — or does the composition only work at exactly three?
