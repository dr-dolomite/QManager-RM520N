---
target: Radio Information hero colour system
total_score: 22
max_score: 36
na_heuristics: 3
p0_count: 2
p1_count: 2
timestamp: 2026-08-16T07-57-51Z
slug: components-cellular-radio-summary-tiles-tsx
---
Method: dual-agent (A: colour design review · B: detector + measured colour). Isolated until synthesis.

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Freshness/stale marker lives one card below; hero renders frozen figures at full confidence |
| 2 | Match System / Real World | 3 | Audience vocabulary is right; MIMO string gets no gloss |
| 3 | User Control and Freedom | n/a | Read-only glance surface; one caption link |
| 4 | Consistency and Standards | 2 | Identity chip renders 1.00:1 on its own tile; cyan means upload AND counts |
| 5 | Error Prevention | 3 | Total NETWORK_TILE record; hasBandwidth refuses 0 MHz for null |
| 6 | Recognition Rather Than Recall | 2 | Four hues encode four axes with no legend anywhere in the product |
| 7 | Flexibility and Efficiency | 2 | Every hero figure restated below; the tinted copy is the redundant one |
| 8 | Aesthetic and Minimalist Design | 2 | Four tiles, equal saturation, identical geometry, no focal point |
| 9 | Error Recovery | 3 | states.tsx: per-condition tone AND distinct glyph, retry |
| 10 | Help and Documentation | 2 | Nothing explains azure or 1x2 |
| **Total** | | **22/36** | **Acceptable (61%)** |

Flat vs prior 22/36. The prior run lost points to the Gen-2 anchor and the SINR sentinel (both fixed, scored up); the colour expansion gave back exactly what the layout fix earned.

## Design Specificity Verdict

Authored in its reasoning, category-interchangeable on screen. The token layer is unmistakably this product's (--downlink 341 exists because download was borrowing NR blue; --lte-container dropped 0.045 L because NR/LTE were one object under protanopia). What renders is four equal-weight pastel tiles above two grey cards, reachable by any team with a token file. The thesis renders on the CA strip and the speedtest dialog, not here.

Deterministic scan: components/cellular/radio = 0 findings, clean. components/cellular = 5, components/dashboard = 6, all design-system-font-size advisory; 8 of 11 are false positives (hero numerals in centralised shapes.ts constants). Every issue below is compositional and detector-invisible.

Browser: no screenshots (/cellular/ needs live modem data and client-side auth; no fixture route built). Substituted the compiled stylesheet the dev server actually served, which revealed that Lightning CSS downlevels every token to lab() plus an sRGB hex, and its gamut mapping is not naive clipping. Shipped values differ from declared, in the wrong direction.

Headline measurement: strong fills collapse in 0/10 pairs in both themes. Container tones collapse in 10/45 light and 5/45 dark. Every real problem is in the container layer.

## What's Working

1. states.tsx refuses to render confidence over absent data, with per-condition distinct glyphs. success/warning containers confirmed at 1.03:1 light, 1.01:1 dark, so the glyph-mandatory rule is measurably load-bearing.
2. Strong fills are the healthiest layer: 0/10 collapses. Confining them to the 52px discs was right, and it makes the recommended fix cheap.
3. Token comments record rejected alternatives with numbers (hue ~110, dark L 0.76, the --primary-container outlier). Safe for a future maintainer to touch.

## Priority Issues

### [P0] Identity chip invisible on its own tile

summary-tiles.tsx:194 tile = bg-primary-container text-on-primary-container. badge.tsx:88 nr = bg-primary-container text-on-primary-container, border-transparent. 1.00:1. Same for the LTE branch (:207 vs badge.tsx:91). The header comment at :174 claims inversion; the code does not invert. Inversion IS visible in the degraded branch (NEUTRAL_TILE + variant muted), so the broken state shows a chip and the healthy state does not.

Fix: on a tinted tile the mark takes the inverted pair matching the disc. Add nr-strong / lte-strong to badgeVariants so tone maps keep keying onto BadgeVariant.

### [P0] Released carrier and active LTE carrier are one swatch under deuteranopia

Shipped hexes: --lte-container vs --surface-container-high = 0.0000 deutan separation. Adjacency confirmed on three surfaces:

