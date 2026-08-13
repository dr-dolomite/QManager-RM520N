# Radio Information (`/cellular/`)

The **Radio Information** page is the screen a technician opens to answer two questions in order: *which bands am I on right now*, and *how is each one doing*. It reads nothing of its own. Every figure comes from the ordinary poller snapshot (`/tmp/qmanager_status.json`) that the dashboard already fetches, so the page adds zero backend load and no new CGI endpoint. (CGI — Common Gateway Interface — is the shell-script-behind-a-URL mechanism the rest of QManager's backend uses; this page needs none.) What it adds is a view model: `lib/radio-info.ts` turns that snapshot into a page mode, a per-carrier list, an aggregate summary and a clipboard payload, and the components under `components/cellular/radio/` render that decision without making one.

The page is laid out **by cadence, not by symmetry**: a single-column stack of header → summary tiles → **Spectrum in use** (what moves every poll) → **Connection details** (what moves on attach or handover). Every carrier's metrics are on screen at once; nothing is one click deep.

This doc records the invariants that are cheap to break and expensive to notice: the branch order of the page state machine, why carrier counts must never come from `ca_count` / `nr_ca_count`, the three distinct meanings of "no value", the stale freeze, the colour contract, and the tick-cascade budget that always-expanded rows now depend on.

## Quick Reference

| Thing | Where |
| ----- | ----- |
| Route | `/cellular/` (index; the 17 sub-routes share its Material Symbols boundary, see [icon-system.md](icon-system.md)) |
| Page shell | `components/cellular/cellular-information.tsx` |
| View model (pure, no React) | `lib/radio-info.ts` |
| IPv6 / hex helpers (pure) | `lib/ipv6.ts` |
| Page header + Copy diagnostics | `components/cellular/radio/page-header.tsx` |
| Four summary tiles | `components/cellular/radio/summary-tiles.tsx` |
| Non-registered state screens + tile skeleton | `components/cellular/radio/states.tsx` |
| Spectrum in use (live cadence, per-carrier rows) | `components/cellular/radio/active-bands-card.tsx` |
| Connection details (handover cadence, three groups) | `components/cellular/radio/cellular-information-card.tsx` |
| Data source | `hooks/use-modem-status.ts` > `/tmp/qmanager_status.json` |
| Upstream helpers it composes | `lib/carrier-aggregation.ts`, `lib/earfcn.ts`, `types/modem-status.ts` |
| Shared condition screen | `components/cellular/condition-screen.tsx` |
| i18n | `radio_info.*` in `public/locales/{en,zh-CN,zh-TW,it,id}/cellular.json` (126 keys per locale) |

> ℹ️ NOTE: the old `components/cellular/cell-data.tsx` and `components/cellular/active-bands.tsx` are gone. Their domain logic survives: the IPv6 compression moved verbatim to `lib/ipv6.ts`, and the RAT-owns-which-identity-field rule moved into `CellularInformationCard` (the `isSA` branch).

## The page state machine

`resolveRadioMode` (`lib/radio-info.ts`) is the single source of truth for what the page renders. One function owns the branch order, so the header, the tiles and the two cards can never disagree about which state the radio is in. It mirrors the shipped `resolveBodyMode()` pattern on the pre-auth splash (see [overview-splash.md](overview-splash.md)).

| Order | Condition | Mode |
| ----- | --------- | ---- |
| 0 | `!data` or `!data.network` | `loading` |
| 1 | `network.service_status === "sim_error"` | `no-sim` |
| 2 | `network.cfun === 0` or `=== 4` (RF off / airplane) | `no-service` |
| 3 | `network.service_status === "no_service"` | `no-service` |
| 4 | `network.service_status === "searching"` | `searching` |
| 5 | `network.type` | `registered-lte` / `registered-nsa` / `registered-sa` |
| 6 | anything else | `unknown` |

**The order is load-bearing, in both directions.** A missing SIM outranks "no service" because it is the *cause* of it, and a page that reports the symptom while the cause is knowable is doing the technician's job badly. RF-off (`AT+CFUN?` returning 0 = minimum functionality or 4 = RF off) outranks "searching" because a radio that is switched off is not looking for anything, and a spinner over a disabled radio advertises work that is not happening.

### Non-registered modes replace the body

`isConditionMode` (`states.tsx`) narrows a `RadioMode` to the four the state screen can draw (`no-sim`, `no-service`, `searching`, `unknown`). When it returns true the shell sets `showConditionState`, the two cards are not rendered at all, and `RadioConditionState` takes the tiles' slot.

This is the point of the redesign, not a nicety. The page is louder and more saturated than the plain table it replaced, so a degraded state rendered *through* the loaded layout reads worse than the old page did: a solid `bg-primary` tile reading "5G NR + LTE" beside forty em dashes, while there is no SIM in the device, is an actively misleading instrument on the exact screen a technician opened to diagnose that.

`isConditionMode` deliberately **excludes `loading`**. Loading is not a condition of the radio, it is a condition of this client, and it gets the skeleton (`SummaryTilesSkeleton`) rather than a tonal state card.

Tone per condition is chosen from what the user can do about it, not from aesthetics (`CONDITION` in `states.tsx`): `no-sim` is warning (a real fault the user can fix in situ), `no-service` is destructive (the link is down and the modem cannot help), `searching` is primary (transient and hopeful), `unknown` is neutral (we do not know, and pretending otherwise in either direction would be the actual bug). Each carries a **different** glyph, because `success-container` and `warning-container` measure roughly 1.03:1 apart and are the same surface under deuteranopia (red-green colour blindness). Only `searching` spins.

### Why `isLoading` does not branch

`resolveRadioMode` takes `isLoading` and immediately discards it (`void isLoading`). The parameter stays only because the shell passes it and the signature is shared.

The reason is a specific failure: **a failed first fetch must resolve to `loading`, never to `no-service`.** If the branch consulted `isLoading`, a transport problem (poller stopped, lighttpd wedged, the fetch aborted) would render the destructive "No service" screen, and the page would blame the radio for something the radio did not do. That is the single worst outcome available on the one screen whose job is to tell those two apart. A null snapshot means "nothing to show yet" whether or not a fetch is in flight, and the transport half of the story is told separately by the `error` banner in the shell and by the header's freshness chip.

## Counts come from grouping, never from `ca_count`

`summariseRadio` (`lib/radio-info.ts`) derives `lteCount` and `nrCount` by filtering `carrier_components[]` on `technology`. It must never read `network.ca_count` or `network.nr_ca_count`.

Those two fields are **secondary-carrier counts** with an NSA minus-one rule baked into the parser: on EN-DC (dual connectivity, where an LTE cell anchors a 5G leg) the LTE cell holds the only PCC and the first NR SCC *is* the NR leg rather than aggregation, so `parse_ca_info()` subtracts it. The live device has been observed reporting `nr_ca_count: 0` while carrying a real, measurable NR carrier. See [carrier-aggregation.md](carrier-aggregation.md) for the full rule. A count that has to be corrected by a rule the UI must remember is a count the UI should not be reading; grouping the array is the only honest answer, and it is correct on LTE-only, NSA and SA without branching.

Released carriers are excluded from every number in the summary. The aggregate describes what the radio has *right now*; the released rows stay on screen to explain what it lost. This is also why the "Spectrum in use" description ("2 active carriers…") can legitimately read one lower than the number of rows below it.

There is now exactly **one** consumer of this rule left to protect. The old **Carrier aggregation** row in Connection details carried its own `formatCarrierAggregation`, which did read `ca_count` / `nr_ca_count`; that row and its formatter were deleted (see below), and the argument they carried now lives on `summariseRadio` itself and on the carrier tile in `summary-tiles.tsx`. If a count is ever reintroduced anywhere on this page, it comes from `summariseRadio`.

## Three different meanings of "no value"

The page distinguishes three, and collapsing any two of them produces a confident lie.

### `bandwidth_mhz === 0` is an unrecognised enum, not zero width

`enrichCarriers` maps it to `null`. `summariseRadio` then filters nulls out of `breakdownMhz` before summing, so a carrier the parser could not decode contributes neither a stray `+ 0` to the "15 + 20 + 60" caption nor a drag on the total. In the band-reference disclosure's Bandwidth field a `null` width renders the localized "Unknown" rather than `0 MHz` — because "0 MHz" is a claim the modem never made.

### `percent: null` is not `percent: 0`

`buildMetrics` sets `percent: null` whenever the underlying value is null, and `MetricCell` renders the "not reported" caption in the meter lane where the bar would be.

The reason is arithmetic, not taste. `rsrpToPercent` (`lib/carrier-aggregation.ts`) **floors its output at 2%** precisely so that a genuinely terrible carrier still shows a visible stub rather than an empty track. `0` is therefore a width no *real* reading can produce — the function returns it for exactly one input, a null RSRP, which is the case `buildMetrics` intercepts before ever calling it. Feeding a null metric through it, or defaulting to `0` on the way to `MetricBar`, would render the one bar width reserved for a different meaning entirely, and it would render it as an assertion about signal strength. SCCs (secondary component carriers) routinely report only a subset of metrics, so this is the common path, not the edge.

### An absent row is not a null value

RSSI is emitted **only** for LTE carriers that actually reported it (`buildMetrics`). `AT+QCAINFO`'s NR line shapes carry no RSSI field at all, so every NR component would report null forever; emitting the row anyway would invent a permanently-empty metric and invite the reader to wonder what is wrong with it. RSSI is also `barless: true`: it has no meaningful 0-100 scale to plot against, so it gets a caption where the track would be rather than a bar that means nothing.

Because the metric grid is **fixed at four columns**, an NR carrier's missing RSSI leaves its fourth cell genuinely **empty** — there is no rendered dash and no placeholder. That is deliberate: a dash in a fixed column reads as "this failed to load", whereas an empty cell in an otherwise perfectly aligned grid reads as "there is nothing here to report".

## Subcarrier spacing is not per-carrier

`carrier_components[]` has no `scs` key. The only subcarrier-spacing value the modem gives us is `nr.scs`, which describes the **serving** NR cell. So exactly one carrier can honestly claim a reported SCS: the one whose `earfcn` equals `nr.arfcn` (`enrichCarriers`). Every other NR carrier gets a value from `inferScs` and is flagged `scsInferred: true`, which the band-reference block surfaces as a focusable **"Derived"** marker with a tooltip. Showing an inference as though the modem reported it would be the page lying quietly, which is the failure mode this page is built to avoid.

Two mechanical traps in `inferScs`:

- **`suggestNRSCS` takes a band table entry, not an ARFCN.** Its signature is `suggestNRSCS(band: NRBandEntry)` (`lib/earfcn.ts`). Passing a number will not type-check, and reaching for an ARFCN-shaped helper instead will.
- **NR ARFCN ranges overlap, so band-string resolution must come first.** `inferScs` parses the band string (`parseBandNumber`) and looks the entry up in `NR_BANDS`, falling back to `findAllMatchingNRBands(earfcn)[0]` only when there is no usable band string. The fallback is genuinely ambiguous: ARFCN 528030, observed live, matches both **n7 and n41**, which have different duplex modes and therefore different inferred SCS. The band string is the disambiguator the modem already handed us.

## Rows key on `carrierKey`, never on index or PCI

Every carrier row is keyed on `EnrichedCarrier.key`, which is `carrierKey(c)` = `` `${technology}-${band}-${earfcn}` `` (`lib/carrier-aggregation.ts`).

Two independent reasons, both observed:

- **PCI is not unique.** On the live device (Smart PH, PLMN 515-03, NSA) both LTE carriers report **PCI 295**, which is ordinary intra-site aggregation. A PCI-keyed list collapses two real carriers into one row.
- **An index key loses identity across a wipe-and-refill.** A failed AT read empties `carrier_components` wholesale and the next poll repopulates it, potentially in a different order. With index keys, the row under the user's cursor silently becomes a different band.

## The stale freeze

In `cellular-information.tsx`:

```tsx
const retained = React.useRef<ResolvedCarrier[]>([]);
const resolved =
  isStale || receivedAtMs === null
    ? retained.current
    : reconcileCarriers(retained.current, data?.network?.carrier_components ?? [], networkType, receivedAtMs);
```

`isStale` comes from `useModemStatus()` and means the snapshot on screen is older than `STALE_THRESHOLD_SECONDS` (10 s). `receivedAtMs` is the wall-clock instant the snapshot landed in the fetch callback, not a render-time read — see below for why that distinction was a real bug, not a style nit.

While `isStale` is true the carrier list **freezes** instead of reconciling. This is not an optimisation.

`reconcileCarriers` interprets "absent from the snapshot" as "released", which is correct when the snapshot is trustworthy. But a single failed or timed-out `AT+QCAINFO` read wipes `carrier_components` to `[]` wholesale (see [carrier-aggregation.md](carrier-aggregation.md) > *Empty array on any failed AT read*). Reconciling against a snapshot the page has already disowned would announce **every** carrier as released, in the same frame that the header's amber "Data is stale" chip is telling the user not to trust the numbers. A screen that simultaneously says "this data is stale" and "here is a fresh, confident list of things that just broke" is exactly the contradiction this page exists to prevent. The 6 s `RELEASE_GRACE_MS` debounce inside `reconcileCarriers` handles the transient blip; the freeze handles the sustained one.

The retention ref is committed in an effect, not during render, so a render React throws away cannot advance the release clock.

## `receivedAtMs`: the render-time `Date.now()` is gone, not suppressed

`cellular-information.tsx` and `carrier-aggregation.tsx` used to each read `Date.now()` during render, under an `eslint-disable-next-line react-hooks/purity`. Both reads are gone — fixed, not silenced. `useModemStatus()` stamps the wall-clock instant a snapshot **lands**, in the fetch callback where a clock read already existed, and returns it as `receivedAtMs`. Both components take it as a prop instead of calling `Date.now()` themselves, and `enrichCarriers` takes `nowMs` as a parameter rather than reading the clock internally.

This is not just a lint fix — it closes a real latent bug. `lastSeenMs` is supposed to mean "when did a poll last contain this carrier," but it was being fed a **render** timestamp. Both components re-render for reasons that have nothing to do with a new poll landing, and each such render advanced the release clock and got committed by the effect. So the 6 s `RELEASE_GRACE_MS` window was actually measuring time since the *last render that happened to include a carrier* — and a burst of unrelated re-renders could carry a carrier across the release threshold with no new data behind it. `reconcileCarriers` is now idempotent in its inputs: the same snapshot at the same `receivedAtMs` always produces the same reconciliation.

Worth recording: `lib/radio-info.ts` made the identical `Date.now()` call and was **never flagged** by `react-hooks/purity`, because the rule only analyses component/hook bodies and does not trace into a plain helper function they call. Suppressing the two flagged call sites would have made lint go green over an unchanged codebase.

> ℹ️ NOTE — a toolchain fact worth knowing before trusting a clean `eslint` run on this rule: `eslint-plugin-react-hooks` v7 is compiler-backed, and its analysis **stops at the first violation found in a component** — every later diagnostic in that component is never emitted, and an `eslint-disable` on the first one hides the rest along with it. Proven on an isolated probe: a component with one render-time `Date.now()` plus three ref-reads during render reported `purity ×1` only; removing the `Date.now()` then reported `refs ×3`; suppressing it with `eslint-disable` instead reported **0 errors**. Fixing the two purity violations for real unmasked **16 pre-existing `react-hooks/refs` errors** (14 in `carrier-aggregation.tsx`, 2 in `cellular-information.tsx`) that had been sitting behind them. Those flag the deliberate `usePrevious`-style "read `retained.current` during render" pattern the stale freeze depends on. Treat them as a known, tracked gap — not as new breakage, and not as resolved.

## The tick-cascade budget

**Short version: every metric of every carrier is now mounted and eligible to animate on every poll, and the only thing keeping that cascade shorter than the poll interval is a clamp inside `TickGroup`.** This is the single most easily-broken thing in the redesign.

The live value tick works in two halves. `useValueTick` dips a figure when its value changes; `TickGroup` (`components/ui/tick-group.tsx`) collects every figure that moved in the same commit and staggers their dips so the card reads as individual figures ticking rather than as the whole card flashing.

The accordion this card replaced unmounted collapsed rows, so only the open carrier's metrics could ever tick. Always-expanded means four carriers × four metrics are all live at once. One `TickGroup` still wraps the whole card body, and that is still correct — because rank is **clamped**:

```
MAX_RANK (7) × TICK_STAGGER_STEP (0.2s) = 1.4s lead
        + one full dip (1.4s)            = 2.8s total
against a measured poll cadence of        ~3.7-4.0s
```

`MAX_RANK = 7` is defined in `components/ui/tick-group.tsx`; `TICK_STAGGER_STEP = 0.2` is in `lib/motion.ts`, which documents this same arithmetic as the binding constraint for the whole motion system. Rank is assigned only over the values that actually *moved* this commit, and item 8 and beyond share the tail slot rather than extending it. **It is the clamp, not the carrier count, that keeps this inside one cycle** — so `MAX_RANK` is the thing to re-check before changing the stagger step, the dip duration, or the poll cadence. Adding carriers does not lengthen the cascade; raising any of those three does.

> ⚠️ WARNING: do not "fix" a busy-looking cascade by splitting the card into several `TickGroup`s per carrier. Rank is bounded per group, so N groups produce N independent 2.8 s cascades starting on the same frame — which is the whole-card flash the group exists to prevent, with extra steps.

## Colour: three facts, three channels

The comp tinted each carrier row by **role** (PCC blue, ANCHOR teal). That was rejected, and the reasoning generalises:

- The dashboard CA strip tints the very same carriers by **technology** (NR blue, LTE violet). Two screens one click apart cannot disagree about what blue means, so `primary-container` keeps its single meaning of "this is the NR leg".
- Tinting the whole row by technology breaks a different rule. Each row carries a **status** chip, and every status role is itself a container fill. A `success-container` chip sitting on a `primary-container` row loses its edge and stops reading as a chip; `components/dashboard/carrier-aggregation.tsx` already documents that collision as the reason its own role chip is not a `Badge`. With every row expanded, four full-bleed tinted rows would also make the card shout before the user has picked anything to look at.

So the shipped assignment is:

| Fact | Channel |
| ---- | ------- |
| The row itself | Neutral `bg-surface-container`, no tint (`ROW_SHELL`) |
| Technology identity | The band label, as `Badge variant="nr" \| "lte"` (`bandIdentityVariant`; `muted` when released) |
| Role | The role chip's **words** (PCC / ANCHOR / SCC n), on the neutral ramp (`ROLE_CHIP`) |
| Quality | The status chip's fill, on a plain surface where it can be seen (`qualityVariant`) |

Three facts, three channels, no channel doing two jobs. The quality glyph is the **wedge** ladder (`signal_cellular_{1..4}_bar` + `signal_cellular_off`, `qualityGlyph`), never the `signal_cellular_alt*` family: `alt_1_bar` is a single 120×240-unit mark (about 2×4px at size 16, indistinguishable from a failed icon load) and there is no `alt_0_bar`, so the alt ladder's ink mass runs large → medium → speck → large → large and quality reads non-monotone. Two states in one slot never share a glyph, for the 1.03:1 reason above.

**Value ink uses the `*-on-surface` steps, never the solid role tokens.** `MetricCell` routes its value colour through `getValueColorClass` for exactly this: the solid pair measures 4.29:1 (success) and 3.74:1 (warning) on `surface-container` in light mode, both below AA. The darkened `-on-surface` steps exist at 5.88 / 5.95. And because `success-on-surface` and `warning-on-surface` sit ~1.01:1 apart — the same ink in greyscale — each bar-carrying metric also emits its quality **word** in an `sr-only` span. The tint is never the only channel.

### The four summary tiles

**All four tiles carry colour**, matching the approved comp 1:1: Network type is the identity **fill** (`bg-primary` for NR, `bg-lte` for LTE — whichever radio is actually registered), Bandwidth is `primary-container`, Carrier aggregation is `uplink-container`, Active MIMO is `lte-container`.

The rule that keeps that from becoming mud is **pairing**, not restraint: a tile is either a FILL pair (`bg-primary` + `text-primary-foreground`) or a CONTAINER pair, never crossed — and the 52px glyph disc always **inverts** its tile's pairing, so a fill tile gets a container disc and vice versa. The glyph pops instead of dissolving into a same-tone circle, and it survives greyscale either way.

`NETWORK_TILE` is a **total** map over `RadioMode`, so an unhandled mode can only ever degrade to the honest neutral tile, never to a confident "5G NR + LTE".

The Active MIMO tile's glyph is **`alt_route`**, not `settings_input_antenna`. Two reasons: the aerial glyph is already worn by both surfaces this tile links out to (`antenna-statistics/context-tiles.tsx` and `antenna-alignment/states.tsx`), so the tile was wearing its own destination's mark; and it drew a rabbit-ear TV aerial for a spatial-multiplexing readout. `alt_route` draws one path splitting into parallel legs, which is what MIMO physically is.

## Spectrum in use — the live half

`ActiveBandsCard` renders every carrier as an **always-expanded** row. Each row is two blocks side by side:

- **Identity block** (`IDENTITY_BLOCK`) — a **fixed** `16.5rem` column from the `@3xl/bands` breakpoint up. It carries the role chip, the band identity `Badge` ("NR n78" / "LTE B3" — NR bands are lowercased for display because 3GPP writes them that way), the quality status chip, and a mono meta line reading `PCI 295 · EARFCN 1650`. Any part with no value drops out of the line rather than printing a placeholder.
- **Metric grid** (`METRIC_GRID`) — `grid-cols-2`, widening to a **fixed** `grid-cols-4` at `@4xl/bands`. Never `auto-fit`.

**The fixed columns are the entire point.** RSRP sits at the same x-offset on every row, so a weak leg is visible without reading a number — and that alignment evaporates the moment either block is allowed to size to its content. Bandwidth lives in the band-reference disclosure below, alongside band name and duplex — it never changes for a given band, so it reads as static spec rather than a per-handover reading. (A 2026-08 polish pass moved it back there from the meta line; the meta line now carries just PCI and EARFCN.)

Two conditional notices can appear under a row: a `destructive` low-SNR notice (threshold-triggered, and it states the **reading only** — the comp went on to claim "the scheduler may drop it under load", which QManager cannot verify), and a neutral "released N seconds ago" note.

### The band-reference disclosure

Band name, duplex mode, bandwidth, DL frequency, UL frequency and SCS are **reference material**: they never change for a given band. They used to be six per-carrier detail pills behind an accordion. They are now behind **one card-level button** in the header — `Show band reference` / `Hide band reference` — which opens the reference block on **every** row at once.

It is a **plain conditional render**, deliberately not a height animation. See the next section.

> ⚠️ WARNING: the accordion's height animation was the product's **second** sanctioned exception to DESIGN.md's Transform-Only Rule. Deleting the accordion **retires that exception**, and the product is back to exactly one documented `width` exception (the CA chain's `.ca-segment`). Do not re-open it. A disclosure that expands five rows simultaneously would spend a canon win to animate five simultaneous reflows.

