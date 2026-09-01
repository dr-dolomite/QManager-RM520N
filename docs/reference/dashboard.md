# Dashboard (`/dashboard`)

> **Status: contract approved 2026-09-01, adoption pass in progress.** Rows marked
> **_lands in this pass_** describe the target the approved plan establishes and are
> **not yet true of the code**. Rows marked **shipped** are true today. A row flips
> only when the code matches — same discipline as `DESIGN.md`'s Migration Deltas.
> **Applies to:** RM520N-GL. The surface is poller-fed and RM520N-only.

The dashboard is the product's **glance surface**: the mid-day check that answers *is it
up, how good is it, and did anything happen while I was away* in seconds, usually on a
phone beside the modem. It is also the surface `DESIGN.md` was originally written from,
which is the single most important thing to know before editing it — several of its
constructions **are** the canon's worked examples, and rewriting them is churn rather
than a win.

Two sibling docs already own halves of this surface and are **not** superseded:
[`dashboard-chart-cards.md`](dashboard-chart-cards.md) (Device Metrics, Live Latency,
Signal History — the recharts contracts) and
[`dashboard-state-motion.md`](dashboard-state-motion.md) (the tick cascade, the chip
morph, the save flow). This doc owns everything else: composition, the shape module, the
three-state contract, and which parts are load-bearing.

## Quick Reference

| Item | Value |
|------|-------|
| Route | `app/dashboard/page.tsx` → `components/dashboard/home-component.tsx` |
| Shell | `components/dashboard/home-component.tsx` — grid, cascade, page banner |
| Shape module | `components/dashboard/shapes.ts` — *lands in this pass* |
| Page header | `components/dashboard/page-header.tsx` — *lands in this pass* |
| Cards | 9 widgets across 12 files, ~6,300 lines |
| Signal rows | `components/dashboard/signal-rows.ts` — `buildSignalRows(family, data, t)`; *lands in this pass* |
| Data source | `useModemStatus()` (poller cache) + `useAboutDevice()` |
| Poll cadence | Tied to `connectivity.history_interval_sec` + 250 ms; **measured ~3.7–4.0 s** |
| Icon library | **Material Symbols Rounded** (route-scoped), with three recorded exceptions |
| i18n namespace | `dashboard` |
| Design canon | `DESIGN.md` — Layout, Motion > Entrances, Components > Tiles / Metric rows |
| Harness | `scripts/test/dashboard-design-language.sh` — *lands in this pass* |

---

## Composition

**Bento, and it stays bento.** A 5-column container grid (`@4xl/main:grid-cols-5`) with
a 3-column left stack and a 2-column right rail, then full-width rows beneath. This
layout, its orbs and its motion character are **preserved by explicit user request** and
recorded as such in `PRODUCT.md` > Brand Commitments. Do not restructure it.

Reading order, top to bottom:

| Band | Contents | Span |
|------|----------|------|
| Header | Page title, description, and the Radio / Internet / Stale rail | full |
| Top | Network Status hero + the NR / LTE pair (left, 3 cols) · Device Information (right, 2 cols) | full |
| Aggregation | Carrier Aggregation strip | full |
| Trio | Device Metrics · Live Latency · Recent Activity | full |
| History | Signal History | full |

**The page header is not optional** *(lands in this pass)*. The dashboard was for a long
time the only feature route in the product without one, and it compensated by inflating a
card `h3` to `text-[30px]` — the Display step `DESIGN.md` reserves for the page title,
"one per route". Three cards had climbed to page-title size as a result. The header
restores the address and lets every card sit at the 18px Title step.

**The chip rail is page-level, not card-level** *(lands in this pass)*. Radio, Internet
and Stale answer *"is the whole thing up?"*, which is a question about the route rather
than about Network Status. They render through the header's `rail` slot.