- carrier-aggregation.tsx:57,69 - released chip surface-container-high beside active LTE lte-container, same strip
- cell-scanner/shapes.ts:779-780 - idle and lte are consecutive entries in ONE tone map
- public/overview/band-rows.tsx:128,195,256 - same pairing pre-auth

Fix: the state distinction cannot rest on that pair. A non-chromatic mark for released (glyph, strikethrough, opacity) is the route that survives.

### [P1] The two tiles that physically touch are the closest pair in the system

Dark --uplink-container vs --spatial-container: 0.0503 declared, 0.0388 gamut-mapped, i.e. below the 0.05 floor as shipped. Light: 0.0205 under deuteranopia. Normal-vision distance 0.0475, so near-identical before any simulation runs. These are hero tiles 3 and 4, 14px apart.

### [P1] Four hues carry six meanings, and DESIGN.md says so

DESIGN.md:367 "Uplink Cyan - the upload direction, and counts." :374 "Downlink Rose - the download direction, and capacity." The Carriers tile is cyan while reporting nothing about upload, two clicks from live-latency.tsx where the same cyan means upload beside arrow_upward. Structurally identical to the blue-means-download defect this restructure existed to fix.

Fix: make the Carriers tile neutral and delete "and counts" / "and capacity" from DESIGN.md, or name capacity as its own axis.

### [P2] --primary means six things

public/overview/tone.ts:106-107 excellent and good both use tone primary, so an LTE-only user sees an excellent-signal tile in the 5G container. fplmn-card.tsx:114 clean uses tone primary with check_circle. Both violate Identity-Never-Acts. Fix: both to success; the glyphs already differ from their siblings.

## The one change that fixes most of this

Tint the Network tile only; keep all four tinted discs. Tiles 2-4 take NEUTRAL_TILE bodies and retain bg-downlink / bg-uplink / bg-spatial discs. About 15 lines. It resolves the uplink/spatial 0.0388 adjacency (no longer adjacent tinted surfaces; their fills measure 0.0608 apart), the no-focal-point failure (the focal point becomes the only tile whose colour changes with the data), and drops tinted area from ~161,800px2 to ~40,500px2. Gen 2 was killed at 132,033px2, so the current strip ships 1.22x the area it was rejected at. The axis vocabulary survives exactly where measurement says colour still works.

## Persona Red Flags

Alex (power user): learned violet=LTE and blue=NR from the CA strip two inches below, then meets cyan and azure blocks that are not radios.

Sam (accessibility): dark container tints carry zero information by the codebase's own measurement; the identity chip meant to back the hue up is 1.00:1; released and active carriers are one swatch.

Rosa (rooftop field tech, from PRODUCT.md): below @xl the grid is one column - four stacked 104px tiles, ~470px, a full phone screen before RSRP. In direct sun, four containers at L 0.84-0.9 are four pale greys. The four-axis system is invisible on her primary device.

## Minor Observations

- --warning / --warning-foreground = 4.15:1 in light mode, which FAILS AA for normal text. Only failing pair of 138 checked. Currently shipped.
- 87 declared oklch() values fall outside sRGB; Lightning CSS gamut-maps them, and its output made light-container separation worse than the declared values predicted (10 collapses vs 8). Measure the shipped hex, not the source.
- live-latency.tsx:814,846,850 use 11px and 17px inline; 11px is below the smallest ramp step.
- summary-tiles.tsx:145 uses opacity-85 on tinted tiles but text-on-surface-variant on the neutral one - two mechanisms for one hierarchy step, and an unmeasured alpha.
- The 40-Degree Rule's one-directional amendment needs a COUNT cap, not just a separation cap; that pressure is what produced this strip.

## Questions to Consider

1. Your own measurement says the dark body tints are decoration; DESIGN.md lists decorative colour as an anti-reference. Which are you retiring?
2. Gen 2 failed at 132,033px2 of tint. Gen 4 ships ~161,800px2. What number would have made Gen 4 fail its own test?
3. If Spatial exists because MIMO names both radios, why does the carrier count get Uplink Cyan instead of the same treatment?
4. Name the surface where a user can learn that azure means antennas.