### Motion on this card

- Row entrances are `staggerRows` / `staggerRowItem` motion variants, not a CSS `animation:` class. A raw keyframe class replays on every re-render unless something unmounts and remounts the node — which the accordion used to do for free and nothing does now. This is the same bug class `useChartDrawIn()` exists to solve on the dashboard (see [dashboard-chart-cards.md](dashboard-chart-cards.md)).
- The page cascade is the shared `staggerContainer` / `staggerItem` pair, which *is* the comp's `qm-cascade` — its hardcoded 0/60/120/180 ms delays are exactly the 60 ms card step, so the variants reproduce the choreography without restating a number.
- `SwapLabel` animates the quality chip's label, with the **glyph inside the swap**: the glyph is the only greyscale channel between success and warning, so it must travel with the word it qualifies. The swap key encodes text *and* variant, because both move together.

## Connection details — the handover half

`CellularInformationCard` holds everything that changes on attach or handover and nothing that changes per poll. Rows are filled pill rows on `surface-container` — hairline `Separator` rows stay reserved for genuine data tables — grouped under three eyebrows.

The three groups sit in a **container grid** (`GROUP_GRID`, exported): one column, two at `@2xl/cellinfo`, three at `@4xl/cellinfo`. Container queries against the card's own `@container/cellinfo`, not the viewport — this card is full-width now, so its width *is* the page's width and a viewport breakpoint would be measuring the wrong box.