> ℹ️ This **upholds** the existing reasoning in `network-status.tsx`. That comment argues
> against promoting the Stale chip to a **`Banner`** — "promoting it to a banner would
> cry wolf" — and a page-header chip is not a banner. `/cellular/settings/apn-management`
> is the precedent for a header chip reporting a live fact.

---

## The shape module

`components/dashboard/shapes.ts` is the family's single home for geometry, control
heights, glyph sizes and tone maps — the fourteenth such module in the tree, on the same
conventions as `components/local-network/ethernet/shapes.ts`.

**It exists because the surface had the exact failure set the rule was minted for**, none
of it visible in any single file:

- **Five copies of the card shell**, across `carrier-aggregation`, `device-metrics`,
  `live-latency`, `recent-activities` and `signal-history` — plus two more inlined in
  `signal-status-card` and `device-status`. Two of the five disagreed: `px-7` on cards
  that are grid **peers**, `px-6` on their neighbours in the same row.
- **Skeletons restating numbers they cannot see** — `h-[41px]` against a live
  `px-[15px] py-2.5 text-sm` row, `h-[62px]` against a `px-4 py-3` tile.
- **One constant declared twice** — `CLOCK_TICK_MS = 30_000` in two cards.

> ⚠️ **Geometry is restated across sibling families, never imported between them.** The
> dashboard's `TILE` restates `components/cellular/tile-shape.ts`'s values rather than
> importing them; the two are dimensionally identical today and are allowed to diverge
> tomorrow. Anything genuinely product-wide is promoted to `components/ui/`, not shared
> sideways.

### The `px-6` / `px-7` resolution

`px-6` is the **peer** card and `px-7` is the **hero**. Signal History ships `px-7` today
and is a peer, so it moves. The two heroes are Network Status and Carrier Aggregation.

---

## Tiles, rows and lanes

The surface uses three repeating units, and the canon owns all three.

- **Metric row** — a 40px full-round pill on `surface-container`, 16px horizontal, a
  13px/600 `on-surface-variant` key against a 13px value. **The `/5` leading is not
  optional**: 13px is an arbitrary Tailwind size, so without an explicit line box it
  inherits whatever leading the card sits in and the row stops being 40px — which
  silently breaks the skeleton's `h-10` mirror.
- **Tile** — 28px radius, **pinned** `h-[6.5rem]` (104px), a 52px full-round glyph disc
  beside eyebrow → value → caption. **A tile body is neutral; the disc carries the
  colour.** A `min-h-` on a *tile* is a bug, not a lenient pin: a floor cannot be a
  mirror.
  > ⚠️ **But not every `min-h-` on this surface is that bug.** `live-latency.tsx`'s
  > `CHART_BOX = "min-h-[150px] flex-1"` is correct as shipped and must not be
  > "corrected" to a pin. `ChartContainer`'s base class is `aspect-video`, so an unpinned
  > chart's height is a function of the card's *width* and changes as the grid reflows;
  > and recharts' `ResponsiveContainer` renders **nothing** until it has measured its
  > parent, so a zero-height parent on the first frame makes the card pop when the
  > measurement lands. The floor guarantees a measurable height on frame one; the
  > `flex-1` beside it absorbs the slack from Device Metrics being the taller row-mate.
  > **A floor standing in for a mirror is a defect; a floor guaranteeing a first-frame
  > measurement is not.** Neither failure shows in a static screenshot.
