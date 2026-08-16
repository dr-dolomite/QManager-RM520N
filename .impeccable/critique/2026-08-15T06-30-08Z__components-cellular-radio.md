---
target: Spectrum in Use card + Radio Information hero
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
timestamp: 2026-08-15T06-30-08Z
slug: components-cellular-radio
---
Method: dual-agent (A: design review · B: detector + repo gates)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Page polls ~4s with zero liveness signal; `isStale` silently freezes the carrier list and renders nothing |
| 2 | Match System / Real World | 3 | 3GPP vocabulary is correct, but `arfcnLabel` is a hardcoded English literal beside a translated `PCI` |
| 3 | User Control and Freedom | 2 | Band reference is all-or-nothing, un-persisted; no sort/pin/manual refresh |
| 4 | Consistency and Standards | 2 | `ReferenceField` sets label sans + value mono; the meta line 200px above sets both mono |
| 5 | Error Prevention | 3 | null≠0% bars, Derived/Estimated markers, released carriers retained — docked for the invisible freeze |
| 6 | Recognition Rather Than Recall | 2 | The meta line's heuristic, and it fails it: unlabelled key/value at ragged x-offsets |
| 7 | Flexibility and Efficiency | 2 | `CopyButton` exists but not on PCI/ARFCN — the two values a tech actually retypes |
| 8 | Aesthetic and Minimalist Design | 2 | Tile strip restates the card's own description; network tile says "5G" twice |
| 9 | Error Recovery | 3 | Low-SNR notice states the reading and refuses the causal claim; fires on SINR only |
| 10 | Help and Documentation | 3 | Derived/Estimated tooltips are best-in-class; no gloss for PCI/EARFCN |
| **Total** | | **24/40** | **Acceptable — significant improvements needed** |

## Design Specificity Verdict

**Split, and starkly.** The Spectrum in Use card is genuinely authored for this product — `worstSignalQuality()`, barless RSSI, `percent: null` refusing a zero-width bar, PCI banned as a React key because the live device reports PCI 295 on both LTE carriers. Could not be reskinned for a CRM.

The hero is not. Glyph disc → eyebrow → big number → caption, four saturated tiles, is the exact composition PRODUCT.md names as an anti-reference ("the hero-metric template… if the page could be reskinned for a CRM or a project tracker without changing anything, it has failed"). Only the network-type tile carries real product thinking. DESIGN.md blesses the strip, but that section was *derived from this shipped code* — it ratifies, it does not justify.

**Deterministic scan:** detector exit 0, zero findings across `components/cellular/radio` and `cellular-information.tsx`. Liveness proven by widening to `components/` (21 findings, exit 2). `i18n:check` passes 0 errors / 11 advisory passthrough warnings. No motion-scale bypasses, no hardcoded user-visible literals. One mechanical nit outside the detector's rules: `cellular-information-card.tsx:245` carries a duration-less `transition-colors`.

The detector's silence is meaningful and limited: this surface is mechanically clean, and every issue below is a judgment call no rule catches.

## Overall Impression

The card is a 9; the hero is a 4 wearing the card's color tokens. The single biggest opportunity is the meta line — not because it is the worst thing on the page, but because it is the one the user already sensed, it recurs 3–5 times per screen, and the fix is free in both height and canon.

## What's Working

1. **The honesty machinery, and it is systematic rather than incidental.** `percent: null` refusing a zero-width bar, the `Derived` marker on inferred SCS, `Estimated` on TA distance — both built as focusable buttons with the caveat placed *before* the number. PRODUCT.md Principle 3 implemented rather than asserted.
2. **The cadence split is a non-obvious IA insight.** Splitting Spectrum (moves every poll) from Connection Details (moves on handover) rather than by symmetry, then deleting the height lock. The two deleted rows show the same discipline applied against the authors' own prior work.
3. **`ROLE_CHIP` is correct restraint** — a neutral pill deliberately *not* a status variant, because it labels which carrier a row is, not how it is doing.

## Priority Issues

### [P0] Removing the quality chip deletes the "Released" label with it — FIXED IN THIS CHANGE
`chipText` was the only render site of `radio_info.bands.released`. DESIGN.md makes carrier retention a named contract. A retained carrier with no label reads as an active carrier whose metrics went blank. **Fix applied:** chip survives for released carriers only; aggregate quality moved to the row's accessible name.

