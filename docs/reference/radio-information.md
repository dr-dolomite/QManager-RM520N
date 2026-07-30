# Radio Information (`/cellular/`)

The **Cellular and Radio Information** page is the screen a technician opens to answer two questions in order: *which bands am I on right now*, and *how is each one doing*. It reads nothing of its own. Every figure comes from the ordinary poller snapshot (`/tmp/qmanager_status.json`) that the dashboard already fetches, so the page adds zero backend load and no new CGI endpoint. What it adds is a view model: `lib/radio-info.ts` turns that snapshot into a page mode, a per-carrier list, an aggregate summary and a clipboard payload, and the components under `components/cellular/radio/` render that decision without making one.

This doc records the invariants that are cheap to break and expensive to notice: the branch order of the page state machine, why carrier counts must never come from `ca_count` / `nr_ca_count`, the three distinct meanings of "no value", the stale freeze, and the two design-canon exceptions this page takes.

## Quick Reference

| Thing | Where |
| ----- | ----- |
| Route | `/cellular/` (index; the 17 sub-routes now share its Material Symbols boundary too, see [icon-system.md](icon-system.md)) |
| Page shell | `components/cellular/cellular-information.tsx` |
| View model (pure, no React) | `lib/radio-info.ts` |
| IPv6 / hex helpers (pure) | `lib/ipv6.ts` |
| Page header + liveness chip + Copy diagnostics | `components/cellular/radio/page-header.tsx` |
| Four summary tiles | `components/cellular/radio/summary-tiles.tsx` |
| Non-registered state screens + tile skeleton | `components/cellular/radio/states.tsx` |
| Left card (operator, cell identity, addressing) | `components/cellular/radio/cellular-information-card.tsx` |
| Right card (per-carrier accordion) | `components/cellular/radio/active-bands-card.tsx` |
| Data source | `hooks/use-modem-status.ts` > `/tmp/qmanager_status.json` |
| Upstream helpers it composes | `lib/carrier-aggregation.ts`, `lib/earfcn.ts`, `types/modem-status.ts` |
| i18n | `radio_info.*` in `public/locales/{en,zh-CN,zh-TW,it,id}/cellular.json` (115 keys per locale) |
| Design source | `reimagine/Cellular and Radio Information.dc.html` (gitignored) |

> ℹ️ NOTE: `components/cellular/cell-data.tsx` (522 lines) and `components/cellular/active-bands.tsx` (318 lines) were **deleted** by this change. Their domain logic survives: the IPv6 compression moved verbatim to `lib/ipv6.ts`, and the RAT-owns-which-identity-field rule moved to `cellular-information-card.tsx:429-441`.

## The page state machine

`resolveRadioMode` (`lib/radio-info.ts:63-96`) is the single source of truth for what the page renders. One function owns the branch order, so the header, the tiles and the two cards can never disagree about which state the radio is in. It mirrors the shipped `resolveBodyMode()` pattern on the pre-auth splash (see [overview-splash.md](overview-splash.md)).

| Order | Condition | Mode |
| ----- | --------- | ---- |
| 0 | `!data` or `!data.network` | `loading` |
| 1 | `network.service_status === "sim_error"` | `no-sim` |
| 2 | `network.cfun === 0` or `=== 4` (RF off / airplane) | `no-service` |
| 3 | `network.service_status === "no_service"` | `no-service` |
| 4 | `network.service_status === "searching"` | `searching` |
| 5 | `network.type` | `registered-lte` / `registered-nsa` / `registered-sa` |
| 6 | anything else | `unknown` |

**The order is load-bearing, in both directions.** A missing SIM outranks "no service" because it is the *cause* of it, and a page that reports the symptom while the cause is knowable is doing the technician's job badly. RF-off outranks "searching" because a radio that is switched off is not looking for anything, and a spinner over a disabled radio advertises work that is not happening.

### Non-registered modes replace the body

`isConditionMode` (`components/cellular/radio/states.tsx:128-130`) narrows a `RadioMode` to the four the state screen can draw (`no-sim`, `no-service`, `searching`, `unknown`). When it returns true, `cellular-information.tsx:120` sets `showConditionState` and the two cards are not rendered at all (`:166`), with the state screen taking the tiles' slot (`:155-157`).