- **Bars — one thickness, two widths.** *(lands in step R0)* Every bar in the product is
  **8px tall**. What varies is **width**, chosen by slot:

  | Form | Width | Where | Why |
  |------|-------|-------|-----|
  | **Full-width meter** | spans the row | Device Metrics — CPU, memory, storage, temperature | The bar owns its own line beneath the label, so it has the width to spend |
  | **Inline lane** | `w-14` (56px) | The NR / LTE signal rows | It shares a 40px row with the figure it qualifies. A full-width bar under the last line would read as a coloured bottom border rather than as a gauge |

  > **Why one thickness.** `DESIGN.md` rests the whole quality ramp on length — adjacent
  > stops sit *deliberately* below the CVD separation floor, on the understanding that
  > **bar length carries the fine distinctions**. The old 4px lane was the thinnest mark
  > on its card, carrying the one channel the ramp may not lose. And the 4px/8px split was
  > never a decision: `MetricBar`'s `size` **defaulted to `sm`**, so 11 call sites
  > inherited 4px and 9 opted out. `sm` is deleted, not deprecated — a size nobody should
  > pick is a trap.

  > ⚠️ **Do not thin Device Metrics' meters, and do not re-introduce a thin variant.**
  > User-directed 2026-09-01. `METER_H = "h-2"` is mirrored by that card's skeleton, so
  > changing one silently breaks the other.

  In both forms, **length carries magnitude and the glyph carries the stop**, and a
  missing reading is `MetricBar value={null}` — an empty track, never a zero-length fill.

> ℹ️ NOTE: **ramp ink on a numeral with no lane beside it is a bug.** Adjacent quality
> stops sit deliberately below the CVD separation floor, on the explicit understanding
> that bar length carries the fine distinctions. See `DESIGN.md` > Quality bars.

---

## The three-state contract

Every card ships **loading**, **empty** and **error**. The dashboard's honest failure
mode is not a per-card error screen — it is a **failed poll**, and the same failure hits
every card at once. Nine copies of one message would be noise.

So the contract splits *(lands in this pass)*:

1. **The page** carries the condition — `home-component.tsx`'s `Banner role="stale"`,
   which already exists.
2. **Each card** goes honest rather than blank. A measurement with no reading renders an
   **empty track**, an `on-surface-variant` em-dash, a `muted` "No reading" chip and an
   `sr-only` word. An **identifier** — IMEI, ICCID, firmware, band — keeps its last-known
   value, because an identifier does not go stale on a missed poll.

> ⚠️ **Never `??` a fallback tone in.** `qualityMeterTone()` returns `null` for `none`
> precisely so a caller cannot. A rival copy of that map once sent `none` through a
> `default:` arm to `success`, and **an antenna with no reading painted green**. The
> absence is a value the caller must handle, not a case it can fall through.

Six cards had no error branch at all before this pass — `network-status`,
`device-status`, `signal-status-card`, `lte-status`, `nr-status`, `device-metrics` — and
drew `"-"` and `0` in the same slots as real readings while the page banner said the
modem was unreachable. The card and the banner disagreed.

---

## Motion

The dashboard is where the product's motion system was authored, so most of it is
canonical and stays. Three things are worth stating because they are easy to undo.

**One entrance cascade, four beats** *(lands in this pass)*. A single `staggerContainer`
over the grid's five direct children, at the 120 ms card step: header → top band →
aggregation → trio → history. The tail lands at **480 ms**.

> The surface previously ran **five** independent containers, each with its own
> `initial`/`animate` and each starting its own clock at t=0 — so the page read as five
> things arriving simultaneously rather than as one cascade. `home-component.tsx`'s own
> comment conceded this, and declined to reproduce the design mock's 240 ms offset
> *because* of it. One container removes both problems.

**Nested containers must not declare `initial`/`animate`.** The carrier pair, the orb
grid and every row group inherit `visible` from the parent. Declaring their own detaches
them from the parent's clock — which is the bug the single-container change exists to
fix, reintroduced one level down.

**The tick cascade is the tightest thing in the system against the poll.** A full
`TickGroup` sweep is 1.4 s of lead plus a 1.4 s dip = 2.8 s, against a measured
~3.7–4.0 s poll. That is **~900 ms of headroom**. Re-check the arithmetic in
`lib/motion.ts` before raising the motion scale or making the poller faster.

**Only measurements tick.** Identifiers take the container morph instead — dipping a
value that holds steady for minutes invents an event.

---

## The trio row, and why one card could not absorb slack

*(R1 lands in this pass)*