### [P1] The meta line: `PCI 407    EARFCN 9485`
**Why it matters.** Four compounding faults: (a) it sets human-authored labels in the machine voice, violating the Machine-Voice Rule verbatim — "a human-authored label never wears it"; (b) label-then-value in one run has no weight/case/ink/size change, so only prior knowledge marks the key; (c) PCI is 1–4 digits, so the second fact starts at a different x on every row, on a card whose own thesis is "they scan the column" and whose `METRIC_GRID` is fixed-column *specifically* so RSRP lands at the same offset; (d) absence is silent — a null PCI lets EARFCN slide left into its slot, same position, different meaning.
**Fix.** Two-column grid, sans label + mono value, per-field `TickingValue`, explicit `Not reported`. Row height unchanged at 82px. Move `arfcnLabel` behind an i18n key.
**Suggested command:** `/impeccable layout`

### [P1] Stale data renders at full confidence with nothing saying so
`isStale` has no visual output since the freshness chip was cut — it only freezes the carrier list. `radio_info.bands.stale` ("Readings paused") already ships, translated, with zero consumers.
**Fix.** Don't reinstate the vetoed page-level chip. Swap the Spectrum card's description line via `SwapLabel` when stale — mark the surface that actually froze.
**Suggested command:** `/impeccable harden`

### [P2] Two tiles wear an identity hue that contradicts what they report
Active MIMO is `lte-container` but reports *both* radios; Bandwidth is `primary-container` (NR blue) but sums across LTE and NR. The Functional-Color Promise binds violet to LTE. The hue came from a comp's `--sc` variable and then acquired a semantic token name it does not honor.
**Fix.** Make Bandwidth and Active MIMO neutral. Keep the network-type identity fill and the cyan count.
**Suggested command:** `/impeccable colorize`

### [P3] Three consistency self-collisions
`radio_info.tiles.carriers.caption` uses a literal U+00B7 middle dot — the No-Dot-Separator Rule violated on the same screen the rule was written for. `radio_info.common.not_available` is a bare em dash at 20px/600 as a headline value, not `aria-hidden`, announced as "em dash". DESIGN.md still documents this page as a "symmetric 2-up"; it has been a single-column cadence stack since the rewrite.

## Persona Red Flags

**Alex (power user):** Cannot tell live from frozen; will reload a polling page. Cannot copy a single PCI/ARFCN though `CopyButton` ships on this very page. `buildDiagnosticsText` excludes Cell ID/TAC by design — defensible, but he'll discover it after posting.

**Sam (accessibility):** `aria-live="polite"` wraps the entire `@container/main` over a ~4s poller — every metric on every carrier queues an announcement. Band rows were undifferentiated `motion.div`s with no boundary (now `role="group"` + label). The meta line is the page's worst-case text: 12px mono `on-surface-variant`, the hardest glyphs in the system on a tablet in sun — a deployment condition PRODUCT.md names.

**Field tech / hobbyist:** On a phone the tiles stack to four full-width saturated blocks — the first screen is entirely color reporting no health, against a promise of "clarity within thirty seconds". The band reference re-collapses on every navigation, and it is the one control a focused session toggles. The page never says what to do about a bad carrier: the only outbound link is the scanner, which is for carriers the modem *isn't* using.

## Minor Observations

- The `metaLine` comment says "three facts"; bandwidth moved to the disclosure, so it is two. The stale comment is the one defending the design under review.
- One `TickingValue` keyed on the joined line means a handover that moves only PCI flashes both.
- `bandLabel()` lowercases NR bands with a correct 3GPP rationale; `buildDiagnosticsText` does not. Same fact, two spellings, one page.
- `radio_info.header.cadence` and `radio_info.bands.stale` ship with zero consumers.
- "Show band reference" uses a `visibility` eye — reads as *preview*; `expand_more/less` matches what happens.
- Bandwidth caption renders `20 + 20 + 100`, unitless — reads as arithmetic.
- Network tile prints "5G" in a badge then "5G NR + LTE" at `text-xl truncate` in a quarter-width tile. It will truncate in English.

## Connection Details (liked — shape stays)

Extend `CopyButton` to Cell ID, eNodeB/gNodeB and TAC; it is confined to the four addressing rows where values are *least* likely to be retyped. The eNodeB/Sector split pair loses its pairing when the grid collapses to one column. Nothing else — the three-eyebrow grouping, pill rows, `Not assigned` vs `Not reported` as distinct answers, and marker-before-number tooltips are all correct. The Spectrum card should be borrowing *from* this card.

## Questions to Consider

1. If you deleted all four summary tiles tomorrow, what question would stop being answerable?
2. The card still computes `EnrichedCarrier.quality`. Should it be the row's *ordering key*, so the dragging leg floats to the top?
3. Why is PCI in the live card and Cell ID in the reference card, when both move on the same event? Is the split cadence, or "things next to a bar"?
4. The page polls every ~4s and shows nothing that says so. Is that calm, or silent?
5. DESIGN.md's tile section was derived from this page's code. When canon is written from the artifact, what stops a 2am decision from becoming a Named Rule?