| Group | Rows |
| ----- | ---- |
| Connection | Operator, APN (+ link to APN Management), **Link uptime**, **Carrying traffic on** |
| Cell identity | Cell ID, eNodeB/gNodeB + Sector (a half-width split pair), TAC (+ hex chip), **Distance to site** |
| Addressing | WAN IPv4, WAN IPv6, Primary DNS, Secondary DNS |

`GROUP_SHAPES` records each group's literal row sequence (`["row","split","row","row"]` for identity) so the skeleton renders the card's **true** shape rather than an approximation — the split pair lands at the same index in both.

### Two rows were deleted, not moved

`Network type` and `Carrier aggregation` are gone, along with their local `formatNetworkType` / `formatCarrierAggregation` helpers. Each **restated a summary tile sitting on the same screen**, roughly 200px above it, and the CA row additionally re-derived a count that `summariseRadio` already owned. A second derivation of one fact is a contradiction waiting for the poll where the two sources disagree. `CellularInformationCardProps` no longer takes `summary` at all.

### Three rows were added

All three come from data the poller already returned and this page threw away:

| Row | Source | Note |
| --- | ------ | ---- |
| **Link uptime** | `device.conn_uptime_seconds` via `formatUptime` | How long **this attach** has been up, not device uptime. A link up four minutes on a modem up four days is the most useful thing this card can say about an intermittent connection |
| **Carrying traffic on** | `connectivity.last_family` (`"ipv4" \| "ipv6" \| "none"`) | Which address family actually carried the last successful probe. `ipv6` means the IPv4 leg failed and the fallback took over — a real finding two rows above "WAN IPv4", and invisible until now |
| **Distance to site** | `lte.ta` / `nr.ta` via `calculateLteDistance` / `calculateNrDistance`, then `formatDistance` with `useUnitPreferences()` | Timing advance is quantised in coarse steps, so this is arithmetic, not a measurement |