Device Metrics, Live Latency and Recent Activity share one grid row and are `h-full`-locked
by `*:data-[slot=card]:h-full`. Equalising a 3-up row is the documented norm — "Equal
heights are explicit" — but it only works if every card can *use* the height it is given.

- **Device Metrics drives it.** Seven rows: four `MeterRow` plus three `PillRow` (data
  used, LTE cell distance, NR cell distance). It is the tallest by content.
- **Live Latency absorbs.** `CHART_BOX`'s `flex-1` hands the chart whatever slack exists.
- **Recent Activity could not.** Its list was pinned *and* clipped —
  `maxHeight: LIST_MAX_H` (332px) under `overflow-hidden` — so every pixel past 332
  became dead space at the bottom of that card.

`VISIBLE_ROWS` is now container-query-driven, and **it is the only number to change.**
`LIST_MAX_H`, `RENDER_COUNT` and `ROW_ADVANCE` all derive from it, so the clip edge and the
push animation stay correct by construction.

> ⚠️ `RENDER_COUNT` must stay exactly `VISIBLE_ROWS + 1`. The spare row exists to be pushed
> *under* the clip edge; with no spare, the bottom row is pulled into view at the start of
> the push and then vanishes at the end.

> ℹ️ This was originally reported as the Speed Test tile creating "a huge whitespace gap".
> The tile was real but secondary — shrinking it to a row takes ~48px off **Live Latency**,
> which was already absorbing fine, and gives Recent Activity nothing. **Measure which card
> cannot absorb before shrinking the one that can.**

## Orb sizing

*(R3 lands in this pass)*

The three orbs are 152px on desktop and **~92px, 3-across, below a card container query**.
Stacked at 152px on a phone they run ~456px of orb plus three label blocks — roughly 600px
before the reader reaches anything else, on the surface built for a thirty-second glance.

This is a **responsive step, not a recomposition**: same three objects, same circular
treatment, same corner badges and ring stack. Both sizes live in `shapes.ts` so the
skeleton reads the same pair.

> ⚠️ The ring stack's rings are absolutely positioned at 152 / 112 / 80px around a 48px
> core. Scale all four from one ratio rather than by hand, and re-check that
> `animate-pulse-ring` still reads at the smaller size.

## The parts that are load-bearing

Everything in this section is **correct as shipped** and was deliberately excluded from
the adoption pass. Changing any of it needs its own justification.

- **The signal cards' quality treatment.** Identity on the fill, quality in the Material
  glyph's bar count, ramp ink on the numeral, a 56px lane beside it, and an `sr-only`
  quality word. `DESIGN.md` cites this card by name under Signature surfaces.
  > The **card** is load-bearing; its two wrappers were not. `nr-status.tsx` and
  > `lte-status.tsx` rendered nothing — each mapped a poller block to
  > `SignalStatusRow[]` and forwarded six props — so they collapsed into
  > `signal-rows.ts` *(R2, lands in this pass)*. The builder branches on `family` rather
  > than pretending the legs match: **NR carries `scs` and LTE does not.**
- **Recent Activity's age-gated tone.** Tone is *what kind of thing happened* and never
  expires — carried by a full-strength disc for as long as the row exists. Weight is
  *how much it still deserves attention* and does expire, settling the container onto
  `surface-container` after an hour. **The disc never consults the age gate.**
- **Carrier Aggregation's `width` animation.** The single sanctioned `width` animation in
  the product, because the width *is* the data and a `scaleX` would distort the band
  labels riding inside it. Its released-carrier contract (visible and explicitly marked,
  never silently dropped) and its freeze-while-stale rule are equally load-bearing.
- **The chart draw-in.** CSS over recharts, `pathLength={1}` plus
  `{...useChartSeriesMotion()}` on every animated series. See
  [`dashboard-chart-cards.md`](dashboard-chart-cards.md).