This is the point of the redesign, not a nicety. The page is louder and more saturated than the plain table it replaces, so a degraded state rendered *through* the loaded layout reads worse than the old page did: a solid `bg-primary` tile reading "5G NR + LTE" beside forty em dashes, while there is no SIM in the device, is an actively misleading instrument on the exact screen a technician opened to diagnose that.

`isConditionMode` deliberately **excludes `loading`**. Loading is not a condition of the radio, it is a condition of this client, and it gets the skeleton (`SummaryTilesSkeleton`) rather than a tonal state card.

Tone per condition is chosen from what the user can do about it, not from aesthetics (`states.tsx:84-118`): `no-sim` is warning (a real fault the user can fix in situ), `no-service` is destructive (the link is down and the modem cannot help), `searching` is primary (transient and hopeful), `unknown` is neutral (we do not know, and pretending otherwise in either direction would be the actual bug). Each carries a **different** glyph, because `success-container` and `warning-container` measure roughly 1.03:1 apart and are the same surface under deuteranopia.

### Why `isLoading` does not branch

`resolveRadioMode` takes `isLoading` and immediately discards it (`lib/radio-info.ts:72`, `void isLoading`). The parameter stays only because the shell passes it and the signature is shared.

The reason is a specific failure: **a failed first fetch must resolve to `loading`, never to `no-service`.** If the branch consulted `isLoading`, a transport problem (poller stopped, lighttpd wedged, the fetch aborted) would render the destructive "No service" screen, and the page would blame the radio for something the radio did not do. That is the single worst outcome available on the one screen whose job is to tell those two apart. A null snapshot means "nothing to show yet" whether or not a fetch is in flight, and the transport half of the story is told separately by the `error` banner (`cellular-information.tsx:146-148`) and the liveness chip.

## Counts come from grouping, never from `ca_count`

`summariseRadio` (`lib/radio-info.ts:331-356`) derives `lteCount` and `nrCount` by filtering `carrier_components[]` on `technology`. It must never read `network.ca_count` or `network.nr_ca_count`.

Those two fields are **secondary-carrier counts** with an NSA minus-one rule baked into the parser: on EN-DC the LTE cell holds the only PCC and the first NR SCC *is* the NR leg rather than aggregation, so `parse_ca_info()` subtracts it. The live device has been observed reporting `nr_ca_count: 0` while carrying a real, measurable NR carrier. See [carrier-aggregation.md](carrier-aggregation.md) for the full rule. A count that has to be corrected by a rule the UI must remember is a count the UI should not be reading; grouping the array is the only honest answer, and it is correct on LTE-only, NSA and SA without branching.

Released carriers are excluded from every number in the summary (`:332`). The aggregate describes what the radio has *right now*; the released rows stay on screen to explain what it lost.

> ⚠️ WARNING: a known inconsistency, carried over deliberately. The **Cellular information** card's "Carrier aggregation" text row still renders `formatCarrierAggregation` (`cellular-information-card.tsx:625-651`), which was lifted from the deleted `cell-data.tsx:64-85` and does apply the `+ 1` rule to `ca_count` / `nr_ca_count`. It was moved rather than rescued, so on a plain NSA link it prints the qualitative "LTE + NR" rather than a count, and it can only ever produce a count when the modem has already said aggregation is active. The **tiles and the Active bands card do not consult it**: they read `summariseRadio`. If that row is ever changed to print a number in more cases, it must move to `summariseRadio` first.

## Three different meanings of "no value"

The page distinguishes three, and collapsing any two of them produces a confident lie.

### `bandwidth_mhz === 0` is an unrecognised enum, not zero width

`enrichCarriers` maps it to `null` (`lib/radio-info.ts:257`). `summariseRadio` then filters nulls out of `breakdownMhz` before summing (`:339-345`), so a carrier the parser could not decode contributes neither a stray `+ 0` to the "15 + 20 + 60" caption nor a drag on the total. In the detail pills it renders as the localized "Unknown" rather than `0 MHz` (`active-bands-card.tsx:656-665`), because "0 MHz" is a claim the modem never made.