Distance carries a focusable **"Estimated"** marker plus tooltip, placed **before** the number so the caveat is read first and is reachable by keyboard. It is the same construction the derived-SCS field uses on the spectrum card — one pattern for "this is our arithmetic, not the modem's reading". Its RAT branch is the same `isSA` check the identity rows use, so the estimate always describes the cell whose ID is printed beside it. `calculate*Distance` treats `ta === 0` as *no data* rather than *zero distance*, because the modem reports 0 both when TA is unavailable and when there is no link.

> ℹ️ NOTE: `useUnitPreferences()` returns the prefs object directly (or `null` while it loads), not a query envelope. `formatDistance` treats an undefined unit as km, so the loading frame is correct rather than blank.

### Two things in the comp deliberately not built

- **The `advanced` two-tier split.** It reads like a user control, but the comp has no toggle anywhere — it is a design-tool editor boolean. eNodeB, Sector and the hex TAC render unconditionally at one detail level.
- **The "nothing here is derived except the frequencies" footnote**, which is false on six counts: the quality words, the bar widths, the ANCHOR role, the bandwidth sum, the hex TAC and the duplex mode are all derived.

eNodeB and Sector IDs are **never computed in the UI**. The backend pre-splits both, and the arithmetic differs by RAT: LTE's 28-bit ECI splits `/256` and `%256`, NR's 36-bit NCI splits `/16384` and `%16384`. Deriving them here would silently produce LTE-shaped numbers for an SA cell.