- **The skeleton-overlay crossfade** in Device Metrics — the outgoing skeleton sits *on
  top of* real content so the card is sized by its content from the first frame and the
  handoff contributes zero layout shift.
- **The live speedtest figure is deliberately not wrapped in `TickingValue`.** The tick
  is a 1.4 s gesture; the speedtest's live cadence is 500 ms. It would strobe.
- **Device Metrics' layout, including where the data-usage row sits.** See the rule
  below — this one has already been proposed once and vetoed.

### Placement encodes confidence

**Do not promote the data-usage row.** It stays a `PillRow` in the quiet slot beneath the
three meters, with its direction glyphs inline and its reset control in the label.

A 2026-09-01 draft proposed moving the rx/tx figures onto two pinned 104 px tiles with
direction discs. It was **vetoed by the user**, and the veto generalises into a rule this
surface should keep:

> **A figure the product does not trust must not occupy a slot that asserts trust.**
> Promoting a value amplifies the claim it makes. Data Used is a cumulative
> `AT+QGDCNT` / `AT+QGDNRCNT` counter with a manual reset and known accuracy problems —
> it cannot back the claim two 104 px tiles would make on its behalf.

The concrete trade was ~208 px of tile — the loudest slot on the card — for its least
reliable value, while CPU, memory, storage and temperature, all directly measured, stayed
as 40 px rows. That inverts the card's honesty ordering, which is the same failure The
State-Honesty Rule names one level up: a surface must not report something as more solid
than it is, and **layout is one of the channels that reports it**.

> ℹ️ The direction ink on that row is separately load-bearing. `arrow_circle_down` takes
> `text-downlink-on-surface` and `arrow_circle_up` takes `text-uplink-on-surface` — this
> was the one site in the product that was already half-right before the direction hues
> were unified (download had been `text-primary`, the 5G NR identity hue, on a figure
> counting bytes received on *any* radio). Leave both.

### The three icon exceptions

The route is Material Symbols. Three glyphs on Network Status are recorded exceptions in
`DESIGN.md` > Icons and must survive any sweep:

| Glyph | Library | Why |
|-------|---------|-----|
| `CardSimIcon` | lucide | The SIM orb is a recognised landmark on the glance surface |
| `Plane` | lucide | Its airplane-mode stand-in, same reason |
| `MdOutline5G` / `Md4gMobiledata` / `Md4gPlusMobiledata` / `Md3gMobiledata` | react-icons/md | "5G", "4G+", "3G" are typographic marks Material Symbols has no equivalent for |

---

## Gotchas

- **`MaterialSymbol` sets `fontSize` as an inline style**, which outranks every utility.
  Pass `size` explicitly at every call site — and doubly so inside a `SwapLabel` or a
  `Badge`, where the parent's `[&>svg]:size-3` selector cannot reach the glyph anyway.
- **`CardDescription` hardcodes a retired ink.** `components/ui/card.tsx:51` ships
  `text-muted-foreground`; the system's ink for that role is `on-surface-variant`. This
  surface overrides at the call site rather than fixing the primitive, which is its own
  tracked delta.
  > ⚠️ A harness assertion grepping `components/dashboard/**` for `text-muted-foreground`
  > therefore proves **nothing** about what renders — the class lives in the shared
  > primitive. Assert that every `CardDescription` here carries an explicit ink class
  > instead.
- **`components/ui/empty.tsx` ships `md:p-12`** — a viewport breakpoint inside a
  card-level primitive, so Carrier Aggregation's empty state re-pads against the browser
  window rather than its column. Same tracked delta.
- **Poll cadence is not 2 s.** `DEFAULT_POLL_MS` is 2000 and the poller's own `sleep 2`
  runs *after* the cycle body, so the real interval is roughly double. Any duration
  derived from the nominal figure is 50% short.
- **`prefers-reduced-motion` has three states here, not two.** The Animations preference
  can outrank the OS setting in either direction. Keep every shared variant pure
  transform and opacity so the one global switch stays sufficient.