### `percent: null` is not `percent: 0`

`buildMetrics` sets `percent: null` whenever the underlying value is null (`lib/radio-info.ts:130-157`), and the metric row renders the "not reported" caption where the bar would be (`active-bands-card.tsx:254-260`).

The reason is arithmetic, not taste. `rsrpToPercent` (`lib/carrier-aggregation.ts:113`) **floors its output at 2%** precisely so that a genuinely terrible carrier still shows a visible stub rather than an empty track. `0` is therefore a width that function never returns. Feeding a null metric through it, or defaulting to `0` on the way to `MetricBar`, would render the one bar width that is reserved for a different meaning entirely, and it would render it as an assertion about signal strength. SCCs routinely report only a subset of metrics, so this is the common path, not the edge.

### An absent row is not a null value

RSSI is emitted **only** for LTE carriers that actually reported it (`lib/radio-info.ts:164-174`). `AT+QCAINFO`'s NR line shapes carry no RSSI field at all, so every NR component would report null forever; emitting the row anyway would invent a permanently-empty metric and invite the reader to wonder what is wrong with it. RSSI is also `barless: true`: it has no meaningful 0-100 scale to plot against, so it gets a caption where the track would be rather than a bar that means nothing.

## Subcarrier spacing is not per-carrier

`carrier_components[]` has no `scs` key. The only subcarrier-spacing value the modem gives us is `nr.scs`, which describes the **serving** NR cell. So exactly one carrier can honestly claim a reported SCS: the one whose `earfcn` equals `nr.arfcn` (`lib/radio-info.ts:261-273`). Every other NR carrier gets a value from `inferScs` (`:224-230`) and is flagged `scsInferred: true`, which the detail pill surfaces as a focusable **"Derived"** marker with a tooltip (`active-bands-card.tsx:699-752`). Showing an inference as though the modem reported it would be the page lying quietly, which is the failure mode this page is built to avoid.

Two mechanical traps in `inferScs`:

- **`suggestNRSCS` takes a band table entry, not an ARFCN.** Its signature is `suggestNRSCS(band: NRBandEntry)` (`lib/earfcn.ts:346`). Passing a number will not type-check, and reaching for an ARFCN-shaped helper instead will.
- **NR ARFCN ranges overlap, so band-string resolution must come first.** `inferScs` parses the band string (`parseBandNumber`) and looks the entry up in `NR_BANDS`, falling back to `findAllMatchingNRBands(earfcn)[0]` only when there is no usable band string. The fallback is genuinely ambiguous: ARFCN 528030, observed live, matches both **n7 and n41**, which have different duplex modes and therefore different inferred SCS. The band string is the disambiguator the modem already handed us.

## Rows key on `carrierKey`, never on index or PCI

Every accordion row is keyed on `EnrichedCarrier.key` (`active-bands-card.tsx:471-472`), which is `carrierKey(c)` = `` `${technology}-${band}-${earfcn}` `` (`lib/carrier-aggregation.ts:51`). The accordion's `defaultValue` uses the same key (`:438`).

Two independent reasons, both observed:

- **PCI is not unique.** On the live device (Smart PH, PLMN 515-03, NSA) both LTE carriers report **PCI 295**, which is ordinary intra-site aggregation. A PCI-keyed list collapses two real carriers into one row.
- **An index key loses identity across a wipe-and-refill.** A failed AT read empties `carrier_components` wholesale and the next poll repopulates it, potentially in a different order. With index keys, the row the user had open silently becomes a different band under their cursor.

## The stale freeze

`cellular-information.tsx:67-88`:

```tsx
const retained = React.useRef<ResolvedCarrier[]>([]);
const resolved = isStale
  ? retained.current
  : reconcileCarriers(retained.current, data?.network?.carrier_components ?? [], networkType, receivedAtMs);
```

`receivedAtMs` comes from `useModemStatus()` — the wall-clock instant the snapshot landed in the fetch callback, not a render-time read. See below for why that distinction was a real bug, not a style nit.

While `isStale` is true the carrier list **freezes** instead of reconciling. This is not an optimisation.