## Freshness, staleness, and the page banner

The shell takes all five values from `useModemStatus()`. An earlier version destructured only `{ data, isLoading }`, which was a live bug: when the poller stopped responding the page kept rendering the last numbers it had, at full confidence, with nothing on screen saying so.

| Surface | Bound to | Behaviour |
| ------- | -------- | --------- |
| Page banner (`cellular-information.tsx`) | `error && !isLoading` | `Banner role="stale"`, outside the entrance cascade because a condition should never wait its turn |
| Carrier list | `isStale \|\| receivedAtMs === null` | Freezes rather than reconciling (see The stale freeze) |
| `refresh` | — | Backs the retry action on every condition screen. There is **no** Refresh pill in the header — it was cut as a duplicate of the sidebar's passive refresh |

The header's Live/Stale freshness chip (a `Badge` with a pulsing `LiveDot` on live, a static `schedule` glyph on stale) was removed per direct request — `isStale` still drives the carrier-list freeze and is not itself gone, only its visible chip. `animate-live-ping` remains in `globals.css` and stays in use elsewhere (dashboard, tower-locking, band-locking, frequency-locking); it was not touched by this removal.

The comp's **"Updates every 30s"** cadence chip stays cut. The client polls at 2 s and the modem's CA data refreshes every ~3.7-4.0 s measured across 103 consecutive polls, so the claim was false by roughly 8×. A cadence a user can set a watch by is worse than no cadence at all.

## Copy diagnostics is radio metrics only

`buildDiagnosticsText` (`lib/radio-info.ts`) emits a fixed-width text block: a header line, network type and operator, the aggregate, then one line per carrier with role, technology, band, ARFCN/EARFCN, bandwidth and PCI, plus an indented metrics line. Metrics with no value are omitted rather than printed as `null`, and SINR is labelled `SNR` on an NR carrier because that is what the 5G spec calls it.

It **deliberately excludes** IMEI, ICCID, WAN IPv4, WAN IPv6, DNS servers, Cell ID, eNodeB, Sector, TAC and APN.

> ⚠️ WARNING: this is a deliberate constraint, not an oversight, and **the payload must not widen**. The entire value of the button is that a user can paste the result into a public forum or a support thread without auditing it first. Every excluded field is either an identifier for the device, an identifier for the subscriber, or an identifier for the physical cell site. Adding "just the Cell ID" turns a safe-by-construction artifact into one that needs a warning label, and the warning label is the thing nobody reads.

The header's Copy button falls back to a toast on failure, which is a real path rather than a theoretical one: the app is served over plain HTTP from the modem, and some browsers block the async clipboard API outside a secure context. The per-row `CopyButton` in Connection details (WAN IPv4 / IPv6) does the same, and confirms visibly with a glyph swap as well as through the toast, because a toast can be missed on a wide monitor.