`reconcileCarriers` interprets "absent from the snapshot" as "released", which is correct when the snapshot is trustworthy. But a single failed or timed-out `AT+QCAINFO` read wipes `carrier_components` to `[]` wholesale (see [carrier-aggregation.md](carrier-aggregation.md) > *Empty array on any failed AT read*). Reconciling against a snapshot the page has already disowned would announce **every** carrier as released, in the same frame that the stale banner and the amber liveness chip are telling the user not to trust the numbers. A screen that simultaneously says "this data is stale" and "here is a fresh, confident list of things that just broke" is exactly the contradiction this page exists to prevent. The 6 s `RELEASE_GRACE_MS` debounce inside `reconcileCarriers` handles the transient blip; the freeze handles the sustained one.

The retention ref is committed in an effect (`:89-91`), not during render, so a render React throws away cannot advance the release clock.

## `receivedAtMs`: the render-time `Date.now()` is gone, not suppressed

`cellular-information.tsx` and `carrier-aggregation.tsx` used to each read `Date.now()` during render, under an `eslint-disable-next-line react-hooks/purity`. Both reads are now gone — fixed, not silenced. `useModemStatus()` (`hooks/use-modem-status.ts`) stamps the wall-clock instant a snapshot **lands**, in the fetch callback where a clock read already existed, and returns it as `receivedAtMs`. Both components take it as a prop instead of calling `Date.now()` themselves: `cellular-information.tsx` and `carrier-aggregation.tsx` pass it into `reconcileCarriers`, `home-component.tsx` threads it through, and `lib/radio-info.ts`'s `enrichCarriers` now takes `nowMs` as a parameter instead of reading the clock internally.

This is not just a lint fix — it closes a real latent bug. `lastSeenMs` is supposed to mean "when did a poll last contain this carrier," but it was being fed a **render** timestamp instead. Both components re-render for reasons that have nothing to do with a new poll landing (`carrier-aggregation.tsx` has its own `handoff` state, for one), and each such render advanced the release clock and got committed by the effect. So the 6 s `RELEASE_GRACE_MS` window was actually measuring time since the *last render that happened to include a carrier* — and a burst of unrelated re-renders could carry a carrier across the release threshold with no new data behind it at all. `reconcileCarriers` is now idempotent in its inputs: the same snapshot at the same `receivedAtMs` always produces the same reconciliation, regardless of how many times the component around it re-rendered.

Worth recording: `lib/radio-info.ts` made the identical `Date.now()` call and was **never flagged** by `react-hooks/purity`, because the rule only analyses component/hook bodies and does not trace into a plain helper function they call. Suppressing the two flagged call sites would have made lint go green over an unchanged codebase — the actual violation would have moved from "flagged twice" to "flagged twice and hidden", not "gone".

> ℹ️ NOTE — a toolchain fact worth knowing before trusting a clean `eslint` run on this rule: `eslint-plugin-react-hooks` v7 is compiler-backed, and its analysis **stops at the first violation found in a component** — every later diagnostic in that component is simply never emitted, and an `eslint-disable` on the first one hides the rest along with it. Proven on an isolated probe: a component with one render-time `Date.now()` plus three ref-reads during render reported `purity ×1` only; removing the `Date.now()` then reported `refs ×3`; suppressing the `Date.now()` with `eslint-disable` instead reported **0 errors**. Fixing these two purity violations for real (rather than suppressing) unmasked **16 pre-existing `react-hooks/refs` errors** that had been sitting behind them the whole time — 14 in `carrier-aggregation.tsx`, 2 in `cellular-information.tsx`. App-source lint went from 36 to 51 errors in this pass: `purity` 1→0, `refs` 14→30, every other rule and all 29 warnings unchanged. **Those 16 `refs` errors are pre-existing, not fixed by this change, and are an open decision** — they flag the deliberate, already-documented "read `retained.current` during render to diff against the previously committed chain" `usePrevious`-style pattern used by the stale freeze (see below). Treat them as a known, tracked gap, not as new breakage introduced here and not as something already resolved.

## Colour: three facts, three channels

The comp tinted each carrier row by **role** (PCC blue, ANCHOR teal). That was rejected, and the reasoning generalises (`active-bands-card.tsx:74-98`):

- The dashboard CA strip tints the very same carriers by **technology** (NR blue, LTE violet). Two screens one click apart cannot disagree about what blue means, so `primary-container` keeps its single meaning of "this is the NR leg".
- Tinting the whole row by technology breaks a different rule. The collapsed row carries a **status** chip, and every status role is itself a container fill. A `success-container` chip sitting on a `primary-container` row loses its edge and stops reading as a chip; `carrier-aggregation.tsx:70` already documents that collision as the reason its own role chip is not a `Badge`.

So the shipped assignment is:

| Fact | Channel |
| ---- | ------- |
| The row itself | Neutral `bg-surface-container`, no tint (`ROW_SHELL`, `active-bands-card.tsx:69`) |
| Technology identity | The band label, as `Badge variant="nr" \| "lte"` (`bandIdentityVariant`, `:99-102`) |
| Role | The role chip's **words** (PCC / ANCHOR / SCC n), on the neutral ramp (`ROLE_CHIP`, `:114-115`) |
| Quality | The status chip's fill, on a plain surface where it can be seen (`qualityVariant`, `:117-129`) |

Three facts, three channels, no channel doing two jobs. The quality glyph is the **wedge** ladder (`signal_cellular_{1..4}_bar` + `_off`, `:146-159`), not the `signal_cellular_alt*` family the comp drew, mirroring the call already settled on `signal-status-card.tsx`.

The same discipline governs the four summary tiles (`summary-tiles.tsx:20-39`): exactly **one** tile carries colour, and it is the only one whose subject is a radio (Network type, filled in the identity role of the radio actually registered). The comp painted all four, including Active MIMO in the LTE violet, which asserts "this is the 4G leg" about a compound value like `LTE 1x2 | NR 2x4`. `NETWORK_TILE` is a **total** map over `RadioMode` (`:133-176`) so an unhandled mode can only ever degrade to the honest neutral tile, never to a confident "5G NR + LTE".

## Motion: the second Transform-Only exception

The accordion expand animates real `height` (`active-bands-card.tsx:578-585`): Radix's `--radix-accordion-content-height` driving tw-animate-css's accordion keyframes, retargeted off their 200 ms / ease-out default onto the system's `emphasized` pair (400 ms, `cubic-bezier(.05,.7,.1,1)`), which is the comp's own `qm-expand` curve.

**This is the second documented exception to the Transform-Only Rule.** The CA chain's `width` (`.ca-segment`) was the only one. Height earns it for the same class of reason:

- `scaleY` squashes every child's type and border radius on the way open, and this content is dense type inside rounded pills.
- `clip-path` reveals without reflowing, so the collapsed row would sit in layout reserving its expanded height, and a four-row card would be mostly empty space.

`height` is the only mechanism that both reveals and reflows. It is also a one-shot, user-initiated gesture on at most one row at a time, not a per-poll animation.

A raw CSS `animation:` class is safe **here and nowhere else on this card**: Radix mounts and unmounts the content, so the keyframe runs on mount rather than replaying on every repoll. That is the exact bug class the row entrances avoid by using motion variants instead, and the same one `useChartDrawIn()` exists to solve on the dashboard charts (see [dashboard-chart-cards.md](dashboard-chart-cards.md)). `motion-reduce:animate-none` is present.

The rest of the page's motion is shared primitives: `staggerContainer` / `staggerItem` for the page cascade (which *is* the comp's `qm-cascade`, its hardcoded 0/60/120/180 ms delays being exactly the 60 ms card step), `staggerRows` / `staggerRowItem` inside both cards, one `TickGroup` per card body, and `SwapLabel` for the status chip's label half. See [dashboard-state-motion.md](dashboard-state-motion.md) for those contracts.

## Copy diagnostics is radio metrics only

`buildDiagnosticsText` (`lib/radio-info.ts:380-431`) emits a fixed-width text block: a header line, network type and operator, the aggregate, then one line per carrier with role, technology, band, ARFCN/EARFCN, bandwidth and PCI, plus an indented metrics line. Metrics with no value are omitted rather than printed as `null`, and SINR is labelled `SNR` on an NR carrier because that is what the 5G spec calls it.