## What was cut from the mock, and why

| Cut | Why |
| --- | --- |
| **"Same tower / PCI matches"** affinity note | PCI is a per-frequency physical cell identity and is reused; two carriers sharing one says nothing reliable about the site. It is not a site identifier and must not be presented as one |
| **"Nothing here is derived except the frequencies"** footnote | False on six counts (see above) |
| **The two-tier `advanced` split** | A design-tool editor boolean, not a user control |
| **The low-SNR causal claim** | The comp claimed "the scheduler may drop it under load". QManager has no visibility into scheduler behaviour, so the notice states the reading only |
| **The unconditional pulsing liveness dot** | A pulse over frozen numbers is a worse lie than no indicator. The chip that shipped pulses only on the live branch |
| **The cadence chip** | The stated cadence was false by ~8× |
| **`arrow_forward`** on the scanner link | This is in-app navigation and the subset already carries `chevron_right` for it |
| **`oklch(...)`-at-alpha surfaces** | White-at-alpha over a tinted container is banned by the Solid-Container Rule: a stable mid-grey in light mode, a near-white blowout in dark, and a contrast ratio that is not computable. Replaced with `bg-surface` and `surface-container-high` |
| **The comp's 22px / 19px / 11px type steps** | Not on the ramp. Card titles are `text-xl` (20px), chip labels are `text-xs` (12px); the 11px step is scoped to the sidebar and pre-auth eyebrow, and DESIGN.md says in as many words not to use it to smuggle arbitrary sizes onto ordinary text |

## Geometry constants

Both cards export their shapes so the skeleton and the loaded state read the same numbers. The Skeleton-Mirror Rule fails **silently** when the two shapes are written twice: the handoff shows as a jump rather than a crossfade, and nothing in the type system notices.

| Constant | File | Value / meaning |
| -------- | ---- | --------------- |
| `BAND_ROW_HEIGHT` | `active-bands-card.tsx` | `82` — identity block (chip line 26 + gap 8 + meta line 16 = 50) plus `py-4` either side |
| `BAND_SKELETON_ROWS` | `active-bands-card.tsx` | `3` |
| `TILE_SHAPE` | `summary-tiles.tsx` | `.GRID` / `.ROOT` / `.HEIGHT` / `.DISC`; `states.tsx` imports it so the tile skeleton cannot drift |
| `ROW_SHAPE`, `ROW_SHAPE_COMPACT`, `ROW_STACK`, `GROUP_STACK`, `ROW_LINE`, `ROW_LABEL`, `ROW_VALUE`, `EYEBROW_CLASS` | `cellular-information-card.tsx` | Row and group geometry, shared with the skeleton |
| `GROUP_SHAPES` | `cellular-information-card.tsx` | Literal row sequence per group |
| `GROUP_GRID` | `cellular-information-card.tsx` | The three-group container grid |

> ℹ️ NOTE: the **name** `BAND_ROW_HEIGHT` is load-bearing beyond this page. [antenna-statistics.md](antenna-statistics.md) and `components/cellular/antenna-statistics/tech-card.tsx` both cite it by name as the canonical idiom for a skeleton that cannot drift. The number may change freely; renaming the export breaks two external references.

Neither card is height-locked any more. The old `h-full *:data-[slot=card]:h-full` pair forced a static reference card and a live telemetry card to the same height, leaving ~200px of dead space in whichever had less to say — and which one that was flipped with the carrier count. Splitting the page by cadence removed the constraint rather than tuning it, and `CardShell` in `cellular-information-card.tsx` dropped its `h-full` with it.

## i18n

All copy lives under `radio_info.*` in the `cellular` namespace: **126 keys per locale**, present in all five of `public/locales/{en,zh-CN,zh-TW,it,id}/cellular.json`.

> ⚠️ WARNING: several key families are reached through **template literals** and are invisible to any static extraction or unused-key scan. Deleting one because grep found no call site will ship a raw key string to a device.

| Key family | Built at |
| ---------- | -------- |
| `radio_info.states.<mode>.{title,description}` | `states.tsx` (via `CONDITION_KEY`) |
| `radio_info.bands.role.<roleKey>` | `active-bands-card.tsx` (`roleLabel`) |
| `radio_info.bands.quality.<quality>` | `active-bands-card.tsx` (chip text and the `sr-only` metric word) |
| `radio_info.bands.metric.<labelKey>` | `active-bands-card.tsx` (`MetricCell`) |
| `radio_info.value.family_<lastFamily>` | `cellular-information-card.tsx` (traffic family row) |
| `radio_info.tiles.network.*` (via `NETWORK_TILE`) | `summary-tiles.tsx`, resolved by mode |