It **deliberately excludes** IMEI, ICCID, WAN IPv4, WAN IPv6, DNS servers, Cell ID, eNodeB, Sector, TAC and APN.

> ⚠️ WARNING: this is a deliberate constraint, not an oversight, and the payload must not widen. The entire value of the button is that a user can paste the result into a public forum or a support thread without auditing it first. Every field above is either an identifier for the device, an identifier for the subscriber, or an identifier for the physical cell site. Adding "just the Cell ID" turns a safe-by-construction artifact into one that needs a warning label, and the warning label is the thing nobody reads.

The header's Copy button falls back to a toast on failure (`page-header.tsx:73-78`), which is a real path rather than a theoretical one: the app is served over plain HTTP from the modem, and some browsers block the async clipboard API outside a secure context.

## Liveness and staleness, on three surfaces

The page takes all five values from `useModemStatus()` (`cellular-information.tsx:52`). The outgoing component destructured only `{ data, isLoading }`, which was a live bug rather than an omission: when the poller stopped responding the page kept rendering the last numbers it had, at full confidence, with nothing on screen saying so.

| Surface | Bound to | Behaviour |
| ------- | -------- | --------- |
| Liveness chip (`page-header.tsx:131-163`) | `isStale` | Pulsing green dot pair while live; a **still** amber `warning` glyph chip when stale. Hidden entirely while `isLoading`, rather than guessing (Saved-State Honesty) |
| Page banner (`cellular-information.tsx:146-148`) | `error && !isLoading` | `Banner role="stale"`, outside the entrance cascade because a condition should never wait its turn |
| Active bands chip (`active-bands-card.tsx:386-398`) | `isStale` | Swaps the cadence caption for the stale caption |
| Refresh action | `refresh` | Primary pill in the header; also the retry action on every condition screen |

The comp's **"Updates every 30s"** chip was cut. The client polls at 2 s and the modem's CA data refreshes every ~3.7-4.0 s measured across 103 consecutive polls, so the claim was false by roughly 8x. `active-bands.tsx:161` shipped that same false cadence and it was deliberately not carried forward. A cadence a user can set a watch by is worse than no cadence at all, so the shipped statement is qualitative.

## What was cut from the mock, and why

| Cut | Why |
| --- | --- |
| **"Same tower / PCI matches"** affinity note | PCI is a per-frequency physical cell identity and is reused; two carriers sharing one says nothing reliable about the site. It is not a site identifier and must not be presented as one |
| **"Nothing here is derived except the frequencies"** footnote | False on six counts: the quality words, the bar widths, the ANCHOR role, the bandwidth sum, the hex TAC and the duplex mode are all derived (`cellular-information-card.tsx:50-53`) |
| **The two-tier `advanced` split** | It reads like a user control, but the comp has no toggle anywhere: it is a design-tool editor boolean. eNodeB, Sector and the hex TAC render unconditionally at one detail level |
| **The low-SNR causal claim** | The comp went on to say "the scheduler may drop it under load". QManager has no visibility into scheduler behaviour and cannot verify it, so the notice states the reading only (`active-bands-card.tsx:607-626`) |
| **The unconditional pulsing liveness dot** | See above; a pulse over frozen numbers is a worse lie than no indicator |
| **`arrow_forward`** on the scanner link | This is in-app navigation and the subset already carries `chevron_right` for it |
| **`oklch(...)`-at-alpha surfaces** | White-at-alpha over a tinted container is banned by the Solid-Container Rule: a stable mid-grey in light mode, a near-white blowout in dark, and a contrast ratio that is not computable. Replaced with `bg-surface` and `surface-container-high` |

## i18n

All copy lives under `radio_info.*` in the `cellular` namespace: **115 keys per locale**, present in all five of `public/locales/{en,zh-CN,zh-TW,it,id}/cellular.json`. `bun run i18n:check` passes at 100% parity.

> ⚠️ WARNING: several key families are reached through **template literals** and are invisible to any static extraction or unused-key scan. Deleting one because grep found no call site will ship a raw key string to a device.

| Key family | Built at |
| ---------- | -------- |
| `radio_info.states.<mode>.{title,description}` | `states.tsx:163`, `:166` (via `CONDITION_KEY`) |
| `radio_info.bands.role.<roleKey>` | `active-bands-card.tsx:351` |
| `radio_info.bands.quality.<quality>` | `active-bands-card.tsx:448` |
| `radio_info.bands.metric.<labelKey>` | `active-bands-card.tsx:246` |
| `radio_info.tiles.network.*` (via `NETWORK_TILE`) | `summary-tiles.tsx:133-176`, resolved by mode |

The network-type **value** is read from the shared `radio_info.network_type.*` keys by both the tile and the Cellular information card's row (`summary-tiles.tsx:126-132` explains why): the two render simultaneously two inches apart, and an earlier draft with a second key set had the tile saying "5G standalone" while the row said "5G NR SA". Tile **captions** stay tile-local, because they are elaboration the row has no room for rather than a restatement of the same fact.

## Icon boundary

This page was the **first `/cellular/` surface on Material Symbols**, and the reason `active-bands-card.tsx:489` reaches for `AccordionPrimitive.Trigger` instead of the shipped `AccordionTrigger` wrapper: that wrapper bakes in a lucide `ChevronDownIcon` (and a legacy `rounded-md`). Every Radix affordance is preserved.

The index's 17 sibling sub-routes (Cell Scanner, Band Locking, SMS, APN Management, Antenna Alignment and the rest) have since been converted too, closing what was a tracked, temporary split inside the `/cellular/` route family. See [icon-system.md](icon-system.md) for the full conversion (49 files, +24 glyphs) and DESIGN.md > Icon-Boundary Rule, which now covers the whole family rather than just this index.

Six glyphs were added for this page specifically: `content_copy`, `expand_more`, `graphic_eq`, `layers`, `settings_input_antenna`, `sim_card`. `icon-system.md` records the ones deliberately **not** added for this page and for the sub-routes, and the reasoning, which is reusable.

## Known gaps

- **`formatCarrierAggregation` still reads `ca_count` / `nr_ca_count`** in the left card's summary row. Documented above; not consumed by the tiles or the bands card.
- **16 `react-hooks/refs` errors are now visible and unfixed** (14 in `carrier-aggregation.tsx`, 2 in `cellular-information.tsx`), unmasked by fixing the `react-hooks/purity` asymmetry described above. They flag the deliberate `usePrevious`-style pattern behind the stale freeze; a real decision (suppress with rationale, or restructure) is still owed, but this is *not* new breakage from this change.
- **SA mode is implemented but unobserved.** `resolveRadioMode`'s `registered-sa` branch, the SA identity-field switch (`cellular-information-card.tsx:430-438`), and the NR-holds-the-PCC role assignment have never run against live hardware. Treat them as designed-but-untested, exactly as [carrier-aggregation.md](carrier-aggregation.md) does.
- **Three glyph comments in `summary-tiles.tsx` are stale.** They say `graphic_eq`, `layers` and `settings_input_antenna` are "not in the shipped subset" and name a fallback; the glyphs were added in the same change and the code uses them. Comment-only drift, cosmetic.

## Related

- [carrier-aggregation.md](carrier-aggregation.md): `AT+QCAINFO` parsing, the NSA one-PCC rule, `lib/carrier-aggregation.ts`, and the dashboard strip this page shares a view model with
- [icon-system.md](icon-system.md): the Icon-Boundary Rule, the subset pipeline, and the glyphs added and rejected for this page
- [dashboard-state-motion.md](dashboard-state-motion.md): `TickGroup`, `useValueTick` and `SwapLabel`
- [dashboard-chart-cards.md](dashboard-chart-cards.md): the CSS-animation replay bug class the accordion avoids by construction
- [overview-splash.md](overview-splash.md): the `resolveBodyMode()` precedent for a single-owner state machine
- `DESIGN.md` > Named Rules (Icon-Boundary, Identity-Chip, Filled-Chip, Glyph-Disc, Skeleton-Mirror)