The network-type **value** is read from the shared `radio_info.network_type.*` keys, which is why deleting the Connection-details "Network type" row did not delete them: an earlier draft with a second key set had the tile saying "5G standalone" while the row said "5G NR SA". Tile **captions** stay tile-local, because they are elaboration rather than a restatement of the same fact.

### Dead-but-retained keys

These are present in all five locales with **no call site**, left in place deliberately: pruning them across five locales is churn with no user-visible effect, and several are one design decision away from returning.

| Key | Why it is dead |
| --- | -------------- |
| `radio_info.rows.network_type`, `radio_info.rows.carrier_aggregation`, `radio_info.ca.*` | The two Connection-details rows that used them were deleted |
| `radio_info.bands.cadence`, `radio_info.bands.stale` | The card-level cadence caption was cut; staleness is told once, in the header |
| `radio_info.header.cadence`, `radio_info.header.refresh` | The cadence chip and the header Refresh pill were both cut |

> ⚠️ WARNING: `bun run i18n:check` now exits **1** on a missing key or an empty value (since 2026-08-12), so a green run *does* prove your keys landed in every locale. What it still cannot see is a **hardcoded literal** — a string that never went through `t()` has no key to be missing. That class of bug is invisible to every gate in this repo; only reading the component catches it.

## Icon boundary

`/cellular/` is a Material Symbols route (see [icon-system.md](icon-system.md) and DESIGN.md > Icon-Boundary Rule). Every `MaterialSymbol` call site on this page passes `size` explicitly — the component does not infer one, and an omitted size renders at the font's default rather than the intended step.

The shipped subset is `app/fonts/MaterialSymbolsRounded-subset.{woff2,json}`, currently **101 glyphs**, and the allowlist is `components/ui/material-symbol-names.ts`. Adding a name to the allowlist without regenerating the subset ships a name the font cannot draw. `alt_route` was added for the Active MIMO tile in this change.

Glyphs used on this page: `cell_tower`, `graphic_eq`, `layers`, `alt_route`, `content_copy`, `check`, `schedule`, `visibility`, `visibility_off`, `help`, `warning`, `info`, `radar`, `chevron_right`, `sim_card`, `do_not_disturb_on`, `progress_activity`, and the `signal_cellular_{1..4}_bar` / `signal_cellular_off` ladder.

## Known gaps

- **`components/ui/accordion.tsx` now has zero consumers product-wide.** The only remaining match for "accordion" outside that file is a prose comment in `components/cellular/custom-profiles/scenario-binding/schedule-rule-row.tsx`. It is a known dead file; deleting it was out of scope for this change.
- **16 `react-hooks/refs` errors are visible and unfixed** (14 in `carrier-aggregation.tsx`, 2 in `cellular-information.tsx`), unmasked by fixing the `react-hooks/purity` asymmetry. They flag the deliberate `usePrevious`-style pattern behind the stale freeze; a real decision (suppress with rationale, or restructure) is still owed. This is *not* new breakage.
- **SA mode is implemented but unobserved.** `resolveRadioMode`'s `registered-sa` branch, the `isSA` identity-field switch, the SA distance branch (`calculateNrDistance`), and the NR-holds-the-PCC role assignment have never run against live hardware. Treat them as designed-but-untested, exactly as [carrier-aggregation.md](carrier-aggregation.md) does.
- **Three stale code comments**, cosmetic only: `cellular-information.tsx`'s file header still describes the deleted `@3xl/main:grid-cols-2` two-up layout; `summary-tiles.tsx` refers to "the 84px tile the skeleton mirrors" where `TILE_SHAPE.ROOT` resolves to 92px; and `tick-group.tsx`'s docblock still quotes `TICK_STAGGER_STEP` as 100 ms, where `lib/motion.ts` now defines it as 0.2 s. The last one matters most, because the cascade budget above is derived from that constant.

## Related

- [carrier-aggregation.md](carrier-aggregation.md): `AT+QCAINFO` parsing, the NSA one-PCC rule, `lib/carrier-aggregation.ts`, and the dashboard strip this page shares a view model with
- [antenna-statistics.md](antenna-statistics.md): cites `BAND_ROW_HEIGHT` by name as the skeleton-mirror idiom
- [icon-system.md](icon-system.md): the Icon-Boundary Rule, the subset pipeline, and the glyphs added and rejected for this page
- [dashboard-state-motion.md](dashboard-state-motion.md): `TickGroup`, `useValueTick` and `SwapLabel`
- [dashboard-chart-cards.md](dashboard-chart-cards.md): the CSS-animation replay bug class the row entrances avoid by construction
- [overview-splash.md](overview-splash.md): the `resolveBodyMode()` precedent for a single-owner state machine
- [i18n.md](i18n.md): the locale pipeline, and the two severity policies `i18n:check` and CI apply over one engine
- `DESIGN.md` > Named Rules (Icon-Boundary, Identity-Chip, Filled-Chip, Glyph-Disc, Skeleton-Mirror, Transform-Only, One-Loop, Solid-Container)
